// src/preload/index.ts
//
// contextIsolation 下で Renderer に「限定された」APIだけを公開する（SPEC.md 9.4 の M2サブセット）。
// ipcRenderer 本体は決して露出しない。各 onXxx は Unsubscribe を返す。

import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AppErrorClearPayload,
  type AppErrorPayload,
  type DebugLogRequest,
  type HakkeiPreloadApi,
  type InputModeChangeRequest,
  type IpcResult,
  type KeyboardControlPayload,
  type MotionDiagnosticsPayload,
  type MotionHeartbeatPayload,
  type MotionSample,
  type MotionStatusPayload,
  type RemoteHttpRequest,
  type RemoteHttpResponse,
  type RemoteSessionEvent,
  type RemoteSessionSendRequest,
  type RemoteSessionStartRequest,
  type RemoteSessionStatusPayload,
  type ResetFilterRequest,
  type ResetPlayRequest,
  type SettingsSaveScoreRequest,
  type SessionChangedPayload,
  type Unsubscribe,
  type BleSidecarControlPayload,
  type BleSidecarStatusPayload,
} from "../shared/types.ts";
import { type PunchInputSample } from "../shared/punchInput.ts";

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_e: unknown, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: HakkeiPreloadApi = {
  appName: "発勁ラボブレイカー",
  versions: {
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  },
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setInputMode: (request: InputModeChangeRequest) => ipcRenderer.invoke(IPC.setInputMode, request),
  sendKeyboardControl: (payload: KeyboardControlPayload) =>
    ipcRenderer.invoke(IPC.keyboardControl, payload),
  resetPlay: (request: ResetPlayRequest) => ipcRenderer.invoke(IPC.resetPlay, request),
  resetFilter: (request: ResetFilterRequest) => ipcRenderer.invoke(IPC.resetFilter, request),
  controlBleSidecar: (payload: BleSidecarControlPayload) =>
    ipcRenderer.invoke(IPC.bleSidecarControl, payload),
  settingsGetConfig: () => ipcRenderer.invoke(IPC.settingsGetConfig),
  settingsSaveScore: (request: SettingsSaveScoreRequest) =>
    ipcRenderer.invoke(IPC.settingsSaveScore, request),
  remoteSessionStart: (request: RemoteSessionStartRequest) =>
    ipcRenderer.invoke(IPC.remoteSessionStart, request),
  remoteSessionSend: (request: RemoteSessionSendRequest) =>
    ipcRenderer.invoke(IPC.remoteSessionSend, request),
  remoteSessionStop: () => ipcRenderer.invoke(IPC.remoteSessionStop),
  remoteHttpRequest: (request: RemoteHttpRequest): Promise<IpcResult<RemoteHttpResponse>> =>
    ipcRenderer.invoke(IPC.remoteHttpRequest, request),
  quitApp: () => ipcRenderer.invoke(IPC.quitApp),
  debugLog: (request: DebugLogRequest) => ipcRenderer.invoke(IPC.debugLog, request),
  onMotionSample: (handler: (payload: MotionSample) => void) =>
    subscribe<MotionSample>(IPC.motionSample, handler),
  onPunchInput: (handler: (payload: PunchInputSample) => void) =>
    subscribe<PunchInputSample>(IPC.punchInput, handler),
  onBleSidecarStatus: (handler: (payload: BleSidecarStatusPayload) => void) =>
    subscribe<BleSidecarStatusPayload>(IPC.bleSidecarStatus, handler),
  onMotionHeartbeat: (handler: (payload: MotionHeartbeatPayload) => void) =>
    subscribe<MotionHeartbeatPayload>(IPC.motionHeartbeat, handler),
  onMotionStatus: (handler: (payload: MotionStatusPayload) => void) =>
    subscribe<MotionStatusPayload>(IPC.motionStatus, handler),
  onMotionDiagnostics: (handler: (payload: MotionDiagnosticsPayload) => void) =>
    subscribe<MotionDiagnosticsPayload>(IPC.motionDiagnostics, handler),
  onMotionSessionChanged: (handler: (payload: SessionChangedPayload) => void) =>
    subscribe<SessionChangedPayload>(IPC.motionSessionChanged, handler),
  onAppError: (handler: (payload: AppErrorPayload) => void) =>
    subscribe<AppErrorPayload>(IPC.appError, handler),
  onAppErrorClear: (handler: (payload: AppErrorClearPayload) => void) =>
    subscribe<AppErrorClearPayload>(IPC.appErrorClear, handler),
  onRemoteSessionEvent: (handler: (payload: RemoteSessionEvent) => void) =>
    subscribe<RemoteSessionEvent>(IPC.remoteSessionEvent, handler),
  onRemoteSessionStatus: (handler: (payload: RemoteSessionStatusPayload) => void) =>
    subscribe<RemoteSessionStatusPayload>(IPC.remoteSessionStatus, handler),
};

contextBridge.exposeInMainWorld("hakkei", api);
