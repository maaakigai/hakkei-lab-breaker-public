// src/main/appConfig.ts
//
// Load and validate config/*.json into one AppConfigBundle.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppConfig,
  AppConfigBundle,
  InputConfig,
  ScoreConfig,
} from "../shared/configTypes.ts";
import type { IpcResult, KeyboardKey } from "../shared/types.ts";

class ConfigError extends Error {}

function fail(message: string): never {
  throw new ConfigError(message);
}

function num(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${where}.${key} must be a finite number`);
  }
  return v;
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectSchemaV1(raw: Record<string, unknown>, where: string): void {
  if (raw.schemaVersion !== 1) {
    fail(`${where}.schemaVersion must be 1`);
  }
}

function keyboardKey(raw: Record<string, unknown>, key: string, where: string): KeyboardKey {
  const v = raw[key];
  if (
    v !== "Space" &&
    v !== "KeyA" &&
    v !== "KeyD" &&
    v !== "KeyL" &&
    v !== "KeyH" &&
    v !== "Enter" &&
    v !== "KeyR" &&
    v !== "Escape"
  ) {
    fail(`${where}.${key} must be a supported KeyboardKey`);
  }
  return v;
}

function validateVideoSelection(raw: unknown, where: string): void {
  const v = obj(raw, where);
  if (v.kind === "powerLevel" || v.kind === "none") {
    return;
  }
  if (v.kind === "fixed") {
    if (typeof v.file !== "string" || v.file.length === 0) {
      fail(`${where}.file must be a non-empty string when kind="fixed"`);
    }
    return;
  }
  fail(`${where}.kind must be "powerLevel" | "fixed" | "none"`);
}

function validateSafeVideoPath(value: unknown, where: string): void {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string`);
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`${where} must be a safe relative path`);
  }
}

function validateSafeVideoFolder(value: unknown, where: string): void {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string`);
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`${where} must be a safe relative folder`);
  }
}

function validateSafeAudioPath(value: unknown, where: string): void {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string`);
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`${where} must be a safe relative path`);
  }
  const lower = value.toLowerCase();
  if (!lower.endsWith(".wav") && !lower.endsWith(".mp3")) {
    fail(`${where} must end with .wav or .mp3`);
  }
}

function validateSafeImagePath(value: unknown, where: string): void {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string`);
  }
  const str = value as string;
  if (
    str.includes("\\") ||
    str.startsWith("/") ||
    str.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`${where} must be a safe relative path`);
  }
  const lower = str.toLowerCase();
  if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg") && !lower.endsWith(".webp")) {
    fail(`${where} must end with .png, .jpg, .jpeg or .webp`);
  }
}

function listVideoFolderFiles(projectRoot: string, folder: string, where: string): string[] {
  try {
    const files = readdirSync(join(projectRoot, "assets", "videos", folder), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
      .map((entry) => `${folder}/${entry.name}`)
      .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
      fail(`${where} has no mp4 files`);
    }
    return files;
  } catch (e) {
    if (e instanceof ConfigError) {
      throw e;
    }
    fail(`${where} cannot be read`);
  }
}

function validateUrl(raw: unknown, where: string, protocols: readonly string[]): string {
  if (typeof raw !== "string" || raw.length === 0) {
    fail(`${where} must be a non-empty URL string`);
  }
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) {
      fail(`${where} protocol must be one of ${protocols.join(", ")}`);
    }
    return raw;
  } catch (e) {
    if (e instanceof ConfigError) {
      throw e;
    }
    fail(`${where} must be a valid URL`);
  }
}

export function validateApp(raw: unknown): AppConfig {
  const r = obj(raw, "app.config");
  expectSchemaV1(r, "app.config");
  const t = obj(r.timers, "app.config.timers");
  for (const k of [
    "calibrationPrepMs",
    "readyCountdownMs",
    "chargePrepMs",
    "chargeMs",
    "verticalChargeMs",
    "forwardChargeMs",
    "hakkeiPrepMs",
    "hakkeiReadyTimeoutMs",
    "idleEventMs",
    "impactDelayMs",
  ]) {
    if (num(t, k, "app.config.timers") < 0) {
      fail(`app.config.timers.${k} must be >= 0`);
    }
  }
  if (typeof t.idleEnabled !== "boolean") {
    fail("app.config.timers.idleEnabled must be boolean");
  }
  // 不変条件（§0.23.4・Required 1）: idle(15s) を発火させるには HakkeiReady の timeout が
  // idle より後でなければならない。さもないと timeout が先に切れて idle が永遠に発火しない。
  // idleEnabled=false（M15-06前）はidle未計測なので現行timeoutを伸ばさない。
  const idleGraceMs = 250;
  if (
    t.idleEnabled === true &&
    num(t, "hakkeiReadyTimeoutMs", "app.config.timers") < num(t, "idleEventMs", "app.config.timers") + idleGraceMs
  ) {
    fail(`app.config.timers.hakkeiReadyTimeoutMs must be >= idleEventMs + ${idleGraceMs} when idleEnabled (idle 発火条件・§0.23.4)`);
  }
  if (typeof r.appName !== "string" || r.appName.length === 0) {
    fail("app.config.appName must be a non-empty string");
  }
  const audio = obj(r.audio, "app.config.audio");
  if (audio.missingIsFatal !== false) {
    fail("app.config.audio.missingIsFatal must be false");
  }
  const bgm = obj(audio.bgm, "app.config.audio.bgm");
  validateSafeAudioPath(bgm.file, "app.config.audio.bgm.file");
  if (bgm.loop !== true) {
    fail("app.config.audio.bgm.loop must be true");
  }
  const volume = num(bgm, "volume", "app.config.audio.bgm");
  if (volume < 0 || volume > 3) {
    fail("app.config.audio.bgm.volume must be in [0, 3]");
  }
  if (bgm.autoplay !== true) {
    fail("app.config.audio.bgm.autoplay must be true");
  }
  const chargeSound = obj(audio.chargeSound, "app.config.audio.chargeSound");
  validateSafeAudioPath(chargeSound.file, "app.config.audio.chargeSound.file");
  if (chargeSound.loop !== true) {
    fail("app.config.audio.chargeSound.loop must be true");
  }
  const chargeVolume = num(chargeSound, "volume", "app.config.audio.chargeSound");
  if (chargeVolume < 0 || chargeVolume > 10) {
    fail("app.config.audio.chargeSound.volume must be in [0, 10]");
  }
  const overchargeSound = obj(audio.overchargeSound, "app.config.audio.overchargeSound");
  validateSafeAudioPath(overchargeSound.file, "app.config.audio.overchargeSound.file");
  if (overchargeSound.loop !== true) {
    fail("app.config.audio.overchargeSound.loop must be true");
  }
  const overchargeVolume = num(overchargeSound, "volume", "app.config.audio.overchargeSound");
  if (overchargeVolume < 0 || overchargeVolume > 10) {
    fail("app.config.audio.overchargeSound.volume must be in [0, 10]");
  }
  const phaseCues = obj(audio.phaseCues, "app.config.audio.phaseCues");
  for (const key of ["chargeStart", "stance", "stanceOvercharge", "punch", "punchOvercharge"] as const) {
    const cue = obj(phaseCues[key], `app.config.audio.phaseCues.${key}`);
    validateSafeAudioPath(cue.file, `app.config.audio.phaseCues.${key}.file`);
    validateSafeImagePath(cue.image, `app.config.audio.phaseCues.${key}.image`);
    const vol = num(cue, "volume", `app.config.audio.phaseCues.${key}`);
    if (vol < 0 || vol > 10) {
      fail(`app.config.audio.phaseCues.${key}.volume must be in [0, 10]`);
    }
  }
  for (const key of ["stanceLeadSec", "punchLeadSec"] as const) {
    const lead = num(phaseCues, key, "app.config.audio.phaseCues");
    if (lead < 0 || lead > 1) {
      fail(`app.config.audio.phaseCues.${key} must be in [0, 1]`);
    }
  }
  const resultVoiceSfx = obj(audio.resultVoiceSfx, "app.config.audio.resultVoiceSfx");
  const resultNormalCount = num(resultVoiceSfx, "normalCount", "app.config.audio.resultVoiceSfx");
  if (!Number.isInteger(resultNormalCount) || resultNormalCount < 0 || resultNormalCount > 50) {
    fail("app.config.audio.resultVoiceSfx.normalCount must be an integer in [0, 50]");
  }
  const remoteSession = obj(r.remoteSession, "app.config.remoteSession");
  if (typeof remoteSession.enabled !== "boolean") {
    fail("app.config.remoteSession.enabled must be boolean");
  }
  validateUrl(remoteSession.httpBaseUrl, "app.config.remoteSession.httpBaseUrl", ["http:", "https:"]);
  validateUrl(remoteSession.wsUrl, "app.config.remoteSession.wsUrl", ["ws:", "wss:"]);
  const fallbackPollingMs = num(remoteSession, "fallbackPollingMs", "app.config.remoteSession");
  const reconnectMinMs = num(remoteSession, "reconnectMinMs", "app.config.remoteSession");
  const reconnectMaxMs = num(remoteSession, "reconnectMaxMs", "app.config.remoteSession");
  if (fallbackPollingMs < 250) {
    fail("app.config.remoteSession.fallbackPollingMs must be >= 250");
  }
  if (reconnectMinMs < 100) {
    fail("app.config.remoteSession.reconnectMinMs must be >= 100");
  }
  if (reconnectMaxMs < reconnectMinMs) {
    fail("app.config.remoteSession.reconnectMaxMs must be >= reconnectMinMs");
  }
  for (const key of ["normalVolume", "uniqueVolume", "featuredVolume"] as const) {
    const value = num(resultVoiceSfx, key, "app.config.audio.resultVoiceSfx");
    if (value < 0 || value > 10) {
      fail(`app.config.audio.resultVoiceSfx.${key} must be in [0, 10]`);
    }
  }
  const featuredProbability = num(resultVoiceSfx, "featuredProbability", "app.config.audio.resultVoiceSfx");
  if (featuredProbability < 0 || featuredProbability > 1) {
    fail("app.config.audio.resultVoiceSfx.featuredProbability must be in [0, 1]");
  }
  for (const key of ["baseDelayMs", "staggerMs", "jitterMs"] as const) {
    const value = num(resultVoiceSfx, key, "app.config.audio.resultVoiceSfx");
    if (value < 0 || value > 10000) {
      fail(`app.config.audio.resultVoiceSfx.${key} must be in [0, 10000]`);
    }
  }
  return r as unknown as AppConfig;
}

export function validateInput(raw: unknown): InputConfig {
  const r = obj(raw, "input.config");
  expectSchemaV1(r, "input.config");
  const inputCheck = obj(r.inputCheck, "input.config.inputCheck");
  if (
    inputCheck.mocopiBleReadyPolicy !== "recent-only" &&
    inputCheck.mocopiBleReadyPolicy !== "sticky-after-first"
  ) {
    fail('input.config.inputCheck.mocopiBleReadyPolicy must be "recent-only" or "sticky-after-first"');
  }
  const recentWindowMs = num(inputCheck, "mocopiBleRecentWindowMs", "input.config.inputCheck");
  if (recentWindowMs < 250 || recentWindowMs > 5000) {
    fail("input.config.inputCheck.mocopiBleRecentWindowMs must be in [250, 5000]");
  }
  const udp = obj(r.udp, "input.config.udp");
  num(udp, "port", "input.config.udp");
  num(udp, "mocopiBlePort", "input.config.udp");
  num(udp, "maxDatagramBytes", "input.config.udp");
  num(udp, "lowSampleRateHz", "input.config.udp");
  if (udp.requireSeq !== true) {
    fail("input.config.udp.requireSeq must be true");
  }

  const kb = obj(r.keyboard, "input.config.keyboard");
  for (const k of [
    "sampleRateHz",
    "tapVerticalStepM",
    "tapForwardStepM",
    "tapSpeedMps",
    "enterForwardDisplacementM",
    "enterDurationMs",
    "enterPunchIntensity",
    "keyReleaseStaleMs",
  ]) {
    num(kb, k, "input.config.keyboard");
  }
  keyboardKey(kb, "leftChargeKey", "input.config.keyboard");

  obj(r.coordinates, "input.config.coordinates");
  obj(r.filter, "input.config.filter");
  obj(r.jitter, "input.config.jitter");
  return r as unknown as InputConfig;
}

export function validateScoreConfig(raw: unknown): ScoreConfig {
  const r = obj(raw, "score.config");
  expectSchemaV1(r, "score.config");

  const n = obj(r.normalization, "score.config.normalization");
  const pairs: Array<[string, string]> = [
    ["rightChargeMin", "rightChargeMax"],
    ["leftChargeMin", "leftChargeMax"],
    ["hakkeiVelocityMin", "hakkeiVelocityMax"],
    ["hakkeiAccelerationMin", "hakkeiAccelerationMax"],
    ["hakkeiDisplacementMin", "hakkeiDisplacementMax"],
  ];
  for (const [minK, maxK] of pairs) {
    const lo = num(n, minK, "score.config.normalization");
    const hi = num(n, maxK, "score.config.normalization");
    if (hi <= lo) {
      fail(`score.config.normalization.${maxK} must be greater than ${minK}`);
    }
  }
  for (const k of ["rightChargeNoiseThreshold", "leftChargeNoiseThreshold"]) {
    if (num(n, k, "score.config.normalization") < 0) {
      fail(`score.config.normalization.${k} must be >= 0`);
    }
  }

  const power = obj(r.power, "score.config.power");
  num(power, "powerCoefficient", "score.config.power");
  num(power, "yenCoefficient", "score.config.power");
  const damageCurve = obj(power.damageCurve, "score.config.power.damageCurve");
  const dcDead = num(damageCurve, "deadZonePower", "score.config.power.damageCurve");
  const dcMaxPower = num(damageCurve, "maxPower", "score.config.power.damageCurve");
  const dcMaxYen = num(damageCurve, "maxYen", "score.config.power.damageCurve");
  const dcGamma = num(damageCurve, "gamma", "score.config.power.damageCurve");
  if (dcDead < 0 || dcMaxYen < 0) {
    fail("score.config.power.damageCurve deadZonePower/maxYen must be >= 0");
  }
  if (dcMaxPower <= dcDead) {
    fail("score.config.power.damageCurve.maxPower must be > deadZonePower");
  }
  if (dcGamma <= 0) {
    fail("score.config.power.damageCurve.gamma must be > 0");
  }
  if (num(power, "damageVarianceRatio", "score.config.power") < 0 || num(power, "damageVarianceRatio", "score.config.power") > 1) {
    fail("score.config.power.damageVarianceRatio must be within [0, 1]");
  }

  const hk = obj(r.hakkei, "score.config.hakkei");
  for (const k of [
    "hakkeiMinForwardVelocity",
    "hakkeiMinForwardAcceleration",
    "hakkeiMinForwardDisplacement",
    "hakkeiForwardGateMin",
    "hakkeiWindowMs",
    "dualHakkeiSyncWindowMs",
    "hakkeiCooldownMs",
    "velocityWeight",
    "accelerationWeight",
    "displacementWeight",
  ]) {
    num(hk, k, "score.config.hakkei");
  }
  // D案の閾値ガード: 強さ閾値・windowは正、gate/cooldownは非負とする。
  // 負の前方 gate は横/後ろ寄りの動きを通してしまうため特に弾く。
  for (const k of ["hakkeiMinForwardVelocity", "hakkeiMinForwardAcceleration", "hakkeiMinForwardDisplacement", "hakkeiWindowMs", "dualHakkeiSyncWindowMs"]) {
    if (typeof hk[k] === "number" && hk[k] <= 0) {
      fail(`score.config.hakkei.${k} must be > 0`);
    }
  }
  for (const k of ["hakkeiForwardGateMin", "hakkeiCooldownMs"]) {
    if (typeof hk[k] === "number" && hk[k] < 0) {
      fail(`score.config.hakkei.${k} must be >= 0`);
    }
  }

  // 方向判定（§0.23.5・M15）: forwardCos/dirCos は (0,1]、forwardCos < dirCos。idle 閾値は非負。
  const forwardCos = num(hk, "forwardCos", "score.config.hakkei");
  const dirCos = num(hk, "dirCos", "score.config.hakkei");
  for (const [k, v] of [["forwardCos", forwardCos], ["dirCos", dirCos]] as const) {
    if (v <= 0 || v > 1) {
      fail(`score.config.hakkei.${k} must be in (0, 1]`);
    }
  }
  if (forwardCos >= dirCos) {
    fail("score.config.hakkei.forwardCos must be < dirCos (§0.23.5)");
  }
  const leak = num(hk, "hiddenForwardLeakMax", "score.config.hakkei");
  if (leak < 0 || leak > 1) {
    fail("score.config.hakkei.hiddenForwardLeakMax must be in [0, 1]");
  }
  const hScale = num(hk, "hiddenStrengthScale", "score.config.hakkei");
  if (hScale <= 0 || hScale > 1) {
    fail("score.config.hakkei.hiddenStrengthScale must be in (0, 1]");
  }
  for (const k of ["idleMaxNetDistance", "idleMaxSpeed"]) {
    if (num(hk, k, "score.config.hakkei") < 0) {
      fail(`score.config.hakkei.${k} must be >= 0`);
    }
  }

  // 隠し発火ゲート（§0.23.6）: 非負。
  if (num(r as Record<string, unknown>, "hiddenChargeGate", "score.config") < 0) {
    fail("score.config.hiddenChargeGate must be >= 0");
  }

  // v2 magnitude-only punch（SPEC v2）: intensityThreshold>0、他は非負。
  const punch = obj(r.punch, "score.config.punch");
  for (const k of ["intensityThresholdKeyboard", "intensityThresholdBle"]) {
    if (num(punch, k, "score.config.punch") <= 0) {
      fail(`score.config.punch.${k} must be > 0`);
    }
  }
  for (const k of [
    "chargeNoiseFloor",
    "chargeReadyThreshold",
    "chargeReadyThresholdKeyboard",
    "cooldownMs",
  ]) {
    if (num(punch, k, "score.config.punch") < 0) {
      fail(`score.config.punch.${k} must be >= 0`);
    }
  }
  if (num(punch, "chargeMaxKeyboard", "score.config.punch") <= 0) {
    fail("score.config.punch.chargeMaxKeyboard must be > 0");
  }
  // スコア用チャージ曲線（割合基準ロジスティック）。width は分母なので > 0 必須。
  for (const k of ["chargeScoreMid", "chargeScoreWidth"]) {
    if (num(punch, k, "score.config.punch") <= 0) {
      fail(`score.config.punch.${k} must be > 0`);
    }
  }
  const releaseRatio = num(punch, "punchReleaseRatio", "score.config.punch");
  if (releaseRatio <= 0 || releaseRatio > 1) {
    fail("score.config.punch.punchReleaseRatio must be in (0, 1]");
  }
  // 威力スコアモデル: 正の量とgate/レンジのmin<fullを検証する。
  for (const k of [
    "chargeMax",
    "punchMin",
    "punchMax",
    "detectGateMin",
    "detectGateFull",
    "scoreGateMin",
    "scoreGateFull",
    "scoreGateGamma",
    "noChargeBase",
    "chargeWeight",
    "chargeGamma",
    "punchBase",
    "punchWeight",
    "powerK",
  ]) {
    if (num(punch, k, "score.config.punch") < 0) {
      fail(`score.config.punch.${k} must be >= 0`);
    }
  }
  if (num(punch, "punchMax", "score.config.punch") <= num(punch, "punchMin", "score.config.punch")) {
    fail("score.config.punch.punchMax must be > punchMin");
  }
  if (
    num(punch, "detectGateFull", "score.config.punch") <=
    num(punch, "detectGateMin", "score.config.punch")
  ) {
    fail("score.config.punch.detectGateFull must be > detectGateMin");
  }
  if (
    num(punch, "scoreGateFull", "score.config.punch") <=
    num(punch, "scoreGateMin", "score.config.punch")
  ) {
    fail("score.config.punch.scoreGateFull must be > scoreGateMin");
  }
  if (num(punch, "chargeMax", "score.config.punch") <= 0) {
    fail("score.config.punch.chargeMax must be > 0");
  }

  // 利き手決定（§0.23.2）。
  const dh = obj(r.dominantHand, "score.config.dominantHand");
  if (dh.default !== "right" && dh.default !== "left") {
    fail('score.config.dominantHand.default must be "right" or "left"');
  }
  if (num(dh, "dominantHandMargin", "score.config.dominantHand") < 0) {
    fail("score.config.dominantHand.dominantHandMargin must be >= 0");
  }

  // トリガー別アウトカムmap（§0.23.7）。
  // 未知 key は拒否、forward/down/up/back/idle は必須、video は VideoSelection。
  const knownTriggers = new Set<string>([
    "forward",
    "down",
    "up",
    "back",
    "idle",
    "special_kamehameha",
    "special_domain",
    "noImpact",
    "hiddenMiss",
  ]);
  const oc = obj(r.outcomes, "score.config.outcomes");
  for (const [trigger, raw] of Object.entries(oc)) {
    if (!knownTriggers.has(trigger)) {
      fail(`score.config.outcomes has unknown trigger key "${trigger}"`);
    }
    const entry = obj(raw, `score.config.outcomes.${trigger}`);
    if (typeof entry.scoreVisible !== "boolean") {
      fail(`score.config.outcomes.${trigger}.scoreVisible must be boolean`);
    }
    validateVideoSelection(entry.video, `score.config.outcomes.${trigger}.video`);
  }
  // Phase Aのcore triggerは欠落させない（§0.23）。
  for (const required of ["forward", "down", "up", "back", "idle"]) {
    if (!(required in oc)) {
      fail(`score.config.outcomes.${required} is required`);
    }
  }
  // forward は通常破壊：scoreVisible=true、威力Lv表で動画解決。
  const forwardOutcome = obj(oc.forward, "score.config.outcomes.forward");
  if (forwardOutcome.scoreVisible !== true) {
    fail("score.config.outcomes.forward.scoreVisible must be true");
  }
  if (obj(forwardOutcome.video, "score.config.outcomes.forward.video").kind !== "powerLevel") {
    fail('score.config.outcomes.forward.video.kind must be "powerLevel"');
  }

  if (!Array.isArray(r.rankThresholds) || r.rankThresholds.length === 0) {
    fail("score.config.rankThresholds must be a non-empty array");
  }
  const resultDamageReport = obj(r.resultDamageReport, "score.config.resultDamageReport");
  if (
    !Array.isArray(resultDamageReport.maxLinesByLevel) ||
    resultDamageReport.maxLinesByLevel.length < 6
  ) {
    fail("score.config.resultDamageReport.maxLinesByLevel must be an array of >= 6 numbers (level 0..5)");
  }
  for (const n of resultDamageReport.maxLinesByLevel as unknown[]) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
      fail("score.config.resultDamageReport.maxLinesByLevel[] must be a number >= 1");
    }
  }
  if (
    num(resultDamageReport, "reserveRatio", "score.config.resultDamageReport") < 0 ||
    num(resultDamageReport, "reserveRatio", "score.config.resultDamageReport") > 0.9
  ) {
    fail("score.config.resultDamageReport.reserveRatio must be within [0, 0.9]");
  }
  num(resultDamageReport, "reconcileHighLevel", "score.config.resultDamageReport");
  for (const key of ["reconcileLabel", "reconcileLabelHigh"]) {
    if (typeof resultDamageReport[key] !== "string" || (resultDamageReport[key] as string).length === 0) {
      fail(`score.config.resultDamageReport.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(resultDamageReport.items) || resultDamageReport.items.length === 0) {
    fail("score.config.resultDamageReport.items must be a non-empty array");
  }
  for (const rawItem of resultDamageReport.items) {
    const item = obj(rawItem, "score.config.resultDamageReport.items[]");
    if (typeof item.label !== "string" || item.label.length === 0) {
      fail("score.config.resultDamageReport.items[].label must be a non-empty string");
    }
    if (typeof item.unit !== "string" || item.unit.length === 0) {
      fail("score.config.resultDamageReport.items[].unit must be a non-empty string");
    }
    for (const key of ["unitPriceMin", "unitPriceMax", "minLevel", "maxCount", "weight"]) {
      if (num(item, key, "score.config.resultDamageReport.items[]") < 0) {
        fail(`score.config.resultDamageReport.items[].${key} must be >= 0`);
      }
    }
    if (
      num(item, "unitPriceMax", "score.config.resultDamageReport.items[]") <
      num(item, "unitPriceMin", "score.config.resultDamageReport.items[]")
    ) {
      fail("score.config.resultDamageReport.items[].unitPriceMax must be >= unitPriceMin");
    }
    if (num(item, "maxCount", "score.config.resultDamageReport.items[]") < 1) {
      fail("score.config.resultDamageReport.items[].maxCount must be >= 1");
    }
    if (num(item, "minLevel", "score.config.resultDamageReport.items[]") > 5) {
      fail("score.config.resultDamageReport.items[].minLevel must be <= 5");
    }
    if (num(item, "weight", "score.config.resultDamageReport.items[]") <= 0) {
      fail("score.config.resultDamageReport.items[].weight must be > 0");
    }
  }
  if (!Array.isArray(r.videoLevels) || r.videoLevels.length === 0) {
    fail("score.config.videoLevels must be a non-empty array");
  }
  for (const v of r.videoLevels) {
    const vo = obj(v, "score.config.videoLevels[]");
    num(vo, "minPower", "score.config.videoLevels[]");
    if (vo.maxPower !== null && vo.maxPower !== undefined) {
      num(vo, "maxPower", "score.config.videoLevels[]");
    }
    if (vo.file !== undefined) {
      validateSafeVideoPath(vo.file, "score.config.videoLevels[].file");
    }
    if (vo.folder !== undefined) {
      validateSafeVideoFolder(vo.folder, "score.config.videoLevels[].folder");
    }
    if (vo.level === 0 && vo.file === undefined && vo.folder === undefined) {
      continue;
    }
    if (vo.file === undefined && vo.folder === undefined) {
      fail("score.config.videoLevels[] must have file or folder");
    }
  }
  return r as unknown as ScoreConfig;
}

function hydrateVideoLevelFolders(score: ScoreConfig, projectRoot: string): ScoreConfig {
  return {
    ...score,
    videoLevels: score.videoLevels.map((level) => {
      if (!level.folder) {
        return level;
      }
      const files = listVideoFolderFiles(
        projectRoot,
        level.folder,
        `score.config.videoLevels[level=${level.level}].folder`,
      );
      return { ...level, files };
    }),
  };
}

export function loadConfigBundle(
  configDir: string,
  loadedAtMs: number,
  runtime: AppConfigBundle["runtime"] = { uiMode: "release", localMode: false },
): IpcResult<AppConfigBundle> {
  try {
    const readJson = (file: string): unknown => {
      const text = readFileSync(join(configDir, file), "utf8");
      try {
        return JSON.parse(text);
      } catch {
        fail(`${file} is not valid JSON`);
      }
    };

    const app = validateApp(readJson("app.config.json"));
    const input = validateInput(readJson("input.config.json"));
    const projectRoot = join(configDir, "..");
    const score = hydrateVideoLevelFolders(validateScoreConfig(readJson("score.config.json")), projectRoot);

    return {
      ok: true,
      value: {
        schemaVersion: 1,
        loadedAtMs,
        runtime,
        app,
        input,
        score,
        sourcePaths: {
          app: "config/app.config.json",
          input: "config/input.config.json",
          score: "config/score.config.json",
        },
      },
    };
  } catch (e) {
    const messageJa =
      e instanceof ConfigError ? e.message : `config load failed: ${String(e)}`;
    return { ok: false, code: "CONFIG_INVALID", messageJa };
  }
}
