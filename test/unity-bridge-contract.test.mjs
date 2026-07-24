// test/unity-bridge-contract.test.mjs
// M9 / 両手v2: Unity Bridge (RightHandUdpSender.cs) が出力する v2 JSON 文字列が、
// Electron Main の packetValidator にそのまま通ることをクロス検証する（Gate B1 のデータ契約）。
//
// 下の golden 文字列は RightHandUdpSender.cs の
//   AppendCommon() + SendMotionPacket() / SendHeartbeatPacket() + AppendVec3() + FormatFloat("0.######")
// が生成する出力を「バイト列まで含めて」手で再現したもの。C# 側のフォーマットを変えたら
// このテストが落ちるので、契約のドリフトに気付ける。
// 両手v2では protocolVersion=2・leftHand・avatar.hasLeftHand・heartbeat.leftHandReady が増えている。
// キー順は C# の Append 順そのまま（rightHand → leftHand → avatar{isHuman,hasRightHand,hasLeftHand,forward}）。
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateDatagram } from "../src/main/packetValidator.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const maxBytes = loaded.value.input.udp.maxDatagramBytes;

function check(text) {
  return validateDatagram(text, Buffer.byteLength(text, "utf8"), maxBytes);
}

// FormatFloat("0.######"): 0 -> "0", 1 -> "1", 末尾ゼロ無し。AppendCommon の key 順も C# のまま。
// 両手 tracked: rightHand と leftHand の両方が座標、avatar.hasLeftHand=true。
const MOTION_TRACKED =
  '{"protocolVersion":2,"type":"motion","sessionId":"unity-20260623-120000-042",' +
  '"timestampMs":1234,"source":"unity-bridge","seq":0,"isTracked":true,' +
  '"rightHand":{"x":0.123456,"y":1.234567,"z":-0.333333},' +
  '"leftHand":{"x":-0.123456,"y":1.111111,"z":-0.222222},' +
  '"avatar":{"isHuman":true,"hasRightHand":true,"hasLeftHand":true,"forward":{"x":0,"y":0,"z":1}}}';

// isTracked=false の unavailable packet: rightHand/leftHand は null、avatar フラグも false。
const MOTION_UNAVAILABLE =
  '{"protocolVersion":2,"type":"motion","sessionId":"unity-20260623-120000-042",' +
  '"timestampMs":67,"source":"unity-bridge","seq":7,"isTracked":false,' +
  '"rightHand":null,"leftHand":null,' +
  '"avatar":{"isHuman":false,"hasRightHand":false,"hasLeftHand":false,"forward":{"x":0,"y":0,"z":1}}}';

// 右手のみ tracked・左手未取得（avatar.hasLeftHand=false → leftHand は null）の片手欠損ケース。
const MOTION_RIGHT_ONLY =
  '{"protocolVersion":2,"type":"motion","sessionId":"unity-20260623-120000-042",' +
  '"timestampMs":99,"source":"unity-bridge","seq":3,"isTracked":true,' +
  '"rightHand":{"x":0.1,"y":1,"z":0},"leftHand":null,' +
  '"avatar":{"isHuman":true,"hasRightHand":true,"hasLeftHand":false,"forward":{"x":0,"y":0,"z":1}}}';

const HEARTBEAT =
  '{"protocolVersion":2,"type":"heartbeat","sessionId":"unity-20260623-120000-042",' +
  '"timestampMs":1000,"source":"unity-bridge","receiverReady":true,' +
  '"receiverStatus":"receiving","avatarReady":true,"rightHandReady":true,"leftHandReady":true,' +
  '"frameRate":59.94,"sendRateHz":50}';

test("Unity Bridge の tracked 両手 motion JSON が validator に通る (M9-06/07・v2)", () => {
  const r = check(MOTION_TRACKED);
  assert.equal(r.kind, "motion");
  assert.equal(r.packet.protocolVersion, 2);
  assert.equal(r.packet.seq, 0);
  assert.equal(r.packet.isTracked, true);
  assert.deepEqual(r.packet.rightHand, { x: 0.123456, y: 1.234567, z: -0.333333 });
  assert.deepEqual(r.packet.leftHand, { x: -0.123456, y: 1.111111, z: -0.222222 });
  assert.equal(r.packet.avatar.hasLeftHand, true);
});

test("Unity Bridge の unavailable motion JSON (両手 null) が通る (SPEC §7.3)", () => {
  const r = check(MOTION_UNAVAILABLE);
  assert.equal(r.kind, "motion");
  assert.equal(r.packet.isTracked, false);
  assert.equal(r.packet.rightHand, null);
  assert.equal(r.packet.leftHand, null);
  assert.equal(r.packet.avatar.hasRightHand, false);
  assert.equal(r.packet.avatar.hasLeftHand, false);
});

test("Unity Bridge の右手のみ tracked・左手欠損 motion JSON が通る (v2)", () => {
  const r = check(MOTION_RIGHT_ONLY);
  assert.equal(r.kind, "motion");
  assert.equal(r.packet.isTracked, true);
  assert.deepEqual(r.packet.rightHand, { x: 0.1, y: 1, z: 0 });
  assert.equal(r.packet.leftHand, null);
  assert.equal(r.packet.avatar.hasLeftHand, false);
});

test("Unity Bridge の heartbeat JSON が validator に通る (M9-08・v2)", () => {
  const r = check(HEARTBEAT);
  assert.equal(r.kind, "heartbeat");
  assert.equal(r.packet.receiverStatus, "receiving");
  assert.equal(r.packet.rightHandReady, true);
  assert.equal(r.packet.leftHandReady, true);
  assert.ok(r.packet.frameRate > 0 && r.packet.sendRateHz > 0);
});

test("全 packet が maxDatagramBytes 以内 (SPEC §7.1)", () => {
  for (const text of [MOTION_TRACKED, MOTION_UNAVAILABLE, MOTION_RIGHT_ONLY, HEARTBEAT]) {
    assert.ok(Buffer.byteLength(text, "utf8") <= maxBytes, `${Buffer.byteLength(text, "utf8")} <= ${maxBytes}`);
  }
});
