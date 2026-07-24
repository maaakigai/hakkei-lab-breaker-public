// src/main/motionFilter.ts
//
// MotionSample のフィルタ段（SPEC.md 0.6, M7-04〜08）。
//   - Hz 非依存 EMA（config alpha を基準Hz基準とし、実dtへ変換）で位置/速度/加速度を平滑化。
//   - dt 異常（DT_TOO_SMALL / DT_TOO_LARGE）と外れ値（位置jump / 速度 / 加速度）を flag 化し、
//     score へは入れない（validForScore=false）が sample 自体は生成する。
//   - JitterTracker は2秒window の raw/filtered jitter(RMS/Max)・drift を出す。

import type { InputConfig } from "../shared/configTypes.ts";
import type { MotionQualityFlag, Vec3 } from "../shared/types.ts";

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function norm(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function ema(prev: Vec3, next: Vec3, alpha: number): Vec3 {
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
    z: prev.z + alpha * (next.z - prev.z),
  };
}

export type FilterResult = {
  filteredPosition: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  validForScore: boolean;
  flags: MotionQualityFlag[];
};

type FilterCfg = InputConfig["filter"];

export class MotionFilter {
  private readonly cfg: FilterCfg;
  private readonly referenceDtMs: number;

  private prevFiltered: Vec3 | null = null;
  private prevVel: Vec3 = { ...ZERO };
  private prevAccel: Vec3 = { ...ZERO };

  constructor(cfg: FilterCfg) {
    this.cfg = cfg;
    this.referenceDtMs = 1000 / cfg.referenceHz;
  }

  reset(): void {
    this.prevFiltered = null;
    this.prevVel = { ...ZERO };
    this.prevAccel = { ...ZERO };
  }

  private alphaEff(alphaRef: number, dtMs: number): number {
    // α_eff = 1 - (1 - α_ref)^(dtMs / referenceDtMs)
    const a = 1 - Math.pow(1 - alphaRef, dtMs / this.referenceDtMs);
    return Math.min(1, Math.max(0, a));
  }

  /**
   * 補正後 raw 位置を1サンプル分処理する。
   * available=false のときは呼び出し側が baseline 保持を判断するが、ここでも安全側に倒す。
   */
  process(rawPos: Vec3, dtMs: number, available: boolean): FilterResult {
    const flags: MotionQualityFlag[] = [];

    if (!available) {
      // 直前 filtered を保持。速度・加速度0。
      return {
        filteredPosition: this.prevFiltered ?? { ...rawPos },
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: false,
        flags,
      };
    }

    // 初回サンプル: baseline を作る。速度は出さない。
    if (this.prevFiltered === null) {
      this.prevFiltered = { ...rawPos };
      this.prevVel = { ...ZERO };
      this.prevAccel = { ...ZERO };
      return {
        filteredPosition: { ...rawPos },
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: true,
        flags,
      };
    }

    // dt 異常
    if (dtMs < this.cfg.minDtMs) {
      flags.push("DT_TOO_SMALL");
      return {
        filteredPosition: { ...this.prevFiltered },
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: false,
        flags,
      };
    }
    if (dtMs > this.cfg.maxDtMs) {
      flags.push("DT_TOO_LARGE", "TIMESTAMP_GAP");
      this.prevFiltered = { ...rawPos };
      this.prevVel = { ...ZERO };
      this.prevAccel = { ...ZERO };
      return {
        filteredPosition: { ...rawPos },
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: false,
        flags,
      };
    }

    const dtSec = dtMs / 1000;

    // 位置 jump 外れ値: filtered を動かさず保持。
    const jump = norm(sub(rawPos, this.prevFiltered));
    if (jump > this.cfg.maxPositionJump) {
      flags.push("OUTLIER_POSITION_JUMP");
      return {
        filteredPosition: { ...this.prevFiltered },
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: false,
        flags,
      };
    }

    // 位置 EMA
    const filtered = ema(this.prevFiltered, rawPos, this.alphaEff(this.cfg.positionEmaAlpha, dtMs));

    // 速度（filtered の差分 → EMA）
    const velRaw: Vec3 = {
      x: (filtered.x - this.prevFiltered.x) / dtSec,
      y: (filtered.y - this.prevFiltered.y) / dtSec,
      z: (filtered.z - this.prevFiltered.z) / dtSec,
    };
    const velocity = ema(this.prevVel, velRaw, this.alphaEff(this.cfg.velocityEmaAlpha, dtMs));

    // 速度 外れ値: 0 にして baseline reset。
    if (norm(velocity) > this.cfg.maxReasonableVelocity) {
      flags.push("OUTLIER_VELOCITY");
      this.prevFiltered = { ...filtered };
      this.prevVel = { ...ZERO };
      this.prevAccel = { ...ZERO };
      return {
        filteredPosition: filtered,
        velocity: { ...ZERO },
        acceleration: { ...ZERO },
        validForScore: false,
        flags,
      };
    }

    // 加速度（速度の差分 → EMA）
    const accelRaw: Vec3 = {
      x: (velocity.x - this.prevVel.x) / dtSec,
      y: (velocity.y - this.prevVel.y) / dtSec,
      z: (velocity.z - this.prevVel.z) / dtSec,
    };
    let acceleration = ema(this.prevAccel, accelRaw, this.alphaEff(this.cfg.accelerationEmaAlpha, dtMs));

    let validForScore = true;
    if (norm(acceleration) > this.cfg.maxReasonableAcceleration) {
      // diagnostic 用に clamp し、score には使わない。
      flags.push("OUTLIER_ACCELERATION");
      validForScore = false;
      const mag = norm(acceleration);
      const k = this.cfg.maxReasonableAcceleration / mag;
      acceleration = { x: acceleration.x * k, y: acceleration.y * k, z: acceleration.z * k };
    }

    this.prevFiltered = { ...filtered };
    this.prevVel = { ...velocity };
    this.prevAccel = { ...acceleration };

    return { filteredPosition: filtered, velocity, acceleration, validForScore, flags };
  }
}

// --- Jitter（2秒window, SPEC.md 13.5） -----------------------------------

export type JitterMetrics = {
  rawJitterRms2s: number | null;
  rawMaxJitter2s: number | null;
  rawDrift2s: number | null;
  filteredJitterRms2s: number | null;
  filteredMaxJitter2s: number | null;
  filteredDrift2s: number | null;
};

type JitterSample = { t: number; raw: Vec3; filtered: Vec3 };

export class JitterTracker {
  private readonly windowMs: number;
  private samples: JitterSample[] = [];

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  reset(): void {
    this.samples = [];
  }

  add(raw: Vec3, filtered: Vec3, timestampMs: number): void {
    this.samples.push({ t: timestampMs, raw, filtered });
    const cutoff = timestampMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  private static stats(points: Vec3[]): { rms: number; max: number; drift: number } {
    const n = points.length;
    const mean: Vec3 = { x: 0, y: 0, z: 0 };
    for (const p of points) {
      mean.x += p.x;
      mean.y += p.y;
      mean.z += p.z;
    }
    mean.x /= n;
    mean.y /= n;
    mean.z /= n;
    let sumSq = 0;
    let max = 0;
    for (const p of points) {
      const d = norm(sub(p, mean));
      sumSq += d * d;
      if (d > max) max = d;
    }
    const drift = norm(sub(points[n - 1], points[0]));
    return { rms: Math.sqrt(sumSq / n), max, drift };
  }

  /** 2秒windowが十分に埋まっていれば指標を返す。足りなければ null。 */
  metrics(): JitterMetrics {
    const span = this.samples.length >= 2 ? this.samples[this.samples.length - 1].t - this.samples[0].t : 0;
    if (this.samples.length < 10 || span < this.windowMs * 0.9) {
      return {
        rawJitterRms2s: null,
        rawMaxJitter2s: null,
        rawDrift2s: null,
        filteredJitterRms2s: null,
        filteredMaxJitter2s: null,
        filteredDrift2s: null,
      };
    }
    const raw = JitterTracker.stats(this.samples.map((s) => s.raw));
    const fil = JitterTracker.stats(this.samples.map((s) => s.filtered));
    return {
      rawJitterRms2s: raw.rms,
      rawMaxJitter2s: raw.max,
      rawDrift2s: raw.drift,
      filteredJitterRms2s: fil.rms,
      filteredMaxJitter2s: fil.max,
      filteredDrift2s: fil.drift,
    };
  }
}
