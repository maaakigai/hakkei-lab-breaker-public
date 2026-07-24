# 接待モード: Shiftでセッション限定のチャージ100%基準を下げる

- 対象ステップ: scripts/windows/Settings.bat で変更できる接待モード値と、Shiftによるセッション限定ON/OFF。
- 変更ファイル: `config/score.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/renderer/settings.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`, `test/config-loader.test.mjs`, `test/punch-core.test.mjs`, `docs/verification_checklist_v2_ble.md`。
- 採用した判断: 通常の `punch.chargeReadyThreshold` は維持し、接待モード専用に `punch.hospitalityChargeReadyThreshold` を追加した。初期値は `6000`。
- 理由・根拠: 通常設定を上書きすると展示中に戻し忘れる危険がある。セッション内フラグで `currentChargeReady()` の分母だけを差し替えると、Main生成の `PunchInputSample`、BLE入力、keyboard入力、パンチ検出しきい値を変えずに、表示100%とスコア曲線の割合だけを調整できる。
- 採用した判断: Shiftは押下ごとのトグルにし、Title / Registration / InputCheck / Ready / Charge / HakkeiReadyで有効にする。Title復帰、`R` reset、`Esc`、Result後のfinish/replay、エラー復帰で自動解除する。
- 理由・根拠: 操作担当がプレイ前に一度だけ押せる方が運用しやすい。押しっぱなし方式はプレイ中のキーボード入力や展示操作と競合しやすい。次の参加者へ接待モードが残るのは避ける必要がある。
- 採用した判断: keyboard入力時は従来どおり `chargeReadyThresholdKeyboard` を使い、接待モードはBLE側の表示100%基準にだけ効かせる。
- 理由・根拠: keyboardは発表継続用fallbackで、Space数回で満タンになる別スケールの設定を持つ。ここへ6000を適用するとkeyboard fallbackが壊れる。
- 確認結果: `test/config-loader.test.mjs` に接待モード設定の読み込み確認を追加。`test/punch-core.test.mjs` に同じ `chargeRaw` でも接待基準の方が `rightChargeScore` と `power` が上がる確認を追加。
- 手動確認（当時）:
  - `scripts/windows/Settings.bat` に専用基準値が表示され、保存後の再起動で反映される。
  - Title / Registration / InputCheckでShiftを押すと専用表示が出て、もう一度押すと解除される。
  - Result後のfinish/replay、`R`、`Esc`、エラー復帰で次セッションへ状態を残さない。

## 表示変更 2026-07-09

- 採用した判断: 接待モードON表示は上部の大きな `HOSPITALITY MODE` バナーを廃止し、左下に小さな半透明画像だけを表示する。
- 理由・根拠: 接待モードは操作担当向けの控えめな状態表示であり、プレイヤー画面の主演出やチャージHUDを邪魔しない必要がある。
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `assets/images/hospitality/`, `docs/verification_checklist_v2_ble.md`。

## 公開ポートフォリオ版での扱い

- 2026-07-24の公開整理で、接待モード本体、設定項目、専用画像を公開版から削除した。
- 上記の手動確認項目も現行チェックリストから削除し、この記録へ移した。
