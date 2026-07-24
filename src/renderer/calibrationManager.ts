// src/renderer/calibrationManager.ts
//
// Calibration（SPEC.md 0.14 / 12章, M8）。
//   - Main 生成の validForCalibration=true の sample だけを使う（rawHandPosition）。
//   - discard 300ms → neutral 2000ms(>=40 valid) → forward 1000ms(>=20 valid, >=0.15m)。
//   - 時間進行は performance.now() 基準（SPEC.md 0.15）。
//   - Keyboard は pseudo calibration（default vector）で待たせない（M8-07）。
// score/filter/validity は再計算しない。

import type { CoordinateConfig } from "../shared/configTypes.ts";
import type { CalibrationResult, MotionSample, MotionSource, Vec3 } from "../shared/types.ts";

// SPEC.md 12.4 の固定値。
export const CALIB = {
  discardMs: 300,
  neutralCaptureMs: 2000,
  neutralMinSamples: 40,
  forwardCaptureMs: 1000,
  forwardMinSamples: 20,
  minHz: 25,
  forwardMinDistanceM: 0.15,
  filteredJitterMaxM: 0.03,
  unavailableFailMs: 500,
} as const;

export type CalibrationPhase = "idle" | "discard" | "neutral" | "forward" | "complete" | "failed";

export type CalibrationFailReason =
  | "LOW_SAMPLE_RATE"
  | "RIGHT_HAND_UNAVAILABLE"
  | "JITTER_WARN"
  | "FORWARD_DISTANCE_TOO_SMALL"
  | "SESSION_CHANGED"
  | "INSUFFICIENT_SAMPLES"
  | "FORWARD_VECTOR_INVALID";

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function norm(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function mean(points: Vec3[]): Vec3 {
  const s = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
  const n = points.length || 1;
  return { x: s.x / n, y: s.y / n, z: s.z / n };
}
function normalize(v: Vec3): Vec3 | null {
  const m = norm(v);
  if (!Number.isFinite(m) || m < 1e-9) {
    return null;
  }
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

export type CalibrationSnapshot = {
  phase: CalibrationPhase;
  neutralCount: number;
  forwardCount: number;
  remainingMs: number;
  result: CalibrationResult | null;
  failReason: CalibrationFailReason | null;
};

export class CalibrationManager {
  private readonly coord: CoordinateConfig;
  private phase: CalibrationPhase = "idle";
  private source: MotionSource = "unity-bridge";
  private sessionId = "";
  private calibrationId = "";
  private phaseStartMs = 0;

  private neutral: Vec3[] = [];
  private leftNeutral: Vec3[] = [];
  private forward: Vec3[] = [];
  private neutralMean: Vec3 = { x: 0, y: 0, z: 0 };

  private unavailableSinceMs: number | null = null;
  private motionHz = 0;
  private filteredJitterRms2s = 0;

  private result: CalibrationResult | null = null;
  private failReason: CalibrationFailReason | null = null;

  constructor(coord: CoordinateConfig) {
    this.coord = coord;
  }

  start(source: MotionSource, sessionId: string, nowMs: number, calibrationId: string): void {
    this.phase = "discard";
    this.source = source;
    this.sessionId = sessionId;
    this.calibrationId = calibrationId;
    this.phaseStartMs = nowMs;
    this.neutral = [];
    this.leftNeutral = [];
    this.forward = [];
    this.unavailableSinceMs = null;
    this.result = null;
    this.failReason = null;
  }

  setQuality(motionHz: number, filteredJitterRms2s: number | null): void {
    this.motionHz = motionHz;
    if (filteredJitterRms2s !== null) {
      this.filteredJitterRms2s = filteredJitterRms2s;
    }
  }

  private fail(reason: CalibrationFailReason): void {
    this.phase = "failed";
    this.failReason = reason;
  }

  onSample(sample: MotionSample, nowMs: number): void {
    if (this.phase !== "discard" && this.phase !== "neutral" && this.phase !== "forward") {
      return;
    }
    // source / session が変わったら失敗（SPEC.md 0.14）。
    if (sample.source !== this.source || sample.sessionId !== this.sessionId) {
      this.fail("SESSION_CHANGED");
      return;
    }
    // validForCalibration=false が連続 500ms 以上なら失敗。
    if (!sample.validForCalibration) {
      if (this.unavailableSinceMs === null) {
        this.unavailableSinceMs = nowMs;
      } else if (nowMs - this.unavailableSinceMs >= CALIB.unavailableFailMs) {
        this.fail("RIGHT_HAND_UNAVAILABLE");
      }
      return;
    }
    this.unavailableSinceMs = null;

    if (this.phase === "neutral") {
      this.neutral.push(sample.rawHandPosition);
      if (sample.leftHand?.validForCalibration === true) {
        this.leftNeutral.push(sample.leftHand.handPosition);
      }
    } else if (this.phase === "forward") {
      this.forward.push(sample.rawHandPosition);
    }
  }

  /** 時間で phase を進める。 */
  tick(nowMs: number): CalibrationSnapshot {
    const elapsed = nowMs - this.phaseStartMs;
    if (this.phase === "discard" && elapsed >= CALIB.discardMs) {
      this.phase = "neutral";
      this.phaseStartMs = nowMs;
      this.neutral = [];
      this.leftNeutral = [];
    } else if (this.phase === "neutral" && elapsed >= CALIB.neutralCaptureMs) {
      this.finishNeutral(nowMs);
    } else if (this.phase === "forward" && elapsed >= CALIB.forwardCaptureMs) {
      this.finishForward(nowMs);
    }
    return this.snapshot(nowMs);
  }

  private finishNeutral(nowMs: number): void {
    if (this.motionHz < CALIB.minHz) {
      this.fail("LOW_SAMPLE_RATE");
      return;
    }
    if (this.filteredJitterRms2s > CALIB.filteredJitterMaxM) {
      this.fail("JITTER_WARN");
      return;
    }
    if (this.neutral.length < CALIB.neutralMinSamples) {
      this.fail("INSUFFICIENT_SAMPLES");
      return;
    }
    this.neutralMean = mean(this.neutral);
    this.phase = "forward";
    this.phaseStartMs = nowMs;
    this.forward = [];
  }

  private finishForward(nowMs: number): void {
    if (this.forward.length < CALIB.forwardMinSamples) {
      this.fail("INSUFFICIENT_SAMPLES");
      return;
    }
    const forwardMean = mean(this.forward);
    const delta = sub(forwardMean, this.neutralMean);
    const distance = norm(delta);
    if (distance < CALIB.forwardMinDistanceM) {
      this.fail("FORWARD_DISTANCE_TOO_SMALL");
      return;
    }
    const forwardVector = normalize(delta);
    if (forwardVector === null) {
      this.fail("FORWARD_VECTOR_INVALID");
      return;
    }
    const upVector = normalize(this.coord.defaultUpVector) ?? { x: 0, y: 1, z: 0 };
    const leftNeutralHandPosition = this.leftNeutral.length > 0 ? mean(this.leftNeutral) : null;

    this.result = {
      calibrationId: this.calibrationId,
      source: this.source,
      sessionId: this.sessionId,
      completedAtMs: nowMs,
      neutralHandPositionRaw: this.neutralMean,
      leftNeutralHandPosition,
      forwardVector,
      upVector,
      quality: {
        neutralSampleCount: this.neutral.length,
        forwardSampleCount: this.forward.length,
        filteredJitterRms2s: this.filteredJitterRms2s,
        motionHz: this.motionHz,
      },
    };
    this.phase = "complete";
  }

  /** Keyboard 用の pseudo calibration（default vector・待たない, M8-07）。 */
  pseudo(source: MotionSource, sessionId: string, nowMs: number, calibrationId: string): CalibrationResult {
    const forwardVector = normalize(this.coord.defaultForwardVector) ?? { x: 0, y: 0, z: 1 };
    const upVector = normalize(this.coord.defaultUpVector) ?? { x: 0, y: 1, z: 0 };
    this.result = {
      calibrationId,
      source,
      sessionId,
      completedAtMs: nowMs,
      neutralHandPositionRaw: { x: 0, y: 0, z: 0 },
      leftNeutralHandPosition: null,
      forwardVector,
      upVector,
      quality: { neutralSampleCount: 0, forwardSampleCount: 0, filteredJitterRms2s: 0, motionHz: 0 },
    };
    this.phase = "complete";
    return this.result;
  }

  private remainingMs(nowMs: number): number {
    const elapsed = nowMs - this.phaseStartMs;
    if (this.phase === "discard") return Math.max(0, CALIB.discardMs - elapsed);
    if (this.phase === "neutral") return Math.max(0, CALIB.neutralCaptureMs - elapsed);
    if (this.phase === "forward") return Math.max(0, CALIB.forwardCaptureMs - elapsed);
    return 0;
  }

  snapshot(nowMs: number): CalibrationSnapshot {
    return {
      phase: this.phase,
      neutralCount: this.neutral.length,
      forwardCount: this.forward.length,
      remainingMs: this.remainingMs(nowMs),
      result: this.result,
      failReason: this.failReason,
    };
  }
}
