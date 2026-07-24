# WebSocket session sync

- 対象ステップ: スマホ登録 / READY / CANCEL / Result EXIT の WebSocket 化。
- 変更ファイル: `CloudServer/hakkei-score-server/server.py`, `CloudServer/hakkei-score-server/requirements.txt`, `config/app.config.json`, `src/main/remoteSessionClient.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/app.ts`, `src/shared/types.ts`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `docs/verification_checklist.md`, `eslint.config.mjs`。
- 採用した判断: mocopi BLE / Unity / keyboard の入力経路は変更せず、QR登録サーバー同期だけを WebSocket 優先にする。REST API は初期同期・fallback・既存ランキング/admin用途として残す。
- 理由・根拠: 入力sampleはMain生成 `PunchInputSample` 契約のまま維持する必要がある。一方、スマホ同期はREST pollingと時刻比較が複雑化し、InputCheck / READY / Result EXIT の順序逆転対策が `app.ts` と `server.py` に分散していたため、サーバーpushの `session.snapshot` へ寄せる。
- 採用した判断: Electron RendererではなくMainに `RemoteSessionClient` を置き、preloadは限定APIだけを公開する。
- 理由・根拠: RendererへWebSocketや任意通信を直接持たせず、既存の `contextBridge` 境界に合わせるため。送信失敗時は `ok:false` を返し、既存REST fallbackを使う。
- 採用した判断: `server.py` は `aiohttp` で起動し、既存REST endpointと `/ws` を同一プロセスに置く。session/ranking JSONは `asyncio.Lock` で直列化する。
- 理由・根拠: 旧 `ThreadingHTTPServer` はWebSocketハンドシェイク非対応で、JSON read-modify-writeにも排他がなかった。単一プロセス内のroom broadcastなら `sessionId` ごとのsnapshot配信とREST互換を同時に保てる。
- 確認結果: `npm run typecheck` PASS。`npm test` PASS（271件）。`npm run build` PASS。`npm run lint` PASS。`python -m py_compile CloudServer/hakkei-score-server/server.py` PASS。aiohttp一時サーバーで `session-entry` REST登録、game WebSocketへの `session.snapshot`、phone WebSocketからの `phone.ready` broadcast を確認。
- 注意: ローカルPythonに `aiohttp` が無かったため `python -m pip install -r CloudServer/hakkei-score-server/requirements.txt` を実行した。本番 `192.0.2.10` でも同requirementsの導入が必要。
- 残課題: 実機スマホ + `wss://score.example.com/ws` + Cloudflare Tunnelで、WebSocketが通ること、READY遷移が1秒以内であること、Wi-Fi切断時にREST fallbackへ戻ることを現場確認する。

## 本番反映 2026-07-09

- 対象: `deployment host:/srv/hakkei-score-server/server.py`。
- 実施: `server.py` と `requirements.txt` を本番へ転送し、`python3-aiohttp` をaptで導入した。`hakkei-score.service` は `/usr/bin/python3 /srv/hakkei-score-server/server.py` の既存service定義を維持した。
- Cloudflare Tunnel: `/etc/cloudflared/config.yml` に `score.example.com -> http://localhost:45200` が既にあり、WebSocket追加設定は不要だった。
- 確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。remote `import aiohttp` は `3.9.1`。`hakkei-score.service` は新PID `570514` で `active`、ログに `aiohttp + websocket` 起動表示あり。
- 公開確認: `https://score.example.com/join?sessionId=deploy-ws-html` はHTTP 200で、HTMLに `connectSessionSocket` / `WebSocket` / `/ws` が含まれることを確認。`wss://score.example.com/ws?client=game&sessionId=deploy-ws-public` は `server.hello` を返した。
- 公開フロー確認: `game` WebSocket接続中に `POST /api/session-entry` すると `session.snapshot` と `session.registered` がpushされ、`phone` WebSocketから `phone.ready` を送ると `game` 側に `phone.ready` がpushされた。検証session `deploy-ws-flow-*` はDELETE済み。
- 注意: 転送前の即時バックアップ作成順序を誤ったため、今回反映直前の専用バックアップ名は作れていない。ロールバック候補として既存の `server.py.bak-20260709-003831` が残っている。

## 二重登録ロック 2026-07-09

- 対象: 古いQRまたは同じ `sessionId` に対する複数player登録の競合防止。
- 変更ファイル: `CloudServer/hakkei-score-server/server.py`, `src/renderer/app.ts`, `docs/verification_checklist.md`, `docs/runs/20260709-websocket-session-sync.md`。
- 採用した判断: サーバー側で `sessionId` ごとに最初の `playerId` をロックし、同じ `playerId` の再送・リロードは許可する。別 `playerId` が同じ `sessionId` へ登録しようとした場合はRESTではHTTP 409、WebSocketでは `server.error` を返し、既存entryを上書きしない。
- 理由・根拠: 展示運用ではスマホリロードや二重送信は自然に起きるため同一playerの冪等性は必要。一方、古いQRを別端末が読んだ場合にentryを上書きできると、Electronが保持する現在playerとサーバーentryが分岐し、READY/CANCEL/Result EXITの誤適用につながる。
- 採用した判断: Electron側でも、登録画面通過後は現在の `remote-<playerId>` と一致しない `session.snapshot` entryを無視する。
- 理由・根拠: サーバー拒否を主防御にしつつ、古いイベントや復旧snapshotが混ざった場合でもRenderer状態を巻き戻さないため。READY/CANCEL/EXITは既存どおり現在 `sessionId` と画面状態の検証を通す。
- 確認結果: `npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。`npm test` PASS（271件）。`python -m py_compile CloudServer/hakkei-score-server/server.py` PASS。aiohttp一時サーバーで同一player再登録200、別player登録409、既存entry維持を確認。
- 本番反映: `/srv/hakkei-score-server/server.py.bak-20260709-100220-before-duplicate-lock` を作成後、`server.py` を転送し、`hakkei-score.service` を再起動した。serviceは新PID `571442` で `active`、ログに `aiohttp + websocket` 起動表示あり。
- 公開確認: `https://score.example.com` 経由で同一sessionへ `p1` 登録200、同じ `p1` 再登録200、別 `p2` 登録409を確認し、GET entryが `p1` / `AAA` のまま維持されることを確認。phone WebSocketから別 `p2` の `phone.register` を送ると `server.error` が返ることを確認。検証sessionはDELETE済み。
