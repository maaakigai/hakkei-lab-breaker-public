// test/motion-sample-builder.test.mjs
// MotionSampleBuilder: 座標補正 + フィルタ統合（M7-01/02）。
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MotionSampleBuilder } from "../src/main/motionSampleBuilder.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");

// z 反転・2倍スケールの座標 + 通常 filter。
const input = {
  ...loaded.value.input,
  coordinates: {
    ...loaded.value.input.coordinates,
    sign: { x: 1, y: 1, z: -1 },
    scaleMultiplier: 2.0,
  },
};

const pkt = (seq, t, hand) => ({
  protocolVersion: 1,
  type: "motion",
  sessionId: "s1",
  seq,
  timestampMs: t,
  source: "unity-bridge",
  isTracked: true,
  rightHand: hand,
  avatar: { isHuman: true, hasRightHand: true, forward: { x: 0, y: 0, z: 1 } },
});

const pktV2 = (seq, t, rightHand, leftHand, avatar = {}) => ({
  protocolVersion: 2,
  type: "motion",
  sessionId: "s1",
  seq,
  timestampMs: t,
  source: "unity-bridge",
  isTracked: true,
  rightHand,
  leftHand,
  avatar: {
    isHuman: true,
    hasRightHand: true,
    hasLeftHand: true,
    forward: { x: 0, y: 0, z: 1 },
    ...avatar,
  },
});

const ctx = { seqGap: false, measuredHz: 30, droppedFrameCount: 0 };

test("座標補正: axisMap/sign/scale/offset を rawHandPosition に適用 (M7)", () => {
  const b = new MotionSampleBuilder(input);
  const s = b.build(pkt(0, 0, { x: 1, y: 2, z: 3 }), 100, ctx);
  assert.deepEqual(s.rawHandPosition, { x: 2, y: 4, z: -6 }); // *2, z反転
  assert.equal(s.handPosition.y, 4); // 初回 filtered = raw
  assert.equal(s.quality.isFiltered, true);
});

test("2サンプル目: filtered は raw に向かい、velocity は正で減衰している (M7-04/05)", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pkt(0, 0, { x: 0, y: 0, z: 0 }), 100, ctx); // baseline y=0
  const s2 = b.build(pkt(1, 33, { x: 0, y: 0.5, z: 0 }), 133, ctx); // raw y=1.0
  assert.equal(s2.rawHandPosition.y, 1.0);
  assert.ok(s2.handPosition.y > 0 && s2.handPosition.y < 1.0, `filtered=${s2.handPosition.y}`);
  assert.ok(s2.velocity.y > 0, `vy=${s2.velocity.y}`);
  assert.equal(s2.validForScore, true);
});

test("dtMs を計算する (M7-02)", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pkt(0, 0, { x: 0, y: 0, z: 0 }), 100, ctx);
  const s2 = b.build(pkt(1, 33, { x: 0, y: 0.1, z: 0 }), 133, ctx);
  assert.equal(s2.quality.dtMs, 33);
});

test("droppedFrameCount は ctx から反映 (M7-03)", () => {
  const b = new MotionSampleBuilder(input);
  const s = b.build(pkt(0, 0, { x: 0, y: 0, z: 0 }), 100, { ...ctx, droppedFrameCount: 4 });
  assert.equal(s.quality.droppedFrameCount, 4);
});

test("unavailable packet は validForScore=false で座標保持", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pkt(0, 0, { x: 1, y: 1, z: 1 }), 100, ctx);
  const s = b.build(
    {
      ...pkt(1, 33, null),
      isTracked: false,
      avatar: { isHuman: true, hasRightHand: false, forward: { x: 0, y: 0, z: 1 } },
    },
    133,
    ctx,
  );
  assert.equal(s.isAvailable, false);
  assert.equal(s.validForScore, false);
  assert.deepEqual(s.rawHandPosition, { x: 2, y: 2, z: -2 });
  assert.ok(s.quality.flags.includes("NOT_TRACKED"));
});

test("v2 packet から leftHand の位置・速度・加速度を右手と独立に生成する", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pktV2(0, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 100, ctx);
  const s2 = b.build(pktV2(1, 33, { x: 0, y: 0.1, z: 0 }, { x: 0, y: 0.5, z: 0 }), 133, ctx);

  assert.ok(s2.leftHand);
  assert.equal(s2.leftHand.rawHandPosition.y, 1.0);
  assert.ok(s2.leftHand.handPosition.y > 0 && s2.leftHand.handPosition.y < 1.0);
  assert.ok(s2.leftHand.velocity.y > 0);
  assert.ok(s2.leftHand.acceleration.y > 0);
  assert.equal(s2.leftHand.validForScore, true);
  assert.ok(s2.velocity.y > 0);
});

test("左右独立: 左手の位置 jump 外れ値は右手の validity と filtered を汚さない", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pktV2(0, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 100, ctx);
  const s2 = b.build(pktV2(1, 33, { x: 0, y: 0.1, z: 0 }, { x: 2, y: 0, z: 0 }), 133, ctx);

  assert.equal(s2.validForScore, true);
  assert.ok(s2.handPosition.y > 0);
  assert.ok(s2.leftHand);
  assert.equal(s2.leftHand.validForScore, false);
  assert.deepEqual(s2.leftHand.handPosition, { x: 0, y: 0, z: 0 });
  assert.ok(s2.leftHand.quality.flags.includes("OUTLIER_POSITION_JUMP"));
});

test("v1 packet は leftHand=null のまま右手出力を維持する", () => {
  const b = new MotionSampleBuilder(input);
  const s = b.build(pkt(0, 0, { x: 1, y: 2, z: 3 }), 100, ctx);
  assert.equal(s.leftHand, null);
  assert.deepEqual(s.rawHandPosition, { x: 2, y: 4, z: -6 });
  assert.equal(s.validForScore, true);
});

test("v2 leftHand unavailable は左手を unavailable sample として生成する", () => {
  const b = new MotionSampleBuilder(input);
  b.build(pktV2(0, 0, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), 100, ctx);
  const s = b.build(
    pktV2(1, 33, { x: 0, y: 0.1, z: 0 }, null, { hasLeftHand: false }),
    133,
    ctx,
  );

  assert.ok(s.leftHand);
  assert.equal(s.leftHand.isAvailable, false);
  assert.equal(s.leftHand.validForScore, false);
  assert.deepEqual(s.leftHand.rawHandPosition, { x: 2, y: 2, z: -2 });
  assert.deepEqual(s.leftHand.velocity, { x: 0, y: 0, z: 0 });
});
