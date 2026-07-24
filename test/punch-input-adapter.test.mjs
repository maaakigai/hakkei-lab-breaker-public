import test from "node:test";
import assert from "node:assert/strict";

import { PunchInputAdapter } from "../src/main/punchInputAdapter.ts";

// 最小の MotionSample を組み立てる（keyboard 経路相当）。
function sample({
  px = 0,
  py = 0,
  pz = 0,
  ax = 0,
  ay = 0,
  az = 0,
  seq = 1,
  t = 0,
  validForScore = true,
  isAvailable = true,
  flags = [],
}) {
  const pos = { x: px, y: py, z: pz };
  return {
    protocolVersion: 1,
    source: "keyboard",
    sessionId: "kb-1",
    seq,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: pos,
    handPosition: pos,
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: ax, y: ay, z: az },
    isAvailable,
    validForScore,
    validForCalibration: false,
    leftHand: null,
    quality: {
      dtMs: 20,
      sampleRateHz: 50,
      isFiltered: true,
      droppedFrameCount: 0,
      invalidPacketCount: 0,
      flags,
    },
  };
}

test("最初の有効 sample は chargeDelta=0・baseline を据える", () => {
  const a = new PunchInputAdapter(0.01);
  const out = a.fromMotionSample(sample({ px: 1, seq: 1 }));
  assert.equal(out.chargeDelta, 0);
  assert.equal(out.strength.motionAmount, 0);
  assert.equal(out.source, "keyboard");
  assert.equal(out.protocolVersion, 1);
});

test("noise 閾値超の移動で chargeDelta が増え、motionAmount は baseline からの距離", () => {
  const a = new PunchInputAdapter(0.01);
  a.fromMotionSample(sample({ px: 0, seq: 1 }));
  const out = a.fromMotionSample(sample({ px: 0.5, seq: 2, t: 20 }));
  assert.ok(out.chargeDelta > 0.49 && out.chargeDelta < 0.51);
  assert.ok(out.strength.motionAmount > 0.49 && out.strength.motionAmount < 0.51);
});

test("noise 閾値以下の微小揺れは chargeDelta=0（静止）", () => {
  const a = new PunchInputAdapter(0.05);
  a.fromMotionSample(sample({ px: 0, seq: 1 }));
  const out = a.fromMotionSample(sample({ px: 0.01, seq: 2, t: 20 }));
  assert.equal(out.chargeDelta, 0);
});

test("idleMs は静止中に dt を積み、動いたら 0 に戻る", () => {
  const a = new PunchInputAdapter(0.05);
  const s1 = a.fromMotionSample(sample({ px: 0, seq: 1, t: 0 }));
  const s2 = a.fromMotionSample(sample({ px: 0.01, seq: 2, t: 20 }));
  const s3 = a.fromMotionSample(sample({ px: 0.01, seq: 3, t: 40 }));
  const moved = a.fromMotionSample(sample({ px: 0.2, seq: 4, t: 60 }));
  assert.equal(s1.idleMs, 20);
  assert.equal(s2.idleMs, 40);
  assert.equal(s3.idleMs, 60);
  assert.equal(moved.idleMs, 0);
});

test("intensity は加速度の magnitude（方向なし）", () => {
  const a = new PunchInputAdapter(0.01);
  const out = a.fromMotionSample(sample({ ax: 3, ay: 0, az: 4 }));
  assert.ok(Math.abs(out.strength.intensity - 5) < 1e-9);
  assert.equal(out.strength.intensityPeak, out.strength.intensity);
});

test("無効 sample は積算しない＋連続性を切る（復帰で巨大変位を作らない）", () => {
  const a = new PunchInputAdapter(0.01);
  a.fromMotionSample(sample({ px: 0, seq: 1 }));
  const invalid = a.fromMotionSample(sample({ px: 5, seq: 2, t: 20, validForScore: false }));
  assert.equal(invalid.chargeDelta, 0);
  assert.equal(invalid.idleMs, 0);
  assert.ok(invalid.quality.flags.length >= 0);
  // 復帰後の最初の有効 sample は chargeDelta=0（prevPos が切れているため）。
  const back = a.fromMotionSample(sample({ px: 9, seq: 3, t: 40 }));
  assert.equal(back.chargeDelta, 0);
});

test("isAvailable=false は INPUT_UNAVAILABLE フラグを出す", () => {
  const a = new PunchInputAdapter(0.01);
  const out = a.fromMotionSample(sample({ isAvailable: false, validForScore: false }));
  assert.ok(out.quality.flags.includes("INPUT_UNAVAILABLE"));
  assert.equal(out.isAvailable, false);
});
