# SPEC v2 (DRAFT) — 1-hand magnitude-only / mocopi BLE direct

> ⚠ **DRAFT・未権威**。これは方針転換（mocopi app/Unity 廃止 → BLE 直読 1 センサー・方向廃止・パンチ強度のみ）後の
> 新仕様の**骨組み下書き**。**BLE probe スパイク（`tools/mocopi_ble_probe.py`）が GO してから** `SPEC.md` を本書ベースで権威化する。
> No-Go なら本書は破棄、または A1(5本固定)/Unity fallback 版へ修正する（Codex docs-remake review 2026-06-26）。
> 現行の権威は引き続き `SPEC.md`（§0.24 過渡 status note 参照）。確定値（閾値）はスパイク後に実測で埋める＝今は `TODO:`。

## 0. Status / Authority
- 本書が権威化されたら、旧 `SPEC.md` 本文（Unity/6センサー/方向/§0.23 系）は `docs/legacy/` へ退避し、本書が唯一の実装契約になる。
- 衝突時は本書を優先。旧仕様は Appendix A から参照のみ。
- 過渡期の間、実装は現行 `SPEC.md` に従い、本書は設計合意の置き場とする。

## 1. Product Goal
> **MVP 定義は [MVP-v2.md](MVP-v2.md) が唯一の権威**（主語＝mocopi 1台・keyboard は debug fallback・Claude×Codex 合意 2026-06-27）。
- プレイヤーが mocopi センサー**1個を利き手の手首に装着**し、**前方へパンチ**する。
- 「**どれだけ手を動かしたか（チャージ）＋パンチの強さ**」から威力を算出し、ローカル mp4 の破壊動画・損害額・ランクを出す。
- **方向の識別はしない**（前/上/下/後ろの分類・隠しイベント・特殊モーション・idle・両手・DominantHandCheck は廃止）。
- mocopi app / Unity / Humanoid Avatar / 6 センサーは**使わない**。交代はセンサー1個の付け替えだけ。

## 2. Current Architecture
```
mocopi sensor(1) --BLE--> [BLE sidecar: Python bleak] --UDP localhost--> Electron Main --MotionSample/metrics--> Renderer
                                                                              |__ score/動画/Result
keyboard fallback ----------------------------------------------------------> Electron Main（疑似 sample）
```
- **不変ルール（v1 から継承）**: Main が packet 検証・metrics・validity を生成。Renderer は再計算しない。config 由来（ハードコード禁止）。keyboard fallback 維持。エラー/timeout/欠損でアプリを落とさない。
- 旧 `unity-bridge/`・mocopi PC app 経路は本モデルでは不使用（資産は legacy/Phase 別保管）。

## 3. Input Source: `mocopi-ble`
- sidecar が mocopi センサーへ BLE 直結（device `QM-SS1`・data char `25047e64-657c-4856-afcf-e315048a965b`・cmd char `0000ff01-...`・start `7e 03 18 d6 01 00 00`・36byte/50Hz・quat int16÷8192・accel float16）。出典: moslime/mocopi-reverse-engineering（プロトコル事実のみ・コード非流用）。
- sidecar は accel/quaternion を localhost UDP JSON で Main へ。**Main が唯一の MotionSample/metrics 生成者**。
- `source` 値に `mocopi-ble` を追加。keyboard・（必要なら旧 mock）と排他。

## 4. Data Contract（sidecar → Main）
```ts
type MocopiBlePacketV1 = {
  protocolVersion: 1;
  type: "imu";
  source: "mocopi-ble";
  sensorId: string;
  sessionId: string;
  seq: number;            // 単調増加（counter 由来）
  timestampMs: number;
  sampleRateHz?: number;
  quat: { w: number; x: number; y: number; z: number } | null;
  accelRaw: { x: number; y: number; z: number };
  accelMagnitude: number;
  quality?: { rssi?: number; droppedFrameCount?: number; flags?: string[] };
};
```
- 既存 unity packet の `rightHand:{x,y,z}`（絶対位置契約）に accel を**偽装しない**（Codex）。新 type/source を立てる。
- Main 側 validator: protocolVersion/type/source/seq 単調性/timestamp 単調性/accel 有限性。不正は sample 不生成＋warning。

## 5. Main-owned Metrics（IMU → ゲーム指標）
> **実機スパイク確定（2026-06-27・[docs/runs/20260627-ble-spike-result.md]）**: 信号は **quaternion 角速度**。packet の「accel」フィールドは動きに無反応で**使わない**。静止/パンチを **約400x** で分離（GO）。
- **角速度** = 連続 quaternion 間の回転角 `ω = 2·acos(|dot(q_t, q_{t-1})|) / dt`。静止≈0・運動で大きく上がる（軸同定・重力差し引き不要）。
- **パンチ強さ** = ウィンドウ内 **peak 角速度**（パンチ強弱が段階的に出る）。
- **チャージ（どれだけ動かしたか）** = `chargeRaw = ∫ clamp(ω - noiseFloor, 0) dt`（角速度の時間積分）。
- **validForScore** = sampleRate 良好 ∧ quaternion 有限 ∧ 接続生存。`quality.flags`: `BLE_DISCONNECTED`/`LOW_SAMPLE_RATE`/`BASELINE_NOT_READY`。
- `MotionSample` 拡張方針: 短期は互換 field を埋めつつ Renderer は IMU 由来 metrics を見る。中期に `kinematicsKind: "position" | "imu"` を導入（TODO）。
- 補足: `accelRaw/accelMagnitude` は packet に残すが**信頼しない**（参考値）。将来 BMI270 の生 accel を正しく取り出せたら線形 impact を加点候補に。

## 6. Renderer Flow（magnitude-only state path）
- `Title → InputCheck → (Baseline) → Ready → Charge → HakkeiReady → ImpactDelay → VideoPlayback → Result`
- **撤去**: Calibration の forward/up 軸、DominantHandCheck、方向分類、hidden(down/up/back)、idle、special。
- `InputCheck`: BLE connected/Hz/age/baseline/accelEnergy を表示。利き手は config 既定 or UI 左右選択のみ（自動判定なし）。
- `Charge`: accelEnergy 積算 → chargeRaw。`HakkeiReady`: accelEnergy ピーク閾値でパンチ検出 → score。
- **keyboard fallback** で全 state を Title→Result 完走できること（不変）。

## 7. Scoring
- `calculateScore()` は純計算（chargeRaw＋パンチ metrics → §14 系の式で `ScoreBreakdown`）。trigger 種別を混ぜない。
- アウトカムは実質 `hit`（通常破壊・威力 Lv 動画）と `noImpact`（空振り・Lv0）。方向 trigger は無い。
- 威力 Lv → 動画マップ・損害額・ランクは config 由来。

## 8. Config（新規/縮小）
- `input.ble`: `deviceNamePrefix`/`dataCharUuid`/`cmdCharUuid`/`startCommand`/`expectedSampleRateHz`/`packetLen`/`udpPort`（sidecar 連携）。
- `score`: `accelNoiseFloor`/`punchEnergyThreshold`/`chargeWeight`/`personalGain`（任意 warmup）/`rankThresholds`/動画 Lv マップ。**TODO: 値はスパイク実測で確定**。
- 旧方向 config（`forwardCos`/`dirCos`/`hiddenChargeGate`/back・up・down 系）は撤去。
- appConfig バリデーション: 非負/有限/sampleRate 範囲/閾値順序。

## 9. Error / Fallback
- sidecar 停止・2s 以上 packet 途絶 → `BLE_TIMEOUT` 表示、app は落とさず **keyboard fallback を提示**。
- BLE 再接続ボタン or sidecar restart 手順を UI/runbook に。
- malformed packet/低レート/disconnect は quality flags へ。

## 10. Gates
- `docs/drafts/GATES-v2-ble.md`（Gate A〜F）を参照。旧 Unity Gate B1/B2/C/D1 は本モデルでは凍結→ legacy。

## 11. Manual Verification
- `HUMAN_TEST_GUIDE_JA.md` を BLE 1 センサー運用＋keyboard fallback へ改稿（probe GO 後）。
- 交代手順（センサー1個付け替え・30秒以内）、BLE 再接続、静止誤発火0 の確認手順を含める。

## Appendix A. Legacy Superseded Specs
- 旧 `SPEC.md`（Unity/6センサー/§0.8〜§19・§0.23 単手＋方向）は `docs/legacy/SPEC-legacy.md` へ退避予定。両手v2・方向・隠しイベント資産は Phase 別保管（必要なら別 optional 仕様）。
- 退避理由・経緯は `docs/runs/` を一次資料とする。
