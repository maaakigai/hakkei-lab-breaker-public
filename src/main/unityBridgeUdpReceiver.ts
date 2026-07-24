// src/main/unityBridgeUdpReceiver.ts
//
// Unity Bridge / Mock からの v1 UDP を受信し、検証・seq/session 管理・MotionSample 生成・
// status/heartbeat/error を発行する（SPEC.md 7.5, M5-01/08〜13）。
// 不正 datagram でもアプリを落とさない。active source の packet だけ motion:sample に流す。

import { createSocket, type Socket } from "node:dgram";
import type { InputConfig } from "../shared/configTypes.ts";
import type {
  AppErrorCode,
  AppErrorPayload,
  AppErrorSeverity,
  BridgePacketSource,
  InputMode,
  MotionDiagnosticsPayload,
  MotionHeartbeatPayload,
  MotionSample,
  MotionSource,
  MotionStatusPayload,
  ReceiverStatus,
  SessionChangedPayload,
  SourceStatusSnapshot,
  StatusWarning,
  StatusWarningCode,
} from "../shared/types.ts";
import { validateDatagram } from "./packetValidator.ts";
import { MotionSampleBuilder } from "./motionSampleBuilder.ts";
import { JitterTracker } from "./motionFilter.ts";

export type ReceiverEmitters = {
  onSample: (s: MotionSample) => void;
  onHeartbeat: (h: MotionHeartbeatPayload) => void;
  onStatus: (s: MotionStatusPayload) => void;
  onDiagnostics: (d: MotionDiagnosticsPayload) => void;
  onSessionChanged: (p: SessionChangedPayload) => void;
  onError: (e: AppErrorPayload) => void;
};

const WARNING_MESSAGES: Record<StatusWarningCode, string> = {
  UNKNOWN_FIELDS: "未知フィールドを検出しました",
  SEQ_GAP: "seq に欠落があります",
  TIMESTAMP_GAP: "timestamp に大きな間隔があります",
  LOW_SAMPLE_RATE: "入力頻度が低下しています",
  HEARTBEAT_TIMEOUT: "heartbeat が途絶しています",
  MOTION_TIMEOUT: "motion が途絶しています",
  AVATAR_NOT_READY: "Avatar が準備できていません",
  RIGHT_HAND_UNAVAILABLE: "右手が取得できません",
  NOT_TRACKED: "トラッキングされていません",
  COORDINATE_RANGE_WARN: "座標が想定範囲を超えています",
  DUPLICATE_SOURCE: "同一 source が重複しています",
  NON_ACTIVE_SOURCE_PACKET: "非アクティブ source の packet です",
  RECOVERED_FROM_UNAVAILABLE: "入力が回復しました",
  JITTER_WARN: "静止 jitter が閾値を超えています",
};

type SourceState = {
  source: BridgePacketSource;
  sessionId: string | null;
  prevSeq: number | null;
  prevTimestampMs: number | null;
  lastSeq: number | null;
  lastMotionAtMs: number | null;
  lastHeartbeatAtMs: number | null;
  motionTimes: number[];
  heartbeatTimes: number[];
  droppedFrameCount: number;
  invalidPacketCount: number;
  avatarReady: boolean | null;
  rightHandReady: boolean | null;
  receiverReady: boolean | null;
  receiverStatus: ReceiverStatus | null;
  builder: MotionSampleBuilder;
  jitter: JitterTracker;
  validWindow: Array<{ t: number; valid: boolean }>;
  warnings: Map<StatusWarningCode, StatusWarning>;
  errors: Set<AppErrorCode>;
  motionTimeoutFired: boolean;
  heartbeatTimeoutFired: boolean;
};

export class UnityBridgeUdpReceiver {
  private readonly input: InputConfig;
  private readonly emit: ReceiverEmitters;
  private readonly nowMs: () => number;

  private socket: Socket | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
  private activeMode: InputMode = "none";
  private globalInvalidPacketCount = 0;
  private readonly states = new Map<BridgePacketSource, SourceState>();

  constructor(input: InputConfig, emit: ReceiverEmitters, nowMs: () => number = () => Date.now()) {
    this.input = input;
    this.emit = emit;
    this.nowMs = nowMs;
  }

  start(): void {
    if (this.socket) {
      return;
    }
    const sock = createSocket("udp4");
    sock.on("message", (buf, rinfo) => {
      this.processDatagram(buf.toString("utf8"), buf.length, rinfo.address);
    });
    sock.on("error", () => {
      /* socket error はアプリを落とさない */
    });
    sock.bind(this.input.udp.port, this.input.udp.host);
    this.socket = sock;

    this.statusTimer = setInterval(() => {
      this.checkTimeouts();
      this.emitStatus();
    }, 250);
    // motion:diagnostics は 500ms 周期（SPEC.md 9.2）。
    this.diagnosticsTimer = setInterval(() => {
      this.emit.onDiagnostics(this.generateDiagnostics());
    }, 500);
  }

  stop(): void {
    if (this.statusTimer !== null) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.diagnosticsTimer !== null) {
      clearInterval(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }

  setActiveMode(mode: InputMode): void {
    this.activeMode = mode;
  }

  /** active source の filter / jitter を reset する（Calibration 開始時など, M8）。 */
  resetActiveFilter(): void {
    const active = this.activeSource();
    const st = active ? this.states.get(active) : undefined;
    if (st && st.sessionId !== null) {
      st.builder.reset(st.sessionId);
      st.jitter.reset();
      st.validWindow = [];
    }
  }

  private activeSource(): BridgePacketSource | null {
    if (this.activeMode === "unity-bridge") return "unity-bridge";
    if (this.activeMode === "mock-unity-bridge") return "mock-unity-bridge";
    return null;
  }

  private ensureState(source: BridgePacketSource): SourceState {
    let st = this.states.get(source);
    if (!st) {
      st = {
        source,
        sessionId: null,
        prevSeq: null,
        prevTimestampMs: null,
        lastSeq: null,
        lastMotionAtMs: null,
        lastHeartbeatAtMs: null,
        motionTimes: [],
        heartbeatTimes: [],
        droppedFrameCount: 0,
        invalidPacketCount: 0,
        avatarReady: null,
        rightHandReady: null,
        receiverReady: null,
        receiverStatus: null,
        builder: new MotionSampleBuilder(this.input),
        jitter: new JitterTracker(this.input.jitter.measurementWindowMs),
        validWindow: [],
        warnings: new Map(),
        errors: new Set(),
        motionTimeoutFired: false,
        heartbeatTimeoutFired: false,
      };
      this.states.set(source, st);
    }
    return st;
  }

  private addWarning(st: SourceState, code: StatusWarningCode): void {
    const now = this.nowMs();
    const existing = st.warnings.get(code);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAtMs = now;
    } else {
      st.warnings.set(code, {
        code,
        messageJa: WARNING_MESSAGES[code],
        source: st.source,
        sessionId: st.sessionId,
        firstSeenAtMs: now,
        lastSeenAtMs: now,
        count: 1,
      });
    }
  }

  private emitError(
    code: AppErrorCode,
    severity: AppErrorSeverity,
    messageJa: string,
    source: MotionSource | "unknown",
    sessionId: string | null,
  ): void {
    this.emit.onError({
      code,
      severity,
      recoverable: true,
      messageJa,
      source,
      sessionId,
      occurredAtMs: this.nowMs(),
    });
  }

  private hz(times: number[], now: number): number {
    const windowMs = 1000;
    while (times.length > 0 && now - times[0] > windowMs) {
      times.shift();
    }
    if (times.length < 2) {
      return times.length;
    }
    const span = (now - times[0]) / 1000;
    return span > 0 ? (times.length - 1) / span : times.length;
  }

  /** 受信した1 datagram を処理する（テストから直接呼べる）。 */
  processDatagram(text: string, byteLength: number, _remoteAddress: string): void {
    const now = this.nowMs();
    const res = validateDatagram(text, byteLength, this.input.udp.maxDatagramBytes);

    if (res.kind === "invalid") {
      if (res.source) {
        const st = this.ensureState(res.source);
        st.invalidPacketCount += 1;
        st.errors.add(res.code);
      } else {
        this.globalInvalidPacketCount += 1;
      }
      this.emitError(res.code, "warning", res.messageJa, res.source ?? "unknown", null);
      this.emitStatus();
      return;
    }

    const source = res.packet.source;
    const st = this.ensureState(source);

    // session 変更（valid な packet を確認してから確定）。
    if (st.sessionId !== res.packet.sessionId) {
      const previous = st.sessionId;
      st.sessionId = res.packet.sessionId;
      st.prevSeq = null;
      st.prevTimestampMs = null;
      st.builder.reset(res.packet.sessionId);
      st.jitter.reset();
      st.validWindow = [];
      st.motionTimeoutFired = false;
      st.heartbeatTimeoutFired = false;
      this.emit.onSessionChanged({
        source,
        previousSessionId: previous,
        nextSessionId: res.packet.sessionId,
        reason: previous === null ? "source-start" : "session-id-changed",
        occurredAtMs: now,
      });
    }

    if (res.kind === "motion") {
      const packet = res.packet;
      let seqGap = false;
      if (st.prevSeq !== null) {
        if (packet.seq < st.prevSeq) {
          st.errors.add("SEQ_ROLLBACK");
          this.emitError("SEQ_ROLLBACK", "warning", "seq が巻き戻りました", source, st.sessionId);
          this.emitStatus();
          return;
        }
        if (packet.seq === st.prevSeq) {
          st.errors.add("SEQ_DUPLICATE");
          this.emitError("SEQ_DUPLICATE", "warning", "seq が重複しました", source, st.sessionId);
          this.emitStatus();
          return;
        }
        if (packet.seq > st.prevSeq + 1) {
          seqGap = true;
          st.droppedFrameCount += packet.seq - st.prevSeq - 1;
          this.addWarning(st, "SEQ_GAP");
        }
      }
      if (st.prevTimestampMs !== null && packet.timestampMs <= st.prevTimestampMs) {
        st.errors.add("TIMESTAMP_ROLLBACK");
        this.emitError("TIMESTAMP_ROLLBACK", "warning", "timestamp が巻き戻りました", source, st.sessionId);
        this.emitStatus();
        return;
      }

      st.motionTimes.push(now);
      const measuredHz = this.hz(st.motionTimes, now);
      const sample = st.builder.build(packet, now, {
        seqGap,
        measuredHz,
        droppedFrameCount: st.droppedFrameCount,
      });

      // jitter（packet timestamp 基準）と validSampleRatio window を更新。
      st.jitter.add(sample.rawHandPosition, sample.handPosition, packet.timestampMs);
      st.validWindow.push({ t: now, valid: sample.validForScore });
      const cutoff = now - this.input.jitter.measurementWindowMs;
      while (st.validWindow.length > 0 && st.validWindow[0].t < cutoff) {
        st.validWindow.shift();
      }

      st.prevSeq = packet.seq;
      st.lastSeq = packet.seq;
      st.prevTimestampMs = packet.timestampMs;
      st.lastMotionAtMs = now;
      st.motionTimeoutFired = false;

      for (const f of sample.quality.flags) {
        if (f === "NOT_TRACKED") this.addWarning(st, "NOT_TRACKED");
        if (f === "AVATAR_NOT_READY") this.addWarning(st, "AVATAR_NOT_READY");
        if (f === "RIGHT_HAND_UNAVAILABLE") this.addWarning(st, "RIGHT_HAND_UNAVAILABLE");
        if (f === "COORDINATE_RANGE_WARN") this.addWarning(st, "COORDINATE_RANGE_WARN");
      }

      if (source === this.activeSource()) {
        this.emit.onSample(sample);
      } else {
        this.addWarning(st, "NON_ACTIVE_SOURCE_PACKET");
      }
      this.emitStatus();
      return;
    }

    // heartbeat
    const hb = res.packet;
    st.avatarReady = hb.avatarReady;
    st.rightHandReady = hb.rightHandReady;
    st.receiverReady = hb.receiverReady;
    st.receiverStatus = hb.receiverStatus;
    st.heartbeatTimes.push(now);
    st.lastHeartbeatAtMs = now;
    st.heartbeatTimeoutFired = false;
    if (!hb.avatarReady) this.addWarning(st, "AVATAR_NOT_READY");
    if (!hb.rightHandReady) this.addWarning(st, "RIGHT_HAND_UNAVAILABLE");

    if (source === this.activeSource()) {
      this.emit.onHeartbeat({
        protocolVersion: 1,
        source,
        sessionId: hb.sessionId,
        timestampMs: hb.timestampMs,
        receivedAtMs: now,
        receiverReady: hb.receiverReady,
        receiverStatus: hb.receiverStatus,
        avatarReady: hb.avatarReady,
        rightHandReady: hb.rightHandReady,
        frameRate: hb.frameRate,
        sendRateHz: hb.sendRateHz,
        isAlive: true,
        ageMs: 0,
      });
    }
    this.emitStatus();
  }

  private checkTimeouts(): void {
    const now = this.nowMs();
    const active = this.activeSource();
    if (active === null) {
      return;
    }
    const st = this.states.get(active);
    if (!st) {
      return;
    }
    if (
      st.lastMotionAtMs !== null &&
      now - st.lastMotionAtMs > this.input.udp.motionTimeoutMs &&
      !st.motionTimeoutFired
    ) {
      st.motionTimeoutFired = true;
      st.errors.add("MOTION_TIMEOUT");
      this.emitError("MOTION_TIMEOUT", "warning", "motion が途絶しました", active, st.sessionId);
    }
    if (
      st.lastHeartbeatAtMs !== null &&
      now - st.lastHeartbeatAtMs > this.input.udp.heartbeatTimeoutMs &&
      !st.heartbeatTimeoutFired
    ) {
      st.heartbeatTimeoutFired = true;
      st.errors.add("HEARTBEAT_TIMEOUT");
      this.emitError("HEARTBEAT_TIMEOUT", "warning", "heartbeat が途絶しました", active, st.sessionId);
    }
  }

  private snapshotFor(source: MotionSource): SourceStatusSnapshot {
    const now = this.nowMs();
    const st = source !== "keyboard" ? this.states.get(source as BridgePacketSource) : undefined;
    if (!st) {
      return {
        source,
        isReceiving: false,
        currentSessionId: null,
        lastMotionAtMs: null,
        lastHeartbeatAtMs: null,
        motionHz: 0,
        heartbeatHz: 0,
        avatarReady: null,
        rightHandReady: null,
        receiverReady: null,
        receiverStatus: null,
        lastSeq: null,
        droppedFrameCount: 0,
        invalidPacketCount: 0,
        validSampleRatio: null,
        warnings: [],
        errors: [],
      };
    }
    return {
      source,
      isReceiving: st.lastMotionAtMs !== null && now - st.lastMotionAtMs <= this.input.udp.motionTimeoutMs,
      currentSessionId: st.sessionId,
      lastMotionAtMs: st.lastMotionAtMs,
      lastHeartbeatAtMs: st.lastHeartbeatAtMs,
      motionHz: this.hz(st.motionTimes, now),
      heartbeatHz: this.hz(st.heartbeatTimes, now),
      avatarReady: st.avatarReady,
      rightHandReady: st.rightHandReady,
      receiverReady: st.receiverReady,
      receiverStatus: st.receiverStatus,
      lastSeq: st.lastSeq,
      droppedFrameCount: st.droppedFrameCount,
      invalidPacketCount: st.invalidPacketCount,
      validSampleRatio: null, // M7 で算出
      warnings: [...st.warnings.values()],
      errors: [...st.errors],
    };
  }

  generateStatus(): MotionStatusPayload {
    const active = this.activeSource();
    const activeState = active ? this.states.get(active) : undefined;
    return {
      activeMode: this.activeMode,
      generatedAtMs: this.nowMs(),
      globalInvalidPacketCount: this.globalInvalidPacketCount,
      sourceStatuses: {
        keyboard: this.snapshotFor("keyboard"),
        "unity-bridge": this.snapshotFor("unity-bridge"),
        "mock-unity-bridge": this.snapshotFor("mock-unity-bridge"),
      },
      activeWarnings: activeState ? [...activeState.warnings.values()] : [],
      activeErrors: activeState ? [...activeState.errors] : [],
    };
  }

  private emitStatus(): void {
    this.emit.onStatus(this.generateStatus());
  }

  private validSampleRatioFor(st: SourceState): number | null {
    if (st.validWindow.length === 0) {
      return null;
    }
    const valid = st.validWindow.filter((w) => w.valid).length;
    return valid / st.validWindow.length;
  }

  generateDiagnostics(): MotionDiagnosticsPayload {
    const active = this.activeSource();
    const st = active ? this.states.get(active) : undefined;
    const m = st
      ? st.jitter.metrics()
      : {
          rawJitterRms2s: null,
          rawMaxJitter2s: null,
          rawDrift2s: null,
          filteredJitterRms2s: null,
          filteredMaxJitter2s: null,
          filteredDrift2s: null,
        };
    return {
      activeMode: this.activeMode,
      source: active,
      sessionId: st?.sessionId ?? null,
      generatedAtMs: this.nowMs(),
      windows: {
        motionHzWindowMs: 1000,
        jitterWindowMs: this.input.jitter.measurementWindowMs,
        hakkeiStaticWindowMs: this.input.jitter.staticFalseHakkeiWindowMs,
      },
      rawJitterRms2s: m.rawJitterRms2s,
      rawMaxJitter2s: m.rawMaxJitter2s,
      rawDrift2s: m.rawDrift2s,
      filteredJitterRms2s: m.filteredJitterRms2s,
      filteredMaxJitter2s: m.filteredMaxJitter2s,
      filteredDrift2s: m.filteredDrift2s,
      validSampleRatio: st ? this.validSampleRatioFor(st) : null,
      validSampleRatioByPhase: {},
    };
  }
}
