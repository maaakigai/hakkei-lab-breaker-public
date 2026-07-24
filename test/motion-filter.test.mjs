// test/motion-filter.test.mjs
// M7-04/05/06/07/08: EMA フィルタ・外れ値・dt異常・jitter。
import test from "node:test";
import assert from "node:assert/strict";
import { MotionFilter, JitterTracker } from "../src/main/motionFilter.ts";

const cfg = {
  referenceHz: 30,
  minDtMs: 8,
  maxDtMs: 100,
  maxPositionJump: 1.0,
  maxReasonableVelocity: 8.0,
  maxReasonableAcceleration: 80.0,
  positionEmaAlpha: 0.35,
  velocityEmaAlpha: 0.45,
  accelerationEmaAlpha: 0.25,
};
const V = (x, y, z) => ({ x, y, z });
const dt = 1000 / 30; // 33.33ms（基準Hz）

test("初回は filtered=raw・速度0、2回目以降は EMA で raw に追従 (M7-04)", () => {
  const f = new MotionFilter(cfg);
  const r1 = f.process(V(0, 0, 0), dt, true);
  assert.deepEqual(r1.filteredPosition, V(0, 0, 0));
  assert.deepEqual(r1.velocity, V(0, 0, 0));
  const r2 = f.process(V(0, 1, 0), dt, true);
  // 基準Hzなので alphaEff=positionEmaAlpha=0.35
  assert.ok(Math.abs(r2.filteredPosition.y - 0.35) < 1e-9, `y=${r2.filteredPosition.y}`);
  assert.ok(r2.velocity.y > 0); // M7-05
  assert.equal(r2.validForScore, true);
});

test("位置 jump 外れ値は filtered を保持し validForScore=false (M7-07)", () => {
  const f = new MotionFilter(cfg);
  f.process(V(0, 0, 0), dt, true);
  const r = f.process(V(0, 5, 0), dt, true); // jump 5m > 1.0
  assert.ok(r.flags.includes("OUTLIER_POSITION_JUMP"));
  assert.equal(r.validForScore, false);
  assert.deepEqual(r.filteredPosition, V(0, 0, 0)); // 保持
});

test("dt が小さすぎ/大きすぎは validForScore=false (M7-02/07)", () => {
  const f = new MotionFilter(cfg);
  f.process(V(0, 0, 0), dt, true);
  const small = f.process(V(0, 0.1, 0), 4, true); // < minDtMs(8)
  assert.ok(small.flags.includes("DT_TOO_SMALL"));
  assert.equal(small.validForScore, false);

  const f2 = new MotionFilter(cfg);
  f2.process(V(0, 0, 0), dt, true);
  const large = f2.process(V(0, 0.1, 0), 200, true); // > maxDtMs(100)
  assert.ok(large.flags.includes("DT_TOO_LARGE"));
  assert.ok(large.flags.includes("TIMESTAMP_GAP"));
  assert.equal(large.validForScore, false);
});

test("速度外れ値で 0 化 + baseline reset (M7-07)", () => {
  const f = new MotionFilter(cfg);
  // +0.3m/step を継続すると filtered 速度が ~9m/s に収束し maxReasonableVelocity(8) を超える。
  // 各 step の jump は 1.0 未満なので位置jumpには掛からない。
  let sawOutlier = false;
  let zeroedOnOutlier = true;
  for (let i = 0; i <= 40; i++) {
    const r = f.process(V(0, 0.3 * i, 0), dt, true);
    if (r.flags.includes("OUTLIER_VELOCITY")) {
      sawOutlier = true;
      if (r.velocity.x !== 0 || r.velocity.y !== 0 || r.velocity.z !== 0) zeroedOnOutlier = false;
      assert.equal(r.validForScore, false);
    }
    assert.ok(!r.flags.includes("OUTLIER_POSITION_JUMP"), `step ${i} で位置jumpに掛かった`);
  }
  assert.ok(sawOutlier, "継続した速い動きで OUTLIER_VELOCITY が出るべき");
  assert.ok(zeroedOnOutlier, "OUTLIER_VELOCITY 時は速度0");
});

test("unavailable は直前 filtered 保持・速度0 (M7)", () => {
  const f = new MotionFilter(cfg);
  f.process(V(1, 1, 1), dt, true);
  const r = f.process(V(9, 9, 9), dt, false);
  assert.deepEqual(r.filteredPosition, V(1, 1, 1));
  assert.deepEqual(r.velocity, V(0, 0, 0));
  assert.equal(r.validForScore, false);
});

test("JitterTracker: 静止2秒で rms≈0 / drift≈0、揺らすと増える (M7-08)", () => {
  const jt = new JitterTracker(2000);
  // 静止: 60サンプル/2秒
  for (let i = 0; i <= 60; i++) {
    const t = i * (2000 / 60);
    jt.add(V(0, 0, 0), V(0, 0, 0), t);
  }
  const m = jt.metrics();
  assert.ok(m.rawJitterRms2s !== null);
  assert.ok(m.rawJitterRms2s < 1e-9, `rms=${m.rawJitterRms2s}`);
  assert.ok(m.rawDrift2s < 1e-9);

  const jt2 = new JitterTracker(2000);
  for (let i = 0; i <= 60; i++) {
    const t = i * (2000 / 60);
    const j = (i % 2 === 0 ? 1 : -1) * 0.1; // ±0.1m の揺れ
    jt2.add(V(j, 0, 0), V(j, 0, 0), t);
  }
  const m2 = jt2.metrics();
  assert.ok(m2.rawJitterRms2s > 0.05, `rms=${m2.rawJitterRms2s}`);
});

test("サンプルが足りないと jitter は null", () => {
  const jt = new JitterTracker(2000);
  jt.add(V(0, 0, 0), V(0, 0, 0), 0);
  assert.equal(jt.metrics().rawJitterRms2s, null);
});
