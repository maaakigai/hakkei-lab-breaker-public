# M15-09 実機チューニング 実験計画（単手モデル §0.23）

claude×codex で設計・レビュー（2026-06-26）。目的は **config 閾値を主観でなく数値で・再現可能に決める**こと。

## 方法論（権威）
> 閾値は、**trial 境界付きの連続 MotionSample 記録**を、**本番と同じ detector / outcome code**（`HakkeiDetector` / `resolveTrigger` / `resolveOutcome`）で **offline replay** し、**事前定義した安全制約**を満たす候補の中から **holdout 指標**で選ぶ。

人がやるのは「ラベル通りに動いて記録する」だけ。閾値はオフライン掃引が決める。主観は**試行除外（operatorVerdict）と一部の演出判断**に限定し、宣言してから使う。

## 決める対象 config（現在の暫定値）
`config/score.config.json`: `forwardCos=0.75`, `dirCos=0.80`, `hiddenChargeGate=0.0`, `hakkeiMinForwardVelocity=1.2`, `hakkeiMinForwardAcceleration=4.0`, `hakkeiMinForwardDisplacement=0.1`, `idleMaxNetDistance=0.05`, `idleMaxSpeed=0.30`, `dominantHandMargin=0.05`。
`config/app.config.json`: `idleEnabled`（idle 検証時のみ true）, `idleEventMs`。

## データ収集（実機・人の作業）
ラベル付き連続記録。各 trial に **境界マーカー**（trialStart/End）と metadata を付ける。
- **trial set（最低構成）**: forward×20 / down×20 / up×20 / back×20 / weak-forward×20 / static-10s×3 /
  sideways×10 / diagonal-forward-up×10 / diagonal-forward-down×10 / non-dominant-hand×10 / small-fast-jitter×10
- **2 session**: A=tune / B=holdout（過学習防止）。
- **順序ランダム化＋休憩**（疲労・慣れの偏り回避）。ブロック内でラベルをシャッフル。
- **operatorVerdict**: 各 trial に valid / bad-form / uncertain。明らかにフォームが崩れたら除外可能に。
- **一般化の限界**: 1人だと「その人向け」。本番操作担当が固定なら可。複数人運用なら2-3人で少数 trial を追加。

## 記録フォーマット（source of truth = 完全な MotionSample 列）
JSONL/JSON。1 record = 1 MotionSample（生）＋ stream。最低限：
- packet: `protocolVersion/source/sessionId/seq/timestampMs/receivedAtMs`
- right(top-level): `rawHandPosition/handPosition/velocity/acceleration/validForScore/validForCalibration/quality`
- `leftHand` 全体
- trial metadata: `trialId/label/operatorVerdict/dominantHand/trialStartTimestampMs/trialEndTimestampMs`
- calibration: `forwardVector/upVector/neutral/quality`
- config snapshot: `score/input/app`（録画時 config）
- code version: git commit SHA
- per-window observation は **debug cache 扱い**（source にしない。再計算一致チェック用）。

## オフライン評価（掃引）
本番と同じコードを import し、**連続ストリームを timestamp 順に replay**（`performance.now()` 不使用・`timestampMs` のみ）。
reset タイミング（trial start / HakkeiReady entry / session change）・cooldown・timeout・window端の包含（`>=start && <=current`）を本番と一致させる。config grid を掃引して指標を出す。

### 指標
- 混同行列（意図ラベル → 実 trigger）
- `forwardRecall` / `down|up|backRecall`
- `forwardToHiddenRate`（**強く抑制**）/ `hiddenToForwardRate`
- `falseFirePerMinute`（static/waiting/charge 中）/ `doubleFireRate` / `earlyFireRate`
- `latencyMs`（trial start または peak → trigger）/ `timeoutRate` / `hiddenMissRate`
- `weakForwardFireRate`
- `leftRightSymmetry`（dominantHand 切替時の recall 差）/ `dominantHandDecisionAccuracy`
- `validSampleRatio` / `qualityFlagRate`（OUTLIER_*/LOW_SAMPLE_RATE/RIGHT_HAND_UNAVAILABLE）
- charge→power 単調性（score calibration 検証。「同条件で charge raw↑ → power↑」程度で可）

### 閾値選定＝制約付き最適化（順序）
1. static false fire = 0
2. weak-forward が forward にならない率を十分高く（誤 fire ≤ 上限）
3. forward→hidden 誤分類 = 0（または許容上限以下）
4. down/up/back recall が各下限以上
5. その中で forward recall と trigger latency を最適化
出力は **best 1点でなく Pareto 候補を数個**（判断を透明化）。

### hiddenChargeGate の扱い
raw `Σ|Δp|`（meter path length）は duration/sampleRate/noiseThreshold/癖に依存。掃引時は：
- **raw 値と normalized charge score の両方を出す**。
- gate を raw で決めるなら charge phase duration と noiseThreshold を固定して記録。
- sample rate が違う session 間で raw が変わるので quality 悪い trial は分離。
- baseline 0.0 ＋ 正候補（0.5/1.0/2.0m 等）を掃引。
- 将来は normalized charge score に gate を置く方が config と説明が安定（影響範囲ありなので M15-09 では両方出して判断）。

## 受け入れ基準（M15-09・先に宣言／実測で確定）
- Static false fire: **0 / 30s 以上**
- Forward recall（holdout）: **≥90%**
- Forward→hidden: **0 件**
- Down/up/back recall: 各 **≥70%**（または演出上の許容ラインを明記）
- Double fire: **0 件**
- Weak-forward の forward 発火: **≤10%**
- Median trigger latency: **≤300ms**（または体感許容値）
- 採用 trial の validSampleRatio: **≥95%**

## ツール（実装・Codex 優先度。実機不要で作れる）
1. **Recorder**（dev screen＋JSON 書き出し）：trial label/verdict を選び、MotionSample stream＋metadata＋calibration＋config＋SHA を保存。**最優先**。
2. **Offline sweep CLI**：既存 `HakkeiDetector`/`resolveTrigger` を import、config grid を走査して metrics を JSON/CSV 出力。
3. **Report renderer**：混同行列・Pareto 候補を Markdown/CSV。
4. Live harness（InputCheck の単手ライブ数値表示）は**最後**。実機中の安心感用。
- over-engineering 回避：Electron に大きな分析画面を作らない。JSON＋Node CLI＋表計算で十分。

## 主観が残る箇所（宣言）
意図ラベルの正しさ／フォーム有効性（trial 除外）／forward と diagonal の境界／hidden の狙いやすさ／weak-forward をどこまで noImpact にするか／誤発火0をどれだけ重く見るか／操作担当1人最適化の可否。
→ これらは「先に宣言して数値で再現できる判断に落とす」。なくすのではなく、入る場所を限定する。
