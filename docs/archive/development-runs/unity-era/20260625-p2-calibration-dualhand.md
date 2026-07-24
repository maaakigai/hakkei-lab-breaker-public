# P2 Calibration Dual Hand

- 対象ステップ: v2 P2 Calibration 両手化
- 変更ファイル: `src/shared/types.ts`，`src/renderer/calibrationManager.ts`，`test/calibration-manager.test.mjs`
- 採用した判断: `CalibrationResult` に `leftNeutralHandPosition: Vec3 | null` を追加した．右手の既存 `neutralHandPositionRaw`，`forwardVector`，`upVector` は維持した．
- 採用した判断: 左手 neutral は neutral フェーズ中に `sample.leftHand?.validForCalibration === true` の場合だけ `leftHand.handPosition` を平均する．左手が無い場合，または unavailable の場合は `null` とし，右手 calibration の成功条件には使わない．
- 理由・根拠: P2 チケットの「左手は v2 入力時のみ取得」，「v1/左手 unavailable は `leftNeutral=null` で右手 calibration は従来どおり成立」，「playAccumulator / hakkeiDetector / scoreCalculator は触らない」に合わせた．forwardVector は体の共通1本のまま維持し，左手専用 forward は作っていない．
- 確認結果: `npm.cmd run typecheck` 成功．
- 確認結果: `npm.cmd run lint` 成功．
- 確認結果: `npm.cmd test` 成功，110 tests pass．
- 確認結果: `npm.cmd run build` 成功．
- 注意: PowerShell の実行ポリシーで `npm.ps1` は起動できなかったため，Windows の `npm.cmd` で同等コマンドを実行した．
- 残課題: 左手 neutral の利用は P3 以降．今回の変更ではスコア経路や発勁判定には未接続．
