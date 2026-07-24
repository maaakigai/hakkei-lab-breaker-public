// test/status-panel.test.mjs
// M6-01〜08/10: InputCheck の受信状態パネル描画ロジック。
import test from "node:test";
import assert from "node:assert/strict";
import { statusPanelHtml } from "../src/renderer/diagnosticPanel.ts";

function snap(over = {}) {
  return {
    source: "mock-unity-bridge",
    isReceiving: true,
    currentSessionId: "mock-1",
    lastMotionAtMs: 0,
    lastHeartbeatAtMs: 0,
    motionHz: 30,
    heartbeatHz: 1,
    avatarReady: true,
    rightHandReady: true,
    receiverReady: true,
    receiverStatus: "receiving",
    lastSeq: 10,
    droppedFrameCount: 0,
    invalidPacketCount: 2,
    validSampleRatio: null,
    warnings: [],
    errors: [],
    ...over,
  };
}

function status(mockSnap) {
  return {
    activeMode: "mock-unity-bridge",
    generatedAtMs: 0,
    globalInvalidPacketCount: 1,
    sourceStatuses: {
      keyboard: snap({ source: "keyboard", isReceiving: false }),
      "unity-bridge": snap({ source: "unity-bridge", isReceiving: false }),
      "mock-unity-bridge": mockSnap,
    },
    activeWarnings: [],
    activeErrors: [],
  };
}

const NOW = 1_000_000;

test("受信中なら OK・Hz・age・invalid を表示 (M6-02/03/04/08)", () => {
  const s = status(snap({ lastMotionAtMs: NOW - 50, motionHz: 30, invalidPacketCount: 2 }));
  const html = statusPanelHtml("mock-unity-bridge", s, null, null, NOW);
  assert.match(html, />OK</); // motion受信 OK
  assert.match(html, /30\.0 Hz/); // 受信Hz
  assert.match(html, /50 ms 前/); // 最終受信 age
  assert.match(html, /global 1/); // invalid global
});

test("座標は active source の sample から表示 (M6-07)", () => {
  const s = status(snap());
  const sample = {
    source: "mock-unity-bridge",
    handPosition: { x: 0.111, y: 1.222, z: -0.333 },
    velocity: { x: 0, y: 0, z: 0 },
    quality: { sampleRateHz: 30 },
    seq: 1,
    validForScore: true,
  };
  const html = statusPanelHtml("mock-unity-bridge", s, null, sample, NOW);
  assert.match(html, /1\.222/);
  assert.match(html, /-0\.333/);
});

test("rightHandReady は heartbeat 優先 (M6-06)", () => {
  const s = status(snap({ rightHandReady: false }));
  const hb = { rightHandReady: true, isAlive: true, receiverStatus: "receiving" };
  const html = statusPanelHtml("mock-unity-bridge", s, hb, null, NOW);
  // rightHandReady 行が OK（heartbeat の true 優先）
  assert.match(html, /rightHandReady<\/th><td>.*OK/s);
});

test("status 無し（未受信）は NG + 失敗ヒント (M6-02/10)", () => {
  const html = statusPanelHtml("mock-unity-bridge", null, null, null, NOW);
  assert.match(html, />NG</);
  assert.match(html, /127\.0\.0\.1:45100/); // ポート確認ヒント
  assert.match(html, /Keyboardに切替/); // fallback 案内
});
