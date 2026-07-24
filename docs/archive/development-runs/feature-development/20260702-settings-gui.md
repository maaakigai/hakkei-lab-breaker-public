# Settings GUI

- 対象ステップ: GUI config editor / scripts/windows/Settings.bat
- 変更ファイル: `scripts/windows/Settings.bat`, `package.json`, `scripts/build.mjs`, `src/main/index.ts`, `src/main/appConfig.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/settings.html`, `src/renderer/settings.ts`, `src/renderer/settings.css`, `HUMAN_TEST_GUIDE_JA.md`
- 採用した判断: 通常ゲーム画面とは別に `--settings` 起動モードを追加し、UDP receiver / BLE sidecar を起動せず設定画面だけを開く。初期編集対象は `score.config.json` の `punch` / `power.yenCoefficient` / `resultDamageReport.items` に限定する。
- 理由・根拠: 発勁上限調整は `score.config.json` の `punch.punchMax` 変更で完結するが、今後の被害報告アイテム編集にも同じ画面を拡張できるよう、Renderer側は `SettingsSection` のフィールド定義と被害報告テーブルで構成した。保存はMain IPC経由に限定し、`validateScoreConfig()` 通過後だけファイルへ書くことで設定契約を壊さない。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npm test -- --test-name-pattern=config` PASS（29 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning は継続）。
- 手動確認: `scripts/windows/Settings.bat` を起動し、発勁スコア 100% 強度や被害報告アイテムを変更して保存する。保存成功表示後、`config/score.config.json` に反映されることを見る。ゲーム側への反映は再起動後。
- 残課題: 現時点のGUI対象は `score.config.json` の一部。今後 `app.config.json`、動画Lv表、critical outcome などを足す場合は同じIPCにファイル別saveを追加する。

## 追記: 被害報告アイテムの説明追加

- 採用した判断: 被害報告テーブルの上に、個数計算式、入力例、各列の説明カードを表示する。
- 理由・根拠: `resultPresenter.ts` の実装では `baseCount + videoLevel * levelFactor + baseDamageYen * damageYenFactor` に `varianceRatio` を掛け、`maxCount` で打ち止める。列名だけでは `金額係数` や `ブレ` の意味が分かりにくいため、GUI内で編集前に判断できる説明を出す。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npm run lint` PASS。

## 追記: Sランク時Critical率

- 採用した判断: `critical.config.json` に `baseRateOnSRank` を追加し、通常スコア確定後に `rank === "S"` かつ発勁検出済みの時だけ抽選する。Settings GUIでは `Critical` セクションに 0〜1 の比率として表示・保存する。
- 理由・根拠: Criticalは通常スコアの派生演出と被害ボーナスであり、Sランク未満に混ぜるとLv/Rankの意味が崩れる。既存のCritical outcome、動画、被害アイテムは `critical.config.json` に分離済みなので、基本発生率も同じファイルに置く。
- 確認結果: `npm run typecheck` PASS。`npm run build` PASS。`npm test -- --test-name-pattern=config` PASS。

## 追記: Lv別動画フォルダとランダム再生

- 採用した判断: `score.config.json` の `videoLevels[].file` を `folder` 参照へ変更し、Mainのconfig load時に `assets/videos/<folder>/*.mp4` を列挙して `files` 候補へ展開する。Rendererは該当Lvの候補からプレイごとに1本をランダム選択する。
- 理由・根拠: Rendererは安全上ファイルシステムを直接読まないため、フォルダ列挙はMain側で行う。configにはフォルダ名だけを置けば、今後 `LV5` へ動画を追加した時にJSONへ個別ファイル名を足さず候補化できる。
- 変更した配置: `assets/videos/LV0`〜`LV5` を作成し、既存Lv動画を各フォルダへ移動。`LV5` は `dust_E_allin_seed7777.mp4`、`fx_hadoken_seed2026.mp4`、`lv5_total_destruction.mp4` が候補。
- 確認結果: `npm run lint` PASS。`npm run typecheck` PASS。`npm run build` PASS。`npm test -- --test-name-pattern=config` PASS。

## 追記: SuperCritical

- 採用した判断: `critical.config.json` に `superCritical` を追加し、通常Critical成立後だけ `rateAfterCritical` で追加抽選する。強制確認用に `Ctrl+Shift+Enter` を追加し、CriticalとSuperCriticalを同時に成立させる。
- 理由・根拠: SuperCriticalはCriticalの上位演出であり、Critical未成立から直接出すと確率階層と演出順が分かりにくい。動画は `assets/videos/SuperCriticalVideo/*.mp4` をMainが列挙し、Critical動画の後に連続再生する。1,568京円はJavaScriptの安全整数上限を超えるため、SuperCriticalボーナスは文字列/BigIntで加算し、Resultには正確な桁区切りテキストとして表示する。
- 初期設定: `rateAfterCritical=0.05`、動画フォルダ `SuperCriticalVideo`、アイテム `月 1件`、加算額 `15680000000000000000` 円。
- 確認結果: `npm run typecheck` PASS。`npm run lint` PASS。`npm test -- --test-name-pattern=config` PASS。`npm run build` PASS。

## 追記: SuperCritical Result表示修正

- 採用した判断: SuperCriticalバッジを `SUPER CRITICAL: <対象名>` とし、損害額は `damageYenText` の整数文字列をBigIntで補間してカウントアップする。損害額表示は幅をviewport基準に広げ、中央揃え・tabular nums・長桁用font-sizeで固定する。
- 理由・根拠: `1,568京円` 級の値はNumber演算だと安全整数を超えるため、文字列/BigIntのまま演出する必要がある。表示幅は数字の増加で左端基準に見えると中央から外れるため、固定幅ラッパー内で中央寄せする。
- 確認結果: `npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
