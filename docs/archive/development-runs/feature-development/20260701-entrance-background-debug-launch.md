Entrance background + debug launch split

- 対象: 起動時エントランス正式化、研究室背景の全画面化、Debug UI 起動分離。
- 変更ファイル: `package.json`, `scripts/windows/debug.bat`, `src/main/index.ts`, `src/main/appConfig.ts`, `src/shared/configTypes.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`, `test/config-loader.test.mjs`。
- 採用: 通常起動は `runtime.uiMode="release"`、`scripts/windows/debug.bat` / `npm run dev:debug` / `npm run start:debug` だけ `--debug-ui` 経由で `runtime.uiMode="debug"` にする。
- 理由: `config/*.json` を手動編集せず、発表・運用時は普通に起動するだけで正式UIになり、検証時だけクリック起動で開発UIを戻せるため。
- 採用: Release の初期入力は `mocopi-ble`、Debug の初期入力は既存 `app.defaultInputMode` を使う。
- 理由: 正式運用の主経路は mocopi BLE だが、Debug では従来の keyboard 起動を維持した方が確認しやすいため。
- 採用: 全状態の背景に `lab-main-front-16x9-privacy.png` を敷き、Title/InputCheck/Result/Error は暗め overlay、Ready/Charge/HakkeiReady/ImpactDelay/VideoPlayback は薄い overlay にする。
- 理由: 非ゲーム画面は視認性を優先し、ゲーム中は研究室そのものを見せて「この場所を壊す」体験を維持するため。
- 確認: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` は成功。
- 確認: Release 起動では statebar/動画確認/録画再生/実験ウィザードが非表示、背景画像が `dist/renderer/images/lab-backgrounds/lab-main-front-16x9-privacy.png` から表示されることを DevTools Protocol で確認。
- 確認: Debug 起動では statebar、`Keyboard（debug）`、`None`、動画確認ボタンが表示されることを確認。
- 確認: Ready/Charge の overlay は `rgba(0, 0, 0, 0.08)` で、ゲーム中は研究室背景を見せる設定になっている。
- 追加採用: VideoPlayback は旧来の見出し/動画枠を出さず、背景レイヤーそのものを動画へ切り替える。
- 理由: 発勁後に別ウィンドウ風の `VideoPlayback` 画面を挟むと、研究室背景から破壊映像へ連続する体験が切れるため。
- 手動確認: Debug の動画Lv強制または通常フローで VideoPlayback に入り、画面全体が mp4 になり、Release では `VideoPlayback` 見出しや Lv バッジが出ないことを確認する。
- 追加採用: Lv5 の動画参照を `fx_hadoken_seed2026.mp4` に変更し、動画再生確認は明示がない限り Lv5 を使う。
- 理由: `lv0_no_damage.mp4`〜`lv5_total_destruction.mp4` は小容量の暫定素材で、Lv5 確認には実素材 `fx_hadoken_seed2026.mp4` を使う方が背景動画化の確認に適しているため。
- 追加採用: Debug のLv強制は直接 VideoPlayback へ飛ばさず、強制Lvを予約して `InputCheck → Ready → Charge → HakkeiReady → ImpactDelay → VideoPlayback` の通常フローを通す。
- 理由: Lv強制時にも発勁前後の演出・状態遷移・背景動画切替を確認できるようにするため。`VIDEO_MISSING` 確認だけはエラー再現用として直接 VideoPlayback に残す。
- 残課題: 実機 BLE 接続時の Release 画面確認。

## 追記: Ready入場時の背景フェード

- 採用: `screen-Ready::after` に 560ms の `gameplayBrightenIn` を追加し、ゲーム開始時だけ暗い overlay から明るいゲーム中背景へ短時間でフェードする。
- 理由: Title/InputCheck では文字の視認性のため背景を暗くしている一方、Ready 以降では研究室背景を明るく見せる設計のため、状態遷移時に overlay が即時に消えると明度差が急に見える。状態追加やタイマー変更をせず、CSS の overlay だけで開始瞬間の変化をならす。
- 手動確認: Title から開始して Ready へ入った直後、背景が一瞬で明るくならず、約 0.5 秒で自然に明るくなることを確認する。
