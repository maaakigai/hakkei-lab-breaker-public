// test/keyboard-input-editable.test.mjs
// テキスト入力欄（名前入力など）にフォーカスがある間は、ゲーム用キーハンドラを
// 素通りさせる（R/L/H などが preventDefault や安全操作で奪われない）ことを検証する。
import test from "node:test";
import assert from "node:assert/strict";

// installKeyboardInput は window / performance グローバルに依存するので、
// モジュール import 前に最小の擬似 window を仕込む。
const listeners = { keydown: [], keyup: [] };
globalThis.window = {
  addEventListener(type, fn) {
    listeners[type]?.push(fn);
  },
  removeEventListener(type, fn) {
    const arr = listeners[type];
    if (arr) {
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  },
};
if (typeof globalThis.performance === "undefined") {
  globalThis.performance = { now: () => 0 };
}

const { installKeyboardInput } = await import("../src/renderer/keyboardInput.ts");

function makeEvent(code, targetTag) {
  let prevented = false;
  let stopped = false;
  const target =
    targetTag == null
      ? { tagName: "BODY", isContentEditable: false }
      : { tagName: targetTag, isContentEditable: targetTag === "DIV" };
  return {
    code,
    repeat: false,
    target,
    preventDefault: () => {
      prevented = true;
    },
    stopImmediatePropagation: () => {
      stopped = true;
    },
    get prevented() {
      return prevented;
    },
    get stopped() {
      return stopped;
    },
  };
}

function setup() {
  const sent = [];
  const safety = [];
  const api = {
    sendKeyboardControl: (payload) => {
      sent.push(payload);
    },
  };
  const handle = installKeyboardInput(api, (key) => {
    safety.push(key);
    return true; // 消費（preventDefault 相当）を要求
  });
  const dispatch = (ev) => listeners.keydown.forEach((fn) => fn(ev));
  return { sent, safety, handle, dispatch };
}

test("入力欄フォーカス時: L は preventDefault されず main へも送られない", () => {
  const { sent, dispatch, handle } = setup();
  const ev = makeEvent("KeyL", "INPUT");
  dispatch(ev);
  assert.equal(ev.prevented, false, "文字入力がキャンセルされてはいけない");
  assert.equal(sent.length, 0, "入力中はゲーム用キーを送らない");
  handle.uninstall();
});

test("入力欄フォーカス時: R は安全操作（リスタート）を発火しない", () => {
  const { safety, dispatch, handle } = setup();
  const ev = makeEvent("KeyR", "INPUT");
  dispatch(ev);
  assert.deepEqual(safety, [], "R がリスタートを発火してはいけない");
  assert.equal(ev.prevented, false);
  handle.uninstall();
});

test("textarea / contenteditable でも同様に素通りする", () => {
  const { sent, safety, dispatch, handle } = setup();
  dispatch(makeEvent("KeyL", "TEXTAREA"));
  dispatch(makeEvent("KeyR", "DIV")); // contenteditable=true
  assert.equal(sent.length, 0);
  assert.deepEqual(safety, []);
  handle.uninstall();
});

test("入力欄が無い（BODY）通常時は従来どおり L を送り R で安全操作する", () => {
  const { sent, safety, dispatch, handle } = setup();
  dispatch(makeEvent("KeyL", null));
  assert.ok(
    sent.some((p) => p.key === "KeyL" && p.pressed === true),
    "通常時は KeyL が main へ送られる",
  );
  dispatch(makeEvent("KeyR", null));
  assert.deepEqual(safety, ["KeyR"], "通常時は R が安全操作を発火する");
  handle.uninstall();
});
