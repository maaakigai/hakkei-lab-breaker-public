# 2026-07-24 公開ポートフォリオQR登録

## 対象ステップ

`scripts/windows/release.bat`から公開QR登録を体験できる状態へ戻し、`Failed to fetch`を解消する。

## 変更ファイル

- 接続設定: `config/app.config.json`
- Main / Preload / Renderer: `src/main/index.ts`、`src/main/remoteHttp.ts`、`src/preload/index.ts`、`src/renderer/app.ts`、`src/renderer/index.html`、`src/shared/types.ts`
- サーバー保護: `CloudServer/hakkei-score-server/server.py`
- テスト: `test/remote-http.test.mjs`
- 説明・手動確認: `README.md`、`CloudServer/README_DEPLOY_NOTES.md`、`HUMAN_TEST_GUIDE_JA.md`、`docs/architecture/electron-security.md`、`docs/verification_checklist*.md`

## 採用した判断

- 通常の`release.bat`はHTTPS/WSSの共有デモサーバーへ接続し、QR登録、スマートフォン状態同期、サーバーランキングを体験可能にする。
- `release_local.bat`はQRを使わない障害時継続経路として維持する。
- Rendererから外部URLへ直接`fetch`せず、Mainの`remoteHttpRequest`へ必要なAPIだけを許可する。任意URLと`/api/admin-reset`は許可しない。
- `remoteSession.enabled=false`または`--local-mode`では、QRやサーバーランキングを表示せず、キーボード名前登録とローカルランキングへ切り替える。
- サーバー全削除は固定確認文字列だけで実行せず、サーバー環境の`HAKKEI_ADMIN_TOKEN`または権限`0600`の`data/.admin-token`とBearer tokenの一致を必須にする。公開クライアントにtokenは含めない。

## 理由・根拠

- 失敗原因は、公開設定が`enabled=false`かつ`127.0.0.1:45200`であるのに、RendererのQR表示とHTTP pollingが継続していたことだった。
- スマートフォンで`127.0.0.1`を開くとスマートフォン自身を指すため、PC上のローカルサーバーをQRへ埋め込んでも登録体験にならない。公開体験にはスマートフォンから到達できるHTTPS URLが必要。
- RendererのCSPと`webSecurity=true`を緩めて外部通信を通すより、Mainへ通信先とAPIを限定する方がpreload境界を維持できる。
- 公開リポジトリへ本番URLを載せる以上、ソースに書かれた固定文字列だけで全ランキングを削除できる状態は避ける必要がある。

## 確認結果

- `https://score.hakkei.org/`、`/api/session-entries`、`/api/ranking-board`: HTTP 200、TLS検証成功。
- `npm run typecheck`: PASS。
- `npm run lint`: PASS。
- `npm test`: PASS（286件）。許可API、任意URL拒否、管理API拒否、Main HTTP query/JSON送信を含む。
- `python -m py_compile CloudServer/hakkei-score-server/server.py`: PASS。設定済み、誤り、欠落の各Bearer token判定もPASS。
- Electron通常起動: QR canvasと`https://score.hakkei.org/join?...`を確認。WebSocketは`open`、ユーザー台帳・登録履歴・ランキング同期は成功し、`Failed to fetch`なし。
- スマートフォン相当の一時session登録: 公開`/join`は200、`/api/session-entry`登録は200、Electronログで`Title -> InputCheck`とentry取得成功を確認。検証sessionはDELETE 200で削除済み。
- `--local-mode`: `OFFLINE REGISTRATION`、キーボード名前入力あり、QR canvasなしを確認。
- 公開サーバーのサービス配置先へ保護済み実装を反映し、旧版はサーバー内のバックアップへ退避した。
- 管理tokenはGit管理外の`data/.admin-token`へ生成し、権限`0600`を確認した。値はログ・文書・リポジトリへ記録していない。
- `hakkei-score.service`は再起動後も`active`。稼働ファイルのSHA-256は`e391206b6cf6da0a9d0a50d9e0c42cb14162d7f5be156420434c810dc927f3b5`で、検証済みローカル版と一致した。
- デプロイ後の公開確認: トップ、session一覧、ランキングはHTTP 200。tokenなしの`/api/admin-reset`はデータを変更せずHTTP 403で拒否された。

## 手動確認

1. `scripts/windows/release.bat`を起動する。
2. `START GAME`で`https://score.hakkei.org/join?...`のQRが表示されることを見る。
3. スマートフォンから個人情報を含まないニックネームを登録する。
4. ElectronがInputCheckへ進み、スマートフォンが入力機器待機へ切り替わることを見る。
5. `logs/state-YYYYMMDD.log`にWebSocket接続またはHTTP entry取得成功があり、`Failed to fetch`がないことを見る。

## 残課題

- 実スマートフォンのカメラでのQR読み取りは、人間が画面を操作して最終確認する。
