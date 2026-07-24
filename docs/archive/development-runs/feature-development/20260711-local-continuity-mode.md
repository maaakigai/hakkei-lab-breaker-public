# 2026-07-11 local continuity mode

- 対象: サーバー停止時もゲームとmocopi BLEプレイを継続するバックアップ経路。
- 変更: runtime localMode、Main/Renderer通信gate、`scripts/windows/release_local.bat`、通常モードの背景同期、ローカル登録/ランキング表示、仕様・手動確認。
- 採用: 自動fallbackではなく専用batによる明示切替。同期は登録画面、VideoPlayback開始、Result開始で非同期実行。
- 理由: 一時的な通信揺れで運用モードが変わるのを避ける。動画/Resultは操作入力が少なく同期に適する一方、awaitせず演出と進行を止めない。既存localStorageを単一のローカルキャッシュ兼記録として再利用し、二重保存の不整合を避ける。
- 根拠: `SPEC.md` の「2026-07-11 ローカル継続運用契約」、既存のrankingStoreとserver import処理、MocopiBLEがサーバー非依存である固定前提。
- 確認: `npm run typecheck` PASS、`npm run lint` PASS、`npm test` 281/281 PASS（機能テスト追加前）。GUI手動確認は未実施。
- 残課題: ローカルモード中に作られたスコアを復旧後サーバーへ送るoutboxは未実装。重複/競合規則が未確定のため推測実装しない。
