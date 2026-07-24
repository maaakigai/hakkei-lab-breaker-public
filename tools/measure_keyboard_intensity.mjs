// keyboard generator + PunchInputAdapter をオフライン実行し、
// Space(charge) と Enter(punch) が生む intensity(|accel|) ピークを実測する。
// 目的: keyboard debug の punch 閾値(intensityThresholdKeyboard)を Space<閾値<Enter に置くための実値取得。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigBundle } from "../src/main/appConfig.ts";
import { KeyboardSampleGenerator } from "../src/main/keyboardSampleGenerator.ts";
import { PunchInputAdapter } from "../src/main/punchInputAdapter.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const kb = loaded.value.input.keyboard;
const noise = loaded.value.score.normalization.rightChargeNoiseThreshold;
const dtMs = 1000 / kb.sampleRateHz;

// 1 シナリオ実行: openSession → key down → N tick、各 sample を adapter に通して intensity ピークを返す。
function run(keyEvents, ticks) {
  let t = 0;
  const samples = [];
  const gen = new KeyboardSampleGenerator(
    (s) => samples.push(s),
    () => {},
    kb,
    () => t,
  );
  gen.openSession("keyboard-start");
  for (const ev of keyEvents) {
    gen.handleControl({ type: "key", key: ev, pressed: true });
    gen.handleControl({ type: "key", key: ev, pressed: false });
  }
  const adapter = new PunchInputAdapter(noise);
  let peak = 0;
  let chargeSum = 0;
  for (let i = 0; i < ticks; i++) {
    t += dtMs;
    gen.tick();
    const s = samples[samples.length - 1];
    const p = adapter.fromMotionSample(s);
    peak = Math.max(peak, p.strength.intensity);
    chargeSum += p.chargeDelta;
  }
  return { peak, chargeSum };
}

// Space を1回叩いてチャージ動作（複数 tick）。
const space = run(["Space"], 30);
// Enter を1回突いてパンチパルス（複数 tick）。
const enter = run(["Enter"], 30);
// Space を連打（チャージ蓄積の代表）。
let t = 0;
const samples = [];
const gen = new KeyboardSampleGenerator((s) => samples.push(s), () => {}, kb, () => t);
gen.openSession("keyboard-start");
const adapter = new PunchInputAdapter(noise);
let spacePeak = 0;
for (let i = 0; i < 40; i++) {
  if (i % 6 === 0) {
    gen.handleControl({ type: "key", key: "Space", pressed: true });
    gen.handleControl({ type: "key", key: "Space", pressed: false });
  }
  t += dtMs;
  gen.tick();
  const p = adapter.fromMotionSample(samples[samples.length - 1]);
  spacePeak = Math.max(spacePeak, p.strength.intensity);
}

// 時系列（押下から各 tick の intensity）。ピークがいつ出るか＝発火の遅延を見る。
function timeline(keyEvents, ticks) {
  let t = 0;
  const samples = [];
  const gen = new KeyboardSampleGenerator((s) => samples.push(s), () => {}, kb, () => t);
  gen.openSession("keyboard-start");
  for (const ev of keyEvents) {
    gen.handleControl({ type: "key", key: ev, pressed: true });
    gen.handleControl({ type: "key", key: ev, pressed: false });
  }
  const adapter = new PunchInputAdapter(noise);
  const out = [];
  for (let i = 0; i < ticks; i++) {
    t += dtMs;
    gen.tick();
    const p = adapter.fromMotionSample(samples[samples.length - 1]);
    out.push({ ms: Math.round(i * dtMs), intensity: p.strength.intensity });
  }
  return out;
}

console.log("=== keyboard intensity(|accel|) 実測 ===");
console.log(`config: tapSpeedMps=${kb.tapSpeedMps} enterForwardDisplacementM=${kb.enterForwardDisplacementM} enterDurationMs=${kb.enterDurationMs} sampleRateHz=${kb.sampleRateHz}`);
console.log(`Space 単発 peak=${space.peak.toFixed(0)} / 連打 peak=${spacePeak.toFixed(0)}`);
console.log(`Enter 単発 peak=${enter.peak.toFixed(0)}`);
console.log("\n-- Enter intensity 時系列(押下からのms) --");
console.log(timeline(["Enter"], 20).map((x) => `${x.ms}ms:${x.intensity.toFixed(0)}`).join("  "));
console.log("\n-- Space 単発 intensity 時系列 --");
console.log(timeline(["Space"], 20).map((x) => `${x.ms}ms:${x.intensity.toFixed(0)}`).join("  "));
