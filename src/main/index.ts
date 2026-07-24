// src/main/index.ts
//
// Electron Main プロセス。
// M2: Keyboard generator。M4: config。M5: Unity Bridge UDP 受信 + status/heartbeat/error IPC。

import * as path from "node:path";
import { appendFile, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain } from "electron";
import { KeyboardSampleGenerator } from "./keyboardSampleGenerator.ts";
import { loadConfigBundle, validateApp, validateInput, validateScoreConfig } from "./appConfig.ts";
import { UnityBridgeUdpReceiver } from "./unityBridgeUdpReceiver.ts";
import { MocopiBleUdpReceiver } from "./mocopiBleUdpReceiver.ts";
import { BleSidecarManager } from "./bleSidecarManager.ts";
import { PunchInputAdapter } from "./punchInputAdapter.ts";
import { RemoteSessionClient } from "./remoteSessionClient.ts";
import { performRemoteHttpRequest, validateRemoteHttpRequest } from "./remoteHttp.ts";
import type { AppConfigBundle } from "../shared/configTypes.ts";
import {
  IPC,
  type BleSidecarControlPayload,
  type InputMode,
  type InputModeChangeRequest,
  type IpcResult,
  type KeyboardControlPayload,
  type MotionSample,
  type DebugLogRequest,
  type RegisteredSessionEntry,
  type RegisteredUsersPayload,
  type RemoteHttpResponse,
  type RemoteSessionSendRequest,
  type RemoteSessionStartRequest,
  type ResetFilterRequest,
  type ResetPlayRequest,
  type SettingsAdminResetPayload,
  type SettingsAdminResetRequest,
  type SettingsSaveScoreRequest,
} from "../shared/types.ts";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow: BrowserWindow | null = null;
let activeMode: InputMode = "none";
let configResult: IpcResult<AppConfigBundle> = {
  ok: false,
  code: "CONFIG_INVALID",
  messageJa: "設定が未読み込みです",
};
let keyboardGenerator: KeyboardSampleGenerator | null = null;
let receiver: UnityBridgeUdpReceiver | null = null;
let bleReceiver: MocopiBleUdpReceiver | null = null;
let bleSidecar: BleSidecarManager | null = null;
let lastKeyboardSessionId: string | null = null;
// 入力非依存 punch core 用の adapter（V2c）。Main で MotionSample→PunchInputSample を生成し emit する。
let punchAdapter: PunchInputAdapter | null = null;
let remoteSessionClient: RemoteSessionClient | null = null;
const SCORE_ENTRY_BASE_URL = "http://127.0.0.1:45200";
const SERVER_RESET_CONFIRM = "DELETE_ALL_HAKKEI_DATA";
const GAME_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function scoreEntryBaseUrl(): string {
  return (configResult.ok ? configResult.value.app.remoteSession.httpBaseUrl : SCORE_ENTRY_BASE_URL).replace(/\/+$/, "");
}

function getRuntimeUiMode(): AppConfigBundle["runtime"]["uiMode"] {
  return process.argv.includes("--debug-ui") ? "debug" : "release";
}

function isLocalMode(): boolean {
  return process.argv.includes("--local-mode");
}

function isRemoteMode(): boolean {
  return !isLocalMode() && configResult.ok && configResult.value.app.remoteSession.enabled;
}

function runtimeConfig(): AppConfigBundle["runtime"] {
  return { uiMode: getRuntimeUiMode(), localMode: isLocalMode() };
}

function isSettingsMode(): boolean {
  return process.argv.includes("--settings");
}

function isRegisteredUsersMode(): boolean {
  return process.argv.includes("--registered-users");
}

function configDir(): string {
  return path.join(app.getAppPath(), "config");
}

function readJsonFile(fileName: string): unknown {
  return JSON.parse(readFileSync(path.join(configDir(), fileName), "utf8"));
}

function writeJsonFile(fileName: string, value: unknown): void {
  writeFileSync(path.join(configDir(), fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// 実機実験用の状態遷移ログ（Renderer から IPC で受けて logs/ に追記する・診断用）。
// 凍結時にも DevTools なしでファイルから経緯を回収できるようにする。失敗しても落とさない。
let debugLogDirReady = false;
function debugLogFilePath(): string {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return path.join(app.getAppPath(), "logs", `state-${yyyymmdd}.log`);
}

function appendDebugLog(line: string): void {
  try {
    if (!debugLogDirReady) {
      mkdirSync(path.join(app.getAppPath(), "logs"), { recursive: true });
      debugLogDirReady = true;
    }
    appendFile(debugLogFilePath(), `${line}\n`, () => {});
  } catch {
    // ログ失敗でゲームを止めない。
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function isRegisteredSessionEntry(value: unknown): value is RegisteredSessionEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<RegisteredSessionEntry>;
  return (
    typeof entry.sessionId === "string" &&
    typeof entry.playerId === "string" &&
    typeof entry.playerName === "string" &&
    typeof entry.registeredAtMs === "number" &&
    Number.isFinite(entry.registeredAtMs)
  );
}

function isRegisteredUsersPayload(value: unknown): value is RegisteredUsersPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Partial<RegisteredUsersPayload>;
  return (
    typeof payload.generatedAtMs === "number" &&
    Number.isFinite(payload.generatedAtMs) &&
    Array.isArray(payload.entries) &&
    payload.entries.every(isRegisteredSessionEntry)
  );
}

// MotionSample を Renderer へ。併せて Main 生成の PunchInputSample（punch core 入力）も emit する。
function emitMotion(sample: MotionSample): void {
  send(IPC.motionSample, sample);
  if (punchAdapter) {
    send(IPC.punchInput, punchAdapter.fromMotionSample(sample));
  }
}

function applyMode(mode: InputMode): void {
  activeMode = mode;
  receiver?.setActiveMode(mode);
  bleReceiver?.setActive(mode === "mocopi-ble"); // mocopi-ble の時だけ BLE packet を emit。
  // mocopi-bleモード選択時にsidecarを自動起動し、操作担当者の端末操作を不要にする。他モードでは停止する。
  // 既に sidecar 稼働中なら再spawnせず生きた BLE 接続を維持する（毎回の kill→再接続遅延を防ぐ）。
  if (mode === "mocopi-ble") {
    // 実プレイ（InputCheck）到達時。タイトル先行接続で枠を使い切っていても新枠で再接続可能に。
    bleSidecar?.resetRestarts();
    bleSidecar?.ensureStarted("sidecar");
  } else {
    bleSidecar?.stop();
  }
  punchAdapter?.reset(); // source 切替で連続性（前位置 baseline）をリセット。
  if (mode === "keyboard" && keyboardGenerator) {
    keyboardGenerator.start("keyboard-start");
  } else {
    keyboardGenerator?.stop();
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, (): IpcResult<AppConfigBundle> => configResult);

  ipcMain.handle(IPC.settingsGetConfig, (): IpcResult<{ app: unknown; input: unknown; score: unknown }> => {
    try {
      return {
        ok: true,
        value: {
          app: readJsonFile("app.config.json"),
          input: readJsonFile("input.config.json"),
          score: readJsonFile("score.config.json"),
        },
      };
    } catch (e) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        messageJa: `設定JSONを読み込めません: ${String(e)}`,
      };
    }
  });

  ipcMain.handle(IPC.settingsSaveScore, (_e, request: SettingsSaveScoreRequest): IpcResult => {
    try {
      if (request.app !== undefined) {
        validateApp(request.app);
      }
      if (request.input !== undefined) {
        validateInput(request.input);
      }
      validateScoreConfig(request.score);
      if (request.app !== undefined) {
        writeJsonFile("app.config.json", request.app);
      }
      if (request.input !== undefined) {
        writeJsonFile("input.config.json", request.input);
      }
      writeJsonFile("score.config.json", request.score);
      configResult = loadConfigBundle(configDir(), Date.now(), runtimeConfig());
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        messageJa: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle(IPC.registeredUsersList, async (): Promise<IpcResult<RegisteredUsersPayload>> => {
    if (!isRemoteMode()) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "QR登録サーバーは無効です" };
    }
    const adminToken = process.env.HAKKEI_ADMIN_TOKEN?.trim();
    if (!adminToken) {
      return {
        ok: false,
        code: "MODE_UNAVAILABLE",
        messageJa: "登録ユーザー一覧は管理トークンが設定された運用端末だけで取得できます",
      };
    }
    try {
      const response = await fetch(`${scoreEntryBaseUrl()}/api/session-entries`, {
        cache: "no-store",
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      if (!response.ok) {
        return {
          ok: false,
          code: "INVALID_REQUEST",
          messageJa: `登録サーバーが ${response.status} を返しました`,
        };
      }
      const payload = (await response.json()) as unknown;
      if (!isRegisteredUsersPayload(payload)) {
        return {
          ok: false,
          code: "INVALID_REQUEST",
          messageJa: "登録サーバーの一覧形式が不正です",
        };
      }
      return { ok: true, value: payload };
    } catch (e) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        messageJa: `登録ユーザー一覧を取得できません: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  ipcMain.handle(IPC.remoteSessionStart, (_e, request: RemoteSessionStartRequest): IpcResult => {
    if (!isRemoteMode()) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "QR登録サーバーは無効です" };
    }
    if (
      typeof request?.sessionId !== "string" ||
      request.sessionId.length === 0 ||
      typeof request.gameToken !== "string" ||
      !GAME_TOKEN_PATTERN.test(request.gameToken)
    ) {
      return { ok: false, code: "INVALID_REQUEST", messageJa: "sessionId またはゲーム認証情報が不正です" };
    }
    if (configResult.ok) {
      remoteSessionClient?.updateConfig(configResult.value.app.remoteSession);
    }
    remoteSessionClient?.start(request.sessionId, request.gameToken);
    return { ok: true };
  });

  ipcMain.handle(IPC.remoteSessionSend, (_e, request: RemoteSessionSendRequest): IpcResult => {
    if (!isRemoteMode()) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "QR登録サーバーは無効です" };
    }
    if (!remoteSessionClient) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "remote session 未初期化" };
    }
    if (!remoteSessionClient.send(request)) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "remote session websocket unavailable" };
    }
    return { ok: true };
  });

  ipcMain.handle(IPC.remoteSessionStop, (): IpcResult => {
    remoteSessionClient?.stop();
    return { ok: true };
  });

  ipcMain.handle(IPC.remoteHttpRequest, async (_e, request: unknown): Promise<IpcResult<RemoteHttpResponse>> => {
    if (!isRemoteMode()) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "QR登録サーバーは無効です" };
    }
    if (!validateRemoteHttpRequest(request)) {
      return { ok: false, code: "INVALID_REQUEST", messageJa: "許可されていないサーバー通信です" };
    }
    try {
      return { ok: true, value: await performRemoteHttpRequest(scoreEntryBaseUrl(), request) };
    } catch (e) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        messageJa: `QR登録サーバーへ接続できません: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  ipcMain.handle(IPC.settingsAdminReset, async (_e, request: SettingsAdminResetRequest): Promise<IpcResult<SettingsAdminResetPayload>> => {
    if (!isRemoteMode()) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "QR登録サーバーは無効です" };
    }
    if (request?.confirm !== SERVER_RESET_CONFIRM) {
      return { ok: false, code: "INVALID_REQUEST", messageJa: "確認文字列が不正です" };
    }
    const adminToken = process.env.HAKKEI_ADMIN_TOKEN?.trim();
    if (!adminToken) {
      return {
        ok: false,
        code: "MODE_UNAVAILABLE",
        messageJa: "サーバー管理トークンが設定されていないため、公開版からは全削除できません",
      };
    }
    try {
      const response = await fetch(`${scoreEntryBaseUrl()}/api/admin-reset`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Authorization": `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: SERVER_RESET_CONFIRM }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<SettingsAdminResetPayload> & { error?: unknown };
      if (!response.ok) {
        return {
          ok: false,
          code: "INVALID_REQUEST",
          messageJa:
            typeof payload.error === "string"
              ? `登録サーバーの削除に失敗しました: ${payload.error}`
              : `登録サーバーが ${response.status} を返しました`,
        };
      }
      if (payload.entriesDeleted !== true || payload.playersDeleted !== true || payload.rankingDeleted !== true) {
        return {
          ok: false,
          code: "INVALID_REQUEST",
          messageJa: "登録サーバーの削除結果が不正です。サーバー版が古い可能性があります",
        };
      }
      return {
        ok: true,
        value: {
          entriesDeleted: true,
          playersDeleted: true,
          rankingDeleted: true,
        },
      };
    } catch (e) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        messageJa: `登録サーバーの削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  ipcMain.handle(
    IPC.setInputMode,
    (_e, request: InputModeChangeRequest): IpcResult<{ activeMode: InputMode }> => {
      if (
        request?.mode !== "none" &&
        request?.mode !== "keyboard" &&
        request?.mode !== "mock-unity-bridge" &&
        request?.mode !== "unity-bridge" &&
        request?.mode !== "mocopi-ble"
      ) {
        return { ok: false, code: "INVALID_REQUEST", messageJa: "入力モードが不正です" };
      }
      applyMode(request.mode);
      return { ok: true, value: { activeMode } };
    },
  );

  ipcMain.handle(IPC.keyboardControl, (_e, payload: KeyboardControlPayload): IpcResult => {
    if (activeMode !== "keyboard" || !keyboardGenerator) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "keyboardモードではありません" };
    }
    keyboardGenerator.handleControl(payload);
    return { ok: true };
  });

  ipcMain.handle(IPC.resetPlay, (_e, _request: ResetPlayRequest): IpcResult => {
    if (activeMode === "keyboard") {
      keyboardGenerator?.resetPlay();
    }
    if (activeMode === "mocopi-ble") {
      bleReceiver?.resetPlay();
    }
    punchAdapter?.reset();
    return { ok: true };
  });

  ipcMain.handle(IPC.resetFilter, (_e, _request: ResetFilterRequest): IpcResult => {
    receiver?.resetActiveFilter();
    return { ok: true };
  });

  ipcMain.handle(IPC.quitApp, (): IpcResult => {
    app.quit();
    return { ok: true };
  });

  ipcMain.handle(IPC.debugLog, (_e, request: DebugLogRequest): IpcResult => {
    if (typeof request?.line !== "string" || request.line.length > 20000) {
      return { ok: false, code: "INVALID_REQUEST", messageJa: "不正なログ行です" };
    }
    appendDebugLog(request.line);
    return { ok: true };
  });

  ipcMain.handle(IPC.bleSidecarControl, (_e, payload: BleSidecarControlPayload): IpcResult => {
    if (!bleSidecar) {
      return { ok: false, code: "MODE_UNAVAILABLE", messageJa: "sidecar 未初期化" };
    }
    switch (payload?.action) {
      case "start-sidecar":
        // タイトル先行接続にも使う。既に稼働中なら再利用（idempotent）。
        bleSidecar.ensureStarted("sidecar");
        break;
      case "start-replay":
        bleSidecar.start("replay");
        break;
      case "restart":
        bleSidecar.restart();
        break;
      case "stop":
        bleSidecar.stop();
        break;
      default:
        return { ok: false, code: "INVALID_REQUEST", messageJa: "不正な action" };
    }
    return { ok: true };
  });
}

function createGenerator(bundle: AppConfigBundle): void {
  keyboardGenerator = new KeyboardSampleGenerator(
    (sample) => emitMotion(sample),
    (info) => {
      send(IPC.motionSessionChanged, {
        source: "keyboard",
        previousSessionId: lastKeyboardSessionId,
        nextSessionId: info.sessionId,
        reason: info.reason,
        occurredAtMs: Date.now(),
      });
      lastKeyboardSessionId = info.sessionId;
    },
    bundle.input.keyboard,
  );
}

function createReceiver(bundle: AppConfigBundle): void {
  receiver = new UnityBridgeUdpReceiver(bundle.input, {
    onSample: (s) => emitMotion(s),
    onHeartbeat: (h) => send(IPC.motionHeartbeat, h),
    onStatus: (s) => send(IPC.motionStatus, s),
    onDiagnostics: (d) => send(IPC.motionDiagnostics, d),
    onSessionChanged: (p) => send(IPC.motionSessionChanged, p),
    onError: (e) => send(IPC.appError, e),
  });
  receiver.start();
}

function createWindow(): void {
  const releaseMainWindow = !isSettingsMode() && !isRegisteredUsersMode() && getRuntimeUiMode() === "release";
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#101014",
    show: false,
    fullscreen: releaseMainWindow,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const fileName = isSettingsMode()
    ? "settings.html"
    : isRegisteredUsersMode()
      ? "registered-users.html"
      : "index.html";
  void mainWindow.loadFile(path.join(__dirname, "..", "renderer", fileName));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (isSettingsMode() || isRegisteredUsersMode()) {
    registerIpc();
    createWindow();
    return;
  }

  configResult = loadConfigBundle(path.join(app.getAppPath(), "config"), Date.now(), runtimeConfig());
  if (configResult.ok) {
    punchAdapter = new PunchInputAdapter(
      configResult.value.score.normalization.rightChargeNoiseThreshold,
    );
    if (isRemoteMode()) {
      remoteSessionClient = new RemoteSessionClient(configResult.value.app.remoteSession, {
        onEvent: (event) => send(IPC.remoteSessionEvent, event),
        onStatus: (status) => send(IPC.remoteSessionStatus, status),
      });
    }
    createGenerator(configResult.value);
    createReceiver(configResult.value);
    bleReceiver = new MocopiBleUdpReceiver({
      port: configResult.value.input.udp.mocopiBlePort,
      noiseAngleDeg: configResult.value.score.punch.chargeNoiseFloor,
      onPunchInput: (s) => send(IPC.punchInput, s),
      onSessionChanged: (p) => send(IPC.motionSessionChanged, p),
    });
    bleReceiver.start();
    bleSidecar = new BleSidecarManager({
      pythonCmd: process.env.PYTHON, // 未指定なら manager が bleak のある python を自動検出
      projectRoot: app.getAppPath(),
      udpPort: configResult.value.input.udp.mocopiBlePort,
      replayCsv: path.join(app.getAppPath(), "ble-raw3.csv"),
      onStatus: (payload) => send(IPC.bleSidecarStatus, payload),
    });
  } else {
    console.error("[main] config invalid:", configResult.messageJa);
  }

  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  keyboardGenerator?.stop();
  receiver?.stop();
  bleReceiver?.stop();
  bleSidecar?.stop();
  remoteSessionClient?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
