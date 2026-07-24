// src/tools/offlineEvaluator.ts
//
// M15-09 オフライン評価器（docs/M15-09-experiment.md）。
// 記録（RecordingFile）を **本番と同じ** HakkeiDetector / resolveTrigger に通して、trial ごとの
// 判定 trigger と各種指標を出す。閾値 sweep はこの評価を config grid で繰り返す（scripts/sweep.mjs）。
//
// 再現可能な比較結果を得るための決定性:
//   - 時刻は sample.timestampMs のみ（performance.now / Date は使わない）。
//   - detector は trial 開始でのみ reset（本番 HakkeiReady entry と同じ意味）。
//   - window 端の包含・cooldown・magnitude 強さ判定は本番コードをそのまま使う。
//   - strength は magnitude のみ（前方 gate は使わない＝方向分岐は resolveTrigger に委ねる）。

import { HakkeiDetector } from "../renderer/hakkeiDetector.ts";
import { handKinematicsFor, resolveTrigger, strengthBars } from "../renderer/outcomeResolver.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import type { RecordingFile, TrialLabel, TrialMarker } from "../shared/recordingTypes.ts";
import type { MotionSample, OutcomeTrigger } from "../shared/types.ts";

export type DirectionTrigger = "forward" | "down" | "up" | "back";
function isDirection(t: OutcomeTrigger): t is DirectionTrigger {
  return t === "forward" || t === "down" || t === "up" || t === "back";
}

// 操作者のvalid判定を機械的に裏取りする自動reviewフラグ。
export type ReviewFlag = "LABEL_DIRECTION_MISMATCH" | "LOW_VALID_RATIO" | "QUALITY_FLAGS_PRESENT";

export type TrialResult = {
  trialId: string;
  label: TrialLabel;
  operatorVerdict: TrialMarker["operatorVerdict"];
  dominantHand: "right" | "left";
  fired: boolean; // 方向 trigger が1回でも発火したか
  firstTrigger: DirectionTrigger | null; // 最初に発火した方向 trigger（混同行列に使う）
  latencyMs: number | null; // trial start → 最初の発火
  fireCount: number; // cooldown を考慮した発火回数（>1 は二度撃ち）
  sawHiddenMiss: boolean; // 方向は明確だが gate 不足で空振りした瞬間があったか
  frameCount: number;
  durationMs: number; // trial の長さ（falseFirePerMinute 用）
  validSampleRatio: number; // trial 内の validForScore 比率
  qualityFlagCount: number; // OUTLIER_*/LOW_SAMPLE_RATE/RIGHT_HAND_UNAVAILABLE 等の総数
  reviewFlags: ReviewFlag[]; // 自動 review（valid とされたが疑わしい trial の検出）
};

export type EvaluationMetrics = {
  // ラベル別 recall（その意図で「意図どおりの trigger」が出た率）。
  forwardRecall: number;
  downRecall: number;
  upRecall: number;
  backRecall: number;
  weakForwardFireRate: number; // weak-forward が forward 発火した率（低いほどよい）
  // 安全制約系。
  staticFalseFireTrials: number; // static で発火した trial 数（0 であるべき）
  negativeFalseFireRate: number; // static/sideways/jitter/non-dominant の発火率
  forwardToHiddenRate: number; // forward 意図が down/up/back になった率（強く抑制）
  hiddenToForwardRate: number; // down/up/back 意図が forward になった率
  doubleFireTrials: number; // 二度撃ちした trial 数
  medianLatencyMs: number | null;
  // 品質。
  meanValidSampleRatio: number;
  // 品質・データ健全性。
  qualityFlagRate: number; // qualityFlag を1つ以上含む trial の率
  falseFirePerMinute: number; // negative trial の発火数 / negative 合計時間（分）
  reviewFlaggedTrials: number; // 自動 review フラグが付いた trial 数
  // 混同行列: 意図ラベル → {trigger or "none": 件数}。
  confusion: Record<string, Record<string, number>>;
  labelCounts: Record<string, number>; // ラベル別 valid trial 数（データ不足検知）
  evaluatedTrials: number; // operatorVerdict=valid のみ集計
  excludedTrials: number;
};

export type EvaluateOptions = {
  // score config の上書き（sweep 用）。未指定なら recording.config.score を使う。
  scoreOverride?: Partial<ScoreConfig["hakkei"]> & {
    hiddenChargeGate?: number;
  };
  includeInvalidVerdict?: boolean; // 既定 false（valid のみ集計）
};

const QUALITY_FLAGS_BAD = new Set([
  "OUTLIER_POSITION_JUMP",
  "OUTLIER_VELOCITY",
  "OUTLIER_ACCELERATION",
  "LOW_SAMPLE_RATE",
  "RIGHT_HAND_UNAVAILABLE",
  "NOT_TRACKED",
  "AVATAR_NOT_READY",
]);

function mergedScore(recording: RecordingFile, opts: EvaluateOptions): ScoreConfig {
  const base = recording.config.score;
  const o = opts.scoreOverride;
  if (!o) {
    return base;
  }
  return {
    ...base,
    hakkei: { ...base.hakkei, ...o },
    hiddenChargeGate: o.hiddenChargeGate ?? base.hiddenChargeGate,
  };
}

// 1 trial を本番コードで replay して TrialResult を出す。
function evaluateTrial(
  recording: RecordingFile,
  trial: TrialMarker,
  score: ScoreConfig,
): TrialResult {
  const hk = score.hakkei;
  const detector = new HakkeiDetector(hk); // trial 開始で reset 相当（新規インスタンス）
  const forward = recording.calibration.forwardVector;
  const up = recording.calibration.upVector;

  const frames = recording.frames.filter(
    (s) => s.timestampMs >= trial.startTimestampMs && s.timestampMs <= trial.endTimestampMs,
  );

  let fired = false;
  let firstTrigger: DirectionTrigger | null = null;
  let latencyMs: number | null = null;
  let fireCount = 0;
  let lastFireMs = Number.NEGATIVE_INFINITY;
  let sawHiddenMiss = false;
  let validCount = 0;
  let qualityFlagCount = 0;
  let firstPos: { x: number; y: number; z: number } | null = null;
  let lastPos: { x: number; y: number; z: number } | null = null;

  for (const sample of frames) {
    const hand = handKinematicsFor(sample, trial.dominantHand);
    countQuality(sample, trial.dominantHand, (v, q) => {
      if (v) validCount += 1;
      qualityFlagCount += q;
    });
    if (hand === null) {
      continue;
    }
    if (firstPos === null) firstPos = hand.position;
    lastPos = hand.position;
    const obs = detector.observe(hand, forward);
    const bars = strengthBars(obs.forwardVelocityPeak, obs.forwardAccelerationPeak, obs.forwardDisplacement, hk);
    const trigger = resolveTrigger(
      {
        forwardStrengthMet: bars.forwardStrengthMet,
        hiddenStrengthMet: bars.hiddenStrengthMet,
        directionVector: obs.peakVelocityDir ?? obs.netDelta,
        charge: trial.chargeRaw,
        forwardVector: forward,
        upVector: up,
      },
      {
        forwardCos: hk.forwardCos,
        dirCos: hk.dirCos,
        hiddenForwardLeakMax: hk.hiddenForwardLeakMax,
        hiddenChargeGate: score.hiddenChargeGate,
      },
    );
    if (trigger === "hiddenMiss") {
      sawHiddenMiss = true;
    }
    if (isDirection(trigger)) {
      // cooldown を跨いだ発火だけ別カウント（本番 HakkeiReady は初回で遷移するため二度撃ちは異常）。
      if (sample.timestampMs - lastFireMs >= hk.hakkeiCooldownMs) {
        fireCount += 1;
        lastFireMs = sample.timestampMs;
        if (!fired) {
          fired = true;
          firstTrigger = trigger;
          latencyMs = sample.timestampMs - trial.startTimestampMs;
        }
      }
    }
  }

  const validSampleRatio = frames.length === 0 ? 0 : validCount / frames.length;
  const netDir = firstPos !== null && lastPos !== null ? normalizeOrNull(sub(lastPos, firstPos)) : null;
  const reviewFlags: ReviewFlag[] = [];
  if (validSampleRatio < 0.95) reviewFlags.push("LOW_VALID_RATIO");
  if (qualityFlagCount > 0) reviewFlags.push("QUALITY_FLAGS_PRESENT");
  if (labelDirectionMismatch(trial.label, netDir, forward, up)) {
    reviewFlags.push("LABEL_DIRECTION_MISMATCH");
  }

  return {
    trialId: trial.trialId,
    label: trial.label,
    operatorVerdict: trial.operatorVerdict,
    dominantHand: trial.dominantHand,
    fired,
    firstTrigger,
    latencyMs,
    fireCount,
    sawHiddenMiss,
    frameCount: frames.length,
    durationMs: Math.max(0, trial.endTimestampMs - trial.startTimestampMs),
    validSampleRatio,
    qualityFlagCount,
    reviewFlags,
  };
}

function sub(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function neg(v: { x: number; y: number; z: number }) {
  return { x: -v.x, y: -v.y, z: -v.z };
}
function normalizeOrNull(v: { x: number; y: number; z: number }) {
  const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return m < 1e-9 ? null : { x: v.x / m, y: v.y / m, z: v.z / m };
}

// ラベルが期待する方向と、実際のnet変位方向が大きく矛盾するかを自動reviewする。
// 方向が一意なラベル（forward/back/up/down/weak-forward）だけ判定。sideways/diagonal/static 等は skip。
function labelDirectionMismatch(
  label: TrialLabel,
  netDir: { x: number; y: number; z: number } | null,
  forward: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
): boolean {
  if (netDir === null) return false;
  const f = normalizeOrNull(forward);
  const u = normalizeOrNull(up);
  if (f === null || u === null) return false;
  let expected: { x: number; y: number; z: number } | null = null;
  if (label === "forward" || label === "weak-forward") expected = f;
  else if (label === "back") expected = neg(f);
  else if (label === "up") expected = u;
  else if (label === "down") expected = neg(u);
  if (expected === null) return false;
  return dot(netDir, expected) < 0.5; // 半頂角60度より外れていれば矛盾
}

function countQuality(
  sample: MotionSample,
  hand: "right" | "left",
  sink: (valid: boolean, badFlags: number) => void,
): void {
  const h = hand === "left" ? sample.leftHand : sample;
  if (h === null) {
    sink(false, 0);
    return;
  }
  const valid = h.validForScore;
  const flags = h.quality?.flags ?? [];
  const bad = flags.filter((f) => QUALITY_FLAGS_BAD.has(f)).length;
  sink(valid, bad);
}

export function evaluateRecording(
  recording: RecordingFile,
  opts: EvaluateOptions = {},
): { trials: TrialResult[]; metrics: EvaluationMetrics } {
  const score = mergedScore(recording, opts);
  const all = recording.trials.map((t) => evaluateTrial(recording, t, score));
  const include = opts.includeInvalidVerdict === true;
  const trials = all.filter((t) => include || t.operatorVerdict === "valid");
  return { trials: all, metrics: computeMetrics(trials, all.length - trials.length) };
}

// 1 recording を評価して valid trial の TrialResult[]（＋除外数）を返す。各 recording を
// 各recordingを固有のtimestamp空間で評価し、複数recording間のtimestamp衝突を避ける。
export function evaluateTrials(
  recording: RecordingFile,
  opts: EvaluateOptions = {},
): { trials: TrialResult[]; excluded: number } {
  const score = mergedScore(recording, opts);
  const all = recording.trials.map((t) => evaluateTrial(recording, t, score));
  const include = opts.includeInvalidVerdict === true;
  const trials = all.filter((t) => include || t.operatorVerdict === "valid");
  return { trials, excluded: all.length - trials.length };
}

// 複数 recording を**個別に評価してから集約**する（merge せず timestamp 衝突を回避）。
export function evaluateMany(
  recordings: RecordingFile[],
  opts: EvaluateOptions = {},
): { trials: TrialResult[]; metrics: EvaluationMetrics } {
  const acc: TrialResult[] = [];
  let excluded = 0;
  for (const rec of recordings) {
    const r = evaluateTrials(rec, opts);
    acc.push(...r.trials);
    excluded += r.excluded;
  }
  return { trials: acc, metrics: computeMetrics(acc, excluded) };
}

// 全trialのchargeRawが0なら、hiddenChargeGateを識別できないデータとして扱う。
export function allChargeZero(recordings: RecordingFile[]): boolean {
  return recordings.every((r) => r.trials.every((t) => t.chargeRaw === 0));
}

function rate(numerator: number, denom: number): number {
  return denom === 0 ? 0 : numerator / denom;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function computeMetrics(trials: TrialResult[], excluded: number): EvaluationMetrics {
  const byLabel = (l: TrialLabel): TrialResult[] => trials.filter((t) => t.label === l);
  const recall = (l: TrialLabel, want: DirectionTrigger): number => {
    const set = byLabel(l);
    return rate(set.filter((t) => t.firstTrigger === want).length, set.length);
  };

  const negatives = trials.filter(
    (t) =>
      t.label === "static" ||
      t.label === "sideways" ||
      t.label === "small-fast-jitter" ||
      t.label === "non-dominant-hand",
  );
  const fwd = byLabel("forward");
  const hidden = [...byLabel("down"), ...byLabel("up"), ...byLabel("back")];

  const confusion: Record<string, Record<string, number>> = {};
  const labelCounts: Record<string, number> = {};
  for (const t of trials) {
    const row = (confusion[t.label] ??= {});
    const key = t.firstTrigger ?? "none";
    row[key] = (row[key] ?? 0) + 1;
    labelCounts[t.label] = (labelCounts[t.label] ?? 0) + 1;
  }

  const latencies = trials.filter((t) => t.latencyMs !== null).map((t) => t.latencyMs as number);

  // negative trialの発火数をnegative合計時間（分）で正規化する。
  const negativeFires = negatives.reduce((s, t) => s + t.fireCount, 0);
  const negativeMinutes = negatives.reduce((s, t) => s + t.durationMs, 0) / 60000;

  return {
    forwardRecall: recall("forward", "forward"),
    downRecall: recall("down", "down"),
    upRecall: recall("up", "up"),
    backRecall: recall("back", "back"),
    weakForwardFireRate: rate(
      byLabel("weak-forward").filter((t) => t.firstTrigger === "forward").length,
      byLabel("weak-forward").length,
    ),
    staticFalseFireTrials: byLabel("static").filter((t) => t.fired).length,
    negativeFalseFireRate: rate(negatives.filter((t) => t.fired).length, negatives.length),
    forwardToHiddenRate: rate(
      fwd.filter((t) => t.firstTrigger !== null && t.firstTrigger !== "forward").length,
      fwd.length,
    ),
    hiddenToForwardRate: rate(hidden.filter((t) => t.firstTrigger === "forward").length, hidden.length),
    doubleFireTrials: trials.filter((t) => t.fireCount > 1).length,
    medianLatencyMs: median(latencies),
    meanValidSampleRatio:
      trials.length === 0 ? 0 : trials.reduce((s, t) => s + t.validSampleRatio, 0) / trials.length,
    qualityFlagRate: rate(trials.filter((t) => t.qualityFlagCount > 0).length, trials.length),
    falseFirePerMinute: negativeMinutes === 0 ? 0 : negativeFires / negativeMinutes,
    reviewFlaggedTrials: trials.filter((t) => t.reviewFlags.length > 0).length,
    confusion,
    labelCounts,
    evaluatedTrials: trials.length,
    excludedTrials: excluded,
  };
}
