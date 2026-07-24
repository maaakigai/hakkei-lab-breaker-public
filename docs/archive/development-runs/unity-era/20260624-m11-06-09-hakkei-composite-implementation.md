# M11-06〜09 発勁複合判定と windowed HakkeiScore

- 対象ステップ: M11-06〜09．
- 変更ファイル: `src/renderer/hakkeiDetector.ts`，`src/renderer/app.ts`，`src/renderer/playAccumulator.ts`，`src/renderer/staticHakkeiTest.ts`，`src/main/keyboardSampleGenerator.ts`，関連テスト，`HUMAN_TEST_GUIDE_JA.md`．
- 採用: HakkeiDetector が `validForScore=true` の sample を前方向へ射影した過去 `hakkeiWindowMs` の window として保持し，検出 sample を終端に速度ピーク，加速度ピーク，変位を返す．
- 理由・根拠: SPEC.md §13.6 は速度，加速度，移動量，cooldown の全条件を必須とし，§14.3 は未来 sample を待たない検出 sample 終端の window を score 入力に指定するため．Renderer は Main 生成済みの velocity と acceleration を射影するだけにして，AGENTS.md §1.1 と §6 の責務境界を維持した．
- 採用: Enter の疑似前進を設定済みの距離と時間による ease-in pulse に変更した．
- 理由・根拠: 旧 ease-out pulse は加速度が正になる初回 sample で変位条件を満たさず，変位条件を満たす sample では加速度が負になるため，複合条件では Gate D2 の keyboard fallback が発火しない．変更後は既存 `enterForwardDisplacementM` と `enterDurationMs` だけから速度，加速度，変位が同時に成立する区間を生成する．
- 確認: `npm run typecheck`，`npm run lint`，`npm test`，`npm run build` がすべて成功．test は90件 pass，fail 0．静止，横振り，各条件不足，invalid sample，cooldown，window 境界，Keyboard Enter 回帰を追加確認した．
- 残課題: 実 Unity Bridge を使う Gate D1 の人体入力確認は未実施．実機で calibration forwardVector と閾値の妥当性を記録する．
