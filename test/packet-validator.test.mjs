// test/packet-validator.test.mjs
// M5-03/04/05/06/07: motion/heartbeat 検証、seq欠損、不正JSON、unknown type。
import test from "node:test";
import assert from "node:assert/strict";
import { validateDatagram } from "../src/main/packetValidator.ts";

const MAX = 8192;
const J = (o) => JSON.stringify(o);
const bytes = (s) => Buffer.byteLength(s, "utf8");
const run = (o) => {
  const s = typeof o === "string" ? o : J(o);
  return validateDatagram(s, bytes(s), MAX);
};

// 両手v2 必須化: baseline は v2（両手）。v1 は UNSUPPORTED_PROTOCOL_VERSION で拒否される。
const validMotion = {
  protocolVersion: 2,
  type: "motion",
  sessionId: "unity-1",
  seq: 5,
  timestampMs: 123,
  source: "unity-bridge",
  isTracked: true,
  rightHand: { x: 0.1, y: 1.2, z: -0.3 },
  leftHand: { x: -0.1, y: 1.1, z: -0.2 },
  avatar: { isHuman: true, hasRightHand: true, hasLeftHand: true, forward: { x: 0, y: 0, z: 1 } },
};

const validHeartbeat = {
  protocolVersion: 2,
  type: "heartbeat",
  sessionId: "unity-1",
  timestampMs: 123,
  source: "unity-bridge",
  receiverReady: true,
  receiverStatus: "receiving",
  avatarReady: true,
  rightHandReady: true,
  leftHandReady: true,
  frameRate: 60,
  sendRateHz: 30,
};

// v1（両手フィールド無し）の packet。v2 必須化で拒否されることの確認に使う。
const v1Motion = {
  protocolVersion: 1,
  type: "motion",
  sessionId: "unity-1",
  seq: 5,
  timestampMs: 123,
  source: "unity-bridge",
  isTracked: true,
  rightHand: { x: 0.1, y: 1.2, z: -0.3 },
  avatar: { isHuman: true, hasRightHand: true, forward: { x: 0, y: 0, z: 1 } },
};

const v1Heartbeat = {
  protocolVersion: 1,
  type: "heartbeat",
  sessionId: "unity-1",
  timestampMs: 123,
  source: "unity-bridge",
  receiverReady: true,
  receiverStatus: "receiving",
  avatarReady: true,
  rightHandReady: true,
  frameRate: 60,
  sendRateHz: 30,
};

test("正常 motion は通る (M5-03)", () => {
  const r = run(validMotion);
  assert.equal(r.kind, "motion");
});

test("正常 heartbeat は通る (M5-05)", () => {
  const r = run(validHeartbeat);
  assert.equal(r.kind, "heartbeat");
});

test("seq 欠損は INVALID_MOTION_PACKET (M5-04)", () => {
  const { seq, ...noSeq } = validMotion;
  void seq;
  const r = run(noSeq);
  assert.equal(r.kind, "invalid");
  assert.equal(r.code, "INVALID_MOTION_PACKET");
});

test("seq が非 safe integer は INVALID_MOTION_PACKET (M5-04)", () => {
  const r = run({ ...validMotion, seq: 1.5 });
  assert.equal(r.code, "INVALID_MOTION_PACKET");
});

test("壊れた JSON は INVALID_JSON (M5-06)", () => {
  const r = run("{ not json ");
  assert.equal(r.kind, "invalid");
  assert.equal(r.code, "INVALID_JSON");
});

test("datagram 上限超過は JSON_TOO_LARGE (M5-06)", () => {
  const big = J({ ...validMotion, pad: "x".repeat(9000) });
  const r = validateDatagram(big, bytes(big), MAX);
  assert.equal(r.code, "JSON_TOO_LARGE");
});

test("unknown type は UNKNOWN_PACKET_TYPE (M5-07)", () => {
  const r = run({ ...validMotion, type: "wat" });
  assert.equal(r.code, "UNKNOWN_PACKET_TYPE");
});

test("protocolVersion/source/sessionId/timestamp 不正は INVALID_PACKET_BASE", () => {
  assert.equal(run({ ...validMotion, protocolVersion: 3 }).code, "INVALID_PACKET_BASE");
  assert.equal(run({ ...validMotion, source: "evil" }).code, "INVALID_PACKET_BASE");
  assert.equal(run({ ...validMotion, sessionId: "" }).code, "INVALID_PACKET_BASE");
  assert.equal(run({ ...validMotion, timestampMs: -1 }).code, "INVALID_PACKET_BASE");
});

test("protocolVersion=1 は UNSUPPORTED_PROTOCOL_VERSION で拒否（両手v2 必須化）", () => {
  const rm = run(v1Motion);
  assert.equal(rm.kind, "invalid");
  assert.equal(rm.code, "UNSUPPORTED_PROTOCOL_VERSION");
  const rh = run(v1Heartbeat);
  assert.equal(rh.kind, "invalid");
  assert.equal(rh.code, "UNSUPPORTED_PROTOCOL_VERSION");
});

test("tracked なのに rightHand 欠損は INVALID_MOTION_PACKET", () => {
  const { rightHand, ...noHand } = validMotion;
  void rightHand;
  assert.equal(run(noHand).code, "INVALID_MOTION_PACKET");
});

test("isTracked=false は rightHand=null でも valid（unavailable packet）", () => {
  const r = run({
    ...validMotion,
    isTracked: false,
    rightHand: null,
    leftHand: null,
    avatar: { isHuman: true, hasRightHand: false, hasLeftHand: false, forward: { x: 0, y: 0, z: 1 } },
  });
  assert.equal(r.kind, "motion");
});

test("heartbeat の frameRate<=0 は INVALID_HEARTBEAT_PACKET", () => {
  assert.equal(run({ ...validHeartbeat, frameRate: 0 }).code, "INVALID_HEARTBEAT_PACKET");
});

test("v2 motion with both hands is valid", () => {
  const r = run(validMotion);
  assert.equal(r.kind, "motion");
});

test("v2 motion requires leftHand when left hand is available", () => {
  const { leftHand, ...noLeftHand } = validMotion;
  void leftHand;
  const r = run(noLeftHand);
  assert.equal(r.kind, "invalid");
  assert.equal(r.code, "INVALID_MOTION_PACKET");
});

test("v2 heartbeat requires leftHandReady", () => {
  const { leftHandReady, ...noLeftHandReady } = validHeartbeat;
  void leftHandReady;
  const r = run(noLeftHandReady);
  assert.equal(r.kind, "invalid");
  assert.equal(r.code, "INVALID_HEARTBEAT_PACKET");
});

test("v2 motion with hasLeftHand=false and no leftHand is valid (left unavailable)", () => {
  const { leftHand, ...noLeft } = validMotion;
  void leftHand;
  const r = run({
    ...noLeft,
    avatar: { isHuman: true, hasRightHand: true, hasLeftHand: false, forward: { x: 0, y: 0, z: 1 } },
  });
  assert.equal(r.kind, "motion");
});

test("v2 motion with non-boolean hasLeftHand is INVALID_MOTION_PACKET", () => {
  const r = run({
    ...validMotion,
    avatar: { isHuman: true, hasRightHand: true, hasLeftHand: "yes", forward: { x: 0, y: 0, z: 1 } },
  });
  assert.equal(r.code, "INVALID_MOTION_PACKET");
});
