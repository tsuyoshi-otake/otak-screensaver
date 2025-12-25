"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SCREENSAVERS = {
    beziers: { title: 'Beziers', filename: 'screensavers/beziers.html' },
    mystify: { title: 'Mystify', filename: 'screensavers/mystify.html' },
    flyingWindows: { title: 'Flying Windows', filename: 'screensavers/flying-windows.html' },
};
const INTERNAL_ACTIVITY_IGNORE_MS = 500;
const WEBVIEW_ACTIVITY_MESSAGE_TYPE = 'otakScreensaver.userActivity';
const SETTINGS_MIGRATION_VERSION = 1;
async function activate(context) {
    await migrateSettings(context);
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.text = '$(vm-running)';
    statusItem.command = 'otak-screensaver.toggleScreenSaver';
    statusItem.accessibilityInformation = { label: 'Toggle ScreenSaver', role: 'button' };
    const updateTooltip = () => {
        const mode = getConfiguredMode();
        const autoStart = getAutoStartEnabled();
        const idleMinutes = getIdleMinutes();
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.supportThemeIcons = true;
        tooltip.appendMarkdown('$(vm-running) Otak ScreenSaver\n\n---\n\n');
        tooltip.appendMarkdown(`mode: \`${mode}\`\n\n`);
        tooltip.appendMarkdown(`autoStart: \`${autoStart ? 'on' : 'off'}\`${autoStart ? ` (${idleMinutes} min)` : ''}\n\n`);
        tooltip.appendMarkdown('$(gear) [Open Settings](command:workbench.action.openSettings?%22otakScreensaver%22)');
        statusItem.tooltip = tooltip;
    };
    updateTooltip();
    statusItem.show();
    context.subscriptions.push(statusItem);
    let currentPanel;
    let idleTimer;
    let ignoreActivityUntil = 0;
    const setIgnoreActivityFor = (ms) => {
        ignoreActivityUntil = Date.now() + ms;
    };
    const isIgnoringActivity = () => Date.now() < ignoreActivityUntil;
    const restartIdleTimer = () => {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = undefined;
        }
        if (!getAutoStartEnabled())
            return;
        if (!vscode.window.state.focused)
            return;
        if (currentPanel)
            return;
        const idleMs = getIdleMs();
        idleTimer = setTimeout(() => {
            idleTimer = undefined;
            if (!getAutoStartEnabled())
                return;
            if (!vscode.window.state.focused)
                return;
            if (currentPanel)
                return;
            setIgnoreActivityFor(INTERNAL_ACTIVITY_IGNORE_MS);
            show(getConfiguredMode());
        }, idleMs);
    };
    const stopScreensaver = () => {
        if (!currentPanel)
            return;
        const panel = currentPanel;
        currentPanel = undefined;
        setIgnoreActivityFor(INTERNAL_ACTIVITY_IGNORE_MS);
        panel.dispose();
        restartIdleTimer();
    };
    const handleUserActivity = (bypassSuppression = false) => {
        if (!bypassSuppression && isIgnoringActivity())
            return;
        if (currentPanel) {
            stopScreensaver();
            return;
        }
        restartIdleTimer();
    };
    const show = (mode) => {
        const resolved = resolveScreenSaver(mode);
        const { title, filename } = SCREENSAVERS[resolved];
        setIgnoreActivityFor(INTERNAL_ACTIVITY_IGNORE_MS);
        if (!currentPanel) {
            currentPanel = vscode.window.createWebviewPanel('otakScreensaver', `ScreenSaver: ${title}`, vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri],
            });
            currentPanel.webview.onDidReceiveMessage((message) => {
                if (!message || typeof message !== 'object')
                    return;
                const type = message.type;
                if (type === WEBVIEW_ACTIVITY_MESSAGE_TYPE) {
                    handleUserActivity(true);
                }
            }, undefined, context.subscriptions);
            currentPanel.onDidDispose(() => {
                currentPanel = undefined;
                restartIdleTimer();
            });
        }
        else {
            currentPanel.title = `ScreenSaver: ${title}`;
            currentPanel.reveal(vscode.ViewColumn.Active);
        }
        currentPanel.webview.html = getWebviewHtml(context.extensionUri, currentPanel.webview, filename);
    };
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('otakScreensaver')) {
            updateTooltip();
            restartIdleTimer();
        }
    }));
    vscode.window.onDidChangeActiveTextEditor(() => handleUserActivity(), undefined, context.subscriptions);
    vscode.window.onDidChangeVisibleTextEditors(() => handleUserActivity(), undefined, context.subscriptions);
    vscode.window.onDidChangeTextEditorSelection(() => handleUserActivity(), undefined, context.subscriptions);
    vscode.window.onDidChangeTextEditorVisibleRanges(() => handleUserActivity(), undefined, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(() => handleUserActivity(), undefined, context.subscriptions);
    vscode.window.onDidChangeWindowState(() => handleUserActivity(), undefined, context.subscriptions);
    context.subscriptions.push(vscode.commands.registerCommand('otak-screensaver.toggleScreenSaver', () => {
        if (currentPanel) {
            stopScreensaver();
            return;
        }
        show(getConfiguredMode());
    }), vscode.commands.registerCommand('otak-screensaver.showBeziers', () => show('beziers')), vscode.commands.registerCommand('otak-screensaver.showMystify', () => show('mystify')), vscode.commands.registerCommand('otak-screensaver.showFlyingWindows', () => show('flyingWindows')));
    restartIdleTimer();
}
function deactivate() { }
function getConfiguredMode() {
    const config = vscode.workspace.getConfiguration('otakScreensaver');
    const mode = config.get('mode', 'random');
    if (mode === 'beziers' || mode === 'mystify' || mode === 'flyingWindows' || mode === 'random')
        return mode;
    return 'random';
}
function getAutoStartEnabled() {
    const config = vscode.workspace.getConfiguration('otakScreensaver');
    return config.get('autoStart', true);
}
function getIdleMinutes() {
    const config = vscode.workspace.getConfiguration('otakScreensaver');
    const minutes = config.get('idleMinutes', 5);
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0)
        return 5;
    return minutes;
}
function getIdleMs() {
    return Math.max(1, getIdleMinutes()) * 60_000;
}
function resolveScreenSaver(mode) {
    if (mode === 'beziers' || mode === 'mystify' || mode === 'flyingWindows')
        return mode;
    const ids = ['beziers', 'mystify', 'flyingWindows'];
    return ids[Math.floor(Math.random() * ids.length)];
}
function getWebviewHtml(extensionUri, webview, filename) {
    const htmlPath = path.join(extensionUri.fsPath, filename);
    let html = fs.readFileSync(htmlPath, 'utf8');
    // Replace resource URI placeholders
    const screensaversUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'screensavers'));
    html = html.replace(/\{\{screensaversUri\}\}/g, screensaversUri.toString());
    const nonce = getNonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} https: data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    html = html.replace(/<head>/i, `<head>\n\t<meta http-equiv="Content-Security-Policy" content="${csp}">`);
    html = html.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
    const exitOnActivityScript = `\n<script nonce="${nonce}">\n(() => {\n\tconst vscode = acquireVsCodeApi();\n\tlet sent = false;\n\tconst send = () => {\n\t\tif (sent) return;\n\t\tsent = true;\n\t\tvscode.postMessage({ type: '${WEBVIEW_ACTIVITY_MESSAGE_TYPE}' });\n\t};\n\twindow.addEventListener('mousemove', send, { passive: true });\n\twindow.addEventListener('mousedown', send, { passive: true });\n\twindow.addEventListener('keydown', send);\n\twindow.addEventListener('wheel', send, { passive: true });\n\twindow.addEventListener('touchstart', send, { passive: true });\n})();\n</script>\n`;
    if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${exitOnActivityScript}</body>`);
    }
    else {
        html += exitOnActivityScript;
    }
    return html;
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
async function migrateSettings(context) {
    const current = context.globalState.get('settingsMigrationVersion', 0);
    if (current >= SETTINGS_MIGRATION_VERSION)
        return;
    const config = vscode.workspace.getConfiguration('otakScreensaver');
    await overwriteSetting(config, 'autoStart', true);
    await context.globalState.update('settingsMigrationVersion', SETTINGS_MIGRATION_VERSION);
}
async function overwriteSetting(config, key, value) {
    const inspected = config.inspect(key);
    if (!inspected)
        return;
    const targets = [];
    if (inspected.workspaceFolderValue !== undefined)
        targets.push(vscode.ConfigurationTarget.WorkspaceFolder);
    if (inspected.workspaceValue !== undefined)
        targets.push(vscode.ConfigurationTarget.Workspace);
    if (inspected.globalValue !== undefined)
        targets.push(vscode.ConfigurationTarget.Global);
    if (targets.length === 0)
        targets.push(vscode.ConfigurationTarget.Global);
    for (const target of targets) {
        await config.update(key, value, target);
    }
}
//# sourceMappingURL=extension.js.map