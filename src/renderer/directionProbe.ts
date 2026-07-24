// src/renderer/directionProbe.ts
//
// 方向判定テスト（dev）。突くたびに「どの trigger になるか」を即座に出すためのプローブ。
// 本番と同じ HakkeiDetector + resolveTrigger を使うので、表示＝実ゲームの判定。
// チャージ局面はないので charge は十分大（gate 影響を外す）＝方向そのものを見る。

import { HakkeiDetector } from "./hakkeiDetector.ts";
import { directionComponents, handKinematicsFor, resolveTrigger, strengthBars, type DirectionComponents } from "./outcomeResolver.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import type { DominantHand, MotionSample, OutcomeTrigger, Vec3 } from "../shared/types.ts";

export type DirectionProbeResult = {
  trigger: OutcomeTrigger;
  timestampMs: number;
  speedPeak: number;
  accelPeak: number;
  netDistance: number;
  components: DirectionComponents | null; // dot 値（水平forward/up 基準）
};

type ProbeConfig = ScoreConfig["hakkei"] & { hiddenChargeGate: number };

// gate を外して方向そのものを見るための十分大きい charge。
const PROBE_CHARGE = Number.MAX_SAFE_INTEGER;

// 発火していない瞬間の「現在の強さ」（揺れが閾値未満で発火しないことを画面で確認するため）。
export type ProbeLiveStrength = {
  speedPeak: number;
  accelPeak: number;
  netDistance: number;
  strengthMet: boolean;
};

export class DirectionProbe {
  private readonly detector: HakkeiDetector;
  private readonly hk: ProbeConfig;
  private lastFireMs = Number.NEGATIVE_INFINITY;
  private lastLive: ProbeLiveStrength | null = null;
  // 不応期（rest-gate）: 1発火後、手が静止するまで次の発火を受け付けない。
  // 拳を戻す動作（速度が高いまま）を次のパンチと誤検知しないため。
  private armed = true;

  constructor(hk: ProbeConfig) {
    this.detector = new HakkeiDetector(hk);
    this.hk = hk;
  }

  reset(): void {
    this.detector.reset();
    this.lastFireMs = Number.NEGATIVE_INFINITY;
    this.lastLive = null;
    this.armed = true;
  }

  live(): ProbeLiveStrength | null {
    return this.lastLive;
  }

  // 1 sample 観測。発勁が成立した瞬間だけ結果を返す（cooldown で1突き1結果）。それ以外は null。
  observe(
    sample: MotionSample,
    dominantHand: DominantHand,
    forward: Vec3,
    up: Vec3,
  ): DirectionProbeResult | null {
    const hand = handKinematicsFor(sample, dominantHand);
    if (hand === null) {
      return null;
    }
    const obs = this.detector.observe(hand, forward);
    const bars = strengthBars(
      obs.forwardVelocityPeak,
      obs.forwardAccelerationPeak,
      obs.forwardDisplacement,
      this.hk,
    );
    const strengthMet = bars.forwardStrengthMet || bars.hiddenStrengthMet;
    this.lastLive = {
      speedPeak: obs.forwardVelocityPeak,
      accelPeak: obs.forwardAccelerationPeak,
      netDistance: obs.forwardDisplacement,
      strengthMet,
    };
    // 不応期: 発火後は **window のピーク速度が rest 以下に落ちるまで** 再武装しない。
    // ピーク速度は窓(≈400ms)に速い動きが残る限り高いままなので、突き→戻し→静止 が完全に
    // 終わってからだけ再武装する。戻し動作（速度が高い）は武装されず誤検知しない。
    if (!this.armed) {
      if (obs.forwardVelocityPeak < this.hk.idleMaxSpeed) {
        this.armed = true;
        this.detector.reset(); // 残ったピークを捨てて再武装直後の即発火を防ぐ
      }
      return null;
    }
    if (!strengthMet) {
      return null;
    }
    if (sample.timestampMs - this.lastFireMs < this.hk.hakkeiCooldownMs) {
      return null; // 同じ突きの継続フレーム（二度撃ち抑制）
    }

    const directionVector = obs.peakVelocityDir ?? obs.netDelta;
    const trigger = resolveTrigger(
      {
        forwardStrengthMet: bars.forwardStrengthMet,
        hiddenStrengthMet: bars.hiddenStrengthMet,
        directionVector,
        charge: PROBE_CHARGE, // gate を外して方向を見る
        forwardVector: forward,
        upVector: up,
      },
      {
        forwardCos: this.hk.forwardCos,
        dirCos: this.hk.dirCos,
        hiddenForwardLeakMax: this.hk.hiddenForwardLeakMax,
        hiddenChargeGate: this.hk.hiddenChargeGate,
      },
    );
    // 方向が決まらない buildup フレーム（noImpact）は消費しない（前突きの途中で誤確定しない）。
    // forward 強さが揃う前に hidden 強さだけ達しても、forward 方向なら noImpact になり、観測を続ける。
    if (trigger === "noImpact") {
      return null;
    }
    this.lastFireMs = sample.timestampMs;
    this.armed = false; // 確定 → 静止するまで不応期
    return {
      trigger,
      timestampMs: sample.timestampMs,
      speedPeak: obs.forwardVelocityPeak,
      accelPeak: obs.forwardAccelerationPeak,
      netDistance: obs.forwardDisplacement,
      components: directionComponents(directionVector, forward, up),
    };
  }
}
