// test/static-hakkei.test.mjs
// M7-09: 10秒静止（微小jitter）で発勁が誤検出されない（staticFalseHakkeiMaxCount=0）。
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MotionSampleBuilder } from "../src/main/motionSampleBuilder.ts";
import { HakkeiDetector, rightHandKinematics } from "../src/renderer/hakkeiDetector.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const input = loaded.value.input;
const hk = loaded.value.score.hakkei;

test("10秒静止（±2cm jitter, 30Hz）で発勁検出0回 (M7-09)", () => {
  const builder = new MotionSampleBuilder(input);
  const detector = new HakkeiDetector(hk);
  const forwardVector = input.coordinates.defaultForwardVector;

  const hz = 30;
  const dtMs = 1000 / hz;
  const seconds = 10;
  const n = hz * seconds;
  let fires = 0;

  for (let i = 0; i < n; i++) {
    const t = Math.round(i * dtMs);
    // 静止 + 微小 jitter（決定的な複数周波数の小振動, 振幅 ~2cm）。
    const jx = 0.015 * Math.sin(i * 1.7);
    const jy = 1.2 + 0.015 * Math.sin(i * 2.3);
    const jz = -0.3 + 0.02 * Math.sin(i * 1.1) + 0.01 * Math.sin(i * 5.3);
    const packet = {
      protocolVersion: 1,
      type: "motion",
      sessionId: "static",
      seq: i,
      timestampMs: t,
      source: "unity-bridge",
      isTracked: true,
      rightHand: { x: jx, y: jy, z: jz },
      avatar: { isHuman: true, hasRightHand: true, forward: { x: 0, y: 0, z: 1 } },
    };
    const sample = builder.build(packet, t, { seqGap: false, measuredHz: hz, droppedFrameCount: 0 });
    if (sample.validForScore && detector.observe(rightHandKinematics(sample), forwardVector).detected) {
      fires += 1;
    }
  }

  assert.equal(fires, 0, `静止中の発勁誤検出は0であるべき（実際=${fires}）`);
});
