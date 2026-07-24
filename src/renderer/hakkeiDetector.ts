// src/renderer/hakkeiDetector.ts
//
// Hakkei detection from Main-generated hand kinematics（両手v2 D案）。
//
// D案（2026-06-25設計確定）:
//   - 強さ判定は **magnitude（大きさ）**: |velocity|・|acceleration|・net変位(window端-端の直線距離)。
//     前方射影をやめたので **左右完全対称・利き手中立**（左手が forward 射影で目減りする問題が消える）。
//   - 方向は **ゆるい前方 gate** のみ: net変位ベクトルの前方成分 dot(netDelta, forward) > hakkeiForwardGateMin。
//     横払い・上げ直し・構え直し等の誤発火を防ぐ。スコアは magnitude 側の左右平均。
//   - 変位は Σ|Δp|（path length）ではなく **net直線距離**。発勁は一方向の短い突きで、往復や震えで
//     path を稼がせない。chargeは Σ|Δp| のまま（別物）。
//   - netDelta ベクトルは観測に残す → 将来の「上/下/後ろ突き・特殊モーション・何もしない」隠しイベントの
//     方向分類 seam（[[hidden-events-direction-vision]]）。
// DualHakkeiDetector は左右が各々検出し、検出 timestamp 差が同期 window 内のときだけ両手パンチ成立。

import type { ScoreConfig } from "../shared/configTypes.ts";
import type { HandMotion, MotionSample, Vec3 } from "../shared/types.ts";

type HakkeiDetectorConfig = Pick<
  ScoreConfig["hakkei"],
  | "hakkeiMinForwardVelocity"
  | "hakkeiMinForwardAcceleration"
  | "hakkeiMinForwardDisplacement"
  | "hakkeiForwardGateMin"
  | "hakkeiWindowMs"
  | "hakkeiCooldownMs"
>;

type DualHakkeiConfig = HakkeiDetectorConfig &
  Pick<ScoreConfig["hakkei"], "dualHakkeiSyncWindowMs">;

export type HakkeiHandKinematics = {
  timestampMs: number;
  position: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  validForScore: boolean;
};

type WindowSample = {
  timestampMs: number;
  position: Vec3; // net変位（端-端）算出用に位置ベクトルを保持
  velocity: Vec3; // peak 速度方向（突きの瞬間の向き）算出用に速度ベクトルを保持
  speed: number; // |velocity|（magnitude）
  accel: number; // |acceleration|（magnitude）
};

// D案: forwardVelocityPeak/AccelerationPeak は magnitude のピーク、forwardDisplacement は
// window端-端の net直線距離。名前は後方互換のため据え置き（score/診断の経路を変えない）。
export type HakkeiObservation = {
  detected: boolean;
  timestampMs: number;
  forwardVelocityPeak: number; // = peak |velocity|
  forwardAccelerationPeak: number; // = peak |acceleration|
  forwardDisplacement: number; // = net直線距離（window端-端）
  forwardComponent: number; // = dot(netDelta, 正規化forward)＝前方成分（gate 判定値・診断表示用）
  netDelta: Vec3; // window端-端の変位ベクトル（方向分類の fallback）
  // 速度ピーク時点の速度方向（突きの瞬間の向き・§0.23.6）。
  // 引き戻し/腕の弧/振り向きで net が汚れても、突きの瞬間の向きは保たれる。方向分類の第一候補。
  peakVelocityDir: Vec3 | null;
};

const NO_DETECTION: HakkeiObservation = {
  detected: false,
  timestampMs: 0,
  forwardVelocityPeak: 0,
  forwardAccelerationPeak: 0,
  forwardDisplacement: 0,
  forwardComponent: 0,
  netDelta: { x: 0, y: 0, z: 0 },
  peakVelocityDir: null,
};

export function rightHandKinematics(sample: MotionSample): HakkeiHandKinematics {
  return {
    timestampMs: sample.timestampMs,
    position: sample.handPosition,
    velocity: sample.velocity,
    acceleration: sample.acceleration,
    validForScore: sample.validForScore,
  };
}

export function leftHandKinematics(sample: MotionSample): HakkeiHandKinematics | null {
  const left = sample.leftHand;
  if (left === null) {
    return null;
  }
  return handMotionKinematics(sample.timestampMs, left);
}

export function handMotionKinematics(timestampMs: number, hand: HandMotion): HakkeiHandKinematics {
  return {
    timestampMs,
    position: hand.handPosition,
    velocity: hand.velocity,
    acceleration: hand.acceleration,
    validForScore: hand.validForScore,
  };
}

export class HakkeiDetector {
  private lastFireMs = Number.NEGATIVE_INFINITY;
  private readonly config: HakkeiDetectorConfig;
  private window: WindowSample[] = [];

  constructor(config: HakkeiDetectorConfig) {
    this.config = config;
  }

  reset(): void {
    this.lastFireMs = Number.NEGATIVE_INFINITY;
    this.window = [];
  }

  observe(hand: HakkeiHandKinematics, forwardVector: Vec3): HakkeiObservation {
    if (!hand.validForScore) {
      return { ...NO_DETECTION, timestampMs: hand.timestampMs };
    }

    const observed: WindowSample = {
      timestampMs: hand.timestampMs,
      position: hand.position,
      velocity: hand.velocity,
      speed: magnitude(hand.velocity),
      accel: magnitude(hand.acceleration),
    };
    const windowStartMs = hand.timestampMs - this.config.hakkeiWindowMs;
    this.window = [...this.window, observed].filter(
      (entry) => entry.timestampMs >= windowStartMs && entry.timestampMs <= hand.timestampMs,
    );

    const oldest = this.window.reduce(
      (candidate, entry) => (entry.timestampMs < candidate.timestampMs ? entry : candidate),
      observed,
    );
    // net変位（端-端のベクトルと直線距離）。往復や震えでは net が伸びない。
    const netDelta = sub(observed.position, oldest.position);
    const netDistance = magnitude(netDelta);
    // 前方 gate は forwardVector を正規化して使う（手編集 config の scale に依存させない）。
    const forwardComponent = dot(netDelta, normalizeOrZero(forwardVector));
    const forwardVelocityPeak = Math.max(0, ...this.window.map((entry) => entry.speed));
    const forwardAccelerationPeak = Math.max(0, ...this.window.map((entry) => entry.accel));
    // 速度ピーク時点の速度方向（突きの瞬間の向き）を方向分類の第一候補にする。
    const peakEntry = this.window.reduce(
      (candidate, entry) => (entry.speed > candidate.speed ? entry : candidate),
      observed,
    );
    const peakDir = normalizeOrZero(peakEntry.velocity);
    const peakVelocityDir = magnitude(peakDir) < 1e-9 ? null : peakDir;
    // 検出は window peak ベース（診断表示と一致させ、速度ピークと加速度ピークが別 sample でも
    // 取りこぼしによる「画面は全OKなのに発火しない」混乱を防ぐ。
    const detected =
      hand.timestampMs - this.lastFireMs >= this.config.hakkeiCooldownMs &&
      forwardVelocityPeak > this.config.hakkeiMinForwardVelocity &&
      forwardAccelerationPeak > this.config.hakkeiMinForwardAcceleration &&
      netDistance > this.config.hakkeiMinForwardDisplacement &&
      forwardComponent > this.config.hakkeiForwardGateMin;

    if (detected) {
      this.lastFireMs = hand.timestampMs;
    }

    return {
      detected,
      timestampMs: hand.timestampMs,
      forwardVelocityPeak,
      forwardAccelerationPeak,
      forwardDisplacement: netDistance,
      forwardComponent,
      netDelta,
      peakVelocityDir,
    };
  }
}

// 両手パンチの実機チューニング用ライブ診断（HakkeiReady 中に画面表示）。
export type DualHakkeiDiagnostics = {
  right: HakkeiObservation | null; // 直近 observe の右手（ピーク v/a/d）
  left: HakkeiObservation | null; // 直近 observe の左手（左手なしは null）
  rightFired: boolean; // 右手が複合条件を満たし発火待ち（同期待ち）か
  leftFired: boolean; // 左手が発火待ちか
  syncGapMs: number | null; // 両手発火済みなら timestamp 差
};

export class DualHakkeiDetector {
  private readonly config: DualHakkeiConfig;
  private readonly right: HakkeiDetector;
  private readonly left: HakkeiDetector;
  private rightDetection: HakkeiObservation | null = null;
  private leftDetection: HakkeiObservation | null = null;
  private lastRight: HakkeiObservation | null = null;
  private lastLeft: HakkeiObservation | null = null;

  constructor(config: DualHakkeiConfig) {
    this.config = config;
    this.right = new HakkeiDetector(config);
    this.left = new HakkeiDetector(config);
  }

  reset(): void {
    this.right.reset();
    this.left.reset();
    this.rightDetection = null;
    this.leftDetection = null;
    this.lastRight = null;
    this.lastLeft = null;
  }

  /** 実機チューニング用に直近の左右の観測と発火・同期状態を返す（HakkeiReady の診断表示）。 */
  diagnostics(): DualHakkeiDiagnostics {
    const syncGapMs =
      this.rightDetection !== null && this.leftDetection !== null
        ? Math.abs(this.rightDetection.timestampMs - this.leftDetection.timestampMs)
        : null;
    return {
      right: this.lastRight,
      left: this.lastLeft,
      rightFired: this.rightDetection !== null,
      leftFired: this.leftDetection !== null,
      syncGapMs,
    };
  }

  observe(sample: MotionSample, forwardVector: Vec3): HakkeiObservation {
    const rightObserved = this.right.observe(rightHandKinematics(sample), forwardVector);
    this.lastRight = rightObserved;
    if (rightObserved.detected) {
      this.rightDetection = rightObserved;
    }

    const leftHand = leftHandKinematics(sample);
    if (leftHand !== null) {
      const leftObserved = this.left.observe(leftHand, forwardVector);
      this.lastLeft = leftObserved;
      if (leftObserved.detected) {
        this.leftDetection = leftObserved;
      }
    } else {
      this.lastLeft = null;
    }

    if (this.rightDetection === null || this.leftDetection === null) {
      return { ...NO_DETECTION, timestampMs: sample.timestampMs };
    }

    const diffMs = Math.abs(this.rightDetection.timestampMs - this.leftDetection.timestampMs);
    if (diffMs > this.config.dualHakkeiSyncWindowMs) {
      return { ...NO_DETECTION, timestampMs: sample.timestampMs };
    }

    const result = averageObservation(this.rightDetection, this.leftDetection);
    this.rightDetection = null;
    this.leftDetection = null;
    return result;
  }
}

// 注: netDelta は左右平均（両手パンチの代表方向）。将来「右手は上・左手は前」等の左右別ジェスチャを
// 分類する隠しイベントを作るなら、平均ではなく rightNetDelta/leftNetDelta を保持する形へ拡張する
// （[[hidden-events-direction-vision]]）。
function averageObservation(right: HakkeiObservation, left: HakkeiObservation): HakkeiObservation {
  return {
    detected: true,
    timestampMs: Math.max(right.timestampMs, left.timestampMs),
    forwardVelocityPeak: (right.forwardVelocityPeak + left.forwardVelocityPeak) / 2,
    forwardAccelerationPeak: (right.forwardAccelerationPeak + left.forwardAccelerationPeak) / 2,
    forwardDisplacement: (right.forwardDisplacement + left.forwardDisplacement) / 2,
    forwardComponent: (right.forwardComponent + left.forwardComponent) / 2,
    netDelta: {
      x: (right.netDelta.x + left.netDelta.x) / 2,
      y: (right.netDelta.y + left.netDelta.y) / 2,
      z: (right.netDelta.z + left.netDelta.z) / 2,
    },
    // 方向の平均は意味を持たないため null（DualHakkei は Phase B/dev 用・方向分類は単手 path で行う）。
    peakVelocityDir: null,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// forwardVector を単位ベクトル化。零ベクトル（degenerate）なら 0 を返し前方 gate を安全側に倒す。
function normalizeOrZero(v: Vec3): Vec3 {
  const m = magnitude(v);
  if (m < 1e-9) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
