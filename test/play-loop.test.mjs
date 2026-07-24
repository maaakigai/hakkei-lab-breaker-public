// test/play-loop.test.mjs
// M2-13/14: Title -> Result の縦通しが、状態遷移レベルで 10回連続して破綻しないことを確認する。
// （DOM/Electron は別途 launch で確認。ここでは遷移ロジックの健全性を担保する。）
import test from "node:test";
import assert from "node:assert/strict";

import { transition, INITIAL_STATE } from "../src/renderer/stateMachine.ts";

// 1プレイ分のイベント列（v2 magnitude-only + パンチ検出）。
// InputCheck から直接 Ready→Charge→HakkeiReady（Calibration/DominantHandCheck/HakkeiPrep 撤去）。
const PLAY_DETECTED = [
  "start",
  "inputOk",
  "countdownEnd",
  "chargeDone",
  "hakkeiDetected",
  "impactDone",
  "videoEnd",
];

// 1プレイ分（no-impact タイムアウト経路）。
const PLAY_TIMEOUT = [
  "start",
  "inputOk",
  "countdownEnd",
  "chargeDone",
  "hakkeiTimeout",
  "videoEnd",
];

function runPlay(events) {
  let s = INITIAL_STATE;
  for (const e of events) {
    const next = transition(s, e);
    assert.notEqual(next, null, `${s} --${e}--> 有効な遷移であるべき`);
    s = next;
  }
  assert.equal(s, "Result", "最終状態は Result");
  // 再プレイで InputCheck へ戻る
  return transition(s, "replay");
}

test("Keyboard 縦通しを10回連続（発勁検出/タイムアウト交互）してもResultに到達 (M2-13/14)", () => {
  for (let i = 0; i < 10; i++) {
    const events = i % 2 === 0 ? PLAY_DETECTED : PLAY_TIMEOUT;
    const back = runPlay(events);
    assert.equal(back, "InputCheck", `replay #${i} は InputCheck へ`);
  }
});

test("各プレイ中の Esc はいつでも Title へ戻れる", () => {
  let s = INITIAL_STATE;
  for (const e of PLAY_DETECTED) {
    s = transition(s, e);
    assert.equal(transition(s, "esc"), "Title", `${s} から Esc で Title`);
  }
});
