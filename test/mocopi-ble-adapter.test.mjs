import test from "node:test";
import assert from "node:assert/strict";

import { MocopiBleAdapter } from "../src/main/mocopiBleAdapter.ts";

// 軸 z 周りに angleRad 回転した quaternion（w=cos(θ/2), z=sin(θ/2)）。
function quatZ(angleRad) {
  return { w: Math.cos(angleRad / 2), x: 0, y: 0, z: Math.sin(angleRad / 2) };
}

function packet({ quat, seq = 1, t = 0, sampleRateHz = 50 }) {
  return {
    protocolVersion: 1,
    type: "imu",
    source: "mocopi-ble",
    sensorId: "s",
    sessionId: "ble-1",
    seq,
    timestampMs: t,
    sampleRateHz,
    quat,
  };
}

test("初回 sample は DT_RESET・charge/strength は 0", () => {
  const a = new MocopiBleAdapter();
  const out = a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  assert.equal(out.chargeDelta, 0);
  assert.equal(out.strength.intensity, 0);
  assert.equal(out.validForScore, false);
  assert.ok(out.quality.flags.includes("DT_RESET"));
});

test("静止（同じ向き）は intensity≈0・charge 0", () => {
  const a = new MocopiBleAdapter();
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  const out = a.fromPacket(packet({ quat: quatZ(0), seq: 2, t: 20 }), 20);
  assert.ok(out.strength.intensity < 1e-6);
  assert.equal(out.chargeDelta, 0);
  assert.equal(out.idleMs, 20);
  assert.equal(out.validForScore, true);
});

test("idleMs は静止中に実効 dt をそのまま積み、回転で 0 に戻る", () => {
  const a = new MocopiBleAdapter({ noiseAngleDeg: 0.5 });
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  const idle1 = a.fromPacket(packet({ quat: quatZ(0), seq: 2, t: 20 }), 20);
  const idle2 = a.fromPacket(packet({ quat: quatZ(0), seq: 3, t: 40 }), 40);
  const moved = a.fromPacket(packet({ quat: quatZ(0.3), seq: 4, t: 60 }), 60);
  assert.equal(idle1.idleMs, 20);
  assert.equal(idle2.idleMs, 40);
  assert.equal(moved.idleMs, 0);
});

test("回転（パンチ）は intensity 大・charge 増加", () => {
  const a = new MocopiBleAdapter({ noiseAngleDeg: 0.5 });
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  // 20ms で 0.3rad(≈17.2deg) 回転 → 角速度 ≈ 859 deg/s（実機パンチ域に一致）。
  const out = a.fromPacket(packet({ quat: quatZ(0.3), seq: 2, t: 20 }), 20);
  assert.ok(out.strength.intensity > 800 && out.strength.intensity < 900);
  assert.ok(out.chargeDelta > 16); // 17.2deg - 0.5 noise
  assert.equal(out.validForScore, true);
});

test("BLE バースト（2個同時着でホスト dt≈1ms）でも seq 差で正しい角速度（20倍に爆発しない）", () => {
  // 実測 measure-2786: BLE 通知が2個まとめて届き timestampMs が約1ms差→旧実装は角速度20倍。
  const a = new MocopiBleAdapter({ noiseAngleDeg: 0.5 });
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  // ホスト到着は 1ms 後（バースト）だが seq は +1（=20ms 相当）。角度 17.2deg → 859 deg/s であるべき。
  const out = a.fromPacket(packet({ quat: quatZ(0.3), seq: 2, t: 1 }), 1);
  assert.ok(
    out.strength.intensity > 800 && out.strength.intensity < 900,
    `intensity=${out.strength.intensity}（20倍爆発なら ~17000 になる）`,
  );
  assert.equal(out.quality.dtMs, 20); // 実効 dt は seq 差 × 20ms
  assert.equal(out.validForScore, true);
});

test("パケット欠落（seq 飛び）は seq 差ぶん dt が伸びる（角速度が過大にならない）", () => {
  const a = new MocopiBleAdapter({ noiseAngleDeg: 0.5, maxDtMs: 100 });
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  // seq が 1→3（1個 drop）。dt=40ms。同じ 17.2deg なら 430 deg/s（20ms 時の半分）。
  const out = a.fromPacket(packet({ quat: quatZ(0.3), seq: 3, t: 40 }), 40);
  assert.equal(out.quality.dtMs, 40);
  assert.ok(out.strength.intensity > 420 && out.strength.intensity < 440, `intensity=${out.strength.intensity}`);
  assert.equal(out.validForScore, true);
});

test("dt が大きすぎる（gap）は DT_TOO_LARGE・charge 0・連続性リセット", () => {
  const a = new MocopiBleAdapter({ maxDtMs: 100 });
  a.fromPacket(packet({ quat: quatZ(0), seq: 1, t: 0 }), 0);
  const out = a.fromPacket(packet({ quat: quatZ(0.3), seq: 2, t: 500 }), 500); // 500ms gap
  assert.equal(out.chargeDelta, 0);
  assert.equal(out.validForScore, false);
  assert.ok(out.quality.flags.includes("DT_TOO_LARGE"));
});

test("非有限 quaternion は INPUT_UNAVAILABLE・isAvailable=false", () => {
  const a = new MocopiBleAdapter();
  const out = a.fromPacket(packet({ quat: { w: NaN, x: 0, y: 0, z: 0 }, seq: 1, t: 0 }), 0);
  assert.equal(out.isAvailable, false);
  assert.equal(out.validForScore, false);
  assert.ok(out.quality.flags.includes("INPUT_UNAVAILABLE"));
});

test("正規化していない quaternion でも角度が正しい（int16/8192 相当）", () => {
  const a = new MocopiBleAdapter();
  // norm 0.998 の非単位 quat を2つ（同じ向き）→ 静止として intensity≈0 になるべき。
  const q = { w: 0.156 * 0.998, x: 0.984 * 0.998, y: -0.005 * 0.998, z: 0.06 * 0.998 };
  a.fromPacket(packet({ quat: q, seq: 1, t: 0 }), 0);
  const out = a.fromPacket(packet({ quat: q, seq: 2, t: 20 }), 20);
  assert.ok(out.strength.intensity < 1e-3, `intensity=${out.strength.intensity}`);
});
