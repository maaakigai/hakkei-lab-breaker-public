// test/state-machine.test.mjs
// M1-17: 状態遷移の単体テスト。
// Node 24 のネイティブ TypeScript サポート（型ストリップ）で .ts を直接 import する。
import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_STATES,
  INITIAL_STATE,
  transition,
  isValidTransition,
  canReset,
} from "../src/renderer/stateMachine.ts";

test("初期状態は Title (M1-02)", () => {
  assert.equal(INITIAL_STATE, "Title");
});

test("正常系: Title から Result まで一通り進める（v2 magnitude-only）", () => {
  let s = INITIAL_STATE;
  const path = [
    ["start", "InputCheck"],
    ["inputOk", "Ready"],
    ["countdownEnd", "Charge"],
    ["chargeDone", "HakkeiReady"],
    ["hakkeiDetected", "ImpactDelay"],
    ["impactDone", "VideoPlayback"],
    ["videoEnd", "Result"],
  ];
  for (const [event, expected] of path) {
    const next = transition(s, event);
    assert.equal(next, expected, `${s} --${event}--> ${expected}`);
    s = next;
  }
});

test("v2 flow: InputCheck→Ready→Charge→HakkeiReady（Calibration/DominantHandCheck/HakkeiPrep 撤去）", () => {
  assert.equal(transition("InputCheck", "inputOk"), "Ready");
  assert.equal(transition("Ready", "countdownEnd"), "Charge");
  assert.equal(transition("Charge", "chargeDone"), "HakkeiReady");
  // 旧フロー event/state は廃止
  assert.equal(transition("InputCheck", "inputUnityOk"), null);
  assert.equal(transition("InputCheck", "inputKeyboardOk"), null);
  assert.equal(transition("Charge", "hakkeiPrepDone"), null);
  // charge 中も安全操作 Esc/reset は有効
  assert.equal(transition("Charge", "esc"), "Title");
  assert.equal(transition("Charge", "reset"), "InputCheck");
});

test("HakkeiReady タイムアウトは VideoPlayback (no-impact)", () => {
  assert.equal(transition("HakkeiReady", "hakkeiTimeout"), "VideoPlayback");
});

test("戻り遷移: Result から Title / InputCheck", () => {
  assert.equal(transition("Result", "finish"), "Title");
  assert.equal(transition("Result", "replay"), "InputCheck");
});

test("Esc は全状態から Title (M1-16 / SPEC 10.3)", () => {
  for (const s of APP_STATES) {
    assert.equal(transition(s, "esc"), "Title", `${s} --esc--> Title`);
  }
});

test("R(reset) は Ready以降のみ InputCheck", () => {
  assert.equal(transition("Ready", "reset"), "InputCheck");
  assert.equal(transition("VideoPlayback", "reset"), "InputCheck");
  // Ready より前では reset は無効
  assert.equal(transition("Title", "reset"), null);
  assert.equal(transition("InputCheck", "reset"), null);
  assert.equal(canReset("HakkeiReady"), true);
  assert.equal(canReset("Title"), false);
});

test("fail は Error以外から Error、Error からは無効", () => {
  assert.equal(transition("VideoPlayback", "fail"), "Error");
  assert.equal(transition("Title", "fail"), "Error");
  assert.equal(transition("Error", "fail"), null);
});

test("Error からの復帰", () => {
  assert.equal(transition("Error", "recover"), "Title");
  assert.equal(transition("Error", "recheck"), "InputCheck");
});

test("受理できないイベントは null (no-op)", () => {
  assert.equal(transition("Title", "videoEnd"), null);
  assert.equal(transition("Charge", "start"), null);
  assert.equal(isValidTransition("Title", "start"), true);
  assert.equal(isValidTransition("Title", "finish"), false);
});
