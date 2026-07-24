// src/renderer/playAccumulator.ts
//
// Pure raw play accumulation logic. Charge is the 3D path length of the hand
// assigned to each phase. Renderer consumes Main-generated MotionSample values
// only and does not recalculate filter, velocity, acceleration, or validity.

import type { Vec3 } from "../shared/types.ts";

// 単手モデル（§0.23.3）の単手1段 "Charge"。旧 2段 "VerticalCharge"/"ForwardCharge" は
// 当面残す（mock/旧経路・M15-05 で UI からは使わない）。Charge は利き手の Σ|Δp| を rightChargeRaw に積む。
export type ChargePhase = "Charge" | "VerticalCharge" | "ForwardCharge";

export interface PlayRaw {
  rightChargeRaw: number;
  leftChargeRaw: number;
  hakkeiDetected: boolean;
  hakkeiTimedOut: boolean;
  prevPos: Vec3 | null;
  prevPhase: ChargePhase | null;
}

export function freshPlay(): PlayRaw {
  return {
    rightChargeRaw: 0,
    leftChargeRaw: 0,
    hakkeiDetected: false,
    hakkeiTimedOut: false,
    prevPos: null,
    prevPhase: null,
  };
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function accumulateCharge(
  play: PlayRaw,
  phase: ChargePhase,
  handPosition: Vec3 | null,
  validForScore: boolean,
  noiseThreshold: number,
): boolean {
  if (!validForScore || handPosition === null) {
    return false;
  }

  if (play.prevPhase !== phase) {
    play.prevPhase = phase;
    play.prevPos = null;
  }

  const p = handPosition;
  if (play.prevPos === null) {
    play.prevPos = { x: p.x, y: p.y, z: p.z };
    return true;
  }

  const delta = distance(p, play.prevPos);
  play.prevPos = { x: p.x, y: p.y, z: p.z };
  if (delta <= noiseThreshold) {
    return true;
  }

  // 単手 Charge と旧 VerticalCharge は利き手チャージ＝rightChargeRaw に積む。ForwardCharge のみ left。
  if (phase === "ForwardCharge") {
    play.leftChargeRaw += delta;
  } else {
    play.rightChargeRaw += delta;
  }
  return true;
}
