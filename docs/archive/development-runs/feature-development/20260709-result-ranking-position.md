# Result ranking position

- 対象ステップ: Result画面のRanking Board順位表示を取り下げ、Ranking Board同期だけを残す。
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `docs/verification_checklist.md`, `docs/runs/20260709-result-ranking-position.md`。
- 採用した判断: Result画面のRanking Board順位表示は削除する。`VideoPlayback` へ入った時点でスコアをローカル保存し、`POST /api/ranking-score` を開始する処理は残す。
- 理由・根拠: Result画面は今回の損害額を見せる画面であり、Ranking Boardは各プレイヤーのHigh Score順位を見せる画面である。今回スコアの横に自己ベスト基準の順位を出すと、現在プレイの順位に見えて混乱するため、順位表示はRanking Boardへ集約する。一方で動画再生中のサーバー同期はResult後にRanking Boardを開いたとき最新High Scoreを見せるために有効なので残す。
- 採用した判断: スマホ側の `RESULT` 通知は `VideoPlayback` では送らず、ElectronがResult画面へ到達した時だけ一度送る。
- 理由・根拠: Ranking同期は表示準備だが、スマホRESULTは利用者へ結果到達を知らせる画面遷移なので、動画再生中に先出しすると本体画面とスマホ画面の状態がずれるため。
- 採用した判断: Ranking同期完了でResultを再描画しても、Result画面には順位枠を出さない。再描画時のダメージ表示は最終値へ即時同期し、ダメージカウントとResult音声SFXを再始動しない。
- 理由・根拠: サーバー同期完了は内部状態更新であり、Result上の見た目を変えない。同期完了のたびに演出カウントや音声が二重に走ると操作担当者にはバグに見えるため。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`node --test test/ranking-store.test.mjs` PASS。
- 手動確認: プレイしてResultへ到達し、Result画面にRanking Board順位が表示されないことを見る。その後TitleのRanking Boardを開き、同じプレイヤーのHigh ScoreがサーバーRanking Boardへ反映されていることを確認する。
- 2026-07-10追記: 今回スコア順位の表示は引き続き出さない。自己ベスト順位の説明カードは `docs/runs/20260710-result-ranking-summary.md` で別途追加する。
