import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CALIB } from "../src/renderer/calibrationManager.ts";
import { MotionSampleBuilder } from "../src/main/motionSampleBuilder.ts";
import { validateDatagram } from "../src/main/packetValidator.ts";
import { createCalibProfile } from "../scripts/mock-unity-calib-profile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, "config", name), "utf8"));
const app = readJson("app.config.json");
const input = readJson("input.config.json");
const score = readJson("score.config.json");
const hz = input.udp.requiredSampleRateHz;
const profile = createCalibProfile({ app, input, score, calibration: CALIB, hz });

function motionPacket(tMs, seq) {
  const hands = profile.sampleHandsAt(tMs);
  return {
    protocolVersion: 2,
    type: "motion",
    sessionId: "mock-calib-profile-v2",
    seq,
    timestampMs: tMs,
    source: "mock-unity-bridge",
    isTracked: true,
    rightHand: { x: hands.rightHand.x, y: hands.rightHand.y, z: hands.rightHand.z },
    leftHand: { x: hands.leftHand.x, y: hands.leftHand.y, z: hands.leftHand.z },
    avatar: {
      isHuman: true,
      hasRightHand: true,
      hasLeftHand: true,
      forward: { x: 0, y: 0, z: 1 },
    },
  };
}

test("mock calib profile provides mirrored left hand for v2 packets (P1c)", () => {
  const tMs = profile.phases.neutralStartMs + 100;
  const packet = motionPacket(tMs, 0);

  assert.equal(packet.leftHand.x, -packet.rightHand.x);
  assert.equal(packet.leftHand.y, packet.rightHand.y);
  assert.equal(packet.leftHand.z, packet.rightHand.z);

  const datagram = JSON.stringify(packet);
  assert.equal(
    validateDatagram(datagram, Buffer.byteLength(datagram, "utf8"), input.udp.maxDatagramBytes).kind,
    "motion",
  );
});

test("mock v2 packets flow through MotionSampleBuilder with leftHand populated (P1c)", () => {
  const builder = new MotionSampleBuilder(input);
  const t0 = profile.phases.verticalEndMs + 100;
  const dtMs = 1000 / hz;
  const first = motionPacket(t0, 0);
  const second = motionPacket(t0 + dtMs, 1);

  builder.build(first, t0, { seqGap: false, measuredHz: hz, droppedFrameCount: 0 });
  const sample = builder.build(second, t0 + dtMs, {
    seqGap: false,
    measuredHz: hz,
    droppedFrameCount: 0,
  });

  assert.ok(sample.leftHand);
  assert.deepEqual(sample.leftHand.rawHandPosition, second.leftHand);
  assert.equal(sample.leftHand.validForScore, true);
});
