// src/main/motionSampleBuilder.ts
//
// Builds Main-owned MotionSample values from validated Unity motion packets.
// Existing top-level MotionSample fields remain the right hand for backward compatibility.

import type { InputConfig } from "../shared/configTypes.ts";
import type {
  HandMotion,
  MotionQualityFlag,
  MotionSample,
  UnityMotionPacketV1,
  UnityMotionPacketV2,
  Vec3,
} from "../shared/types.ts";
import { MotionFilter } from "./motionFilter.ts";

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export type BuildContext = { seqGap: boolean; measuredHz: number; droppedFrameCount: number };

export class MotionSampleBuilder {
  private readonly coord: InputConfig["coordinates"];
  private readonly rightFilter: MotionFilter;
  private readonly leftFilter: MotionFilter;
  private sessionId: string | null = null;
  private prevTimestampMs: number | null = null;
  private lastValidRightRaw: Vec3 = { ...ZERO };
  private lastValidLeftRaw: Vec3 = { ...ZERO };

  constructor(input: InputConfig) {
    this.coord = input.coordinates;
    this.rightFilter = new MotionFilter(input.filter);
    this.leftFilter = new MotionFilter(input.filter);
  }

  reset(sessionId: string): void {
    this.sessionId = sessionId;
    this.prevTimestampMs = null;
    this.rightFilter.reset();
    this.leftFilter.reset();
  }

  private applyCoordinates(v: Vec3): Vec3 {
    const c = this.coord;
    const mapped: Vec3 = { x: v[c.axisMap.x], y: v[c.axisMap.y], z: v[c.axisMap.z] };
    return {
      x: mapped.x * c.sign.x * c.scaleMultiplier + c.offset.x,
      y: mapped.y * c.sign.y * c.scaleMultiplier + c.offset.y,
      z: mapped.z * c.sign.z * c.scaleMultiplier + c.offset.z,
    };
  }

  private buildHand(
    handPosition: Vec3 | null | undefined,
    available: boolean,
    baseFlags: MotionQualityFlag[],
    lastValidRaw: Vec3,
    filter: MotionFilter,
    dtMs: number,
    ctx: BuildContext,
  ): { hand: HandMotion; nextLastValidRaw: Vec3 } {
    const flags: MotionQualityFlag[] = [...baseFlags];
    let rawHandPosition: Vec3;
    let nextLastValidRaw = lastValidRaw;

    if (available && handPosition) {
      rawHandPosition = this.applyCoordinates(handPosition);
      nextLastValidRaw = rawHandPosition;
    } else {
      rawHandPosition = { ...lastValidRaw };
    }

    const absMax = Math.max(Math.abs(rawHandPosition.x), Math.abs(rawHandPosition.y), Math.abs(rawHandPosition.z));
    if (available && absMax > this.coord.coordinateWarnAbsM) {
      flags.push("COORDINATE_RANGE_WARN");
    }

    const fr = filter.process(rawHandPosition, dtMs, available);
    for (const f of fr.flags) {
      flags.push(f);
    }
    const validForScore = available && fr.validForScore;

    return {
      hand: {
        rawHandPosition,
        handPosition: fr.filteredPosition,
        velocity: fr.velocity,
        acceleration: fr.acceleration,
        isAvailable: available,
        validForScore,
        validForCalibration: validForScore,
        quality: {
          dtMs,
          sampleRateHz: ctx.measuredHz,
          isFiltered: true,
          droppedFrameCount: ctx.droppedFrameCount,
          invalidPacketCount: 0,
          flags,
        },
      },
      nextLastValidRaw,
    };
  }

  build(packet: UnityMotionPacketV1 | UnityMotionPacketV2, receivedAtMs: number, ctx: BuildContext): MotionSample {
    if (this.sessionId !== packet.sessionId) {
      this.reset(packet.sessionId);
    }

    const dtMs = this.prevTimestampMs !== null ? packet.timestampMs - this.prevTimestampMs : 0;
    this.prevTimestampMs = packet.timestampMs;

    const rightAvailable = packet.isTracked && packet.avatar.isHuman && packet.avatar.hasRightHand;
    const rightFlags: MotionQualityFlag[] = [];
    if (!packet.isTracked) rightFlags.push("NOT_TRACKED");
    if (!packet.avatar.isHuman) rightFlags.push("AVATAR_NOT_READY");
    if (!packet.avatar.hasRightHand) rightFlags.push("RIGHT_HAND_UNAVAILABLE");
    if (ctx.seqGap) rightFlags.push("SEQ_GAP");

    const right = this.buildHand(
      packet.rightHand,
      rightAvailable,
      rightFlags,
      this.lastValidRightRaw,
      this.rightFilter,
      dtMs,
      ctx,
    );
    this.lastValidRightRaw = right.nextLastValidRaw;

    let leftHand: HandMotion | null = null;
    if (packet.protocolVersion === 2) {
      const leftAvailable = packet.isTracked && packet.avatar.isHuman && packet.avatar.hasLeftHand;
      const leftFlags: MotionQualityFlag[] = [];
      if (!packet.isTracked) leftFlags.push("NOT_TRACKED");
      if (!packet.avatar.isHuman) leftFlags.push("AVATAR_NOT_READY");
      if (ctx.seqGap) leftFlags.push("SEQ_GAP");

      const left = this.buildHand(
        packet.leftHand,
        leftAvailable,
        leftFlags,
        this.lastValidLeftRaw,
        this.leftFilter,
        dtMs,
        ctx,
      );
      this.lastValidLeftRaw = left.nextLastValidRaw;
      leftHand = left.hand;
    }

    return {
      protocolVersion: 1,
      source: packet.source,
      sessionId: packet.sessionId,
      seq: packet.seq,
      timestampMs: packet.timestampMs,
      receivedAtMs,
      rawHandPosition: right.hand.rawHandPosition,
      handPosition: right.hand.handPosition,
      velocity: right.hand.velocity,
      acceleration: right.hand.acceleration,
      isAvailable: right.hand.isAvailable,
      validForScore: right.hand.validForScore,
      validForCalibration: right.hand.validForCalibration,
      leftHand,
      quality: right.hand.quality,
    };
  }
}
