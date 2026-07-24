# 20260708 BLE QR smartphone test

- 対象ステップ: 現行BLE直読版 QR登録 + スマホREADY/EXIT + mocopi BLE UDP注入テスト
- 変更ファイル:
  - `scripts/inject-mocopi-ble.mjs`
  - `docs/runs/20260708-ble-qr-smartphone-test.md`
- 採用した判断:
  - `scripts/windows/release.bat` と本体コードは変更しない。
  - Electronはテスト時だけ `--remote-debugging-port=9223` 付きで起動し、START押下と画面観察を外部CDPで行う。
  - mocopi BLE偽装は本体へIPC注入せず、通常sidecar/replayと同じ `127.0.0.1:45150` UDP `mocopi-ble` packetだけを送る。
  - 注入スクリプト名は `npm test` に拾われないよう `test` を含めない。
  - スマホ操作はQR先ページが使う公開HTTP APIだけを使う。
- 理由・根拠:
  - 現行実装は BLE sidecar/replay -> Main UDP receiver -> `PunchInputSample` の経路であり、UDP入力ならRenderer再計算や本体内部状態の直接改変を避けられる。
  - `ble-raw3.csv` がこの作業環境に無く、既存の録画再生ボタンだけでは実機なし通しテストを開始できなかった。
- 確認結果:
  - QR表示: `START GAME` 押下後、`https://score.example.com/join?sessionId=...` が表示された。
  - スマホ登録相当: `/api/session-entry` POSTで登録成功し、ElectronがInputCheckへ進んだ。
  - no-impact経路: 弱い/タイミング外パンチで `Result / ¥0 / Rank E` へ完走し、サーバーsessionにも `resultDamageYen=0` が記録された。
  - 有効パンチ経路: 強スパイク注入で `Result / ¥1,676,594 / Rank B` へ完走し、ランキングAPIに `CODEX145601` の `videoLevel=3` recordが反映された。
  - スマホEXIT: `/api/session-result-exit` POST後、ElectronはTitleへ戻った。
  - スマホCANCEL: `/api/session-cancel` POST後、ElectronはRegistrationへ戻った。
  - 入力境界: 空文字、日本語、17文字名は `/api/session-entry` が400で拒否し、`OK_NAME-1` は200で受理した。
- 見つけた問題:
  - BLE未受信で `CONNECTION ERROR` 表示中でも `PROCEED Enter the lab` が可視かつ押せる状態だった。スマホREADYだけでは進行しなかったが、画面上は次へ進めそうに見える。
  - `docs/CURRENT_USAGE_JA.md` はRelease UIのQR登録フローとずれており、Titleの実表示が `START GAME / RANKING BOARD / QUIT GAME` であることを説明していない。
- 残課題:
  - 実スマホのカメラ/ブラウザUIでのQR読取、端末ローカルストレージlicense保持、カメラ権限拒否時の表示は未確認。
  - 実mocopi BLEハードウェアの10連続完走は未確認。
  - `PROCEED` 可視条件のUI修正候補: `inputCheckReady()` がfalseの間はボタンを非表示またはdisabledにする。

## 追試: スマホ側例外操作

- 対象ステップ: QR登録後のスマホページリロード、CANCEL、READY重複、Result EXIT重複、不一致ID操作。
- 追加確認結果:
  - QR表示直後、登録前に `/join?sessionId=...` を3回リロードしても、ElectronはRegistration待ちのまま維持された。
  - 登録後/READY前に `/join` と `/license` をリロードしても、ElectronはInputCheckを維持した。
  - READY前のCANCEL、CANCEL連打はいずれも200で、ElectronはRegistrationへ戻った。
  - READY後かつBLE未受信の状態でスマホページをリロードしても、ElectronはInputCheckのまま進行しなかった。
  - READY後かつBLE未受信の状態でCANCELすると、ElectronはRegistrationへ戻った。
  - ゲーム進行中（HakkeiReady）にスマホページをリロード、READY再送、CANCEL送信をしても、Electronは巻き戻らずHakkeiReadyを継続した。
  - ゲーム進行中にCANCELしたsessionでも、Result到達時に同じsessionへ `resultAtMs` / `resultDamageYen` / `resultRank` が記録された。
  - Result画面で `/join` / `/license` をリロードすると、スマホページはResult/EXITを含むHTMLを返した。
  - Result EXIT連打は200で `resultExitAtMs` を更新したが、Electron側は一度だけTitleへ戻った。
  - 古い/消えたsessionへのResult EXITは404で、Electron側には影響しなかった。
  - 不一致 `playerId` のREADY/CANCELは403、壊れたsessionIdのREADYは400、存在しないsessionのCANCELは404で拒否された。
  - キャンセル済みsessionの `/join` / `/license` リロードは200で、HTML上はPLAYER LICENSE/READY/CANCELを含む画面を返した。
- 追加追試: CANCEL後リロードとCANCEL遷移
  - READY前CANCEL: ElectronはInputCheckからRegistrationへ戻った。戻った後に古いCANCEL済みsessionの `/join` / `/license` をリロードしても、Electronは新しいRegistration待ちのままで再びInputCheckへ進まなかった。
  - READY後/BLE未接続CANCEL: ElectronはInputCheckからRegistrationへ戻った。戻った後に古いCANCEL済みsessionの `/join` / `/license` をリロードしても、Electronは新しいRegistration待ちのままで再びInputCheckへ進まなかった。
  - 進行中CANCELの追加再確認は、`/api/session-ready` が一時的にCloudflare 502を返したため、その回は実際にはInputCheck中CANCELとして処理された。前段の追試ではHakkeiReady中CANCELでElectronが巻き戻らずResultまで続行することを確認済み。
- 追加で見つけた問題:
  - 進行中CANCELがサーバー上は記録される一方、ElectronはResultまで続行し、同じsessionに結果も記録する。ユーザーの認識として「スマホでキャンセルしたのに結果が残る」可能性がある。
  - キャンセル済みsessionをスマホ側でリロードしても、キャンセル済みであることがHTML上から明確に分からず、READYできそうに見える可能性がある。

## 追試: スマホ側dialog実表示

- 対象ステップ: スマホページを実ブラウザ表示で開き、dialogのopen/closeと表示文言を確認。
- 確認結果:
  - 初期 `/join`: `REGISTRATION` と名前入力/REGISTERのみ表示。全dialogはclosed。
  - REGISTER後: `/license` へ移動し、`device-wait-dialog` がopen。文言は `INPUT CHECK / CONNECTING / WAITING FOR INPUT DEVICE / KEEP THIS PAGE OPEN UNTIL THE GAME SCREEN SHOWS CONNECTED. / CANCEL`。入力デバイス待ちとして目的に合う。
  - BLE接続後: `device-wait-dialog` がclosed、`ready-dialog` がopen。文言は `ARE YOU READY? / MOCOPI IS LINKED ON THE GAME SCREEN. / I'M READY / CANCEL`。ゲーム画面のCONNECTED状態と対応している。
  - READY押下後: ElectronはChargeへ進行。スマホ側は `ready-dialog` がopenのまま `READY SENT. WATCH THE GAME SCREEN.` に変わる。進行中であることは伝わるが、CANCELボタン付きのREADY dialogが残る。
  - Result到達直後: 数秒間はREADY dialogのまま。サーバーsessionにResultが記録された後、`ready-dialog` がclosed、`result-dialog` がopenになった。
  - Result dialog: `RESULT / TOTAL DAMAGE / ¥ 0 / EXIT` を表示。Result確認という目的に合う。
  - EXIT押下後: 全dialogがclosed、スマホ側は `LICENSE ACTIVE.`、ElectronはTitleへ戻った。
  - device-wait中の通常リロード: `device-wait-dialog` が再度openし、入力待ち状態が復元された。
  - device-waitのCANCEL押下: dialogはclosed、スマホ表示は `INPUT DEVICE WAIT CANCELLED. KEEP THIS PAGE OPEN.`。ElectronはInputCheckのまま戻らない。
  - device-wait CANCEL後のリロード: `device-wait-dialog` が再度openした。
  - ready-dialog中の通常リロード: `ready-dialog` が再度openし、READY待ち状態が復元された。
  - ready-dialogのCANCEL押下: dialogはclosed、ElectronはRegistrationへ戻った。ただしスマホ側表示は `WAITING FOR GAME SCREEN...` のままで、戻ったことが分かりにくい。
  - ready-dialog CANCEL後のリロード: dialogはclosedのまま。スマホ側は `WAITING FOR GAME SCREEN...`、Electronは新しいRegistration待ち。
- 追加で見つけた問題:
  - READY押下後からResult反映まで、READY dialogが残り続ける。ゲームは進行中なので、スマホ側は「プレイ中」表示へ切り替わる方が自然。
  - device-wait dialogのCANCELはゲーム側CANCELではなく、スマホ側待機dialogを閉じるだけ。同じ `CANCEL` 表記でも ready-dialogのCANCELとは意味が違う。
  - ready-dialog CANCEL後、スマホ側が `WAITING FOR GAME SCREEN...` のまま残り、ElectronがRegistrationへ戻ったことを表示しない。
  - device-wait CANCEL後にリロードすると、ユーザーが閉じたはずのdevice-wait dialogが復活する。

## 2026-07-08 QR/BLEスマホ進行状態修正

- 変更ファイル: `src/renderer/app.ts`, `/srv/hakkei-score-server/server.py`, `docs/verification_checklist.md`, `docs/runs/20260708-ble-qr-smartphone-test.md`, HLB Server repo `server.py`, `README.md`, `description.md`。
- 採用した判断:
  - `inputOk` は `inputCheckReady()` がtrueの場合だけ受理する。画面クリック、Enter、スマホREADY自動進行は同じ `tryAdvanceFromInputCheck()` 経路へ寄せる。
  - `PROCEED` は見た目の `.is-visible` だけでなく、buttonの `disabled` / `aria-disabled` も同期する。
  - InputCheck退出通知は `inputOk` の時だけ `/api/session-input-exit?play=1` とし、単なるBack/Escでは `playStartedAtMs` を保存しない。
  - スマホREADY後はREADY dialogを閉じて `PLAYING. WATCH THE GAME SCREEN.` 表示へ移し、進行中CANCELはUIから出さない。
  - 進行中CANCELは無効仕様に固定し、サーバーは `playStartedAtMs >= readyAtMs` かつResult未確定の `/api/session-cancel` をHTTP 409で拒否し、`cancelAtMs` を保存しない。
- 理由・根拠:
  - BLE未接続で `PROCEED` が見えると、ゲーム画面とスマホの入力待ち表示が矛盾するため。
  - READY後にCANCEL付きREADY dialogが残ると、既にゲームが進行している状態をスマホ側で誤認するため。
  - 同一sessionに `cancelAtMs` とResult情報が併存すると、ユーザー意図と記録の意味が曖昧になるため。
  - `playStartedAtMs` はサーバーにゲームロジックを持たせず、session entry上の時刻だけで「進行中CANCEL不可」を判定できる最小の状態であるため。
- 確認結果:
  - `npm run typecheck` PASS。
  - `npm run lint` PASS。
  - `npm test` PASS（265 tests）。
  - HLB Server repo `python -m py_compile server.py` PASS。
  - 一時HTTPサーバーで `session-entry -> session-input-check?ready=1 -> session-ready -> session-input-exit?play=1 -> session-cancel` を実行し、進行中CANCELがHTTP 409、sessionに `cancelAtMs` が残らないことを確認。
  - HLB Server repoへ `Fix smartphone playing session state` をpush済み。
  - 稼働中 `/srv/hakkei-score-server/server.py` をバックアップ後に差し替え、`python3 -m py_compile` PASS。`hakkei-score.service` は新プロセスで `active`。
  - 公開API `https://score.example.com` でも同じ進行中CANCEL確認を実施し、`playStartedAtMs=True`、CANCEL HTTP 409、`cancelAtMs` なしを確認。検証sessionはDELETE済み。
- 残課題:
  - 実スマホブラウザ上でREADY後リロード時にPLAYING表示へ復元されることは、次回の手動通し確認で再確認する。

## 2026-07-08 スマホCANCEL統一とCANCELED UI

- 変更ファイル: `/srv/hakkei-score-server/server.py`, HLB Server repo `server.py`, `README.md`, `description.md`, `docs/verification_checklist.md`, `docs/runs/20260708-ble-qr-smartphone-test.md`。
- 採用した判断:
  - device-wait中の `CANCEL` も本当のsession cancelに統一し、ready-dialogの `CANCEL` と同じ `/api/session-cancel` を呼ぶ。
  - `cancelAtMs > registeredAtMs` かつResult未確定、Playing中でないsessionをキャンセル済みとして扱う。
  - キャンセル済みsessionではスマホ側に `SESSION CANCELED. SCAN THE GAME QR AGAIN.` を表示し、READY dialogやdevice-wait dialogを再表示しない。
- 理由・根拠:
  - 同じ `CANCEL` 表記で「閉じるだけ」と「ゲームをRegistrationへ戻す」が混在すると、参加者が操作結果を予測できないため。
  - ready CANCEL後に古い `/license` が `WAITING FOR GAME SCREEN...` のままだと、ゲーム側がRegistrationに戻ったことがスマホ側で分からないため。
  - 既存entryの `cancelAtMs` / `registeredAtMs` だけでキャンセル済み判定でき、新規APIを増やさずにリロード復元まで扱えるため。
- 確認結果:
  - HLB Server repo `python -m py_compile server.py` PASS。
  - 一時HTTPサーバーでdevice-wait相当の `session-entry -> session-input-check -> session-cancel` を実行し、`cancelAtMs > registeredAtMs` になることを確認。
  - 一時HTTPサーバーの `/license?sessionId=...` HTMLに `SESSION CANCELED. SCAN THE GAME QR AGAIN.`、`function isCanceled`、`function showCanceledState` が含まれることを確認。
  - `npm run typecheck` PASS。
  - `npm run lint` PASS。
  - `npm test` PASS（265 tests）。
  - `npm run build` PASS。
  - HLB Server repoへ `Unify smartphone cancel behavior` をpush済み。
  - 稼働中 `/srv/hakkei-score-server/server.py` をバックアップ後に差し替え、`python3 -m py_compile` PASS。`hakkei-score.service` は新プロセスで `active`。
  - 公開API `https://score.example.com` でdevice-wait相当の `session-entry -> session-input-check -> session-cancel` を実行し、`cancelAtMs > registeredAtMs`、HTMLに `SESSION CANCELED. SCAN THE GAME QR AGAIN.` と `function isCanceled` が含まれることを確認。検証sessionはDELETE済み。
