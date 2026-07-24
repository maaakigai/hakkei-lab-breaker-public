# 20260709 phone input ready switch

- 対象ステップ: QR登録後InputCheckでmocopi未接続からKeyboardへ切り替えた時のスマホREADY遷移。
- 変更ファイル: `src/renderer/app.ts`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: 入力機器切替時は先に `/api/session-input-check` で待機状態を通知し、その完了後に切替先がreadyなら `/api/session-input-check?ready=1` を送る。Keyboardは常時readyなので検証待ちを即終了する。mocopi BLEはpacket受信済みまたは受信中になった時だけready通知する。
- 理由・根拠: 既存実装はKeyboard切替時にwaiting通知と後続ready通知が非同期に並び、ネットワーク遅延でwaitingが後着するとサーバー上の `inputDeviceReadyAtMs` を消してスマホがCONNECTINGに戻る可能性があった。AGENTS.mdのKeyboard fallback維持、`docs/verification_checklist.md` の「mocopi未接続中にKeyboardへ切り替えるとスマホがARE YOU READY?へ切り替わる」確認項目に合わせ、通知順序を直列化した。
- 確認結果: `npm run typecheck` PASS。`npm test` PASS（271件）。`npx eslint src/renderer/app.ts` PASS。`npm run build` PASS。実mocopiは手元にないため未確認。実機接続時はBLE packet受信で `inputCheckReady()` がtrueになり同じready通知経路へ入ることをコード上で確認。
- 手動確認: QR登録後、ElectronがInputCheckに自動遷移したらmocopiを接続せずスマホがCONNECTING表示になることを見る。その状態でElectron右下の `[ K ] KEYBOARD MODE` または `K` キーでKeyboardへ切り替え、スマホが `ARE YOU READY?` / `I'M READY` ダイアログへ変わることを確認する。mocopi実機がある場合はmocopi BLEでInputCheckが `CONNECTED` になった時も同じダイアログへ変わることを確認する。
- 残課題: 実スマホ・実mocopi BLEで、Cloudflare経由の遅延がある状態でもCONNECTING停滞が再発しないことを現地で確認する。

## 追加: Keyboard ready後にmocopi未接続へ戻すケース

- 対象ステップ: InputCheckで `mocopi未接続 -> Keyboard ready -> mocopi未接続` と切り替えた時のスマホCONNECTING復帰。
- 変更ファイル: `src/renderer/app.ts`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: 入力機器ready通知にepochを持たせ、モード切替ごとに古い通知処理を失効させる。さらに、mocopiへ戻して未接続の間だけ、検証待ち後に `/api/session-input-check` を再送してwaiting状態を再確認する。
- 理由・根拠: Keyboard中に既に送信済みの `ready=1` が、mocopiへ戻した後のwaiting通知より遅れてサーバーへ到着すると、スマホ側が再び `ARE YOU READY?` を表示し得る。クライアントから送信済みHTTPを取り消すことはできないため、mocopi未接続が続く場合にwaitingを後追い再送してサーバー状態を現在の入力モードへ戻す。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npx eslint src/renderer/app.ts` PASS。`npm test` PASS（271件）。実スマホ画面での再確認は未実施。
- 手動確認: スマホQR登録後、mocopi未接続でCONNECTING表示を確認する。ゲーム側をKeyboardへ切り替えてスマホが `ARE YOU READY?` になることを確認する。その後、ゲーム側をmocopiへ戻し、mocopi未接続のままスマホがCONNECTINGへ戻ることを確認する。

## 追加: ゲーム側InputCheckのmocopi ready誤表示対策

- 対象ステップ: mocopi未接続なのにゲーム側InputCheckが `CONNECTED` / `PROCEED` になるケース。
- 変更ファイル: `src/renderer/app.ts`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: ゲーム側のInputCheck ready判定と `CONNECTED` 表示は、過去に一度受信した `inputCheckBleReadySeen` ではなく、直近1秒のBLE packet受信 `isBleReceiving()` だけで決める。ready通知済みの状態で未受信へ落ちた場合は、スマホ側へもwaitingを送り直す。
- 理由・根拠: `inputCheckBleReadySeen` は「一度は受信した」診断履歴であり、現在接続中であることを保証しない。接続待機画面では現在の入力可否を表示すべきなので、過去受信をready条件に含めるとmocopiが切断済みでも先へ進める誤表示になる。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npx eslint src/renderer/app.ts` PASS。`npm test` PASS（271件）。
- 手動確認: mocopi BLEを一度受信して `CONNECTED` にした後、エミュレータ停止またはmocopi切断で1秒以上待つ。ゲーム側が `CONNECTED` / `PROCEED` から `SEARCHING` または `CONNECTION ERROR` へ戻り、先へ進めなくなることを確認する。

## 追加: scripts/windows/Settings.batでready判定を切替

- 対象ステップ: mocopi InputCheck ready判定を設定画面で切り替え可能にする。
- 変更ファイル: `config/input.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/main/index.ts`, `src/shared/types.ts`, `src/renderer/app.ts`, `src/renderer/settings.ts`, `test/config-loader.test.mjs`, `docs/verification_checklist.md`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: `input.config.json` に `inputCheck.mocopiBleReadyPolicy` と `inputCheck.mocopiBleRecentWindowMs` を追加する。policyは `recent-only`（現在受信中だけready）と `sticky-after-first`（InputCheck中に一度受信したらready維持）の2択にする。Settings画面には「接続確認」セクションとして表示する。
- 理由・根拠: 安全寄りのready判定は未接続誤readyを防げる一方、実機BLEが不安定な環境ではちらつく可能性がある。運用時にコード編集なしで安全寄り/旧仕様を切り替えられるよう、既存の設定画面とconfig validatorへ正式に追加した。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npx eslint src/renderer/app.ts src/renderer/settings.ts src/main/appConfig.ts src/main/index.ts` PASS。`npm test` PASS（271件）。
- 手動確認: `scripts/windows/Settings.bat` を開き、「接続確認」セクションで `現在受信中だけready（安全）` / `一度受信したらready維持（旧仕様）` を切り替えて保存する。ゲームを再起動し、`config/input.config.json` の `mocopiBleReadyPolicy` と同じ挙動になることを確認する。

## 追加: スマホ反映遅延短縮

- 対象ステップ: ゲーム側のInputCheck/Ready/Result状態をスマホ側が反映するまでの待ち時間短縮。
- 変更ファイル: `src/renderer/app.ts`, `CloudServer/hakkei-score-server/server.py`, `docs/verification_checklist.md`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: Electron側の登録確認pollingを1500msから500msへ短縮する。スマホ側のInputCheck pollingは通常400ms、長時間待機後900msにする。Result pollingは1500msから800msへ短縮する。
- 理由・根拠: QR登録後の画面同期は、Electronがサーバーのentryを拾う周期と、スマホがサーバー状態を拾う周期が重なるため、最大待ち時間が体感上大きくなる。InputCheckは接続確認中のユーザー操作に直結するため400msまで詰め、長時間放置時だけ900msへ落としてサーバー負荷を抑える。Resultは動画終了後の確認なので800msに留める。
- 確認結果: `python -m py_compile CloudServer/hakkei-score-server/server.py` PASS。`npm run typecheck` PASS。`npm run build` PASS。`npx eslint src/renderer/app.ts src/renderer/settings.ts src/main/appConfig.ts src/main/index.ts` PASS。`npm test` PASS（271件）。ローカルから当時の公開接続先とオーバーレイ接続先へのSSHはtimeoutしたため、サーバー反映は未実施。
- 手動確認: QR登録後、ゲーム側InputCheckへの自動遷移が概ね1秒以内に始まることを見る。ゲーム側でKeyboard/mocopiを切り替え、スマホ側のCONNECTING/READY表示が従来より短い待ちで切り替わることを確認する。Result表示後、スマホ側の結果ダイアログが概ね1秒以内に出ることを確認する。

## 追加: mocopi ready後にKeyboardへ切り替えるケース

- 対象ステップ: InputCheckでmocopi BLEが準備完了になった後、Keyboardへ切り替えた時のスマホREADY維持。
- 変更ファイル: `src/renderer/app.ts`, `docs/verification_checklist.md`, `docs/runs/20260709-phone-input-ready-switch.md`。
- 採用した判断: Keyboardへ切り替える時は `/api/session-input-check` のwaiting通知を挟まず、`/api/session-input-check?ready=1` を即送る専用経路にする。mocopiへ戻す時だけwaiting通知と後追いwaiting確認を使う。
- 理由・根拠: Keyboardは切替直後から常時readyであり、waiting通知を先に送る必要がない。mocopi ready済みからKeyboardへ切り替えた時にwaitingを挟むと、スマホ側pollingとHTTP到着順によってCONNECTING表示が残る可能性がある。mocopi未接続へ戻すケースの保護は維持しつつ、ready確定入力のKeyboardではサーバー状態を直接readyへ寄せる。
- 確認結果: `npm run typecheck` PASS。`npx eslint src/renderer/app.ts` PASS。`npm test` PASS（271件）。実スマホ画面での再確認は未実施。
- 手動確認: QR登録後、InputCheckでmocopi BLEを受信してゲーム側が `CONNECTED` / `PROCEED` になり、スマホ側が `ARE YOU READY?` を表示することを確認する。その状態でゲーム側をKeyboardへ切り替え、スマホ側が `CONNECTING` のまま残らず `ARE YOU READY?` を表示し続けることを確認する。
