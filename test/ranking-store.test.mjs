import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRankingBoard,
  criticalBonusFromBreakdown,
  getOrCreatePlayerProfile,
  getOrCreateRemotePlayerProfile,
  findPlayerByNickname,
  importPublicPlayerSuggestions,
  importServerRankingPlayers,
  loadRankingBoard,
  rankingRows,
  recordScoreForPlayer,
  recordScoreForDefaultPlayer,
  registeredNicknameSuggestions,
  relativeTimeAgo,
  validateNickname,
} from "../src/renderer/rankingStore.ts";

class MemoryStorage {
  #map = new Map();

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  setItem(key, value) {
    this.#map.set(key, String(value));
  }

  removeItem(key) {
    this.#map.delete(key);
  }
}

// スコア＝損害額なので、第1引数を baseDamageYen として扱う。
function breakdown(base, opts = {}) {
  const power = opts.power ?? base;
  return {
    rightChargeScore: 100,
    leftChargeScore: 100,
    hakkeiScore: 100,
    hakkeiDetected: base > 0,
    hakkeiTimedOut: base === 0,
    power,
    baseDamageYen: base,
    damageYen: base,
    rank: power >= 600000 ? "S" : power >= 300000 ? "A" : power >= 150000 ? "B" : power >= 50000 ? "C" : "D",
    videoLevel: power >= 600000 ? 5 : power >= 300000 ? 4 : power >= 150000 ? 3 : power >= 50000 ? 2 : power > 0 ? 1 : 0,
    raw: {
      rightChargeRaw: 0,
      leftChargeRaw: 0,
      hakkeiVelocityPeak: 0,
      hakkeiAccelerationPeak: 0,
      hakkeiDisplacement: 0,
    },
  };
}

test("recordScoreForDefaultPlayer creates local guest profile and record", () => {
  const storage = new MemoryStorage();
  const saved = recordScoreForDefaultPlayer(storage, breakdown(12840), 1_000_000);

  assert.equal(saved.player.nickname, "GUEST");
  assert.equal(saved.player.highScore, 12840);
  assert.equal(saved.player.playCount, 1);
  assert.equal(saved.record.isHighScore, true);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.records.length, 1);
});

test("validateNickname accepts only 1-16 latin nickname characters", () => {
  assert.equal(validateNickname("A"), true);
  assert.equal(validateNickname("MIRAI"), true);
  assert.equal(validateNickname("AA_01-zz"), true);
  assert.equal(validateNickname("MIRAI.01"), true);
  assert.equal(validateNickname("MR.X"), true); // ピリオド許容
  assert.equal(validateNickname("..."), true);
  assert.equal(validateNickname(""), false);
  assert.equal(validateNickname("abcdefghijklmnopq"), false);
  assert.equal(validateNickname("三浦"), false);
  assert.equal(validateNickname("MIRAI!"), false);
});

test("getOrCreatePlayerProfile creates a local player for valid nickname", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "mirai", 1_000_000);

  assert.ok(player);
  assert.equal(player.nickname, "MIRAI");
  assert.equal(player.highScore, 0);
  assert.equal(player.playCount, 0);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.players[0].nickname, "MIRAI");
});

test("getOrCreatePlayerProfile reuses nickname case-insensitively", () => {
  const storage = new MemoryStorage();
  const first = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  const second = getOrCreatePlayerProfile(storage, "mirai", 1_100_000);

  assert.ok(first);
  assert.ok(second);
  assert.equal(second.playerId, first.playerId);
  assert.equal(second.nickname, "MIRAI");
  assert.equal(loadRankingBoard(storage).players.length, 1);
});

test("getOrCreatePlayerProfile rejects invalid nickname without saving", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "NG!", 1_000_000);

  assert.equal(player, null);
  assert.equal(loadRankingBoard(storage).players.length, 0);
});

test("getOrCreateRemotePlayerProfile reuses remote id when nickname changes", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateRemotePlayerProfile(storage, "phone-123", "MIRAI", 1_000_000);
  assert.ok(first);
  recordScoreForPlayer(storage, first, breakdown(5000), 1_100_000);

  const renamed = getOrCreateRemotePlayerProfile(storage, "phone-123", "TARO", 1_200_000);
  assert.ok(renamed);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(renamed.playerId, first.playerId);
  assert.equal(renamed.nickname, "TARO");
  assert.equal(renamed.highScore, 5000);
});

test("getOrCreateRemotePlayerProfile keeps remote id separate from manual same nickname", () => {
  const storage = new MemoryStorage();
  const local = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  const remote = getOrCreateRemotePlayerProfile(storage, "phone-123", "MIRAI", 1_100_000);

  assert.ok(local);
  assert.ok(remote);
  assert.notEqual(remote.playerId, local.playerId);
  assert.equal(loadRankingBoard(storage).players.length, 2);
});

test("getOrCreateRemotePlayerProfile replaces a synthetic public id by player number", () => {
  const storage = new MemoryStorage();
  importServerRankingPlayers(storage, {
    schemaVersion: 1,
    players: [{
      playerId: "public-26026",
      nickname: "ZETAX",
      playerNumber: 26026,
      registeredAtMs: 0,
      lastPlayedAtMs: null,
      highScore: 30_950_424,
      playCount: 2,
    }],
    records: [],
  });

  const remote = getOrCreateRemotePlayerProfile(
    storage,
    "phone-123",
    "ZETAX",
    1_100_000,
    26026,
  );

  assert.ok(remote);
  assert.equal(remote.playerId, "remote-phone-123");
  assert.equal(remote.playerNumber, 26026);
  assert.equal(remote.highScore, 30_950_424);
  assert.equal(loadRankingBoard(storage).players.length, 1);
});

test("同名でも公開IDが異なるプレイヤーは統合しない", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateRemotePlayerProfile(storage, "phone-1", "SAME", 1_000, 26001);
  const second = getOrCreateRemotePlayerProfile(storage, "phone-2", "SAME", 2_000, 26002);

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.playerId, second.playerId);
  assert.equal(loadRankingBoard(storage).players.length, 2);
});

test("recordScoreForPlayer stores score for the selected player", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  assert.ok(player);

  const saved = recordScoreForPlayer(storage, player, breakdown(15120), 1_200_000);

  assert.equal(saved.player.nickname, "MIRAI");
  assert.equal(saved.player.highScore, 15120);
  assert.equal(saved.player.playCount, 1);
  assert.equal(saved.record.playerId, player.playerId);
  assert.equal(saved.record.nickname, "MIRAI");
});

test("recordScoreForDefaultPlayer keeps previous high score for lower replay", () => {
  const storage = new MemoryStorage();
  recordScoreForDefaultPlayer(storage, breakdown(12840), 1_000_000);
  const saved = recordScoreForDefaultPlayer(storage, breakdown(10200), 1_100_000);

  assert.equal(saved.previousHighScore, 12840);
  assert.equal(saved.isHighScore, false);
  assert.equal(saved.player.highScore, 12840);
  assert.equal(saved.player.playCount, 2);
  assert.equal(saved.record.score, 10200);
  assert.equal(saved.board.records.length, 2);
});

test("rankingRows sorts by high score descending", () => {
  const rows = rankingRows({
    schemaVersion: 1,
    players: [
      { playerId: "a", nickname: "AAA", registeredAtMs: 2000, lastPlayedAtMs: 4000, highScore: 100, playCount: 1 },
      { playerId: "b", nickname: "BBB", registeredAtMs: 1000, lastPlayedAtMs: 3000, highScore: 200, playCount: 1 },
    ],
    records: [],
  });

  assert.deepEqual(rows.map((p) => p.nickname), ["BBB", "AAA"]);
});

test("rankingRows keeps one row per player with each player's high score", () => {
  const storage = new MemoryStorage();
  const mirai = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  const lab = getOrCreatePlayerProfile(storage, "LAB", 1_100_000);
  assert.ok(mirai);
  assert.ok(lab);

  recordScoreForPlayer(storage, mirai, breakdown(1000), 1_200_000);
  recordScoreForPlayer(storage, mirai, breakdown(900), 1_300_000);
  recordScoreForPlayer(storage, lab, breakdown(1500), 1_400_000);

  const board = loadRankingBoard(storage);
  const rows = rankingRows(board);

  assert.equal(board.records.length, 3);
  assert.deepEqual(rows.map((p) => [p.nickname, p.highScore]), [
    ["LAB", 1500],
    ["MIRAI", 1000],
  ]);
});

test("registeredNicknameSuggestions filters registered players by nickname prefix", () => {
  const storage = new MemoryStorage();
  const mirai = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  const miku = getOrCreatePlayerProfile(storage, "MIKU", 1_100_000);
  const lab = getOrCreatePlayerProfile(storage, "LAB", 1_200_000);
  assert.ok(mirai);
  assert.ok(miku);
  assert.ok(lab);

  recordScoreForPlayer(storage, mirai, breakdown(1000), 1_300_000);
  recordScoreForPlayer(storage, miku, breakdown(2000), 1_400_000);
  recordScoreForPlayer(storage, lab, breakdown(3000), 1_500_000);

  const board = loadRankingBoard(storage);

  assert.deepEqual(registeredNicknameSuggestions(board, "mi").map((p) => p.nickname), ["MIKU", "MIRAI"]);
  assert.deepEqual(registeredNicknameSuggestions(board, "mir").map((p) => p.nickname), ["MIRAI"]);
  assert.deepEqual(registeredNicknameSuggestions(board, "mirai").map((p) => p.nickname), ["MIRAI"]);
  assert.deepEqual(registeredNicknameSuggestions(board, "").map((p) => p.nickname), []);
});

test("registeredNicknameSuggestions keeps longer matches when an exact prefix player exists", () => {
  const board = {
    schemaVersion: 1,
    players: [
      { playerId: "a", nickname: "A", registeredAtMs: 1000, lastPlayedAtMs: null, highScore: 10, playCount: 0 },
      { playerId: "b", nickname: "AAA", registeredAtMs: 1001, lastPlayedAtMs: null, highScore: 30, playCount: 0 },
      { playerId: "c", nickname: "ABC", registeredAtMs: 1002, lastPlayedAtMs: null, highScore: 20, playCount: 0 },
    ],
    records: [],
  };

  assert.deepEqual(registeredNicknameSuggestions(board, "A").map((p) => p.nickname), ["AAA", "ABC", "A"]);
});

test("registeredNicknameSuggestions limits visible suggestions", () => {
  const board = {
    schemaVersion: 1,
    players: [
      { playerId: "a", nickname: "MIRAI", registeredAtMs: 1000, lastPlayedAtMs: null, highScore: 100, playCount: 0 },
      { playerId: "b", nickname: "MIKU", registeredAtMs: 1001, lastPlayedAtMs: null, highScore: 200, playCount: 0 },
      { playerId: "c", nickname: "MISA", registeredAtMs: 1002, lastPlayedAtMs: null, highScore: 300, playCount: 0 },
      { playerId: "d", nickname: "MIDO", registeredAtMs: 1003, lastPlayedAtMs: null, highScore: 400, playCount: 0 },
      { playerId: "e", nickname: "MINE", registeredAtMs: 1004, lastPlayedAtMs: null, highScore: 500, playCount: 0 },
    ],
    records: [],
  };

  assert.deepEqual(registeredNicknameSuggestions(board, "mi").map((p) => p.nickname), ["MINE", "MIDO", "MISA", "MIKU"]);
});

test("importPublicPlayerSuggestions adds unplayed registered users without exposing an internal ID", () => {
  const storage = new MemoryStorage();

  importPublicPlayerSuggestions(storage, [
    {
      nickname: "newcomer",
      playerNumber: 26003,
      registeredAtMs: 3_000,
      lastPlayedAtMs: null,
    },
  ]);

  const board = loadRankingBoard(storage);
  assert.deepEqual(
    registeredNicknameSuggestions(board, "new").map((player) => [
      player.playerId,
      player.playerNumber,
      player.nickname,
      player.highScore,
      player.lastPlayedAtMs,
    ]),
    [["public-26003", 26003, "NEWCOMER", 0, null]],
  );
});

test("importPublicPlayerSuggestions merges by player number without duplicating an existing profile", () => {
  const storage = new MemoryStorage();
  storage.setItem("hakkei.rankingBoard.v1", JSON.stringify({
    schemaVersion: 1,
    players: [{
      playerId: "remote-phone-1",
      nickname: "OLDNAME",
      playerNumber: 26001,
      registeredAtMs: 2_000,
      lastPlayedAtMs: 4_000,
      highScore: 12_345,
      playCount: 2,
    }],
    records: [],
  }));

  importPublicPlayerSuggestions(storage, [
    {
      nickname: "newname",
      playerNumber: 26001,
      registeredAtMs: 1_000,
      lastPlayedAtMs: 5_000,
    },
  ]);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.deepEqual(board.players[0], {
    playerId: "remote-phone-1",
    nickname: "NEWNAME",
    playerNumber: 26001,
    registeredAtMs: 1_000,
    lastPlayedAtMs: 5_000,
    highScore: 12_345,
    highScoreCriticalBonusYen: "0",
    playCount: 2,
  });
});

test("候補同期は現サーバーにない表示用publicキャッシュだけを削除する", () => {
  const storage = new MemoryStorage();
  storage.setItem("hakkei.rankingBoard.v1", JSON.stringify({
    schemaVersion: 1,
    players: [
      {
        playerId: "local-test",
        nickname: "TEST",
        playerNumber: null,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 2_000,
        highScore: 1_536_048,
        playCount: 1,
      },
      {
        playerId: "public-26012",
        nickname: "TEST",
        playerNumber: 26012,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 2_000,
        highScore: 1_536_048,
        playCount: 1,
      },
    ],
    records: [],
  }));

  importPublicPlayerSuggestions(storage, []);

  const board = loadRankingBoard(storage);
  assert.deepEqual(
    registeredNicknameSuggestions(board, "test").map((player) => [
      player.playerId,
      player.nickname,
    ]),
    [["local-test", "TEST"]],
  );
});

test("候補同期はこのPCのscore recordを持つpublicプレイヤーを削除しない", () => {
  const storage = new MemoryStorage();
  storage.setItem("hakkei.rankingBoard.v1", JSON.stringify({
    schemaVersion: 1,
    players: [{
      playerId: "public-26012",
      nickname: "TEST",
      playerNumber: 26012,
      registeredAtMs: 1_000,
      lastPlayedAtMs: null,
      highScore: 0,
      playCount: 0,
    }],
    records: [],
  }));
  const publicPlayer = loadRankingBoard(storage).players[0];
  assert.ok(publicPlayer);
  recordScoreForPlayer(storage, publicPlayer, breakdown(1234), 2_000);

  importPublicPlayerSuggestions(storage, []);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.players[0].playerId, "public-26012");
  assert.equal(board.records.length, 1);
});

test("importServerRankingPlayers adds scored server users to nickname suggestions", () => {
  const storage = new MemoryStorage();

  importServerRankingPlayers(storage, {
    schemaVersion: 1,
    players: [
      {
        playerId: "remote-phone-1",
        nickname: "MIRAI",
        playerNumber: 26001,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 2_000,
        highScore: 9000,
        playCount: 2,
      },
      {
        playerId: "local-other-pc",
        nickname: "MINE",
        playerNumber: 26002,
        registeredAtMs: 1_100,
        lastPlayedAtMs: 2_100,
        highScore: 12000,
        playCount: 1,
      },
    ],
    records: [],
  });

  const board = loadRankingBoard(storage);
  assert.deepEqual(registeredNicknameSuggestions(board, "mi").map((p) => p.nickname), ["MINE", "MIRAI"]);
  assert.equal(board.players.find((p) => p.nickname === "MINE")?.highScore, 12000);
  assert.equal(board.players.find((p) => p.nickname === "MINE")?.playerNumber, 26002);
});

test("importServerRankingPlayers refreshes existing local copy from server ranking", () => {
  const storage = new MemoryStorage();
  getOrCreateRemotePlayerProfile(storage, "phone-1", "MIRAI", 1_000, 26001);

  importServerRankingPlayers(storage, {
    schemaVersion: 1,
    players: [
      {
        playerId: "remote-phone-1",
        nickname: "TARO",
        playerNumber: 26001,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 3_000,
        highScore: 50000,
        highScoreCriticalBonusYen: "65000000000",
        playCount: 4,
      },
    ],
    records: [],
  });

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.players[0].nickname, "TARO");
  assert.equal(board.players[0].playerNumber, 26001);
  assert.equal(board.players[0].highScore, 50000);
  assert.equal(board.players[0].highScoreCriticalBonusYen, "65000000000");
  assert.deepEqual(registeredNicknameSuggestions(board, "ta").map((p) => p.nickname), ["TARO"]);
});

test("合成初期ランキングの PLAYER 001 形式を有効なニックネームとして扱う", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "player 001", 1000);
  assert.equal(player.nickname, "PLAYER 001");
  assert.equal(validateNickname(player.nickname), true);
});

test("公開ランキング移行時に同じ公開IDの候補を二重表示しない", () => {
  const storage = new MemoryStorage();
  storage.setItem("hakkei.rankingBoard.v1", JSON.stringify({
    schemaVersion: 1,
    players: [
      {
        playerId: "remote-phone-1",
        nickname: "ZETAX",
        playerNumber: 26026,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 2_000,
        highScore: 30_950_424,
        playCount: 2,
      },
      {
        playerId: "public-26026",
        nickname: "ZETAX",
        playerNumber: 26026,
        registeredAtMs: 0,
        lastPlayedAtMs: null,
        highScore: 30_950_424,
        playCount: 2,
      },
    ],
    records: [],
  }));

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.players[0].playerId, "remote-phone-1");
  assert.deepEqual(
    registeredNicknameSuggestions(board, "ze").map((player) => [player.playerNumber, player.nickname]),
    [[26026, "ZETAX"]],
  );
});

test("サーバーランキング取込は同じ公開IDの既存候補を更新して一意に保つ", () => {
  const storage = new MemoryStorage();
  storage.setItem("hakkei.rankingBoard.v1", JSON.stringify({
    schemaVersion: 1,
    players: [
      {
        playerId: "remote-phone-1",
        nickname: "OLDNAME",
        playerNumber: 26026,
        registeredAtMs: 1_000,
        lastPlayedAtMs: 2_000,
        highScore: 10,
        playCount: 1,
      },
      {
        playerId: "public-26026",
        nickname: "OLDNAME",
        playerNumber: 26026,
        registeredAtMs: 0,
        lastPlayedAtMs: null,
        highScore: 10,
        playCount: 1,
      },
    ],
    records: [],
  }));

  importServerRankingPlayers(storage, {
    schemaVersion: 1,
    players: [
      {
        playerId: "public-26026",
        nickname: "ZETAX",
        playerNumber: 26026,
        registeredAtMs: 0,
        lastPlayedAtMs: null,
        highScore: 30_950_424,
        playCount: 2,
      },
    ],
    records: [],
  });

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 1);
  assert.equal(board.players[0].playerId, "remote-phone-1");
  assert.equal(board.players[0].nickname, "ZETAX");
  assert.equal(board.players[0].highScore, 30_950_424);
});

test("clearRankingBoard removes all players and score records", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "MIRAI", 1_000_000);
  assert.ok(player);
  recordScoreForPlayer(storage, player, breakdown(15120), 1_200_000);

  clearRankingBoard(storage);

  const board = loadRankingBoard(storage);
  assert.equal(board.players.length, 0);
  assert.equal(board.records.length, 0);
});

test("スコアは研究室の損害額で記録し、低い再プレイではハイスコアを維持する", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "MIRAI", 1000);
  const saved = recordScoreForPlayer(storage, player, breakdown(20000000), 2000);
  assert.equal(saved.player.highScore, 20000000);
  assert.equal(saved.record.score, 20000000);

  const saved2 = recordScoreForPlayer(storage, saved.player, breakdown(25000000), 3000);
  assert.equal(saved2.player.highScore, 25000000);

  const saved3 = recordScoreForPlayer(storage, saved2.player, breakdown(1000), 4000);
  assert.equal(saved3.player.highScore, 25000000);
  assert.ok(!saved3.record.isHighScore);
});

test("Critical bonusは順位スコアへ加えず、ハイスコア回の表示用bonusとして分離保存する", () => {
  const storage = new MemoryStorage();
  const player = getOrCreatePlayerProfile(storage, "MIRAI", 1000);
  const critical = {
    ...breakdown(20_000_000, { power: 700_000 }),
    damageYen: 65_020_000_000,
    damageYenText: "65020000000",
  };

  assert.equal(criticalBonusFromBreakdown(critical), "65000000000");
  const saved = recordScoreForPlayer(storage, player, critical, 2000);
  assert.equal(saved.record.score, 20_000_000);
  assert.equal(saved.record.criticalBonusYen, "65000000000");
  assert.equal(saved.player.highScore, 20_000_000);
  assert.equal(saved.player.highScoreCriticalBonusYen, "65000000000");

  const higherBaseWithoutCritical = recordScoreForPlayer(
    storage,
    saved.player,
    breakdown(25_000_000, { power: 700_000 }),
    3000,
  );
  assert.equal(higherBaseWithoutCritical.player.highScore, 25_000_000);
  assert.equal(higherBaseWithoutCritical.player.highScoreCriticalBonusYen, "0");
});

test("findPlayerByNickname は大文字小文字を無視して既存プレイヤーを返す（作成しない）", () => {
  const storage = new MemoryStorage();
  getOrCreatePlayerProfile(storage, "MIRAI", 1000);
  const found = findPlayerByNickname(loadRankingBoard(storage), "mirai");
  assert.ok(found);
  assert.equal(found.nickname, "MIRAI");
  assert.equal(findPlayerByNickname(loadRankingBoard(storage), "UNKNOWN"), null);
  // 呼んでもプレイヤーは増えない。
  assert.equal(loadRankingBoard(storage).players.length, 1);
});

test("relativeTimeAgo は 1 日未満を分表記する（1 hour ではなく 60 min）", () => {
  const now = 10 * 24 * 60 * 60 * 1000;

  assert.equal(relativeTimeAgo(now - 10_000, now), "just now");
  assert.equal(relativeTimeAgo(now - 3 * 60_000, now), "3 min ago");
  assert.equal(relativeTimeAgo(now - 60 * 60_000, now), "60 min ago"); // 1 時間 → 60 min
  assert.equal(relativeTimeAgo(now - 2 * 60 * 60_000, now), "120 min ago");
  assert.equal(relativeTimeAgo(now - 5 * 24 * 60 * 60_000, now), "5 days ago");
});
