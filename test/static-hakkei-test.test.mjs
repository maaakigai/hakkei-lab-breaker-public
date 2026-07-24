// test/static-hakkei-test.test.mjs
// M10-07: static-hakkei-false-positive-test ハーネス（SPEC §0.16.1）の単体検証。
// validForScore のみ評価・cooldown reset・window 経過で確定・PASS=count<=maxCount。
import test from "node:test";
import assert from "node:assert/strict";

import { StaticHakkeiFalsePositiveTest } from "../src/renderer/staticHakkeiTest.ts";
import { HakkeiDetector } from "../src/renderer/hakkeiDetector.ts";

const FORWARD = { x: 0, y: 0, z: 1 };

// minForwardVelocity=2.0，minForwardAcceleration=8.0，minForwardDisplacement=0.08，cooldown=300ms とする．
function makeHarness(windowMs = 10000, maxCount = 0) {
  return new StaticHakkeiFalsePositiveTest(
    new HakkeiDetector({
      hakkeiMinForwardVelocity: 2.0,
      hakkeiMinForwardAcceleration: 8.0,
      hakkeiMinForwardDisplacement: 0.08,
      hakkeiForwardGateMin: 0.03,
      hakkeiWindowMs: 200,
      hakkeiCooldownMs: 300,
    }),
    FORWARD,
    windowMs,
    maxCount,
  );
}

function sample({ vz = 0, az = 0, pz = 0, t = 0, validForScore = true }) {
  return {
    protocolVersion: 1,
    source: "unity-bridge",
    sessionId: "t",
    seq: 0,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: { x: 0, y: 0, z: pz },
    handPosition: { x: 0, y: 0, z: pz },
    velocity: { x: 0, y: 0, z: vz },
    acceleration: { x: 0, y: 0, z: az },
    isAvailable: true,
    validForScore,
    validForCalibration: false,
    quality: { dtMs: 33, sampleRateHz: 30, isFiltered: true, droppedFrameCount: 0, invalidPacketCount: 0, flags: [] },
  };
}

test("静止（閾値未満）は誤検出0で PASS", () => {
  const h = makeHarness();
  h.start(0);
  for (let i = 0; i < 300; i++) {
    h.feed(sample({ vz: 0.05, t: i * 33 }), i * 33); // 微小, 閾値2.0未満
  }
  h.finish();
  const s = h.status(11000);
  assert.equal(s.count, 0);
  assert.equal(s.passed, true);
  assert.equal(s.done, true);
  assert.ok(s.sampleCount > 0);
});

test("閾値超えの前方速度は誤検出として数え、FAIL（maxCount=0）", () => {
  const h = makeHarness();
  h.start(0);
  // 各発勁の直前sampleを window に入れ，cooldown を跨ぐよう十分な間隔を空ける．
  h.feed(sample({ t: 0 }), 0);
  h.feed(sample({ vz: 3.0, az: 12, pz: 0.1, t: 100 }), 100);
  h.feed(sample({ pz: 0.1, t: 400 }), 400);
  h.feed(sample({ vz: 3.0, az: 12, pz: 0.2, t: 500 }), 500);
  h.feed(sample({ pz: 0.2, t: 800 }), 800);
  h.feed(sample({ vz: 3.0, az: 12, pz: 0.3, t: 900 }), 900);
  h.finish();
  const s = h.status(11000);
  assert.equal(s.count, 3);
  assert.equal(s.passed, false);
});

test("validForScore=false の sample は評価しない（SPEC §0.16.1）", () => {
  const h = makeHarness();
  h.start(0);
  h.feed(sample({ vz: 9.0, t: 0, validForScore: false }), 0); // 巨大だが invalid
  h.feed(sample({ vz: 9.0, t: 400, validForScore: false }), 400);
  h.finish();
  const s = h.status(11000);
  assert.equal(s.count, 0);
  assert.equal(s.sampleCount, 0);
});

test("window 経過後の sample は計上しない", () => {
  const h = makeHarness(1000, 0);
  h.start(0);
  h.feed(sample({ t: 400 }), 400);
  h.feed(sample({ vz: 3.0, az: 12, pz: 0.1, t: 500 }), 500); // window 内 → 計上
  h.feed(sample({ vz: 3.0, t: 1500 }), 1500); // window 外 → finish され計上されない
  const s = h.status(2000);
  assert.equal(s.count, 1);
  assert.equal(s.done, true);
});

test("start は cooldown と count を reset する（再実行で前回値を持ち越さない）", () => {
  const h = makeHarness();
  h.start(0);
  h.feed(sample({ t: 0 }), 0);
  h.feed(sample({ vz: 3.0, az: 12, pz: 0.1, t: 100 }), 100);
  h.finish();
  assert.equal(h.status(11000).count, 1);
  // 再実行
  h.start(20000);
  h.feed(sample({ vz: 0.05, t: 20000 }), 20000);
  h.finish();
  const s = h.status(31000);
  assert.equal(s.count, 0);
  assert.equal(s.passed, true);
});
