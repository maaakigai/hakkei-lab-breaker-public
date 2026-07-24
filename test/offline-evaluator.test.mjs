import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import { evaluateMany, evaluateRecording } from "../src/tools/offlineEvaluator.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const CONFIG = loaded.value;

const FORWARD = { x: 0, y: 0, z: 1 };
const UP = { x: 0, y: 1, z: 0 };

// 完全な MotionSample（右手）。left は null。
function sample(t, pos, vel, acc, validForScore = true) {
  return {
    protocolVersion: 1,
    source: "unity-bridge",
    sessionId: "rec",
    seq: t,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: pos,
    handPosition: pos,
    velocity: vel,
    acceleration: acc,
    isAvailable: true,
    validForScore,
    validForCalibration: true,
    leftHand: null,
    quality: {
      dtMs: 16,
      sampleRateHz: 60,
      isFiltered: true,
      droppedFrameCount: 0,
      invalidPacketCount: 0,
      flags: [],
    },
  };
}

// ある軸へ net distance dist で動く punch の frames（5 sample・200ms）。velocity/accel は十分大きく。
function punchFrames(startT, axis, dist, speed = 2.0, accel = 10.0) {
  const frames = [];
  for (let i = 0; i < 5; i++) {
    const f = (dist * i) / 4;
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const acc = { x: 0, y: 0, z: 0 };
    pos[axis] = f;
    // 動いている間は速度・加速度を立てる（最後の sample は 0 でもピークは保たれる）。
    vel[axis] = i < 4 ? Math.sign(dist) * speed : 0;
    acc[axis] = i < 4 ? Math.sign(dist) * accel : 0;
    frames.push(sample(startT + i * 50, pos, vel, acc));
  }
  return frames;
}

function staticFrames(startT, n = 20) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    // ±2mm のごく小さい jitter。速度・加速度ほぼ0。
    const j = (i % 2 === 0 ? 1 : -1) * 0.002;
    frames.push(sample(startT + i * 50, { x: j, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
  }
  return frames;
}

function buildRecording(specs) {
  const frames = [];
  const trials = [];
  let t = 0;
  for (const s of specs) {
    const f = s.frames(t);
    const startTimestampMs = f[0].timestampMs;
    const endTimestampMs = f[f.length - 1].timestampMs;
    frames.push(...f);
    trials.push({
      trialId: s.id,
      label: s.label,
      operatorVerdict: s.verdict ?? "valid",
      dominantHand: s.dominantHand ?? "right",
      startTimestampMs,
      endTimestampMs,
      chargeRaw: s.chargeRaw ?? 100,
    });
    t = endTimestampMs + 1000; // trial 間に空白
  }
  return {
    schemaVersion: 1,
    recordedAtIso: "2026-06-26T00:00:00Z",
    commitSha: "test",
    note: "synthetic",
    dominantHand: "right",
    calibration: { source: "measured", forwardVector: FORWARD, upVector: UP, neutralHandPositionRaw: null },
    config: { score: CONFIG.score, input: CONFIG.input, app: CONFIG.app },
    frames,
    trials,
  };
}

test("offline evaluator: forward punch は forward に分類される", () => {
  const rec = buildRecording([
    { id: "f1", label: "forward", frames: (t) => punchFrames(t, "z", 0.3) },
    { id: "f2", label: "forward", frames: (t) => punchFrames(t, "z", 0.3) },
  ]);
  const { trials, metrics } = evaluateRecording(rec);
  assert.equal(trials[0].firstTrigger, "forward");
  assert.equal(metrics.forwardRecall, 1);
  assert.equal(metrics.forwardToHiddenRate, 0);
});

test("offline evaluator: 下方向 punch は down に分類される（charge 十分）", () => {
  const rec = buildRecording([
    { id: "d1", label: "down", frames: (t) => punchFrames(t, "y", -0.3), chargeRaw: 100 },
  ]);
  const { trials, metrics } = evaluateRecording(rec);
  assert.equal(trials[0].firstTrigger, "down");
  assert.equal(metrics.downRecall, 1);
});

test("offline evaluator: static は発火しない（誤検出0）", () => {
  const rec = buildRecording([
    { id: "s1", label: "static", frames: (t) => staticFrames(t) },
    { id: "s2", label: "static", frames: (t) => staticFrames(t) },
  ]);
  const { metrics } = evaluateRecording(rec);
  assert.equal(metrics.staticFalseFireTrials, 0);
  assert.equal(metrics.negativeFalseFireRate, 0);
});

test("offline evaluator: 横払い（sideways）は方向に当たらず発火しない", () => {
  const rec = buildRecording([
    { id: "side1", label: "sideways", frames: (t) => punchFrames(t, "x", 0.3) },
  ]);
  const { trials } = evaluateRecording(rec);
  assert.equal(trials[0].fired, false);
});

test("offline evaluator: hiddenChargeGate を上げると charge 不足の down は hiddenMiss で発火しない", () => {
  const rec = buildRecording([
    { id: "d-lowcharge", label: "down", frames: (t) => punchFrames(t, "y", -0.3), chargeRaw: 1 },
  ]);
  // gate=1000 を override（charge=1 では満たせない）。
  const { trials } = evaluateRecording(rec, { scoreOverride: { hiddenChargeGate: 1000 } });
  assert.equal(trials[0].fired, false);
  assert.equal(trials[0].sawHiddenMiss, true);
});

test("offline evaluator: operatorVerdict=bad-form は集計から除外される", () => {
  const rec = buildRecording([
    { id: "f1", label: "forward", frames: (t) => punchFrames(t, "z", 0.3) },
    { id: "bad", label: "forward", frames: (t) => punchFrames(t, "z", 0.3), verdict: "bad-form" },
  ]);
  const { metrics } = evaluateRecording(rec);
  assert.equal(metrics.evaluatedTrials, 1);
  assert.equal(metrics.excludedTrials, 1);
});

test("offline evaluator: evaluateMany は複数記録を個別評価して集約（timestamp 衝突しない）", () => {
  // 2つの記録がどちらも t=0 付近から始まる。merge すると衝突するが evaluateMany は個別評価。
  const recA = buildRecording([{ id: "fa", label: "forward", frames: (t) => punchFrames(t, "z", 0.3) }]);
  const recB = buildRecording([{ id: "da", label: "down", frames: (t) => punchFrames(t, "y", -0.3) }]);
  // 両方とも startTimestampMs=0 から始まることを確認（衝突条件）。
  assert.equal(recA.trials[0].startTimestampMs, 0);
  assert.equal(recB.trials[0].startTimestampMs, 0);
  const { metrics } = evaluateMany([recA, recB]);
  assert.equal(metrics.forwardRecall, 1);
  assert.equal(metrics.downRecall, 1);
  assert.equal(metrics.evaluatedTrials, 2);
});

test("offline evaluator: ラベルと実方向の矛盾は LABEL_DIRECTION_MISMATCH で review される", () => {
  // ラベルは forward だが実際は下に動いている（操作者の valid 判定を機械的に裏取り）。
  const rec = buildRecording([
    { id: "mislabeled", label: "forward", frames: (t) => punchFrames(t, "y", -0.3) },
  ]);
  const { trials, metrics } = evaluateRecording(rec);
  assert.ok(trials[0].reviewFlags.includes("LABEL_DIRECTION_MISMATCH"));
  // forward意図がdownに分類された場合、forwardToHiddenRate>0となり安全制約が機能する。
  assert.equal(trials[0].firstTrigger, "down");
  assert.ok(metrics.forwardToHiddenRate > 0);
});

test("offline evaluator: 混同行列と latency が出る（決定的）", () => {
  const rec = buildRecording([
    { id: "f1", label: "forward", frames: (t) => punchFrames(t, "z", 0.3) },
    { id: "s1", label: "static", frames: (t) => staticFrames(t) },
  ]);
  const a = evaluateRecording(rec);
  const b = evaluateRecording(rec);
  assert.deepEqual(a.metrics.confusion, b.metrics.confusion); // 同入力→同結果
  assert.equal(a.metrics.confusion.forward.forward, 1);
  assert.equal(a.metrics.confusion.static.none, 1);
  assert.ok(a.metrics.medianLatencyMs !== null);
});
