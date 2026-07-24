// src/main/mocopiBleUdpReceiver.ts
//
// BLE sidecar / replay からの mocopi-ble packet（localhost UDP・JSON）を受信し、
// mocopiBleAdapter で角速度ベースの PunchInputSample を生成して emit する（V4）。
//
// 入力源の排他: active のときだけ emit する（activeMode !== "mocopi-ble" の packet は無視）。
// 不正 packet は破棄（クラッシュさせない）。Main 生成原則を維持（Renderer 再計算しない）。

import { createSocket, type Socket } from "node:dgram";
import { MocopiBleAdapter } from "./mocopiBleAdapter.ts";
import type { MocopiBlePacketV1, PunchInputSample } from "../shared/punchInput.ts";
import type { SessionChangedPayload } from "../shared/types.ts";

export type MocopiBleReceiverOptions = {
  port: number;
  noiseAngleDeg: number; // charge 積算の noise floor（config.score.punch.chargeNoiseFloor 由来）
  onPunchInput: (sample: PunchInputSample) => void;
  onSessionChanged?: (payload: SessionChangedPayload) => void;
};

// 受信した JSON が mocopi-ble imu packet として最小限妥当か（quat 必須）。
export function isMocopiBlePacket(value: unknown): value is MocopiBlePacketV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  if (p.protocolVersion !== 1 || p.type !== "imu" || p.source !== "mocopi-ble") {
    return false;
  }
  if (typeof p.sessionId !== "string" || typeof p.seq !== "number" || typeof p.timestampMs !== "number") {
    return false;
  }
  const q = p.quat as Record<string, unknown> | undefined;
  return (
    typeof q === "object" &&
    q !== null &&
    typeof q.w === "number" &&
    typeof q.x === "number" &&
    typeof q.y === "number" &&
    typeof q.z === "number"
  );
}

export class MocopiBleUdpReceiver {
  private socket: Socket | null = null;
  private readonly adapter: MocopiBleAdapter;
  private readonly port: number;
  private readonly onPunchInput: (sample: PunchInputSample) => void;
  private readonly onSessionChanged: ((payload: SessionChangedPayload) => void) | null;
  private active = false;
  private lastSessionId: string | null = null;

  constructor(opts: MocopiBleReceiverOptions) {
    this.port = opts.port;
    this.onPunchInput = opts.onPunchInput;
    this.onSessionChanged = opts.onSessionChanged ?? null;
    this.adapter = new MocopiBleAdapter({ noiseAngleDeg: opts.noiseAngleDeg });
  }

  // activeMode が mocopi-ble の時だけ emit。切替で連続性（前 quaternion）をリセット。
  setActive(active: boolean): void {
    if (active !== this.active) {
      this.active = active;
      this.adapter.reset();
      this.lastSessionId = null;
    }
  }

  resetPlay(): void {
    this.adapter.reset();
    this.lastSessionId = null;
  }

  start(): void {
    if (this.socket) {
      return;
    }
    const sock = createSocket("udp4");
    sock.on("message", (buf) => this.onMessage(buf));
    sock.on("error", () => {
      /* bind 失敗等は無視（diagnostics は将来）。アプリは落とさない。 */
    });
    sock.bind(this.port);
    this.socket = sock;
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private onMessage(buf: Buffer): void {
    if (!this.active) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      return; // 不正 JSON は破棄
    }
    if (!isMocopiBlePacket(parsed)) {
      return;
    }
    if (this.lastSessionId !== null && parsed.sessionId !== this.lastSessionId) {
      const previousSessionId = this.lastSessionId;
      this.adapter.reset();
      this.onSessionChanged?.({
        source: "mocopi-ble",
        previousSessionId,
        nextSessionId: parsed.sessionId,
        reason: "session-id-changed",
        occurredAtMs: Date.now(),
      });
    }
    this.lastSessionId = parsed.sessionId;
    const sample = this.adapter.fromPacket(parsed, Date.now());
    this.onPunchInput(sample);
  }
}
