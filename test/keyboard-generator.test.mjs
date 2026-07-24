// test/keyboard-generator.test.mjs
// KeyboardSampleGenerator creates Main-owned MotionSample values.
import test from "node:test";
import assert from "node:assert/strict";

import { KeyboardSampleGenerator } from "../src/main/keyboardSampleGenerator.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";
import { DualHakkeiDetector } from "../src/renderer/hakkeiDetector.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) {
  throw new Error("config load failed: " + loaded.messageJa);
}
const KB = loaded.value.input.keyboard;
const HAKKEI_MIN_VEL = loaded.value.score.hakkei.hakkeiMinForwardVelocity;
const HAKKEI = loaded.value.score.hakkei;
const FORWARD = loaded.value.input.coordinates.defaultForwardVector;
const TICK_MS = 1000 / KB.sampleRateHz;

function makeGen() {
  let clock = 1_000_000;
  const samples = [];
  const sessions = [];
  const gen = new KeyboardSampleGenerator(
    (s) => samples.push(s),
    (info) => sessions.push(info),
    KB,
    () => clock,
  );
  const advance = (n) => {
    for (let i = 0; i < n; i++) {
      clock += TICK_MS;
      gen.tick();
    }
  };
  const press = (key, pressed) =>
    gen.handleControl({ type: "key", key, pressed, repeat: false, occurredAtMs: clock });
  return { gen, samples, sessions, advance, press };
}

test("idle emits sequential keyboard samples with both hands available", () => {
  const { gen, samples, advance } = makeGen();
  gen.openSession("keyboard-start");
  advance(30);
  assert.equal(samples.length, 30);
  assert.ok(samples.every((s) => s.source === "keyboard"));
  assert.ok(samples.every((s) => s.protocolVersion === 1));
  assert.ok(samples.every((s) => s.validForScore === true));
  assert.ok(samples.every((s) => s.leftHand?.validForScore === true));
  for (let i = 1; i < samples.length; i++) {
    assert.equal(samples[i].seq, samples[i - 1].seq + 1);
  }
  assert.ok(samples.slice(5).every((s) => Math.abs(s.handPosition.y) < 1e-9));
  assert.ok(samples.slice(5).every((s) => Math.abs(s.leftHand.handPosition.y) < 1e-9));
});

test("Space taps move the right hand back and forth for charge", () => {
  const { gen, samples, advance, press } = makeGen();
  gen.openSession("keyboard-start");

  const tap = () => {
    press("Space", true);
    press("Space", false);
  };

  tap();
  advance(20);
  const yTap1 = samples[samples.length - 1].handPosition.y;
  assert.ok(yTap1 > 0.1, `right y=${yTap1}`);

  tap();
  advance(20);
  const yTap2 = samples[samples.length - 1].handPosition.y;
  assert.ok(yTap2 < yTap1, `${yTap1} -> ${yTap2}`);

  for (let i = 0; i < 6; i++) {
    tap();
    advance(15);
  }
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += Math.abs(samples[i].handPosition.y - samples[i - 1].handPosition.y);
  }
  assert.ok(total > 0.5, `total=${total}`);
});

test("leftChargeKey moves leftHand independently from the right hand", () => {
  const { gen, samples, advance, press } = makeGen();
  gen.openSession("keyboard-start");

  press(KB.leftChargeKey, true);
  press(KB.leftChargeKey, false);
  advance(20);
  const afterLeft = samples[samples.length - 1];
  assert.ok(afterLeft.leftHand);
  assert.ok(Math.abs(afterLeft.leftHand.handPosition.y) > 0.1, `left y=${afterLeft.leftHand.handPosition.y}`);
  assert.ok(Math.abs(afterLeft.handPosition.y) < 1e-9, `right y=${afterLeft.handPosition.y}`);

  press("Space", true);
  press("Space", false);
  advance(20);
  const afterRight = samples[samples.length - 1];
  assert.ok(Math.abs(afterRight.handPosition.y) > 0.1, `right y=${afterRight.handPosition.y}`);
  assert.ok(afterRight.leftHand);
  assert.ok(Math.abs(afterRight.leftHand.handPosition.y) > 0.1, `left y=${afterRight.leftHand.handPosition.y}`);
});

test("holding Space does not repeatedly flip charge direction", () => {
  const { gen, samples, advance, press } = makeGen();
  gen.openSession("keyboard-start");
  press("Space", true);
  gen.handleControl({ type: "key", key: "Space", pressed: true, repeat: true, occurredAtMs: 0 });
  advance(40);
  const tail = samples.slice(20);
  const maxDelta = Math.max(
    ...tail.slice(1).map((s, i) => Math.abs(s.handPosition.y - tail[i].handPosition.y)),
  );
  assert.ok(maxDelta < 1e-6, `maxDelta=${maxDelta}`);
});

test("Enter creates synced right and left forward pulses detected by DualHakkeiDetector", () => {
  const { gen, samples, advance, press } = makeGen();
  gen.openSession("keyboard-start");
  press("Enter", true);
  advance(20);
  const maxVz = Math.max(...samples.map((s) => s.velocity.z));
  const maxLeftVz = Math.max(...samples.map((s) => s.leftHand.velocity.z));
  assert.ok(maxVz >= HAKKEI_MIN_VEL, `maxVz=${maxVz.toFixed(2)}`);
  assert.ok(maxLeftVz >= HAKKEI_MIN_VEL, `maxLeftVz=${maxLeftVz.toFixed(2)}`);
  const detector = new DualHakkeiDetector(HAKKEI);
  assert.ok(samples.some((s) => detector.observe(s, FORWARD).detected));
});

test("openSession notifies session and resets seq", () => {
  const { gen, samples, sessions, advance } = makeGen();
  gen.openSession("keyboard-start");
  advance(5);
  gen.openSession("reset-play");
  advance(5);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].reason, "reset-play");
  assert.equal(samples[5].seq, 0);
});
