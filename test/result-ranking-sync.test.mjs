import test from "node:test";
import assert from "node:assert/strict";

import {
  rankingIdentityForResponseRow,
  rankingPlayerFor,
  rankingPositionFor,
} from "../src/renderer/resultRankingSync.ts";
import { rankingRows } from "../src/renderer/rankingStore.ts";

function player(overrides = {}) {
  return {
    playerId: "remote-phone-1",
    nickname: "ALICE",
    playerNumber: 26001,
    registeredAtMs: 1,
    lastPlayedAtMs: 2,
    highScore: 900,
    playCount: 1,
    ...overrides,
  };
}

function savedScore() {
  const current = player();
  const board = {
    schemaVersion: 1,
    players: [current],
    records: [],
  };
  return {
    player: current,
    record: {
      recordId: "record-1",
      playerId: current.playerId,
      nickname: current.nickname,
      score: 900,
      damageYen: 900,
      rank: "A",
      videoLevel: 4,
      playedAtMs: 2,
      isHighScore: true,
    },
    previousHighScore: 0,
    isHighScore: true,
    board,
  };
}

test("completed server ranking resolves the current player and position", () => {
  const saved = savedScore();
  const serverBoard = {
    schemaVersion: 1,
    players: [player({ playerId: "public-26001", highScore: 1200 })],
    records: [],
  };

  assert.equal(rankingPlayerFor(serverBoard, saved.player)?.highScore, 1200);
  assert.equal(rankingPositionFor(serverBoard, saved.player), 1);
});

test("personal ranking position uses the shared leaderboard ordering", () => {
  const board = {
    schemaVersion: 1,
    players: [
      player({
        playerId: "player-later",
        nickname: "ZED",
        playerNumber: 26003,
        registeredAtMs: 30,
        highScore: 900,
      }),
      player({
        playerId: "player-first",
        nickname: "BOB",
        playerNumber: 26002,
        registeredAtMs: 10,
        highScore: 900,
      }),
      player({
        playerId: "player-second",
        nickname: "ALICE",
        playerNumber: 26001,
        registeredAtMs: 10,
        highScore: 900,
      }),
    ],
    records: [],
  };

  const ordered = rankingRows(board);
  assert.deepEqual(
    ordered.map((candidate) => candidate.playerId),
    ["player-second", "player-first", "player-later"],
  );
  for (const candidate of board.players) {
    assert.equal(
      rankingPositionFor(board, candidate),
      ordered.findIndex((ranked) => ranked.playerId === candidate.playerId) + 1,
    );
  }
});

test("POST response marker stays bound to the player submitted with that request", () => {
  const submitted = player({
    playerId: "submitted-a",
    nickname: "ALICE",
    playerNumber: undefined,
  });
  const current = player({
    playerId: "current-b",
    nickname: "BOB",
    playerNumber: 26002,
  });

  assert.equal(
    rankingIdentityForResponseRow(26001, 26001, submitted, current)?.playerId,
    "submitted-a",
  );
  assert.equal(
    rankingIdentityForResponseRow(26002, 26001, submitted, current)?.playerId,
    "current-b",
  );
});

test("GET response without a submission marker keeps the current player mapping", () => {
  const current = player({
    playerId: "current-player",
    playerNumber: 26002,
  });

  assert.equal(
    rankingIdentityForResponseRow(26002, undefined, null, current)?.playerId,
    "current-player",
  );
  assert.equal(
    rankingIdentityForResponseRow(26001, undefined, null, current),
    null,
  );
});
