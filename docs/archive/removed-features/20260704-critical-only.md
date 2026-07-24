# Critical only

- 対象ステップ: SuperCritical廃止 / Critical一本化
- 変更ファイル: `config/critical.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/renderer/app.ts`, `src/renderer/keyboardInput.ts`, `src/renderer/resultPresenter.ts`, `src/renderer/settings.ts`, `src/renderer/styles.css`, `test/config-loader.test.mjs`, `test/yen-formatter.test.mjs`, `docs/CURRENT_USAGE_JA.md`, `HUMAN_TEST_GUIDE_JA.md`, `THIRD_PARTY_NOTICES.md`, `assets/videos/SuperCriticalVideo/moon.mp4`
- 採用した判断: CriticalはSランク時の基本抽選と強制モードを残し、SuperCriticalの設定スキーマ、追加抽選、Shift強制モード、追加動画、専用Result表示、専用Canvas実装、専用動画アセットを削除した。
- 理由・根拠: ユーザー指定により上位演出を廃止し、Criticalだけを本線の特殊演出として扱う。設定GUIとvalidatorからも項目を外すことで、存在しない抽選率や動画フォルダを編集・検証しない状態にした。
- 確認結果: `npm run typecheck` 成功。`npm run lint` 成功。`npm run build` 成功。`npm test` 成功（224 tests）。
- 追記: `config/score.config.json` の動画フォルダ参照を現在の `assets/videos/LV1`〜`LV5` に合わせた。Lv0は動画を廃止し、VideoPlaybackで背景画像 `assets/images/lab-backgrounds/lab-main-front-16x9-privacy.png` を表示してResultへ進める。
- 追記2: HakkeiReadyの `構えて` カウント中は発勁判定しない。Keyboard Enterの保留発火を削除し、Critical強制発勁も `hakkeiArmed=true` 後だけ受け付ける。
- 追記3: Critical成立時の損害額表示を、旧SuperCriticalで使っていた5000兆円風Canvas描画へ移した。通常Resultの金額表示は従来のテキスト表示のまま。
- 残課題: 過去の `docs/runs/20260702-*` と `docs/runs/20260703-*` は当時の実装記録として残す。
