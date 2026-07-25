import type { AppConfig } from "../shared/configTypes.ts";
import type {
  RemoteSessionEvent,
  RemoteSessionSendRequest,
  RemoteSessionStatusPayload,
} from "../shared/types.ts";

type Callbacks = {
  onEvent: (event: RemoteSessionEvent) => void;
  onStatus: (status: RemoteSessionStatusPayload) => void;
};

function nowMs(): number {
  return Date.now();
}

function randomId(): string {
  return `evt-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRemoteSessionEvent(value: unknown): value is RemoteSessionEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const event = value as Partial<RemoteSessionEvent>;
  return (
    event.protocolVersion === 1 &&
    typeof event.eventId === "string" &&
    event.eventId.length > 0 &&
    typeof event.type === "string" &&
    typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    typeof event.sentAtMs === "number" &&
    Number.isFinite(event.sentAtMs) &&
    (event.actor === "game" || event.actor === "phone" || event.actor === "server")
  );
}

export class RemoteSessionClient {
  private config: AppConfig["remoteSession"];
  private callbacks: Callbacks;
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualStop = false;
  private seenEventIds = new Set<string>();
  private lastError: string | null = null;

  constructor(config: AppConfig["remoteSession"], callbacks: Callbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  updateConfig(config: AppConfig["remoteSession"]): void {
    this.config = config;
  }

  start(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      this.seenEventIds.clear();
      this.retryCount = 0;
      this.clearReconnectTimer();
      const previousSocket = this.socket;
      this.socket = null;
      if (previousSocket !== null) {
        previousSocket.onopen = null;
        previousSocket.onmessage = null;
        previousSocket.onerror = null;
        previousSocket.onclose = null;
        previousSocket.close();
      }
    }
    this.sessionId = sessionId;
    if (!this.config.enabled) {
      this.emitStatus("disabled");
      return;
    }
    this.manualStop = false;
    this.connect();
  }

  stop(): void {
    this.manualStop = true;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
    this.emitStatus("closed");
  }

  send(request: RemoteSessionSendRequest): boolean {
    if (!this.sessionId || !this.config.enabled) {
      this.emitStatus(this.config.enabled ? "fallback" : "disabled");
      return false;
    }
    const event: RemoteSessionEvent = {
      protocolVersion: 1,
      eventId: request.event.eventId ?? randomId(),
      type: request.event.type,
      sessionId: request.event.sessionId,
      sentAtMs: request.event.sentAtMs ?? nowMs(),
      actor: request.event.actor ?? "game",
      entry: request.event.entry,
      playerId: request.event.playerId,
      playerName: request.event.playerName,
      damageYen: request.event.damageYen,
      damageYenText: request.event.damageYenText,
      rank: request.event.rank,
      playStarted: request.event.playStarted,
      message: request.event.message,
    };
    if (event.sessionId !== this.sessionId || !isRemoteSessionEvent(event)) {
      this.lastError = "invalid remote session event";
      this.emitStatus("fallback");
      return false;
    }
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor || this.socket?.readyState !== WebSocketCtor.OPEN) {
      this.emitStatus("fallback");
      return false;
    }
    this.socket.send(JSON.stringify(event));
    return true;
  }

  private connect(): void {
    if (!this.sessionId || this.manualStop) {
      return;
    }
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      this.lastError = "WebSocket is not available in Electron Main";
      this.emitStatus("fallback");
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocketCtor.CONNECTING || this.socket.readyState === WebSocketCtor.OPEN)) {
      return;
    }
    this.clearReconnectTimer();
    this.emitStatus("connecting");
    const url = new URL(this.config.wsUrl);
    url.searchParams.set("client", "game");
    url.searchParams.set("sessionId", this.sessionId);
    try {
      const socket = new WebSocketCtor(url.toString());
      this.socket = socket;
      socket.onopen = (): void => {
        this.retryCount = 0;
        this.lastError = null;
        this.emitStatus("open");
      };
      socket.onmessage = (message: MessageEvent): void => {
        this.handleMessage(message.data);
      };
      socket.onerror = (): void => {
        this.lastError = "websocket error";
        this.emitStatus("fallback");
      };
      socket.onclose = (): void => {
        this.socket = null;
        if (this.manualStop) {
          this.emitStatus("closed");
          return;
        }
        this.emitStatus("fallback");
        this.scheduleReconnect();
      };
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.emitStatus("fallback");
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRemoteSessionEvent(parsed) || parsed.sessionId !== this.sessionId) {
      return;
    }
    if (this.seenEventIds.has(parsed.eventId)) {
      return;
    }
    this.seenEventIds.add(parsed.eventId);
    if (this.seenEventIds.size > 500) {
      this.seenEventIds = new Set([...this.seenEventIds].slice(-250));
    }
    this.callbacks.onEvent(parsed);
  }

  private scheduleReconnect(): void {
    if (!this.sessionId || this.manualStop || !this.config.enabled) {
      return;
    }
    this.retryCount += 1;
    const backoffMs = Math.min(
      this.config.reconnectMaxMs,
      this.config.reconnectMinMs * Math.max(1, this.retryCount),
    );
    this.reconnectTimer = setTimeout(() => this.connect(), backoffMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(state: RemoteSessionStatusPayload["state"]): void {
    this.callbacks.onStatus({
      state,
      sessionId: this.sessionId,
      retryCount: this.retryCount,
      lastError: this.lastError,
      occurredAtMs: nowMs(),
    });
  }
}
