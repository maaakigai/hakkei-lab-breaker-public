# P3b Dual Hand Punch

- 対象ステップ: v2 P3b dual-hand punch
- 変更ファイル: `src/renderer/hakkeiDetector.ts`，`src/renderer/app.ts`，`src/main/keyboardSampleGenerator.ts`，`src/renderer/diagnosticPanel.ts`，`src/renderer/staticHakkeiTest.ts`，`src/main/appConfig.ts`，`src/shared/configTypes.ts`，`config/score.config.json`，`SPEC.md`，関連 test
- 採用した判断: `HakkeiDetector.observe` は `MotionSample` ではなく手別の `HakkeiHandKinematics` を受ける形にした．Main 生成済みの位置，速度，加速度，`validForScore` を使い，Renderer で再計算しない責務分離を保つため．
- 採用した判断: `DualHakkeiDetector` を追加し，右手用と左手用の単手 detector を合成した．左右の単手検出時刻差が `dualHakkeiSyncWindowMs=200` 以内の場合だけ発勁検出にする．
- 採用した判断: 片手のみ，左手欠落，左右同期window外は検出にせず，通常の `hakkeiReadyTimeoutMs` で no-impact へ進める．弱発勁や片手fallbackは追加しない．
- 採用した判断: Hakkei raw は右手と左手の `forwardVelocityPeak`，`forwardAccelerationPeak`，`forwardDisplacement` の平均値にした．左右両手パンチを1つの発勁rawへ畳み込むため．
- 採用した判断: Keyboard の Enter は左右両手へ同じ前方pulseを入れる．Space は右手，KeyL は左手の charge 挙動として維持した．
- 理由・根拠: P3b ticket の「両手同期検出」「片手不可」「raw平均」「keyboard Enter 両手化」に合わせた．`SPEC.md` §13.6 と config 契約も同時更新した．P3c の phase rename は未着手．
- 確認結果: `npm.cmd run typecheck` 成功．
- 確認結果: `npm.cmd run lint` 成功．
- 確認結果: `npm.cmd test` 成功，116 tests pass．
- 確認結果: `npm.cmd run build` 成功．
- 注意: Node の `MODULE_TYPELESS_PACKAGE_JSON` warning は既存警告．失敗なし．
- 残課題: P3c phase rename．
