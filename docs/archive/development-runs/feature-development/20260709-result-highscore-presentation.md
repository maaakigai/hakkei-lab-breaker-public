# Result high score presentation

- 対象ステップ: Result画面のHigh Score更新演出を強化する。
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `docs/verification_checklist.md`, `docs/runs/20260709-result-highscore-presentation.md`。
- 採用した判断: High Score更新時は、`TOTAL DAMAGE` 金額の直下に `NEW HIGH SCORE` だけを表示する。旧スコア、新スコア、補助文はResult画面には出さない。
- 理由・根拠: Result画面の主役は今回の `TOTAL DAMAGE` であり、High Scoreは金額に対する短い補足として扱う。旧スコア/新スコア比較を別カードで出すと、表示情報が増えすぎて損害額と競合するため。
- 採用した判断: Ranking Board順位はResultに出さず、High Score演出にも順位情報を含めない。
- 理由・根拠: High Scoreは自己ベスト、Ranking Boardは自己ベスト順位、Resultの大きな数値は今回スコアであり、同じ画面で順位を混ぜると現在スコアの順位に見えやすいため。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。
- 手動確認: High Score更新時、Resultの `TOTAL DAMAGE` 金額直下に `NEW HIGH SCORE` だけが表示されることを見る。High Score更新なしでは通知が出ないこと、狭幅でも文字がはみ出さないことを確認する。
