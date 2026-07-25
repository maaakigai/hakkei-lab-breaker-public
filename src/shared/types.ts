// src/shared/types.ts
//
// main / preload / renderer で共有するドメイン型と IPC 契約（SPEC.md 7〜9章の M2 サブセット）。
// M2 段階で必要な範囲に絞り、未使用の payload は後続マイルストーンで追加する。

import type { AppConfigBundle } from "./configTypes.ts";
import type { PunchInputSample } from "./punchInput.ts";

export type Vec3 = { x: number; y: number; z: number };

export type MotionSource = "unity-bridge" | "mock-unity-bridge" | "keyboard";

// v2: mocopi-ble は BLE sidecar 入力（V4 で Main 受信を配線）。unity-bridge は旧 Unity UDP 経路。
export type InputMode = "none" | "keyboard" | "mock-unity-bridge" | "unity-bridge" | "mocopi-ble";

// BLE sidecar/replay プロセス（Main spawn・V5）の状態。Renderer は InputCheck 表示にだけ使う。
export type BleSidecarStatus = "not-started" | "starting" | "running" | "stopped" | "error";
export type BleSidecarKind = "sidecar" | "replay";
export type BleSidecarStatusPayload = {
  status: BleSidecarStatus;
  kind: BleSidecarKind | null;
  detail: string;
  restarts: number;
};
// Renderer→Main: sidecar/replay の制御（dev replay ボタン・restart）。
export type BleSidecarControlPayload = {
  action: "start-sidecar" | "start-replay" | "restart" | "stop";
};

export type MotionQualityFlag =
  | "DT_RESET"
  | "DT_TOO_SMALL"
  | "DT_TOO_LARGE"
  | "SEQ_GAP"
  | "TIMESTAMP_GAP"
  | "NOT_TRACKED"
  | "AVATAR_NOT_READY"
  | "RIGHT_HAND_UNAVAILABLE"
  | "COORDINATE_RANGE_WARN"
  | "OUTLIER_POSITION_JUMP"
  | "OUTLIER_VELOCITY"
  | "OUTLIER_ACCELERATION"
  | "RECOVERED_FROM_UNAVAILABLE"
  | "LOW_SAMPLE_RATE";

export type HandMotion = {
  rawHandPosition: Vec3;
  handPosition: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  isAvailable: boolean;
  validForScore: boolean;
  validForCalibration: boolean;
  quality: {
    dtMs: number;
    sampleRateHz: number;
    isFiltered: boolean;
    droppedFrameCount: number;
    invalidPacketCount: number;
    flags: MotionQualityFlag[];
  };
};

export type MotionSample = {
  protocolVersion: 1;
  source: MotionSource;
  sessionId: string;
  seq: number;
  timestampMs: number;
  receivedAtMs: number;
  // Existing top-level hand fields are the right hand for backward compatibility.
  rawHandPosition: Vec3;
  handPosition: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  isAvailable: boolean;
  validForScore: boolean;
  validForCalibration: boolean;
  leftHand: HandMotion | null;
  quality: {
    dtMs: number;
    sampleRateHz: number;
    isFiltered: boolean;
    droppedFrameCount: number;
    invalidPacketCount: number;
    flags: MotionQualityFlag[];
  };
};

// --- Score（M3） ---------------------------------------------------------

export type Rank = "S" | "A" | "B" | "C" | "D" | "E";
export type VideoLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type ScoreRawInput = {
  rightChargeRaw: number;
  leftChargeRaw: number;
  hakkeiVelocityPeak: number;
  hakkeiAccelerationPeak: number;
  hakkeiDisplacement: number;
  hakkeiDetected: boolean;
  hakkeiTimedOut: boolean;
};

export type ScoreBreakdown = {
  rightChargeScore: number;
  leftChargeScore: number;
  hakkeiScore: number;
  hakkeiDetected: boolean;
  hakkeiTimedOut: boolean;
  power: number;
  baseDamageYen: number;
  damageYen: number;
  damageYenText?: string;
  rank: Rank;
  videoLevel: VideoLevel;
  raw: {
    rightChargeRaw: number;
    leftChargeRaw: number;
    hakkeiVelocityPeak: number;
    hakkeiAccelerationPeak: number;
    hakkeiDisplacement: number;
  };
};

// --- 単手モデル：利き手・トリガー・アウトカム（§0.23・M15） ---------------

// 利き手（§0.23.2）。Keyboard 既定 "right"。
export type DominantHand = "right" | "left";

// 発勁ウィンドウの解決結果トリガー（§0.23.5/0.23.6/0.23.7）。
export type OutcomeTrigger =
  | "forward"
  | "down"
  | "up"
  | "back"
  | "idle"
  | "special_kamehameha" // Phase B（M16）
  | "special_domain" // Phase B（M16）
  | "noImpact"
  | "hiddenMiss";

// 動画の選択方式（§0.23.7）。nullで「威力Lv表」と「動画なし」を兼ねると
// 解釈が二重化するため、明示的な判別共用体にする。
export type VideoSelection =
  | { kind: "powerLevel" } // 威力Lv表(§15.2)で解決（通常前方）
  | { kind: "fixed"; file: string } // 固定動画（隠しイベント）
  | { kind: "none" }; // 動画なし（no-impact/空振り）

// trigger と score を分離（§0.23.7）。score は表示しない場合も保持する。
export type Outcome = {
  trigger: OutcomeTrigger;
  scoreVisible: boolean;
  video: VideoSelection;
  score: ScoreBreakdown | null;
};

// --- v1 Bridge packet（SPEC.md 7章, M5） --------------------------------

export type BridgePacketSource = "unity-bridge" | "mock-unity-bridge";

export type ReceiverStatus = "not-started" | "receiving" | "stale" | "error";

export type UnityMotionPacketV1 = {
  protocolVersion: 1;
  type: "motion";
  sessionId: string;
  seq: number;
  timestampMs: number;
  source: BridgePacketSource;
  isTracked: boolean;
  rightHand?: Vec3 | null;
  avatar: {
    isHuman: boolean;
    hasRightHand: boolean;
    forward?: Vec3 | null;
  };
};

export type UnityMotionPacketV2 = {
  protocolVersion: 2;
  type: "motion";
  sessionId: string;
  seq: number;
  timestampMs: number;
  source: BridgePacketSource;
  isTracked: boolean;
  rightHand?: Vec3 | null;
  leftHand?: Vec3 | null;
  avatar: {
    isHuman: boolean;
    hasRightHand: boolean;
    hasLeftHand: boolean;
    forward?: Vec3 | null;
  };
};

export type UnityHeartbeatPacketV1 = {
  protocolVersion: 1;
  type: "heartbeat";
  sessionId: string;
  timestampMs: number;
  source: BridgePacketSource;
  receiverReady: boolean;
  receiverStatus: ReceiverStatus;
  avatarReady: boolean;
  rightHandReady: boolean;
  frameRate: number;
  sendRateHz: number;
};

export type UnityHeartbeatPacketV2 = {
  protocolVersion: 2;
  type: "heartbeat";
  sessionId: string;
  timestampMs: number;
  source: BridgePacketSource;
  receiverReady: boolean;
  receiverStatus: ReceiverStatus;
  avatarReady: boolean;
  rightHandReady: boolean;
  leftHandReady: boolean;
  frameRate: number;
  sendRateHz: number;
};

// --- Status / Warning / Error（SPEC.md 9章, M5-14） ----------------------

export type StatusWarningCode =
  | "UNKNOWN_FIELDS"
  | "SEQ_GAP"
  | "TIMESTAMP_GAP"
  | "LOW_SAMPLE_RATE"
  | "HEARTBEAT_TIMEOUT"
  | "MOTION_TIMEOUT"
  | "AVATAR_NOT_READY"
  | "RIGHT_HAND_UNAVAILABLE"
  | "NOT_TRACKED"
  | "COORDINATE_RANGE_WARN"
  | "DUPLICATE_SOURCE"
  | "NON_ACTIVE_SOURCE_PACKET"
  | "RECOVERED_FROM_UNAVAILABLE"
  | "JITTER_WARN";

export type StatusWarning = {
  code: StatusWarningCode;
  messageJa: string;
  source: MotionSource | "unknown";
  sessionId: string | null;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  count: number;
  detailSafe?: string;
};

export type AppErrorSeverity = "warning" | "error" | "fatal";

export type AppErrorCode =
  | "UNITY_BRIDGE_TIMEOUT"
  | "MOTION_TIMEOUT"
  | "HEARTBEAT_TIMEOUT"
  | "RIGHT_HAND_UNAVAILABLE"
  | "AVATAR_NOT_READY"
  | "NOT_TRACKED"
  | "LOW_SAMPLE_RATE"
  | "INVALID_JSON"
  | "JSON_TOO_LARGE"
  | "UNKNOWN_PACKET_TYPE"
  | "INVALID_PACKET_BASE"
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "INVALID_MOTION_PACKET"
  | "INVALID_HEARTBEAT_PACKET"
  | "SEQ_ROLLBACK"
  | "SEQ_DUPLICATE"
  | "TIMESTAMP_ROLLBACK"
  | "SOURCE_MISMATCH"
  | "VIDEO_MISSING"
  | "VIDEO_DECODE_FAILED"
  | "VIDEO_STALLED"
  | "VIDEO_ENDED_TIMEOUT"
  | "AUDIO_MISSING"
  | "CONFIG_INVALID"
  | "SCORE_INVALID"
  | "IPC_CONTRACT_VIOLATION"
  | "SECURITY_BLOCKED";

export type AppErrorPayload = {
  code: AppErrorCode;
  severity: AppErrorSeverity;
  recoverable: boolean;
  messageJa: string;
  detailSafe?: string;
  source?: MotionSource | "unknown";
  sessionId?: string | null;
  occurredAtMs: number;
};

export type AppErrorClearPayload = {
  code?: AppErrorCode;
  source?: MotionSource | "unknown";
  sessionId?: string | null;
  reason: "recovered" | "mode-change" | "manual-reset" | "user-dismissed";
  occurredAtMs: number;
};

export type MotionHeartbeatPayload = {
  protocolVersion: 1;
  source: BridgePacketSource;
  sessionId: string;
  timestampMs: number;
  receivedAtMs: number;
  receiverReady: boolean;
  receiverStatus: ReceiverStatus;
  avatarReady: boolean;
  rightHandReady: boolean;
  frameRate: number;
  sendRateHz: number;
  isAlive: boolean;
  ageMs: number;
};

export type SourceStatusSnapshot = {
  source: MotionSource;
  isReceiving: boolean;
  currentSessionId: string | null;
  lastMotionAtMs: number | null;
  lastHeartbeatAtMs: number | null;
  motionHz: number;
  heartbeatHz: number;
  avatarReady: boolean | null;
  rightHandReady: boolean | null;
  receiverReady: boolean | null;
  receiverStatus: ReceiverStatus | null;
  lastSeq: number | null;
  droppedFrameCount: number;
  invalidPacketCount: number;
  validSampleRatio: number | null;
  warnings: StatusWarning[];
  errors: AppErrorCode[];
};

export type MotionStatusPayload = {
  activeMode: InputMode;
  generatedAtMs: number;
  globalInvalidPacketCount: number;
  sourceStatuses: Record<MotionSource, SourceStatusSnapshot>;
  activeWarnings: StatusWarning[];
  activeErrors: AppErrorCode[];
};

export type PhaseName = "Ready" | "VerticalCharge" | "ForwardCharge" | "HakkeiReady";

export type MotionDiagnosticsPayload = {
  activeMode: InputMode;
  source: MotionSource | null;
  sessionId: string | null;
  generatedAtMs: number;
  windows: {
    motionHzWindowMs: number;
    jitterWindowMs: number;
    hakkeiStaticWindowMs: number;
  };
  rawJitterRms2s: number | null;
  rawMaxJitter2s: number | null;
  rawDrift2s: number | null;
  filteredJitterRms2s: number | null;
  filteredMaxJitter2s: number | null;
  filteredDrift2s: number | null;
  validSampleRatio: number | null;
  validSampleRatioByPhase: Partial<Record<PhaseName, number>>;
};

// --- Calibration（SPEC.md 12章, M8） ------------------------------------

export type CalibrationResult = {
  calibrationId: string;
  source: MotionSource;
  sessionId: string;
  completedAtMs: number;
  neutralHandPositionRaw: Vec3;
  leftNeutralHandPosition: Vec3 | null;
  forwardVector: Vec3;
  upVector: Vec3;
  quality: {
    neutralSampleCount: number;
    forwardSampleCount: number;
    filteredJitterRms2s: number;
    motionHz: number;
  };
};

// --- IPC payloads（M2サブセット） ---------------------------------------

export type InputModeChangeRequest = {
  mode: InputMode;
  reason: "user" | "fallback" | "test" | "mode-change" | "manual-reset";
};

// KeyH は単手モデルの dev ショートカット（利き手 左右トグル・§0.23.9）。leftChargeKey とは別。
export type KeyboardKey = "Space" | "KeyA" | "KeyD" | "KeyL" | "KeyH" | "Enter" | "KeyR" | "Escape";

export type KeyboardControlPayload =
  | { type: "key"; key: KeyboardKey; pressed: boolean; repeat: boolean; occurredAtMs: number }
  | { type: "command"; command: "reset-pressed-state"; occurredAtMs: number };

export type ResetPlayRequest = {
  reason: "replay" | "manual-reset" | "error-recovery";
  source?: MotionSource;
  sessionId?: string | null;
};

export type ResetFilterRequest = {
  source: MotionSource;
  sessionId: string | null;
  reason: "calibration-start" | "session-change" | "manual-reset";
};

export type SettingsConfigPayload = {
  app: unknown;
  input: unknown;
  score: unknown;
};

export type SettingsSaveScoreRequest = {
  app?: unknown;
  input?: unknown;
  score: unknown;
};

export type PublicPlayerSuggestion = {
  nickname: string;
  playerNumber: number;
  registeredAtMs: number;
  lastPlayedAtMs: number | null;
  highScore: number;
  playCount: number;
};

export type PublicPlayerSuggestionsPayload = {
  players: PublicPlayerSuggestion[];
};

export type PublicRankingPlayer = {
  nickname: string;
  playerNumber: number;
  registeredAtMs: number;
  lastPlayedAtMs: number | null;
  highScore: number;
  highScoreCriticalBonusYen: string;
  playCount: number;
};

export type PublicRankingBoard = {
  schemaVersion: 1;
  players: PublicRankingPlayer[];
  submittedPlayerNumber?: number;
};

export type RemoteSessionActor = "game" | "phone" | "server";

export type RemoteSessionEventType =
  | "session.snapshot"
  | "session.registered"
  | "game.inputCheck"
  | "game.inputDeviceReady"
  | "game.playStarted"
  | "game.inputExit"
  | "game.result"
  | "phone.ready"
  | "phone.cancel"
  | "phone.resultExit"
  | "server.error"
  | "server.hello"
  | "client.ping";

export type RemoteSessionEntry = {
  sessionId: string;
  playerId: string;
  playerName: string;
  registeredAtMs: number;
  playerNumber?: number | null;
  readyAtMs?: number | null;
  cancelAtMs?: number | null;
  inputCheckAtMs?: number | null;
  inputCheckExitAtMs?: number | null;
  inputDeviceReadyAtMs?: number | null;
  playStartedAtMs?: number | null;
  resultAtMs?: number | null;
  resultExitAtMs?: number | null;
  resultDamageYen?: number | null;
  resultDamageYenText?: string | null;
  resultRank?: string | null;
};

export type RemoteSessionEvent = {
  protocolVersion: 1;
  eventId: string;
  type: RemoteSessionEventType;
  sessionId: string;
  sentAtMs: number;
  actor: RemoteSessionActor;
  entry?: RemoteSessionEntry | null;
  playerId?: string;
  playerName?: string;
  damageYen?: number;
  damageYenText?: string;
  rank?: string;
  playStarted?: boolean;
  message?: string;
};

export type RemoteSessionStartRequest = {
  sessionId: string;
};

export type RemoteSessionSendRequest = {
  event: Omit<RemoteSessionEvent, "protocolVersion" | "eventId" | "sentAtMs" | "actor"> & {
    eventId?: string;
    actor?: RemoteSessionActor;
    sentAtMs?: number;
  };
};

export type RemoteHttpRequest =
  | { method: "GET"; path: "/api/ranking-board" | "/api/player-suggestions" }
  | {
      method: "GET";
      path: "/api/session-entry";
      query: { sessionId: string };
    }
  | {
      method: "POST";
      path: "/api/session-input-check";
      query: { sessionId: string; ready?: boolean };
    }
  | {
      method: "POST";
      path: "/api/session-input-exit";
      query: { sessionId: string; play?: boolean };
    }
  | { method: "POST"; path: "/api/session-result" | "/api/ranking-score"; body: unknown };

export type RemoteHttpResponse = {
  status: number;
  ok: boolean;
  body: unknown;
};

export type RemoteSessionStatusPayload = {
  state: "disabled" | "connecting" | "open" | "closed" | "fallback";
  sessionId: string | null;
  retryCount: number;
  lastError: string | null;
  occurredAtMs: number;
};

export type SessionChangedPayload = {
  source: MotionSource | "mocopi-ble";
  previousSessionId: string | null;
  nextSessionId: string | null;
  reason:
    | "app-start"
    | "source-start"
    | "keyboard-start"
    | "mock-start"
    | "session-id-changed"
    | "mode-change"
    | "manual-reset"
    | "reset-play";
  occurredAtMs: number;
};

// 実機実験用の状態遷移ログ（Renderer → Main → logs/state-*.log 追記）。
// 凍結バグの再現時に「どの状態で・どの動画イベントまで進んで・最後に何が起きたか」を
// DevTools なしで回収するための診断チャネル。ゲームロジックには影響しない。
export type DebugLogRequest = {
  line: string; // 1 行分（renderer 側で整形済み）
};

export type IpcSuccess<T = void> = [T] extends [void] ? { ok: true } : { ok: true; value: T };
export type IpcFailure = {
  ok: false;
  code: AppErrorCode | "MODE_UNAVAILABLE" | "INVALID_REQUEST";
  messageJa: string;
};
export type IpcResult<T = void> = IpcSuccess<T> | IpcFailure;

export type Unsubscribe = () => void;

// IPC チャネル名（Main→Renderer は domain:event、Renderer→Main は domain:action）。
export const IPC = {
  // Renderer -> Main (command/request)
  getConfig: "config:get",
  setInputMode: "input:set-mode",
  keyboardControl: "keyboard:control",
  resetPlay: "app:reset-play",
  resetFilter: "input:reset-filter",
  bleSidecarControl: "ble:sidecar-control", // Renderer -> Main（V5）
  settingsGetConfig: "settings:config:get",
  settingsSaveScore: "settings:score:save",
  remoteSessionStart: "remote-session:start",
  remoteSessionSend: "remote-session:send",
  remoteSessionStop: "remote-session:stop",
  remoteHttpRequest: "remote-http:request",
  quitApp: "app:quit", // Renderer -> Main（Title の QUIT GAME）
  debugLog: "app:debug-log", // Renderer -> Main（状態遷移ログの追記・診断用）
  // Main -> Renderer (event)
  motionSample: "motion:sample",
  punchInput: "motion:punch-input", // 入力非依存 punch core 用（V2c）。Main が生成。
  bleSidecarStatus: "ble:sidecar-status", // BLE sidecar/replay の状態（V5）
  motionHeartbeat: "motion:heartbeat",
  motionStatus: "motion:status",
  motionDiagnostics: "motion:diagnostics",
  motionSessionChanged: "motion:session-changed",
  appError: "app:error",
  appErrorClear: "app:error-clear",
  remoteSessionEvent: "remote-session:event",
  remoteSessionStatus: "remote-session:status",
} as const;

// preload が公開する API の形（SPEC.md 9.4 の M2サブセット）。
export type HakkeiPreloadApi = {
  appName: string;
  versions: { electron: string; chrome: string; node: string };
  getConfig(): Promise<IpcResult<AppConfigBundle>>;
  setInputMode(request: InputModeChangeRequest): Promise<IpcResult<{ activeMode: InputMode }>>;
  sendKeyboardControl(payload: KeyboardControlPayload): Promise<IpcResult>;
  resetPlay(request: ResetPlayRequest): Promise<IpcResult>;
  resetFilter(request: ResetFilterRequest): Promise<IpcResult>;
  controlBleSidecar(payload: BleSidecarControlPayload): Promise<IpcResult>;
  settingsGetConfig(): Promise<IpcResult<SettingsConfigPayload>>;
  settingsSaveScore(request: SettingsSaveScoreRequest): Promise<IpcResult>;
  remoteSessionStart(request: RemoteSessionStartRequest): Promise<IpcResult>;
  remoteSessionSend(request: RemoteSessionSendRequest): Promise<IpcResult>;
  remoteSessionStop(): Promise<IpcResult>;
  remoteHttpRequest(request: RemoteHttpRequest): Promise<IpcResult<RemoteHttpResponse>>;
  quitApp(): Promise<IpcResult>;
  debugLog(request: DebugLogRequest): Promise<IpcResult>;
  onMotionSample(handler: (payload: MotionSample) => void): Unsubscribe;
  onPunchInput(handler: (payload: PunchInputSample) => void): Unsubscribe;
  onBleSidecarStatus(handler: (payload: BleSidecarStatusPayload) => void): Unsubscribe;
  onMotionHeartbeat(handler: (payload: MotionHeartbeatPayload) => void): Unsubscribe;
  onMotionStatus(handler: (payload: MotionStatusPayload) => void): Unsubscribe;
  onMotionDiagnostics(handler: (payload: MotionDiagnosticsPayload) => void): Unsubscribe;
  onMotionSessionChanged(handler: (payload: SessionChangedPayload) => void): Unsubscribe;
  onAppError(handler: (payload: AppErrorPayload) => void): Unsubscribe;
  onAppErrorClear(handler: (payload: AppErrorClearPayload) => void): Unsubscribe;
  onRemoteSessionEvent(handler: (payload: RemoteSessionEvent) => void): Unsubscribe;
  onRemoteSessionStatus(handler: (payload: RemoteSessionStatusPayload) => void): Unsubscribe;
};
