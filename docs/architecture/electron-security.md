# Electron security boundary

## 採用している境界

このアプリの画面は、パッケージ内のHTMLだけを`BrowserWindow.loadFile()`で読み込みます。リモートページやリモートJavaScriptはRendererへ読み込みません。

`BrowserWindow`は次を固定しています。

| 設定 | 値 | 理由 |
|---|---|---|
| `contextIsolation` | `true` | RendererのJavaScriptとpreloadのElectron APIを別コンテキストに分離する |
| `nodeIntegration` | `false` | RendererからNode.jsやファイルシステムへ直接アクセスさせない |
| `sandbox` | `true` | RendererをChromiumのプロセスサンドボックス内で動かす |
| `webSecurity` | `true` | 同一オリジン制約などのWebセキュリティ機能を維持する |
| `allowRunningInsecureContent` | `false` | 安全でない混在コンテンツを許可しない |

新規ウィンドウ作成と画面内ナビゲーションもMain Processで拒否します。各HTMLは`default-src 'self'`を基本にしたContent Security Policyを持ちます。

## Main / Preload / Renderer

- Rendererは`ipcRenderer`そのものを受け取りません。
- Preloadは`contextBridge`を通じて、用途ごとに名前を付けたAPIだけを公開します。
- ファイル操作、BLE sidecar、設定保存、スコアサーバー通信はMain Processが担当します。
- スコアサーバーとのHTTP / WebSocket通信はRendererから直接行いません。WebSocketはMain Process内の`remoteSessionClient`、HTTPは接続先とAPIパスを固定した`remoteHttpRequest`へ閉じ込めます。
- RendererからHTTPへ渡せるのは、QRセッションとランキングに必要な許可済みAPIだけです。任意URLや管理用`/api/admin-reset`は渡せません。

この構成により、画面側で問題が起きてもOS機能へ直接到達できる範囲を小さくしています。

## 参照

- [Electron: Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron: Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron: Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
