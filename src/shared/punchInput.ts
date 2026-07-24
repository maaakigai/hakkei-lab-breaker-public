// src/shared/punchInput.ts
//
// 入力非依存のpunch game core契約（MVP v2・SPEC v2 draft §4-5）。
//
// 狙い: keyboard / mocopi-ble / (将来) その他 real input を「同じ口」へ正規化し、Renderer の game core
//   （Charge 積算・パンチ検出・score・動画 Lv）が入力種別に依存しないようにする。
//   §0.24 magnitude-only モデルでは方向を使わないため、強さは accel/energy の magnitude のみで表す。
//
// 不変ルール（v1 から継承）:
//   - 本サンプルは Main が生成する（Renderer で再計算しない）。短期は keyboard MotionSample からの
//     adapter（V2b）でも、最終契約は Main-generated（V2c）。
//   - mocopi-bleではaccelをMotionSample.handPositionに偽装せず、本型を使う。
//
// 既存`MotionSample`（位置ベース）とは並存し、置換しない。

export type PunchInputSource = "keyboard" | "mocopi-ble" | "unity-bridge" | "mock-unity-bridge";

// 入力品質フラグ。BLE/keyboard 双方の異常を core へ伝える（diagnostics / fallback 判断用）。
export type PunchInputQualityFlag =
  | "DT_RESET"
  | "DT_TOO_LARGE"
  | "LOW_SAMPLE_RATE"
  | "BASELINE_NOT_READY"
  | "ACCEL_SATURATED"
  | "BLE_DISCONNECTED"
  | "INPUT_UNAVAILABLE";

// 1 サンプル分の「強さ」指標（すべて magnitude・方向なし・source 非依存）。
// 実機スパイク（2026-06-27）で BLE の強さ信号は **quaternion 角速度** と確定。
// keyboard は擬似手位置の加速度 magnitude を同じ intensity スカラへ正規化する。
export type PunchStrength = {
  // パンチ判定用の瞬間強さ（BLE=角速度 deg/s 相当 / keyboard=擬似 |accel|）。
  intensity: number;
  // window 集計後のピーク（detector が更新・診断/score 用）。
  intensityPeak: number;
  // 動いた量の補助代理（方向なし）。
  motionAmount: number;
};

export type PunchInputSample = {
  protocolVersion: 1;
  source: PunchInputSource;
  sessionId: string;
  seq: number;
  timestampMs: number;
  receivedAtMs: number;
  // score / charge に使ってよいか（baseline 確定・rate 良好・有限・接続生存）。
  validForScore: boolean;
  // 入力が利用可能か（接続/トラッキング生存）。false の間は INPUT_UNAVAILABLE。
  isAvailable: boolean;
  // タメの増分（sample 間）。Renderer の Charge では chargeRaw += chargeDelta するだけにできる。
  // BLE: max(|accelLinear| - noiseFloor, 0) * dt / keyboard: noise 閾値付き Σ|Δp|。
  chargeDelta: number;
  // Main が生成する連続 idle 時間。計測 overlay/export は再計算せずこの値をそのまま通す。
  idleMs: number;
  strength: PunchStrength;
  quality: {
    sampleRateHz: number;
    dtMs: number;
    flags: PunchInputQualityFlag[];
  };
};

// sidecar(BLE) → Main の packet 契約（SPEC v2 draft §4・mocopi-ble）。
// quaternion を必須にする。実機確定でパンチ信号は角速度なので Main は quat から角速度を出す。
// accelRaw は packet に残すが信頼しない（参考値・実機で動きに無反応）。
export type MocopiBlePacketV1 = {
  protocolVersion: 1;
  type: "imu";
  source: "mocopi-ble";
  sensorId: string;
  sessionId: string;
  seq: number;
  timestampMs: number;
  sampleRateHz?: number;
  quat: { w: number; x: number; y: number; z: number };
  accelRaw?: { x: number; y: number; z: number };
};

// score coreへの純粋入力。triggerや方向は混ぜない。
// 既存 buildScoreBreakdown とは別に buildPunchScoreBreakdown を足す方針（V3a）。
export type PunchScoreRawInput = {
  chargeRaw: number; // Charge フェーズで積算した総タメ量
  punchStrengthRaw: number; // 検出パンチの強さ（accelPeak / energy 主体）
  punchDetected: boolean;
  punchTimedOut: boolean; // HakkeiReady timeout = no-impact（Lv0）
};
