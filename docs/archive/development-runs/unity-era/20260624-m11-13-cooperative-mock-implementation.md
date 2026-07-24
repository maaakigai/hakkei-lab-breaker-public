# M11-13 協調 mock モード

- 対象ステップ: M11-13．
- 変更ファイル: `scripts/mock-unity.mjs`，`scripts/mock-unity-calib-profile.mjs`，`package.json`，`test/mock-unity-calib-profile.test.mjs`，`test/smoke.test.mjs`，`HUMAN_TEST_GUIDE_JA.md`．
- 採用: `--calib` は app timer，`CALIB`，`input.config.json`，`score.config.json` から決定的な周期 profile を作る．位置とheartbeatだけをUDP送信し，velocity，加速度，filter，validityはMainの既存経路に任せる．
- 理由・根拠: AGENTS.md §1.1と§6の責務分離を維持しつつ，Calibrationのdiscard，neutral，forwardと，SPEC.md §13.6の前方向速度・加速度・変位の複合条件を実機なしで回帰できるため．
- 採用: 発勁pulseは短い後方windup，正加速度の前進，follow-throughを組み合わせる位置変化とし，設定値の閾値に対してMainのEMA後にも加速度条件を満たす余裕を取る．
- 理由・根拠: raw位置差分のみではなく，`MotionSampleBuilder` と `HakkeiDetector` を通すテストで複合検出を確認した．位相オフセットと軽いdtジッタを含む5通りの試行で，最悪のfiltered forwardAcceleration peakは `13.680050833671164 m/s²` となり，閾値 `8.0 m/s²` の1.5倍以上を満たした．
- 確認: `node --test test/mock-unity-calib-profile.test.mjs` で局面，差分近似，Main経路の複合検出がすべてPASS．`node scripts/mock-unity.mjs --calib --port 45101` を2秒起動し，config読込とUDP送信開始を確認．終了はtimeoutによるもの．
- 手動確認: `npm run dev` と `npm run mock:unity:calib` を使う全経路操作は未実施．Electron画面操作が必要なため，HUMAN_TEST_GUIDE_JA.md §6.2.1を次回の手動確認手順として追加．
- 残課題: 実際の画面上でMock Unity Bridge modeを選び，CalibrationからResultまで到達することを記録する．MockはGate B2/D1の代替にしない．
