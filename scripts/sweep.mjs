// scripts/sweep.mjs
//
// M15-09 オフライン閾値 sweep（docs/M15-09-experiment.md）。
// 記録 JSON を本番 detector/resolveTrigger で replay し、config grid を走査して、
// 事前定義の安全制約を満たす候補から recall/latency で選ぶ。Pareto 候補も出す。
//
// 使い方:
//   node scripts/sweep.mjs --tune rec-A.json [--holdout rec-B.json] [--out out.json] [--top 10]
//   （複数 tune を渡すと trial を連結: --tune a.json --tune b.json）
//
// 出力: stdout に上位候補＋制約サマリ、--out で全結果 JSON。

import { readFileSync, writeFileSync } from "node:fs";
import { allChargeZero, evaluateMany } from "../src/tools/offlineEvaluator.ts";

// --- 引数パース ---------------------------------------------------------
function parseArgs(argv) {
  const args = { tune: [], holdout: null, out: null, top: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tune") args.tune.push(argv[++i]);
    else if (a === "--holdout") args.holdout = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--top") args.top = Number(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (args.tune.length === 0) {
    throw new Error("usage: node scripts/sweep.mjs --tune rec.json [--holdout rec.json] [--out out.json]");
  }
  return args;
}

function loadRecording(path) {
  // JSON.parseが先頭BOMで失敗しないよう、Windows/PowerShellのUTF-8 BOMを除去する。
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rec = JSON.parse(text);
  if (rec.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion`);
  return rec;
}

// --- config grid --------------------------------------------------------
const GRID = {
  forwardCos: [0.6, 0.7, 0.75, 0.8, 0.85],
  dirCos: [0.75, 0.8, 0.85, 0.9],
  hiddenChargeGate: [0, 0.5, 1.0, 2.0],
  hakkeiMinForwardVelocity: [1.0, 1.2, 1.5],
  hakkeiMinForwardAcceleration: [3.0, 4.0, 6.0],
  hakkeiMinForwardDisplacement: [0.08, 0.1, 0.12],
};

function* gridCombos() {
  for (const forwardCos of GRID.forwardCos)
    for (const dirCos of GRID.dirCos) {
      if (forwardCos >= dirCos) continue; // 不変条件（§0.23.5）
      for (const hiddenChargeGate of GRID.hiddenChargeGate)
        for (const hakkeiMinForwardVelocity of GRID.hakkeiMinForwardVelocity)
          for (const hakkeiMinForwardAcceleration of GRID.hakkeiMinForwardAcceleration)
            for (const hakkeiMinForwardDisplacement of GRID.hakkeiMinForwardDisplacement)
              yield {
                forwardCos,
                dirCos,
                hiddenChargeGate,
                hakkeiMinForwardVelocity,
                hakkeiMinForwardAcceleration,
                hakkeiMinForwardDisplacement,
              };
    }
}

// --- 安全制約（docs: 受入基準）-----------------------------------------
const CONSTRAINTS = {
  maxStaticFalseFireTrials: 0,
  maxForwardToHiddenRate: 0,
  maxDoubleFireTrials: 0,
  maxWeakForwardFireRate: 0.1,
  minHiddenRecall: 0.7,
};

function constraintViolations(m) {
  const v = [];
  if (m.staticFalseFireTrials > CONSTRAINTS.maxStaticFalseFireTrials) v.push("staticFalseFire");
  if (m.forwardToHiddenRate > CONSTRAINTS.maxForwardToHiddenRate) v.push("forwardToHidden");
  if (m.doubleFireTrials > CONSTRAINTS.maxDoubleFireTrials) v.push("doubleFire");
  if (m.weakForwardFireRate > CONSTRAINTS.maxWeakForwardFireRate) v.push("weakForwardFire");
  if (m.downRecall < CONSTRAINTS.minHiddenRecall) v.push("downRecall");
  if (m.upRecall < CONSTRAINTS.minHiddenRecall) v.push("upRecall");
  if (m.backRecall < CONSTRAINTS.minHiddenRecall) v.push("backRecall");
  return v;
}
function passesConstraints(m) {
  return constraintViolations(m).length === 0;
}

// 制約を満たす中での選好: forwardRecall 最大 → latency 最小。
function betterThan(a, b) {
  if (a.metrics.forwardRecall !== b.metrics.forwardRecall) {
    return a.metrics.forwardRecall > b.metrics.forwardRecall;
  }
  const la = a.metrics.medianLatencyMs ?? Infinity;
  const lb = b.metrics.medianLatencyMs ?? Infinity;
  return la < lb;
}

// Pareto: forwardRecall 高い・latency 低い・hidden recall 高い で支配されない候補。
function paretoFront(cands) {
  return cands.filter((c) =>
    !cands.some(
      (o) =>
        o !== c &&
        (o.metrics.forwardRecall >= c.metrics.forwardRecall) &&
        ((o.metrics.medianLatencyMs ?? Infinity) <= (c.metrics.medianLatencyMs ?? Infinity)) &&
        (o.metrics.downRecall + o.metrics.upRecall + o.metrics.backRecall >=
          c.metrics.downRecall + c.metrics.upRecall + c.metrics.backRecall) &&
        (o.metrics.forwardRecall > c.metrics.forwardRecall ||
          (o.metrics.medianLatencyMs ?? Infinity) < (c.metrics.medianLatencyMs ?? Infinity)),
    ),
  );
}

function fmt(m) {
  return {
    forwardRecall: round(m.forwardRecall),
    downRecall: round(m.downRecall),
    upRecall: round(m.upRecall),
    backRecall: round(m.backRecall),
    weakForwardFireRate: round(m.weakForwardFireRate),
    forwardToHiddenRate: round(m.forwardToHiddenRate),
    hiddenToForwardRate: round(m.hiddenToForwardRate),
    staticFalseFireTrials: m.staticFalseFireTrials,
    doubleFireTrials: m.doubleFireTrials,
    medianLatencyMs: m.medianLatencyMs,
    meanValidSampleRatio: round(m.meanValidSampleRatio),
    evaluatedTrials: m.evaluatedTrials,
  };
}
const round = (x) => Math.round(x * 1000) / 1000;

// --- main ---------------------------------------------------------------
const args = parseArgs(process.argv);
// timestamp衝突を避けるため、複数記録はmergeせず個別に評価して集約する。
const tuneRecs = args.tune.map(loadRecording);
const holdoutRecs = args.holdout ? [loadRecording(args.holdout)] : null;

// hiddenChargeGate 識別性チェック: 全 trial chargeRaw=0 なら gate は決められない（0 固定＋警告）。
const gateIdentifiable = !allChargeZero(tuneRecs);
if (!gateIdentifiable) {
  GRID.hiddenChargeGate = [0];
  console.log(
    "⚠ 全 trial の chargeRaw=0 → hiddenChargeGate は実データで識別不能。0 固定で掃引します（方向閾値のみ決定）。",
  );
}

// データ健全性: ラベル別 valid trial 数と不足警告（基準 config で1回評価）。
const baseEval = evaluateMany(tuneRecs);
const MIN_PER_LABEL = 10;
console.log("\nラベル別 valid trial 数:", JSON.stringify(baseEval.metrics.labelCounts));
const thin = Object.entries(baseEval.metrics.labelCounts).filter(([, n]) => n < MIN_PER_LABEL);
if (thin.length > 0) {
  console.log(`⚠ trial 数が ${MIN_PER_LABEL} 未満のラベル: ${thin.map(([l, n]) => `${l}=${n}`).join(", ")}（recall が不安定）`);
}
if (baseEval.metrics.reviewFlaggedTrials > 0) {
  console.log(`⚠ 自動 review フラグ付き trial: ${baseEval.metrics.reviewFlaggedTrials} 件（ラベルと方向の矛盾/低valid比/品質flag）`);
}

const results = [];
const violationCounts = {};
for (const override of gridCombos()) {
  const { metrics } = evaluateMany(tuneRecs, { scoreOverride: override });
  const violations = constraintViolations(metrics);
  for (const v of violations) violationCounts[v] = (violationCounts[v] ?? 0) + 1;
  results.push({ override, metrics, passes: violations.length === 0 });
}

const feasible = results.filter((r) => r.passes);
feasible.sort((a, b) => (betterThan(a, b) ? -1 : 1));
const pareto = paretoFront(feasible);

console.log(`\n=== sweep ===`);
console.log(`tune trials: ${baseEval.metrics.evaluatedTrials} (excluded ${baseEval.metrics.excludedTrials}) / grid combos: ${results.length} / feasible: ${feasible.length}`);
if (feasible.length === 0) {
  console.log("⚠ 制約を満たす候補なし。どの制約が何件落としたか:");
  console.log("  ", JSON.stringify(violationCounts));
  console.log("  → データ不足（ラベル別 trial 数）か閾値範囲を見直してください。");
  // 制約に最も近い上位を参考表示。
  results.sort((a, b) => (betterThan(a, b) ? -1 : 1));
}
const show = (feasible.length > 0 ? feasible : results).slice(0, args.top);
for (const [i, r] of show.entries()) {
  console.log(`\n#${i + 1} ${r.passes ? "✓制約OK" : "✗制約NG"}`);
  console.log("  config:", JSON.stringify(r.override));
  console.log("  metrics:", JSON.stringify(fmt(r.metrics)));
}

console.log(`\n--- Pareto 候補 (${pareto.length}) ---`);
for (const r of pareto.slice(0, args.top)) {
  console.log("  ", JSON.stringify(r.override), JSON.stringify(fmt(r.metrics)));
}

// holdout 検証（best を holdout で再評価）。
if (holdoutRecs && feasible.length > 0) {
  const best = feasible[0];
  const ho = evaluateMany(holdoutRecs, { scoreOverride: best.override });
  console.log(`\n--- holdout 検証（best config を holdout に適用）---`);
  console.log("  best config:", JSON.stringify(best.override));
  console.log("  holdout metrics:", JSON.stringify(fmt(ho.metrics)));
  console.log("  holdout 制約:", passesConstraints(ho.metrics) ? "✓OK" : "✗NG");
}

if (args.out) {
  writeFileSync(
    args.out,
    JSON.stringify({ constraints: CONSTRAINTS, grid: GRID, results, pareto }, null, 2),
  );
  console.log(`\nfull results -> ${args.out}`);
}
