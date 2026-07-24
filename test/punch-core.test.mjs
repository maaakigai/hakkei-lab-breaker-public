import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import {
  accumulatePunchCharge,
  PunchDetector,
  buildPunchScoreBreakdown,
} from "../src/renderer/punchCore.ts";
import { damageYenFromPower } from "../src/renderer/damageEstimate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const SCORE = loaded.value.score;

function punchSample({ chargeDelta = 0, intensity = 0, validForScore = true, timestampMs = 0 }) {
  return {
    protocolVersion: 1,
    source: "keyboard",
    sessionId: "kb-1",
    seq: 1,
    timestampMs,
    receivedAtMs: 0,
    validForScore,
    isAvailable: true,
    chargeDelta,
    strength: { intensity, intensityPeak: intensity, motionAmount: 0 },
    quality: { sampleRateHz: 50, dtMs: 20, flags: [] },
  };
}

test("accumulatePunchCharge: 有効 sample の chargeDelta を積む", () => {
  let c = 0;
  c = accumulatePunchCharge(c, punchSample({ chargeDelta: 0.2 }));
  c = accumulatePunchCharge(c, punchSample({ chargeDelta: 0.3 }));
  assert.ok(Math.abs(c - 0.5) < 1e-9);
});

test("accumulatePunchCharge: 無効 sample は積まない", () => {
  let c = 1.0;
  c = accumulatePunchCharge(c, punchSample({ chargeDelta: 5, validForScore: false }));
  assert.equal(c, 1.0);
});

// スパイク方式(start=500, stop=250): 立ち上がり→ピーク追跡→減衰で「真のピーク」を発火。
test("PunchDetector: 立ち上がり時点では発火せず、減衰時に真のピークで発火", () => {
  const d = new PunchDetector(500, 250);
  // 構えの腕引き(~159)では start を超えず非発火（実機バグの再現防止）。
  assert.equal(d.observe(punchSample({ intensity: 159 })).detected, false);
  // パンチ立ち上がり：start 超えだが、まだ減衰していないので発火しない（低い値で確定しない）。
  assert.equal(d.observe(punchSample({ intensity: 600 })).detected, false);
  assert.equal(d.observe(punchSample({ intensity: 1540 })).detected, false); // ピーク更新
  assert.equal(d.observe(punchSample({ intensity: 900 })).detected, false); // まだ stop 上
  // 減衰して stop(250) を下回った瞬間に、追跡した真のピーク 1540 で発火。
  const r = d.observe(punchSample({ intensity: 100 }));
  assert.equal(r.detected, true);
  assert.equal(r.strengthRaw, 1540); // 立ち上がり時の 600 ではなく真のピーク
});

test("PunchDetector: start 未満だけの動作（構え程度）は発火しない", () => {
  const d = new PunchDetector(500, 250);
  for (const v of [100, 159, 300, 450, 200, 50]) {
    assert.equal(d.observe(punchSample({ intensity: v })).detected, false);
  }
});

test("PunchDetector: reset でスパイク状態が消える", () => {
  const d = new PunchDetector(500, 250);
  d.observe(punchSample({ intensity: 1540 }));
  d.reset();
  assert.equal(d.currentPeak(), 0);
  // reset 後に立ち上がり途中の減衰だけ来ても発火しない。
  assert.equal(d.observe(punchSample({ intensity: 100 })).detected, false);
});

test("PunchDetector: 無効 sample はピークに含めない", () => {
  const d = new PunchDetector(500, 250);
  const r = d.observe(punchSample({ intensity: 9999, validForScore: false }));
  assert.equal(r.detected, false);
  assert.equal(r.strengthRaw, 0);
});

test("PunchDetector: ピーク後に無効 sample が来ても追跡済みピークで発火", () => {
  const d = new PunchDetector(500, 250);
  assert.equal(d.observe(punchSample({ intensity: 800, timestampMs: 1000 })).detected, false);
  const r = d.observe(punchSample({ intensity: 0, validForScore: false, timestampMs: 1020 }));
  assert.equal(r.detected, true);
  assert.equal(r.strengthRaw, 800);
});

test("PunchDetector: 減衰が来ない強スパイクは保持上限で確定する", () => {
  const d = new PunchDetector(500, 250);
  assert.equal(d.observe(punchSample({ intensity: 800, timestampMs: 1000 })).detected, false);
  assert.equal(d.observe(punchSample({ intensity: 1000, timestampMs: 1100 })).detected, false);
  const r = d.observe(punchSample({ intensity: 900, timestampMs: 1180 }));
  assert.equal(r.detected, true);
  assert.equal(r.strengthRaw, 1000);
});

test("buildPunchScoreBreakdown: timeout は power=0 / Lv0", () => {
  const b = buildPunchScoreBreakdown(
    { chargeRaw: 10, punchStrengthRaw: 3, punchDetected: false, punchTimedOut: true },
    SCORE,
  );
  assert.equal(b.power, 0);
  assert.equal(b.videoLevel, 0);
  assert.equal(b.hakkeiTimedOut, true);
});

// 威力スコアモデル（2026-06-27実機ウィザード計測）のアンカー表を固定する。
// 下端=タメ無し本気=Lv1、満タン本気=Lv5、空振り/ゆっくり=Lv0。値は config(score.config.json)依存。
function bd(chargeRaw, peak, opts = {}) {
  return buildPunchScoreBreakdown(
    {
      chargeRaw,
      punchStrengthRaw: peak,
      punchDetected: opts.punchDetected ?? true,
      punchTimedOut: opts.punchTimedOut ?? false,
    },
    SCORE,
  );
}

test("buildPunchScoreBreakdown: timeout/未検出は power=0・Lv0", () => {
  assert.equal(bd(3000, 1540, { punchTimedOut: true }).power, 0);
  assert.equal(bd(3000, 1540, { punchTimedOut: true }).videoLevel, 0);
  assert.equal(bd(3000, 1540, { punchDetected: false }).power, 0);
});

test("buildPunchScoreBreakdown: 空振り/ゆっくりは満タンでも Lv0（ゲートで穴を塞ぐ）", () => {
  assert.equal(bd(3000, 100).videoLevel, 0); // detectGate=0
  assert.equal(bd(3000, 450).videoLevel, 0); // scoreGate=0（ゆっくり満タンの穴）
  assert.equal(bd(0, 450).videoLevel, 0);
});

test("buildPunchScoreBreakdown: B案 ゲージ土俵（A=100% / S=120%）×全力パンチでランク", () => {
  const B = SCORE.punch.chargeReadyThreshold; // 表示100%基準（=スコア曲線の割合分母）
  const full = 1800; // 全力パンチ（punchMax）
  // ゲージ％が到達できる天井を決め、全力パンチでその天井に届く。
  assert.equal(bd(Math.round(B * 1.2), full).rank, "S"); // 120%全力 = S（S土俵）
  assert.equal(bd(B, full).rank, "A"); // 100%全力 = A（A土俵）
  assert.equal(bd(Math.round(B * 0.8), full).rank, "B"); // 80%全力 = B
  assert.ok(!["S", "A"].includes(bd(Math.round(B * 0.4), full).rank)); // 低チャージは上位不可
});

test("buildPunchScoreBreakdown: B案 ゲージ＝天井・パンチ＝充填（100%でも弱パンチならB以下）", () => {
  const B = SCORE.punch.chargeReadyThreshold;
  // ゲージ100%固定でパンチを変えると、A→B→Cと下がる（パンチも重要）。
  assert.equal(bd(B, 1800).rank, "A"); // 全力 → A
  const weak = bd(B, 1100).rank; // 中パンチ → A未満（B以下）
  assert.ok(!["S", "A"].includes(weak), `100%×中パンチは A 未満: ${weak}`);
  // 100%ゲージでは全力でも S には絶対届かない（S は120%が土俵）。
  assert.notEqual(bd(B, 1800).rank, "S");
});

test("buildPunchScoreBreakdown: 弱パンチはSに届かない・中パンチもSに届かない（チャージとパンチ両方が効く）", () => {
  const B = SCORE.punch.chargeReadyThreshold;
  for (const c of [B * 0.8, B, B * 1.5, B * 3]) {
    assert.notEqual(bd(Math.round(c), 700).rank, "S"); // 弱はどれだけ溜めてもS不可
    assert.notEqual(bd(Math.round(c), 700).rank, "A"); // 弱はAも不可（最高でもC相当）
    assert.notEqual(bd(Math.round(c), 1100).rank, "S"); // 中はS不可（最高A）
  }
  assert.notEqual(bd(B, 700).rank, "A"); // 100%到達だけではA確定しない（弱だと上位不可）
});

test("buildPunchScoreBreakdown: オーバーチャージは効果を増やすが飽和する（無限に強くならない）", () => {
  const B = SCORE.punch.chargeReadyThreshold;
  const at100 = bd(B, 1540).power;
  const at150 = bd(Math.round(B * 1.5), 1540).power;
  const at300 = bd(B * 3, 1540).power;
  assert.ok(at150 > at100, "100%超でも効果が増える（オーバーチャージは伸びる）");
  // だが飽和: 150→300% の伸びは 100→150% の伸びより小さい（逓減）
  assert.ok(at300 - at150 < at150 - at100, `saturate: ${at100} -> ${at150} -> ${at300}`);
  // 上限は powerK（最大パンチ×A→1）で有限に頭打ち
  assert.ok(bd(B * 10, 1800).power <= SCORE.punch.powerK + 1);
});

test("buildPunchScoreBreakdown: chargeReadyOverride で source 別の割合基準（keyboard 安全）", () => {
  const kbBase = SCORE.punch.chargeReadyThresholdKeyboard; // keyboard の表示100%基準
  // keyboard 基準を渡すと f=chargeRaw/kbBase=1.0 → A≈0.95（同一曲線を共有）
  const kb = buildPunchScoreBreakdown(
    { chargeRaw: kbBase, punchStrengthRaw: 1540, punchDetected: true, punchTimedOut: false },
    SCORE,
    kbBase,
  );
  // 同じ chargeRaw を BLE 基準で評価すると f≈0 → A≈0
  const ble = bd(kbBase, 1540);
  assert.ok(kb.power > ble.power, `kb(${kb.power}) > ble(${ble.power})`);
  // f=1.0 のとき A=logistic((1-0.82)/0.26)≈0.67 → A%≈67（mid=0.82 の新曲線）
  assert.ok(kb.rightChargeScore > 60, `A% should be ~67 (got ${kb.rightChargeScore})`);
  assert.ok(ble.rightChargeScore < 5, `BLE base: A≈0 (got ${ble.rightChargeScore})`);
});

test("buildPunchScoreBreakdown: チャージ量に対し power は単調増加（本気固定）", () => {
  const ps = [0, 750, 1500, 2000, 3000].map((c) => bd(c, 1540).power);
  for (let i = 1; i < ps.length; i++) {
    assert.ok(ps[i] > ps[i - 1], `power must increase with charge: ${ps}`);
  }
  // damageYen = Lv アンカー補間（power 由来・±乱数は seed 量子化で決定的）
  const b = bd(3000, 1540);
  assert.equal(b.damageYen, damageYenFromPower(b.power, SCORE.power));
});
