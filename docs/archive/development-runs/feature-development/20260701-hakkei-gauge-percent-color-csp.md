# Run: 発勁エネルギーゲージ `%` 表示の割合色修正

- 対象ステップ: M12 UI・演出調整 / Charge HUD 表示修正
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `docs/verification_checklist_v2_ble.md`
- 採用した判断: `%` 表示をHTML `span style="..."` からSVG `text` に変更し、割合に応じた `fill` と glow の `flood-color` をSVG属性で指定する。
- 理由・根拠: RendererのCSPは `style-src 'self'` で、HTML文字列中のinline styleは拒否される。既存のゲージ塗り幅もSVG `rect width` 属性でCSPを回避しているため、同じ方針でセキュリティ設定を緩めずに動的表示を成立させる。
- 確認結果: `npm run typecheck` PASS、`npm run build` PASS、`npm test -- --test-name-pattern=state-machine` PASS（28 tests）。`src/renderer` と `dist/renderer` から旧 `%` 表示のinline styleと `--gauge-value-color` 参照が消え、`hakkei-gauge-value-svg` が出力されることを確認。
- 手動確認: `npm run dev:debug` → Keyboard → Chargeへ進み、Space連打で `%` 表示が水色から黄色、赤系へ変化することを確認する。DevTools consoleにCSPのinline style拒否が新規に出ないことを見る。
- 残課題: 実機BLEでの見え方確認は未実施。
