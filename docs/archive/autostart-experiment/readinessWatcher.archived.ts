import assert from "node:assert/strict";
import test from "node:test";
import { ReadinessWatcher } from "../src/automation/readinessWatcher.ts";

const heartbeat = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  protocolVersion: 1,
  type: "heartbeat",
  sessionId: "unity-ready-test",
  timestampMs: 1,
  source: "unity-bridge",
  receiverReady: true,
  receiverStatus: "receiving",
  avatarReady: true,
  rightHandReady: true,
  frameRate: 60,
  sendRateHz: 30,
  ...overrides,
});

test("requires three consecutive fully-ready Unity heartbeats", () => {
  let readyCount = 0;
  const watcher = new ReadinessWatcher({
    host: "127.0.0.1", port: 45100, maxDatagramBytes: 8192,
    onReady: () => { readyCount += 1; },
  });
  watcher.handleDatagram(heartbeat({ rightHandReady: false }), 200);
  watcher.handleDatagram(heartbeat(), 200);
  watcher.handleDatagram(heartbeat(), 200);
  assert.equal(readyCount, 0);
  watcher.handleDatagram(heartbeat(), 200);
  assert.equal(readyCount, 1);
  assert.equal(watcher.isReady(), true);
});

test("a non-ready heartbeat resets the debounce sequence", () => {
  let readyCount = 0;
  const watcher = new ReadinessWatcher({
    host: "127.0.0.1", port: 45100, maxDatagramBytes: 8192,
    onReady: () => { readyCount += 1; },
  });
  watcher.handleDatagram(heartbeat(), 200);
  watcher.handleDatagram(heartbeat(), 200);
  watcher.handleDatagram(heartbeat({ receiverStatus: "stale" }), 200);
  assert.equal(watcher.getConsecutiveReadyCount(), 0);
  for (let index = 0; index < 3; index += 1) watcher.handleDatagram(heartbeat(), 200);
  assert.equal(readyCount, 1);
});

test("invalid or mock datagrams do not trigger readiness", () => {
  let readyCount = 0;
  const watcher = new ReadinessWatcher({
    host: "127.0.0.1", port: 45100, maxDatagramBytes: 8192,
    onReady: () => { readyCount += 1; },
  });
  watcher.handleDatagram("{ bad json", 10);
  watcher.handleDatagram(heartbeat({ source: "mock-unity-bridge" }), 200);
  assert.equal(readyCount, 0);
  assert.equal(watcher.getConsecutiveReadyCount(), 0);
});

test("closes its socket before calling onReady", () => {
  const events: string[] = [];
  const socket = {
    bind: () => undefined,
    on: () => socket,
    close: (callback?: () => void) => { events.push("close"); callback?.(); return socket; },
  };
  const watcher = new ReadinessWatcher({
    host: "127.0.0.1", port: 45100, maxDatagramBytes: 8192,
    debounceCount: 1,
    createSocket: () => socket,
    onReady: () => events.push("ready"),
  });
  watcher.start();
  watcher.handleDatagram(heartbeat(), 200);
  assert.deepEqual(events, ["close", "ready"]);
});
