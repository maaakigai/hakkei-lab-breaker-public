import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { BridgePacketSource, UnityHeartbeatPacketV1 } from "../shared/types.ts";
import { validateDatagram } from "../main/packetValidator.ts";

type WatcherSocket = Pick<Socket, "bind" | "close" | "on">;

export type ReadinessWatcherOptions = {
  host: string;
  port: number;
  maxDatagramBytes: number;
  source?: BridgePacketSource;
  debounceCount?: number;
  onReady: (heartbeat: UnityHeartbeatPacketV1) => void;
  onSocketError?: (error: Error) => void;
  nowMs?: () => number;
  createSocket?: () => WatcherSocket;
};

function isReadyHeartbeat(packet: UnityHeartbeatPacketV1, source: BridgePacketSource): boolean {
  return (
    packet.source === source &&
    packet.receiverReady &&
    packet.avatarReady &&
    packet.rightHandReady &&
    packet.receiverStatus === "receiving"
  );
}

/**
 * Watches the Unity Bridge heartbeat until it is stably ready.  The socket is
 * closed before onReady runs so the game can bind the same UDP port.
 */
export class ReadinessWatcher {
  private readonly options: ReadinessWatcherOptions;
  private readonly source: BridgePacketSource;
  private readonly debounceCount: number;
  private readonly nowMs: () => number;
  private readonly createSocket: () => WatcherSocket;

  private socket: WatcherSocket | null = null;
  private consecutiveReadyCount = 0;
  private ready = false;
  private lastReadyAtMs: number | null = null;

  constructor(options: ReadinessWatcherOptions) {
    this.options = options;
    this.source = options.source ?? "unity-bridge";
    this.debounceCount = options.debounceCount ?? 3;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.createSocket = options.createSocket ?? (() => createSocket("udp4"));

    if (!Number.isSafeInteger(this.debounceCount) || this.debounceCount < 1) {
      throw new Error("debounceCount must be a positive integer");
    }
  }

  start(): void {
    if (this.socket !== null || this.ready) {
      return;
    }
    const socket = this.createSocket();
    socket.on("message", (buffer: Buffer, _remote: RemoteInfo) => {
      this.handleDatagram(buffer.toString("utf8"), buffer.length);
    });
    socket.on("error", (error: Error) => this.options.onSocketError?.(error));
    socket.bind(this.options.port, this.options.host);
    this.socket = socket;
  }

  stop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) {
      return;
    }
    try {
      socket.close();
    } catch {
      // Closing an already-closed UDP socket is harmless for this one-shot tool.
    }
  }

  handleDatagram(text: string, byteLength: number): void {
    if (this.ready) {
      return;
    }
    const result = validateDatagram(text, byteLength, this.options.maxDatagramBytes);
    if (result.kind !== "heartbeat" || !isReadyHeartbeat(result.packet, this.source)) {
      if (result.kind === "heartbeat" && result.packet.source === this.source) {
        this.consecutiveReadyCount = 0;
      }
      return;
    }

    this.consecutiveReadyCount += 1;
    if (this.consecutiveReadyCount < this.debounceCount) {
      return;
    }

    this.ready = true;
    this.lastReadyAtMs = this.nowMs();
    this.closeThenNotify(result.packet);
  }

  getConsecutiveReadyCount(): number {
    return this.consecutiveReadyCount;
  }

  isReady(): boolean {
    return this.ready;
  }

  getLastReadyAtMs(): number | null {
    return this.lastReadyAtMs;
  }

  private closeThenNotify(heartbeat: UnityHeartbeatPacketV1): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) {
      this.options.onReady(heartbeat);
      return;
    }
    try {
      socket.close(() => this.options.onReady(heartbeat));
    } catch (error) {
      this.options.onSocketError?.(error instanceof Error ? error : new Error("UDP socket close failed"));
    }
  }
}
