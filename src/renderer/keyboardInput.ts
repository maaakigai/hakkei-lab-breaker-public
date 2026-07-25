// src/renderer/keyboardInput.ts
//
// keydown/keyup を検出して Main へ送る（SPEC.md 4章: Renderer は keydown/keyup を Main へ送り、
// Main が疑似 MotionSample を生成する）。ここでは座標やscoreを作らない。
//   - Space/A/D/Enter: Main の generator 用に送る。
//   - R/Esc: 安全操作。Main にも送りつつ、ローカルの状態遷移コールバックを呼ぶ。
// pressed 状態は diagnostic 表示のため保持する。

import type { HakkeiPreloadApi, KeyboardControlPayload, KeyboardKey } from "../shared/types.ts";

const CODE_TO_KEY: Record<string, KeyboardKey> = {
  Space: "Space",
  KeyA: "KeyA",
  KeyD: "KeyD",
  KeyL: "KeyL",
  KeyH: "KeyH",
  Enter: "Enter",
  KeyR: "KeyR",
  Escape: "Escape",
};

// フォーカス中の要素がテキスト入力系（input/textarea/select/contenteditable）かどうか。
// これらに入力している間はゲーム用ショートカットを無効化する。
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") {
    return false;
  }
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export type KeyboardInputHandle = {
  getPressed(): ReadonlySet<KeyboardKey>;
  setForcedHakkeiMode(mode: ForcedHakkeiMode): void;
  uninstall(): void;
};

// 安全操作（R/Esc）＋開発/展示用ショートカットをローカルへ通知する。
export type SafetyKeyHandler = (key: "KeyR" | "Escape" | "KeyH" | "ForceEnter") => boolean | void;
export type ForcedHakkeiMode = "none" | "critical";
export type ForcedHakkeiModeHandler = (mode: ForcedHakkeiMode) => void;

export function installKeyboardInput(
  api: HakkeiPreloadApi,
  onSafetyKey: SafetyKeyHandler,
  onForcedHakkeiModeChange: ForcedHakkeiModeHandler = () => undefined,
): KeyboardInputHandle {
  const pressed = new Set<KeyboardKey>();
  let forcedHakkeiMode: ForcedHakkeiMode = "none";

  const setForcedHakkeiMode = (next: ForcedHakkeiMode): void => {
    if (next === forcedHakkeiMode) {
      return;
    }
    forcedHakkeiMode = next;
    onForcedHakkeiModeChange(next);
  };

  const toggleForcedHakkeiMode = (target: Exclude<ForcedHakkeiMode, "none">): void => {
    setForcedHakkeiMode(forcedHakkeiMode === target ? "none" : target);
  };

  const send = (key: KeyboardKey, isDown: boolean, repeat: boolean): void => {
    const payload: KeyboardControlPayload = {
      type: "key",
      key,
      pressed: isDown,
      repeat,
      occurredAtMs: performance.now(),
    };
    // Main が keyboard モードでなければ MODE_UNAVAILABLE が返るだけ（無害）。
    void api.sendKeyboardControl(payload);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // テキスト入力欄（名前入力など）にフォーカスがある間は、ゲーム用キー処理を
    // 一切行わない。R/L/H などが preventDefault や安全操作で奪われ文字が打てなくなるため。
    if (isEditableTarget(e.target)) {
      return;
    }
    if (!e.repeat && (e.code === "ControlLeft" || e.code === "ControlRight")) {
      toggleForcedHakkeiMode("critical");
      return;
    }
    const key = CODE_TO_KEY[e.code];
    if (!key) {
      return;
    }
    if (key === "Space" || key === "KeyL" || key === "Enter") {
      // ページスクロール等の既定動作を抑止。
      e.preventDefault();
    }
    const repeat = pressed.has(key);
    pressed.add(key);
    send(key, true, e.repeat || repeat);

    if (!e.repeat && key === "Enter" && forcedHakkeiMode !== "none") {
      if (onSafetyKey("ForceEnter") === true) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (!e.repeat && (key === "KeyR" || key === "Escape" || key === "KeyH")) {
      if (onSafetyKey(key) === true) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) {
      return;
    }
    const key = CODE_TO_KEY[e.code];
    if (!key) {
      return;
    }
    pressed.delete(key);
    send(key, false, false);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    getPressed: () => pressed,
    setForcedHakkeiMode: (mode) => setForcedHakkeiMode(mode),
    uninstall: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },
  };
}
