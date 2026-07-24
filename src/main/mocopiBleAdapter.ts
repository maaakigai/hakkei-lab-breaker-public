// src/main/mocopiBleAdapter.ts
//
// mocopi-ble packet（quaternion）→ PunchInputSample（V4・Main 側）。
//
// 実機検証（2026-06-27・docs/technical-notes/mocopi-ble-signal-validation.md）で確定:
//   パンチ/運動の信号は **連続 quaternion 間の回転角（角速度）**。packet の accel は動きに無反応で使わない。
//   静止 ~0.04 deg/sample・パンチ ~16 deg/sample（約400x 分離）。
//
// 設計:
//   - stateful（前 quaternion / 前 seq / 前 timestamp）。Main が生成（不変ルール）。
//   - intensity = 角速度 deg/s（rate 非依存）。chargeDelta = 1サンプルの回転角 deg（noise 以上）→ 積分で総回転量。
//   - quaternion は使う前に必ず正規化（int16/8192 は厳密 unit でないため・replay バグで実証）。
//   - **速度の dt は「seq差 × 公称周期(1000/sampleRateHz)」で求める**。実測（2026-06-27 measure-2786）で
//     BLE 通知が2個まとめて届く（バースト）ため packet の timestampMs はホスト到着時刻のジッタ（dt≈1ms）を
//     持ち、それで割ると角速度が約20倍に爆発した。デバイスは正確に 50Hz・seq は受信フレーム毎に単調増加
//     なので seq差×20ms が正しい（欠落時も seq差で正しく伸びる）。
//   - gap/再接続の検出だけは**ホスト時刻 timestampMs の差**を使う（大きな見かけ角での誤発火を防ぐ）。
//   - dt が大きすぎる/初回/seq 非単調は連続性を切る。

import type {
  MocopiBlePacketV1,
  PunchInputQualityFlag,
  PunchInputSample,
} from "../shared/punchInput.ts";

type Quat = { w: number; x: number; y: number; z: number };

export type MocopiBleAdapterOptions = {
  // この角度(deg/sample)以下の回転は静止 jitter として charge に積まない。
  noiseAngleDeg?: number;
  // この dt(ms) を超えたら連続性を切る（gap）。
  maxDtMs?: number;
};

function isFiniteQuat(q: Quat): boolean {
  return (
    Number.isFinite(q.w) && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z)
  );
}

function normalize(q: Quat): Quat | null {
  const n = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (!(n > 1e-9)) {
    return null;
  }
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

function dot(a: Quat, b: Quat): number {
  return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}

// 2 つの単位 quaternion 間の回転角（度）。符号反転（q と -q は同じ向き）は abs で吸収。
function angleDeg(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(dot(a, b)));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

export class MocopiBleAdapter {
  private prevQuat: Quat | null;
  private prevTs: number | null; // 前 packet のホスト timestampMs（gap 検出用）。
  private prevSeq: number | null; // 前 packet の seq（速度 dt 用）。
  private noiseAngleDeg: number;
  private maxDtMs: number;
  private idleMs = 0;

  constructor(opts?: MocopiBleAdapterOptions) {
    this.prevQuat = null;
    this.prevTs = null;
    this.prevSeq = null;
    this.noiseAngleDeg = opts?.noiseAngleDeg ?? 0.5;
    this.maxDtMs = opts?.maxDtMs ?? 100;
  }

  // 接続復帰・session 変更などで連続性をリセットする。
  reset(): void {
    this.prevQuat = null;
    this.prevTs = null;
    this.prevSeq = null;
    this.idleMs = 0;
  }

  fromPacket(pkt: MocopiBlePacketV1, receivedAtMs: number): PunchInputSample {
    const flags: PunchInputQualityFlag[] = [];
    const q = isFiniteQuat(pkt.quat) ? normalize(pkt.quat) : null;
    const isAvailable = q !== null;

    let angle = 0; // この sample の回転角（deg）
    let angVelDegPerSec = 0; // 角速度（deg/s）
    let dtMs = 0;
    let hasDelta = false;

    if (q !== null) {
      if (this.prevQuat !== null && this.prevTs !== null && this.prevSeq !== null) {
        // 速度の dt は seq 差 × 公称周期（ホスト到着ジッタ＝バーストの影響を受けない）。
        const rateHz = pkt.sampleRateHz && pkt.sampleRateHz > 0 ? pkt.sampleRateHz : 50;
        const nominalDtMs = 1000 / rateHz;
        const seqDelta = pkt.seq - this.prevSeq;
        const velDtMs = seqDelta * nominalDtMs;
        const hostDtMs = pkt.timestampMs - this.prevTs; // gap 検出はホスト時刻で。
        dtMs = velDtMs; // 報告 dt は速度算出に使った実効 dt。
        if (seqDelta >= 1 && velDtMs > 0 && velDtMs <= this.maxDtMs && hostDtMs <= this.maxDtMs) {
          angle = angleDeg(this.prevQuat, q);
          angVelDegPerSec = (angle / velDtMs) * 1000;
          hasDelta = true;
        } else if (hostDtMs > this.maxDtMs || velDtMs > this.maxDtMs) {
          flags.push("DT_TOO_LARGE"); // gap/再接続（大きな見かけ角を作らない）。
        } else {
          flags.push("DT_RESET"); // seq 非単調・重複・逆順。
        }
      } else {
        flags.push("DT_RESET"); // 初回
      }
      this.prevQuat = q;
      this.prevTs = pkt.timestampMs;
      this.prevSeq = pkt.seq;
    } else {
      flags.push("INPUT_UNAVAILABLE");
      this.prevQuat = null;
      this.prevTs = null;
      this.prevSeq = null;
    }

    const sampleRateHz = pkt.sampleRateHz ?? (dtMs > 0 ? 1000 / dtMs : 0);
    if (sampleRateHz > 0 && sampleRateHz < 40) {
      flags.push("LOW_SAMPLE_RATE");
    }

    const validForScore = isAvailable && hasDelta;
    const chargeDelta = hasDelta ? Math.max(0, angle - this.noiseAngleDeg) : 0;
    if (validForScore && chargeDelta === 0) {
      this.idleMs += Math.max(0, dtMs);
    } else {
      this.idleMs = 0;
    }

    return {
      protocolVersion: 1,
      source: "mocopi-ble",
      sessionId: pkt.sessionId,
      seq: pkt.seq,
      timestampMs: pkt.timestampMs,
      receivedAtMs,
      validForScore,
      isAvailable,
      chargeDelta,
      idleMs: this.idleMs,
      strength: {
        // BLE の強さ＝角速度 deg/s。window ピークは detector(punchCore) が更新する。
        intensity: angVelDegPerSec,
        intensityPeak: angVelDegPerSec,
        motionAmount: angle,
      },
      quality: {
        sampleRateHz,
        dtMs,
        flags,
      },
    };
  }
}
