import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import { DirectionProbe } from "../src/renderer/directionProbe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const HK = { ...loaded.value.score.hakkei, hiddenChargeGate: loaded.value.score.hiddenChargeGate };

const FORWARD = { x: 0, y: 0, z: 1 };
const UP = { x: 0, y: 1, z: 0 };

function sample(t, pos, vel, acc) {
  return {
    protocolVersion: 1, source: "unity-bridge", sessionId: "p", seq: t,
    timestampMs: t, receivedAtMs: t,
    rawHandPosition: pos, handPosition: pos, velocity: vel, acceleration: acc,
    isAvailable: true, validForScore: true, validForCalibration: true, leftHand: null,
    quality: { dtMs: 16, sampleRateHz: 60, isFiltered: true, droppedFrameCount: 0, invalidPacketCount: 0, flags: [] },
  };
}

// axis 方向へ dist 動く punch（速度/加速度十分）。
function punch(probe, startT, axis, dist, speed = 2.0, accel = 10.0) {
  let result = null;
  for (let i = 0; i < 5; i++) {
    const f = (dist * i) / 4;
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const acc = { x: 0, y: 0, z: 0 };
    pos[axis] = f;
    vel[axis] = i < 4 ? Math.sign(dist) * speed : 0;
    acc[axis] = i < 4 ? Math.sign(dist) * accel : 0;
    const r = probe.observe(sample(startT + i * 50, pos, vel, acc), "right", FORWARD, UP);
    if (r !== null) result = r;
  }
  return result;
}

test("DirectionProbe: 前突きは即座に forward を返す", () => {
  const probe = new DirectionProbe(HK);
  const r = punch(probe, 0, "z", 0.3);
  assert.equal(r?.trigger, "forward");
  assert.ok(r.components.dotForward > 0.9);
});

test("DirectionProbe: 下突きは down、上突きは up", () => {
  const p1 = new DirectionProbe(HK);
  assert.equal(punch(p1, 0, "y", -0.3)?.trigger, "down");
  const p2 = new DirectionProbe(HK);
  assert.equal(punch(p2, 0, "y", 0.3)?.trigger, "up");
});

test("DirectionProbe: 静止（揺れ）は発火しない（パンチ認定しない・ユーザ要望）", () => {
  const probe = new DirectionProbe(HK);
  let fired = 0;
  for (let i = 0; i < 40; i++) {
    // ±5mm のゆっくりした揺れ（体の向き変化相当）。速度・加速度は小さい。
    const j = Math.sin(i / 5) * 0.005;
    const v = Math.cos(i / 5) * 0.05; // 遅い
    const r = probe.observe(sample(i * 50, { x: j, y: 0, z: 0 }, { x: v, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), "right", FORWARD, UP);
    if (r !== null) fired += 1;
  }
  assert.equal(fired, 0);
});

test("DirectionProbe: 拳を戻す動作はパンチと誤検知しない（不応期・ユーザ要望）", () => {
  const probe = new DirectionProbe(HK);
  const results = [];
  let t = 0;
  const feed = (pos, vel, acc) => {
    const r = probe.observe(sample(t, pos, vel, acc), "right", FORWARD, UP);
    if (r !== null) results.push(r.trigger);
    t += 50;
  };
  // 前へ突く（前進・加速度あり）。
  for (let i = 0; i < 5; i++) {
    feed({ x: 0, y: 0, z: (0.3 * i) / 4 }, { x: 0, y: 0, z: i < 4 ? 2.5 : 0 }, { x: 0, y: 0, z: i < 4 ? 10 : 0 });
  }
  // すぐ戻す（後退・速度/加速度高い）。これは発火してはいけない。
  for (let i = 0; i < 5; i++) {
    feed({ x: 0, y: 0, z: 0.3 - (0.3 * i) / 4 }, { x: 0, y: 0, z: i < 4 ? -2.5 : 0 }, { x: 0, y: 0, z: i < 4 ? -10 : 0 });
  }
  // 静止して落ち着く（再武装）。
  for (let i = 0; i < 6; i++) {
    feed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  }
  // forward 1回だけ。戻し(back)は出ない。
  assert.deepEqual(results, ["forward"]);
});

test("DirectionProbe: 静止して再武装した後は次の突きを検知できる", () => {
  const probe = new DirectionProbe(HK);
  const results = [];
  let t = 0;
  const feed = (pos, vel, acc) => {
    const r = probe.observe(sample(t, pos, vel, acc), "right", FORWARD, UP);
    if (r !== null) results.push(r.trigger);
    t += 50;
  };
  const forwardPunch = () => {
    for (let i = 0; i < 5; i++) feed({ x: 0, y: 0, z: (0.3 * i) / 4 }, { x: 0, y: 0, z: i < 4 ? 2.5 : 0 }, { x: 0, y: 0, z: i < 4 ? 10 : 0 });
  };
  const settle = () => {
    for (let i = 0; i < 10; i++) feed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  };
  forwardPunch();
  settle();
  forwardPunch();
  settle();
  assert.deepEqual(results, ["forward", "forward"]);
});

test("DirectionProbe: 1突きで1結果（cooldown 中の継続フレームは発火しない）", () => {
  const probe = new DirectionProbe(HK);
  let fired = 0;
  for (let i = 0; i < 5; i++) {
    const f = (0.3 * i) / 4;
    const r = probe.observe(
      sample(i * 50, { x: 0, y: 0, z: f }, { x: 0, y: 0, z: i < 4 ? 2.0 : 0 }, { x: 0, y: 0, z: i < 4 ? 10 : 0 }),
      "right", FORWARD, UP,
    );
    if (r !== null) fired += 1;
  }
  assert.equal(fired, 1);
});
