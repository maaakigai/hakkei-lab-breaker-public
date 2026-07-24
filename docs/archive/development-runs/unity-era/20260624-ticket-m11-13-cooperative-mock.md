# Ticket: M11-13 協調 mock モード（実機なし回帰）

担当: codex / 起票: claude（agmsg連携）/ 2026-06-24

## ゴール
実機 mocopi なしで **Calibration → 上下チャージ → 前後チャージ → 発勁検出 → Result** を一通り回せる
「協調 mock」モードを `scripts/mock-unity.mjs` に追加する（MILESTONES M11-13 / `npm run mock:unity --calib` 相当）。
M11-06〜09 で発勁が複合条件（forward 射影の 速度＋加速度＋変位）になったため、mock もそれを満たす前方突きを出す必要がある。

## 現状
- `scripts/mock-unity.mjs`: `npm run mock:unity` で 127.0.0.1:45100 へ連続 sin 波の motion/heartbeat を送るだけ。
  - `source="mock-unity-bridge"`（独立 InputMode/MotionSource。Gate B2/D1 の代替にはしない）。
  - フラグ: `--port` / `--hz` / `--bad`。
  - Calibration 用の「静止 neutral → 前方ジェスチャ」の局面や、発勁用の前方突きは無い。

## 要件
1. **新モード `--calib`** を追加（既存 `mock:unity` / `--bad` は壊さない）。
   利便のため `package.json` に `"mock:unity:calib": "node scripts/mock-unity.mjs --calib"` を追加（予約 script 名の方針 P1-09 と整合）。`--port`/`--hz` は併用可。
2. `--calib` は **決定的な時間ベースの motion 系列**を出す。最低限、次の動作を含む周期的プロファイル:
   - **静止 neutral**: Calibration の neutral 保存条件を満たす長さ・安定度（discard 後 ~2秒・所定 sample 数・低 jitter）。実条件は `src/renderer/calibrationManager.ts` と `config/input.config.json` を読んで合わせる（ハードコードせず config 由来の値に整合させる）。
   - **前方ジェスチャ**: forwardVector 推定に足る前方移動（avatar.forward = +z 方向）。
   - **上下チャージ**: `upVector` 方向（y）の往復で `verticalRaw` が溜まる振幅。
   - **前後チャージ**: `forwardVector` 方向（z）の往復で `forwardRaw` が溜まる振幅。
   - **発勁突き**: 複合条件を満たす前方突きを周期的に出す。
     `forwardVelocity > hakkeiMinForwardVelocity`、`forwardAcceleration > hakkeiMinForwardAcceleration`、
     直近 `hakkeiWindowMs` の `forwardDisplacement > hakkeiMinForwardDisplacement` を avatar.forward 上で同時成立させる。
     ※ velocity/acceleration は **Main 側が位置の差分から生成**する。mock は UDP で **位置 `rightHand` を出すだけ**なので、
     位置プロファイル（前方への ease-in 的パルス）で Main 生成の速度・加速度が閾値を超えるように設計する。Renderer/Main は触らない。
3. 数値の出どころ:
   - 閾値・window は `config/score.config.json`（`hakkei.*`）と `config/input.config.json` を読んで参照（突きの強さ設計の根拠にする）。
   - mock 固有の演出定数（周期・各局面の長さ等）はスクリプト内に置いてよいが、**コメントで意図を明記**し、無闇なマジックナンバーにしない。
4. **テスト容易化**: motion 位置の生成を純粋関数（例 `calibProfile(tMs) -> {x,y,z, phase}`）に切り出し、`test/` で
   - 各局面が出る（neutral 静止 / 前方ジェスチャ / 上下振幅 / 前後振幅 / 突き）こと、
   - 突き区間で、Main の差分近似（連続2サンプルの位置差/dt と二階差分）が複合閾値を超える見込みであること、
   を `node --test` で検証する。UDP 送信や DOM には依存させない。
   既存テストは緑のまま、新規追加。

## 不変ルール（厳守）
- `MotionSample`・速度・加速度・filter・validity は **Main 生成**。mock は **位置と heartbeat の UDP JSON を出すだけ**。Renderer/Main のロジックは変更しない（AGENTS §6）。
- `source` は `mock-unity-bridge` のまま。active mode との排他（SOURCE_MISMATCH）を壊さない。
- 閾値ハードコード禁止（参照は config 由来）。TS/JS 規約は既存 `.mjs` スタイルに合わせる。
- 既存 `mock:unity` / `--bad` / 各種 IPC・validator を壊さない。

## 検証
- `npm run typecheck && npm run lint && npm test && npm run build` を全部緑に（test 件数は増える）。
- 手動確認手順を実装日誌に記載: `npm run dev`（入力モード=Mock Unity Bridge）＋ 別端末で `npm run mock:unity:calib` を起動し、
  Calibration 成立 → 上下/前後チャージが溜まる → HakkeiReady で発勁検出 → Result まで到達することを確認（できた範囲を記録）。
- commit / push はしない（作業ツリーのみ）。

## 進め方
- 設計上の不確定（calibration の正確な neutral 条件、突きプロファイルの形）で迷ったら、推測せず agmsg で claude に質問。
- 完了したら agmsg（ファイル経由送信）で claude に: 変更ファイル / テスト結果(pass数) / 手動確認の結果 / 設計判断 / 残TODO を報告。
