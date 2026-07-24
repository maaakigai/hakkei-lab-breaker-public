// test/config-loader.test.mjs
// M4-04: config の読み込みと schema 検証。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const realConfig = join(root, "config");

test("正規の config/*.json は valid で bundle を返す (M4-01/02/03)", () => {
  const res = loadConfigBundle(realConfig, 12345);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.schemaVersion, 1);
    assert.equal(res.value.loadedAtMs, 12345);
    assert.equal(res.value.runtime.uiMode, "release");
    assert.equal(res.value.runtime.localMode, false);
    assert.equal(res.value.input.udp.requireSeq, true); // M4-02
    assert.equal(res.value.input.udp.maxDatagramBytes, 8192);
    assert.equal(res.value.input.inputCheck.mocopiBleReadyPolicy, "recent-only");
    assert.equal(res.value.input.inputCheck.mocopiBleRecentWindowMs, 1000);
    assert.ok(res.value.score.videoLevels.length === 6); // M4-03
    assert.deepEqual(res.value.score.videoLevels[0].files, undefined);
    assert.ok(res.value.score.videoLevels[5].files.includes("LV5/LV5_1.mp4"));
    assert.ok(res.value.score.videoLevels[5].files.includes("LV5/LV5_5.mp4"));
    assert.equal(res.value.app.timers.verticalChargeMs, 10000);
    // §0.23/M15-01 追加フィールド
    assert.equal(res.value.app.timers.chargeMs, 10000);
    assert.equal(res.value.app.timers.idleEventMs, 15000);
    assert.equal(res.value.app.timers.idleEnabled, false); // M15-06 まで無効
    assert.equal(res.value.app.audio.bgm.file, "BGM/placeholder-main-loop.wav");
    assert.equal(res.value.app.audio.bgm.loop, true);
    assert.equal(res.value.app.audio.bgm.autoplay, true);
    assert.ok(res.value.app.audio.bgm.volume >= 0 && res.value.app.audio.bgm.volume <= 3);
    assert.equal(res.value.app.audio.chargeSound.file, "SFX/placeholder-charge-loop.wav");
    assert.equal(res.value.app.audio.chargeSound.loop, true);
    assert.ok(res.value.app.audio.chargeSound.volume >= 0 && res.value.app.audio.chargeSound.volume <= 10);
    assert.equal(res.value.app.audio.overchargeSound.file, "SFX/placeholder-overcharge-loop.wav");
    assert.equal(res.value.app.audio.overchargeSound.loop, true);
    assert.ok(res.value.app.audio.overchargeSound.volume >= 0 && res.value.app.audio.overchargeSound.volume <= 10);
    assert.equal(res.value.app.audio.resultVoiceSfx.normalCount, 10);
    assert.equal(res.value.app.audio.resultVoiceSfx.normalVolume, 3);
    assert.equal(res.value.app.audio.resultVoiceSfx.uniqueVolume, 2.25);
    assert.equal(res.value.app.audio.resultVoiceSfx.featuredProbability, 0.25);
    assert.ok(res.value.score.hakkei.forwardCos < res.value.score.hakkei.dirCos);
    assert.ok(res.value.score.hakkei.hiddenForwardLeakMax >= 0 && res.value.score.hakkei.hiddenForwardLeakMax <= 1);
    assert.ok(res.value.score.hakkei.hiddenStrengthScale > 0 && res.value.score.hakkei.hiddenStrengthScale <= 1);
    assert.equal(res.value.score.dominantHand.default, "right");
    // v2 magnitude-only punch config（SPEC v2・角速度ベース・source 別閾値=案1）。
    assert.ok(res.value.score.punch.intensityThresholdKeyboard > 0);
    assert.ok(res.value.score.punch.intensityThresholdBle > 0);
    assert.ok(res.value.score.punch.chargeNoiseFloor >= 0);
    assert.ok(res.value.score.punch.cooldownMs >= 0);
    assert.equal(res.value.score.outcomes.forward.scoreVisible, true);
    assert.deepEqual(res.value.score.outcomes.forward.video, { kind: "powerLevel" });
    assert.equal(res.value.score.outcomes.down.video.kind, "none");
    assert.equal(res.value.score.resultDamageReport.items[0].label, "Toshiba LCD monitor (replacement)");
    assert.equal(res.value.score.resultDamageReport.items[0].unitPriceMin, 25000);
    assert.equal(res.value.score.resultDamageReport.items[0].minLevel, 2);
    assert.ok(res.value.score.resultDamageReport.maxLinesByLevel.length >= 6);
    assert.ok(res.value.score.power.damageCurve.maxYen > 0);
    assert.ok(res.value.score.power.damageCurve.maxPower > res.value.score.power.damageCurve.deadZonePower);
  }
});

test("runtime のUI/local modeは config JSON ではなく起動側から bundle に入る", () => {
  const res = loadConfigBundle(realConfig, 12345, { uiMode: "debug", localMode: true });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.runtime.uiMode, "debug");
    assert.equal(res.value.runtime.localMode, true);
    assert.equal(res.value.app.defaultInputMode, "keyboard");
  }
});

test("idleEnabled=true で hakkeiReadyTimeoutMs < idleEventMs+grace は CONFIG_INVALID（§0.23.4）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const loaded = loadConfigBundle(realConfig, 0);
    const app = JSON.parse(JSON.stringify(loaded.ok ? loaded.value.app : {}));
    app.timers.idleEnabled = true; // 有効化すると不変条件が効く
    app.timers.hakkeiReadyTimeoutMs = 5000; // idleEventMs(15000) より小さい＝矛盾
    writeFileSync(join(dir, "app.config.json"), JSON.stringify(app));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /hakkeiReadyTimeoutMs/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idleEnabled=false なら timeout<idle でも valid（M15-06 前は idle 未計測）", () => {
  // 現行 realConfig は idleEnabled=false・hakkeiReadyTimeoutMs=5000・idleEventMs=15000。
  const res = loadConfigBundle(realConfig, 0);
  assert.equal(res.ok, true);
});

test("outcomes の未知 trigger key は CONFIG_INVALID（trigger map契約）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const loaded = loadConfigBundle(realConfig, 0);
    const score = JSON.parse(JSON.stringify(loaded.ok ? loaded.value.score : {}));
    score.outcomes.forwad = { scoreVisible: false, video: { kind: "none" } }; // typo
    writeFileSync(join(dir, "score.config.json"), JSON.stringify(score));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /unknown trigger/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outcomes.forward 欠落は CONFIG_INVALID（core trigger必須）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const loaded = loadConfigBundle(realConfig, 0);
    const score = JSON.parse(JSON.stringify(loaded.ok ? loaded.value.score : {}));
    delete score.outcomes.forward;
    writeFileSync(join(dir, "score.config.json"), JSON.stringify(score));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /forward/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forwardCos >= dirCos は CONFIG_INVALID（§0.23.5）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const loaded = loadConfigBundle(realConfig, 0);
    const score = JSON.parse(JSON.stringify(loaded.ok ? loaded.value.score : {}));
    score.hakkei.forwardCos = 0.9;
    score.hakkei.dirCos = 0.8; // forwardCos >= dirCos
    writeFileSync(join(dir, "score.config.json"), JSON.stringify(score));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /forwardCos/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requireSeq=false は CONFIG_INVALID (M4-04)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const bad = JSON.parse(
      // 既存を読み直すより、不正値で上書きするのが簡単。
      '{"schemaVersion":1,"inputCheck":{"mocopiBleReadyPolicy":"recent-only","mocopiBleRecentWindowMs":1000},"udp":{"host":"127.0.0.1","port":45100,"mocopiBlePort":45150,"maxDatagramBytes":8192,"heartbeatTimeoutMs":1500,"motionTimeoutMs":1500,"lowSampleRateHz":20,"requiredSampleRateHz":30,"requireSeq":false},"coordinates":{},"filter":{},"jitter":{},"keyboard":{"sampleRateHz":60,"tapVerticalStepM":0.33,"tapForwardStepM":0.15,"tapSpeedMps":2.0,"enterForwardDisplacementM":0.3,"enterDurationMs":200,"enterPunchIntensity":1000,"keyReleaseStaleMs":500}}',
    );
    writeFileSync(join(dir, "input.config.json"), JSON.stringify(bad));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /requireSeq/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("壊れた JSON は CONFIG_INVALID (M4-04)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    writeFileSync(join(dir, "score.config.json"), "{ this is not json ");
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalization で max<=min は CONFIG_INVALID (M4-04)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const score = JSON.parse(
      JSON.stringify(loadConfigBundle(realConfig, 0).ok ? loadConfigBundle(realConfig, 0).value.score : {}),
    );
    score.normalization.rightChargeMax = score.normalization.rightChargeMin; // max<=min
    writeFileSync(join(dir, "score.config.json"), JSON.stringify(score));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timers.chargePrepMs が負なら CONFIG_INVALID（構え猶予 prep）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hlb-cfg-"));
  try {
    cpSync(realConfig, dir, { recursive: true });
    const loaded = loadConfigBundle(realConfig, 0);
    const app = JSON.parse(JSON.stringify(loaded.ok ? loaded.value.app : {}));
    app.timers.chargePrepMs = -1; // 負値は不可
    writeFileSync(join(dir, "app.config.json"), JSON.stringify(app));
    const res = loadConfigBundle(dir, 0);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "CONFIG_INVALID");
      assert.match(res.messageJa, /chargePrepMs/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
