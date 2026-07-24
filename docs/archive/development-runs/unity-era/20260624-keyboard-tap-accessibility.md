# 20260624 キーボード操作を「Space連打」へ（四十肩アクセシビリティ）

## 対象 / 背景
キーボード入力を**長押し→1ボタン連打**へ変更。四十肩など大きな腕の動きや長押しが負担な人でも遊べるように。
ユーザー要望: 「ボタン1つを連打してゲージをためる、発射は Enter」。設計確認で「Space連打＋Enter発射」を採用。
キーボード契約（SPEC §8.2 / §0.8.1）の変更のため、SPEC・実装・テストを揃えて更新。

## 採用した判断
- **Space = 連打チャージ**。1タップ（押下エッジ）ごとに疑似的な手の目標が `±(tapVerticalStepM, tapForwardStepM)`
  へ交互反転し `tapSpeedMps` で往復。M11 の変位積分（upVector/forwardVector 射影）で**上下/前後どちらの
  フェーズでも**溜まる（同じボタン1つで両対応）。連打＝速く溜まる。
- **OSキーリピート（長押し）は反転しない**（押下エッジが増えないため）→ 静止に収束＝溜まらない。SPEC「OS
  リピート無視」と整合。
- **A/D 廃止**（Space連打へ一本化）。**Enter 発射は据え置き**。R/Esc 据え置き。
- アーキテクチャ維持: Renderer は keydown/keyup を送るだけ、Main の generator が MotionSample を生成（AGENTS §5.3）。
  Renderer で score を作らない。
- ステップ幅は config 化（`input.config.json keyboard.tapVerticalStepM=0.33 / tapForwardStepM=0.15 /
  tapSpeedMps=2.0`）。実機(mocopi)の正規化レンジ(20/9)に合わせ「無理のない連打で7〜8割」を狙った暫定値。

## 変更ファイル
- `src/main/keyboardSampleGenerator.ts`: Space正弦波＋A/D積分を撤去し、Space連打の交互往復＋Enterパルスへ。
  `chargePosY/Z` `chargeSign`、`clamp()` 追加。`zBase`・A/D 撤去。
- `config/input.config.json` / `src/shared/configTypes.ts` / `src/main/appConfig.ts`: keyboard の
  `spaceAmplitudeM`/`spaceFrequencyHz`/`forwardVelocityMps` を `tapVerticalStepM`/`tapForwardStepM`/`tapSpeedMps` へ置換。
- `src/renderer/app.ts`: InputCheck/上下/前後のヒントを「Space連打でチャージ」へ。HakkeiReady は Enter のまま。
- `SPEC.md` §8.2 / §0.8.1: キー表・初期値・入力規則を連打仕様へ更新。
- `test/keyboard-generator.test.mjs`: Space往復で変位が溜まる/長押しは溜まらない、へ刷新（A/D テスト削除）。
- `test/config-loader.test.mjs`: CONFIG_INVALID フィクスチャの keyboard を新フィールドへ。

## 確認結果
- typecheck/lint/build 緑。`npm test` 86 pass / 0 fail。

## 実機（キーボード）体感確認（2026-06-24）
- Space連打で通しプレイ成立。Result 例: 損害額 ¥51,129,000 / Rank A / Power 511,290 / Lv4 /
  上下 78.7・前後 100.0・発勁 65.0、raw 上下 15.7m / 前後 15.1m / 発勁 v2.0 a176.5 d0.00m。
- **ユーザー評価「楽だった」「フリーズなし」** → アクセシビリティ目的（四十肩でも無理なく）を満たすと判断。
  溜まり量（tapVerticalStepM/tapForwardStepM）はこのまま据え置き。

## 残課題 / 注意
- 前後が 100% に飽和しやすい（forwardRawMax=9 と keyboard の前後変位が大きめ）。アクセシビリティ優先で
  現状維持。前後にスキル表現の幅を持たせたいなら `tapForwardStepM` を下げる（comfort は若干低下）。要望次第。
- 発勁の内訳が粗い（検出は速度しきい値の瞬間→移動量 d≈0、keyboard Enter の擬似加速度スパイク a176.5）。
  **M11-06〜09（発勁本実装: 検出後 hakkeiWindowMs の valid window から V/A/D を取る）で是正予定**。発勁自体は検出・採点される。
- ステップ幅は暫定。実キーボードで「連打して7〜8割」に乗るか体感確認し、必要なら config を調整（mocopi の
  レンジと共有なので両者のバランスを見る）。
- HakkeiReady で Space を連打すると z 速度が出て発勁が起き得る（発射は本来 Enter）。fallback 用途では許容。
  厳密分離が必要なら別途検討。
