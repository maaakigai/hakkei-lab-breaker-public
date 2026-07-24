# 20260705 startup BGM

- 対象ステップ: 起動時BGM追加
- 変更ファイル: `config/app.config.json`, `src/renderer/audioManager.ts`, `src/renderer/app.ts`, `src/main/appConfig.ts`, `src/main/index.ts`, `src/shared/configTypes.ts`, `scripts/build.mjs`, `test/config-loader.test.mjs`, `test/audio-manager.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用: `app.config.audio.bgm.file="BGM/main_bgm.wav"` を `dist/renderer/sounds/BGM/main_bgm.wav` に解決し、Renderer起動後に `HTMLAudioElement` で `loop=true` 再生する。音量は `0.45`。Electron Mainで `autoplay-policy=no-user-gesture-required` を設定する。
- 理由・根拠: 音声asset欠落は `AUDIO_MISSING` warningに留め、ゲーム進行を止めない契約（`SPEC.md` 0.19）に合わせる。動画と同じくRenderer同階層へassetをコピーすることで、packaged後も `self` 参照で解決できる。
- 確認結果: `npm run typecheck` PASS。`npm test` PASS（229 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`npm run build` PASS。`dist/renderer/sounds/BGM/main_bgm.wav` へのコピーを確認。
- 残課題: 実機スピーカー音量と会場音量は手動確認で調整する。
