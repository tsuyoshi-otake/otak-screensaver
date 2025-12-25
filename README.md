# otak-screensaver

<p>
  <img src="images/beziers.png" width="32%" alt="Beziers">
  <img src="images/mystify.png" width="32%" alt="Mystify">
  <img src="images/flying-windows.png" width="32%" alt="Flying Windows">
</p>

VS Code の中でスクリーンセーバー（Beziers / Mystify / Flying Windows）を表示します。

## 使い方

![alt text](images/02.png)

- ステータスバーのアイコンを押すと表示/終了（トグル）
- コマンドパレットからも起動できます
  - `Toggle ScreenSaver`
  - `ScreenSaver: Beziers`
  - `ScreenSaver: Mystify`
  - `ScreenSaver: Flying Windows`
- 自動起動を有効にすると、一定時間操作が無いと自動で起動します（操作すると終了します）

## 設定

- `otakScreensaver.mode`: `random` / `beziers` / `mystify` / `flyingWindows`
- `otakScreensaver.autoStart`: 自動起動（true/false、デフォルト true）
- `otakScreensaver.idleMinutes`: 自動起動までの待ち時間（分、デフォルト 5）

## 開発

1. このフォルダを VS Code で開く
2. `F5`（Extension Development Host）で起動
3. 自動コンパイルしたい場合は `npm install` → `Run Extension (Watch)`
4. 日本語の文末コロン（`:` / `：`）チェック: `npm run lint:jp-colon`
