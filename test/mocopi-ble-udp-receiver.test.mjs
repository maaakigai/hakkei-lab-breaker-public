import test from "node:test";
import assert from "node:assert/strict";

import { isMocopiBlePacket, MocopiBleUdpReceiver } from "../src/main/mocopiBleUdpReceiver.ts";

function pkt(over = {}) {
  return {
    protocolVersion: 1,
    type: "imu",
    source: "mocopi-ble",
    sensorId: "s",
    sessionId: "ble-1",
    seq: 1,
    timestampMs: 0,
    quat: { w: 1, x: 0, y: 0, z: 0 },
    ...over,
  };
}

test("isMocopiBlePacket: 妥当な imu packet を受理", () => {
  assert.equal(isMocopiBlePacket(pkt()), true);
});

test("isMocopiBlePacket: 不正(type/source/quat欠落/型違い)を拒否", () => {
  assert.equal(isMocopiBlePacket(pkt({ type: "status" })), false);
  assert.equal(isMocopiBlePacket(pkt({ source: "keyboard" })), false);
  assert.equal(isMocopiBlePacket(pkt({ protocolVersion: 2 })), false);
  assert.equal(isMocopiBlePacket({ ...pkt(), quat: undefined }), false);
  assert.equal(isMocopiBlePacket({ ...pkt(), seq: "x" }), false);
  assert.equal(isMocopiBlePacket(null), false);
  assert.equal(isMocopiBlePacket("nope"), false);
});

test("UDP roundtrip: active 時に packet を PunchInputSample へ変換して emit", async () => {
  const { createSocket } = await import("node:dgram");
  const got = [];
  const rx = new MocopiBleUdpReceiver({ port: 45199, onPunchInput: (s) => got.push(s) });
  rx.start();
  rx.setActive(true);
  await new Promise((r) => setTimeout(r, 60)); // bind 待ち

  const send = createSocket("udp4");
  const q0 = { w: 1, x: 0, y: 0, z: 0 };
  // z 軸 0.3rad 回転（パンチ相当）。
  const q1 = { w: Math.cos(0.15), x: 0, y: 0, z: Math.sin(0.15) };
  send.send(JSON.stringify(pkt({ seq: 1, timestampMs: 0, quat: q0 })), 45199, "127.0.0.1");
  await new Promise((r) => setTimeout(r, 20));
  send.send(JSON.stringify(pkt({ seq: 2, timestampMs: 20, quat: q1 })), 45199, "127.0.0.1");
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(got.length >= 2, `received ${got.length} samples`);
  assert.equal(got[0].source, "mocopi-ble");
  // 2 つ目は回転しているので intensity（角速度）> 0。
  assert.ok(got[got.length - 1].strength.intensity > 0);

  send.close();
  rx.stop();
});

test("resetPlay clears previous quaternion baseline at replay boundary", () => {
  const got = [];
  const rx = new MocopiBleUdpReceiver({ port: 0, onPunchInput: (s) => got.push(s) });
  rx.setActive(true);
  const q0 = { w: 1, x: 0, y: 0, z: 0 };
  const q1 = { w: Math.cos(0.15), x: 0, y: 0, z: Math.sin(0.15) };
  const q2 = { w: Math.cos(0.3), x: 0, y: 0, z: Math.sin(0.3) };

  rx.onMessage(Buffer.from(JSON.stringify(pkt({ seq: 1, timestampMs: 0, quat: q0 }))));
  rx.onMessage(Buffer.from(JSON.stringify(pkt({ seq: 2, timestampMs: 20, quat: q1 }))));
  assert.equal(got[0].validForScore, false);
  assert.equal(got[1].validForScore, true);

  rx.resetPlay();
  rx.onMessage(Buffer.from(JSON.stringify(pkt({ seq: 3, timestampMs: 40, quat: q2 }))));

  assert.equal(got[2].validForScore, false);
  assert.ok(got[2].quality.flags.includes("DT_RESET"));
});

test("UDP: 非 active 時は emit しない", async () => {
  const { createSocket } = await import("node:dgram");
  const got = [];
  const rx = new MocopiBleUdpReceiver({ port: 45198, onPunchInput: (s) => got.push(s) });
  rx.start();
  rx.setActive(false);
  await new Promise((r) => setTimeout(r, 60));
  const send = createSocket("udp4");
  send.send(JSON.stringify(pkt()), 45198, "127.0.0.1");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(got.length, 0);
  send.close();
  rx.stop();
});

test("sessionId change resets quaternion baseline and emits session change", () => {
  const got = [];
  const sessions = [];
  const rx = new MocopiBleUdpReceiver({
    port: 0,
    onPunchInput: (s) => got.push(s),
    onSessionChanged: (s) => sessions.push(s),
  });
  rx.setActive(true);
  const q0 = { w: 1, x: 0, y: 0, z: 0 };
  const q1 = { w: Math.cos(0.15), x: 0, y: 0, z: Math.sin(0.15) };
  const q2 = { w: Math.cos(0.3), x: 0, y: 0, z: Math.sin(0.3) };

  rx.onMessage(Buffer.from(JSON.stringify(pkt({ sessionId: "ble-1", seq: 1, timestampMs: 0, quat: q0 }))));
  rx.onMessage(Buffer.from(JSON.stringify(pkt({ sessionId: "ble-1", seq: 2, timestampMs: 20, quat: q1 }))));
  rx.onMessage(Buffer.from(JSON.stringify(pkt({ sessionId: "ble-2", seq: 1, timestampMs: 40, quat: q2 }))));

  assert.equal(got[1].validForScore, true);
  assert.equal(got[2].validForScore, false);
  assert.ok(got[2].quality.flags.includes("DT_RESET"));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].source, "mocopi-ble");
  assert.equal(sessions[0].previousSessionId, "ble-1");
  assert.equal(sessions[0].nextSessionId, "ble-2");
  assert.equal(sessions[0].reason, "session-id-changed");
});
