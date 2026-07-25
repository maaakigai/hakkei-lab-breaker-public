// src/renderer/app.ts
//
// Renderer の状態機械コントローラ（SPEC v2・magnitude-only MVP）。
// 入力は Main 生成の PunchInputSample（onPunchInput）で進める。利き手1個でチャージ→構え→
// パンチ強さ（intensity ピーク）が閾値超で発火→威力 Lv 動画→Result。方向/Calibration軸/
// 利き手決定/隠しイベントは廃止（旧 dev/calibration/direction は復活させない）。
//
// 不変ルール: score/charge は Main 生成 PunchInputSample を消費するだけ（Renderer 再計算しない）。
// keyboard fallback は debug 用に維持。onMotionSample は diagnostics 表示のみ（game loop には使わない）。

import { INITIAL_STATE, transition, type AppEvent, type AppState } from "./stateMachine.ts";
import QRCode from "qrcode";
import { installKeyboardInput, type ForcedHakkeiMode, type KeyboardInputHandle } from "./keyboardInput.ts";
import { accumulatePunchCharge, buildPunchScoreBreakdown, PunchDetector } from "./punchCore.ts";
import { diagnosticsHtml, statusPanelHtml } from "./diagnosticPanel.ts";
import { criticalRateForPower, selectRank, videoFileForLevel, videoFilesForLevel } from "./scoreCalculator.ts";
import { damageYenFromPower } from "./damageEstimate.ts";
import { resultHtml } from "./resultPresenter.ts";
import { formatBigIntYen } from "./yenFormatter.ts";
import {
  DEFAULT_NICKNAME,
  loadRankingBoard,
  getOrCreatePlayerProfile,
  getOrCreateRemotePlayerProfile,
  findPlayerByNickname,
  importPublicPlayerSuggestions,
  importServerRankingPlayers,
  rankingRows,
  recordScoreForPlayer,
  recordScoreForDefaultPlayer,
  registeredNicknameSuggestions,
  relativeTimeAgo,
  validateNickname,
  type PlayerProfile,
  type RankingBoardData,
  type SavedScoreResult,
} from "./rankingStore.ts";
import {
  rankingPlayerFor,
  rankingPositionFor,
} from "./resultRankingSync.ts";
import { playVideo, preloadVideo, type PreparedVideo, type VideoHandle } from "./videoManager.ts";
import { createBgm, playOneShotAudio, type BgmHandle } from "./audioManager.ts";
import {
  createResultSfxSchedule,
  isResultSfxManifest,
  resultSfxNormalCountForRank,
  type ResultSfxManifest,
} from "./resultSfxScheduler.ts";
import type { AppConfigBundle, CriticalOutcomeConfig } from "../shared/configTypes.ts";
import type { PunchInputSample } from "../shared/punchInput.ts";
import type {
  BleSidecarStatusPayload,
  HakkeiPreloadApi,
  InputMode,
  MotionDiagnosticsPayload,
  MotionHeartbeatPayload,
  MotionSample,
  MotionStatusPayload,
  PublicPlayerSuggestionsPayload,
  PublicRankingBoard,
  RemoteHttpRequest,
  RemoteHttpResponse,
  RemoteSessionEvent,
  RemoteSessionEntry,
  RemoteSessionStatusPayload,
  Rank,
  ScoreBreakdown,
  VideoLevel,
} from "../shared/types.ts";

const api = (window as unknown as { hakkei: HakkeiPreloadApi }).hakkei;

// --- 実機実験用 状態遷移ログ ---------------------------------------------
// 凍結バグ調査のため、状態遷移・動画ライフサイクル・スコア確定を Main 経由で
// logs/state-YYYYMMDD.log に追記する（凍結後も DevTools なしで回収できる）。
// ログ失敗でゲームを止めない。50Hz の入力サンプルは記録しない（量が多すぎるため）。
const stateLogT0 = performance.now();
function stateLog(tag: string, detail: string): void {
  try {
    const t = Math.round(performance.now() - stateLogT0);
    const line = `${new Date().toISOString()} +${t}ms [${tag}] ${detail}`;
    console.log(`[stateLog] [${tag}] ${detail}`);
    void api.debugLog({ line });
  } catch {
    // 診断用なので失敗は無視。
  }
}

function shortSessionId(sessionId: string | null): string {
  return sessionId ? "active-session" : "none";
}

function currentRemotePlayerId(): string | null {
  const playerId = store.currentPlayer?.playerId ?? null;
  return playerId?.startsWith("remote-") ? playerId.slice("remote-".length) : null;
}

function remoteEntryMatchesCurrentPlayer(entry: RemoteSessionEntry): boolean {
  const expectedPlayerId = currentRemotePlayerId();
  return expectedPlayerId === null || entry.playerId === expectedPlayerId;
}

// 現在ページ上の video 要素の再生状態スナップショット（凍結時の切り分け用）。
// includePreload=false なら preload キャッシュ内（未再生）の要素は省く（毎秒ログの肥大防止）。
// readyState: 0=NOTHING 1=METADATA 2=CURRENT 3=FUTURE 4=ENOUGH / networkState: 2=LOADING 3=NO_SOURCE
function videoElementsSnapshot(includePreload = true): string {
  try {
    const all = [...document.querySelectorAll("video")].filter(
      (v) => includePreload || v.parentElement?.id !== "video-preload-cache",
    );
    const items = all.map((v) => ({
      src: (v.getAttribute("src") ?? "").split("/").slice(-2).join("/"),
      cls: v.className,
      rs: v.readyState,
      ns: v.networkState,
      t: Math.round(v.currentTime * 100) / 100,
      paused: v.paused,
      ended: v.ended,
      err: v.error ? v.error.code : null,
      parent: v.parentElement ? (v.parentElement.id || v.parentElement.className || v.parentElement.tagName) : "DETACHED",
    }));
    return JSON.stringify(items);
  } catch (e) {
    return `snapshot failed: ${String(e)}`;
  }
}

let bundle: AppConfigBundle | null = null;

function cfg(): AppConfigBundle {
  if (!bundle) {
    throw new Error("config not loaded");
  }
  return bundle;
}

function isDebugMode(): boolean {
  return cfg().runtime.uiMode === "debug";
}

type RendererInputMode = InputMode;
type TitlePanel = "menu" | "ranking" | "register";
type RegisterPollStatus = "idle" | "waiting" | "registered" | "error";

type NavigationSnapshot = {
  state: AppState;
  titlePanel: TitlePanel;
  settingsOpen: boolean;
  titleMenuIndex: number;
  label: string;
};

interface Store {
  state: AppState;
  inputMode: RendererInputMode;
  lastError: string | null;
  lastSample: MotionSample | null; // diagnostics 表示用のみ
  lastStatus: MotionStatusPayload | null;
  lastHeartbeat: MotionHeartbeatPayload | null;
  lastDiagnostics: MotionDiagnosticsPayload | null;
  // magnitude-only play 状態
  chargeRaw: number; // Charge 中に積算したタメ量
  strengthPeak: number; // 直近 HakkeiReady の intensity ピーク（診断用）
  participantAssistMode: boolean; // Shift でそのセッションだけ表示100%基準を下げる
  breakdown: ScoreBreakdown | null;
  punchTimedOut: boolean;
  criticalActive: boolean;
  selectedCriticalOutcome: CriticalOutcomeConfig | null;
  forcedHakkeiMode: ForcedHakkeiMode;
  devOpen: boolean;
  settingsOpen: boolean;
  titlePanel: TitlePanel;
  navigationHistory: NavigationSnapshot[];
  registerNickname: string;
  registerError: string | null;
  registerDuplicate: PlayerProfile | null; // 同名既存プレイヤー確認中（「あなたですか？」）
  registerSuggestionsDismissed: boolean;
  registerSessionId: string | null;
  registerPollStatus: RegisterPollStatus;
  registerPollMessage: string;
  registerReadyAtMs: number | null;
  registerInputCheckNotifiedSessionId: string | null;
  registerInputDeviceReadyNotifiedSessionId: string | null;
  registerResultNotifiedSessionId: string | null;
  registerResultExitHandledAtMs: number | null;
  registerCancelHandledAtMs: number | null;
  inputCheckBleReadySeen: boolean;
  currentPlayer: PlayerProfile | null;
  serverRankingBoard: RankingBoardData | null;
  serverRankingStatus: "idle" | "loading" | "ready" | "error";
  serverRankingMessage: string;
  titleMenuIndex: number; // Title menu selection index.
  resultMenuIndex: number; // Result menu selection index（0=Return to Title）。
  forcedDebugLevel: VideoLevel | null; // dev: 通常フローを通したうえで最終Lvだけ固定する
  forcedVideoFile: string | null; // dev: VIDEO_MISSING 確認用
  playbackQueue: string[];
  currentPlaybackFile: string | null;
}

// Result画面のシネマティックメニュー（十字キー/Enterで操作）。EXIT（タイトルへ戻る）1択。
const RESULT_MENU: Array<{ event: AppEvent; label: string }> = [
  { event: "finish", label: "EXIT" },
];
const RESULT_MENU_DEFAULT_INDEX = 0;

const store: Store = {
  state: INITIAL_STATE,
  inputMode: "mocopi-ble",
  lastError: null,
  lastSample: null,
  lastStatus: null,
  lastHeartbeat: null,
  lastDiagnostics: null,
  chargeRaw: 0,
  strengthPeak: 0,
  participantAssistMode: false,
  breakdown: null,
  punchTimedOut: false,
  criticalActive: false,
  selectedCriticalOutcome: null,
  forcedHakkeiMode: "none",
  devOpen: false,
  settingsOpen: false,
  titlePanel: "menu",
  navigationHistory: [],
  registerNickname: "",
  registerError: null,
  registerDuplicate: null,
  registerSuggestionsDismissed: false,
  registerSessionId: null,
  registerPollStatus: "idle",
  registerPollMessage: "Scan the QR code with your phone.",
  registerReadyAtMs: null,
  registerInputCheckNotifiedSessionId: null,
  registerInputDeviceReadyNotifiedSessionId: null,
  registerResultNotifiedSessionId: null,
  registerResultExitHandledAtMs: null,
  registerCancelHandledAtMs: null,
  inputCheckBleReadySeen: false,
  currentPlayer: null, // register(QR/手入力)で毎回セット。復元はスマホ license(playerId)側で行う。
  serverRankingBoard: null,
  serverRankingStatus: "idle",
  serverRankingMessage: "",

  titleMenuIndex: 0,
  resultMenuIndex: RESULT_MENU_DEFAULT_INDEX,
  forcedDebugLevel: null,
  forcedVideoFile: null,
  playbackQueue: [],
  currentPlaybackFile: null,
};

// 直近に render した状態。Result への入場検出（初期カーソル reset）に使う。
let lastRenderedState: AppState | null = null;
// HakkeiReady のパンチ検出器（intensity ピークが閾値超で発火）。構え（prep）終了で arm（生成）。
let detector: PunchDetector | null = null;
// 構え（心の準備）フェーズ。HakkeiReady 入場後 hakkeiPrepMs の間は検出せず構えカウントダウンを出す。
let hakkeiArmed = false;
// 構え入場時にチャージが100%以上だったか。構え/パンチの切替効果音の出し分けに使う。
let hakkeiWasOvercharged = false;
let hakkeiPrepStartMs = 0; // 構え開始時刻（performance.now）。残り秒の表示に使う。
let hakkeiWindowStartMs = 0; // 発勁受付開始時刻（performance.now）。残り秒の表示に使う。
// BLE/punch 入力の受信トラッキング（InputCheck の BLE 受信状態表示用・diagnostics）。
let lastPunchInput: PunchInputSample | null = null;
let punchRecvTimes: number[] = []; // 直近 1s の受信時刻（performance.now）。Hz 算出。
let bleSidecarStatus: BleSidecarStatusPayload | null = null; // Main の sidecar/replay 状態（V5）。

// 計測モード（角速度の実測・計算式設計用）。
// 開始〜終了を1本の連続ストリーム（50Hz）として記録し、ラベル押下は時刻付きマーカーで残す。
// 瞬間値ではなく波形（立ち上がり→ピーク→減衰）を解析できるようにするのが目的。
let measuring = false;
let measureLabel = "rest"; // 現在ラベル。"rest"=静止/区切り。押下のたび marker を打つ。
let measureSession = "(未設定)"; // セッション種別（still/punch-burst/charge-hold/charge-punch-set/slow）。
let measureT0: number | null = null; // 最初のサンプル timestamp（相対時刻の原点）。
// 連続ストリームの1サンプル。t は計測開始からの相対 ms。
type MeasureSample = {
  t: number;
  dt: number;
  idleMs: number;
  intensity: number;
  chargeDelta: number;
  motionAmount: number;
  label: string;
};
type MeasureMark = { t: number; label: string }; // ラベル押下イベント（区間境界）。
const measureBuf: MeasureSample[] = [];
const measureMarks: MeasureMark[] = [];

// --- 実験ウィザード（ゲーム的キャリブレーション）。手順を自動進行し最後に自動保存。 ---
type WizStage = "intro" | "still" | "punch" | "charge" | "chargePunch" | "slow" | "done";
const WIZ_STILL_MS = 5000; // 静止キープ秒
const WIZ_MOVE_THRESH = 50; // この角速度(deg/s)を超えたら「動いた」＝静止リセット
const WIZ_PUNCH_N = 20; // 本気パンチ目標発数
const WIZ_PUNCH_HI = 400; // パンチ立ち上がり閾値（deg/s）
const WIZ_PUNCH_LO = 150; // パンチ終了閾値
const WIZ_CHARGE_REPS = 3; // チャージ反復回数
const WIZ_CHARGE_REP_MS = 5000; // 1反復の振り続け秒
const WIZ_SETS_N = 8; // タメ→パンチのセット数
const WIZ_SLOW_N = 5; // ゆっくり一発の本数
const WIZ_SLOW_HI = 150; // ゆっくり用の低い閾値
const WIZ_SLOW_LO = 60;
let wizActive = false;
let wizStage: WizStage = "intro";
let wizStillStartMs: number | null = null; // 静止開始時刻（performance.now）
let wizStillBuf: number[] = []; // 静止中の角速度
let wizInPunch = false;
let wizPeak = 0;
let wizPunchPeaks: number[] = [];
let wizRep = 0;
let wizRepStartMs: number | null = null;
let wizRepCharge = 0;
let wizChargeReps: number[] = [];
let wizSetCharge = 0;
let wizSets: { charge: number; peak: number }[] = [];
let wizSlowPeaks: number[] = [];
let wizFlashMs = 0; // 直近検出時刻（フラッシュ演出）
let wizStill: { n: number; p95: number; p99: number; max: number } | null = null;
let wizResult: Record<string, unknown> | null = null;

function downloadJson(filename: string, obj: unknown): void {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SAFETY_LINES = [
  "⚠ Check your surroundings before you begin.",
  "Keep about 1 m of clear space around you.",
  "Never let your strike hit people or objects.",
];
const OVERCHARGE_CRACK_SOUNDS = [
  "SFX/placeholder-crack-01.wav",
  "SFX/placeholder-crack-02.wav",
] as const;
const CRITICAL_WIPE_COVER_MS = 260;
const CRITICAL_WIPE_REVEAL_MS = 360;
const CRITICAL_WIPE_END_MS = 720;
// VideoPlayback の保険タイマー。Critical の2本連続再生も含め、止まった場合にタイトルへ復帰する。
const VIDEO_WATCHDOG_MS = 30000;
function remoteHttpBaseUrl(): string {
  return cfg().app.remoteSession.httpBaseUrl.replace(/\/+$/, "");
}

function isLocalMode(): boolean {
  return cfg().runtime.localMode;
}

function isDemoQrMode(): boolean {
  return cfg().runtime.demoQr;
}

function isRemoteMode(): boolean {
  return !isLocalMode() && !isDemoQrMode() && cfg().app.remoteSession.enabled;
}

function rankingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  return localStorage;
}

async function requestRemoteApi(request: RemoteHttpRequest): Promise<RemoteHttpResponse> {
  const result = await api.remoteHttpRequest(request);
  if (!result.ok) {
    throw new Error(result.messageJa);
  }
  return result.value;
}
const REMOTE_NICKNAME_PATTERN = /^[A-Z0-9._ -]{1,16}$/;

let activeTimer: ReturnType<typeof setTimeout> | null = null;
let activeInterval: ReturnType<typeof setInterval> | null = null;
// 構え/パンチ切替の効果音を「切替の少し前」に鳴らす前倒しタイマー。
let phaseCueTimer: ReturnType<typeof setTimeout> | null = null;
let stanceCuePlayed = false;
let punchCuePlayed = false;
// VideoPlayback で動画が再生も終了も欠落もせず固まった場合の保険（→タイトル復帰）。
let videoWatchdog: ReturnType<typeof setTimeout> | null = null;
// VideoPlayback 中に毎秒 video の進行状況を状態遷移ログへ記録する（凍結解析用・診断のみ）。
let videoProgressInterval: ReturnType<typeof setInterval> | null = null;
let videoHandle: VideoHandle | null = null;
let mainBgmHandle: BgmHandle | null = null;
let criticalBgmHandle: BgmHandle | null = null;
let chargeSoundHandle: BgmHandle | null = null;
let chargeSoundMode: "normal" | "over" | null = null;
let activeBgm: "main" | "critical" | null = null;
const preparedVideos = new Map<string, PreparedVideo>();
let resultVideoElement: HTMLVideoElement | null = null;
let keyboard: KeyboardInputHandle | null = null;
let resultDamageAnimation: number | null = null;
let resultSfxManifest: ResultSfxManifest | null = null;
let resultSfxManifestLoading: Promise<ResultSfxManifest | null> | null = null;
let resultSfxTimers: Array<ReturnType<typeof setTimeout>> = [];
let criticalResultSfxStarted = false;
let lastOverchargeCrackCount = 0;
let criticalTransitionRunning = false;
let criticalTransitionTimers: Array<ReturnType<typeof setTimeout>> = [];
let lastSavedBreakdown: ScoreBreakdown | null = null;
let latestSavedScore: SavedScoreResult | null = null;
let lastPostedScore: SavedScoreResult | null = null;
let resultScorePostInFlight: Promise<boolean> | null = null;
let resultRankingBeforeBoard: RankingBoardData | null = null;
let resultRankingBeforeScore: SavedScoreResult | null = null;
let lastPhoneNotifiedScore: SavedScoreResult | null = null;
let registerPollTimer: ReturnType<typeof setInterval> | null = null;
let registerPollInFlight = false;
let lastRenderedQrUrl: string | null = null;
let lastRenderedQrCanvas: HTMLCanvasElement | null = null;
let autoAdvancedRegisterSessionId: string | null = null;
let phoneInputDeviceVerifyUntilMs = 0;
let phoneInputDeviceNotifyEpoch = 0;
const PHONE_INPUT_DEVICE_VERIFY_MS = 900;
const REGISTER_POLL_INTERVAL_MS = 500;
let registeredUsersSyncInFlight = false;
let lastRegisteredUsersSyncAtMs = 0;
const REGISTERED_USERS_SYNC_INTERVAL_MS = 30_000;

function clearTimers(): void {
  if (activeTimer !== null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (phaseCueTimer !== null) {
    clearTimeout(phaseCueTimer);
    phaseCueTimer = null;
  }
  if (activeInterval !== null) {
    clearInterval(activeInterval);
    activeInterval = null;
  }
  if (videoWatchdog !== null) {
    clearTimeout(videoWatchdog);
    videoWatchdog = null;
  }
  if (videoProgressInterval !== null) {
    clearInterval(videoProgressInterval);
    videoProgressInterval = null;
  }
  for (const timer of criticalTransitionTimers) {
    clearTimeout(timer);
  }
  criticalTransitionTimers = [];
  criticalTransitionRunning = false;
  document.querySelectorAll(".critical-transition-wipe").forEach((el) => el.remove());
  if (videoHandle !== null) {
    videoHandle.stop();
    videoHandle = null;
  }
  if (resultDamageAnimation !== null) {
    cancelAnimationFrame(resultDamageAnimation);
    resultDamageAnimation = null;
  }
}

function clearResultSfxTimers(): void {
  for (const timer of resultSfxTimers) {
    clearTimeout(timer);
  }
  resultSfxTimers = [];
}

function stopRegisterPolling(): void {
  if (registerPollTimer !== null) {
    clearInterval(registerPollTimer);
    registerPollTimer = null;
  }
}

function resetPlayState(): void {
  stopChargeSound();
  clearResultSfxTimers();
  clearResultVideo();
  removeCurrentPhaseCueImage();
  store.chargeRaw = 0;
  store.strengthPeak = 0;
  store.breakdown = null;
  store.punchTimedOut = false;
  store.criticalActive = false;
  store.selectedCriticalOutcome = null;
  store.forcedVideoFile = null;
  store.forcedDebugLevel = null;
  store.playbackQueue = [];
  store.currentPlaybackFile = null;
  lastSavedBreakdown = null;
  latestSavedScore = null;
  lastPostedScore = null;
  resultScorePostInFlight = null;
  resultRankingBeforeBoard = null;
  resultRankingBeforeScore = null;
  lastPhoneNotifiedScore = null;
  lastOverchargeCrackCount = 0;
  criticalResultSfxStarted = false;
  resetHakkeiPrepState();
  void api.resetPlay({ reason: "manual-reset" });
}

function resetHakkeiPrepState(): void {
  detector = null;
  hakkeiArmed = false;
  hakkeiPrepStartMs = performance.now();
  hakkeiWindowStartMs = 0;
  store.strengthPeak = 0;
}

// active input mode に応じた punch intensity 閾値（案1・source 別）。
function currentIntensityThreshold(): number {
  const p = cfg().score.punch;
  return store.inputMode === "keyboard" ? p.intensityThresholdKeyboard : p.intensityThresholdBle;
}

// 表示100%基準（source 別）。UI% と スコア曲線(割合 f=chargeRaw/これ) の両方がこの基準を使う。
function currentChargeReady(): number {
  const p = cfg().score.punch;
  if (store.inputMode === "keyboard") {
    return p.chargeReadyThresholdKeyboard;
  }
  return store.participantAssistMode
    ? p.participantAssistChargeReadyThreshold
    : p.chargeReadyThreshold;
}

function resetParticipantAssistMode(reason: string): void {
  if (!store.participantAssistMode) {
    return;
  }
  store.participantAssistMode = false;
  stateLog("PARTICIPANT_ASSIST", `off (${reason})`);
  updateGameModeIndicators();
}

// パンチ発火 / タイムアウトで ScoreBreakdown を確定する（punchCore 純計算）。
function finalizeScore(detected: boolean, timedOut: boolean, strengthRaw: number): void {
  store.punchTimedOut = timedOut;
  store.strengthPeak = strengthRaw;
  store.criticalActive = false;
  store.selectedCriticalOutcome = null;
  store.breakdown = buildPunchScoreBreakdown(
    {
      chargeRaw: store.chargeRaw,
      punchStrengthRaw: strengthRaw,
      punchDetected: detected,
      punchTimedOut: timedOut,
    },
    cfg().score,
    currentChargeReady(), // source 別 表示100%基準（スコア曲線の割合 f の分母）
  );
  if (isDebugMode() && store.forcedDebugLevel !== null) {
    store.breakdown = makeLevelFixture(store.forcedDebugLevel);
  }
  if (detected && !timedOut && applyForcedHakkeiModeToScore()) {
    stateLog("SCORE", `finalize(forced): ${breakdownSummary()}`);
    return;
  }
  maybeApplyCritical();
  stateLog(
    "SCORE",
    `finalize: detected=${detected} timedOut=${timedOut} strength=${Math.round(strengthRaw)} charge=${Math.round(store.chargeRaw)} ${breakdownSummary()}`,
  );
}

// 状態遷移ログ用のスコア要約（診断専用・表示には使わない）。
function breakdownSummary(): string {
  const b = store.breakdown;
  if (!b) {
    return "breakdown=null";
  }
  const critical = store.criticalActive ? (store.selectedCriticalOutcome?.id ?? "on") : "no";
  return `power=${Math.round(b.power)} rank=${b.rank} lv=${b.videoLevel} damage=${b.damageYenText ?? b.damageYen} critical=${critical}`;
}

function applyForcedHakkeiModeToScore(): boolean {
  if (store.forcedHakkeiMode === "none") {
    return false;
  }
  store.punchTimedOut = false;
  store.strengthPeak = Math.max(store.strengthPeak, cfg().score.punch.punchMax);
  store.criticalActive = true;
  store.selectedCriticalOutcome = selectCriticalOutcome();
  store.breakdown = makeCriticalFixture();
  return true;
}

function forceCriticalHakkei(): boolean {
  if (store.state !== "HakkeiReady" || !hakkeiArmed || store.breakdown !== null) {
    return false;
  }
  store.punchTimedOut = false;
  store.strengthPeak = Math.max(store.strengthPeak, cfg().score.punch.punchMax);
  store.criticalActive = true;
  store.selectedCriticalOutcome = selectCriticalOutcome();
  store.breakdown = makeCriticalFixture();
  stateLog("SCORE", `force-critical: ${breakdownSummary()}`);
  dispatch("hakkeiDetected");
  return true;
}

function forceCurrentModeHakkei(): boolean {
  return store.forcedHakkeiMode === "critical" && forceCriticalHakkei();
}

// 構え終了 → パンチ検出を arm する。timeout を開始し、UI を「撃て！」へ。
// 注: render() は呼ばない（HakkeiReady の timer を再入させループするため）。#diag のみ更新。
function armHakkei(): void {
  const t = cfg().app.timers;
  const start = currentIntensityThreshold();
  detector = new PunchDetector(start, start * cfg().score.punch.punchReleaseRatio);
  hakkeiArmed = true;
  hakkeiWindowStartMs = performance.now();
  // 通常は prep 中の前倒しタイマーで既に鳴っている。未再生なら（leadSec=0 等）ここで鳴らす。
  playPunchCueNow();
  updateHakkeiPrompt();
  updateCountdownText("hakkei-timer", t.hakkeiReadyTimeoutMs, hakkeiWindowStartMs);
  activeTimer = setTimeout(handleTimeout, t.hakkeiReadyTimeoutMs);
  activeInterval = setInterval(() => {
    updateCountdownText("hakkei-timer", t.hakkeiReadyTimeoutMs, hakkeiWindowStartMs);
    updateDiagnostics();
  }, 100);
  updateDiagnostics();
}

function handleTimeout(): void {
  // window 中に start を超えるスパイクがあれば（パンチしたが減衰待ちで時間切れ）、その真のピークで発火扱い。
  const peak = detector ? detector.currentPeak() : store.strengthPeak;
  if (detector && peak >= currentIntensityThreshold()) {
    finalizeScore(true, false, peak);
    dispatch("hakkeiDetected");
    return;
  }
  // それ以外＝何も撃たなかった no-impact（Lv0）。
  finalizeScore(false, true, store.strengthPeak);
  dispatch("hakkeiTimeout");
}

function currentViewLabel(): string {
  if (store.state === "Title") {
    if (store.settingsOpen) {
      return "INPUT SETTINGS";
    }
    if (store.titlePanel === "register") {
      return "REGISTRATION";
    }
    if (store.titlePanel === "ranking") {
      return "LEADERBOARD";
    }
    return "TITLE";
  }
  if (store.state === "InputCheck") {
    return "INPUT CHECK";
  }
  return store.state;
}

function currentNavigationSnapshot(): NavigationSnapshot {
  return {
    state: store.state,
    titlePanel: store.titlePanel,
    settingsOpen: store.settingsOpen,
    titleMenuIndex: store.titleMenuIndex,
    label: currentViewLabel(),
  };
}

function isSameNavigationView(a: NavigationSnapshot, b: NavigationSnapshot): boolean {
  return (
    a.state === b.state &&
    a.titlePanel === b.titlePanel &&
    a.settingsOpen === b.settingsOpen &&
    a.titleMenuIndex === b.titleMenuIndex
  );
}

function pushNavigationHistory(): void {
  const next = currentNavigationSnapshot();
  const last = store.navigationHistory[store.navigationHistory.length - 1];
  if (last && isSameNavigationView(last, next)) {
    return;
  }
  store.navigationHistory.push(next);
  if (store.navigationHistory.length > 12) {
    store.navigationHistory.shift();
  }
}

function pushRegisterBackTarget(): void {
  const target: NavigationSnapshot = {
    state: "Title",
    titlePanel: "register",
    settingsOpen: false,
    titleMenuIndex: store.titleMenuIndex,
    label: "REGISTRATION",
  };
  const last = store.navigationHistory[store.navigationHistory.length - 1];
  if (!last || !isSameNavigationView(last, target)) {
    store.navigationHistory.push(target);
  }
}

function resetRegisterPanelState(): void {
  stopRegisterPolling();
  store.registerNickname = "";
  store.registerError = null;
  store.registerDuplicate = null;
  store.registerSuggestionsDismissed = false;
  store.registerSessionId = createRegisterSessionId();
  store.registerPollStatus = "waiting";
  store.registerPollMessage = isDemoQrMode()
    ? "Recording mode: this QR is intentionally inactive. Enter your name with the keyboard."
    : isRemoteMode()
      ? "Scan the QR code with your phone."
      : "QR registration is disabled. Enter your name with the keyboard.";
  store.registerReadyAtMs = null;
  store.registerInputCheckNotifiedSessionId = null;
  store.registerInputDeviceReadyNotifiedSessionId = null;
  store.registerResultNotifiedSessionId = null;
  store.registerResultExitHandledAtMs = null;
  store.registerCancelHandledAtMs = null;
  lastRenderedQrUrl = null;
  lastRenderedQrCanvas = null;
  void startRemoteSession(store.registerSessionId);
  void syncRegisteredUsersForSuggestions();
}

async function syncRegisteredUsersForSuggestions(force = false): Promise<void> {
  if (!isRemoteMode()) {
    return;
  }
  const nowMs = Date.now();
  if (
    registeredUsersSyncInFlight ||
    (!force && nowMs - lastRegisteredUsersSyncAtMs < REGISTERED_USERS_SYNC_INTERVAL_MS)
  ) {
    return;
  }
  registeredUsersSyncInFlight = true;
  let importedCount = 0;
  try {
    try {
      const suggestionsResponse = await requestRemoteApi({
        method: "GET",
        path: "/api/player-suggestions",
      });
      if (suggestionsResponse.ok && isPublicPlayerSuggestionsPayload(suggestionsResponse.body)) {
        const suggestionsBoard = importPublicPlayerSuggestions(
          rankingStorage(),
          suggestionsResponse.body.players,
        );
        importedCount = Math.max(importedCount, suggestionsBoard.players.length);
        stateLog(
          "REMOTE",
          `player suggestions sync ok serverPlayers=${suggestionsResponse.body.players.length} localPlayers=${suggestionsBoard.players.length}`,
        );
      } else {
        stateLog(
          "REMOTE",
          `player suggestions sync failed: ${
            suggestionsResponse.ok ? "invalid payload" : suggestionsResponse.status
          }`,
        );
      }
    } catch (error) {
      stateLog(
        "REMOTE",
        `player suggestions sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const rankingResponse = await requestRemoteApi({ method: "GET", path: "/api/ranking-board" });
    if (!rankingResponse.ok) {
      throw new Error(`Ranking server returned ${rankingResponse.status}.`);
    }
    const rankingPayload = publicRankingBoardAsLocal(rankingResponse.body);
    if (rankingPayload === null) {
      throw new Error("Ranking server returned an invalid board.");
    }
    store.serverRankingBoard = rankingPayload;
    store.serverRankingStatus = "ready";
    store.serverRankingMessage = "Server ranking loaded.";
    const board = importServerRankingPlayers(rankingStorage(), rankingPayload);
    importedCount = Math.max(importedCount, board.players.length);
    lastRegisteredUsersSyncAtMs = Date.now();
    stateLog("REMOTE", `ranking users sync ok serverPlayers=${rankingPayload.players.length} localPlayers=${board.players.length}`);
    if (store.state === "Title" && store.titlePanel === "register") {
      render();
    }
  } catch (error) {
    stateLog("REMOTE", `registered users sync failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (importedCount > 0) {
      lastRegisteredUsersSyncAtMs = Date.now();
    }
    registeredUsersSyncInFlight = false;
  }
}

function beginPhoneInputDeviceVerification(): number {
  phoneInputDeviceNotifyEpoch += 1;
  phoneInputDeviceVerifyUntilMs = performance.now() + PHONE_INPUT_DEVICE_VERIFY_MS;
  return phoneInputDeviceNotifyEpoch;
}

function finishPhoneInputDeviceVerification(): void {
  phoneInputDeviceVerifyUntilMs = 0;
}

function clearNavigationHistory(): void {
  store.navigationHistory = [];
}

function backTargetLabel(): string {
  return store.navigationHistory[store.navigationHistory.length - 1]?.label ?? "TITLE";
}

function navigateBack(): boolean {
  const target = store.navigationHistory.pop();
  if (!target) {
    return false;
  }
  stateLog("STATE", `navigateBack: ${store.state} -> ${target.state} (${target.label})`);
  const returningFromPlayState = store.state !== "Title";
  if (store.state === "InputCheck") {
    void notifyPhoneInputCheckExit();
  }
  if (returningFromPlayState) {
    playMainBgm();
    resetPlayState();
  }
  if (returningFromPlayState && target.state === "Title" && target.titlePanel === "register") {
    resetRegisterPanelState();
  }
  store.state = target.state;
  store.titlePanel = target.titlePanel;
  store.settingsOpen = target.settingsOpen;
  store.titleMenuIndex = target.titleMenuIndex;
  store.registerError = null;
  if (target.state === "Title") {
    resetParticipantAssistMode("back-to-title");
    keyboard?.setForcedHakkeiMode("none");
  }
  render();
  return true;
}

function dispatch(event: AppEvent): void {
  if (event === "inputOk" && store.state === "InputCheck" && !inputCheckReady()) {
    stateLog("STATE", "dispatch inputOk: InputCheck -> (blocked: input not ready)");
    updateInputCheckHero();
    return;
  }
  const next = transition(store.state, event);
  if (next === null || next === store.state) {
    // 受理されなかったイベントも記録する（画面と store.state の食い違い検出に有効）。
    stateLog("STATE", `dispatch ${event}: ${store.state} -> (no-op)`);
    return;
  }
  stateLog("STATE", `dispatch ${event}: ${store.state} -> ${next}`);
  if (event === "videoEnd" && store.state === "VideoPlayback") {
    preserveVideoForResult();
  }
  if (store.state === "InputCheck" && next !== "InputCheck") {
    void notifyPhoneInputCheckExit(event === "inputOk");
  }
  if (store.state === "HakkeiReady" && next !== "HakkeiReady") {
    // パンチ検出（またはタイムアウト）で構え/パンチを抜ける瞬間、
    // パンチ合図画像を音声途中でも即座に隠す。
    hidePhaseCueImage();
  }
  if (event === "start") {
    // "start" で applyMode("mocopi-ble") が呼ばれ、ensureStarted が既存の（タイトルで先行接続した）
    // 生きた sidecar を再利用しつつ受信を有効化する（停止→再spawn はしない）。タイトル中は受信が
    // 無効なので packet は来ていない。念のため受信履歴をクリアし、有効化後の新 packet で CONNECTED に。
    punchRecvTimes = [];
    lastPunchInput = null;
    store.inputCheckBleReadySeen = false;
    void api.setInputMode({ mode: store.inputMode, reason: "user" });
  }
  if (event === "replay" || event === "reset" || event === "esc" || event === "finish") {
    playMainBgm();
    resetPlayState();
    resetParticipantAssistMode(event);
  }
  if (event === "finish") {
    clearResultVideo();
  }
  if (event === "inputOk" || event === "back" || event === "esc" || event === "reset") {
    stopRegisterPolling();
  }
  if (next === "VideoPlayback") {
    prepareVideoForPlayback();
    preSyncResultRanking();
  }
  if (next === "Title") {
    clearNavigationHistory();
    store.titleMenuIndex = 0;
    store.titlePanel = "menu";
    store.settingsOpen = false;
    resetParticipantAssistMode("title");
    keyboard?.setForcedHakkeiMode("none");
  }
  if (next === "Charge") {
    store.chargeRaw = 0;
    lastOverchargeCrackCount = 0;
    hakkeiWasOvercharged = false;
    stanceCuePlayed = false;
    punchCuePlayed = false;
    // チャージ開始の合図。
    playPhaseCue(cfg().app.audio.phaseCues.chargeStart, "cue-charge-start");
  }
  if (next === "HakkeiReady") {
    // 通常は Charge 中の前倒しタイマーで既に鳴っている。未再生（デバッグスキップ等）ならここで確定＆再生。
    playStanceCueNow();
    punchCuePlayed = false;
    resetHakkeiPrepState();
  }
  store.state = next;
  if (next === "InputCheck") {
    beginPhoneInputDeviceVerification();
    void notifyPhoneInputCheckReady();
  }
  render();
}

function tryAdvanceFromInputCheck(source: "button" | "keyboard" | "phone"): void {
  if (store.state !== "InputCheck") {
    return;
  }
  if (!inputCheckReady()) {
    stateLog("STATE", `inputOk blocked from ${source}: input not ready`);
    updateInputCheckHero();
    return;
  }
  if (source === "phone") {
    stopRegisterPolling();
  }
  dispatch("inputOk");
}

function maybeAdvanceFromPhoneReady(): void {
  if (
    store.state !== "InputCheck" ||
    store.registerReadyAtMs === null ||
    !store.registerSessionId ||
    performance.now() < phoneInputDeviceVerifyUntilMs ||
    !inputCheckReady()
  ) {
    return;
  }
  stateLog("REMOTE", `phone ready -> inputOk (${shortSessionId(store.registerSessionId)})`);
  tryAdvanceFromInputCheck("phone");
}

function handlePhoneReadyCancel(sessionId: string, cancelAtMs: number): void {
  if (
    store.state !== "InputCheck" ||
    store.registerSessionId !== sessionId ||
    sessionId !== autoAdvancedRegisterSessionId ||
    store.registerCancelHandledAtMs === cancelAtMs
  ) {
    return;
  }
  store.registerCancelHandledAtMs = cancelAtMs;
  store.registerReadyAtMs = null;
  stateLog("REMOTE", `phone ready cancel -> registration (${shortSessionId(sessionId)})`);
  stopRegisterPolling();
  if (!navigateBack()) {
    playMainBgm();
    resetPlayState();
    store.state = "Title";
    store.titlePanel = "register";
    store.settingsOpen = false;
    resetRegisterPanelState();
    render();
  }
}

async function startRemoteSession(sessionId: string): Promise<void> {
  if (!isRemoteMode()) {
    return;
  }
  const result = await api.remoteSessionStart({ sessionId });
  if (!result.ok) {
    stateLog("REMOTE", `ws start fallback ${shortSessionId(sessionId)}: ${result.messageJa}`);
  }
}

async function sendRemoteSessionEvent(
  type: RemoteSessionEvent["type"],
  sessionId: string,
  extra: Partial<RemoteSessionEvent> = {},
): Promise<boolean> {
  if (!isRemoteMode()) {
    return false;
  }
  const result = await api.remoteSessionSend({
    event: {
      ...extra,
      type,
      sessionId,
    },
  });
  if (!result.ok) {
    stateLog("REMOTE", `ws send fallback ${type} ${shortSessionId(sessionId)}: ${result.messageJa}`);
    return false;
  }
  stateLog("REMOTE", `ws send ok ${type} ${shortSessionId(sessionId)}`);
  return true;
}

async function notifyPhoneInputCheckReady(): Promise<void> {
  const sessionId = store.registerSessionId;
  if (
    !sessionId ||
    sessionId !== autoAdvancedRegisterSessionId ||
    store.registerInputCheckNotifiedSessionId === sessionId
  ) {
    return;
  }
  store.registerInputCheckNotifiedSessionId = sessionId;
  if (await sendRemoteSessionEvent("game.inputCheck", sessionId)) {
    stateLog("REMOTE", `input-check notify ok via ws ${shortSessionId(sessionId)}`);
    return;
  }
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/session-input-check",
      query: { sessionId },
    });
    if (!response.ok) {
      throw new Error(`server returned ${response.status}`);
    }
    stateLog("REMOTE", `input-check notify ok ${shortSessionId(sessionId)}`);
  } catch (error) {
    stateLog("REMOTE", `input-check notify failed: ${error instanceof Error ? error.message : String(error)}`);
    store.registerInputCheckNotifiedSessionId = null;
  }
}

async function notifyPhoneInputCheckExit(playStarted: boolean = false): Promise<void> {
  const sessionId = store.registerSessionId;
  if (!sessionId || sessionId !== autoAdvancedRegisterSessionId) {
    return;
  }
  if (await sendRemoteSessionEvent(playStarted ? "game.playStarted" : "game.inputExit", sessionId, { playStarted })) {
    stateLog("REMOTE", `input-exit notify ok via ws ${shortSessionId(sessionId)} playStarted=${playStarted}`);
    return;
  }
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/session-input-exit",
      query: { sessionId, play: playStarted },
    });
    if (!response.ok) {
      throw new Error(`server returned ${response.status}`);
    }
    stateLog("REMOTE", `input-exit notify ok ${shortSessionId(sessionId)} playStarted=${playStarted}`);
  } catch (error) {
    stateLog("REMOTE", `input-exit notify failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function notifyPhoneInputDeviceWaiting(): Promise<void> {
  const sessionId = store.registerSessionId;
  if (!sessionId || sessionId !== autoAdvancedRegisterSessionId) {
    return;
  }
  store.registerInputDeviceReadyNotifiedSessionId = null;
  if (await sendRemoteSessionEvent("game.inputCheck", sessionId)) {
    stateLog("REMOTE", `input-waiting notify ok via ws ${shortSessionId(sessionId)}`);
    return;
  }
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/session-input-check",
      query: { sessionId },
    });
    if (!response.ok) {
      throw new Error(`server returned ${response.status}`);
    }
    stateLog("REMOTE", `input-waiting notify ok ${shortSessionId(sessionId)}`);
  } catch (error) {
    stateLog("REMOTE", `input-waiting notify failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function notifyPhoneInputDeviceReady(): Promise<void> {
  const sessionId = store.registerSessionId;
  if (
    !sessionId ||
    sessionId !== autoAdvancedRegisterSessionId ||
    !inputCheckReady()
  ) {
    return;
  }
  if (await sendRemoteSessionEvent("game.inputDeviceReady", sessionId)) {
    store.registerInputDeviceReadyNotifiedSessionId = sessionId;
    stateLog("REMOTE", `input-ready notify ok via ws ${shortSessionId(sessionId)}`);
    return;
  }
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/session-input-check",
      query: { sessionId, ready: true },
    });
    if (!response.ok) {
      throw new Error(`server returned ${response.status}`);
    }
    store.registerInputDeviceReadyNotifiedSessionId = sessionId;
    stateLog("REMOTE", `input-ready notify ok ${shortSessionId(sessionId)}`);
  } catch (error) {
    stateLog("REMOTE", `input-ready notify failed: ${error instanceof Error ? error.message : String(error)}`);
    store.registerInputDeviceReadyNotifiedSessionId = null;
  }
}

function syncPhoneInputDeviceState(): void {
  if (store.state !== "InputCheck") {
    return;
  }
  if (performance.now() < phoneInputDeviceVerifyUntilMs) {
    return;
  }
  if (inputCheckReady()) {
    void notifyPhoneInputDeviceReady();
    return;
  }
  if (
    store.registerSessionId !== null &&
    store.registerInputDeviceReadyNotifiedSessionId === store.registerSessionId
  ) {
    void notifyPhoneInputDeviceWaiting();
  }
}

function schedulePhoneInputDeviceWaitingConfirm(epoch: number): void {
  for (const delayMs of [PHONE_INPUT_DEVICE_VERIFY_MS + 150, PHONE_INPUT_DEVICE_VERIFY_MS + 900]) {
    window.setTimeout(() => {
      if (
        store.state !== "InputCheck" ||
        epoch !== phoneInputDeviceNotifyEpoch ||
        performance.now() < phoneInputDeviceVerifyUntilMs ||
        inputCheckReady()
      ) {
        return;
      }
      void notifyPhoneInputDeviceWaiting();
    }, delayMs);
  }
}

async function resetAndNotifyPhoneInputDeviceState(epoch: number): Promise<void> {
  if (epoch !== phoneInputDeviceNotifyEpoch) {
    return;
  }
  await notifyPhoneInputDeviceWaiting();
  if (epoch !== phoneInputDeviceNotifyEpoch) {
    return;
  }
  if (inputCheckReady()) {
    finishPhoneInputDeviceVerification();
    await notifyPhoneInputDeviceReady();
    maybeAdvanceFromPhoneReady();
  } else {
    schedulePhoneInputDeviceWaitingConfirm(epoch);
  }
}

async function notifyReadyPhoneInputDeviceState(epoch: number): Promise<void> {
  if (epoch !== phoneInputDeviceNotifyEpoch || !inputCheckReady()) {
    return;
  }
  finishPhoneInputDeviceVerification();
  await notifyPhoneInputDeviceReady();
  maybeAdvanceFromPhoneReady();
}

async function notifyPhoneResult(saved: SavedScoreResult): Promise<boolean> {
  const sessionId = store.registerSessionId;
  const breakdown = store.breakdown;
  if (
    !sessionId ||
    !breakdown ||
    sessionId !== autoAdvancedRegisterSessionId ||
    store.registerResultNotifiedSessionId === sessionId
  ) {
    return store.registerResultNotifiedSessionId === sessionId;
  }
  store.registerResultNotifiedSessionId = sessionId;
  const damageYenText = breakdown.damageYenText ?? String(Math.max(0, Math.round(breakdown.damageYen)));
  if (await sendRemoteSessionEvent("game.result", sessionId, {
    playerId: saved.player.playerId.replace(/^remote-/, ""),
    damageYen: Math.max(0, Math.round(breakdown.damageYen)),
    damageYenText,
    rank: breakdown.rank,
  })) {
    return true;
  }
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/session-result",
      body: {
        sessionId,
        playerId: saved.player.playerId.replace(/^remote-/, ""),
        damageYen: Math.max(0, Math.round(breakdown.damageYen)),
        damageYenText,
        rank: breakdown.rank,
      },
    });
    if (!response.ok) {
      throw new Error(`server returned ${response.status}`);
    }
    return true;
  } catch (error) {
    stateLog("REMOTE", `result notify failed: ${error instanceof Error ? error.message : String(error)}`);
    store.registerResultNotifiedSessionId = null;
    return false;
  }
}

// dev メニュー専用: 通常遷移を経由せず状態を設定する（通常プレイには出さない）。
function devGoto(state: AppState): void {
  stateLog("STATE", `devGoto: ${store.state} -> ${state}`);
  store.state = state;
  render();
}

// Title メニュー: 選択位置の見た目だけを更新する（全再描画しない）。
function syncTitleMenuSelection(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-title-index]").forEach((btn) => {
    btn.classList.toggle("selected", Number(btn.dataset.titleIndex) === store.titleMenuIndex);
  });
}

function syncResultMenuSelection(selectedIndex: number): void {
  store.resultMenuIndex = selectedIndex;
  document.querySelectorAll<HTMLButtonElement>("[data-result-index]").forEach((btn) => {
    btn.classList.toggle("selected", Number(btn.dataset.resultIndex) === selectedIndex);
  });
}

function resultMenuHtml(): string {
  const items = RESULT_MENU.map((item, i) => {
    const selected = i === store.resultMenuIndex ? " selected" : "";
    return `<button class="ac-menu-item${selected}" data-event="${item.event}" data-result-index="${i}"><span>${item.label}</span></button>`;
  }).join("");
  return `<nav class="ac-menu result-actions" aria-label="Result menu">${items}</nav>`;
}

// Result メニュー: 現在の選択項目を実行する。
function activateResultMenu(): void {
  const item = RESULT_MENU[store.resultMenuIndex];
  if (item) {
    dispatch(item.event);
  }
}

// Result 画面のキーボード操作（十字キーで移動・Enter/Space で決定）。
function handleResultKey(e: KeyboardEvent): void {
  if (store.state !== "Result") {
    return;
  }
  switch (e.code) {
    case "ArrowUp":
    case "ArrowLeft":
      e.preventDefault();
      e.stopImmediatePropagation();
      syncResultMenuSelection((store.resultMenuIndex - 1 + RESULT_MENU.length) % RESULT_MENU.length);
      break;
    case "ArrowDown":
    case "ArrowRight":
      e.preventDefault();
      e.stopImmediatePropagation();
      syncResultMenuSelection((store.resultMenuIndex + 1) % RESULT_MENU.length);
      break;
    case "Enter":
    case "Space":
      e.preventDefault();
      e.stopImmediatePropagation();
      activateResultMenu();
      break;
    default:
      break;
  }
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") {
    return false;
  }
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

function handleParticipantAssistKey(e: KeyboardEvent): void {
  if (e.repeat || (e.code !== "ShiftLeft" && e.code !== "ShiftRight")) {
    return;
  }
  if (isEditableKeyTarget(e.target)) {
    return;
  }
  store.participantAssistMode = !store.participantAssistMode;
  stateLog(
    "PARTICIPANT_ASSIST",
    `${store.participantAssistMode ? "on" : "off"} state=${store.state} ready=${currentChargeReady()}`,
  );
  updateGameModeIndicators();
  updateDiagnostics();
}

function openRegisterPanel(): void {
  pushNavigationHistory();
  store.titlePanel = "register";
  resetRegisterPanelState();
  render();
}

function closeTitleSubPanel(): void {
  stopRegisterPolling();
  if (navigateBack()) {
    return;
  }
  store.titlePanel = "menu";
  store.registerError = null;
  render();
}

// Title メニュー: 現在の選択項目を実行する。
function activateTitleMenu(): void {
  const item = titleMenuItems()[store.titleMenuIndex];
  if (!item) {
    return;
  }
  if (item.action === "start-register") {
    openRegisterPanel();
  } else if (item.action === "ranking-board") {
    pushNavigationHistory();
    store.titlePanel = "ranking";
    void fetchServerRankingBoard();
    render();
  } else if (item.action === "quit-game") {
    void api.quitApp();
  }
}

// 入力モード切替（InputCheck の右下コマンド／キーから）。
function switchToKeyboard(): void {
  stateLog("INPUT", `mode: ${store.inputMode} -> keyboard`);
  store.inputMode = "keyboard";
  const notifyEpoch = beginPhoneInputDeviceVerification();
  void api.setInputMode({ mode: "keyboard", reason: "fallback" });
  startRegisterPolling();
  void notifyReadyPhoneInputDeviceState(notifyEpoch);
  render();
}

function switchToMocopi(): void {
  stateLog("INPUT", `mode: ${store.inputMode} -> mocopi-ble`);
  store.inputMode = "mocopi-ble";
  const notifyEpoch = beginPhoneInputDeviceVerification();
  store.inputCheckBleReadySeen = false;
  punchRecvTimes = [];
  lastPunchInput = null;
  void api.setInputMode({ mode: "mocopi-ble", reason: "user" });
  startRegisterPolling();
  void resetAndNotifyPhoneInputDeviceState(notifyEpoch);
  render();
}

// InputCheck（本番）のキーボード操作。K=キーボード / M=mocopi 切替、Enter=接続済みなら進む。
function handleInputCheckKey(e: KeyboardEvent): void {
  if (store.state !== "InputCheck" || isDebugMode()) {
    return;
  }
  if (e.code === "KeyK" && store.inputMode !== "keyboard") {
    e.preventDefault();
    switchToKeyboard();
    return;
  }
  if (e.code === "KeyM" && store.inputMode !== "mocopi-ble") {
    e.preventDefault();
    switchToMocopi();
    return;
  }
  if (e.code === "Enter") {
    e.preventDefault();
    tryAdvanceFromInputCheck("keyboard");
  }
}

// Title画面のキーボード操作（シネマティックメニュー移動＋入力設定コマンド）。ゲーム入力とは独立。
// 処理したキーは stopImmediatePropagation で他の window keydown リスナ（handleInputCheckKey）へ
// 渡さない。Enter で START→InputCheck に遷移した直後、同じイベントで InputCheck 側が inputOk を
// 発火して画面を飛ばす二段発火を防ぐ。
function handleTitleKey(e: KeyboardEvent): void {
  if (store.state !== "Title") {
    return;
  }
  const target = e.target;
  const isTextField =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
  // 入力設定オーバーレイ表示中は S / Esc で閉じるだけ。
  if (store.settingsOpen) {
    if (e.code === "KeyS" || e.code === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (navigateBack()) {
        return;
      }
      store.settingsOpen = false;
      render();
    }
    return;
  }
  if (store.titlePanel === "ranking" || store.titlePanel === "register") {
    if (e.code === "Escape" || (e.code === "Backspace" && !isTextField)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!navigateBack()) {
        closeTitleSubPanel();
      }
    }
    return;
  }
  switch (e.code) {
    case "KeyS":
      e.preventDefault();
      e.stopImmediatePropagation();
      pushNavigationHistory();
      store.settingsOpen = true;
      render();
      break;
    case "ArrowUp":
      e.preventDefault();
      e.stopImmediatePropagation();
      store.titleMenuIndex = (store.titleMenuIndex - 1 + titleMenuItems().length) % titleMenuItems().length;
      syncTitleMenuSelection();
      break;
    case "ArrowDown":
      e.preventDefault();
      e.stopImmediatePropagation();
      store.titleMenuIndex = (store.titleMenuIndex + 1) % titleMenuItems().length;
      syncTitleMenuSelection();
      break;
    case "Enter":
    case "Space":
      e.preventDefault();
      e.stopImmediatePropagation();
      activateTitleMenu();
      break;
    default:
      break;
  }
}

// --- 入力消費 -----------------------------------------------------------

// game loop は Main 生成の PunchInputSample で進める（角速度/擬似 accel から Main が生成）。
function onPunchInput(sample: PunchInputSample): void {
  // 受信トラッキング（有効性に関わらず・BLE 受信状態表示用）。
  const now = performance.now();
  punchRecvTimes.push(now);
  punchRecvTimes = punchRecvTimes.filter((t) => now - t < 1000);
  lastPunchInput = sample;
  if (measuring) {
    if (measureT0 === null) {
      measureT0 = sample.timestampMs;
    }
    measureBuf.push({
      t: sample.timestampMs - measureT0, // 計測開始からの相対 ms
      dt: sample.quality.dtMs,
      idleMs: sample.idleMs,
      intensity: sample.strength.intensity,
      chargeDelta: sample.chargeDelta,
      motionAmount: sample.strength.motionAmount,
      label: measureLabel,
    });
  }
  if (wizActive) {
    wizardProcess(sample); // 自動進行（ステージ遷移時に render する）。
  }
  if (store.state === "InputCheck") {
    if (store.inputMode === "mocopi-ble" && isBleReceiving()) {
      store.inputCheckBleReadySeen = true;
    }
    updateDiagnostics();
    maybeAdvanceFromPhoneReady();
  }

  // 入力欠落または無効sample中はchargeもpunch検出も進めない。
  if (!sample.isAvailable || !sample.validForScore) {
    return;
  }
  switch (store.state) {
    case "Charge":
      {
        const previousChargeRaw = store.chargeRaw;
        store.chargeRaw = accumulatePunchCharge(store.chargeRaw, sample);
        if (previousChargeRaw <= 0 && store.chargeRaw > 0) {
          playChargeSound();
        }
        const ready = currentChargeReady();
        if (ready > 0 && previousChargeRaw <= ready && store.chargeRaw > ready) {
          playOverchargeSound();
        }
      }
      updateDiagnostics(); // BLE 経路もタメメーターをライブ更新（onMotionSample が来ないため）。
      break;
    case "HakkeiReady": {
      if (store.breakdown !== null) {
        return;
      }
      const v = sample.strength.intensity;
      // 構え中（未 arm）は、実機/keyboard ともに発勁入力として扱わない。
      if (detector === null) {
        return;
      }
      // keyboard は離散インパルス → 閾値超で即発火（スパイク方式は連続波形の BLE 専用）。
      if (store.inputMode === "keyboard") {
        store.strengthPeak = Math.max(store.strengthPeak, v);
        if (v > currentIntensityThreshold()) {
          finalizeScore(true, false, v);
          dispatch("hakkeiDetected");
        } else {
          updateDiagnostics();
        }
        return;
      }
      // BLE: スパイク方式（立ち上がり→ピーク追跡→減衰で真のピーク発火）。
      const r = detector.observe(sample);
      store.strengthPeak = r.strengthRaw;
      if (r.detected) {
        finalizeScore(true, false, r.strengthRaw);
        dispatch("hakkeiDetected");
      } else {
        updateDiagnostics(); // パンチ強さのライブ表示を更新。
      }
      break;
    }
    default:
      break;
  }
}

// onMotionSample は diagnostics 表示のみ（game loop には使わない）。
function onSample(sample: MotionSample): void {
  store.lastSample = sample;
  if (store.state === "Charge" || store.state === "HakkeiReady" || store.state === "InputCheck") {
    updateDiagnostics();
  }
}

function updateDiagnostics(): void {
  updateChargeHud();
  // 本番 InputCheck は「接続ヒーロー」を差分更新する（#diag は使わず DOM を作り直さない）。
  if (store.state === "InputCheck" && !isDebugMode() && store.inputMode !== "none") {
    updateInputCheckHero();
    return;
  }
  const el = document.getElementById("diag");
  if (!el || !keyboard) {
    return;
  }
  let html: string;
  if (store.inputMode === "keyboard") {
    html = diagnosticsHtml(keyboard.getPressed(), store.lastSample);
  } else if (store.inputMode === "mocopi-ble") {
    html = bleStatusHtml();
    if (store.state === "InputCheck") {
      html += wizActive ? wizardPanelHtml() : measurePanelHtml();
    }
  } else {
    html = statusPanelHtml(
      store.inputMode,
      store.lastStatus,
      store.lastHeartbeat,
      store.lastSample,
      Date.now(),
      store.lastDiagnostics,
    );
  }
  if (store.state === "Charge") {
    html += isDebugMode() ? chargeMeterDebugHtml() : "";
  }
  if (store.state === "HakkeiReady") {
    html += hakkeiArmed ? punchDiagHtml() : hakkeiPrepHtml();
  }
  el.innerHTML = html;
  // #diag に動的注入したボタン（ble-replay/restart/stop 等）にクリック配線する。
  // wire() は root スコープ限定なので #diag 内だけ再配線され、二重 attach は起きない（毎回作り直し）。
  wire(el);
}

// mocopi-ble の受信状態（onPunchInput 由来）。replay/sidecar から packet が届いているか。
function bleStatusHtml(): string {
  const now = performance.now();
  const recent = punchRecvTimes.filter((t) => now - t < cfg().input.inputCheck.mocopiBleRecentWindowMs); // 現在時刻で再計算（停止時に 0 になる）
  const hz = recent.length;
  const recv = hz > 0;
  const lastAge =
    punchRecvTimes.length > 0 ? Math.round(now - punchRecvTimes[punchRecvTimes.length - 1]) : null;
  const s = lastPunchInput;
  const okng = (ok: boolean): string =>
    `<span class="okng ${ok ? "ok" : "ng"}">${ok ? "OK" : "NG"}</span>`;
  const sc = bleSidecarStatus;
  const scLabel: Record<string, string> = {
    "not-started": "未起動", starting: "起動中", running: "稼働中", stopped: "停止", error: "エラー",
  };
  const scOk = sc?.status === "running";
  const scRow = `<tr><th>sidecar</th><td><span class="okng ${scOk ? "ok" : sc?.status === "error" ? "ng" : ""}">${sc ? scLabel[sc.status] : "—"}${sc?.kind ? `(${sc.kind})` : ""}</span> <span class="diag-hint">${sc?.detail ?? ""}</span></td></tr>`;
  const noReceiveHint = isDebugMode()
    ? "未受信です。アプリが自動で sidecar を起動します（実機 mocopi を青点滅/接続待ちに）。実機が無いときは下の「録画再生でテスト」。動かないときは「Keyboardに切替」。"
    : "未受信です。実機 mocopi を青点滅/接続待ちにしてください。動かないときは「キーボード入力に切替」。";
  return `<table class="status-table">
    <tr><th>入力モード</th><td>mocopi-ble（BLE 直読）</td></tr>
    ${scRow}
    <tr><th>BLE受信</th><td>${okng(recv)} ${recv ? `${hz} packets/s` : "（未受信）"}</td></tr>
    <tr><th>最終受信</th><td>${lastAge === null ? "—" : `${lastAge}ms 前`}</td></tr>
    <tr><th>角速度(intensity)</th><td>${s ? s.strength.intensity.toFixed(0) + " deg/s" : "—"}</td></tr>
    <tr><th>有効</th><td>${s ? okng(s.validForScore) : "—"}</td></tr>
    <tr><th>flags</th><td>${s && s.quality.flags.length ? s.quality.flags.join(",") : "なし"}</td></tr>
  </table>
  ${recv ? "" : `<p class="diag-hint">${noReceiveHint}</p>`}`;
}

// --- InputCheck（本番）: mocopi 接続状況を大きく伝えるヒーロー表示。詳細テーブルは出さない。 ---

// 設定された直近 window 内に BLE packet を受信しているか（接続完了＝受信中）。
function isBleReceiving(): boolean {
  const now = performance.now();
  return punchRecvTimes.some((t) => now - t < cfg().input.inputCheck.mocopiBleRecentWindowMs);
}

// InputCheck を次へ進められる状態か（keyboard は常時可・BLE は受信中なら可）。
function inputCheckReady(): boolean {
  if (store.inputMode === "keyboard") {
    return true;
  }
  if (store.inputMode !== "mocopi-ble") {
    return false;
  }
  if (isBleReceiving()) {
    return true;
  }
  return cfg().input.inputCheck.mocopiBleReadyPolicy === "sticky-after-first" && store.inputCheckBleReadySeen;
}

// 現在の接続ステータス（状態＋大文字EN/JA＋補足）を判定する純データ。
type InputCheckStatus = {
  state: "ready" | "searching" | "error";
  en: string;
  ja: string;
  sub: string;
};

function inputCheckStatus(): InputCheckStatus {
  if (store.inputMode === "keyboard") {
    return {
      state: "ready",
      en: "KEYBOARD MODE",
      ja: "Manual input ready",
      sub: "Space to charge, Enter to strike. Ready when you are.",
    };
  }
  const now = performance.now();
  const hz = punchRecvTimes.filter((t) => now - t < cfg().input.inputCheck.mocopiBleRecentWindowMs).length;
  if (hz > 0) {
    store.inputCheckBleReadySeen = true;
    // nbsp で "(51 packets/s)" を1語扱いにし、括弧が行またぎで割れないようにする。
    return {
      state: "ready",
      en: "CONNECTED",
      ja: "mocopi linked",
      sub: store.registerSessionId
        ? `mocopi link detected (${hz}\u00A0packets/s). Tap READY on your phone or press Enter.`
        : `mocopi link detected (${hz}\u00A0packets/s). You're ready to go.`,
    };
  }
  if (cfg().input.inputCheck.mocopiBleReadyPolicy === "sticky-after-first" && store.inputCheckBleReadySeen) {
    return {
      state: "ready",
      en: "CONNECTED",
      ja: "mocopi linked",
      sub: store.registerSessionId
        ? "mocopi was linked during this check. Tap READY on your phone or press Enter."
        : "mocopi was linked during this check. You're ready to go.",
    };
  }
  if (bleSidecarStatus?.status === "error") {
    return {
      state: "error",
      en: "CONNECTION ERROR",
      ja: "Reconnecting…",
      sub: "Trying to reconnect. Switch to keyboard mode if it won't link.",
    };
  }
  return {
    state: "searching",
    en: "SEARCHING…",
    ja: "Connecting to mocopi",
    sub: store.registerReadyAtMs !== null
      ? "Phone is ready. Waiting for mocopi link."
      : "Set your mocopi to pairing mode (blinking\u00A0blue) and wait a moment.",
  };
}

function statusGlyph(state: InputCheckStatus["state"]): string {
  return state === "ready" ? "✓" : state === "error" ? "!" : "";
}

// InputCheck ヒーローの静的マークアップ（render で1度だけ生成し、以後は差分更新する）。
// #diag には入れない: 毎tick innerHTML を作り直すとリング脈動と入場アニメが再起動して
// ちらつくため（updateInputCheckHero でテキストと状態クラスだけ差し替える）。
function inputCheckHeroHtml(): string {
  const s = inputCheckStatus();
  return `<div class="ic-status ic-status-${s.state}" id="ic-status">
    <div class="ic-status-ring" aria-hidden="true"><span class="ic-status-glyph" id="ic-glyph">${statusGlyph(s.state)}</span></div>
    <div class="ic-status-en" id="ic-en">${s.en}</div>
    <div class="ic-status-ja" id="ic-ja">${s.ja}</div>
    <p class="ic-status-sub" id="ic-sub">${s.sub}</p>
  </div>`;
}

function setTextIfChanged(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

// InputCheck ヒーローの差分更新（DOM は作り直さない・アニメを継続させる）。
function updateInputCheckHero(): void {
  const root = document.getElementById("ic-status");
  if (!root) {
    return;
  }
  const s = inputCheckStatus();
  const nextClass = `ic-status ic-status-${s.state}`;
  if (root.className !== nextClass) {
    root.className = nextClass; // 状態が変わったときだけ差し替え（同一なら脈動を継続）。
  }
  setTextIfChanged("ic-glyph", statusGlyph(s.state));
  setTextIfChanged("ic-en", s.en);
  setTextIfChanged("ic-ja", s.ja);
  setTextIfChanged("ic-sub", s.sub);
  const ready = inputCheckReady();
  document.getElementById("inputcheck-proceed")?.classList.toggle("is-visible", ready);
  const proceedButton = document.getElementById("inputcheck-proceed-button") as HTMLButtonElement | null;
  if (proceedButton) {
    proceedButton.disabled = !ready;
    proceedButton.setAttribute("aria-disabled", String(!ready));
  }
  if (ready) {
    void notifyPhoneInputDeviceReady();
  }
  maybeAdvanceFromPhoneReady();
}

// 右下の極小コマンド（モード切替＋一つ前の画面へ）。Title の command-hint と揃える。
function inputCheckHintHtml(): string {
  const modeCmd = store.inputMode === "keyboard"
    ? `<button class="ic-cmd" data-action="switch-mocopi">[ <b>M</b> ]&nbsp; MOCOPI MODE</button>`
    : `<button class="ic-cmd" data-action="switch-keyboard">[ <b>K</b> ]&nbsp; KEYBOARD MODE</button>`;
  const backLabel = escapeHtml(backTargetLabel());
  return `<div class="inputcheck-hint">
    ${modeCmd}
    <button class="ic-cmd" data-action="inputcheck-back">[ <b>Esc</b> ]&nbsp; ${backLabel}</button>
  </div>`;
}

// mocopi-bleの操作ボタン（BLE制御＋計測）。screenHtmlの静的領域に置き、render()で1回だけ配線する。
// #diagは高頻度更新されるため、内部に置くとクリック完了前にボタンが再生成される。
function bleControlsHtml(): string {
  let measure: string;
  if (wizActive) {
    // 実験ウィザード中。操作は最小（自動進行が主）。
    if (wizStage === "intro") {
      measure = `<div class="actions">
          <button class="primary" data-action="wiz-go">開始</button>
          <button data-action="wiz-abort">やめる</button>
        </div>`;
    } else if (wizStage === "done") {
      measure = `<div class="actions">
          <button data-action="wiz-save">もう一度保存</button>
          <button data-action="wiz-restart">もう一度やる</button>
          <button data-action="wiz-exit">終了</button>
        </div>`;
    } else {
      measure = `<div class="actions">
          <button data-action="wiz-redo">このステップやり直し</button>
          <button data-action="wiz-skip">スキップ→次へ</button>
          <button data-action="wiz-abort">中止</button>
        </div>`;
    }
  } else if (measuring) {
    measure = `<div class="measure-presets">
        <span class="measure-cap">セッション種別（押すと記録リセット）:</span>
        <div class="actions">
          <button data-session="still">S1 静止床</button>
          <button data-session="punch-burst">S2 本気パンチ</button>
          <button data-session="charge-hold">S3 チャージ</button>
          <button data-session="charge-punch-set">S4 タメ→パンチ</button>
          <button data-session="slow">S5 ゆっくり1発</button>
        </div>
      </div>
      <div class="measure-presets">
        <span class="measure-cap">ラベル（区間の境界 marker）:</span>
        <div class="actions">
          <button data-measure="charge">チャージ</button>
          <button data-measure="strong">本気パンチ</button>
          <button data-measure="slow">ゆっくり</button>
          <button data-measure="rest">静止</button>
        </div>
      </div>
      <div class="actions">
        <button data-action="measure-export">エクスポート(JSON)</button>
        <button data-action="measure-reset">リセット</button>
        <button data-action="measure-stop">計測終了</button>
      </div>`;
  } else {
    measure = `<div class="actions">
        <button class="primary" data-action="wiz-begin">実験ウィザードを始める（自動・推奨）</button>
        <button data-action="measure-start">手動計測</button>
      </div>`;
  }
  return `<div class="actions">
      <button data-action="ble-restart">sidecar 再起動</button>
      <button data-action="ble-replay">録画再生でテスト（実機なし）</button>
      <button data-action="ble-stop">停止</button>
    </div>${measure}`;
}

// 計測データの解析ヘルパ（in-UI フィードバック用）。
function pctAsc(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const i = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[i];
}

// 連続ストリームからパンチ（スパイク）を自動抽出。hi で立ち上がり、lo で終了＝1イベント。
function detectMeasurePunches(
  buf: { t: number; intensity: number }[],
  hi = 400,
  lo = 150,
): { t: number; peak: number }[] {
  const out: { t: number; peak: number }[] = [];
  let inPunch = false;
  let peak = 0;
  let tPeak = 0;
  for (const s of buf) {
    const v = s.intensity;
    if (!inPunch && v > hi) {
      inPunch = true;
      peak = v;
      tPeak = s.t;
    } else if (inPunch) {
      if (v > peak) {
        peak = v;
        tPeak = s.t;
      }
      if (v < lo) {
        out.push({ t: tPeak, peak });
        inPunch = false;
        peak = 0;
      }
    }
  }
  if (inPunch) {
    out.push({ t: tPeak, peak });
  }
  return out;
}

// --- 実験ウィザード ロジック -------------------------------------------------

function startWizard(): void {
  wizActive = true;
  measuring = false; // 手動計測とは排他。
  wizStage = "intro";
  wizStill = null;
  wizResult = null;
  wizPunchPeaks = [];
  wizChargeReps = [];
  wizSets = [];
  wizSlowPeaks = [];
  render();
}

// ステージ遷移。直前ステージの集計を確定し、新ステージの runtime を初期化する。
function wizGoto(next: WizStage): void {
  if (wizStage === "still" && wizStillBuf.length > 0) {
    const s = [...wizStillBuf].sort((a, b) => a - b);
    wizStill = { n: s.length, p95: pctAsc(s, 95), p99: pctAsc(s, 99), max: s[s.length - 1] };
  }
  wizStage = next;
  wizStillStartMs = null;
  wizStillBuf = [];
  wizInPunch = false;
  wizPeak = 0;
  wizRepStartMs = null;
  wizRepCharge = 0;
  if (next === "punch") {
    wizPunchPeaks = [];
  } else if (next === "charge") {
    wizRep = 0;
    wizChargeReps = [];
  } else if (next === "chargePunch") {
    wizSets = [];
    wizSetCharge = 0;
  } else if (next === "slow") {
    wizSlowPeaks = [];
  } else if (next === "done") {
    finishWizard();
  }
  render();
}

// 1サンプルでウィザードを進める（onPunchInput から・performance.now で計時）。
function wizardProcess(sample: PunchInputSample): void {
  if (!wizActive || !sample.isAvailable || !sample.validForScore) {
    return;
  }
  const now = performance.now();
  const v = sample.strength.intensity;
  switch (wizStage) {
    case "still": {
      if (v < WIZ_MOVE_THRESH) {
        if (wizStillStartMs === null) {
          wizStillStartMs = now;
          wizStillBuf = [];
        }
        wizStillBuf.push(v);
        if (now - wizStillStartMs >= WIZ_STILL_MS) {
          wizGoto("punch");
        }
      } else {
        wizStillStartMs = null; // 動いた→静止リセット
      }
      break;
    }
    case "punch": {
      if (detectSpike(v, WIZ_PUNCH_HI, WIZ_PUNCH_LO)) {
        wizPunchPeaks.push(Math.round(wizPeak));
        wizFlashMs = now;
        wizPeak = 0;
        if (wizPunchPeaks.length >= WIZ_PUNCH_N) {
          wizGoto("charge");
        }
      }
      break;
    }
    case "charge": {
      if (wizRepStartMs === null) {
        wizRepStartMs = now;
        wizRepCharge = 0;
      }
      wizRepCharge += sample.chargeDelta;
      if (now - wizRepStartMs >= WIZ_CHARGE_REP_MS) {
        wizChargeReps.push(Math.round(wizRepCharge));
        wizRep += 1;
        wizRepStartMs = null;
        if (wizRep >= WIZ_CHARGE_REPS) {
          wizGoto("chargePunch");
        }
      }
      break;
    }
    case "chargePunch": {
      wizSetCharge += sample.chargeDelta;
      if (detectSpike(v, WIZ_PUNCH_HI, WIZ_PUNCH_LO)) {
        wizSets.push({ charge: Math.round(wizSetCharge), peak: Math.round(wizPeak) });
        wizFlashMs = now;
        wizSetCharge = 0;
        wizPeak = 0;
        if (wizSets.length >= WIZ_SETS_N) {
          wizGoto("slow");
        }
      }
      break;
    }
    case "slow": {
      if (detectSpike(v, WIZ_SLOW_HI, WIZ_SLOW_LO)) {
        wizSlowPeaks.push(Math.round(wizPeak));
        wizFlashMs = now;
        wizPeak = 0;
        if (wizSlowPeaks.length >= WIZ_SLOW_N) {
          wizGoto("done");
        }
      }
      break;
    }
    default:
      break;
  }
}

// オンライン スパイク検出（wizInPunch/wizPeak を共有 state として進める）。
// 立ち上がり(hi)→ピーク更新→終了(lo)で1発成立。成立した瞬間 true。
function detectSpike(v: number, hi: number, lo: number): boolean {
  if (!wizInPunch && v > hi) {
    wizInPunch = true;
    wizPeak = v;
  } else if (wizInPunch) {
    if (v > wizPeak) {
      wizPeak = v;
    }
    if (v < lo) {
      wizInPunch = false;
      return true;
    }
  }
  return false;
}

function finishWizard(): void {
  const pp = [...wizPunchPeaks].sort((a, b) => a - b);
  wizResult = {
    sessionType: "wizard",
    intensityThresholdBle: cfg().score.punch.intensityThresholdBle,
    chargeNoiseFloor: cfg().score.punch.chargeNoiseFloor,
    still: wizStill,
    punch: {
      n: pp.length,
      p50: pctAsc(pp, 50),
      p95: pctAsc(pp, 95),
      max: pp.length ? pp[pp.length - 1] : 0,
      peaks: wizPunchPeaks,
    },
    chargeReps: wizChargeReps,
    sets: wizSets,
    slowPeaks: wizSlowPeaks,
  };
  downloadJson(`wizard-${pp.length}p-${wizSets.length}set.json`, wizResult);
}

// ウィザードの live 表示（#diag・50Hz 更新）。big カウンタ／カウントダウン／ゲージ／フラッシュ。
function wizardPanelHtml(): string {
  const now = performance.now();
  const live = lastPunchInput ? lastPunchInput.strength.intensity.toFixed(0) : "—";
  const flash = now - wizFlashMs < 300 ? " flash" : "";
  const bar = (val: number, max: number): string => {
    const pct = Math.min(100, max > 0 ? (val / max) * 100 : 0);
    return `<div class="wiz-bar"><div class="wiz-bar-fill" style="width:${pct.toFixed(0)}%"></div></div>`;
  };
  let body: string;
  switch (wizStage) {
    case "intro":
      body = `<div class="wiz-title">実験ウィザード</div>
        <p class="hint">5ステップを自動で進めます（約10分）。各ステップは自動でカウント・自動で次へ・最後に結果を自動保存。下の「開始」を押してください。<br>
        ①完全静止5秒 ②本気パンチ20発 ③全力スイング3本 ④タメ→本気パンチ8セット ⑤ゆっくり1発5本</p>`;
      break;
    case "still": {
      const remain = wizStillStartMs !== null ? Math.max(0, WIZ_STILL_MS - (now - wizStillStartMs)) : WIZ_STILL_MS;
      const moving = wizStillStartMs === null;
      body = `<div class="wiz-step">① 静止床</div>
        <div class="wiz-big${moving ? " ng" : " ok"}">${(remain / 1000).toFixed(1)}<small>秒キープ</small></div>
        <p class="hint">${moving ? "⚠ 動いています！腕を脱力して完全に静止" : "そのまま静止…"}（live ${live} deg/s）</p>`;
      break;
    }
    case "punch": {
      const max = wizPunchPeaks.length ? Math.max(...wizPunchPeaks) : 0;
      body = `<div class="wiz-step">② 本気パンチ</div>
        <div class="wiz-big${flash}">${wizPunchPeaks.length}<small>/ ${WIZ_PUNCH_N} 発</small></div>
        <p class="hint">全力で前へパンチ→脱力静止→繰り返し。max ${max} deg/s ／ 直近 [${wizPunchPeaks.slice(-6).join(", ")}]</p>`;
      break;
    }
    case "charge": {
      const remain = wizRepStartMs !== null ? Math.max(0, WIZ_CHARGE_REP_MS - (now - wizRepStartMs)) : WIZ_CHARGE_REP_MS;
      body = `<div class="wiz-step">③ 全力スイング Rep ${wizRep + 1}/${WIZ_CHARGE_REPS}</div>
        <div class="wiz-big">${(remain / 1000).toFixed(1)}<small>秒 振り続けて！</small></div>
        ${bar(wizRepCharge, 3000)}
        <p class="hint">腕を本気で振り続ける。たまった回転 ${wizRepCharge.toFixed(0)}° ／ 完了 [${wizChargeReps.join(", ")}]</p>`;
      break;
    }
    case "chargePunch": {
      const last = wizSets.length ? wizSets[wizSets.length - 1] : null;
      body = `<div class="wiz-step">④ タメ→本気パンチ</div>
        <div class="wiz-big${flash}">${wizSets.length}<small>/ ${WIZ_SETS_N} セット</small></div>
        ${bar(wizSetCharge, 3000)}
        <p class="hint">タメ（振る）→本気で1発。今のタメ ${wizSetCharge.toFixed(0)}°${last ? ` ／ 直近 タメ${last.charge}° → ${last.peak}deg/s` : ""}</p>`;
      break;
    }
    case "slow": {
      body = `<div class="wiz-step">⑤ ゆっくり1発</div>
        <div class="wiz-big${flash}">${wizSlowPeaks.length}<small>/ ${WIZ_SLOW_N} 本</small></div>
        <p class="hint">ゆっくり前へ突く。peaks [${wizSlowPeaks.join(", ")}]</p>`;
      break;
    }
    case "done": {
      const r = wizResult;
      const p = (r?.punch ?? {}) as { p50?: number; p95?: number; max?: number };
      body = `<div class="wiz-step">完了！結果を自動保存しました</div>
        <table class="status-table">
          <tr><th>静止床 max</th><td>${wizStill ? wizStill.max.toFixed(0) : "—"} deg/s（p99 ${wizStill ? wizStill.p99.toFixed(0) : "—"}）</td></tr>
          <tr><th>本気パンチ</th><td>p50 ${p.p50 ?? "—"} / p95 ${p.p95 ?? "—"} / max ${p.max ?? "—"} deg/s（${wizPunchPeaks.length}発）</td></tr>
          <tr><th>全力スイング</th><td>${wizChargeReps.join(", ")} °</td></tr>
          <tr><th>タメ→パンチ</th><td>${wizSets.map((s) => `${s.charge}→${s.peak}`).join(" / ")}</td></tr>
          <tr><th>ゆっくり</th><td>${wizSlowPeaks.join(", ")} deg/s</td></tr>
        </table>
        <p class="hint">JSON は Downloads に保存済み。これを渡してもらえれば config とスコア式を確定します。</p>`;
      break;
    }
    default:
      body = "";
  }
  return `<div class="measure-panel wiz">${body}</div>`;
}

// 直近サンプルの角速度を SVG スパークラインに（波形を目視するため）。
// threshold 線（パンチ判定閾値）も引いてスパイクが閾値を越えたか見えるようにする。
function sparklineSvg(values: number[], threshold: number): string {
  const w = 320;
  const h = 72;
  if (values.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  }
  const yMax = Math.max(threshold * 1.2, ...values, 50); // 上限は閾値か実測ピークの大きい方
  const x = (i: number): number => (i / (values.length - 1)) * w;
  const y = (v: number): number => h - (Math.min(v, yMax) / yMax) * h;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const thY = y(threshold).toFixed(1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="0" y1="${thY}" x2="${w}" y2="${thY}" class="spark-th"/>
    <polyline points="${pts}" class="spark-line"/>
  </svg>`;
}

// 計測モード UI（角速度の実測・計算式設計用）。連続記録の波形＋進捗を live 表示。
// 注: 操作ボタンは bleControlsHtml()（screenHtml 静的領域）にあり、ここは #diag の live 値テーブルのみ。
function measurePanelHtml(): string {
  if (!measuring) {
    return "";
  }
  const win = measureBuf.slice(-150); // 直近 ~3s（50Hz）
  const series = win.map((s) => s.intensity);
  const th = cfg().score.punch.intensityThresholdBle;
  const live = lastPunchInput ? lastPunchInput.strength.intensity.toFixed(0) : "—";
  const idleSec = lastPunchInput ? (lastPunchInput.idleMs / 1000).toFixed(1) : "0.0";
  const durSec = measureBuf.length ? (measureBuf[measureBuf.length - 1].t / 1000).toFixed(1) : "0.0";

  // 角速度・motionAmount の分位（録全体）。S1=床確認, S2=本気到達, の即時フィードバック。
  const av = measureBuf.map((s) => s.intensity).sort((a, b) => a - b);
  const mo = measureBuf.map((s) => s.motionAmount).sort((a, b) => a - b);
  const avMax = av.length ? av[av.length - 1] : 0;
  const totalRot = measureBuf.reduce((a, s) => a + s.chargeDelta, 0);
  const rateDegS = durSec !== "0.0" ? totalRot / Number(durSec) : 0;

  // パンチ自動セグメント（1発ずつラベルを押さなくて良い）。
  const punches = detectMeasurePunches(measureBuf);
  const pPeaks = punches.map((p) => Math.round(p.peak));
  const pMax = pPeaks.length ? Math.max(...pPeaks) : 0;
  const lastPeaks = pPeaks.slice(-6).join(", ");

  // 静止床の合否ヒント（S1）。max が床想定（~35deg/s）以下なら静止OK。
  const stillOk = avMax > 0 && avMax < 35;

  return `<div class="measure-panel">
    <table class="status-table">
      <tr><th colspan="2">計測（連続記録）— 種別 <b>${measureSession}</b> / ラベル <b>${measureLabel}</b> / live <b>${live}</b> deg/s</th></tr>
      <tr><th>記録</th><td>${measureBuf.length} samples / ${durSec}s / marker ${measureMarks.length}個</td></tr>
      <tr><th>idle</th><td>${idleSec}s（Main生成 idleMs をそのまま記録/export）</td></tr>
      <tr><th>角速度 deg/s</th><td>p50 ${pctAsc(av, 50).toFixed(0)} / p95 ${pctAsc(av, 95).toFixed(0)} / p99 ${pctAsc(av, 99).toFixed(0)} / max ${avMax.toFixed(0)}</td></tr>
      <tr><th>静止床</th><td>motionAmount p99 ${pctAsc(mo, 99).toFixed(2)}°/frame <span class="okng ${stillOk ? "ok" : "ng"}">${stillOk ? "静止OK" : "動いてる"}</span></td></tr>
      <tr><th>パンチ(自動)</th><td>${punches.length}発 / max ${pMax} / 直近 [${lastPeaks}]</td></tr>
      <tr><th>チャージ</th><td>総回転 ${totalRot.toFixed(0)}° / ${rateDegS.toFixed(0)} deg/s</td></tr>
    </table>
    <div class="spark-wrap">
      <div class="spark-label">角速度 波形（直近3s・点線=閾値${th}）</div>
      ${sparklineSvg(series, th)}
    </div>
    <p class="hint">①種別ボタンで S1〜S5 を選ぶ（記録がリセットされる）→②指示どおり動く。S1=完全静止, S2=本気パンチ1発ずつ静止挟む, S3=本気スイング, S4=チャージ押し→振り→本気パンチ押し→1発, S5=ゆっくり1発。終わったら「エクスポート」で JSON 保存。</p>
  </div>`;
}

function chargeValueColor(displayPct: number): string {
  const level = Math.max(0, Math.min(1, displayPct / 100));
  const hue = level < 0.7 ? 195 - (143 * level) / 0.7 : 52 - (52 * (level - 0.7)) / 0.3;
  return `hsl(${hue.toFixed(1)}deg 100% 62%)`;
}

// 書道ブラシ素材のセル縦横比（assets/images/hud の生成時に確定）。white PNG を mask に使い、
// background-color=色墨(valueColor) で着色する。和の筆の勢い・かすれ・飛沫を主役にする。
// 地獄変の業火（frame-driven）: 白熱の火先→金泥→橙→丹/朱→臙脂→焦げ→煤。
// 芯(0-12%)を多重正弦(7+11Hz)で明滅、火舌(stop位置)を±3%うねらせて「ごうごう」感を出す。
// 均一グラデの西洋火を避け、煤(ほぼ黒)まで落として朱と黒のせめぎ合いにする（地獄草紙）。
function chargeFlameGradient(): string {
  const t = performance.now() / 1000;
  const flick = clamp01(0.5 + 0.35 * Math.sin(t * 11.3) + 0.15 * Math.sin(t * 6.7 + 1.3));
  const core = mixColor("#ffd24a", "#fff6d0", flick); // 火先の白熱を明滅
  const lick = 3 * Math.sin(t * 1.7); // 火舌の縦うねり ±3%
  return (
    `linear-gradient(178deg,` +
    `#fff3c4 0%,` +
    `${core} ${(12 + lick).toFixed(1)}%,` +
    `#ff7a12 ${(30 + lick * 0.7).toFixed(1)}%,` +
    `#ef3d0c ${(50 + lick * 0.7).toFixed(1)}%,` +
    `#a81208 ${(70 + lick * 0.5).toFixed(1)}%,` +
    `#4d0a06 88%,` +
    `#140805 100%)`
  );
}

// 現在の塗り（色墨 or 業火）。CSP(style-src 'self')でインラインstyleは不可なため、色は
// CSSOM(#charge-hud の --charge-ink)で当てる。mask/寸法は外部CSSのクラスで持つ。
function chargeInk(): string {
  const ready = currentChargeReady();
  const pct = ready > 0 ? (store.chargeRaw / ready) * 100 : 0;
  return pct > 100 ? chargeFlameGradient() : chargeValueColor(Math.min(100, pct));
}

// ラベル（Charge!! / Overload!!）を筆ワードマークで描く。mask/寸法はクラス、色は --charge-ink。
function chargeWordmarkHtml(label: string, over: boolean): string {
  const wm = label === "OVERLOAD" ? "wm-overload" : "wm-charge";
  return `<div class="hakkei-gauge-wordmark ${wm}${over ? " is-flame" : ""}" role="img" aria-label="${label}"></div>`;
}

function chargeDigitSpan(ch: string, cls: string): string {
  const g = ch === "." ? "g-dot" : ch === "%" ? "g-pct" : `g-${ch}`;
  return `<span class="hg-digit ${cls} ${g}"></span>`;
}

// % を筆数字スプライトで描く（等幅セルなので桁が変わってもガタつかない）。整数=大・小数/%=小。
function chargeValueHtml(intPart: string, fracPart: string, over: boolean): string {
  const ints = [...intPart].map((d) => chargeDigitSpan(d, "hg-digit-int")).join("");
  const fracs = [...fracPart].map((d) => chargeDigitSpan(d, "hg-digit-frac")).join("");
  return `<div class="hakkei-gauge-value${over ? " is-flame" : ""}" role="img" aria-label="${intPart}.${fracPart}%">${ints}${chargeDigitSpan(".", "hg-digit-frac")}${fracs}${chargeDigitSpan("%", "hg-digit-frac")}</div>`;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function mixColor(a: string, b: string, t: number): string {
  const aa = Number.parseInt(a.slice(1), 16);
  const bb = Number.parseInt(b.slice(1), 16);
  const ar = (aa >> 16) & 0xff;
  const ag = (aa >> 8) & 0xff;
  const ab = aa & 0xff;
  const br = (bb >> 16) & 0xff;
  const bg = (bb >> 8) & 0xff;
  const bl = bb & 0xff;
  const c = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `#${[c(ar, br), c(ag, bg), c(ab, bl)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function overchargeCrackCount(pct: number): number {
  // 100%超で1本、150%で全8本（100〜150% を演出フル域に割り当て）。50/8=6.25% ごとに1本。
  if (pct <= 100) {
    return 0;
  }
  return Math.min(8, Math.ceil((pct - 100) / 6.25));
}

function overchargeCracksHtml(count: number, impact: boolean): string {
  if (count <= 0) {
    return "";
  }
  const cracks = Array.from(
    { length: count },
    (_, i) => `<span class="hakkei-gauge-crack-image crack-image-${i + 1}"></span>`,
  ).join("");
  return `<div class="hakkei-gauge-cracks${impact ? " is-crack-impact" : ""}" aria-hidden="true">${cracks}</div>`;
}

function chargeMeterHtml(): string {
  const ready = currentChargeReady(); // source 別（keyboard は m スケール）
  const pct = ready > 0 ? (store.chargeRaw / ready) * 100 : 0;
  const fillPct = Math.min(100, pct);
  const enough = store.chargeRaw >= ready;
  const pctLabel = pct.toFixed(1);
  const [pctInt, pctFrac = "0"] = pctLabel.split(".");
  const gaugeLabel = pct > 100 ? "OVERLOAD" : "CHARGE"; // 100%超で限界突破表示へ切替。
  const pctWidth = fillPct.toFixed(1);
  const ariaMax = Math.max(100, Math.ceil(pct));
  const overchargeTier = Math.max(0, Math.min(5, Math.ceil((pct - 100) / 10)));
  const overchargeClass = overchargeTier > 0 ? ` is-overcharge overcharge-tier-${overchargeTier}` : "";
  const overchargeLevel = clamp01((pct - 100) / 50);
  const startColor = mixColor("#7ff4ff", "#ff6d36", overchargeLevel);
  const midColor = mixColor("#ffd479", "#ff2929", overchargeLevel);
  const endColor = mixColor("#ff4938", "#d90016", overchargeLevel);
  const crackCount = overchargeCrackCount(pct);
  const crackImpact = crackCount > lastOverchargeCrackCount;
  if (store.state === "Charge" && crackImpact) {
    playOverchargeCrackSound();
  }
  lastOverchargeCrackCount = crackCount;
  return `<div class="hakkei-gauge ${enough ? "is-ready" : ""}${overchargeClass}">
    <div class="hakkei-gauge-top">
      ${chargeWordmarkHtml(gaugeLabel, pct > 100)}
      ${chargeValueHtml(pctInt, pctFrac, pct > 100)}
    </div>
    <div class="hakkei-gauge-body" role="meter" aria-valuemin="0" aria-valuemax="${ariaMax}" aria-valuenow="${pctLabel}">
      <div class="hakkei-gauge-fill-wrap">
        <svg class="hakkei-gauge-fill-svg" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="hakkei-gauge-gradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="${startColor}"/>
              <stop offset="58%" stop-color="${midColor}"/>
              <stop offset="100%" stop-color="${endColor}"/>
            </linearGradient>
          </defs>
          <rect class="hakkei-gauge-fill-rect" x="0" y="0" width="${pctWidth}" height="1" rx="0.5"></rect>
        </svg>
        <div class="hakkei-gauge-overcharge"></div>
        <div class="hakkei-gauge-sheen"></div>
        ${overchargeCracksHtml(crackCount, crackImpact)}
      </div>
      <img class="hakkei-gauge-frame" src="images/hud/hakkei-gauge-frame-image1-cutout.png" alt="" aria-hidden="true">
    </div>
  </div>`;
}

function chargeMeterDebugHtml(): string {
  const ready = currentChargeReady(); // source 別（keyboard は m スケール）
  const pct = ready > 0 ? (store.chargeRaw / ready) * 100 : 0;
  const enough = store.chargeRaw >= ready;
  return `<table class="status-table">
    <tr><th>タメ</th><td>${store.chargeRaw.toFixed(1)} / ${ready}（${pct.toFixed(0)}%）${enough ? '<span class="okng ok">十分</span>' : ""}</td></tr>
  </table>`;
}

function updateChargeHud(): void {
  const el = document.getElementById("charge-hud");
  if (!el) {
    return;
  }
  el.innerHTML = chargeMeterHtml();
  // 色墨/業火は CSSOM で当てる（CSP でインラインstyle不可。子の筆マスクが background:var(--charge-ink) を継承）。
  el.style.setProperty("--charge-ink", chargeInk());
  if (store.state === "Charge") {
    applyChargeScreenState();
  }
}

// Charge 中だけ: charge量とtierを画面ルート(.screen-Charge)とバナーに反映する。
// これで背景の沈み込み・画面端グロー・バナーの煽り/赤化を、ゲージと1つの色ステートで一斉に動かす。
// #charge-hud のような毎フレーム innerHTML 再構築はせず、変数/クラス/textContent の差分更新に留めて
// ルート側の CSS アニメ（端グローの脈動・バナーのフラッシュ）を途切れさせない。
function applyChargeScreenState(): void {
  const screen = document.querySelector<HTMLElement>(".screen-Charge");
  if (!screen) {
    return;
  }
  const ready = currentChargeReady();
  const pct = ready > 0 ? (store.chargeRaw / ready) * 100 : 0;
  const fill = Math.min(100, pct);
  const tier = Math.max(0, Math.min(5, Math.ceil((pct - 100) / 20)));
  screen.style.setProperty("--charge", (fill / 100).toFixed(3));
  screen.classList.toggle("charge-full", pct >= 100);
  for (let i = 1; i <= 5; i += 1) {
    screen.classList.toggle(`charge-over-${i}`, tier === i);
  }
  const cmd = document.getElementById("charge-command");
  if (cmd) {
    const text =
      pct > 120
        ? "OVERLOAD!!"
        : pct >= 100
          ? "MAX POWER!!"
          : store.inputMode === "keyboard"
            ? "MASH SPACE!"
            : "SWING YOUR ARM!";
    if (cmd.textContent !== text) {
      cmd.textContent = text;
    }
  }
  const prompt = screen.querySelector<HTMLElement>(".game-prompt");
  if (prompt) {
    prompt.classList.toggle("charge-full", pct >= 100);
    prompt.classList.toggle("charge-over", pct > 100);
  }
  // 火焔の縁を毎フレーム揺らす（オーバーチャージ時のみ変位。@keyframes は再構築で効かないため直接駆動）。
  const disp = document.getElementById("hell-disp");
  if (disp) {
    const scale = pct > 100 ? (4 + 1.5 * Math.sin((performance.now() / 1000) * 3)).toFixed(2) : "0";
    disp.setAttribute("scale", scale);
  }
}

function chargeHudHtml(): string {
  return `<div id="charge-hud" class="charge-hud">${chargeMeterHtml()}</div>`;
}

// 火焔の縁（地獄変）: 筆エッジを縦異方の乱流で舐めさせる SVG フィルタ定義（Charge 静的領域に1回置く）。
// scale は applyChargeScreenState が毎フレーム駆動して炎を揺らめかせる（@keyframes は再構築で効かないため）。
function hellFringeSvgHtml(): string {
  return `<svg class="charge-fx-defs" width="0" height="0" aria-hidden="true">
    <filter id="hell-fringe" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.12" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap id="hell-disp" in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </svg>`;
}

function punchDiagHtml(): string {
  const th = currentIntensityThreshold();
  const met = store.strengthPeak >= th;
  return `<table class="status-table hakkei-diag">
    <tr><th>パンチ強さ</th><td><span class="okng ${met ? "ok" : "ng"}">${store.strengthPeak.toFixed(1)}<small>/${th}</small></span> ${met ? "発火" : "（強く突く）"}</td></tr>
  </table>`;
}

function forcedHakkeiModeHtml(): string {
  if (store.forcedHakkeiMode === "none") {
    return "";
  }
  const action = store.state === "HakkeiReady" ? "Enter to force strike" : "Held until strike window";
  return `<div class="game-mode-indicator game-mode-indicator-critical">
    <span>FORCED CRITICAL</span>
    <small>Ctrl to cancel / ${action}</small>
  </div>`;
}

function participantAssistModeHtml(): string {
  if (!store.participantAssistMode) {
    return "";
  }
  return `<div class="game-mode-indicator game-mode-indicator-assist">
    <span>PARTICIPANT ASSIST</span>
    <small>Shift to cancel / 100% at ${cfg().score.punch.participantAssistChargeReadyThreshold.toLocaleString("en-US")}</small>
  </div>`;
}

function gameModeIndicatorsHtml(): string {
  const indicators = `${forcedHakkeiModeHtml()}${participantAssistModeHtml()}`;
  return indicators.length === 0
    ? ""
    : `<div id="game-mode-indicators" class="game-mode-indicators">${indicators}</div>`;
}

// 構え（心の準備）カウントダウン。HakkeiReady 入場〜arm まで。
function hakkeiPrepHtml(): string {
  const prepMs = cfg().app.timers.hakkeiPrepMs;
  const remaining = Math.max(0, prepMs - (performance.now() - hakkeiPrepStartMs));
  return `<div class="prompt-live prompt-live-wait">
    <span>HOLD</span>
    <b>${(remaining / 1000).toFixed(1)}</b>
    <small>s</small>
  </div>
  <p class="prompt-live-note">Strike when the count clears.</p>`;
}

// --- 画面テンプレート ----------------------------------------------------

function safetyBlock(): string {
  return `<ul class="safety">${SAFETY_LINES.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}

function diagSlot(): string {
  return `<div id="diag" class="diag"></div>`;
}

function gamePromptHtml(args: {
  tone: "ready" | "charge" | "hakkei";
  command: string;
  timerHtml?: string;
}): string {
  const commandId =
    args.tone === "hakkei" ? ' id="hakkei-command"' : args.tone === "charge" ? ' id="charge-command"' : "";
  return `<div class="game-prompt game-prompt-${args.tone}">
    <div class="game-prompt-command"${commandId}>${args.command}</div>
    ${args.timerHtml ? `<div class="game-prompt-timer">${args.timerHtml}</div>` : ""}
  </div>`;
}

function devMenuHtml(): string {
  if (!isDebugMode()) {
    return "";
  }
  if (!store.devOpen) {
    return `<button class="dev-link dev-open" data-action="dev-toggle">動画確認・発勁Lv強制（Lv0〜Lv5）</button>`;
  }
  const levelButtons = cfg()
    .score.videoLevels.map((v) => `<button data-dev-level="${v.level}">Lv${v.level}で通常フロー</button>`)
    .join("");
  const forced =
    store.forcedDebugLevel === null
      ? ""
      : `<p class="dev-note">強制Lv予約中: Lv${store.forcedDebugLevel}（通常フロー完走後に反映）</p>`;
  return `
    <div class="dev-menu">
      <p class="dev-title">Debug / Dev menu（通常プレイ経路ではありません）</p>
      ${forced}
      <div class="dev-row"><span>動画レベル強制:</span>${levelButtons}</div>
      <div class="dev-row">
        <button data-action="dev-result-fixture">Result Fixture</button>
        <button data-action="dev-video-missing">動画欠落テスト（VIDEO_MISSING）</button>
        <button data-event="fail">テストエラー表示</button>
      </div>
      <button class="dev-link" data-action="dev-toggle">動画確認メニューを閉じる</button>
    </div>`;
}

// Title のタイトルロゴ（UBI-Lab Break Simulator・透過PNG）。
function titleLogoHtml(): string {
  return `<img class="title-logo" src="images/title/logo.png" alt="UBI-Lab Break Simulator" draggable="false">`;
}

// Titleのシネマティックメニュー。矢印/クリックで選択。
// リピーターは START GAME の QR 再スキャン（スマホ license の playerId）で既存プロフィールを継続する。
type TitleMenuItem = { action: string; label: string };

function titleMenuItems(): TitleMenuItem[] {
  const items: TitleMenuItem[] = [];
  items.push({ action: "start-register", label: "START GAME" });
  items.push({ action: "ranking-board", label: "LEADERBOARD" });
  items.push({ action: "quit-game", label: "QUIT GAME" });
  return items;
}

function titleMenuHtml(): string {
  const items = titleMenuItems().map((item, i) => {
    const selected = i === store.titleMenuIndex ? " selected" : "";
    return `<button class="ac-menu-item${selected}" data-action="${item.action}" data-title-index="${i}"><span>${item.label}</span></button>`;
  }).join("");
  return `<nav class="ac-menu" aria-label="Main menu">${items}</nav>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createRegisterSessionId(): string {
  const suffix =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `hakkei-${Date.now().toString(36)}-${suffix}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

function registerJoinUrl(): string | null {
  if (isDemoQrMode()) {
    return "https://example.invalid/hakkei-demo";
  }
  if (!store.registerSessionId) {
    return null;
  }
  return `${remoteHttpBaseUrl()}/join?sessionId=${encodeURIComponent(store.registerSessionId)}`;
}

function remoteEntryTimingSummary(entry: RemoteSessionEntry): string {
  const value = (key: keyof RemoteSessionEntry): string => {
    const raw = entry[key];
    return typeof raw === "number" && Number.isFinite(raw) ? String(Math.round(raw)) : "-";
  };
  return `registered=${value("registeredAtMs")} input=${value("inputCheckAtMs")} inputExit=${value("inputCheckExitAtMs")} deviceReady=${value("inputDeviceReadyAtMs")} ready=${value("readyAtMs")} cancel=${value("cancelAtMs")} play=${value("playStartedAtMs")} result=${value("resultAtMs")} resultExit=${value("resultExitAtMs")}`;
}

function isRemoteSessionEntry(value: unknown): value is RemoteSessionEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<RemoteSessionEntry>;
  return (
    typeof entry.sessionId === "string" &&
    typeof entry.playerId === "string" &&
    typeof entry.playerName === "string" &&
    typeof entry.registeredAtMs === "number" &&
    (entry.readyAtMs === undefined || entry.readyAtMs === null || typeof entry.readyAtMs === "number") &&
    (entry.cancelAtMs === undefined || entry.cancelAtMs === null || typeof entry.cancelAtMs === "number") &&
    (entry.inputCheckAtMs === undefined || entry.inputCheckAtMs === null || typeof entry.inputCheckAtMs === "number") &&
    (entry.inputCheckExitAtMs === undefined || entry.inputCheckExitAtMs === null || typeof entry.inputCheckExitAtMs === "number") &&
    (entry.inputDeviceReadyAtMs === undefined || entry.inputDeviceReadyAtMs === null || typeof entry.inputDeviceReadyAtMs === "number") &&
    (entry.playStartedAtMs === undefined || entry.playStartedAtMs === null || typeof entry.playStartedAtMs === "number") &&
    (entry.resultAtMs === undefined || entry.resultAtMs === null || typeof entry.resultAtMs === "number") &&
    (entry.resultExitAtMs === undefined || entry.resultExitAtMs === null || typeof entry.resultExitAtMs === "number") &&
    REMOTE_NICKNAME_PATTERN.test(entry.playerName)
  );
}

async function fetchRegisterEntry(sessionId: string): Promise<RemoteSessionEntry | null> {
  const response = await requestRemoteApi({
    method: "GET",
    path: "/api/session-entry",
    query: { sessionId },
  });
  if (response.status === 404) {
    stateLog("REMOTE", `fetch entry ${shortSessionId(sessionId)} -> 404`);
    return null;
  }
  if (!response.ok) {
    stateLog("REMOTE", `fetch entry ${shortSessionId(sessionId)} -> ${response.status}`);
    throw new Error(`Registration server returned ${response.status}.`);
  }
  const payload = response.body;
  if (!isRemoteSessionEntry(payload)) {
    stateLog("REMOTE", `fetch entry ${shortSessionId(sessionId)} -> invalid payload`);
    throw new Error("Registration server returned an invalid entry.");
  }
  stateLog("REMOTE", `fetch entry ${shortSessionId(sessionId)} -> ok ${remoteEntryTimingSummary(payload)}`);
  return payload;
}

async function pollRegisterEntryOnce(): Promise<void> {
  if (!isRemoteMode()) {
    stopRegisterPolling();
    return;
  }
  const sessionId = store.registerSessionId;
  const pollingRegistration = store.state === "Title" && store.titlePanel === "register";
  const pollingPhoneReady = store.state === "InputCheck";
  if (!sessionId || (!pollingRegistration && !pollingPhoneReady)) {
    stopRegisterPolling();
    return;
  }
  if (pollingRegistration && sessionId === autoAdvancedRegisterSessionId) {
    stopRegisterPolling();
    return;
  }
  if (registerPollInFlight) {
    return;
  }
  registerPollInFlight = true;
  try {
    const entry = await fetchRegisterEntry(sessionId);
    if (store.registerSessionId !== sessionId) {
      return;
    }
    if (entry === null) {
      if (pollingRegistration) {
        store.registerPollStatus = "waiting";
        store.registerPollMessage = "Waiting for phone registration...";
        syncRegisterRemoteStatus();
      }
      return;
    }
    if (pollingPhoneReady && !remoteEntryMatchesCurrentPlayer(entry)) {
      stateLog(
        "REMOTE",
        `ignored entry for different player ${shortSessionId(sessionId)}`,
      );
      return;
    }
    const cancelAtMs = typeof entry.cancelAtMs === "number" && Number.isFinite(entry.cancelAtMs) ? entry.cancelAtMs : null;
    const playStartedAtMs = typeof entry.playStartedAtMs === "number" && Number.isFinite(entry.playStartedAtMs) ? entry.playStartedAtMs : null;
    if (pollingPhoneReady && playStartedAtMs === null && cancelAtMs !== null && cancelAtMs > entry.registeredAtMs) {
      stateLog("REMOTE", `cancel detected ${shortSessionId(sessionId)} cancel=${cancelAtMs} registered=${entry.registeredAtMs}`);
      handlePhoneReadyCancel(sessionId, cancelAtMs);
      return;
    }
    if (typeof entry.readyAtMs === "number" && Number.isFinite(entry.readyAtMs)) {
      store.registerReadyAtMs = entry.readyAtMs;
    }
    if (pollingPhoneReady) {
      maybeAdvanceFromPhoneReady();
      return;
    }
    if (store.state !== "Title" || store.titlePanel !== "register" || sessionId === autoAdvancedRegisterSessionId) {
      return;
    }
    store.registerPollStatus = "registered";
    store.registerPollMessage = `Registered as ${entry.playerName}.`;
    store.registerNickname = entry.playerName;
    stateLog("REMOTE", `entry registered ${shortSessionId(sessionId)}`);
    submitRemoteRegisterEntry(entry, sessionId);
  } catch (error) {
    store.registerPollStatus = "error";
    store.registerPollMessage = error instanceof Error ? error.message : "Registration check failed.";
    syncRegisterRemoteStatus();
  } finally {
    registerPollInFlight = false;
  }
}

async function pollPhoneResultExitOnce(): Promise<void> {
  const sessionId = store.registerSessionId;
  if (
    store.state !== "Result" ||
    !sessionId ||
    sessionId !== autoAdvancedRegisterSessionId ||
    store.registerResultNotifiedSessionId !== sessionId
  ) {
    return;
  }
  try {
    const entry = await fetchRegisterEntry(sessionId);
    if (store.state !== "Result" || store.registerSessionId !== sessionId || entry === null) {
      return;
    }
    const resultAtMs = typeof entry.resultAtMs === "number" && Number.isFinite(entry.resultAtMs) ? entry.resultAtMs : null;
    const exitAtMs = typeof entry.resultExitAtMs === "number" && Number.isFinite(entry.resultExitAtMs) ? entry.resultExitAtMs : null;
    if (
      resultAtMs !== null &&
      exitAtMs !== null &&
      exitAtMs >= resultAtMs &&
      store.registerResultExitHandledAtMs !== exitAtMs
    ) {
      store.registerResultExitHandledAtMs = exitAtMs;
      stateLog("REMOTE", `phone result exit -> Title (${shortSessionId(sessionId)})`);
      dispatch("finish");
    }
  } catch (error) {
    stateLog("REMOTE", `result exit poll failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyRemoteSessionEntry(entry: RemoteSessionEntry, source: "snapshot" | "event"): void {
  const sessionId = store.registerSessionId;
  if (!sessionId || entry.sessionId !== sessionId) {
    return;
  }
  const pollingRegistration = store.state === "Title" && store.titlePanel === "register";
  if (!pollingRegistration && !remoteEntryMatchesCurrentPlayer(entry)) {
    stateLog(
      "REMOTE",
      `ignored ws ${source} for different player ${shortSessionId(sessionId)}`,
    );
    return;
  }
  stateLog("REMOTE", `ws ${source} ${shortSessionId(sessionId)} ${remoteEntryTimingSummary(entry)}`);
  if (pollingRegistration && sessionId !== autoAdvancedRegisterSessionId) {
    submitRemoteRegisterEntry(entry, sessionId);
    return;
  }

  const cancelAtMs = typeof entry.cancelAtMs === "number" && Number.isFinite(entry.cancelAtMs) ? entry.cancelAtMs : null;
  const playStartedAtMs = typeof entry.playStartedAtMs === "number" && Number.isFinite(entry.playStartedAtMs) ? entry.playStartedAtMs : null;
  if (store.state === "InputCheck" && playStartedAtMs === null && cancelAtMs !== null && cancelAtMs > entry.registeredAtMs) {
    handlePhoneReadyCancel(sessionId, cancelAtMs);
    return;
  }

  if (typeof entry.readyAtMs === "number" && Number.isFinite(entry.readyAtMs)) {
    store.registerReadyAtMs = entry.readyAtMs;
    maybeAdvanceFromPhoneReady();
  }

  const resultAtMs = typeof entry.resultAtMs === "number" && Number.isFinite(entry.resultAtMs) ? entry.resultAtMs : null;
  const exitAtMs = typeof entry.resultExitAtMs === "number" && Number.isFinite(entry.resultExitAtMs) ? entry.resultExitAtMs : null;
  if (
    store.state === "Result" &&
    sessionId === autoAdvancedRegisterSessionId &&
    resultAtMs !== null &&
    exitAtMs !== null &&
    exitAtMs >= resultAtMs &&
    store.registerResultExitHandledAtMs !== exitAtMs
  ) {
    store.registerResultExitHandledAtMs = exitAtMs;
    stateLog("REMOTE", `ws phone result exit -> Title (${shortSessionId(sessionId)})`);
    dispatch("finish");
  }
}

function onRemoteSessionEvent(event: RemoteSessionEvent): void {
  if (event.type === "server.error") {
    stateLog("REMOTE", `ws server error ${shortSessionId(event.sessionId)}: ${event.message ?? "unknown"}`);
    return;
  }
  if (event.entry) {
    applyRemoteSessionEntry(event.entry, event.type === "session.snapshot" ? "snapshot" : "event");
    return;
  }
  if (event.type === "phone.ready" && event.sessionId === store.registerSessionId) {
    store.registerReadyAtMs = event.sentAtMs;
    maybeAdvanceFromPhoneReady();
  }
}

function onRemoteSessionStatus(status: RemoteSessionStatusPayload): void {
  stateLog(
    "REMOTE",
    `ws status=${status.state} session=${shortSessionId(status.sessionId)} retry=${status.retryCount} error=${status.lastError ?? "-"}`,
  );
  if (status.state === "fallback" && store.state === "InputCheck") {
    startRegisterPolling();
  }
}

function startRegisterPolling(): void {
  const shouldPoll = (store.state === "Title" && store.titlePanel === "register") || store.state === "InputCheck";
  if (registerPollTimer !== null || !shouldPoll) {
    return;
  }
  registerPollTimer = setInterval(() => {
    void pollRegisterEntryOnce();
  }, REGISTER_POLL_INTERVAL_MS);
  void pollRegisterEntryOnce();
}

function syncRegisterRemoteStatus(): void {
  const status = document.querySelector<HTMLElement>("#register-remote-status");
  if (!status) {
    return;
  }
  status.textContent = store.registerPollMessage;
  status.dataset.status = store.registerPollStatus;
}

function renderRegisterQr(): void {
  if (!isRemoteMode() && !isDemoQrMode()) {
    stopRegisterPolling();
    return;
  }
  if (store.state !== "Title" || store.titlePanel !== "register") {
    stopRegisterPolling();
    return;
  }
  const joinUrl = registerJoinUrl();
  const canvas = document.querySelector<HTMLCanvasElement>("#register-qr-canvas");
  if (!joinUrl || !canvas) {
    return;
  }
  if (lastRenderedQrUrl === joinUrl && lastRenderedQrCanvas === canvas) {
    startRegisterPolling();
    return;
  }
  lastRenderedQrUrl = joinUrl;
  lastRenderedQrCanvas = canvas;
  void QRCode.toCanvas(canvas, joinUrl, {
    margin: 1,
    width: 282,
    color: {
      dark: "#050910",
      light: "#f8fbff",
    },
  }).then(
    () => {
      if (isRemoteMode()) {
        startRegisterPolling();
      }
    },
    () => {
      if (lastRenderedQrCanvas === canvas) {
        lastRenderedQrUrl = null;
        lastRenderedQrCanvas = null;
      }
      store.registerPollStatus = "error";
      store.registerPollMessage = "Could not render QR code.";
      syncRegisterRemoteStatus();
    },
  );
}

function registerSuggestionsHtml(query: string): string {
  if (store.registerSuggestionsDismissed) {
    return "";
  }
  const suggestions = registeredNicknameSuggestions(loadRankingBoard(rankingStorage()), query, 8);
  if (suggestions.length === 0) {
    return "";
  }
  const items = suggestions.map((player) => {
    const idLabel = playerNumberLabel(player);
    return `
    <button
      class="register-suggestion"
      type="button"
      data-register-suggestion="${escapeHtml(player.nickname)}"
    >
      <span>${idLabel ? `<small class="player-id">${escapeHtml(idLabel)}</small>` : ""}${escapeHtml(player.nickname.toUpperCase())}</span>
      <small>${formatHighScoreYen(player.highScore, player.highScoreCriticalBonusYen, false)}</small>
    </button>`;
  }).join("");
  return `
    <div class="register-suggestions" id="register-suggestions" role="listbox" aria-label="Registered name suggestions">
      ${items}
    </div>`;
}

function registerDuplicateHtml(): string {
  const dup = store.registerDuplicate;
  if (!dup) {
    return "";
  }
  const name = escapeHtml(dup.nickname.toUpperCase());
  const idLabel = playerNumberLabel(dup);
  const played = dup.lastPlayedAtMs === null ? "-" : relativeTimeAgo(dup.lastPlayedAtMs, Date.now());
  return `
    <div class="register-duplicate" role="alertdialog" aria-label="Name already registered">
      <p class="register-duplicate-title">"${name}" ${idLabel ? `(${escapeHtml(idLabel)}) ` : ""}is already registered.</p>
      <p class="register-duplicate-detail">High Score ${formatHighScoreYen(dup.highScore, dup.highScoreCriticalBonusYen)} / Last Played ${escapeHtml(played)}</p>
      <p class="register-duplicate-ask">Is this you?</p>
      <div class="register-duplicate-actions">
        <button class="ic-proceed-btn" data-register-confirm type="button"><span>Yes, that's me</span></button>
        <button class="register-duplicate-reject" data-register-reject type="button"><span>No, use another name</span></button>
      </div>
    </div>`;
}

function registerScreenHtml(): string {
  const invalid = store.registerError !== null ? " is-invalid" : "";
  const value = escapeHtml(store.registerNickname);
  const suggestions = registerSuggestionsHtml(store.registerNickname);
  const joinUrl = registerJoinUrl() ?? "";
  const registrationAside = isDemoQrMode()
    ? `<section class="register-qr register-qr-demo" aria-label="Demo QR recording mode">
        <h3>DEMO QR — RECORDING ONLY</h3>
        <div class="qr-placeholder">
          <canvas id="register-qr-canvas" width="256" height="256" aria-label="Inactive demo QR code"></canvas>
        </div>
        <p class="register-qr-url">${escapeHtml(joinUrl)}</p>
        <p id="register-remote-status" class="register-remote-status" data-status="registered">
          ${escapeHtml(store.registerPollMessage)}
        </p>
      </section>`
    : !isRemoteMode()
      ? `<section class="register-qr" aria-label="Local mode">
        <h3>OFFLINE REGISTRATION</h3>
        <p class="register-remote-status" data-status="registered">Enter your name with the keyboard. Player information and scores saved on this PC will be used.</p>
      </section>`
    : `<section class="register-qr" aria-label="Phone registration">
        <h3>SCAN HERE</h3>
        <div class="qr-placeholder">
          <canvas id="register-qr-canvas" width="256" height="256" aria-label="Registration QR code"></canvas>
        </div>
        <p class="register-qr-url">${escapeHtml(joinUrl)}</p>
        <p id="register-remote-status" class="register-remote-status" data-status="${store.registerPollStatus}">
          ${escapeHtml(store.registerPollMessage)}
        </p>
      </section>`;
  const formBody = store.registerDuplicate
    ? registerDuplicateHtml()
    : `
        <div class="register-suggestions-host" id="register-suggestions-host">${suggestions}</div>
        <p id="register-hint" class="register-hint">1-16 characters: A-Z, 0-9, spaces, . _ or -</p>
        ${store.registerError ? `<p class="register-error">${escapeHtml(store.registerError)}</p>` : ""}
        <button class="ic-proceed-btn register-submit" type="submit"><span>JOIN GAME</span></button>`;
  return `
    <div class="register-screen">
      <div class="register-topbar">
        <h2 class="register-title">REGISTRATION</h2>
      </div>
      ${registrationAside}
      <form class="register-form" id="register-form">
        <div class="register-divider"><span>${isRemoteMode() || isDemoQrMode() ? "OR ENTER YOUR NAME" : "ENTER YOUR NAME"}</span></div>
        <label class="register-field">
          <input
            class="${invalid}"
            id="register-nickname"
            name="nickname"
            type="text"
            inputmode="latin"
            autocomplete="nickname"
            placeholder="PLAYER1"
            value="${value}"
            maxlength="16"
            pattern="[A-Z0-9._ -]{1,16}"
            aria-describedby="register-hint"
            aria-controls="register-suggestions"
          />
        </label>
        ${formBody}
      </form>
    </div>`;
}

function normalizeRegisterNicknameInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9._ -]/g, "").slice(0, 16);
}

function formatHighScoreYen(highScore: number, bonusYen?: string, withBonus = true): string {
  const base = `¥ ${highScore.toLocaleString("en-US")}`;
  if (!withBonus || bonusYen === undefined || bonusYen === "0" || !/^[0-9]+$/.test(bonusYen)) {
    return base;
  }
  return `${base} <span class="score-critical-bonus">(+ ${formatBigIntYen(BigInt(bonusYen))})</span>`;
}

function playerNumberLabel(player: PlayerProfile): string {
  const n = player.playerNumber;
  return typeof n === "number" && Number.isInteger(n) && n >= 26001 && n <= 26999 ? `ID${n}` : "";
}

function isPublicPlayerSuggestionsPayload(
  value: unknown,
): value is PublicPlayerSuggestionsPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Partial<PublicPlayerSuggestionsPayload>;
  return (
    Array.isArray(payload.players) &&
    payload.players.every((player) =>
      typeof player === "object" &&
      player !== null &&
      validateNickname(player.nickname) &&
      Number.isInteger(player.playerNumber) &&
      player.playerNumber >= 26001 &&
      player.playerNumber <= 26999 &&
      Number.isFinite(player.registeredAtMs) &&
      player.registeredAtMs >= 0 &&
      (
        player.lastPlayedAtMs === null ||
        (Number.isFinite(player.lastPlayedAtMs) && player.lastPlayedAtMs >= 0)
      ) &&
      Number.isFinite(player.highScore) &&
      player.highScore >= 0 &&
      Number.isInteger(player.playCount) &&
      player.playCount >= 0
    )
  );
}

function isPublicRankingBoard(value: unknown): value is PublicRankingBoard {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const board = value as Partial<PublicRankingBoard>;
  return (
    board.schemaVersion === 1 &&
    (
      board.submittedPlayerNumber === undefined ||
      (
        Number.isInteger(board.submittedPlayerNumber) &&
        board.submittedPlayerNumber >= 26001 &&
        board.submittedPlayerNumber <= 26999
      )
    ) &&
    Array.isArray(board.players) &&
    board.players.every((player) =>
      typeof player === "object" &&
      player !== null &&
      validateNickname(player.nickname) &&
      Number.isInteger(player.playerNumber) &&
      player.playerNumber >= 26001 &&
      player.playerNumber <= 26999 &&
      Number.isFinite(player.registeredAtMs) &&
      player.registeredAtMs >= 0 &&
      (
        player.lastPlayedAtMs === null ||
        (Number.isFinite(player.lastPlayedAtMs) && player.lastPlayedAtMs >= 0)
      ) &&
      Number.isFinite(player.highScore) &&
      player.highScore >= 0 &&
      typeof player.highScoreCriticalBonusYen === "string" &&
      /^[0-9]+$/.test(player.highScoreCriticalBonusYen) &&
      Number.isInteger(player.playCount) &&
      player.playCount >= 0
    )
  );
}

function publicRankingBoardAsLocal(value: unknown): RankingBoardData | null {
  if (!isPublicRankingBoard(value)) {
    return null;
  }
  const localPlayers = loadRankingBoard(rankingStorage()).players;
  return {
    schemaVersion: 1,
    players: value.players.map((player) => {
      const current =
        (
          store.currentPlayer?.playerNumber === player.playerNumber ||
          value.submittedPlayerNumber === player.playerNumber
        )
          ? store.currentPlayer
          : null;
      const known =
        current ??
        localPlayers.find(
          (candidate) =>
            candidate.playerNumber === player.playerNumber &&
            !candidate.playerId.startsWith("public-"),
        ) ??
        localPlayers.find((candidate) => candidate.playerNumber === player.playerNumber);
      return {
        playerId: known?.playerId ?? `public-${player.playerNumber}`,
        nickname: player.nickname,
        playerNumber: player.playerNumber,
        registeredAtMs: player.registeredAtMs,
        lastPlayedAtMs: player.lastPlayedAtMs,
        highScore: Math.round(player.highScore),
        highScoreCriticalBonusYen: player.highScoreCriticalBonusYen,
        playCount: player.playCount,
      };
    }),
    records: [],
  };
}

async function fetchServerRankingBoard(): Promise<void> {
  if (!isRemoteMode()) {
    store.serverRankingBoard = loadRankingBoard(rankingStorage());
    store.serverRankingStatus = "ready";
    store.serverRankingMessage = "Local ranking loaded.";
    render();
    return;
  }
  store.serverRankingStatus = "loading";
  store.serverRankingMessage = "Loading server ranking...";
  render();
  try {
    const response = await requestRemoteApi({ method: "GET", path: "/api/ranking-board" });
    if (!response.ok) {
      throw new Error(`Ranking server returned ${response.status}.`);
    }
    const payload = publicRankingBoardAsLocal(response.body);
    if (payload === null) {
      throw new Error("Ranking server returned an invalid board.");
    }
    store.serverRankingBoard = payload;
    importServerRankingPlayers(rankingStorage(), payload);
    store.serverRankingStatus = "ready";
    store.serverRankingMessage = "Server ranking loaded.";
    render();
  } catch (error) {
    store.serverRankingBoard = null;
    store.serverRankingStatus = "error";
    store.serverRankingMessage = error instanceof Error ? error.message : "Ranking sync failed.";
    render();
  }
}

async function postScoreToServer(saved: SavedScoreResult): Promise<boolean> {
  if (!isRemoteMode()) {
    store.serverRankingBoard = saved.board;
    store.serverRankingStatus = "ready";
    store.serverRankingMessage = "Saved on this PC.";
    return true;
  }
  const sessionId = store.registerSessionId;
  if (!sessionId) {
    store.serverRankingStatus = "error";
    store.serverRankingMessage = "The score session is not available.";
    return false;
  }
  const payload = {
    player: saved.player,
    record: saved.record,
  };
  try {
    const response = await requestRemoteApi({
      method: "POST",
      path: "/api/ranking-score",
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`Ranking server returned ${response.status}.`);
    }
    const board = publicRankingBoardAsLocal(response.body);
    if (board !== null) {
      store.serverRankingBoard = board;
      store.serverRankingStatus = "ready";
      store.serverRankingMessage = "Server ranking synced.";
      const localBoard = importServerRankingPlayers(rankingStorage(), board);
      const syncedCurrent = localBoard.players.find(
        (player) => player.playerId === saved.player.playerId,
      );
      if (
        syncedCurrent !== undefined &&
        store.currentPlayer?.playerId === saved.player.playerId
      ) {
        store.currentPlayer = syncedCurrent;
      }
      return true;
    }
    throw new Error("Ranking server returned an invalid board.");
  } catch (error) {
    store.serverRankingStatus = "error";
    store.serverRankingMessage = error instanceof Error ? error.message : "Ranking sync failed.";
    stateLog("REMOTE", `ranking sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function rankingBoardHtml(): string {
  const nowMs = Date.now();
  const board = store.serverRankingBoard;
  if (store.serverRankingStatus === "loading") {
    return `
      <div class="ranking-board">
        <div class="ranking-board-head">
          <h2>Leaderboard</h2>
          <button class="ranking-back" data-action="ranking-back">BACK</button>
        </div>
        <p class="ranking-empty">Loading server ranking...</p>
      </div>`;
  }
  if (!board) {
    return `
      <div class="ranking-board">
        <div class="ranking-board-head">
          <h2>Leaderboard</h2>
          <button class="ranking-back" data-action="ranking-back">BACK</button>
        </div>
        <p class="ranking-empty">${escapeHtml(store.serverRankingMessage || "Server ranking is not loaded.")}</p>
      </div>`;
  }
  const rows = rankingRows(board);
  const body = rows.length
    ? rows.map((player, index) => {
      const lastPlayed = player.lastPlayedAtMs === null ? "-" : relativeTimeAgo(player.lastPlayedAtMs, nowMs);
      const idLabel = playerNumberLabel(player) || "-";
      const name = escapeHtml(player.nickname.toUpperCase());
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(idLabel)}</td>
        <td>${name}</td>
        <td>${formatHighScoreYen(player.highScore, player.highScoreCriticalBonusYen)}</td>
        <td>${relativeTimeAgo(player.registeredAtMs, nowMs)}</td>
        <td>${escapeHtml(lastPlayed)}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="6" class="ranking-empty">No scores recorded yet.</td></tr>`;
  return `
    <div class="ranking-board">
      <div class="ranking-board-head">
        <h2>Leaderboard</h2>
        <button class="ranking-back" data-action="ranking-back">BACK</button>
      </div>
      <table class="ranking-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>ID</th>
            <th>Nickname</th>
            <th>High Score</th>
            <th>Registered</th>
            <th>Last Played</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <p class="ranking-note">${isRemoteMode() ? "Server ranking." : "Local ranking (this PC)."} Current player: ${escapeHtml((store.currentPlayer?.nickname ?? DEFAULT_NICKNAME).toUpperCase())}</p>
    </div>`;
}

// 右下の極小コマンドヒント（入力設定は S キーで起動する）。
function titleCommandHintHtml(): string {
  return "";
}

// 入力設定オーバーレイ（S キーで開閉）。
function titleSettingsOverlayHtml(): string {
  if (!store.settingsOpen) {
    return "";
  }
  return `<div class="title-settings-overlay">
    <div class="title-settings-card">
      <div class="title-settings-title">INPUT SETTINGS<span>choose input</span></div>
      ${modeSelectHtml(false)}
      <p class="hint">Press S / Esc to close</p>
    </div>
  </div>`;
}

function modeSelectHtml(includeNone: boolean, keyboardLabelOverride?: string): string {
  const keyboardLabel = keyboardLabelOverride ?? (isDebugMode() ? "Keyboard（debug）" : "キーボード入力");
  return `
    <div class="mode-select" role="radiogroup" aria-label="Input mode">
      <button class="mode ${store.inputMode === "mocopi-ble" ? "selected" : ""}" data-mode="mocopi-ble">mocopi BLE</button>
      <button class="mode ${store.inputMode === "keyboard" ? "selected" : ""}" data-mode="keyboard">${keyboardLabel}</button>
      ${includeNone ? `<button class="mode ${store.inputMode === "none" ? "selected" : ""}" data-mode="none">None</button>` : ""}
    </div>`;
}

function submitRegisterNickname(nicknameInput: string): void {
  const nickname = normalizeRegisterNicknameInput(nicknameInput);
  store.registerNickname = nickname;
  store.registerSuggestionsDismissed = true;
  if (!validateNickname(nickname)) {
    store.registerError = "Use 1-16 characters: A-Z, 0-9, ., _ or -.";
    render();
    return;
  }
  // 既に同名が登録済みなら、いきなり乗っ取らず「あなたですか？」と確認する。
  const existing = findPlayerByNickname(loadRankingBoard(rankingStorage()), nickname);
  if (existing) {
    store.registerDuplicate = existing;
    store.registerError = null;
    render();
    return;
  }
  const player = getOrCreatePlayerProfile(rankingStorage(), nickname, Date.now());
  if (player === null) {
    store.registerError = "Could not register this name.";
    render();
    return;
  }
  beginPlayAsPlayer(player);
}

// 登録済み確認: 「はい、私です」→ その既存プレイヤーとしてそのままプレイ開始。
function confirmRegisterDuplicate(): void {
  const existing = store.registerDuplicate;
  if (!existing) {
    return;
  }
  store.registerDuplicate = null;
  beginPlayAsPlayer(existing);
}

// 登録済み確認: 「いいえ、別の名前にする」→ 入力をクリアして別名を促す。
function rejectRegisterDuplicate(): void {
  store.registerDuplicate = null;
  store.registerNickname = "";
  store.registerSuggestionsDismissed = false;
  store.registerError = "Please enter a different name.";
  render();
  const input = document.querySelector<HTMLInputElement>("#register-nickname");
  if (input) {
    input.value = "";
    input.focus();
  }
}

// 確定したプレイヤー（登録 or 同名確認）でプレイを開始する。戻る先に REGISTRATION を積む（名前修正のため）。
function beginPlayAsPlayer(player: PlayerProfile): void {
  store.currentPlayer = player;
  store.registerError = null;
  store.registerDuplicate = null;
  store.registerPollStatus = "registered";
  store.registerPollMessage = `Registered as ${player.nickname}.`;
  stopRegisterPolling();
  store.registerReadyAtMs = null;
  pushRegisterBackTarget();
  store.titlePanel = "menu";
  dispatch("start");
}

function submitRemoteRegisterEntry(entry: RemoteSessionEntry, expectedSessionId: string): void {
  if (
    store.state !== "Title" ||
    store.titlePanel !== "register" ||
    store.registerSessionId !== expectedSessionId ||
    entry.sessionId !== expectedSessionId ||
    expectedSessionId === autoAdvancedRegisterSessionId
  ) {
    return;
  }
  const nickname = normalizeRegisterNicknameInput(entry.playerName);
  const player = getOrCreateRemotePlayerProfile(
    rankingStorage(),
    entry.playerId,
    nickname,
    Date.now(),
    entry.playerNumber,
  );
  if (player === null) {
    store.registerError = "Could not register this phone license.";
    store.registerPollStatus = "error";
    store.registerPollMessage = store.registerError;
    render();
    return;
  }
  store.currentPlayer = player;
  store.registerNickname = player.nickname;
  store.registerError = null;
  store.registerPollStatus = "registered";
  store.registerPollMessage = `Registered as ${player.nickname}.`;
  store.registerReadyAtMs = typeof entry.readyAtMs === "number" && Number.isFinite(entry.readyAtMs) ? entry.readyAtMs : null;
  autoAdvancedRegisterSessionId = expectedSessionId;
  pushRegisterBackTarget();
  store.titlePanel = "menu";
  dispatch("start");
  startRegisterPolling();
}

function updateRegisterSuggestions(root: HTMLElement, query: string): void {
  const host = root.querySelector<HTMLElement>("#register-suggestions-host");
  if (!host) {
    return;
  }
  host.innerHTML = registerSuggestionsHtml(query);
  host.querySelectorAll<HTMLButtonElement>("[data-register-suggestion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nickname = btn.dataset.registerSuggestion ?? "";
      const input = root.querySelector<HTMLInputElement>("#register-nickname");
      store.registerNickname = nickname;
      store.registerError = null;
      store.registerSuggestionsDismissed = true;
      if (input) {
        input.value = nickname;
        input.focus();
      }
      host.innerHTML = "";
    });
  });
}

function ensureResultSaved(): SavedScoreResult | null {
  if (!store.breakdown) {
    return null;
  }
  if (lastSavedBreakdown === store.breakdown && latestSavedScore !== null) {
    return latestSavedScore;
  }
  latestSavedScore = store.currentPlayer
    ? recordScoreForPlayer(rankingStorage(), store.currentPlayer, store.breakdown, Date.now())
    : recordScoreForDefaultPlayer(rankingStorage(), store.breakdown, Date.now());
  store.currentPlayer = latestSavedScore.player;
  lastSavedBreakdown = store.breakdown;
  return latestSavedScore;
}

function syncResultRanking(saved: SavedScoreResult): Promise<boolean> {
  if (lastPostedScore === saved && store.serverRankingStatus === "ready") {
    return Promise.resolve(true);
  }
  if (resultScorePostInFlight !== null) {
    return resultScorePostInFlight;
  }
  resultRankingBeforeBoard = store.serverRankingStatus === "ready" ? store.serverRankingBoard : null;
  resultRankingBeforeScore = saved;
  store.serverRankingStatus = "loading";
  store.serverRankingMessage = "Syncing current score with server ranking...";
  resultScorePostInFlight = postScoreToServer(saved)
    .then((ok) => {
      if (ok) {
        lastPostedScore = saved;
      }
      if (ok && store.state === "Result") {
        render();
      }
      return ok;
    })
    .finally(() => {
      resultScorePostInFlight = null;
    });
  return resultScorePostInFlight;
}

function preSyncResultRanking(): void {
  const saved = ensureResultSaved();
  if (saved !== null) {
    void syncResultRanking(saved);
  }
}

function maybeNotifyPhoneResult(saved: SavedScoreResult | null): void {
  if (saved === null || lastPhoneNotifiedScore === saved) {
    return;
  }
  lastPhoneNotifiedScore = saved;
  void notifyPhoneResult(saved);
}

function resultHighScoreNoticeHtml(saved: SavedScoreResult | null): string {
  if (saved === null || !saved.isHighScore) {
    return "";
  }
  return `
    <div class="result-highscore-label" aria-live="polite">NEW HIGH SCORE</div>`;
}

function rankText(rank: number | null): string {
  return rank === null ? "--" : `#${rank}`;
}

function rankingPositionRank(rank: number | null): Rank | null {
  if (rank === null) {
    return null;
  }
  if (rank <= 3) {
    return "S";
  }
  if (rank <= 9) {
    return "A";
  }
  if (rank <= 15) {
    return "B";
  }
  if (rank <= 20) {
    return "C";
  }
  if (rank <= 25) {
    return "D";
  }
  return "E";
}

function rankingPositionClass(rank: number | null): string {
  const positionRank = rankingPositionRank(rank);
  if (positionRank === null) {
    return "";
  }
  const podiumClass = rank !== null && rank <= 3 ? ` rank-top-${rank}` : "";
  return ` rank-${positionRank}${podiumClass}`;
}

function resultRankingSummaryHtml(saved: SavedScoreResult | null): string {
  if (saved === null) {
    return "";
  }
  if (store.serverRankingStatus === "error") {
    return `
      <section class="result-ranking-summary" aria-live="polite">
        <h3>PERSONAL BEST RESULT</h3>
        <p class="result-ranking-summary-message">LEADERBOARD UNAVAILABLE</p>
      </section>`;
  }
  const board = store.serverRankingBoard;
  if (store.serverRankingStatus === "loading" || board === null) {
    return `
      <section class="result-ranking-summary" aria-live="polite">
        <h3>PERSONAL BEST RESULT</h3>
        <p class="result-ranking-summary-message">LEADERBOARD SYNCING...</p>
      </section>`;
  }
  const currentRank = rankingPositionFor(board, saved.player);
  const currentPlayer = rankingPlayerFor(board, saved.player) ?? saved.player;
  const beforeBoard = resultRankingBeforeScore === saved ? resultRankingBeforeBoard : null;
  const previousRank = saved.previousHighScore > 0
    ? rankingPositionFor(beforeBoard, saved.player)
    : null;

  if (saved.isHighScore) {
    const movedUp = previousRank !== null && currentRank !== null && currentRank < previousRank;
    return `
      <section class="result-ranking-summary result-ranking-summary-highscore" aria-live="polite">
        <h3>RANK UPDATE</h3>
        <div class="result-ranking-change">
          <div class="result-ranking-node result-ranking-previous">
            <span>PREVIOUS</span>
            <strong class="${rankingPositionClass(previousRank)}">${rankText(previousRank)}</strong>
          </div>
          <div class="result-ranking-arrow" aria-hidden="true">→</div>
          <div class="result-ranking-node result-ranking-current">
            <span>CURRENT</span>
            <strong class="${rankingPositionClass(currentRank)}">${rankText(currentRank)}${movedUp ? ` <em>↑</em>` : ""}</strong>
          </div>
        </div>
      </section>`;
  }

  return `
    <section class="result-ranking-summary" aria-live="polite">
      <h3>PERSONAL BEST RESULT</h3>
      <div class="result-ranking-best">
        <div class="result-ranking-best-row">
          <span>BEST DAMAGE</span>
          <strong>${formatHighScoreYen(currentPlayer.highScore, currentPlayer.highScoreCriticalBonusYen, false)}</strong>
        </div>
        <div class="result-ranking-best-row">
          <span>RANK</span>
          <strong class="result-ranking-position${rankingPositionClass(currentRank)}">${rankText(currentRank)}</strong>
        </div>
      </div>
    </section>`;
}

function screenHtml(state: AppState): string {
  switch (state) {
    case "Title":
      if (store.titlePanel === "register") {
        return `
          <div class="title-screen title-screen-register">
            ${registerScreenHtml()}
          </div>
          ${titleCommandHintHtml()}
          ${titleSettingsOverlayHtml()}`;
      }
      if (store.titlePanel === "ranking") {
        return `
          <div class="title-screen title-screen-ranking">
            ${titleLogoHtml()}
            ${rankingBoardHtml()}
          </div>
          ${titleCommandHintHtml()}
          ${titleSettingsOverlayHtml()}`;
      }
      if (!isDebugMode()) {
        return `
          <div class="title-screen">
            ${titleLogoHtml()}
            ${titleMenuHtml()}
            ${safetyBlock()}
          </div>
          ${titleCommandHintHtml()}
          ${titleSettingsOverlayHtml()}`;
      }
      return `
        <div class="title-screen title-screen-debug">
          ${titleLogoHtml()}
          ${titleMenuHtml()}
          ${modeSelectHtml(true)}
          ${safetyBlock()}
          ${devMenuHtml()}
        </div>
        ${titleCommandHintHtml()}
        ${titleSettingsOverlayHtml()}`;

    case "InputCheck": {
      const isKeyboard = store.inputMode === "keyboard";
      const isNone = store.inputMode === "none";
      // 本番: mocopi 接続状況のヒーロー表示（詳細テーブルなし）。接続で「進む」UI が出る。
      if (!isDebugMode() && !isNone) {
        return `
          <div class="inputcheck-screen">
            <div class="ic-status-host">${inputCheckHeroHtml()}</div>
            <div id="inputcheck-proceed" class="inputcheck-proceed${inputCheckReady() ? " is-visible" : ""}">
              <button id="inputcheck-proceed-button" class="ic-proceed-btn" data-event="inputOk" ${inputCheckReady() ? `aria-disabled="false"` : `disabled aria-disabled="true"`}>
                <span>PROCEED</span><small>Enter the lab ▶</small>
              </button>
              <p class="inputcheck-phone-ready">You can also tap READY on your phone.</p>
            </div>
          </div>
          ${inputCheckHintHtml()}`;
      }
      // debug / none: 従来の詳細診断レイアウト（開発・計測用）。
      const hint = isNone
        ? "入力モードが未選択です。Title で選んでください。"
        : isKeyboard
          ? "Space=チャージ / Enter=パンチ（debug）。キーを押すと診断が動きます。"
          : "mocopi BLE の受信状態を確認します。OK になったら進めます。";
      const advance = isNone
        ? ""
        : `<button class="primary" data-event="inputOk">入力OK（Readyへ）</button>`;
      // BLE 制御・計測ボタンは #diag(高頻度更新で破棄される) ではなくここ（render で1回だけ配線）に置く。
      const bleControls = store.inputMode === "mocopi-ble" && isDebugMode() ? bleControlsHtml() : "";
      return `
        <h2>InputCheck</h2>
        <p class="hint">${hint}</p>
        ${diagSlot()}
        ${bleControls}
        <div class="actions">
          ${advance}
          <button data-action="switch-keyboard">Keyboardに切替（debug fallback）</button>
          <button data-event="back">Titleへ戻る</button>
        </div>`;
    }

    case "Ready":
      return `
        ${gamePromptHtml({
          tone: "ready",
          command: "READY YOUR STANCE",
          timerHtml: `<span id="ready-count">3s</span>`,
        })}
        ${gameModeIndicatorsHtml()}
        ${chargeHudHtml()}
        ${isDebugMode() ? `<div class="actions">
          <button data-event="countdownEnd">今すぐ開始</button>
        </div>` : ""}`;

    case "Charge": {
      const tip =
        store.inputMode === "keyboard"
          ? "MASH SPACE!"
          : "SWING YOUR ARM!";
      return `
        ${hellFringeSvgHtml()}
        ${gamePromptHtml({
          tone: "charge",
          command: tip,
          timerHtml: `<span id="phase-timer">${(cfg().app.timers.chargeMs / 1000).toFixed(1)}s</span>`,
        })}
        ${gameModeIndicatorsHtml()}
        ${chargeHudHtml()}
        ${isDebugMode() ? diagSlot() : ""}
        ${isDebugMode() ? `<div class="actions"><button data-event="chargeDone">スキップ</button></div>` : ""}`;
    }

    case "HakkeiReady": {
      const tip = hakkeiArmed ? hakkeiActionCommand() : "HOLD STANCE";
      const timerMs = hakkeiArmed ? cfg().app.timers.hakkeiReadyTimeoutMs : cfg().app.timers.hakkeiPrepMs;
      return `
        ${gamePromptHtml({
          tone: "hakkei",
          command: tip,
          timerHtml: `<span id="hakkei-timer">${(timerMs / 1000).toFixed(1)}s</span>`,
        })}
        ${gameModeIndicatorsHtml()}
        ${chargeHudHtml()}
        ${isDebugMode() ? diagSlot() : ""}
        ${isDebugMode() ? `<div class="actions">
          <button data-action="force-timeout">タイムアウト（no-impact）</button>
        </div>` : ""}`;
    }

    case "ImpactDelay":
      return `
        <div class="impact">…</div>
        ${isDebugMode() ? `<p class="hint">発勁演出（短時間）。まもなく動画へ。</p>` : ""}
        ${chargeHudHtml()}`;

    case "VideoPlayback": {
      return `
        <div id="video-host" class="video-host video-background-host" aria-label="Destruction video"></div>
        ${isDebugMode() ? `<div class="video-debug-controls"><button data-event="videoEnd">スキップ（Resultへ）</button></div>` : ""}`;
    }

    case "Result": {
      const savedScore = ensureResultSaved();
      if (savedScore !== null) {
        void syncResultRanking(savedScore);
        maybeNotifyPhoneResult(savedScore);
      }
      return `
        <div id="result-video-host" class="result-background-host" aria-hidden="true"></div>
        <h2>Result</h2>
        ${resultHtml(
          store.breakdown,
          isDebugMode(),
          store.selectedCriticalOutcome,
          cfg().score.resultDamageReport,
          resultHighScoreNoticeHtml(savedScore),
        )}
        ${resultRankingSummaryHtml(savedScore)}
        ${resultMenuHtml()}`;
    }

    case "Error":
      return `
        <h2 class="error-title">Error</h2>
        <p class="error-msg">${store.lastError ?? "Test error (display check)"}</p>
        <div class="actions">
          <button class="primary" data-event="recover">BACK TO TITLE</button>
          <button data-event="recheck">RE-CHECK INPUT</button>
        </div>`;
  }
}

// --- 描画と配線 ----------------------------------------------------------

function debugStatebarKeyHint(): string {
  return store.state === "InputCheck" ? `Esc=${backTargetLabel()} / R=InputCheck` : "Esc=Title / R=InputCheck";
}

function render(): void {
  const enteredResult = store.state === "Result" && lastRenderedState !== "Result";
  clearTimers();
  store.lastError = store.state === "Error" ? (store.lastError ?? "Test error (display check)") : null;

  const appEl = document.getElementById("app");
  if (!appEl) {
    return;
  }

  // Result 画面へ入った瞬間だけ初期カーソルを Exit に戻す（どの遷移経路でも確実に）。
  if (store.state === "Result" && lastRenderedState !== "Result") {
    store.resultMenuIndex = RESULT_MENU_DEFAULT_INDEX;
  }
  lastRenderedState = store.state;

  const statebar = isDebugMode()
    ? `<div class="statebar">状態: <strong>${store.state}</strong> &nbsp; <span class="keys">${debugStatebarKeyHint()}</span></div>`
    : "";
  appEl.innerHTML = `
    <main class="screen screen-${store.state}">
      ${statebar}
      <section class="content">${screenHtml(store.state)}</section>
    </main>`;

  wire(appEl);
  renderRegisterQr();
  updateDiagnostics();
  startStateTimers();
  if (store.state === "Result") {
    if (enteredResult) {
      startResultDamageCount();
    } else {
      syncResultDamageFinalText();
    }
  }
  if (enteredResult) {
    clearResultSfxTimers();
    void startResultVoiceSfx();
  }
}

function startResultDamageCount(): void {
  if (store.state !== "Result") {
    return;
  }
  const el = document.getElementById("result-damage-count");
  if (el === null) {
    return;
  }
  const finalDamageYen = Number(el.dataset.finalDamageYen);
  if (!Number.isFinite(finalDamageYen) || finalDamageYen < 0) {
    setResultDamageText(el, "¥ 0");
    return;
  }
  const finalDamageRaw = el.dataset.finalDamageRaw ?? String(Math.round(finalDamageYen));
  const finalDamageBigInt = /^[0-9]+$/.test(finalDamageRaw) ? BigInt(finalDamageRaw) : null;
  if (finalDamageBigInt === null) {
    setResultDamageText(el, `¥ ${el.dataset.finalDamageText ?? "0"}`);
    return;
  }
  if (formatBigIntYen(finalDamageBigInt).length >= 24) {
    el.classList.add("result-focus-damage-long");
  }

  const durationMs = 1180;
  const startMs = performance.now();
  const step = (nowMs: number): void => {
    const t = Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
    const eased = 1 - Math.pow(1 - t, 3);
    const currentYen = (finalDamageBigInt * BigInt(Math.round(eased * 10000))) / 10000n;
    setResultDamageText(el, `¥ ${formatBigIntYen(currentYen)}`);
    if (t < 1) {
      resultDamageAnimation = requestAnimationFrame(step);
      return;
    }
    setResultDamageText(el, `¥ ${formatBigIntYen(finalDamageBigInt)}`);
    resultDamageAnimation = null;
  };

  setResultDamageText(el, "¥ 0");
  resultDamageAnimation = requestAnimationFrame(step);
}

function syncResultDamageFinalText(): void {
  const el = document.getElementById("result-damage-count");
  if (el === null) {
    return;
  }
  setResultDamageText(el, `¥ ${el.dataset.finalDamageText ?? "0"}`);
}

function setResultDamageText(root: HTMLElement, text: string): void {
  const plainText = root.querySelector<HTMLElement>(".result-damage-text");
  if (plainText !== null) {
    plainText.textContent = text;
    return;
  }
  root.textContent = text;
}

function wire(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-event]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const event = btn.dataset.event as AppEvent;
      if (event === "inputOk" && store.state === "InputCheck") {
        tryAdvanceFromInputCheck("button");
        return;
      }
      dispatch(event);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.inputMode = btn.dataset.mode as RendererInputMode;
      render();
    });
  });

  const actions: Record<string, () => void> = {
    "switch-keyboard": switchToKeyboard,
    "switch-mocopi": switchToMocopi,
    "force-timeout": handleTimeout,
    "ble-restart": () => void api.controlBleSidecar({ action: "restart" }),
    "ble-replay": () => void api.controlBleSidecar({ action: "start-replay" }),
    "ble-stop": () => void api.controlBleSidecar({ action: "stop" }),
    "wiz-begin": () => startWizard(),
    "wiz-go": () => wizGoto("still"),
    "wiz-redo": () => {
      // このステップの runtime を捨ててやり直す（同ステージに再入）。
      wizGoto(wizStage);
    },
    "wiz-skip": () => {
      const order: WizStage[] = ["still", "punch", "charge", "chargePunch", "slow", "done"];
      const i = order.indexOf(wizStage);
      wizGoto(order[Math.min(order.length - 1, i + 1)]);
    },
    "wiz-abort": () => {
      wizActive = false;
      render();
    },
    "wiz-save": () => {
      if (wizResult) {
        const pp = (wizResult.punch as { n?: number })?.n ?? 0;
        downloadJson(`wizard-${pp}p-${wizSets.length}set.json`, wizResult);
      }
    },
    "wiz-restart": () => startWizard(),
    "wiz-exit": () => {
      wizActive = false;
      render();
    },
    "measure-start": () => {
      measuring = true;
      measureSession = "(未設定)";
      measureLabel = "rest";
      measureT0 = null;
      measureBuf.length = 0;
      measureMarks.length = 0;
      render();
    },
    "measure-stop": () => {
      measuring = false;
      render();
    },
    "measure-reset": () => {
      measureBuf.length = 0;
      measureMarks.length = 0;
      measureLabel = "rest";
      measureT0 = null;
      render();
    },
    "measure-export": () => {
      const av = measureBuf.map((s) => s.intensity).sort((a, b) => a - b);
      const mo = measureBuf.map((s) => s.motionAmount).sort((a, b) => a - b);
      const punches = detectMeasurePunches(measureBuf);
      const durMs = measureBuf.length ? measureBuf[measureBuf.length - 1].t : 0;
      downloadJson(`measure-${measureSession}-${(durMs / 1000).toFixed(0)}s-${punches.length}p.json`, {
        note: "BLE 角速度の連続時系列（50Hz）。t=開始相対ms, idleMs=Main生成の連続idle時間, intensity=角速度deg/s（seq差dt・バースト修正済）, chargeDelta=回転deg, motionAmount=回転deg/frame, label。markers=各ラベル押下時刻。summary=in-UI解析。計算式設計用。",
        sessionType: measureSession,
        sampleRateHz: 50,
        intensityThresholdBle: cfg().score.punch.intensityThresholdBle,
        chargeNoiseFloor: cfg().score.punch.chargeNoiseFloor,
        durationMs: durMs,
        summary: {
          angVelP50: pctAsc(av, 50),
          angVelP95: pctAsc(av, 95),
          angVelP99: pctAsc(av, 99),
          angVelMax: av.length ? av[av.length - 1] : 0,
          motionAmountP99: pctAsc(mo, 99),
          totalRotationDeg: measureBuf.reduce((a, s) => a + s.chargeDelta, 0),
          punchPeaks: punches.map((p) => Math.round(p.peak)),
        },
        markers: measureMarks,
        samples: measureBuf,
      });
    },
    "settings-toggle": () => {
      if (store.settingsOpen) {
        if (navigateBack()) {
          return;
        }
        store.settingsOpen = false;
      } else {
        pushNavigationHistory();
        store.settingsOpen = true;
      }
      render();
    },
    "inputcheck-back": () => {
      if (!navigateBack()) {
        dispatch("back");
      }
    },
    "start-register": openRegisterPanel,
    "ranking-board": () => {
      pushNavigationHistory();
      store.titlePanel = "ranking";
      void fetchServerRankingBoard();
      render();
    },
    "ranking-back": () => {
      if (!navigateBack()) {
        closeTitleSubPanel();
      }
    },
    "quit-game": () => void api.quitApp(),
    "dev-toggle": () => {
      store.devOpen = !store.devOpen;
      render();
    },
    "dev-result-fixture": () => {
      store.breakdown = makeLevelFixture(3);
      devGoto("Result");
    },
    "dev-video-missing": () => {
      store.breakdown = makeLevelFixture(0);
      store.forcedVideoFile = "__missing_video__.mp4";
      devGoto("VideoPlayback");
    },
  };
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
    const fn = actions[btn.dataset.action ?? ""];
    if (fn) {
      btn.addEventListener("click", fn);
    }
  });

  const registerForm = root.querySelector<HTMLFormElement>("#register-form");
  registerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>("#register-nickname");
    submitRegisterNickname(input?.value ?? "");
  });

  root.querySelector<HTMLButtonElement>("[data-register-confirm]")?.addEventListener("click", () => {
    confirmRegisterDuplicate();
  });
  root.querySelector<HTMLButtonElement>("[data-register-reject]")?.addEventListener("click", () => {
    rejectRegisterDuplicate();
  });

  const registerInput = root.querySelector<HTMLInputElement>("#register-nickname");
  updateRegisterSuggestions(root, registerInput?.value ?? "");
  registerInput?.addEventListener("input", () => {
    const normalized = normalizeRegisterNicknameInput(registerInput.value);
    if (registerInput.value !== normalized) {
      registerInput.value = normalized;
    }
    store.registerNickname = normalized;
    store.registerSuggestionsDismissed = false;
    if (store.registerError !== null && validateNickname(normalized)) {
      store.registerError = null;
    }
    updateRegisterSuggestions(root, normalized);
  });

  // セッション種別プリセット（S1-S5）。押下＝記録リセット＋種別に応じた既定ラベル。
  const sessionDefaultLabel: Record<string, string> = {
    still: "rest",
    "punch-burst": "strong",
    "charge-hold": "charge",
    "charge-punch-set": "charge",
    slow: "slow",
  };
  root.querySelectorAll<HTMLButtonElement>("[data-session]").forEach((btn) => {
    btn.addEventListener("click", () => {
      measureSession = btn.dataset.session ?? "(未設定)";
      measureLabel = sessionDefaultLabel[measureSession] ?? "rest";
      measureT0 = null;
      measureBuf.length = 0;
      measureMarks.length = 0;
      render();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-measure]").forEach((btn) => {
    btn.addEventListener("click", () => {
      measureLabel = btn.dataset.measure ?? "rest";
      // 押下時刻を相対 ms で marker に残す（連続ストリーム上の区間境界）。
      if (measuring) {
        const tNow =
          measureT0 !== null && lastPunchInput ? lastPunchInput.timestampMs - measureT0 : 0;
        measureMarks.push({ t: tNow, label: measureLabel });
      }
      updateDiagnostics();
    });
  });

  // Titleメニュー: ホバーで選択位置を同期する（キーボード選択と見た目を一致）。
  root.querySelectorAll<HTMLButtonElement>("[data-title-index]").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      const i = Number(btn.dataset.titleIndex);
      if (Number.isFinite(i) && i !== store.titleMenuIndex) {
        store.titleMenuIndex = i;
        syncTitleMenuSelection();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-result-index]").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      const i = Number(btn.dataset.resultIndex);
      if (Number.isFinite(i)) {
        syncResultMenuSelection(i);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-dev-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const level = Number(btn.dataset.devLevel) as VideoLevel;
      store.forcedDebugLevel = level;
      store.breakdown = null;
      store.forcedVideoFile = null;
      dispatch("start");
    });
  });
}

// dev: 指定 level の代表 breakdown（通常スコア計算は経由しない）。
function makeLevelFixture(level: VideoLevel): ScoreBreakdown {
  const score = cfg().score;
  const v = score.videoLevels.find((x) => x.level === level) ?? score.videoLevels[0];
  const power = v.minPower;
  const damageYen = damageYenFromPower(power, score.power);
  return {
    rightChargeScore: 0,
    leftChargeScore: 0,
    hakkeiScore: 0,
    hakkeiDetected: level > 0,
    hakkeiTimedOut: level === 0,
    power,
    baseDamageYen: damageYen,
    damageYen,
    rank: selectRank(power, score),
    videoLevel: level,
    raw: {
      rightChargeRaw: 0,
      leftChargeRaw: 0,
      hakkeiVelocityPeak: 0,
      hakkeiAccelerationPeak: 0,
      hakkeiDisplacement: 0,
    },
  };
}

function makeCriticalFixture(): ScoreBreakdown {
  const score = cfg().score;
  const critical = store.selectedCriticalOutcome;
  const sThreshold = score.rankThresholds.find((item) => item.rank === "S")?.minPower ?? 600000;
  const level5Power = score.videoLevels.find((item) => item.level === 5)?.minPower ?? sThreshold;
  const punchRaw = score.punch.punchMax;
  const baseBreakdown = buildPunchScoreBreakdown(
    {
      chargeRaw: store.chargeRaw,
      punchStrengthRaw: punchRaw,
      punchDetected: true,
      punchTimedOut: false,
    },
    score,
    currentChargeReady(),
  );
  const power = Math.max(baseBreakdown.power, sThreshold, level5Power);
  const baseDamageYen = damageYenFromPower(power, score.power);
  const criticalBonusYen = damageItemsBonusBigInt(critical?.damageItems ?? []);
  const totalDamageYen = BigInt(baseDamageYen) + criticalBonusYen;
  return {
    rightChargeScore: 100,
    leftChargeScore: 0,
    hakkeiScore: 100,
    hakkeiDetected: true,
    hakkeiTimedOut: false,
    power,
    baseDamageYen,
    damageYen: safeNumberFromBigInt(totalDamageYen),
    damageYenText: totalDamageYen.toString(),
    rank: "S",
    videoLevel: 5,
    raw: {
      rightChargeRaw: currentChargeReady(),
      leftChargeRaw: 0,
      hakkeiVelocityPeak: punchRaw,
      hakkeiAccelerationPeak: punchRaw,
      hakkeiDisplacement: punchRaw,
    },
  };
}

function selectCriticalOutcome(): CriticalOutcomeConfig | null {
  const critical = cfg().critical;
  if (!critical.enabled) {
    return null;
  }
  const totalWeight = critical.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (totalWeight <= 0) {
    return critical.outcomes.find((outcome) => outcome.id === critical.defaultOutcomeId)
      ?? critical.outcomes[0]
      ?? null;
  }
  let cursor = Math.random() * totalWeight;
  for (const outcome of critical.outcomes) {
    cursor -= outcome.weight;
    if (cursor <= 0) {
      return outcome;
    }
  }
  return critical.outcomes[critical.outcomes.length - 1] ?? null;
}

function maybeApplyCritical(): void {
  const critical = cfg().critical;
  if (!critical.enabled || !store.breakdown || store.breakdown.rank !== "S") {
    return;
  }
  if (store.breakdown.hakkeiTimedOut || !store.breakdown.hakkeiDetected) {
    return;
  }
  const score = cfg().score;
  const sThreshold = score.rankThresholds.find((item) => item.rank === "S")?.minPower ?? 0;
  const rate = criticalRateForPower(store.breakdown.power, {
    sThreshold,
    maxPower: score.punch.powerK,
    baseRate: critical.baseRateOnSRank,
    maxRate: critical.maxRateOnSRank,
    gamma: critical.rateGamma,
  });
  if (Math.random() >= rate) {
    return;
  }
  const outcome = selectCriticalOutcome();
  if (outcome === null) {
    return;
  }
  store.criticalActive = true;
  store.selectedCriticalOutcome = outcome;
  const criticalBonusYen = damageItemsBonusBigInt(outcome.damageItems);
  const totalDamageYen = BigInt(store.breakdown.baseDamageYen) + criticalBonusYen;
  store.breakdown = {
    ...store.breakdown,
    damageYen: safeNumberFromBigInt(totalDamageYen),
    damageYenText: totalDamageYen.toString(),
  };
}

function damageItemsBonusBigInt(items: Array<{ bonusDamageYen: number | string }>): bigint {
  return items.reduce((sum, item) => sum + BigInt(item.bonusDamageYen), 0n);
}

function safeNumberFromBigInt(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  return value > maxSafe ? Number.MAX_SAFE_INTEGER : Number(value);
}

function updateCountdownText(elId: string, totalMs: number, startedAt: number): void {
  const remaining = Math.max(0, totalMs - (performance.now() - startedAt));
  const el = document.getElementById(elId);
  if (el) {
    el.textContent =
      elId === "ready-count" ? `${Math.ceil(remaining / 1000)}s` : `${(remaining / 1000).toFixed(1)}s`;
  }
}

function hakkeiActionCommand(): string {
  return store.inputMode === "keyboard" ? "PRESS ENTER!" : "STRIKE FORWARD!";
}

function updateHakkeiPrompt(): void {
  const commandEl = document.getElementById("hakkei-command");
  if (commandEl) {
    commandEl.textContent = hakkeiArmed ? hakkeiActionCommand() : "HOLD STANCE";
  }
  updateGameModeIndicators();
}

function updateGameModeIndicators(): void {
  const existing = document.getElementById("game-mode-indicators");
  const visibleStates: AppState[] = ["Ready", "Charge", "HakkeiReady"];
  const html = visibleStates.includes(store.state) ? gameModeIndicatorsHtml() : "";
  if (html.length === 0) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.outerHTML = html;
    return;
  }
  const prompt = document.querySelector(".game-prompt");
  prompt?.insertAdjacentHTML("afterend", html);
}

function startCountdown(elId: string, totalMs: number, onDone: () => void): void {
  const startedAt = performance.now();
  activeInterval = setInterval(() => {
    const remaining = Math.max(0, totalMs - (performance.now() - startedAt));
    updateCountdownText(elId, totalMs, startedAt);
    if (remaining <= 0) {
      onDone();
    }
  }, 100);
}

function videoFilesForPlayback(): string[] {
  if (store.forcedVideoFile !== null) {
    return [store.forcedVideoFile];
  }
  if (store.selectedCriticalOutcome !== null) {
    const labVideoFile =
      store.selectedCriticalOutcome.labVideoFile
      ?? randomVideoFileForLevel(store.breakdown?.videoLevel ?? 5);
    return labVideoFile === store.selectedCriticalOutcome.videoFile
      ? [labVideoFile]
      : [labVideoFile, store.selectedCriticalOutcome.videoFile];
  }
  const level = store.breakdown?.videoLevel ?? 0;
  const levelFiles = videoFilesForLevel(level, cfg().score);
  if (levelFiles.length === 0) {
    return [];
  }
  return [levelFiles[Math.floor(Math.random() * levelFiles.length)] ?? levelFiles[0]];
}

function currentVideoFileForPlayback(): string {
  if (store.currentPlaybackFile === null) {
    const [first] = videoFilesForPlayback();
    store.currentPlaybackFile = first ?? videoFileForLevel(0, cfg().score);
  }
  return store.currentPlaybackFile;
}

function randomVideoFileForLevel(level: VideoLevel): string {
  const files = videoFilesForLevel(level, cfg().score);
  if (files.length === 0) {
    return videoFileForLevel(0, cfg().score);
  }
  return files[Math.floor(Math.random() * files.length)] ?? files[0];
}

function configuredVideoFiles(): string[] {
  const files = new Set<string>();
  for (const level of cfg().score.videoLevels) {
    for (const file of videoFilesForLevel(level.level, cfg().score)) {
      files.add(file);
    }
  }
  for (const outcome of Object.values(cfg().score.outcomes)) {
    if (outcome?.video.kind === "fixed") {
      files.add(outcome.video.file);
    }
  }
  for (const outcome of cfg().critical.outcomes) {
    if (outcome.labVideoFile !== undefined) {
      files.add(outcome.labVideoFile);
    }
    files.add(outcome.videoFile);
  }
  return [...files];
}

function ensureVideoPreloaded(file: string): PreparedVideo {
  const cached = preparedVideos.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const prepared = preloadVideo(file);
  preparedVideos.set(file, prepared);
  return prepared;
}

function preloadConfiguredVideos(): void {
  for (const file of configuredVideoFiles()) {
    ensureVideoPreloaded(file);
  }
}

function startBgm(): void {
  if (!cfg().app.audio.bgm.autoplay) {
    return;
  }
  playMainBgm();
}

function bgmCallbacks(label: string): { onMissing: (file: string) => void; onBlocked: (file: string, reason: string) => void } {
  return {
    onMissing: (file) => {
      console.warn(`[audio] AUDIO_MISSING(${label}): ${file}`);
      stateLog("AUDIO", `missing(${label}): ${file}`);
    },
    onBlocked: (file, reason) => {
      console.warn(`[audio] BGM autoplay blocked(${label}): ${file}: ${reason}`);
      stateLog("AUDIO", `blocked(${label}): ${file}: ${reason}`);
    },
  };
}

function playMainBgm(): void {
  if (activeBgm === "main") {
    return;
  }
  stateLog("AUDIO", `bgm: ${activeBgm ?? "none"} -> main`);
  criticalBgmHandle?.stop();
  criticalBgmHandle = null;
  if (mainBgmHandle === null) {
    mainBgmHandle = createBgm(cfg().app.audio.bgm, bgmCallbacks("main"));
  }
  activeBgm = "main";
  void mainBgmHandle.play();
}

function playCriticalBgm(): void {
  if (activeBgm === "critical") {
    return;
  }
  stateLog("AUDIO", `bgm: ${activeBgm ?? "none"} -> critical`);
  mainBgmHandle?.stop();
  mainBgmHandle = null;
  if (criticalBgmHandle === null) {
    criticalBgmHandle = createBgm(
      { ...cfg().app.audio.criticalBgm, autoplay: true },
      bgmCallbacks("critical"),
    );
  }
  activeBgm = "critical";
  void criticalBgmHandle.play();
}

function playChargeSound(): void {
  if (chargeSoundMode === "normal" && chargeSoundHandle !== null) {
    return;
  }
  stopChargeSound();
  chargeSoundHandle = createBgm(
    { ...cfg().app.audio.chargeSound, autoplay: true, maxVolume: 10 },
    bgmCallbacks("charge"),
  );
  chargeSoundMode = "normal";
  void chargeSoundHandle.play();
}

function playOverchargeSound(): void {
  if (chargeSoundMode === "over" && chargeSoundHandle !== null) {
    return;
  }
  stopChargeSound();
  chargeSoundHandle = createBgm(
    { ...cfg().app.audio.overchargeSound, autoplay: true, maxVolume: 10 },
    bgmCallbacks("overcharge"),
  );
  chargeSoundMode = "over";
  void chargeSoundHandle.play();
}

function playOverchargeCrackSound(): void {
  const file = OVERCHARGE_CRACK_SOUNDS[Math.floor(Math.random() * OVERCHARGE_CRACK_SOUNDS.length)];
  playOneShotAudio(
    {
      file,
      volume: cfg().app.audio.chargeSound.volume,
      maxVolume: 10,
    },
    bgmCallbacks("overcharge-crack"),
  );
}

function playCriticalTransitionSound(): void {
  playOneShotAudio(
    {
      file: cfg().app.audio.transitionSound.file,
      volume: cfg().app.audio.transitionSound.volume,
      maxVolume: 10,
    },
    bgmCallbacks("critical-transition"),
  );
}

function playCriticalVideoStartSound(): void {
  playOneShotAudio(
    {
      file: cfg().app.audio.criticalVideoStartSound.file,
      volume: cfg().app.audio.criticalVideoStartSound.volume,
      maxVolume: 10,
    },
    bgmCallbacks("critical-video-start"),
  );
}

// 段階切替の合図画像を音声終了の PHASE_CUE_HIDE_AFTER_MS 後に消す。
const PHASE_CUE_HIDE_AFTER_MS = 500;
let phaseCueOverlayEl: HTMLDivElement | null = null;

function safeCueImagePath(file: string): string | null {
  if (file.length === 0 || file.includes("\\") || file.startsWith("/")) {
    return null;
  }
  if (file.split("/").some((seg) => seg.length === 0 || seg === "." || seg === "..")) {
    return null;
  }
  return /\.(png|jpe?g|webp)$/i.test(file) ? file : null;
}

function removeCurrentPhaseCueImage(): void {
  if (phaseCueOverlayEl !== null) {
    phaseCueOverlayEl.remove();
    phaseCueOverlayEl = null;
  }
}

// 合図画像を画面中央に大きく出す（登場アニメは CSS の .is-in）。
// crimson=trueでオーバーチャージ合図のオーラを紅蓮色にする。
function showPhaseCueImage(imageFile: string, crimson: boolean): void {
  removeCurrentPhaseCueImage();
  const safe = safeCueImagePath(imageFile);
  if (safe === null) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "phase-cue-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const img = document.createElement("img");
  img.className = crimson ? "phase-cue-image is-overload" : "phase-cue-image";
  img.src = `images/${safe}`;
  img.alt = "";
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  void overlay.offsetWidth; // reflow してから is-in を付けて登場アニメを確実に走らせる。
  overlay.classList.add("is-in");
  phaseCueOverlayEl = overlay;
}

// 退場アニメ（.is-out）を出してから DOM を除去。
function hidePhaseCueImage(): void {
  const overlay = phaseCueOverlayEl;
  if (overlay === null) {
    return;
  }
  phaseCueOverlayEl = null;
  overlay.classList.remove("is-in");
  overlay.classList.add("is-out");
  window.setTimeout(() => overlay.remove(), 360);
}

// 段階切替（チャージ/構え/パンチ）の効果音を1回鳴らし、合図画像を音声終了0.5s後に消す。
function playPhaseCue(cue: { file: string; volume: number; image: string }, label: string, crimson = false): void {
  showPhaseCueImage(cue.image, crimson);
  const overlay = phaseCueOverlayEl;
  const base = bgmCallbacks(label);
  // この合図の画像が今も表示中のときだけ消す（後続キューに差し替わっていたら触らない）。
  const scheduleHide = (): void => {
    window.setTimeout(() => {
      if (phaseCueOverlayEl === overlay) {
        hidePhaseCueImage();
      }
    }, PHASE_CUE_HIDE_AFTER_MS);
  };
  playOneShotAudio(
    { file: cue.file, volume: cue.volume, maxVolume: 10, onEnded: scheduleHide },
    {
      onMissing: (f) => {
        base.onMissing(f);
        scheduleHide();
      },
      onBlocked: (f, r) => {
        base.onBlocked(f, r);
        scheduleHide();
      },
    },
  );
}

function leadSecToMs(leadSec: number): number {
  return Math.round(Math.max(0, Math.min(1, leadSec)) * 1000);
}

// 構えボイスを1回だけ鳴らす（この時点のチャージ量で 100%以上かを確定し、パンチにも流用）。
function playStanceCueNow(): void {
  if (stanceCuePlayed) {
    return;
  }
  stanceCuePlayed = true;
  const ready = currentChargeReady();
  hakkeiWasOvercharged = ready > 0 && store.chargeRaw / ready >= 1;
  const cue = hakkeiWasOvercharged
    ? cfg().app.audio.phaseCues.stanceOvercharge
    : cfg().app.audio.phaseCues.stance;
  playPhaseCue(cue, "cue-stance", hakkeiWasOvercharged);
}

// パンチボイスを1回だけ鳴らす（構え時に確定した 100%判定を流用）。
function playPunchCueNow(): void {
  if (punchCuePlayed) {
    return;
  }
  punchCuePlayed = true;
  const cue = hakkeiWasOvercharged
    ? cfg().app.audio.phaseCues.punchOvercharge
    : cfg().app.audio.phaseCues.punch;
  playPhaseCue(cue, "cue-punch", hakkeiWasOvercharged);
}

async function loadResultSfxManifest(): Promise<ResultSfxManifest | null> {
  if (resultSfxManifest !== null) {
    return resultSfxManifest;
  }
  if (resultSfxManifestLoading !== null) {
    return resultSfxManifestLoading;
  }
  resultSfxManifestLoading = fetch("sounds/result-sfx-manifest.json", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) {
        stateLog("AUDIO", `missing(result-sfx-manifest): HTTP ${res.status}`);
        return null;
      }
      const json: unknown = await res.json();
      if (!isResultSfxManifest(json)) {
        stateLog("AUDIO", "invalid(result-sfx-manifest)");
        return null;
      }
      resultSfxManifest = json;
      return json;
    })
    .catch((e: unknown) => {
      stateLog("AUDIO", `blocked(result-sfx-manifest): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    })
    .finally(() => {
      resultSfxManifestLoading = null;
    });
  return resultSfxManifestLoading;
}

async function startResultVoiceSfx(): Promise<void> {
  const manifest = await loadResultSfxManifest();
  if (store.state !== "Result" || manifest === null) {
    return;
  }
  clearResultSfxTimers();
  const isCriticalResult = store.selectedCriticalOutcome !== null;
  const rank = store.breakdown?.rank ?? "E";
  const schedule = createResultSfxSchedule(manifest, cfg().app.audio.resultVoiceSfx, {
    normalCount: isCriticalResult ? 13 : resultSfxNormalCountForRank(rank),
    includeUnique: isCriticalResult || rank === "S" || rank === "A",
    includeFeatured: rank === "A" || rank === "S",
  });
  stateLog(
    "AUDIO",
    `result-sfx schedule normal=${schedule.filter((item) => item.label === "normal").length} unique=${schedule.some((item) => item.label === "unique") ? 1 : 0} featured=${schedule.some((item) => item.label === "featured") ? 1 : 0}`,
  );
  for (const item of schedule) {
    const timer = setTimeout(() => {
      if (store.state !== "Result") {
        return;
      }
      playOneShotAudio(
        {
          file: item.file,
          volume: item.volume,
          maxVolume: 10,
        },
        bgmCallbacks(`result-${item.label}`),
      );
    }, item.delayMs);
    resultSfxTimers.push(timer);
  }
}

async function startCriticalVideoVoiceSfx(): Promise<void> {
  if (criticalResultSfxStarted) {
    return;
  }
  criticalResultSfxStarted = true;
  const manifest = await loadResultSfxManifest();
  if (store.selectedCriticalOutcome === null || manifest === null) {
    return;
  }
  clearResultSfxTimers();
  const schedule = createResultSfxSchedule(manifest, cfg().app.audio.resultVoiceSfx, {
    normalCount: manifest.normal.length,
    includeUnique: false,
    includeFeatured: false,
  });
  for (const item of schedule) {
    const timer = setTimeout(() => {
      if (store.selectedCriticalOutcome === null) {
        return;
      }
      playOneShotAudio(
        {
          file: item.file,
          volume: cfg().app.audio.resultVoiceSfx.criticalVideoNormalVolume,
          maxVolume: 10,
        },
        bgmCallbacks(`critical-video-${item.label}`),
      );
    }, item.delayMs);
    resultSfxTimers.push(timer);
  }
}

function stopChargeSound(): void {
  chargeSoundHandle?.stop();
  chargeSoundHandle = null;
  chargeSoundMode = null;
}

function isCriticalVideoFile(file: string): boolean {
  return store.selectedCriticalOutcome?.videoFile === file;
}

function syncBgmForPlayback(file: string | null): void {
  if (file !== null && isCriticalVideoFile(file)) {
    playCriticalBgm();
    return;
  }
  playMainBgm();
}

function takePreparedVideo(file: string): PreparedVideo | undefined {
  const prepared = preparedVideos.get(file);
  if (prepared !== undefined) {
    preparedVideos.delete(file);
  }
  return prepared;
}

function clearResultVideo(): void {
  if (resultVideoElement !== null) {
    resultVideoElement.pause();
    resultVideoElement.removeAttribute("src");
    resultVideoElement.load();
    resultVideoElement.remove();
    resultVideoElement = null;
  }
  preloadConfiguredVideos();
}

function prepareVideoForPlayback(): void {
  const files = videoFilesForPlayback();
  store.currentPlaybackFile = files[0] ?? null;
  store.playbackQueue = files.slice(1);
  for (const file of files) {
    ensureVideoPreloaded(file);
  }
  stateLog("VIDEO", `prepare: files=[${files.join(", ")}]`);
}

function preserveVideoForResult(): void {
  if (videoHandle === null) {
    return;
  }
  clearResultVideo();
  resultVideoElement = videoHandle.detachForResult();
  videoHandle = null;
}

function playNextQueuedVideo(): boolean {
  const nextFile = store.playbackQueue.shift();
  if (nextFile === undefined) {
    return false;
  }
  if (shouldUseCriticalTransition(nextFile)) {
    startCriticalTransitionTo(nextFile);
    return true;
  }
  if (videoHandle !== null) {
    videoHandle.stop();
    videoHandle = null;
  }
  store.currentPlaybackFile = nextFile;
  syncBgmForPlayback(nextFile);
  ensureVideoPreloaded(nextFile);
  mountVideo();
  return true;
}

function shouldUseCriticalTransition(nextFile: string): boolean {
  return (
    store.breakdown?.videoLevel === 5 &&
    store.currentPlaybackFile !== null &&
    !isCriticalVideoFile(store.currentPlaybackFile) &&
    isCriticalVideoFile(nextFile) &&
    !criticalTransitionRunning
  );
}

function startCriticalTransitionTo(nextFile: string): void {
  stateLog("VIDEO", `critical-wipe start: ${store.currentPlaybackFile} -> ${nextFile}`);
  criticalTransitionRunning = true;
  playCriticalTransitionSound();

  const overlay = document.createElement("div");
  overlay.className = "critical-transition-wipe";
  overlay.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);

  criticalTransitionTimers.push(setTimeout(() => {
    if (videoHandle !== null) {
      videoHandle.stop();
      videoHandle = null;
    }
    store.currentPlaybackFile = nextFile;
    ensureVideoPreloaded(nextFile);
    mountVideo({ syncBgm: false });
  }, CRITICAL_WIPE_COVER_MS));

  criticalTransitionTimers.push(setTimeout(() => {
    playCriticalBgm();
  }, CRITICAL_WIPE_REVEAL_MS));

  criticalTransitionTimers.push(setTimeout(() => {
    overlay.remove();
    criticalTransitionRunning = false;
    criticalTransitionTimers = [];
    stateLog("VIDEO", `critical-wipe end: playing=${store.currentPlaybackFile}`);
  }, CRITICAL_WIPE_END_MS));
}

function handleVideoEnded(): void {
  stateLog(
    "VIDEO",
    `ended: file=${store.currentPlaybackFile} queue=[${store.playbackQueue.join(", ")}] transitionRunning=${criticalTransitionRunning}`,
  );
  if (criticalTransitionRunning) {
    return;
  }
  if (playNextQueuedVideo()) {
    return;
  }
  dispatch("videoEnd");
}

function mountVideo(options: { syncBgm?: boolean } = {}): void {
  const syncBgm = options.syncBgm ?? true;
  const host = document.getElementById("video-host");
  if (!host) {
    return;
  }
  stopChargeSound();
  if (store.currentPlaybackFile === null && store.playbackQueue.length === 0) {
    stateLog("VIDEO", "mount: no file (Lv0 still) -> videoEnd in 900ms");
    host.classList.add("video-background-still");
    activeTimer = setTimeout(() => dispatch("videoEnd"), 900);
    return;
  }
  const file = currentVideoFileForPlayback();
  if (syncBgm) {
    syncBgmForPlayback(file);
  }
  if (isCriticalVideoFile(file)) {
    if (!criticalResultSfxStarted) {
      playCriticalVideoStartSound();
    }
    void startCriticalVideoVoiceSfx();
  }
  const prepared = takePreparedVideo(file);
  stateLog(
    "VIDEO",
    `mount: file=${file} prepared=${prepared ? `yes(rs=${prepared.video?.readyState ?? "-"})` : "no"} syncBgm=${syncBgm}`,
  );
  videoHandle = playVideo(host, file, {
    onEnded: handleVideoEnded,
    onMissing: (f) => {
      stateLog("VIDEO", `missing/error: ${f} ${videoElementsSnapshot()}`);
      store.lastError = `Video file not found: ${f}`;
      dispatch("videoError");
    },
    // 再生が進行しない（ロード保留/デコード停止）→ 動画を諦めて先へ進む。
    // スコアは確定済みなので Result は正常に出る（タイトルへ戻さない）。
    onStalled: (f) => {
      stateLog("VIDEO", `stalled -> skip: ${f} ${videoElementsSnapshot()}`);
      videoHandle?.stop(); // 止まった要素を DOM から除去・解放してから次へ。
      videoHandle = null;
      handleVideoEnded();
    },
  }, prepared, { stallTimeoutMs: cfg().app.video.stalledTimeoutMs });
}

function mountResultVideo(): void {
  const host = document.getElementById("result-video-host");
  if (!host || resultVideoElement === null) {
    return;
  }
  host.appendChild(resultVideoElement);
}

function startStateTimers(): void {
  const t = cfg().app.timers;
  switch (store.state) {
    case "InputCheck":
      // 接続表示とスマホREADYを、入力モードに関係なく定期更新する。
      activeInterval = setInterval(() => {
        updateDiagnostics();
        syncPhoneInputDeviceState();
        void pollRegisterEntryOnce();
      }, 500);
      syncPhoneInputDeviceState();
      break;
    case "Ready":
      startCountdown("ready-count", t.readyCountdownMs, () => dispatch("countdownEnd"));
      break;
    case "Charge": {
      startCountdown("phase-timer", t.chargeMs, () => dispatch("chargeDone"));
      // 構え切替（chargeMs 経過時）の stanceLeadSec 秒前に構えボイスを鳴らす。
      const stanceDelay = Math.max(0, t.chargeMs - leadSecToMs(cfg().app.audio.phaseCues.stanceLeadSec));
      phaseCueTimer = setTimeout(() => {
        phaseCueTimer = null;
        if (store.state === "Charge") {
          playStanceCueNow();
        }
      }, stanceDelay);
      break;
    }
    case "HakkeiReady": {
      // 構え（心の準備）フェーズ: hakkeiPrepMs の間は検出を arm せず、カウントダウンを出す。
      const prepMs = t.hakkeiPrepMs;
      // パンチ切替（prepMs 経過で arm）の punchLeadSec 秒前にパンチボイスを鳴らす。
      const punchDelay = Math.max(0, prepMs - leadSecToMs(cfg().app.audio.phaseCues.punchLeadSec));
      phaseCueTimer = setTimeout(() => {
        phaseCueTimer = null;
        if (store.state === "HakkeiReady" && !hakkeiArmed) {
          playPunchCueNow();
        }
      }, punchDelay);
      activeInterval = setInterval(() => {
        const remaining = prepMs - (performance.now() - hakkeiPrepStartMs);
        if (remaining <= 0) {
          if (activeInterval !== null) {
            clearInterval(activeInterval);
            activeInterval = null;
          }
          armHakkei(); // 構え終了 → 検出を arm（timeout 開始）＋ UI を「撃て！」へ。
        } else {
          updateHakkeiPrompt();
          updateCountdownText("hakkei-timer", prepMs, hakkeiPrepStartMs);
          updateDiagnostics(); // 構えカウントダウンを更新。
        }
      }, 100);
      break;
    }
    case "ImpactDelay":
      prepareVideoForPlayback();
      activeTimer = setTimeout(() => dispatch("impactDone"), t.impactDelayMs);
      break;
    case "VideoPlayback":
      void syncRegisteredUsersForSuggestions();
      mountVideo();
      // 動画が固まった場合はタイトルへ復帰する（無音凍結を残さない）。
      videoWatchdog = setTimeout(() => {
        recoverToTitleOnError("video-stall", "video did not reach Result within watchdog window");
      }, VIDEO_WATCHDOG_MS);
      // 診断: 毎秒 video の進行を記録する（凍結の瞬間に currentTime/readyState が止まる様子を残す）。
      videoProgressInterval = setInterval(() => {
        stateLog("PROGRESS", videoElementsSnapshot(false));
      }, 1000);
      break;
    case "Result":
      mountResultVideo();
      if (isRemoteMode()) {
        activeInterval = setInterval(() => {
          void pollPhoneResultExitOnce();
        }, 500);
        void pollPhoneResultExitOnce();
      }
      break;
    default:
      break;
  }
}

// --- 起動 ---------------------------------------------------------------

function renderFatalConfigError(messageJa: string): void {
  const appEl = document.getElementById("app");
  if (!appEl) {
    return;
  }
  appEl.innerHTML = `
    <main class="screen screen-Error">
      <section class="content">
        <h2 class="error-title">設定エラー（CONFIG_INVALID）</h2>
        <p class="error-msg">${messageJa}</p>
        <p class="hint">config/*.json を確認してください。</p>
        <div class="actions"><button class="primary" id="reload-btn">再読み込み</button></div>
      </section>
    </main>`;
  document.getElementById("reload-btn")?.addEventListener("click", () => location.reload());
}

// 未捕捉例外/Promise reject/動画スタックで無音凍結する（発勁→結果の途中で 1 つでも
// throw/停止するとその場の静止画面で固まり、動画も Result も出ない）。従来は例外ハンドラが
// 一切無かった。ユーザ方針: エラー時は無理に治さずタイトルへ戻す（展示で次の人が遊べる）。
let recoveringToTitle = false;
function recoverToTitleOnError(source: string, detail: unknown): void {
  const message =
    detail instanceof Error ? `${detail.message}\n${detail.stack ?? ""}` : String(detail);
  console.error(`[recover→Title] ${source}: ${message}`, detail); // 原因は devtools console に残す。
  stateLog("RECOVER", `${source}: state=${store.state} ${message.replace(/\n/g, " | ")}`);
  stateLog("RECOVER", `videos at recover: ${videoElementsSnapshot()}`);
  if (recoveringToTitle) {
    return; // 復帰処理自体が再度エラーを投げた場合の無限ループ防止。
  }
  recoveringToTitle = true;
  try {
    clearTimers(); // 動画停止＋全タイマー解除。
    resetPlayState(); // charge/breakdown/音をリセット。
    playMainBgm();
    clearNavigationHistory();
    store.state = "Title";
    store.titlePanel = "menu";
    store.settingsOpen = false;
    store.titleMenuIndex = 0;
    store.lastError = null;
    resetParticipantAssistMode("recover");
    keyboard?.setForcedHakkeiMode("none");
    render();
  } catch {
    location.reload(); // タイトル描画すら失敗する最悪ケースは再読み込みで復帰。
  } finally {
    recoveringToTitle = false;
  }
}

function installGlobalErrorTrap(): void {
  window.addEventListener("error", (e) => {
    recoverToTitleOnError("uncaught", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    recoverToTitleOnError("unhandledrejection", e.reason);
  });
}

async function start(): Promise<void> {
  installGlobalErrorTrap();
  const res = await api.getConfig();
  if (!res.ok) {
    renderFatalConfigError(res.messageJa);
    return;
  }
  bundle = res.value;
  store.inputMode =
    isDebugMode() || isDemoQrMode()
      ? bundle.app.defaultInputMode
      : "mocopi-ble";
  stateLog(
    "APP",
    `start: uiMode=${bundle.runtime.uiMode} localMode=${bundle.runtime.localMode} demoQr=${bundle.runtime.demoQr} inputMode=${store.inputMode} electron=${api.versions.electron} chrome=${api.versions.chrome}`,
  );
  // タイトル先行接続: mocopi-ble なら起動直後（タイトル表示中）に sidecar を spawn＋BLE 接続しておく。
  // 受信は有効化しない（applyMode を呼ばない）ので、タイトル中に packet はゲームへ流れない
  // ＝誤 CONNECTED やチャージ暴発なし。START 時は ensureStarted が温まった接続を再利用して即 CONNECTED。
  if (store.inputMode === "mocopi-ble") {
    void api.controlBleSidecar({ action: "start-sidecar" });
  }
  preloadConfiguredVideos();
  startBgm();

  keyboard = installKeyboardInput(api, (key) => {
    if (key === "Escape") {
      if (store.state === "Title") {
        return false;
      }
      if (navigateBack()) {
        return true;
      }
      dispatch("esc");
      return true;
    } else if (key === "KeyR") {
      dispatch("reset");
      return true;
    } else if (key === "ForceEnter") {
      return forceCurrentModeHakkei();
    }
    return false;
  }, (mode) => {
    store.forcedHakkeiMode = mode;
    stateLog("FORCED_HAKKEI", `${mode} state=${store.state}`);
    updateGameModeIndicators();
  });

  // Titleメニュー操作（矢印/Enter/S）。ゲーム入力(installKeyboardInput)とは独立。
  window.addEventListener("keydown", handleTitleKey);
  // InputCheck の接続画面操作（K/M モード切替・Enter で進む）。
  window.addEventListener("keydown", handleInputCheckKey);
  // Resultメニュー操作（十字キーで移動・Enterで決定）。
  window.addEventListener("keydown", handleResultKey);
  // Participant Assist: Shift でそのセッションだけチャージ100%基準を下げる。
  window.addEventListener("keydown", handleParticipantAssistKey);

  // game loop は PunchInputSample（Main 生成）で進める。
  api.onPunchInput(onPunchInput);
  // onMotionSample は diagnostics 表示のみ。
  api.onMotionSample(onSample);
  api.onMotionStatus((s) => {
    store.lastStatus = s;
    if (store.state === "InputCheck") {
      updateDiagnostics();
    }
  });
  api.onMotionHeartbeat((h) => {
    store.lastHeartbeat = h;
    if (store.state === "InputCheck") {
      updateDiagnostics();
    }
  });
  api.onMotionDiagnostics((d) => {
    store.lastDiagnostics = d;
    if (store.state === "InputCheck") {
      updateDiagnostics();
    }
  });
  api.onAppError((e) => {
    store.lastError = `${e.code}: ${e.messageJa}`;
  });
  api.onBleSidecarStatus((p) => {
    bleSidecarStatus = p;
    if (store.state === "InputCheck" && store.inputMode === "mocopi-ble") {
      updateDiagnostics();
    }
  });
  api.onRemoteSessionEvent(onRemoteSessionEvent);
  api.onRemoteSessionStatus(onRemoteSessionStatus);
  // セッション変更（トラッカ再起動・別 mocopi 等）で play 中なら安全に InputCheck へ戻す。
  api.onMotionSessionChanged((p) => {
    stateLog(
      "SESSION",
      `changed(${p.reason}): ${p.previousSessionId} -> ${p.nextSessionId} state=${store.state} inputMode=${store.inputMode}`,
    );
    if (store.inputMode === "keyboard") {
      return;
    }
    // ImpactDelayまではプレイ中なのでreset対象。再接続で動画を中断しないようVideoPlaybackは除外する。
    const livePlay: AppState[] = ["Ready", "Charge", "HakkeiReady", "ImpactDelay"];
    if (livePlay.includes(store.state)) {
      stateLog("SESSION", `-> reset to InputCheck (was ${store.state})`);
      resetPlayState();
      store.state = "InputCheck";
      render();
    }
  });
  render();
}

window.addEventListener("DOMContentLoaded", () => {
  void start();
});
