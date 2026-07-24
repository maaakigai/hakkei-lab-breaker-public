# 20260705 critical BGM switch

- 対象ステップ: Critical動画再生時のBGM切替
- 変更ファイル: `config/app.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/renderer/app.ts`, `test/config-loader.test.mjs`, `test/audio-manager.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用: 通常BGMは `BGM/main_bgm.wav`、Critical動画/Result用BGMは `BGM/extra_bgm.wav`。Critical成立後もLv5/研究室破壊動画の再生中はmainを継続し、`selectedCriticalOutcome.videoFile` の再生開始直前にmainを停止してextraをloop再生する。Critical動画終了後のResultでもextraを維持し、Resultの `replay` / `finish` または中断操作でmainへ戻す。
- 理由・根拠: 既存実装は `VideoPlayback` 状態内の再生キューで `研究室破壊動画 → Critical動画 → Result` を実現しているため、状態追加ではなく再生対象fileで音声を同期するのが変更範囲を最小にできる。音声欠落は従来どおりwarning扱いで進行を止めない。
- 確認結果: Resultでもextraを維持する変更後に `npm run typecheck` PASS。`npm test` PASS（229 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`npm run build` PASS。`npm run lint` PASS。`dist/renderer/sounds/BGM/main_bgm.wav` と `dist/renderer/sounds/BGM/extra_bgm.wav` へのコピーを確認済み。
- 残課題: 実機スピーカーでmain/extraの音量差を手動調整する。
