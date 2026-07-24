# 20260705 settings BGM volume

- 対象ステップ: scripts/windows/Settings.bat でBGM音量を編集
- 変更ファイル: `src/shared/types.ts`, `src/main/appConfig.ts`, `src/main/index.ts`, `src/renderer/settings.ts`, `HUMAN_TEST_GUIDE_JA.md`
- 採用: Settings IPCの読み込みpayloadへ `app.config.json` を追加し、保存payloadでも任意の `app` を受ける。保存時は `validateApp()`、`validateScoreConfig()`、`validateCriticalConfig()` を通過した場合だけ各configへ書き戻す。設定画面には `audio.bgm.volume`、`audio.criticalBgm.volume`、`audio.chargeSound.volume` の数値入力を追加する。1が通常音量、1超はWeb Audio GainNodeで増幅する。
- 理由・根拠: BGM音量は `app.config.json` の音声契約に属するため、`score.config.json` へ混ぜず既存config境界を維持する。ゲーム側の反映は既存Settings GUIと同じく再起動後に統一する。
- 確認結果: `npm run typecheck` PASS。`npm test` PASS（229 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`npm run build` PASS。`npm run lint` PASS。
- 残課題: 会場スピーカーで通常BGMとCritical BGMの体感音量を手動調整する。
