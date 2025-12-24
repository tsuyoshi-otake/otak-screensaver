#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const ts = require("typescript");

const JAPANESE_CHAR_RE = /[ぁ-んァ-ヶ一-龠々ー]/;
const TRAILING_COLON_RE = /[：:]\s*$/;

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  "coverage",
]);

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isJapaneseTextLineEndingWithColon(line) {
  const trimmedEnd = line.trimEnd();
  return JAPANESE_CHAR_RE.test(trimmedEnd) && TRAILING_COLON_RE.test(trimmedEnd);
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function posToLineCol(lineStarts, pos) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY;
    if (pos < start) {
      high = mid - 1;
    } else if (pos >= nextStart) {
      low = mid + 1;
    } else {
      const line = mid + 1;
      const col = pos - start + 1;
      return { line, col };
    }
  }
  return { line: 1, col: 1 };
}

function formatRelPath(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  return rel.replace(/\\/g, "/");
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectTargetFiles(entryPath, results) {
  const stat = await fs.stat(entryPath);
  if (stat.isFile()) {
    const ext = path.extname(entryPath).toLowerCase();
    if (ext === ".md" || ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
      results.push(entryPath);
    }
    return;
  }

  if (!stat.isDirectory()) return;

  const baseName = path.basename(entryPath);
  if (DEFAULT_IGNORED_DIRS.has(baseName)) return;

  const entries = await fs.readdir(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = path.join(entryPath, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
      await collectTargetFiles(childPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === ".md" || ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
      results.push(childPath);
    }
  }
}

function stripCommentLinePrefix(line) {
  let text = line;
  text = text.replace(/^\s*\* ?/, "");
  return text.trimEnd();
}

function scanMarkdown(filePath, text) {
  const issues = [];
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");

  let inFrontmatter = lines.length > 0 && lines[0].trim() === "---";
  let inFence = false;
  let fenceChar = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFrontmatter) {
      if (i !== 0 && line.trim() === "---") inFrontmatter = false;
      continue;
    }

    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0];
      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
      } else if (fenceChar === markerChar) {
        inFence = false;
        fenceChar = null;
      }
      continue;
    }

    if (inFence) continue;

    if (isJapaneseTextLineEndingWithColon(line)) {
      issues.push({
        filePath,
        line: i + 1,
        col: Math.max(1, line.trimEnd().length),
        message: "日本語文の文末がコロン（: / ：）で終わっています。",
        preview: line,
      });
    }
  }

  return issues;
}

function scanTsJsComments(filePath, text) {
  const issues = [];
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");
  const lineStarts = computeLineStarts(normalized);

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    normalized
  );

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const tokenStart = scanner.getTokenPos();
      const tokenEnd = scanner.getTextPos();
      const rawComment = normalized.slice(tokenStart, tokenEnd);
      const startLine = posToLineCol(lineStarts, tokenStart).line;

      if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
        const content = rawComment.replace(/^\/\/+/, "");
        const normalizedLine = stripCommentLinePrefix(content);
        if (isJapaneseTextLineEndingWithColon(normalizedLine)) {
          const fileLine = startLine;
          issues.push({
            filePath,
            line: fileLine,
            col: Math.max(1, lines[fileLine - 1]?.length ?? 1),
            message: "コメント内の日本語文末がコロン（: / ：）で終わっています。",
            preview: lines[fileLine - 1] ?? rawComment,
          });
        }
      } else {
        const commentLines = rawComment.split("\n");
        for (let i = 0; i < commentLines.length; i++) {
          let line = commentLines[i];
          if (i === 0) line = line.replace(/^\/\*+/, "");
          if (i === commentLines.length - 1) line = line.replace(/\s*\*\/\s*$/, "");
          const normalizedLine = stripCommentLinePrefix(line);
          if (!normalizedLine) continue;
          if (isJapaneseTextLineEndingWithColon(normalizedLine)) {
            const fileLine = startLine + i;
            issues.push({
              filePath,
              line: fileLine,
              col: Math.max(1, lines[fileLine - 1]?.length ?? 1),
              message: "コメント内の日本語文末がコロン（: / ：）で終わっています。",
              preview: lines[fileLine - 1] ?? line,
            });
          }
        }
      }
    }
    token = scanner.scan();
  }

  return issues;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        "Usage:",
        "  node scripts/jp-colon-lint.js [paths...]",
        "",
        "Scans Markdown files and JS/TS comments.",
        "Reports Japanese lines that end with ':' or '：'.",
      ].join("\n") + "\n"
    );
    process.exit(0);
  }

  const targets = args.length > 0 ? args : ["."];
  const files = [];
  for (const target of targets) {
    const fullPath = path.resolve(process.cwd(), target);
    if (!(await pathExists(fullPath))) continue;
    await collectTargetFiles(fullPath, files);
  }

  files.sort((a, b) => a.localeCompare(b));

  const allIssues = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const text = await fs.readFile(filePath, "utf8");
    if (ext === ".md") {
      allIssues.push(...scanMarkdown(filePath, text));
    } else {
      allIssues.push(...scanTsJsComments(filePath, text));
    }
  }

  if (allIssues.length === 0) {
    process.stdout.write("OK: 日本語文末コロンは見つかりませんでした。\n");
    process.exit(0);
  }

  for (const issue of allIssues) {
    const relPath = formatRelPath(issue.filePath);
    process.stdout.write(
      `${relPath}:${issue.line}:${issue.col} ${issue.message}\n  ${issue.preview}\n`
    );
  }
  process.stdout.write(`\nFound ${allIssues.length} issue(s).\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(2);
});

