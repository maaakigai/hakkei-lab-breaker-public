// src/renderer/resultSfxScheduler.ts
//
// Result screen crowd SFX scheduling. File discovery is provided by a build-time
// manifest because browser renderer code cannot enumerate local directories.

import type { AppConfig } from "../shared/configTypes.ts";
import type { Rank } from "../shared/types.ts";

export type ResultSfxManifest = {
  normal: string[];
  unique: string[];
  // Spotlight voices: a separate pool played only for eligible ranks and gated by
  // an explicit probability roll (kept out of the uniform `normal` pool on purpose).
  featured?: string[];
};

export type ResultSfxScheduleItem = {
  file: string;
  delayMs: number;
  volume: number;
  label: "normal" | "unique" | "featured";
};

type ResultVoiceSfxConfig = AppConfig["audio"]["resultVoiceSfx"];

export function resultSfxNormalCountForRank(rank: Rank): number {
  switch (rank) {
    case "E":
      return 0;
    case "D":
      return 2;
    case "C":
      return 4;
    case "B":
      return 5;
    case "A":
      return 7;
    case "S":
      return 9;
  }
}

export function isResultSfxManifest(value: unknown): value is ResultSfxManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((item) => typeof item === "string");
  // `featured` is optional for backward compatibility with older manifests.
  const featuredOk = record.featured === undefined || isStringArray(record.featured);
  return isStringArray(record.normal) && isStringArray(record.unique) && featuredOk;
}

export function randomSample<T>(items: readonly T[], count: number, random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
}

// Draw a delay uniformly across the whole normal-voice playback window so a
// spotlight voice's position is evenly random (no first/last/anchor bias).
// Callers must ensure normalSchedule is non-empty.
function uniformDelayInWindow(normalSchedule: readonly ResultSfxScheduleItem[], random: () => number): number {
  const firstDelay = normalSchedule[0].delayMs;
  const lastDelay = normalSchedule[normalSchedule.length - 1].delayMs;
  return Math.round(firstDelay + random() * Math.max(0, lastDelay - firstDelay));
}

export function createResultSfxSchedule(
  manifest: ResultSfxManifest,
  config: ResultVoiceSfxConfig,
  options: {
    normalCount?: number;
    includeUnique?: boolean;
    includeFeatured?: boolean;
    featuredChance?: number;
  } = {},
  random: () => number = Math.random,
): ResultSfxScheduleItem[] {
  const normalCount = options.normalCount ?? config.normalCount;
  const normalFiles = randomSample(manifest.normal, normalCount, random);
  const normalSchedule: ResultSfxScheduleItem[] = normalFiles.map((file, index) => ({
    file,
    delayMs: Math.round(config.baseDelayMs + index * config.staggerMs + random() * config.jitterMs),
    volume: config.normalVolume,
    label: "normal",
  }));

  const schedule: ResultSfxScheduleItem[] = [...normalSchedule];

  // Featured spotlight voice: separate pool, played only when eligible AND the
  // probability roll succeeds. Its delay is drawn uniformly across the whole
  // normal-voice playback window so its position is evenly random (no end bias).
  const featuredFiles = manifest.featured ?? [];
  const featuredChance = options.featuredChance ?? config.featuredProbability;
  if (
    options.includeFeatured === true &&
    featuredFiles.length > 0 &&
    normalSchedule.length > 0 &&
    random() < featuredChance
  ) {
    const featuredFile = randomSample(featuredFiles, 1, random)[0];
    if (featuredFile !== undefined) {
      const delayMs = uniformDelayInWindow(normalSchedule, random);
      schedule.push({ file: featuredFile, delayMs, volume: config.featuredVolume, label: "featured" });
    }
  }

  // Unique voice: drawn uniformly across the normal-voice window (same as featured)
  // so its position is evenly random across every rank.
  const uniqueFile = options.includeUnique === true ? randomSample(manifest.unique, 1, random)[0] : undefined;
  if (uniqueFile !== undefined && normalSchedule.length > 0) {
    const delayMs = uniformDelayInWindow(normalSchedule, random);
    schedule.push({
      file: uniqueFile,
      delayMs,
      volume: config.uniqueVolume,
      label: "unique",
    });
  }

  return schedule.sort((a, b) => a.delayMs - b.delayMs);
}
