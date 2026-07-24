import type { RemoteHttpRequest, RemoteHttpResponse } from "../shared/types.ts";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const GAME_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const GET_WITHOUT_QUERY = new Set(["/api/ranking-board", "/api/player-suggestions"]);
const POST_WITH_BODY = new Set(["/api/session-open", "/api/session-result", "/api/ranking-score"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function validGameToken(value: unknown): value is string {
  return typeof value === "string" && GAME_TOKEN_PATTERN.test(value);
}

export function validateRemoteHttpRequest(value: unknown): value is RemoteHttpRequest {
  if (!isRecord(value) || (value.method !== "GET" && value.method !== "POST") || typeof value.path !== "string") {
    return false;
  }
  if (value.method === "GET" && GET_WITHOUT_QUERY.has(value.path)) {
    return (
      value.query === undefined &&
      value.body === undefined &&
      value.gameToken === undefined
    );
  }
  if (value.method === "GET" && value.path === "/api/session-entry") {
    return (
      isRecord(value.query) &&
      validSessionId(value.query.sessionId) &&
      validGameToken(value.gameToken) &&
      value.body === undefined
    );
  }
  if (value.method === "POST" && value.path === "/api/session-input-check") {
    return (
      isRecord(value.query) &&
      validSessionId(value.query.sessionId) &&
      validGameToken(value.gameToken) &&
      (value.query.ready === undefined || typeof value.query.ready === "boolean") &&
      value.body === undefined
    );
  }
  if (value.method === "POST" && value.path === "/api/session-input-exit") {
    return (
      isRecord(value.query) &&
      validSessionId(value.query.sessionId) &&
      validGameToken(value.gameToken) &&
      (value.query.play === undefined || typeof value.query.play === "boolean") &&
      value.body === undefined
    );
  }
  return (
    value.method === "POST" &&
    POST_WITH_BODY.has(value.path) &&
    isRecord(value.body) &&
    value.query === undefined &&
    value.gameToken === undefined
  );
}

export async function performRemoteHttpRequest(
  baseUrl: string,
  request: RemoteHttpRequest,
): Promise<RemoteHttpResponse> {
  const url = new URL(request.path, `${baseUrl.replace(/\/+$/, "")}/`);
  if ("query" in request) {
    url.searchParams.set("sessionId", request.query.sessionId);
    if ("ready" in request.query && request.query.ready) {
      url.searchParams.set("ready", "1");
    }
    if ("play" in request.query && request.query.play) {
      url.searchParams.set("play", "1");
    }
  }

  const body = "body" in request ? JSON.stringify(request.body) : undefined;
  if (body !== undefined && body.length > 65_536) {
    throw new Error("Remote request body is too large.");
  }
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if ("gameToken" in request) {
    headers["X-Hakkei-Game-Token"] = request.gameToken;
  }
  const response = await fetch(url, {
    method: request.method,
    cache: "no-store",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body,
  });
  const text = await response.text();
  let responseBody: unknown = null;
  if (text.length > 0) {
    try {
      responseBody = JSON.parse(text) as unknown;
    } catch {
      responseBody = text;
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    body: responseBody,
  };
}
