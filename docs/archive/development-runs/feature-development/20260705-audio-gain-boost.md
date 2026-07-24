# 20260705 audio gain boost

- 対象ステップ: 音量設定1.0超の増幅対応
- 変更ファイル: `src/renderer/audioManager.ts`, `src/main/appConfig.ts`, `src/renderer/settings.ts`, `test/config-loader.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`, `docs/runs/20260705-settings-bgm-volume.md`
- 採用: `HTMLAudioElement.volume` は1.0上限のため、Rendererで `AudioContext` / `GainNode` を挟み、音量設定を0〜3として扱う。Web Audio初期化に失敗した場合は従来どおりHTML audio volumeの0〜1へfallbackする。
- 理由・根拠: 「設定で1にしても小さい」問題は、標準volumeの上限に当たっているため。設定契約を拡張し、1を通常音量、1超をブーストにすることでSettings GUIだけで会場音量を調整できる。
- 確認結果: `npm run typecheck` PASS。`npm test` PASS（229 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`npm run build` PASS。`npm run lint` PASS。
- 残課題: 2〜3は素材によって音割れする可能性があるため、会場スピーカーで耳確認する。
