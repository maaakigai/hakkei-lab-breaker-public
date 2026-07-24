// M11-13: 協調 mock の位置 profile は Calibration と発勁複合条件に整合する．
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CALIB } from "../src/renderer/calibrationManager.ts";
import { MotionSampleBuilder } from "../src/main/motionSampleBuilder.ts";
import { HakkeiDetector, rightHandKinematics } from "../src/renderer/hakkeiDetector.ts";
import { createCalibProfile } from "../scripts/mock-unity-calib-profile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, "config", name), "utf8"));
const app = readJson("app.config.json");
const input = readJson("input.config.json");
const score = readJson("score.config.json");
const hz = input.udp.requiredSampleRateHz;
const profile = createCalibProfile({ app, input, score, calibration: CALIB, hz });

test("--calib profile は neutral，forward，上下，前後，発勁の全局面を出す (M11-13)", () => {
  const { phases, pulse } = profile;
  assert.equal(profile.sampleAt(phases.neutralStartMs + 100).phase, "neutral");
  assert.equal(profile.sampleAt(phases.neutralStartMs + 1500).phase, "neutral");
  assert.equal(profile.sampleAt(phases.neutralEndMs + 100).phase, "forward-gesture");
  assert.equal(profile.sampleAt(phases.readyEndMs + 100).phase, "vertical-charge");
  assert.equal(profile.sampleAt(phases.verticalEndMs + 100).phase, "forward-charge");
  assert.equal(profile.sampleAt(pulse.startMs + pulse.durationMs / 2).phase, "hakkei-pulse");

  const neutralA = profile.sampleAt(phases.neutralStartMs + 100);
  const neutralB = profile.sampleAt(phases.neutralStartMs + 1500);
  assert.deepEqual(neutralA, neutralB, "neutral capture 中は静止する");
  const forward = profile.sampleAt(phases.neutralEndMs + 100);
  assert.ok(forward.z - neutralA.z >= CALIB.forwardMinDistanceM);
});

test("発勁 pulse の生位置差分は複合閾値を超える補助確認 (M11-13)", () => {
  const { startMs, endMs } = profile.pulse;
  const dtMs = 1000 / hz;
  const samples = [];
  for (let tMs = startMs; tMs <= endMs; tMs += dtMs) {
    samples.push({ tMs, position: profile.sampleAt(tMs) });
  }

  let detected = false;
  for (let i = 2; i < samples.length; i++) {
    const current = samples[i];
    const previous = samples[i - 1];
    const beforePrevious = samples[i - 2];
    const dtSeconds = (current.tMs - previous.tMs) / 1000;
    const velocity = (current.position.z - previous.position.z) / dtSeconds;
    const previousVelocity = (previous.position.z - beforePrevious.position.z) / dtSeconds;
    const acceleration = (velocity - previousVelocity) / dtSeconds;
    const displacement = current.position.z - samples[0].position.z;
    if (
      velocity > score.hakkei.hakkeiMinForwardVelocity &&
      acceleration > score.hakkei.hakkeiMinForwardAcceleration &&
      displacement > score.hakkei.hakkeiMinForwardDisplacement
    ) {
      detected = true;
      break;
    }
  }
  assert.equal(detected, true);
});

function runMainPipeline(sampleOffsetMs, jitterFactors) {
  const builder = new MotionSampleBuilder(input);
  const detector = new HakkeiDetector(score.hakkei);
  const dtMs = 1000 / hz;
  let detectorReset = false;
  let detectedObservation = null;
  let maxVelocity = Number.NEGATIVE_INFINITY;
  let maxAcceleration = Number.NEGATIVE_INFINITY;
  let validCount = 0;
  let index = 0;

  for (let tMs = sampleOffsetMs; tMs <= profile.pulse.endMs; ) {
    const position = profile.sampleAt(tMs);
    const sample = builder.build(
      {
        protocolVersion: 1,
        type: "motion",
        sessionId: "mock-calib-profile",
        seq: Math.round(tMs / dtMs),
        timestampMs: tMs,
        source: "mock-unity-bridge",
        isTracked: true,
        rightHand: { x: position.x, y: position.y, z: position.z },
        avatar: { isHuman: true, hasRightHand: true, forward: { x: 0, y: 0, z: 1 } },
      },
      tMs,
      { seqGap: false, measuredHz: hz, droppedFrameCount: 0 },
    );
    if (!detectorReset && tMs >= profile.phases.forwardChargeEndMs) {
      detector.reset();
      detectorReset = true;
    }
    if (detectorReset && sample.validForScore) {
      validCount++;
      maxVelocity = Math.max(maxVelocity, sample.velocity.z);
      maxAcceleration = Math.max(maxAcceleration, sample.acceleration.z);
    }
    const observation = detectorReset ? detector.observe(rightHandKinematics(sample), { x: 0, y: 0, z: 1 }) : null;
    if (observation?.detected) {
      detectedObservation = observation;
      break;
    }
    tMs += dtMs * jitterFactors[index % jitterFactors.length];
    index++;
  }

  return { observation: detectedObservation, maxVelocity, maxAcceleration, validCount };
}

test("発勁 pulse は位相オフセットと軽いdtジッタでも Main 経路の複合判定を満たす (M11-13)", () => {
  const dtMs = 1000 / hz;
  const offsets = [0, dtMs * 0.2, dtMs * 0.4, dtMs * 0.6, dtMs * 0.8];
  const jitterFactors = [0.94, 1.06, 0.97, 1.03, 1];
  const observations = offsets.map((offset) => runMainPipeline(offset, jitterFactors));
  const failedOffsets = offsets.filter((_, index) => observations[index].observation === null);
  assert.deepEqual(
    failedOffsets,
    [],
    `未検出 offset: ${failedOffsets.join(", ")} detail=${JSON.stringify(observations)}`,
  );

  const accelerationPeaks = observations.map((result) => result.observation.forwardAccelerationPeak);
  const worstAccelerationPeak = Math.min(...accelerationPeaks);
  assert.ok(
    worstAccelerationPeak >= score.hakkei.hakkeiMinForwardAcceleration * 1.5,
    `最悪 offset の filtered forwardAcceleration peak=${worstAccelerationPeak}`,
  );
});
