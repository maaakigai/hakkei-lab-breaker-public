// src/renderer/scoreCalculator.ts
//
// スコア計算（SPEC.md 14章）。
//   - normalizeScore: Raw を 0〜100 に正規化（clamp）。RawMax<=RawMin / 非有限は SCORE_INVALID。
//   - calculatePowerFromScores: Power = vertical × forward × hakkei × coefficient。
//   - buildScoreBreakdown: ScoreBreakdown を整合条件どおりに作る（timeout は power=0/Lv0）。

import type { ScoreBreakdown, ScoreRawInput, Rank, VideoLevel } from "../shared/types.ts";
import type { ScoreConfig } from "../shared/configTypes.ts";
import { damageYenFromPower } from "./damageEstimate.ts";

export class ScoreInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreInvalidError";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Raw を 0〜100 に正規化する（SPEC.md 14.4）。 */
export function normalizeScore(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new ScoreInvalidError(`SCORE_INVALID: raw=${raw} min=${min} max=${max}`);
  }
  return clamp(((raw - min) / (max - min)) * 100, 0, 100);
}

/** Power = vertical × forward × hakkei × coefficient（SPEC.md 14.5）。 */
export function calculatePowerFromScores(
  rightChargeScore: number,
  leftChargeScore: number,
  hakkeiScore: number,
  powerCoefficient: number,
): number {
  return rightChargeScore * leftChargeScore * hakkeiScore * powerCoefficient;
}

/**
 * Critical is available only in the S-rank range. Within that range, stronger
 * hits move smoothly from the configured base probability to the maximum.
 */
export function criticalRateForPower(
  power: number,
  opts: { sThreshold: number; maxPower: number; baseRate: number; maxRate: number; gamma: number },
): number {
  const span = opts.maxPower - opts.sThreshold;
  if (span <= 0) {
    return opts.baseRate;
  }
  const t = clamp((power - opts.sThreshold) / span, 0, 1);
  const shaped = Math.pow(t, opts.gamma > 0 ? opts.gamma : 1);
  return opts.baseRate + (opts.maxRate - opts.baseRate) * shaped;
}

/** rankThresholds を降順評価。境界値は上位 rank に含める（SPEC.md 14.6）。 */
export function selectRank(power: number, cfg: ScoreConfig): Rank {
  const sorted = [...cfg.rankThresholds].sort((a, b) => b.minPower - a.minPower);
  for (const t of sorted) {
    if (power >= t.minPower) {
      return t.rank;
    }
  }
  return sorted[sorted.length - 1]?.rank ?? "D";
}

/** videoLevel は minPower <= power < maxPower（maxPower=null は上限なし）。 */
export function selectVideoLevel(power: number, cfg: ScoreConfig): VideoLevel {
  for (const v of cfg.videoLevels) {
    const underMax = v.maxPower === null || power < v.maxPower;
    if (power >= v.minPower && underMax) {
      return v.level;
    }
  }
  return 0;
}

export function videoFilesForLevel(level: VideoLevel, cfg: ScoreConfig): string[] {
  const v = cfg.videoLevels.find((x) => x.level === level);
  if (!v) {
    return videoFilesForLevel(0, cfg);
  }
  if (v.files && v.files.length > 0) {
    return v.files;
  }
  if (v.file) {
    return [v.file];
  }
  return [];
}

export function videoFileForLevel(level: VideoLevel, cfg: ScoreConfig): string {
  const files = videoFilesForLevel(level, cfg);
  if (files.length > 0) {
    return files[0];
  }
  const fallback = cfg.videoLevels.find((x) => x.file)?.file;
  return fallback ?? "";
}

/** Hakkei スコア（velocity/accel/displacement の正規化を重み付き合成）。 */
function computeHakkeiScore(raw: ScoreRawInput, cfg: ScoreConfig): number {
  const n = cfg.normalization;
  const v = normalizeScore(raw.hakkeiVelocityPeak, n.hakkeiVelocityMin, n.hakkeiVelocityMax);
  const a = normalizeScore(raw.hakkeiAccelerationPeak, n.hakkeiAccelerationMin, n.hakkeiAccelerationMax);
  const d = normalizeScore(raw.hakkeiDisplacement, n.hakkeiDisplacementMin, n.hakkeiDisplacementMax);
  const w = cfg.hakkei;
  return w.velocityWeight * v + w.accelerationWeight * a + w.displacementWeight * d;
}

/** ScoreBreakdown を整合条件どおりに作る（SPEC.md 14.6）。 */
export function buildScoreBreakdown(raw: ScoreRawInput, cfg: ScoreConfig): ScoreBreakdown {
  const n = cfg.normalization;
  const rightChargeScore = normalizeScore(raw.rightChargeRaw, n.rightChargeMin, n.rightChargeMax);
  const leftChargeScore = normalizeScore(raw.leftChargeRaw, n.leftChargeMin, n.leftChargeMax);

  // no-impact timeout: hakkeiScore=0、power=0、videoLevel=0 に固定。
  if (raw.hakkeiTimedOut) {
    return {
      rightChargeScore,
      leftChargeScore,
      hakkeiScore: 0,
      hakkeiDetected: false,
      hakkeiTimedOut: true,
      power: 0,
      baseDamageYen: 0,
      damageYen: 0,
      rank: selectRank(0, cfg),
      videoLevel: 0,
      raw: {
        rightChargeRaw: raw.rightChargeRaw,
        leftChargeRaw: raw.leftChargeRaw,
        hakkeiVelocityPeak: raw.hakkeiVelocityPeak,
        hakkeiAccelerationPeak: raw.hakkeiAccelerationPeak,
        hakkeiDisplacement: raw.hakkeiDisplacement,
      },
    };
  }

  const hakkeiScore = computeHakkeiScore(raw, cfg);
  const power = calculatePowerFromScores(
    rightChargeScore,
    leftChargeScore,
    hakkeiScore,
    cfg.power.powerCoefficient,
  );
  const damageYen = damageYenFromPower(power, cfg.power);

  return {
    rightChargeScore,
    leftChargeScore,
    hakkeiScore,
    hakkeiDetected: raw.hakkeiDetected,
    hakkeiTimedOut: false,
    power,
    baseDamageYen: damageYen,
    damageYen,
    rank: selectRank(power, cfg),
    videoLevel: selectVideoLevel(power, cfg),
    raw: {
      rightChargeRaw: raw.rightChargeRaw,
      leftChargeRaw: raw.leftChargeRaw,
      hakkeiVelocityPeak: raw.hakkeiVelocityPeak,
      hakkeiAccelerationPeak: raw.hakkeiAccelerationPeak,
      hakkeiDisplacement: raw.hakkeiDisplacement,
    },
  };
}
