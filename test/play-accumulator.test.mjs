// test/play-accumulator.test.mjs
// P3a: charge is 3D path length for the hand assigned to each phase.
import test from "node:test";
import assert from "node:assert/strict";

import {
  accumulateCharge,
  freshPlay,
} from "../src/renderer/playAccumulator.ts";

const TH = 0.003;

const p = (x = 0, y = 0, z = 0) => ({ x, y, z });

test("right charge accumulates 3D path length after the first baseline sample", () => {
  const play = freshPlay();
  accumulateCharge(play, "VerticalCharge", p(0, 0, 0), true, TH);
  assert.equal(play.rightChargeRaw, 0);
  accumulateCharge(play, "VerticalCharge", p(0, 0.3, 0.4), true, TH);
  accumulateCharge(play, "VerticalCharge", p(0, 0, 0), true, TH);
  assert.ok(Math.abs(play.rightChargeRaw - 1.0) < 1e-9, `right=${play.rightChargeRaw}`);
});

test("validForScore=false and missing hand do not accumulate or dirty baseline", () => {
  const play = freshPlay();
  accumulateCharge(play, "VerticalCharge", p(0, 0, 0), true, TH);
  assert.equal(accumulateCharge(play, "VerticalCharge", p(9, 9, 9), false, TH), false);
  assert.equal(accumulateCharge(play, "ForwardCharge", null, true, TH), false);
  accumulateCharge(play, "VerticalCharge", p(0, 0.1, 0), true, TH);
  assert.ok(Math.abs(play.rightChargeRaw - 0.1) < 1e-9, `right=${play.rightChargeRaw}`);
});

test("noiseThreshold suppresses tiny stationary jitter", () => {
  const play = freshPlay();
  accumulateCharge(play, "VerticalCharge", p(1, 1, 1), true, TH);
  for (let i = 1; i <= 50; i++) {
    accumulateCharge(play, "VerticalCharge", p(1 + 0.001 * (i % 2), 1, 1), true, TH);
  }
  assert.equal(play.rightChargeRaw, 0);
});

test("3D movement is accumulated regardless of old projection axes", () => {
  const play = freshPlay();
  accumulateCharge(play, "VerticalCharge", p(0, 1, 0), true, TH);
  accumulateCharge(play, "VerticalCharge", p(0, 1, 0.5), true, TH);
  assert.ok(Math.abs(play.rightChargeRaw - 0.5) < 1e-9);
});

test("phase switch resets baseline and keeps right and left charge independent", () => {
  const play = freshPlay();
  accumulateCharge(play, "VerticalCharge", p(0, 0, 0), true, TH);
  accumulateCharge(play, "VerticalCharge", p(0.5, 0, 0), true, TH);
  accumulateCharge(play, "ForwardCharge", p(2, 2, 2), true, TH);
  accumulateCharge(play, "ForwardCharge", p(2, 2.3, 2.4), true, TH);
  assert.ok(Math.abs(play.rightChargeRaw - 0.5) < 1e-9);
  assert.ok(Math.abs(play.leftChargeRaw - 0.5) < 1e-9);
});
