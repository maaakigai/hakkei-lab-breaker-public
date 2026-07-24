// test/calibration-manager.test.mjs
// M8/P2: Calibration phase transitions，success/failure，pseudo，and dual-hand neutral capture.
import test from "node:test";
import assert from "node:assert/strict";
import { CalibrationManager, CALIB } from "../src/renderer/calibrationManager.ts";

const coord = {
  axisMap: { x: "x", y: "y", z: "z" },
  sign: { x: 1, y: 1, z: 1 },
  scaleMultiplier: 1,
  offset: { x: 0, y: 0, z: 0 },
  defaultUpVector: { x: 0, y: 1, z: 0 },
  defaultForwardVector: { x: 0, y: 0, z: 1 },
  coordinateWarnAbsM: 3,
  coordinateInvalidAbsM: 10,
};

function sample(pos, valid = true) {
  return {
    source: "mock-unity-bridge",
    sessionId: "s1",
    rawHandPosition: pos,
    validForCalibration: valid,
  };
}

function leftHand(pos, valid = true) {
  return {
    rawHandPosition: pos,
    handPosition: pos,
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    isAvailable: valid,
    validForScore: valid,
    validForCalibration: valid,
    quality: {
      dtMs: 33.3,
      sampleRateHz: 30,
      isFiltered: true,
      droppedFrameCount: 0,
      invalidPacketCount: 0,
      flags: [],
    },
  };
}

function assertVecNearly(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon, `x=${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < epsilon, `y=${actual.y}`);
  assert.ok(Math.abs(actual.z - expected.z) < epsilon, `z=${actual.z}`);
}

function runCalibration(neutralPos, forwardPos, hz = 30, jitter = 0.01, makeSample = sample) {
  const m = new CalibrationManager(coord);
  let t = 0;
  m.start("mock-unity-bridge", "s1", t, "c1");
  m.setQuality(hz, jitter);
  const step = 1000 / hz;
  const feed = (pos, durationMs) => {
    const end = t + durationMs;
    while (t < end) {
      t += step;
      m.onSample(makeSample(pos, t), t);
      m.tick(t);
    }
  };
  feed(neutralPos, CALIB.discardMs + step);
  feed(neutralPos, CALIB.neutralCaptureMs + step);
  feed(forwardPos, CALIB.forwardCaptureMs + step);
  m.tick(t + step);
  return m.snapshot(t + step);
}

test("success: neutral still，forward 0.3m completes with normalized forwardVector (M8-02/03/04)", () => {
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 });
  assert.equal(snap.phase, "complete");
  assert.ok(snap.result);
  assert.ok(Math.abs(snap.result.forwardVector.z - 1) < 1e-6, `fz=${snap.result.forwardVector.z}`);
  assert.ok(snap.result.quality.neutralSampleCount >= CALIB.neutralMinSamples);
  assert.deepEqual(snap.result.upVector, { x: 0, y: 1, z: 0 });
});

test("v2 dual-hand input captures leftNeutralHandPosition independently from right neutral (P2)", () => {
  const makeSample = (pos, t) => {
    const leftX = t < CALIB.discardMs + 1 ? 9 : 2;
    return { ...sample(pos), leftHand: leftHand({ x: leftX, y: 0.5, z: -0.25 }) };
  };
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 }, 30, 0.01, makeSample);
  assert.equal(snap.phase, "complete");
  assert.ok(snap.result);
  assertVecNearly(snap.result.neutralHandPositionRaw, { x: 0, y: 1.2, z: 0 });
  assert.ok(snap.result.leftNeutralHandPosition);
  assertVecNearly(snap.result.leftNeutralHandPosition, { x: 2, y: 0.5, z: -0.25 });
});

test("v1/no left hand keeps leftNeutralHandPosition null and right calibration succeeds (P2)", () => {
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 });
  assert.equal(snap.phase, "complete");
  assert.ok(snap.result);
  assert.equal(snap.result.leftNeutralHandPosition, null);
  assert.ok(Math.abs(snap.result.forwardVector.z - 1) < 1e-6);
});

test("left hand unavailable does not fail right-hand calibration and leaves left neutral null (P2)", () => {
  const makeSample = (pos) => ({ ...sample(pos), leftHand: leftHand({ x: -1, y: -1, z: -1 }, false) });
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 }, 30, 0.01, makeSample);
  assert.equal(snap.phase, "complete");
  assert.ok(snap.result);
  assert.equal(snap.result.leftNeutralHandPosition, null);
  assert.ok(Math.abs(snap.result.forwardVector.z - 1) < 1e-6);
});

test("failure: forward distance < 0.15m is FORWARD_DISTANCE_TOO_SMALL (M8-04)", () => {
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.05 });
  assert.equal(snap.phase, "failed");
  assert.equal(snap.failReason, "FORWARD_DISTANCE_TOO_SMALL");
});

test("failure: Hz < 25 is LOW_SAMPLE_RATE or insufficient samples (M8-06)", () => {
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 }, 20);
  assert.equal(snap.phase, "failed");
  assert.ok(snap.failReason === "LOW_SAMPLE_RATE" || snap.failReason === "INSUFFICIENT_SAMPLES");
});

test("failure: jitter > 0.03 is JITTER_WARN (M8-06)", () => {
  const snap = runCalibration({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: 0.3 }, 30, 0.05);
  assert.equal(snap.phase, "failed");
  assert.equal(snap.failReason, "JITTER_WARN");
});

test("failure: validForCalibration=false for 500ms is RIGHT_HAND_UNAVAILABLE", () => {
  const m = new CalibrationManager(coord);
  let t = 0;
  m.start("mock-unity-bridge", "s1", t, "c1");
  m.setQuality(30, 0.01);
  for (let i = 0; i < 400; i++) {
    t += 1000 / 30;
    m.onSample(sample({ x: 0, y: 1, z: 0 }, false), t);
    m.tick(t);
  }
  assert.equal(m.snapshot(t).phase, "failed");
  assert.equal(m.snapshot(t).failReason, "RIGHT_HAND_UNAVAILABLE");
});

test("session change fails with SESSION_CHANGED", () => {
  const m = new CalibrationManager(coord);
  m.start("mock-unity-bridge", "s1", 0, "c1");
  m.tick(400);
  m.onSample({ ...sample({ x: 0, y: 1, z: 0 }), sessionId: "s2" }, 410);
  assert.equal(m.snapshot(410).failReason, "SESSION_CHANGED");
});

test("pseudo: Keyboard completes immediately with default vectors (M8-07)", () => {
  const m = new CalibrationManager(coord);
  const r = m.pseudo("keyboard", "kb1", 100, "c1");
  assert.equal(m.snapshot(100).phase, "complete");
  assert.equal(r.leftNeutralHandPosition, null);
  assert.deepEqual(r.forwardVector, { x: 0, y: 0, z: 1 });
  assert.deepEqual(r.upVector, { x: 0, y: 1, z: 0 });
});
