// src/main/punchInputAdapter.ts
//
// MotionSample（位置ベース・keyboard / unity 系）→ PunchInputSample（入力非依存 core 契約）への adapter（V2b）。
//
// 設計:
//   - stateful（prevPos / prevTs / baselinePos を保持）。Main 側に置く（Main-generated 原則）。
//   - chargeDelta = noise 閾値付き Σ|Δp|（accumulateCharge と同じ思想）。
//   - accelEnergy = |acceleration|（方向を持たない magnitude）。motionAmount = baseline からの距離。
//   - mocopi-ble は別 builder（V4・probe GO 後）で同じ PunchInputSample を直接生成する。
//
// 純粋・副作用なし（時刻は MotionSample 由来の値だけを使う）。

import type { MotionSample } from "../shared/types.ts";
import type {
  PunchInputQualityFlag,
  PunchInputSample,
} from "../shared/punchInput.ts";

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function magnitude(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// MotionQualityFlag のうち core が気にするものだけ PunchInputQualityFlag へ写像する。
function mapFlags(sample: MotionSample): PunchInputQualityFlag[] {
  const out: PunchInputQualityFlag[] = [];
  const f = sample.quality.flags;
  if (f.includes("DT_RESET")) out.push("DT_RESET");
  if (f.includes("DT_TOO_LARGE")) out.push("DT_TOO_LARGE");
  if (f.includes("LOW_SAMPLE_RATE")) out.push("LOW_SAMPLE_RATE");
  if (!sample.isAvailable) out.push("INPUT_UNAVAILABLE");
  return out;
}

export class PunchInputAdapter {
  private prevPos: { x: number; y: number; z: number } | null;
  private baselinePos: { x: number; y: number; z: number } | null;
  private noiseThreshold: number;
  private idleMs = 0;

  constructor(noiseThreshold: number) {
    this.prevPos = null;
    this.baselinePos = null;
    this.noiseThreshold = noiseThreshold;
  }

  // source 切替・play 再開・接続復帰などで baseline / 連続性をリセットする。
  reset(): void {
    this.prevPos = null;
    this.baselinePos = null;
    this.idleMs = 0;
  }

  // 1 つの MotionSample を PunchInputSample へ変換する。chargeDelta は前回有効 sample からの増分。
  fromMotionSample(sample: MotionSample): PunchInputSample {
    const valid = sample.validForScore && sample.isAvailable;
    const pos = sample.handPosition;

    let chargeDelta = 0;
    let motionAmount = 0;

    if (valid) {
      if (this.baselinePos === null) {
        this.baselinePos = { x: pos.x, y: pos.y, z: pos.z };
      }
      motionAmount = distance(pos, this.baselinePos);

      if (this.prevPos === null) {
        this.prevPos = { x: pos.x, y: pos.y, z: pos.z };
      } else {
        const delta = distance(pos, this.prevPos);
        this.prevPos = { x: pos.x, y: pos.y, z: pos.z };
        if (delta > this.noiseThreshold) {
          chargeDelta = delta;
        }
      }
    } else {
      // 無効 sample は連続性を切る（復帰時に巨大な見かけ変位を作らない）。
      this.prevPos = null;
    }

    if (valid && chargeDelta === 0) {
      this.idleMs += Math.max(0, sample.quality.dtMs);
    } else {
      this.idleMs = 0;
    }

    const intensity = magnitude(sample.acceleration);

    return {
      protocolVersion: 1,
      source: sample.source,
      sessionId: sample.sessionId,
      seq: sample.seq,
      timestampMs: sample.timestampMs,
      receivedAtMs: sample.receivedAtMs,
      validForScore: sample.validForScore,
      isAvailable: sample.isAvailable,
      chargeDelta,
      idleMs: this.idleMs,
      strength: {
        // keyboard 経路は擬似加速度 magnitude を intensity に正規化。
        intensity,
        // window ピークは detector(V3a) が更新する。adapter は瞬間値を入れておく。
        intensityPeak: intensity,
        motionAmount,
      },
      quality: {
        sampleRateHz: sample.quality.sampleRateHz,
        dtMs: sample.quality.dtMs,
        flags: mapFlags(sample),
      },
    };
  }
}
