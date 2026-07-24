import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import {
  handKinematicsFor,
  resolveOutcome,
  resolveTrigger,
} from "../src/renderer/outcomeResolver.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const SCORE = loaded.value.score;

// forward=+z, up=+y のシンプルな基準系（テスト用）。
const FORWARD = { x: 0, y: 0, z: 1 };
const UP = { x: 0, y: 1, z: 0 };

// ロジック検証は固定しきい値で行う（config の実測チューニングと独立にする）。
const THRESH = {
  forwardCos: 0.75,
  dirCos: 0.8,
  hiddenForwardLeakMax: 0.4,
  hiddenChargeGate: 5.0,
};
const CHARGE_OK = 10.0;
const CHARGE_LOW = 1.0;

function input({ directionVector, charge = CHARGE_OK, forwardStrengthMet = true, hiddenStrengthMet = true }) {
  return { forwardStrengthMet, hiddenStrengthMet, directionVector, charge, forwardVector: FORWARD, upVector: UP };
}

test("resolveTrigger: 強さ未満は noImpact", () => {
  const t = resolveTrigger(
    input({ directionVector: { x: 0, y: 0, z: 1 }, forwardStrengthMet: false, hiddenStrengthMet: false }),
    THRESH,
  );
  assert.equal(t, "noImpact");
});

test("resolveTrigger: 上下強さのみ達（前後は未達）でも 前突きは forward にならない", () => {
  // forward 方向だが forwardStrengthMet=false → forward は出ない（弱い前突きは通さない）。
  const t = resolveTrigger(
    input({ directionVector: { x: 0, y: 0, z: 1 }, forwardStrengthMet: false, hiddenStrengthMet: true }),
    THRESH,
  );
  assert.equal(t, "noImpact");
});

test("resolveTrigger: 上下強さのみ達で 上突きは up（弱い上下も拾う・ユーザ実機）", () => {
  const t = resolveTrigger(
    input({ directionVector: { x: 0, y: 1, z: 0 }, forwardStrengthMet: false, hiddenStrengthMet: true }),
    THRESH,
  );
  assert.equal(t, "up");
});

test("resolveTrigger: 方向正規化不能（零ベクトル）は noImpact", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 0, z: 0 } }), THRESH);
  assert.equal(t, "noImpact");
});

test("resolveTrigger: まっすぐ前方は forward", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 0, z: 0.3 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "forward");
});

test("resolveTrigger: 前突きに縦成分が混じっても forward 優先（upに奪われない）", () => {
  // forward 寄りだが上に傾いた突き。dot(dir,forward)≈0.85 ≥ forwardCos → forward。
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 0.5, z: 0.85 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "forward");
});

test("resolveTrigger: 前を満たさない斜め上（前方漏れ超）は up にならず noImpact", () => {
  // dot(dir,forward)≈0.58（forwardCos 未満）だが |前方成分|>leakMax(0.4) なので up にしない。
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 0.81, z: 0.58 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "noImpact");
});

test("resolveTrigger: 純粋な下突き＋gate 達成は down", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: -1, z: 0 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "down");
});

test("resolveTrigger: 純粋な上突き＋gate 達成は up", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 1, z: 0 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "up");
});

test("resolveTrigger: 後方突き＋gate 達成は back", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: 0, z: -1 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "back");
});

test("resolveTrigger: 明確な下突きでも gate 不足は hiddenMiss（通常破壊にしない）", () => {
  const t = resolveTrigger(input({ directionVector: { x: 0, y: -1, z: 0 }, charge: CHARGE_LOW }), THRESH);
  assert.equal(t, "hiddenMiss");
});

test("resolveTrigger: 横払い（方向どれにも当たらず）は noImpact", () => {
  const t = resolveTrigger(input({ directionVector: { x: 1, y: 0, z: 0 }, charge: CHARGE_OK }), THRESH);
  assert.equal(t, "noImpact");
});

test("resolveTrigger: forward 軸が degenerate（零）なら noImpact", () => {
  const t = resolveTrigger(
    { forwardStrengthMet: true, hiddenStrengthMet: true, directionVector: { x: 0, y: 0, z: 1 }, charge: CHARGE_OK, forwardVector: { x: 0, y: 0, z: 0 }, upVector: UP },
    THRESH,
  );
  assert.equal(t, "noImpact");
});

test("resolveTrigger: 水平射影 — forward が上向きに傾いた calibration でも前突きを forward と取る", () => {
  // forwardVector が上に45度傾いていても、水平 forward に射影して判定する。
  const t = resolveTrigger(
    {
      forwardStrengthMet: true,
      hiddenStrengthMet: true,
      directionVector: { x: 0, y: 0, z: 1 }, // 水平前方への突き
      charge: CHARGE_OK,
      forwardVector: { x: 0, y: 1, z: 1 }, // 上に傾いた forward
      upVector: UP,
    },
    THRESH,
  );
  assert.equal(t, "forward");
});

test("resolveOutcome: forward は scoreVisible=true・video=powerLevel（威力Lv表）・score 保持", () => {
  const score = { hakkeiScore: 42 };
  const o = resolveOutcome("forward", score, SCORE.outcomes);
  assert.equal(o.trigger, "forward");
  assert.equal(o.scoreVisible, true);
  assert.deepEqual(o.video, { kind: "powerLevel" });
  assert.equal(o.score, score);
});

test("resolveOutcome: 隠し(down) は scoreVisible=false・動画なし・score は保持（捨てない）", () => {
  const score = { hakkeiScore: 42 };
  const o = resolveOutcome("down", score, SCORE.outcomes);
  assert.equal(o.scoreVisible, false);
  assert.equal(o.video.kind, "none");
  assert.equal(o.score, score);
});

test("resolveOutcome: map に無い trigger は安全側 scoreVisible=false・video=none", () => {
  // 既知だが map 未設定の trigger（special_*）でフォールバックを確認。
  const o = resolveOutcome("special_kamehameha", null, SCORE.outcomes);
  assert.equal(o.scoreVisible, false);
  assert.deepEqual(o.video, { kind: "none" });
  assert.equal(o.score, null);
});

test("resolveTrigger: 斜め下後ろ（縦と後方が同程度）は back（前方漏れで down を除外）", () => {
  // dir=(0,-1,-1)→正規化(0,-.707,-.707)。|前方成分|=.707>leakMax → down 除外。後方成分.707 で back。
  const t = resolveTrigger(input({ directionVector: { x: 0, y: -1, z: -1 }, charge: CHARGE_OK }), {
    forwardCos: SCORE.hakkei.forwardCos,
    dirCos: 0.7,
    hiddenForwardLeakMax: 0.4,
    hiddenChargeGate: 5.0,
  });
  assert.equal(t, "back");
});

test("handKinematicsFor: right はトップレベル、left は leftHand を選ぶ", () => {
  const sample = {
    timestampMs: 100,
    handPosition: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    validForScore: true,
    leftHand: {
      handPosition: { x: -1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      validForScore: true,
    },
  };
  const right = handKinematicsFor(sample, "right");
  const left = handKinematicsFor(sample, "left");
  assert.equal(right.position.x, 1);
  assert.equal(left.position.x, -1);
});

test("handKinematicsFor: left 指定で leftHand 欠落は null", () => {
  const sample = {
    timestampMs: 100,
    handPosition: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    validForScore: true,
    leftHand: null,
  };
  assert.equal(handKinematicsFor(sample, "left"), null);
});
