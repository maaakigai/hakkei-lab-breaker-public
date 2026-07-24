# MVP 定義 (DRAFT・確定合意) — 発勁ラボブレイカー v2

> Claude×Codex 合意（2026-06-27）。ユーザ補足で **MVP の主語＝mocopi 1台**に確定。
> 本書は MVP の唯一の定義。SPEC v2 / MILESTONES v2 / GATES v2 はこれに従う。確定値はスパイク後（今は TODO）。

## 一文定義
**利き手手首に装着した mocopi 1台の BLE 入力で、タメ量とパンチ強度を測り、威力 Lv 別の破壊動画・損害額・ランクを表示する最小縦通し。keyboard は mocopi 未接続時・BLE 不調時の debug fallback として残す。**

## 入力の位置づけ（重要）
| 入力 | 役割 |
|---|---|
| **mocopi 1台 BLE 直読** | **本命 real input。MVP 達成条件の主語。** |
| keyboard（Space=charge / Enter=punch） | **debug fallback のみ**。開発中の UI/score/video 確認・BLE 不調時の保険。**keyboard で縦通ししても MVP 完成とは言わない。** |
| A1(5本固定)/Unity fixture | **fallback real input**。BLE probe No-Go 時の代替。input-independent core により core 無改修で差し替え可（主語=mocopi を維持）。 |

## スコープ（作る = Must Have）
- Flow: `Title → InputCheck → Ready → Charge → HakkeiReady(punch) → ImpactDelay → VideoPlayback → Result`
- **Input-independent core**（全入力が同じ口に入る・§後述 contract）:
  - `chargeRaw`（タメ＝手を動かした量 / accelEnergy 積分）
  - `strengthRaw`（パンチ＝accel/energy peak）
  - `validForScore` / timeout(noImpact)
  - `ScoreBreakdown → videoLevel → 動画/損害額/ランク`
- **BLE layer**: sidecar status / packet receive / baseline・noise floor / accelEnergy→charge・strength / disconnect→fallback
- **keyboard layer**: debug 完走用（同じ core contract を生成）
- placeholder 動画（Lv0–5 を本番同名・同構造、視覚的に区別可）で先に縦通し

## 作らない（Do Not Build in MVP）
direction / hidden / idle / special / DominantHandCheck / forward-up calibration / personalGain / quat gravity 補正 / Rust sidecar / 演出磨き UI / ランキング永続化 / 本番署名ビルド。
（personalGain・quat 補正は静止誤発火や個人差が実測で問題化したら後追い。）

## 入力非依存 core contract（採用）
```ts
type PunchInputSample = {
  source: "keyboard" | "mocopi-ble";
  sessionId: string;
  timestampMs: number;
  validForScore: boolean;
  chargeDelta: number;                 // タメの増分
  strength: { accelEnergy: number; speedProxy?: number; motionAmount?: number };
  quality: { sampleRateHz: number; flags: string[] };
};
```
- **Main がこれを生成**し、Renderer は `PunchInputSample` を消費（不変ルール維持）。
- 短期 adapter: `keyboard MotionSample → PunchInputSample` / `mocopiBlePacket → PunchInputSample`。
- BLE で pseudo position を偽装し続けない（Codex）。既存 `MotionSample` と並存可。

## 既存資産の扱い（作り直さず magnitude-only へ削る）
- **再利用**: `stateMachine`（Calibration/DominantHandCheck を外す）/ `scoreCalculator`（raw 入力を charge+strength へ・短期 adapter）/ `videoManager`(placeholder可) / `resultPresenter`(文言を「タメ/パンチ強さ」へ) / `keyboardInput`・`keyboardSampleGenerator` / config loader。
- **撤去/無効化**: `outcomeResolver` の direction 分類 / hidden config / `DominantHandSelector` / 通常 path の calibration forward/up / `DualHakkeiDetector` / direction 系テスト / sweep の direction metrics。
- **注意（rename は SPEC v2 確定後）**: `HakkeiDetector→PunchDetector` / `forwardVelocityPeak→speedPeak` / `forwardAccelerationPeak→accelPeak` / `forwardDisplacement→motionAmount`。MVP 直前の全 rename は避け、まず runtime contract を直す。

## V-series 実装順（Codex 調整版）
```
V0: BLE probe GO/No-Go（存在ゲート・tools/mocopi_ble_probe.py）
V1: SPEC/AGENTS v2 authority draft → GO後に権威化
V2: input-independent metrics contract（PunchInputSample）
V3: keyboard core vertical slice（=Debug Core・MVP完成ではない）
V4: BLE sidecar → Main packet integration（probe GO 後）
V5: Renderer magnitude-only game loop
V6: InputCheck BLE UI + fallback
V7: threshold tuning / 静止誤発火 / 弱-強分離
V8: demo readiness / assets / runbook
```
- 狙い: metrics contract を先に切り keyboard/BLE を同じ口へ → keyboard core を早く作り BLE 遅延でも UI/score/video を進める → BLE integration は probe GO 後。

## Gate 対応（GATES-v2）
- **MVP-Core（中間チェック・MVP完成ではない）**: Gate A(Baseline App) / Gate E via keyboard。
- **MVP 完成（必須）**: Gate B(BLE Probe) / Gate C(Sidecar) / Gate D(Signal Quality) / Gate E via **BLE**。
- **MVP 後**: Gate F(Demo Readiness)。

## 受入条件（Acceptance）
### Debug/Core Completion（中間・MVP完成ではない）
- keyboard で `タメ→パンチ→動画→Result` 完走。Space タメ量で power 変化、Enter 強さで Lv 変化、timeout=Lv0、mp4 欠損で Error 表示・落ちない。

### MVP Completion（主語=mocopi）
- **mocopi 1台 BLE で `タメ→パンチ→動画 Lv 変化→Result` が 10 連続落ちずに通る。**
- **静止 10 秒で誤発火 0。** baseline 取得済。BLE 45–55Hz。
- **タメ小/大・弱/強で動画 Lv が変わる。** latency ≤ 300ms 目安。
- **BLE 断で keyboard debug fallback へ逃げられ、アプリは落ちない。**
