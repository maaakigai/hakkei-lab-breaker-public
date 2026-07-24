// test/udp-receiver.test.mjs
// M5-01/08/13: 受信パイプライン（processDatagram）と実 UDP ラウンドトリップ。
import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { UnityBridgeUdpReceiver } from "../src/main/unityBridgeUdpReceiver.ts";
import { loadConfigBundle } from "../src/main/appConfig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");

function makeInput(port) {
  return { ...loaded.value.input, udp: { ...loaded.value.input.udp, port } };
}

function makeReceiver(input) {
  const events = { samples: [], heartbeats: [], statuses: [], diagnostics: [], sessions: [], errors: [] };
  let clock = 1_000_000;
  const recv = new UnityBridgeUdpReceiver(
    input,
    {
      onSample: (s) => events.samples.push(s),
      onHeartbeat: (h) => events.heartbeats.push(h),
      onStatus: (s) => events.statuses.push(s),
      onDiagnostics: (d) => events.diagnostics.push(d),
      onSessionChanged: (p) => events.sessions.push(p),
      onError: (e) => events.errors.push(e),
    },
    () => clock,
  );
  return { recv, events, tick: (ms) => (clock += ms) };
}

// 両手v2 必須化: receiver は v2 packet を受ける（v1 は validator が拒否する）。
const motion = (over = {}) =>
  JSON.stringify({
    protocolVersion: 2,
    type: "motion",
    sessionId: "s1",
    seq: 0,
    timestampMs: 0,
    source: "mock-unity-bridge",
    isTracked: true,
    rightHand: { x: 0.1, y: 1.2, z: -0.3 },
    leftHand: { x: -0.1, y: 1.1, z: -0.2 },
    avatar: { isHuman: true, hasRightHand: true, hasLeftHand: true, forward: { x: 0, y: 0, z: 1 } },
    ...over,
  });

test("active source の motion は onSample に流れ、session-changed が出る (M5-08/13)", () => {
  const { recv, events } = makeReceiver(makeInput(45211));
  recv.setActiveMode("mock-unity-bridge");
  recv.processDatagram(motion({ seq: 0, timestampMs: 0 }), 200, "127.0.0.1");
  assert.equal(events.samples.length, 1);
  assert.equal(events.samples[0].source, "mock-unity-bridge");
  assert.equal(events.sessions.length, 1);
  assert.equal(events.sessions[0].nextSessionId, "s1");
});

test("非 active source の motion は sample に流れない", () => {
  const { recv, events } = makeReceiver(makeInput(45212));
  recv.setActiveMode("unity-bridge"); // active は unity、packet は mock
  recv.processDatagram(motion({ seq: 0, timestampMs: 0 }), 200, "127.0.0.1");
  assert.equal(events.samples.length, 0);
});

test("seq 巻き戻りは sample を出さず SEQ_ROLLBACK error", () => {
  const { recv, events } = makeReceiver(makeInput(45213));
  recv.setActiveMode("mock-unity-bridge");
  recv.processDatagram(motion({ seq: 5, timestampMs: 0 }), 200, "127.0.0.1");
  recv.processDatagram(motion({ seq: 3, timestampMs: 1 }), 200, "127.0.0.1");
  assert.equal(events.samples.length, 1); // 2発目は捨てられる
  assert.ok(events.errors.some((e) => e.code === "SEQ_ROLLBACK"));
});

test("不正 JSON は落ちず error + globalInvalidPacketCount", () => {
  const { recv, events } = makeReceiver(makeInput(45214));
  recv.setActiveMode("mock-unity-bridge");
  recv.processDatagram("{ broken", 8, "127.0.0.1");
  assert.ok(events.errors.some((e) => e.code === "INVALID_JSON"));
  assert.equal(recv.generateStatus().globalInvalidPacketCount, 1);
});

test("heartbeat は onHeartbeat に流れ status を更新する (M5-09)", () => {
  const { recv, events } = makeReceiver(makeInput(45215));
  recv.setActiveMode("mock-unity-bridge");
  const hb = JSON.stringify({
    protocolVersion: 2,
    type: "heartbeat",
    sessionId: "s1",
    timestampMs: 0,
    source: "mock-unity-bridge",
    receiverReady: true,
    receiverStatus: "receiving",
    avatarReady: true,
    rightHandReady: true,
    leftHandReady: true,
    frameRate: 60,
    sendRateHz: 30,
  });
  recv.processDatagram(hb, 200, "127.0.0.1");
  assert.equal(events.heartbeats.length, 1);
  assert.equal(events.heartbeats[0].rightHandReady, true);
});

test("実 UDP ラウンドトリップ: bind したソケットに送ると onSample が出る (M5-01)", async () => {
  const PORT = 45216;
  const { recv, events } = makeReceiver(makeInput(PORT));
  recv.setActiveMode("mock-unity-bridge");
  recv.start();
  try {
    await new Promise((resolve, reject) => {
      const client = createSocket("udp4");
      const buf = Buffer.from(motion({ seq: 1, timestampMs: 10 }), "utf8");
      const timer = setTimeout(() => {
        clearInterval(poll);
        client.close();
        reject(new Error("timeout: no sample"));
      }, 2000);
      // bind 完了前に送ると UDP は落ちるので、届くまで再送する。
      const poll = setInterval(() => {
        if (events.samples.length > 0) {
          clearInterval(poll);
          clearTimeout(timer);
          client.close();
          resolve();
        } else {
          client.send(buf, PORT, "127.0.0.1");
        }
      }, 50);
    });
    assert.ok(events.samples.length >= 1);
    assert.equal(events.samples[0].sessionId, "s1");
  } finally {
    recv.stop();
  }
});
