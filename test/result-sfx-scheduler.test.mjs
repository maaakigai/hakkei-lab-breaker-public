// test/result-sfx-scheduler.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  createResultSfxSchedule,
  isResultSfxManifest,
  randomSample,
  resultSfxNormalCountForRank,
} from "../src/renderer/resultSfxScheduler.ts";

const config = {
  normalCount: 10,
  normalVolume: 3,
  uniqueVolume: 2.25,
  featuredVolume: 3,
  featuredProbability: 0.2,
  baseDelayMs: 0,
  staggerMs: 460,
  jitterMs: 240,
};

test("randomSample は重複なしで指定数だけ選ぶ", () => {
  const picked = randomSample(["a", "b", "c", "d"], 3, () => 0);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
});

test("createResultSfxSchedule は指定数の通常SFXとUnique1個を再生窓内に配置する", () => {
  const manifest = {
    normal: Array.from({ length: 12 }, (_, i) => `SFX/result_sfx/${i}.wav`),
    unique: ["SFX/result_sfx/Unique_SFX/u.wav"],
  };
  const schedule = createResultSfxSchedule(manifest, config, { normalCount: 10, includeUnique: true }, () => 0.5);
  const normal = schedule.filter((item) => item.label === "normal");
  const unique = schedule.filter((item) => item.label === "unique");
  assert.equal(normal.length, 10);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].volume, 2.25);
  // unique は先頭normal〜末尾normalの再生窓内に一様配置される（末尾/固定アンカーではない）。
  assert.ok(unique[0].delayMs >= normal[0].delayMs && unique[0].delayMs <= normal[normal.length - 1].delayMs);
  assert.deepEqual(
    schedule.map((item) => item.delayMs),
    [...schedule.map((item) => item.delayMs)].sort((a, b) => a - b),
  );
});

test("resultSfxNormalCountForRank は E=0 D=2 C=4 B=5 A=7 S=9", () => {
  assert.equal(resultSfxNormalCountForRank("E"), 0);
  assert.equal(resultSfxNormalCountForRank("D"), 2);
  assert.equal(resultSfxNormalCountForRank("C"), 4);
  assert.equal(resultSfxNormalCountForRank("B"), 5);
  assert.equal(resultSfxNormalCountForRank("A"), 7);
  assert.equal(resultSfxNormalCountForRank("S"), 9);
});

test("createResultSfxSchedule は includeUnique=false ならUniqueを入れない", () => {
  const manifest = {
    normal: Array.from({ length: 12 }, (_, i) => `SFX/result_sfx/${i}.wav`),
    unique: ["SFX/result_sfx/Unique_SFX/u.wav"],
  };
  const schedule = createResultSfxSchedule(manifest, config, { normalCount: 5, includeUnique: false }, () => 0);
  assert.equal(schedule.filter((item) => item.label === "normal").length, 5);
  assert.equal(schedule.filter((item) => item.label === "unique").length, 0);
});

test("isResultSfxManifest は通常/Unique の文字列配列だけを許可する", () => {
  assert.equal(isResultSfxManifest({ normal: ["a.wav"], unique: ["b.wav"] }), true);
  assert.equal(isResultSfxManifest({ normal: ["a.wav"], unique: [1] }), false);
  assert.equal(isResultSfxManifest({ normal: "a.wav", unique: ["b.wav"] }), false);
});

test("isResultSfxManifest は featured を任意で許可する", () => {
  assert.equal(isResultSfxManifest({ normal: ["a.wav"], unique: ["b.wav"], featured: ["f.wav"] }), true);
  assert.equal(isResultSfxManifest({ normal: ["a.wav"], unique: ["b.wav"], featured: [1] }), false);
});

const featuredManifest = {
  normal: Array.from({ length: 12 }, (_, i) => `SFX/result_sfx/${i}.wav`),
  unique: ["SFX/result_sfx/Unique_SFX/u.wav"],
  featured: ["SFX/result_sfx/Featured/featured.wav"],
};

test("createResultSfxSchedule は roll成功時に featured を1本入れる", () => {
  // random() は毎回 0 を返す → 0 < 0.2 で抽選成功
  const schedule = createResultSfxSchedule(
    featuredManifest,
    config,
    { normalCount: 7, includeFeatured: true },
    () => 0,
  );
  const featured = schedule.filter((item) => item.label === "featured");
  assert.equal(featured.length, 1);
  assert.equal(featured[0].file, "SFX/result_sfx/Featured/featured.wav");
  assert.equal(featured[0].volume, 3);
});

test("createResultSfxSchedule は roll失敗時に featured を入れない", () => {
  // random() が常に 0.99 → 0.99 < 0.2 は偽で抽選失敗
  const schedule = createResultSfxSchedule(
    featuredManifest,
    config,
    { normalCount: 7, includeFeatured: true },
    () => 0.99,
  );
  assert.equal(schedule.filter((item) => item.label === "featured").length, 0);
});

test("createResultSfxSchedule は includeFeatured未指定なら featured を入れない", () => {
  const schedule = createResultSfxSchedule(featuredManifest, config, { normalCount: 7 }, () => 0);
  assert.equal(schedule.filter((item) => item.label === "featured").length, 0);
});

test("createResultSfxSchedule は featuredChance で抽選確率を上書きできる", () => {
  // chance=0 なら常に失敗
  const off = createResultSfxSchedule(
    featuredManifest,
    config,
    { normalCount: 7, includeFeatured: true, featuredChance: 0 },
    () => 0,
  );
  assert.equal(off.filter((item) => item.label === "featured").length, 0);
});
