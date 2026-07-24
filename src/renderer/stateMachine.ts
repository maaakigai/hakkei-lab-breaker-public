// src/renderer/stateMachine.ts
//
// アプリの状態と遷移（SPEC v2・magnitude-only モデル）。DOM や Electron には依存しない
// 純粋ロジックなので、そのまま単体テスト（test/state-machine.test.mjs）から import できる。
//
// v2（mocopi BLE 直読・角速度・方向廃止）: Calibration の軸取得 / DominantHandCheck / HakkeiPrep /
// 発勁方向分岐を撤去。利き手1個でチャージ→HakkeiReady でパンチ強さ（intensity ピーク）が閾値超なら発火。
// 表示・ログとの互換性のためHakkeiReady名は据え置き、中身はpunch intensity gateだけとする。

export const APP_STATES = [
  "Title",
  "InputCheck",
  "Ready",
  "Charge",
  "HakkeiReady",
  "ImpactDelay",
  "VideoPlayback",
  "Result",
  "Error",
] as const;

export type AppState = (typeof APP_STATES)[number];

export const INITIAL_STATE: AppState = "Title"; // M1-02

export type AppEvent =
  | "start" // Title -> InputCheck
  | "inputOk" // InputCheck -> Ready（keyboard / BLE 共通。BLE baseline は InputCheck 内）
  | "countdownEnd" // Ready -> Charge
  | "chargeDone" // Charge -> HakkeiReady
  | "hakkeiDetected" // HakkeiReady -> ImpactDelay（パンチ発火）
  | "hakkeiTimeout" // HakkeiReady -> VideoPlayback（no-impact/Lv0）
  | "impactDone" // ImpactDelay -> VideoPlayback
  | "videoEnd" // VideoPlayback -> Result
  | "videoError" // VideoPlayback -> Error
  | "replay" // Result -> InputCheck
  | "finish" // Result -> Title
  | "back" // InputCheck -> Title
  | "recover" // Error -> Title
  | "recheck" // Error -> InputCheck
  | "fail" // 任意(Error以外) -> Error
  | "esc" // 安全操作: 全状態 -> Title
  | "reset"; // R: Ready以降 -> InputCheck

// 通常遷移テーブル（状態ごとに、受け付けるイベント -> 次状態）。
const TRANSITIONS: Partial<Record<AppState, Partial<Record<AppEvent, AppState>>>> = {
  Title: { start: "InputCheck" },
  InputCheck: { inputOk: "Ready", back: "Title" },
  Ready: { countdownEnd: "Charge" },
  Charge: { chargeDone: "HakkeiReady" },
  HakkeiReady: { hakkeiDetected: "ImpactDelay", hakkeiTimeout: "VideoPlayback" },
  ImpactDelay: { impactDone: "VideoPlayback" },
  VideoPlayback: { videoEnd: "Result", videoError: "Error" },
  Result: { replay: "InputCheck", finish: "Title" },
  Error: { recover: "Title", recheck: "InputCheck" },
};

// R（reset）が許可される「Ready以降」のプレイ状態（SPEC §10.3）。
export const RESETTABLE_STATES: readonly AppState[] = [
  "Ready",
  "Charge",
  "HakkeiReady",
  "ImpactDelay",
  "VideoPlayback",
];

export function canReset(state: AppState): boolean {
  return RESETTABLE_STATES.includes(state);
}

/**
 * 状態遷移を計算する。受理できないイベントは null を返す（no-op）。
 *  - esc: 全状態から Title（安全操作）。
 *  - reset(R): Ready以降のみ InputCheck、それ以外は null。
 *  - fail: Error以外から Error。
 *  - その他: 遷移テーブルに従う。
 */
export function transition(state: AppState, event: AppEvent): AppState | null {
  switch (event) {
    case "esc":
      return "Title";
    case "reset":
      return canReset(state) ? "InputCheck" : null;
    case "fail":
      return state === "Error" ? null : "Error";
    default: {
      const next = TRANSITIONS[state]?.[event];
      return next ?? null;
    }
  }
}

export function isValidTransition(state: AppState, event: AppEvent): boolean {
  return transition(state, event) !== null;
}
