Settings admin reset IPC

- 対象ステップ: scripts/windows/Settings.bat サーバー/このPC 全ユーザー・スコア記録リセット修正。
- 変更ファイル: `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/settings.ts`, `src/renderer/settings.css`, `scripts/build.mjs`, `docs/verification_checklist.md`, `docs/runs/20260709-settings-admin-reset-ipc.md`。
- 採用した判断: Settings renderer から `https://score.example.com/api/admin-reset` へ直接 `fetch` せず、preload の限定API `settingsAdminReset` から Main IPC 経由でPOSTする。Main側では `Content-Type: application/json` と確認文字列 `DELETE_ALL_HAKKEI_DATA` を固定し、成功後にRendererがこのPCのlocalStorageランキングを削除する。削除確認は `window.prompt` ではなく、Settings画面内の入力欄と有効化式の実行ボタンで行う。ビルド時の動画/画像/音声コピーは既存ファイルを上書きしない。
- 理由・根拠: `settings.html` のCSPは `default-src 'self'` で外部HTTPS通信を許可していないため、Renderer直fetchはクリック後にブロックされる。既存の `registered-users:list` も Main がサーバー通信を担当しており、preloadは限定APIだけを公開するという `AGENTS.md` 5.2 の境界に合う。Electronのnative promptは環境差で操作不能に見える可能性があるため、通常DOM入力に寄せる。アプリ起動中は `dist/renderer/sounds/BGM/main_bgm.wav` がロックされ、Settings起動前のbuildがEBUSYで止まることがあるため、静的メディアは既存ファイルを再コピーしない。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。本番 `/api/admin-reset` は実データ削除を伴うため自動実行は未実施。
- 手動確認: `scripts/windows/Settings.bat` を起動し、「ランキング記録」内の「サーバーも含めて全削除」入力欄に `DELETE_ALL_HAKKEI_DATA` を入力する。右側の「実行」ボタンが有効になったらクリックし、成功時に「サーバーとこのPCのユーザー/スコア記録をすべてリセットしました」と表示され、登録ユーザー/プレイ履歴が0になることを確認する。失敗時は同じ画面の赤いステータスに登録サーバーのHTTPステータスまたは通信エラーが出る。
- 残課題: 本番データを消してよいタイミングでのみ手動確認する。

## 追加: player registry / ID採番対応

- 変更ファイル: `src/shared/types.ts`, `src/main/index.ts`, `src/renderer/settings.ts`, `docs/verification_checklist.md`, `docs/runs/20260709-settings-admin-reset-ipc.md`。
- 採用した判断: Settingsのサーバー全削除成功条件に `playersDeleted=true` を必須化する。表示文言は「ユーザー台帳/ID/スコア記録」へ更新し、削除後は次の新規ユーザーが `ID26001` から再採番されることを明記する。
- 理由・根拠: 現行サーバー正本は `session-entries` / `ranking-board` だけでなく `players.json` を含む。古いサーバー版で `playersDeleted` が返らない状態を成功扱いにすると、台帳とIDだけが残り、全削除後のID採番が期待とずれるため。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。temp dataで admin reset相当の `entries` / `players` / `ranking` 全削除後、次の `upsert_player_registry()` が `playerNumber=26001` を割り当てることを確認。公開APIは誤確認文字列でHTTP 400、`/api/players` 件数維持を確認。本番データ保護のため成功削除は未実施。
- 手動確認: 本番データを消してよいタイミングで `scripts/windows/Settings.bat` から `DELETE_ALL_HAKKEI_DATA` を入力して実行する。成功後、`https://score.example.com/api/players` と `/api/ranking-board` が空になり、次の新規QR登録で `ID26001` が表示されることを見る。
