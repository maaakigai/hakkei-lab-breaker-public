import test from "node:test";
import assert from "node:assert/strict";

import { SampleRecorder } from "../src/renderer/sampleRecorder.ts";

function sample(t) {
  return {
    protocolVersion: 1,
    source: "unity-bridge",
    sessionId: "rec",
    seq: t,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: { x: 0, y: 0, z: 0 },
    handPosition: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    isAvailable: true,
    validForScore: true,
    validForCalibration: true,
    leftHand: null,
    quality: { dtMs: 16, sampleRateHz: 60, isFiltered: true, droppedFrameCount: 0, invalidPacketCount: 0, flags: [] },
  };
}

const META = {
  recordedAtIso: "2026-06-26T00:00:00Z",
  commitSha: "test",
  note: "",
  dominantHand: "right",
  calibration: { source: "measured", forwardVector: { x: 0, y: 0, z: 1 }, upVector: { x: 0, y: 1, z: 0 }, neutralHandPositionRaw: null },
  config: { score: {}, input: {}, app: {} },
};

test("SampleRecorder: armed の間だけ frames を積む", () => {
  const r = new SampleRecorder();
  r.push(sample(0)); // not armed → 無視
  assert.equal(r.status().frameCount, 0);
  r.arm();
  r.push(sample(10));
  r.push(sample(20));
  assert.equal(r.status().frameCount, 2);
});

test("SampleRecorder: trial 境界 start/end が timestamp で付く", () => {
  const r = new SampleRecorder();
  r.beginTrial("forward", "right"); // 自動 arm
  r.push(sample(100));
  r.push(sample(150));
  r.push(sample(200));
  const marker = r.endTrial();
  assert.equal(marker.label, "forward");
  assert.equal(marker.startTimestampMs, 100);
  assert.equal(marker.endTimestampMs, 200);
});

test("SampleRecorder: sample が来ない空 trial は破棄される", () => {
  const r = new SampleRecorder();
  r.beginTrial("static", "right");
  const marker = r.endTrial();
  assert.equal(marker, null);
  assert.equal(r.status().trialCount, 0);
});

test("SampleRecorder: build は連続 frames＋trials＋meta を持つ RecordingFile を返す", () => {
  const r = new SampleRecorder();
  r.beginTrial("forward", "right", "valid", 5);
  r.push(sample(0));
  r.push(sample(50));
  r.endTrial();
  r.beginTrial("down", "left", "bad-form", 10);
  r.push(sample(1000));
  r.push(sample(1050));
  // endTrial を呼ばず build → open trial を閉じる
  const rec = r.build(META);
  assert.equal(rec.schemaVersion, 1);
  assert.equal(rec.frames.length, 4);
  assert.equal(rec.trials.length, 2);
  assert.equal(rec.trials[0].label, "forward");
  assert.equal(rec.trials[0].chargeRaw, 5);
  assert.equal(rec.trials[1].label, "down");
  assert.equal(rec.trials[1].operatorVerdict, "bad-form");
  assert.equal(rec.trials[1].endTimestampMs, 1050);
});

test("SampleRecorder: reset で全消去", () => {
  const r = new SampleRecorder();
  r.beginTrial("forward", "right");
  r.push(sample(0));
  r.reset();
  assert.deepEqual(r.status(), { armed: false, frameCount: 0, trialCount: 0, openTrialLabel: null });
});
