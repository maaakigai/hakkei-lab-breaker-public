# Critical video outcomes

- 対象ステップ: Critical映像候補追加
- 変更ファイル: `config/critical.config.json`, `test/config-loader.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用した判断: 当時は実在施設を対象にした複数の映像候補を等重みで追加した。権利・公開表現の観点から、該当映像、施設名、金額、設定は公開版からすべて削除した。
- 理由・根拠: Criticalは通常スコアとは分離された特殊演出と被害ボーナスであり、`src/renderer/app.ts` は `CriticalOutcomeConfig` の候補から抽選して `videoFile` と `damageItems` を使う実装になっている。映像候補の追加はアプリロジックではなく設定の拡張に閉じるのが最小変更。
- 確認結果: `npm run typecheck` 成功。`node --test test/config-loader.test.mjs` 成功（11 tests pass）。追加4ファイルが `assets/videos/CriticalVideo/` に存在することを確認。
- 手動確認: Debug UIでCritical強制モードを複数回実行し、追加候補の動画と被害報告が表示されることを見る。
- 残課題: ランダム抽選のため、特定候補を1回で指定再生するDebug操作は未追加。
