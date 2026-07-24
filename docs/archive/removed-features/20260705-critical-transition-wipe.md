# Critical transition wipe

- 対象ステップ: Critical動画切替トランジション
- 変更ファイル: `config/app.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`, `test/config-loader.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用: Lv5動画からCritical動画へ切り替わる場合だけ、VideoPlayback内の再生キューで左から右へ暗転し、暗転が覆った後にCritical動画へ差し替え、左から右へ暗転解除する。開始時に `SFX/Trans.mp3` を単発再生し、暗転解除開始付近で `extra_bgm.wav` へ切り替える。
- 理由・根拠: 既存実装は `VideoPlayback` 状態内で `Lv動画 -> Critical動画 -> Result` をキュー再生しているため、状態追加ではなくキュー切替にだけ演出を挟むのが最小変更。暗転が覆い切ってから動画要素を差し替えることで、動画停止・次動画mountの瞬間を見せない。
- 確認結果: `npm run typecheck` 成功。`node --test test/config-loader.test.mjs test/audio-manager.test.mjs` 成功（12 tests pass、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`assets/Sound/SFX/Trans.mp3` の存在を確認。`npm run build` はesbuild出力後、起動中のElectronが `dist/renderer/sounds/BGM/main_bgm.wav` を掴んでいたため静的コピーで `EBUSY` 停止。`dist/renderer/sounds/SFX/Trans.mp3` は存在確認済み。
- 手動確認: Debug UIでCritical強制モードを使い、Lv5動画終了時に `Trans.mp3`、左から右の暗転/解除、解除開始付近の `extra_bgm.wav` 開始を確認する。
- 残課題: ワイプ速度と `Trans.mp3` の音量は会場スクリーン・スピーカーで最終調整する。
