import test from "node:test";
import assert from "node:assert/strict";

const listeners = { keydown: [], keyup: [] };
globalThis.window = {
  addEventListener(type, listener) {
    listeners[type]?.push(listener);
  },
  removeEventListener(type, listener) {
    const entries = listeners[type];
    const index = entries?.indexOf(listener) ?? -1;
    if (index >= 0) {
      entries.splice(index, 1);
    }
  },
};

const { installKeyboardInput } = await import("../src/renderer/keyboardInput.ts");

function keyboardEvent(code, targetTag = "BODY") {
  let prevented = false;
  let stopped = false;
  return {
    code,
    repeat: false,
    target: {
      tagName: targetTag,
      isContentEditable: false,
    },
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {
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

function setup(forceEnterResult = true) {
  const safetyKeys = [];
  const forcedModes = [];
  const sent = [];
  const api = {
    sendKeyboardControl(payload) {
      sent.push(payload);
    },
  };
  const handle = installKeyboardInput(
    api,
    (key) => {
      safetyKeys.push(key);
      return key === "ForceEnter" ? forceEnterResult : true;
    },
    (mode) => forcedModes.push(mode),
  );
  const dispatch = (event) => {
    for (const listener of [...listeners.keydown]) {
      listener(event);
    }
  };
  return { dispatch, forcedModes, handle, safetyKeys, sent };
}

test("CtrlでFORCED CRITICALをトグルし、入力欄では切り替えない", () => {
  const { dispatch, forcedModes, handle } = setup();
  dispatch(keyboardEvent("ControlLeft"));
  dispatch(keyboardEvent("ControlRight"));
  dispatch(keyboardEvent("ControlLeft", "INPUT"));
  assert.deepEqual(forcedModes, ["critical", "none"]);
  handle.uninstall();
});

test("FORCED CRITICAL中のEnterはForceEnterへ渡し、実発火した場合だけ消費する", () => {
  const active = setup(true);
  active.dispatch(keyboardEvent("ControlLeft"));
  const fired = keyboardEvent("Enter");
  active.dispatch(fired);
  assert.deepEqual(active.safetyKeys, ["ForceEnter"]);
  assert.equal(fired.prevented, true);
  assert.equal(fired.stopped, true);
  active.handle.uninstall();

  const inactive = setup(false);
  inactive.dispatch(keyboardEvent("ControlLeft"));
  const ignored = keyboardEvent("Enter");
  inactive.dispatch(ignored);
  assert.deepEqual(inactive.safetyKeys, ["ForceEnter"]);
  assert.equal(ignored.stopped, false);
  inactive.handle.uninstall();
});
