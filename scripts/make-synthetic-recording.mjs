// scripts/make-synthetic-recording.mjs
//
// 合成（疑似）記録を生成する dev ツール。実機なしで Recorder→sweep パイプラインを検証するため。
// 本物の実機記録と同じ RecordingFile スキーマで JSON を吐く。
//   node scripts/make-synthetic-recording.mjs > rec-synth.json
//
// 注意: これは閾値決定には使わない（人工データ）。配線・CLI の動作確認専用。

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const CONFIG = loaded.value;

const FORWARD = { x: 0, y: 0, z: 1 };
const UP = { x: 0, y: 1, z: 0 };

function sample(t, pos, vel, acc) {
  return {
    protocolVersion: 1,
    source: "unity-bridge",
    sessionId: "synth",
    seq: t,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: pos,
    handPosition: pos,
    velocity: vel,
    acceleration: acc,
    isAvailable: true,
    validForScore: true,
    validForCalibration: true,
    leftHand: null,
    quality: { dtMs: 16, sampleRateHz: 60, isFiltered: true, droppedFrameCount: 0, invalidPacketCount: 0, flags: [] },
  };
}

function punch(startT, axis, dist, speed = 2.0, accel = 10.0) {
  const frames = [];
  for (let i = 0; i < 5; i++) {
    const f = (dist * i) / 4;
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const acc = { x: 0, y: 0, z: 0 };
    pos[axis] = f;
    vel[axis] = i < 4 ? Math.sign(dist) * speed : 0;
    acc[axis] = i < 4 ? Math.sign(dist) * accel : 0;
    frames.push(sample(startT + i * 50, pos, vel, acc));
  }
  return frames;
}

function stat(startT, n = 20) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const j = (i % 2 === 0 ? 1 : -1) * 0.002;
    frames.push(sample(startT + i * 50, { x: j, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
  }
  return frames;
}

const specs = [];
const add = (label, n, fn, chargeRaw = 100) => {
  for (let i = 0; i < n; i++) specs.push({ label, fn, chargeRaw, id: `${label}-${i}` });
};
add("forward", 5, (t) => punch(t, "z", 0.3));
add("down", 5, (t) => punch(t, "y", -0.3));
add("up", 5, (t) => punch(t, "y", 0.3));
add("back", 5, (t) => punch(t, "z", -0.3));
add("weak-forward", 5, (t) => punch(t, "z", 0.05, 0.6, 1.0)); // 弱い＝閾値未満
add("static", 3, (t) => stat(t));
add("sideways", 3, (t) => punch(t, "x", 0.3));
// 制約や閾値が実際に効くことを確かめるため、紛れやすい境界動作を少し入れる。
add("diagonal-forward-up", 2, (t) => punch(t, "z", 0.3)); // 前寄りの斜め（forward に寄る想定）
add("diagonal-forward-down", 2, (t) => punch(t, "z", 0.3));
add("non-dominant-hand", 2, (t) => stat(t)); // 利き手(右)は動かない＝発火しない想定
add("small-fast-jitter", 2, (t) => stat(t, 10));

const frames = [];
const trials = [];
let t = 0;
for (const s of specs) {
  const f = s.fn(t);
  frames.push(...f);
  trials.push({
    trialId: s.id,
    label: s.label,
    operatorVerdict: "valid",
    dominantHand: "right",
    startTimestampMs: f[0].timestampMs,
    endTimestampMs: f[f.length - 1].timestampMs,
    chargeRaw: s.chargeRaw,
  });
  t = f[f.length - 1].timestampMs + 1000;
}

const recording = {
  schemaVersion: 1,
  recordedAtIso: "2026-06-26T00:00:00Z",
  commitSha: "synthetic",
  note: "synthetic pipeline smoke test (NOT for tuning)",
  dominantHand: "right",
  calibration: { source: "default", forwardVector: FORWARD, upVector: UP, neutralHandPositionRaw: null },
  config: { score: CONFIG.score, input: CONFIG.input, app: CONFIG.app },
  frames,
  trials,
};

process.stdout.write(JSON.stringify(recording));
