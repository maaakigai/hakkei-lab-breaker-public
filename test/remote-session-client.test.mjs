import test from "node:test";
import assert from "node:assert/strict";

import { RemoteSessionClient } from "../src/main/remoteSessionClient.ts";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.CONNECTING;
    this.closeCount = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closeCount += 1;
    this.readyState = 3;
    this.onclose?.();
  }

  send() {}
}

test("remote session credentials change closes the old socket before joining the new room", (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const client = new RemoteSessionClient(
    {
      enabled: true,
      httpBaseUrl: "https://score.example.test",
      wsUrl: "wss://score.example.test/ws",
      fallbackPollingMs: 1500,
      reconnectMinMs: 500,
      reconnectMaxMs: 5000,
    },
    {
      onEvent: () => {},
      onStatus: () => {},
    },
  );
  const firstToken = "a".repeat(64);
  const secondToken = "b".repeat(64);

  client.start("session-one", firstToken);
  assert.equal(FakeWebSocket.instances.length, 1);
  const first = FakeWebSocket.instances[0];
  first.readyState = FakeWebSocket.OPEN;

  client.start("session-two", secondToken);
  assert.equal(first.closeCount, 1);
  assert.equal(first.onclose, null);
  assert.equal(FakeWebSocket.instances.length, 2);
  const second = FakeWebSocket.instances[1];
  assert.equal(new URL(second.url).searchParams.get("sessionId"), "session-two");
  assert.deepEqual(second.protocols, [`hakkei-game.${secondToken}`]);

  client.stop();
});
