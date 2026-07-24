# 設計ロック: 両手入力 v2（右手変位／左手変位／両手パンチ）

起票: claude（ユーザー決定＋Codex 相談を統合）/ 2026-06-24
位置づけ: 単手→両手の**入力契約 v2 への根本変更**。工数・実機リスク「大」。実装前にこの設計を固定する
（AGENTS §1 / Codex 相談結論）。**実装は本書確定後、フェーズ分割で着手**。

## 背景 / 変更概要
現行（v1）: 右手のみ。右手上下チャージ → 右手前後チャージ → 右手パンチ（発勁）。
新（v2）: **右手の変位チャージ → 左手の変位チャージ → 両手のパンチ（発勁）**。
mocopi は全身トラッキングのため左手も取得可能（Unity `GetBoneTransform(HumanBodyBones.LeftHand)`）。

## 確定した設計判断（ユーザー決定）
1. **変位の定義**: 各手の **3D 総移動量 Σ|Δp|**（方向を問わない累積移動量）。
   - `validForScore=true` の sample のみ積算。フェーズ最初の valid sample は baseline。
   - デッドゾーン（静止ノイズ除去）は現行 noiseThreshold 同様に手ごとへ適用。
   - ※ 現行の upVector/forwardVector 射影（上下/前後）は**チャージには使わない**（発勁判定の forward は引き続き使う）。
2. **フェーズ構成**: `RightCharge(10s) → LeftCharge(10s) → DualHakkei`（既存3フェーズを置換）。
3. **両手パンチ（発勁）**: 両手が**同期 window 内**に各自 forward 複合条件
   （forwardVelocity / forwardAcceleration / 過去 hakkeiWindowMs の forwardDisplacement、SPEC §13.6）を満たしたら検出。
   - スコア: **両手の windowed raw の平均**（演出重視）。
4. **片手欠損時**: **揃うまで待機**（DualHakkei で両手 ready を待つ。`hakkeiReadyTimeoutMs` 到達で no-impact）。
   - 将来構想（本実装外）: 破壊が起きない（no-impact）場合に「**隠しムービー**」を流す演出。別タスクで検討。
5. **互換 / protocol**: **protocol v2 必須**。v1 右手のみ packet は受理しない
   （`UNSUPPORTED_PROTOCOL_VERSION` または明確な `LEFT_HAND_UNAVAILABLE`）。「両手必須」を契約化。

## 推奨モデル（Codex 案・採用）
- **packet（v2）**: `protocolVersion:2`、`rightHand` / `leftHand`（各 Vec3 or null）、左右 ready 状態。
- **MotionSample**: `hands: { right: HandMotionSample; left: HandMotionSample }`。手ごとに Main 生成の
  position / velocity / acceleration / isAvailable / validForScore。`MotionSampleBuilder` と `MotionFilter` は
  **左右独立状態**（片手の異常・欠落が他方を汚さない）。
- **Calibration**: 左右の neutral を取得。**forward は体の共通 1 本**（左右別 forward は腕の開きで軸がぶれ、
  両手同期判定が不安定になるため）。
- **keyboard fallback**: Main の `keyboardSampleGenerator` が**左右の疑似軌道を 60Hz 生成**（Renderer 直入力にしない）。
  キー割当: 右手チャージ / 左手チャージ / 両手パンチ（具体キーは実装時に確定・config 化）。
- **config 化**: 手ごとのチャージ正規化レンジ・デッドゾーン、両手同期 window(ms)、no-impact timeout。
- **Result 表記**: 「上下/前後チャージ」→「右手/左手チャージ」。

## 実装フェーズ（v2 移行計画・Codex へチャンク分割で委譲予定）
- **P1 契約＋Main**: SPEC v2 章追記 → packet v2 schema / validator / UDP receiver / MotionSample 両手モデル /
  builder・filter 左右独立 / mock 両手化 / 各テスト。（score/UI は次フェーズ）
- **P2 Calibration**: 左右 neutral＋共通 forward、calibrationManager＋テスト＋UX文言。
- **P3 Score/検出**: RightCharge/LeftCharge 積算(Σ|Δp|)、DualHakkei 検出(両手同期・平均)、ScoreRawInput 再定義、
  scoreCalculator、Result 表記、accumulator/detector テスト。
- **P4 keyboard fallback**: 両手疑似入力・キー割当・回帰テスト。
- **P5 実機検証**: mocopi 実機で両手 Calibration→チャージ→両手パンチ→Result（ユーザー＋claude）。
- **将来**: no-impact 時の隠しムービー演出（別設計）。

## 前提 / 順序
- 先行中の prep猶予（各アクション前 3 秒）タスクが先に着地・検証されてから P1 着手（フェーズ/状態コードの競合回避）。
  prep の「構え猶予」は RightCharge/LeftCharge/DualHakkei にもそのまま引き継ぐ。
- 各フェーズ完了は typecheck/lint/test/build 緑＋（該当すれば）claude＋サブエージェントの二重検証。
- 不確定点は推測せず SPEC を先に更新（AGENTS §1）。
