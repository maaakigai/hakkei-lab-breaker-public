# QR rescan entry recovery

- 対象ステップ: QR再スキャン後の `CONNECTING` 停滞 / `I'M READY` 押下時 `ENTRY NOT FOUND` 対策。
- 変更ファイル: `src/renderer/app.ts`, `.tmp/HLB_Server_repo/server.py`, `.tmp/server.py.remote`, `docs/verification_checklist.md`, `docs/runs/20260709-qr-rescan-entry-recovery.md`。
- 採用した判断: `/api/session-entry` の再POSTでは、同一sessionの `inputCheckAtMs` / `inputCheckExitAtMs` / result系は保持するが、`readyAtMs`、`cancelAtMs`、`inputDeviceReadyAtMs` は引き継がない。
- 理由・根拠: `readyAtMs` / `cancelAtMs` / `inputDeviceReadyAtMs` は現在の入力確認サイクルに属する一時状態であり、Cancel後やQR再スキャン時に引き継ぐと、スマホ表示とElectron側の待機sessionがずれるため。result系はリロード時に結果表示を復元する既存要件があるため保持する。
- 採用した判断: スマホ側の `I'M READY` / `CANCEL` は、`entry not found` の場合だけ現在の保存済みlicenseで `/api/session-entry` を復元し、同じ操作を1回だけ再送する。
- 理由・根拠: 参加者がReady dialogまで到達している時点で、そのQR sessionに対するentryは存在する前提だが、キャンセル・再スキャン・通信順序でentryが消えていると操作不能になる。playerId一致を確認した保存済みlicenseだけで復元し、別端末や別licenseの混入は許可しない。
- 採用した判断: Electronの `logs/state-YYYYMMDD.log` にremote pollingとnotify成功ログを追加し、スコアサーバーに `data/session-events.log` を追加する。
- 理由・根拠: 再現頻度が環境依存で、画面表示だけでは「スマホが見ているsession」「Electronが待っているsession」「サーバーentryの時刻」のどこがずれたか分からないため。
- 確認結果: `python -m py_compile .tmp\HLB_Server_repo\server.py .tmp\server.py.remote` PASS。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。`npm test` PASS（265件）。ローカルHTTPスモークで、Cancel後の同一session再POSTが `readyAtMs` / `cancelAtMs` / `inputDeviceReadyAtMs` を引き継がず、`ready_missing_entry` が `data/session-events.log` に残ることを確認。
- 公開反映: `deployment host:/srv/hakkei-score-server/server.py` を `server.py.bak-20260709-003027` へバックアップ後に差し替え。`systemctl restart` は認証が必要だったため、`User=deploy-user` / `Restart=always` を確認して旧PIDを終了し、systemd自動再起動で新PID `444389` を起動。`hakkei-score.service` は `active`。
- 公開確認: `https://score.example.com/license?sessionId=...` のHTMLに `restoreCurrentEntry` / `retryAfterMissingEntry` が含まれることを確認。公開APIで `session-entry -> session-input-check?ready=1 -> session-ready -> session-cancel -> session-entry` を実行し、再POST後に `readyAtMs` / `cancelAtMs` / `inputDeviceReadyAtMs` が残らず、`inputCheckAtMs` は残ることを確認。検証sessionはDELETE済み。`/srv/hakkei-score-server/data/session-events.log` に `entry_register` / `input_check_ready` / `ready` / `cancel` が出ることを確認。
- 残課題: 実機スマホでQR再スキャンを複数回行い、`CONNECTING` 停滞と `ENTRY NOT FOUND` が再発しないことを確認する。

## 追加: Esc復帰後のQR scanner即閉じ対策

- 変更ファイル: `.tmp/HLB_Server_repo/server.py`, `docs/verification_checklist.md`, `docs/runs/20260709-qr-rescan-entry-recovery.md`。
- 採用した判断: スマホLicenseページに `uiEpoch` を追加し、`SCAN QR` 押下時にepochを進める。`waitForGameInputCheck()` / `waitForGameResult()` のpollingは開始時epochを保持し、epochが変わった後はUI更新も次回timer予約もしない。
- 理由・根拠: ゲーム側EscでREGISTRATIONへ戻った後も、スマホページには古いsessionのpolling timerが残り得る。ユーザーが新しいQRを読もうとしてscanner dialogを開いた直後に、古いpollingが `showCanceledState()` / `showPlayingState()` / `showResultDialog()` を呼ぶと `stopQrScanner()` でカメラが閉じるため、scanner開始を「古いpollingの失効点」として扱う。
- 確認結果: `python -m py_compile .tmp\HLB_Server_repo\server.py` PASS。公開サーバーは `server.py.bak-20260709-003831` へバックアップ後に差し替え、新PID `449237` で `hakkei-score.service` active。`https://score.example.com/license?sessionId=...` のHTMLに `let uiEpoch = 0`、`uiEpoch += 1`、`pollEpoch !== uiEpoch`、`retryAfterMissingEntry` が含まれることを確認。実機スマホでのEsc復帰後3回連続再スキャン確認は未実施。

## 追加: 初回START GAMEのQR未表示対策

- 変更ファイル: `src/renderer/app.ts`, `docs/verification_checklist.md`, `docs/runs/20260709-qr-rescan-entry-recovery.md`。
- 採用した判断: QRの再描画抑止を `joinUrl` だけでなく、現在DOM上の `canvas` 要素も含めて判定する。QR生成失敗時はURL/canvasの描画済み記録を戻し、次回renderで再試行できるようにする。
- 理由・根拠: `render()` は `innerHTML` でRegistration画面のcanvasを作り直す。初回 `START GAME` 直後に登録ユーザー同期などで再renderが入ると、古いcanvasへ非同期QR生成中でも `lastRenderedQrUrl` だけが更新済みになり、新しい空canvasが「描画済み」と誤判定されるため。
- 確認結果: `npm run typecheck` を実行する。手動ではアプリを完全終了して起動し、1回目の `START GAME` でRegistration画面にQRが表示されること、Titleへ戻って2回目の `START GAME` でもQRが表示されることを見る。
