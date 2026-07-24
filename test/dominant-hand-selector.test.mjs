import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import {
  DominantHandSelector,
  decideDominantHand,
} from "../src/renderer/dominantHandSelector.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const HAKKEI = loaded.value.score.hakkei;
const MARGIN = loaded.value.score.dominantHand.dominantHandMargin;

const SELECTOR_CONFIG = {
  hakkeiMinForwardVelocity: HAKKEI.hakkeiMinForwardVelocity,
  hakkeiMinForwardDisplacement: HAKKEI.hakkeiMinForwardDisplacement,
  hakkeiWindowMs: HAKKEI.hakkeiWindowMs,
  dominantHandMargin: MARGIN,
};

// --- decideDominantHand（純粋関数）---------------------------------------

function metric(netDistance, qualifies = true, speedPeak = 2.0) {
  return { qualifies, netDistance, speedPeak };
}

test("decideDominantHand: どちらも未達は waiting", () => {
  const d = decideDominantHand(metric(0, false), metric(0, false), MARGIN);
  assert.equal(d.status, "waiting");
  assert.equal(d.hand, null);
});

test("decideDominantHand: 右だけ達成は right", () => {
  const d = decideDominantHand(metric(0.3, true), metric(0, false), MARGIN);
  assert.deepEqual(d, { status: "decided", hand: "right" });
});

test("decideDominantHand: 左だけ達成は left", () => {
  const d = decideDominantHand(metric(0, false), metric(0.3, true), MARGIN);
  assert.deepEqual(d, { status: "decided", hand: "left" });
});

test("decideDominantHand: 両手達成・差が margin 以上は大きい方", () => {
  const d = decideDominantHand(metric(0.3), metric(0.2), MARGIN); // diff 0.1 >= 0.05
  assert.deepEqual(d, { status: "decided", hand: "right" });
  const d2 = decideDominantHand(metric(0.2), metric(0.3), MARGIN);
  assert.deepEqual(d2, { status: "decided", hand: "left" });
});

test("decideDominantHand: 両手達成・差が margin 未満は ambiguous（retry）", () => {
  const d = decideDominantHand(metric(0.30), metric(0.29), MARGIN); // diff 0.01 < 0.05
  assert.equal(d.status, "ambiguous");
  assert.equal(d.hand, null);
});

test("decideDominantHand: 左手なし(null)で右未達は waiting、右達成は right", () => {
  assert.equal(decideDominantHand(metric(0, false), null, MARGIN).status, "waiting");
  assert.deepEqual(decideDominantHand(metric(0.3, true), null, MARGIN), {
    status: "decided",
    hand: "right",
  });
});

// --- DominantHandSelector（window 集計）-----------------------------------

function sample({ t, rp, rv, lp = null, lv = null, validForScore = true, leftValid = true }) {
  return {
    timestampMs: t,
    handPosition: { x: 0, y: 0, z: rp },
    velocity: { x: 0, y: 0, z: rv },
    validForScore,
    leftHand:
      lp === null
        ? null
        : {
            handPosition: { x: 0, y: 0, z: lp },
            velocity: { x: 0, y: 0, z: lv },
            validForScore: leftValid,
          },
  };
}

test("DominantHandSelector: 右手だけ前へ突くと right に decided", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  // 右手 0→0.3m, 速度 2.0（>1.2）。左手は静止。
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const d = sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: 0, lv: 0 }));
  assert.deepEqual(d, { status: "decided", hand: "right" });
});

test("DominantHandSelector: 左手だけ前へ突くと left に decided", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const d = sel.observe(sample({ t: 100, rp: 0, rv: 0, lp: 0.3, lv: 2.0 }));
  assert.deepEqual(d, { status: "decided", hand: "left" });
});

test("DominantHandSelector: 両手が同程度に動くと ambiguous（もう一度片手だけ）", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const d = sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: 0.3, lv: 2.0 }));
  assert.equal(d.status, "ambiguous");
});

test("DominantHandSelector: 静止は waiting（誤決定しない）", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const d = sel.observe(sample({ t: 100, rp: 0.001, rv: 0.0, lp: 0.001, lv: 0.0 }));
  assert.equal(d.status, "waiting");
});

test("DominantHandSelector: 左手 packet なし(null)でも右手の決定は成立", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: null }));
  const d = sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: null }));
  assert.deepEqual(d, { status: "decided", hand: "right" });
});

test("DominantHandSelector: reset で window を捨てて誤検出を持ち越さない", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: 0, lv: 0 }));
  sel.reset();
  const d = sel.observe(sample({ t: 200, rp: 0.3, rv: 0.0, lp: 0, lv: 0 })); // reset 後 1 sample・速度0
  assert.equal(d.status, "waiting");
});

// --- 境界値・retry・stale window --------------------------------------------

test("境界: speed が閾値ちょうど（>判定）は qualify しない", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  // speedPeak = hakkeiMinForwardVelocity ちょうど（> ではない）。netDistance は十分。
  const d = sel.observe(
    sample({ t: 100, rp: 0.3, rv: HAKKEI.hakkeiMinForwardVelocity, lp: 0, lv: 0 }),
  );
  assert.equal(d.status, "waiting");
});

test("境界: netDistance が閾値ちょうど（>判定）は qualify しない", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  // netDistance = hakkeiMinForwardDisplacement ちょうど。speedPeak は十分。
  const d = sel.observe(
    sample({ t: 100, rp: HAKKEI.hakkeiMinForwardDisplacement, rv: 2.0, lp: 0, lv: 0 }),
  );
  assert.equal(d.status, "waiting");
});

test("境界: netDistance 差が margin ちょうど（>=判定）は決定する", () => {
  // diff = MARGIN - 0 で厳密に境界（減算誤差を避ける）。両手 qualify、差ちょうど margin。
  const d = decideDominantHand(metric(MARGIN, true), metric(0, true), MARGIN);
  assert.deepEqual(d, { status: "decided", hand: "right" });
  // 境界をわずかに下回ると ambiguous。
  const amb = decideDominantHand(metric(MARGIN * 0.5, true), metric(0, true), MARGIN);
  assert.equal(amb.status, "ambiguous");
});

test("DominantHandSelector: ambiguous → reset → 片手 retry で決定する", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const amb = sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: 0.3, lv: 2.0 }));
  assert.equal(amb.status, "ambiguous");
  sel.reset(); // state側のretry契約
  sel.observe(sample({ t: 200, rp: 0, rv: 0, lp: 0, lv: 0 }));
  const d = sel.observe(sample({ t: 300, rp: 0.3, rv: 2.0, lp: 0, lv: 0 }));
  assert.deepEqual(d, { status: "decided", hand: "right" });
});

test("DominantHandSelector: 長い invalid gap 後の valid sample は stale window に引っ張られない", () => {
  const sel = new DominantHandSelector(SELECTOR_CONFIG);
  // 古い valid punch で window に位置が入る。
  sel.observe(sample({ t: 0, rp: 0, rv: 0, lp: 0, lv: 0 }));
  sel.observe(sample({ t: 100, rp: 0.3, rv: 2.0, lp: 0, lv: 0 }));
  // 長い invalid gap（observe しても NO_PUNCH・window 非更新）。
  sel.observe(sample({ t: 200, rp: 0.3, rv: 2.0, lp: 0, lv: 0, validForScore: false }));
  // window(400ms) を大きく超えた時刻の valid 静止 sample。古い位置は prune される。
  const d = sel.observe(sample({ t: 2000, rp: 0.3, rv: 0.0, lp: 0, lv: 0 }));
  assert.equal(d.status, "waiting");
});
