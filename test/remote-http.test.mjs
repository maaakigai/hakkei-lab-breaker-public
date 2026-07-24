import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

import {
  performRemoteHttpRequest,
  validateRemoteHttpRequest,
} from "../src/main/remoteHttp.ts";

const GAME_TOKEN = "a".repeat(64);

test("remote HTTP IPC accepts only the QR/ranking API allowlist", () => {
  assert.equal(validateRemoteHttpRequest({ method: "GET", path: "/api/ranking-board" }), true);
  assert.equal(validateRemoteHttpRequest({ method: "GET", path: "/api/player-suggestions" }), true);
  assert.equal(validateRemoteHttpRequest({ method: "GET", path: "/api/players" }), false);
  assert.equal(
    validateRemoteHttpRequest({
      method: "POST",
      path: "/api/session-open",
      body: { sessionId: "hakkei-test_01", gameToken: GAME_TOKEN },
    }),
    true,
  );
  assert.equal(
    validateRemoteHttpRequest({
      method: "GET",
      path: "/api/session-entry",
      query: { sessionId: "hakkei-test_01" },
      gameToken: GAME_TOKEN,
    }),
    true,
  );
  assert.equal(
    validateRemoteHttpRequest({
      method: "GET",
      path: "/api/session-entry",
      query: { sessionId: "hakkei-test_01" },
    }),
    false,
  );
  assert.equal(validateRemoteHttpRequest({ method: "GET", path: "https://example.com" }), false);
  assert.equal(
    validateRemoteHttpRequest({
      method: "GET",
      path: "/api/session-entry",
      query: { sessionId: "../invalid" },
      gameToken: GAME_TOKEN,
    }),
    false,
  );
  assert.equal(
    validateRemoteHttpRequest({
      method: "POST",
      path: "/api/admin-reset",
      body: { confirm: "DELETE_ALL_HAKKEI_DATA" },
    }),
    false,
  );
});

test("remote HTTP request sends validated query and JSON through Main", async (t) => {
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"],
        gameToken: request.headers["x-hakkei-game-token"],
        body,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const getResult = await performRemoteHttpRequest(baseUrl, {
    method: "GET",
    path: "/api/session-entry",
    query: { sessionId: "hakkei-test" },
    gameToken: GAME_TOKEN,
  });
  const postResult = await performRemoteHttpRequest(baseUrl, {
    method: "POST",
    path: "/api/session-result",
    body: { sessionId: "hakkei-test", damageYen: 123 },
  });

  assert.deepEqual(getResult, { status: 200, ok: true, body: { ok: true } });
  assert.deepEqual(postResult, { status: 200, ok: true, body: { ok: true } });
  assert.deepEqual(received, [
    {
      method: "GET",
      url: "/api/session-entry?sessionId=hakkei-test",
      contentType: undefined,
      gameToken: GAME_TOKEN,
      body: "",
    },
    {
      method: "POST",
      url: "/api/session-result",
      contentType: "application/json",
      gameToken: undefined,
      body: JSON.stringify({ sessionId: "hakkei-test", damageYen: 123 }),
    },
  ]);
});
