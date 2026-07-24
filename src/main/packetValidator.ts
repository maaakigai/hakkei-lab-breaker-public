// src/main/packetValidator.ts
//
// Unity Bridge / Mock からの v2 datagram（両手）を検証する（SPEC.md 7.2〜7.4, M5-03〜07）。
// 不正でも例外を投げず、判別可能な結果を返す（呼び出し側がカウント・warning化する）。
//
// 両手v2 必須化: protocolVersion=2 のみ受理する。v1（右手のみ）は
// UNSUPPORTED_PROTOCOL_VERSION で明示拒否し、Unity Bridge の再ビルドを促す。

import type {
  AppErrorCode,
  BridgePacketSource,
  ReceiverStatus,
  UnityHeartbeatPacketV2,
  UnityMotionPacketV2,
  Vec3,
} from "../shared/types.ts";

export type ValidationResult =
  | { kind: "motion"; packet: UnityMotionPacketV2 }
  | { kind: "heartbeat"; packet: UnityHeartbeatPacketV2 }
  | { kind: "invalid"; code: AppErrorCode; messageJa: string; source: BridgePacketSource | null };

const RECEIVER_STATUSES: ReceiverStatus[] = ["not-started", "receiving", "stale", "error"];

function invalid(
  code: AppErrorCode,
  messageJa: string,
  source: BridgePacketSource | null,
): ValidationResult {
  return { kind: "invalid", code, messageJa, source };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return isRecord(v) && isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

function isAscii1to64(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > 64) {
    return false;
  }
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
}

function readSource(raw: Record<string, unknown>): BridgePacketSource | null {
  return raw.source === "unity-bridge" || raw.source === "mock-unity-bridge" ? raw.source : null;
}

/**
 * datagram(文字列) と byte 長を検証する。
 * maxDatagramBytes 超過は JSON_TOO_LARGE、parse 失敗は INVALID_JSON。
 */
export function validateDatagram(
  text: string,
  byteLength: number,
  maxDatagramBytes: number,
): ValidationResult {
  if (byteLength > maxDatagramBytes) {
    return invalid("JSON_TOO_LARGE", "Unity Bridge出力が大きすぎます", null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid("INVALID_JSON", "Unity Bridge出力形式エラー", null);
  }

  if (!isRecord(parsed)) {
    return invalid("INVALID_PACKET_BASE", "Unity Bridge共通項目エラー", null);
  }

  const source = readSource(parsed);

  // 共通 base（SPEC.md 7.2）。両手v2 必須: protocolVersion=2 のみ受理する。
  // v1（右手のみ）は UNSUPPORTED_PROTOCOL_VERSION で明示拒否（Unity 再ビルドを促す）。
  if (parsed.protocolVersion === 1) {
    return invalid(
      "UNSUPPORTED_PROTOCOL_VERSION",
      "Unity Bridge が旧 protocol v1 です。両手 v2 が必須のため Unity を再ビルドしてください",
      source,
    );
  }
  if (parsed.protocolVersion !== 2) {
    return invalid("INVALID_PACKET_BASE", "protocolVersion が不正です", source);
  }
  if (parsed.type !== "motion" && parsed.type !== "heartbeat") {
    return invalid("UNKNOWN_PACKET_TYPE", "Unity Bridge出力typeが不明です", source);
  }
  if (source === null) {
    return invalid("INVALID_PACKET_BASE", "source が不正です", null);
  }
  if (!isAscii1to64(parsed.sessionId)) {
    return invalid("INVALID_PACKET_BASE", "sessionId が不正です", source);
  }
  if (!isFiniteNum(parsed.timestampMs) || !Number.isSafeInteger(parsed.timestampMs) || parsed.timestampMs < 0) {
    return invalid("INVALID_PACKET_BASE", "timestampMs が不正です", source);
  }

  if (parsed.type === "motion") {
    return validateMotion(parsed, source);
  }
  return validateHeartbeat(parsed, source);
}

function validateMotion(raw: Record<string, unknown>, source: BridgePacketSource): ValidationResult {
  if (!isFiniteNum(raw.seq) || !Number.isSafeInteger(raw.seq) || raw.seq < 0) {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（seq）", source);
  }
  if (typeof raw.isTracked !== "boolean") {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（isTracked）", source);
  }
  if (!isRecord(raw.avatar)) {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（avatar）", source);
  }
  const avatar = raw.avatar;
  if (typeof avatar.isHuman !== "boolean" || typeof avatar.hasRightHand !== "boolean") {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（avatar fields）", source);
  }
  if (typeof avatar.hasLeftHand !== "boolean") {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（avatar.hasLeftHand）", source);
  }
  if (avatar.forward !== undefined && avatar.forward !== null && !isVec3(avatar.forward)) {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（forward）", source);
  }

  const available = raw.isTracked && avatar.isHuman && avatar.hasRightHand;
  if (available) {
    // tracked かつ avatar 利用可能なら rightHand 必須・有限。
    if (!isVec3(raw.rightHand)) {
      return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（rightHand）", source);
    }
  } else if (raw.rightHand !== undefined && raw.rightHand !== null && !isVec3(raw.rightHand)) {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（rightHand型）", source);
  }

  const leftAvailable = raw.isTracked && avatar.isHuman && avatar.hasLeftHand;
  if (leftAvailable) {
    if (!isVec3(raw.leftHand)) {
      return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（leftHand）", source);
    }
  } else if (raw.leftHand !== undefined && raw.leftHand !== null && !isVec3(raw.leftHand)) {
    return invalid("INVALID_MOTION_PACKET", "motion JSON形式エラー（leftHand型）", source);
  }
  return { kind: "motion", packet: raw as unknown as UnityMotionPacketV2 };
}

function validateHeartbeat(raw: Record<string, unknown>, source: BridgePacketSource): ValidationResult {
  if (typeof raw.receiverReady !== "boolean") {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（receiverReady）", source);
  }
  if (typeof raw.receiverStatus !== "string" || !RECEIVER_STATUSES.includes(raw.receiverStatus as ReceiverStatus)) {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（receiverStatus）", source);
  }
  if (typeof raw.avatarReady !== "boolean" || typeof raw.rightHandReady !== "boolean") {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（ready flags）", source);
  }
  if (typeof raw.leftHandReady !== "boolean") {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（leftHandReady）", source);
  }
  if (!isFiniteNum(raw.frameRate) || raw.frameRate <= 0) {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（frameRate）", source);
  }
  if (!isFiniteNum(raw.sendRateHz) || raw.sendRateHz <= 0) {
    return invalid("INVALID_HEARTBEAT_PACKET", "heartbeat形式エラー（sendRateHz）", source);
  }
  return { kind: "heartbeat", packet: raw as unknown as UnityHeartbeatPacketV2 };
}
