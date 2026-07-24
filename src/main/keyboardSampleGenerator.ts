// src/main/keyboardSampleGenerator.ts
//
// Main-owned keyboard MotionSample generator. Renderer only forwards key events.

import type { KeyboardConfig } from "../shared/configTypes.ts";
import type {
  HandMotion,
  KeyboardControlPayload,
  KeyboardKey,
  MotionQualityFlag,
  MotionSample,
  Vec3,
} from "../shared/types.ts";

type Pressed = Record<KeyboardKey, boolean>;

function emptyPressed(): Pressed {
  return {
    Space: false,
    KeyA: false,
    KeyD: false,
    KeyL: false,
    KeyH: false, // dev: 利き手トグル（generator では未使用・§0.23.9）
    Enter: false,
    KeyR: false,
    Escape: false,
  };
}

export type SessionInfo = { sessionId: string; reason: "keyboard-start" | "reset-play" };

export class KeyboardSampleGenerator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pressed: Pressed = emptyPressed();

  private sessionId = "";
  private seq = 0;
  private sessionStartMs = 0;
  private lastTickMs = 0;

  private lastRightPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastRightVel: Vec3 = { x: 0, y: 0, z: 0 };
  private lastLeftPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastLeftVel: Vec3 = { x: 0, y: 0, z: 0 };

  private rightChargePosY = 0;
  private rightChargePosZ = 0;
  private rightChargeSign = 0;
  private leftChargePosY = 0;
  private leftChargePosZ = 0;
  private leftChargeSign = 0;
  private enterPulseStartMs: number | null = null;
  // Enter パンチの固定 intensity impulse（timing 非依存・§debug）。down-edge で数 tick だけ載せる。
  private enterImpulseTicksLeft = 0;

  private rateWindowStartMs = 0;
  private rateCount = 0;
  private measuredHz = 0;

  private readonly onSample: (sample: MotionSample) => void;
  private readonly onSession: (info: SessionInfo) => void;
  private readonly cfg: KeyboardConfig;
  private readonly nowMs: () => number;

  constructor(
    onSample: (sample: MotionSample) => void,
    onSession: (info: SessionInfo) => void,
    cfg: KeyboardConfig,
    nowMs: () => number = () => Date.now(),
  ) {
    this.onSample = onSample;
    this.onSession = onSession;
    this.cfg = cfg;
    this.nowMs = nowMs;
  }

  start(reason: "keyboard-start" | "reset-play" = "keyboard-start"): void {
    this.stop();
    this.openSession(reason);
    const intervalMs = 1000 / this.cfg.sampleRateHz;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pressed = emptyPressed();
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  resetPlay(): void {
    if (!this.isRunning()) {
      return;
    }
    this.openSession("reset-play");
  }

  handleControl(payload: KeyboardControlPayload): void {
    if (payload.type === "command" && payload.command === "reset-pressed-state") {
      this.pressed = emptyPressed();
      return;
    }
    if (payload.type !== "key") {
      return;
    }

    const wasPressed = this.pressed[payload.key];
    this.pressed[payload.key] = payload.pressed;
    const downEdge = payload.pressed && !wasPressed;

    if (payload.key === "Space" && downEdge) {
      this.rightChargeSign = this.rightChargeSign > 0 ? -1 : 1;
    }
    if (payload.key === this.cfg.leftChargeKey && downEdge) {
      this.leftChargeSign = this.leftChargeSign > 0 ? -1 : 1;
    }
    if (payload.key === "Enter" && downEdge) {
      this.enterPulseStartMs = this.nowMs() - this.sessionStartMs;
      this.enterImpulseTicksLeft = 2; // 次の2 sample に固定 punch intensity を載せる。
    }
  }

  openSession(reason: "keyboard-start" | "reset-play"): void {
    const now = this.nowMs();
    this.sessionId = `keyboard-${Math.floor(now)}`;
    this.seq = 0;
    this.sessionStartMs = now;
    this.lastTickMs = now;
    this.lastRightPos = { x: 0, y: 0, z: 0 };
    this.lastRightVel = { x: 0, y: 0, z: 0 };
    this.lastLeftPos = { x: 0, y: 0, z: 0 };
    this.lastLeftVel = { x: 0, y: 0, z: 0 };
    this.rightChargePosY = 0;
    this.rightChargePosZ = 0;
    this.rightChargeSign = 0;
    this.leftChargePosY = 0;
    this.leftChargePosZ = 0;
    this.leftChargeSign = 0;
    this.enterPulseStartMs = null;
    this.enterImpulseTicksLeft = 0;
    this.rateWindowStartMs = now;
    this.rateCount = 0;
    this.onSession({ sessionId: this.sessionId, reason });
  }

  tick(): void {
    const now = this.nowMs();
    const tMs = now - this.sessionStartMs;
    let dtMs = now - this.lastTickMs;
    if (dtMs <= 0) {
      dtMs = 1000 / this.cfg.sampleRateHz;
    }
    const dt = dtMs / 1000;
    this.lastTickMs = now;

    const rightPos = this.computeRightPosition(tMs, dt);
    const leftPos = this.computeLeftPosition(tMs, dt);
    const rightVelocity = velocity(rightPos, this.lastRightPos, dt);
    const leftVelocity = velocity(leftPos, this.lastLeftPos, dt);
    let rightAcceleration = velocity(rightVelocity, this.lastRightVel, dt);
    const leftAcceleration = velocity(leftVelocity, this.lastLeftVel, dt);

    // Enter パンチ: 位置パルスの |accel| は frame dt 依存で発火が不安定なため、down-edge 後の
    // 数sampleだけ固定の前方acceleration（|accel|=enterPunchIntensity）に置き、frame timingへの依存を避ける。
    if (this.enterImpulseTicksLeft > 0) {
      this.enterImpulseTicksLeft -= 1;
      rightAcceleration = { x: 0, y: 0, z: this.cfg.enterPunchIntensity };
    }

    this.lastRightPos = rightPos;
    this.lastRightVel = rightVelocity;
    this.lastLeftPos = leftPos;
    this.lastLeftVel = leftVelocity;

    this.rateCount += 1;
    if (now - this.rateWindowStartMs >= 1000) {
      this.measuredHz = (this.rateCount * 1000) / (now - this.rateWindowStartMs);
      this.rateWindowStartMs = now;
      this.rateCount = 0;
    }

    const quality = this.quality(dtMs);
    const sample: MotionSample = {
      protocolVersion: 1,
      source: "keyboard",
      sessionId: this.sessionId,
      seq: this.seq++,
      timestampMs: Math.round(tMs),
      receivedAtMs: Math.round(now),
      rawHandPosition: rightPos,
      handPosition: rightPos,
      velocity: rightVelocity,
      acceleration: rightAcceleration,
      isAvailable: true,
      validForScore: true,
      validForCalibration: true,
      leftHand: this.handMotion(leftPos, leftVelocity, leftAcceleration, dtMs),
      quality,
    };

    this.onSample(sample);
  }

  private computeRightPosition(tMs: number, dt: number): Vec3 {
    const targetY = this.rightChargeSign * this.cfg.tapVerticalStepM;
    const targetZ = this.rightChargeSign * this.cfg.tapForwardStepM;
    const maxMove = this.cfg.tapSpeedMps * dt;
    this.rightChargePosY += clamp(targetY - this.rightChargePosY, -maxMove, maxMove);
    this.rightChargePosZ += clamp(targetZ - this.rightChargePosZ, -maxMove, maxMove);

    let zPulse = 0;
    if (this.enterPulseStartMs !== null) {
      const elapsed = tMs - this.enterPulseStartMs;
      if (elapsed >= 0 && elapsed <= this.cfg.enterDurationMs) {
        const p = elapsed / this.cfg.enterDurationMs;
        zPulse = this.cfg.enterForwardDisplacementM * p * p;
      } else if (elapsed > this.cfg.enterDurationMs) {
        this.enterPulseStartMs = null;
      }
    }

    return { x: 0, y: this.rightChargePosY, z: this.rightChargePosZ + zPulse };
  }

  private computeLeftPosition(tMs: number, dt: number): Vec3 {
    const targetY = this.leftChargeSign * this.cfg.tapVerticalStepM;
    const targetZ = -this.leftChargeSign * this.cfg.tapForwardStepM;
    const maxMove = this.cfg.tapSpeedMps * dt;
    this.leftChargePosY += clamp(targetY - this.leftChargePosY, -maxMove, maxMove);
    this.leftChargePosZ += clamp(targetZ - this.leftChargePosZ, -maxMove, maxMove);
    return { x: 0, y: this.leftChargePosY, z: this.leftChargePosZ + this.enterPulseZ(tMs) };
  }

  private enterPulseZ(tMs: number): number {
    if (this.enterPulseStartMs === null) {
      return 0;
    }
    const elapsed = tMs - this.enterPulseStartMs;
    if (elapsed < 0 || elapsed > this.cfg.enterDurationMs) {
      return 0;
    }
    const p = elapsed / this.cfg.enterDurationMs;
    return this.cfg.enterForwardDisplacementM * p * p;
  }

  private handMotion(pos: Vec3, vel: Vec3, acc: Vec3, dtMs: number): HandMotion {
    return {
      rawHandPosition: pos,
      handPosition: pos,
      velocity: vel,
      acceleration: acc,
      isAvailable: true,
      validForScore: true,
      validForCalibration: true,
      quality: this.quality(dtMs),
    };
  }

  private quality(dtMs: number): HandMotion["quality"] {
    const flags: MotionQualityFlag[] = [];
    return {
      dtMs,
      sampleRateHz: this.measuredHz || this.cfg.sampleRateHz,
      isFiltered: false,
      droppedFrameCount: 0,
      invalidPacketCount: 0,
      flags,
    };
  }
}

function velocity(current: Vec3, previous: Vec3, dt: number): Vec3 {
  return {
    x: (current.x - previous.x) / dt,
    y: (current.y - previous.y) / dt,
    z: (current.z - previous.z) / dt,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
