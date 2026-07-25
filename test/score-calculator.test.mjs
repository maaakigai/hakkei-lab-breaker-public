// test/score-calculator.test.mjs
// M3-01/02/03/04/05: 正規化・Power・損害額・rank・動画レベル境界。
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeScore,
  calculatePowerFromScores,
  selectRank,
  selectVideoLevel,
  buildScoreBreakdown,
  criticalRateForPower,
  ScoreInvalidError,
} from "../src/renderer/scoreCalculator.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";
import { damageYenFromPower } from "../src/renderer/damageEstimate.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) {
  throw new Error("config 読み込み失敗: " + loaded.messageJa);
}
const SCORE_CONFIG = loaded.value.score;

test("normalizeScore: min->0, max->100, 範囲外はclamp (M3-02)", () => {
  assert.equal(normalizeScore(0, 0, 3), 0);
  assert.equal(normalizeScore(3, 0, 3), 100);
  assert.equal(normalizeScore(1.5, 0, 3), 50);
  assert.equal(normalizeScore(-5, 0, 3), 0); // 下限clamp
  assert.equal(normalizeScore(99, 0, 3), 100); // 上限clamp
});

test("normalizeScore: NaN / max<=min は SCORE_INVALID (M3-02)", () => {
  assert.throws(() => normalizeScore(NaN, 0, 3), ScoreInvalidError);
  assert.throws(() => normalizeScore(1, 3, 3), ScoreInvalidError);
  assert.throws(() => normalizeScore(1, 5, 2), ScoreInvalidError);
  assert.throws(() => normalizeScore(Infinity, 0, 3), ScoreInvalidError);
});

test("calculatePowerFromScores = v*f*h*coef (M3-03)", () => {
  assert.equal(calculatePowerFromScores(100, 100, 100, 1), 1_000_000);
  assert.equal(calculatePowerFromScores(50, 40, 30, 1), 60_000);
  assert.equal(calculatePowerFromScores(10, 10, 10, 2), 2_000);
});

test("selectRank: 降順評価・境界は上位rank (M3 整合・B案6段)", () => {
  assert.equal(selectRank(565000, SCORE_CONFIG), "S"); // S土俵(≒ゲージ120%全力)
  assert.equal(selectRank(564999, SCORE_CONFIG), "A");
  assert.equal(selectRank(425000, SCORE_CONFIG), "A"); // A土俵(≒ゲージ100%全力)
  assert.equal(selectRank(424999, SCORE_CONFIG), "B");
  assert.equal(selectRank(238000, SCORE_CONFIG), "B");
  assert.equal(selectRank(110000, SCORE_CONFIG), "C");
  assert.equal(selectRank(53000, SCORE_CONFIG), "D");
  assert.equal(selectRank(52999, SCORE_CONFIG), "E");
  assert.equal(selectRank(0, SCORE_CONFIG), "E"); // 最下位は E
});

test("selectVideoLevel: minPower<=power<maxPower 境界 (M3-05・B案整列)", () => {
  assert.equal(selectVideoLevel(0, SCORE_CONFIG), 0);
  assert.equal(selectVideoLevel(29999, SCORE_CONFIG), 0);
  assert.equal(selectVideoLevel(30000, SCORE_CONFIG), 1); // 境界は次レベル
  assert.equal(selectVideoLevel(109999, SCORE_CONFIG), 1);
  assert.equal(selectVideoLevel(110000, SCORE_CONFIG), 2);
  assert.equal(selectVideoLevel(238000, SCORE_CONFIG), 3);
  assert.equal(selectVideoLevel(425000, SCORE_CONFIG), 4);
  assert.equal(selectVideoLevel(565000, SCORE_CONFIG), 5); // S土俵=Lv5
  assert.equal(selectVideoLevel(99_999_999, SCORE_CONFIG), 5); // 上限なし
});

test("buildScoreBreakdown: damageYen=Lvアンカー補間(power由来) (M3-04)", () => {
  // 各 raw を config の Max に合わせて与え、すべて 100 へ正規化させる（config 値を直書きしない＝
  // GATES-F の再チューニングで Max が変わってもこの算術検証は壊れない）。
  const n = SCORE_CONFIG.normalization;
  const b = buildScoreBreakdown(
    {
      rightChargeRaw: n.rightChargeMax,
      leftChargeRaw: n.leftChargeMax,
      hakkeiVelocityPeak: n.hakkeiVelocityMax,
      hakkeiAccelerationPeak: n.hakkeiAccelerationMax,
      hakkeiDisplacement: n.hakkeiDisplacementMax,
      hakkeiDetected: true,
      hakkeiTimedOut: false,
    },
    SCORE_CONFIG,
  );
  // 全部100 -> hakkeiScore=100, power=100*100*100=1e6, damage=アンカー補間(power上端で頭打ち)
  assert.equal(b.hakkeiScore, 100);
  assert.equal(b.power, 1_000_000);
  assert.equal(b.damageYen, damageYenFromPower(1_000_000, SCORE_CONFIG.power));
  assert.equal(b.rank, "S");
  assert.equal(b.videoLevel, 5);
});

test("criticalRateForPower: S帯のbaseから最大powerのmaxまで単調増加する", () => {
  const opts = {
    sThreshold: 565_000,
    maxPower: 780_000,
    baseRate: 0.25,
    maxRate: 0.75,
    gamma: 1.5,
  };
  assert.equal(criticalRateForPower(opts.sThreshold, opts), opts.baseRate);
  assert.equal(criticalRateForPower(opts.maxPower, opts), opts.maxRate);
  assert.equal(criticalRateForPower(0, opts), opts.baseRate);
  assert.equal(criticalRateForPower(2_000_000, opts), opts.maxRate);
  const middle = criticalRateForPower((opts.sThreshold + opts.maxPower) / 2, opts);
  assert.ok(middle > opts.baseRate && middle < opts.maxRate);
  assert.ok(criticalRateForPower(740_000, opts) > criticalRateForPower(620_000, opts));
});

test("単手モデル: 単手チャージを両因子へ与えると power>0・Lv>0（§0.23回帰）", () => {
  // app.ts は単手チャージ（rightChargeRaw）を right/left 両方へ与える。leftChargeRaw=0 固定で
  // power が常に 0/Lv0 になる退行を防ぐ。入力は config の中点から作り（直書きしない）、
  // GATES-F の Max 再チューニング後も「単手→power>0」が保たれることを保証する。
  const n = SCORE_CONFIG.normalization;
  const mid = (min, max) => (min + max) / 2;
  // 片手チャージ。noise floor を確実に超える中点付近の値。
  const singleCharge = mid(n.rightChargeMin, n.rightChargeMax);
  const hakkei = {
    hakkeiVelocityPeak: mid(n.hakkeiVelocityMin, n.hakkeiVelocityMax),
    hakkeiAccelerationPeak: mid(n.hakkeiAccelerationMin, n.hakkeiAccelerationMax),
    hakkeiDisplacement: mid(n.hakkeiDisplacementMin, n.hakkeiDisplacementMax),
  };
  const b = buildScoreBreakdown(
    {
      rightChargeRaw: singleCharge,
      leftChargeRaw: singleCharge,
      ...hakkei,
      hakkeiDetected: true,
      hakkeiTimedOut: false,
    },
    SCORE_CONFIG,
  );
  assert.ok(b.power > 0, `power should be > 0 (got ${b.power})`);
  assert.ok(b.videoLevel > 0, `videoLevel should be > 0 (got ${b.videoLevel})`);
  // 退行ケース: 片側 0 だと power=0（単手で leftChargeRaw=0 のまま渡すと壊れる証跡）。
  const broken = buildScoreBreakdown(
    {
      rightChargeRaw: singleCharge,
      leftChargeRaw: 0,
      ...hakkei,
      hakkeiDetected: true,
      hakkeiTimedOut: false,
    },
    SCORE_CONFIG,
  );
  assert.equal(broken.power, 0);
});

test("no-impact timeout: hakkeiScore=0 / power=0 / videoLevel=0 (M2-12整合)", () => {
  const b = buildScoreBreakdown(
    {
      rightChargeRaw: 2.0,
      leftChargeRaw: 2.0,
      hakkeiVelocityPeak: 2.0,
      hakkeiAccelerationPeak: 10,
      hakkeiDisplacement: 0.2,
      hakkeiDetected: false,
      hakkeiTimedOut: true,
    },
    SCORE_CONFIG,
  );
  assert.equal(b.hakkeiScore, 0);
  assert.equal(b.power, 0);
  assert.equal(b.damageYen, 0);
  assert.equal(b.videoLevel, 0);
  assert.equal(b.hakkeiDetected, false);
  assert.equal(b.rank, "E"); // power=0 は最下位 E
});
