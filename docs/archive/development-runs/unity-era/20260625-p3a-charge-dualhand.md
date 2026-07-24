# P3a Charge Dual Hand

- 対象ステップ: v2 P3a charge dual hand
- 変更ファイル: `src/renderer/playAccumulator.ts`，`src/renderer/app.ts`，`src/renderer/scoreCalculator.ts`，`src/renderer/resultPresenter.ts`，`src/main/keyboardSampleGenerator.ts`，`src/renderer/keyboardInput.ts`，`src/main/appConfig.ts`，`src/shared/types.ts`，`src/shared/configTypes.ts`，`config/input.config.json`，`config/score.config.json`，関連 test
- 採用した判断: charge は projection をやめ，担当手の `handPosition` の 3D path length `sum(|delta p|)` とした．`VerticalCharge` は right hand，`ForwardCharge` は left hand を担当する．state 名は変更していない．
- 採用した判断: `ScoreRawInput` と `ScoreBreakdown` は `rightChargeRaw` / `leftChargeRaw`，`rightChargeScore` / `leftChargeScore` へ改名した．`score.config.json` は `rightChargeMin/Max`，`leftChargeMin/Max`，`rightChargeNoiseThreshold`，`leftChargeNoiseThreshold` へ改名し，値は据え置いた．
- 採用した判断: keyboard は `leftChargeKey` を `input.config.json` に追加し，既定値は `KeyL` とした．Space は従来どおり right hand charge，Enter は従来どおり right hand forward pulse にした．
- 採用した判断: keyboard sample は `leftHand` を常に Main で生成する．Renderer は keydown/keyup を送るだけで，left hand 座標や validity は再計算しない．
- 理由・根拠: P3a ticket の「フェーズ担当手の 3D 総移動量」「VerticalCharge=右手」「ForwardCharge=左手」「発勁は単手のまま」「keyboard 完走維持」に合わせた．P3b/c は未着手．
- 確認結果: `npm.cmd run typecheck` 成功．
- 確認結果: `npm.cmd run lint` 成功．
- 確認結果: `npm.cmd test` 成功，111 tests pass．
- 確認結果: `npm.cmd run build` 成功．
- 注意: Node の `MODULE_TYPELESS_PACKAGE_JSON` warning は既存警告．失敗なし．
- 残課題: 両手パンチ検出は P3b，phase rename は P3c．
