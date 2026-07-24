import type {
  PublicPlayerSuggestion,
  Rank,
  RegisteredSessionEntry,
  ScoreBreakdown,
  ServerPlayerProfile,
  VideoLevel,
} from "../shared/types.ts";

export type PlayerProfile = {
  playerId: string;
  nickname: string;
  playerNumber?: number | null;
  registeredAtMs: number;
  lastPlayedAtMs: number | null;
  highScore: number;
  playCount: number;
};

export type ScoreRecord = {
  recordId: string;
  playerId: string;
  nickname: string;
  score: number;
  damageYen: number;
  rank: Rank;
  videoLevel: VideoLevel;
  playedAtMs: number;
  isHighScore: boolean;
};

export type RankingBoardData = {
  schemaVersion: 1;
  players: PlayerProfile[];
  records: ScoreRecord[];
};

export type SavedScoreResult = {
  player: PlayerProfile;
  record: ScoreRecord;
  previousHighScore: number;
  isHighScore: boolean;
  board: RankingBoardData;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "hakkei.rankingBoard.v1";
const DEFAULT_PLAYER_ID = "local-guest";
export const DEFAULT_NICKNAME = "GUEST";
// ニックネーム許容文字。`.` を含む（要望: ピリオド入力対応）。
const NICKNAME_PATTERN = /^[A-Za-z0-9._-]{1,16}$/;
const REMOTE_PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function createEphemeralRankingStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function emptyBoard(): RankingBoardData {
  return { schemaVersion: 1, players: [], records: [] };
}

function isPlayerProfile(value: unknown): value is PlayerProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Partial<PlayerProfile>;
  return (
    typeof p.playerId === "string" &&
    typeof p.nickname === "string" &&
    typeof p.registeredAtMs === "number" &&
    (typeof p.lastPlayedAtMs === "number" || p.lastPlayedAtMs === null) &&
    typeof p.highScore === "number" &&
    typeof p.playCount === "number"
  );
}

function isScoreRecord(value: unknown): value is ScoreRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Partial<ScoreRecord>;
  return (
    typeof r.recordId === "string" &&
    typeof r.playerId === "string" &&
    typeof r.nickname === "string" &&
    typeof r.score === "number" &&
    typeof r.damageYen === "number" &&
    typeof r.rank === "string" &&
    typeof r.videoLevel === "number" &&
    typeof r.playedAtMs === "number" &&
    typeof r.isHighScore === "boolean"
  );
}

function sanitizeBoard(value: unknown): RankingBoardData {
  if (typeof value !== "object" || value === null) {
    return emptyBoard();
  }
  const data = value as Partial<RankingBoardData>;
  if (data.schemaVersion !== 1 || !Array.isArray(data.players) || !Array.isArray(data.records)) {
    return emptyBoard();
  }
  return {
    schemaVersion: 1,
    players: deduplicatePlayers(data.players.filter(isPlayerProfile).map(normalizePlayer)),
    records: data.records.filter(isScoreRecord).map(normalizeRecord),
  };
}

function normalizePlayer(p: PlayerProfile): PlayerProfile {
  return {
    playerId: p.playerId,
    nickname: p.nickname,
    playerNumber: normalizePlayerNumber((p as { playerNumber?: unknown }).playerNumber),
    registeredAtMs: p.registeredAtMs,
    lastPlayedAtMs: p.lastPlayedAtMs,
    highScore: p.highScore,
    playCount: p.playCount,
  };
}

function normalizePlayerNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.round(value);
  return n >= 26001 && n <= 26999 ? n : null;
}

function playerIdentityKey(player: PlayerProfile): string {
  const playerNumber = normalizePlayerNumber(player.playerNumber);
  return playerNumber === null ? `id:${player.playerId}` : `number:${playerNumber}`;
}

function laterPlayedAt(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

function earlierKnownRegistration(a: number, b: number): number {
  const known = [a, b].filter((value) => Number.isFinite(value) && value > 0);
  return known.length > 0 ? Math.min(...known) : Math.max(0, a, b);
}

function deduplicatePlayers(players: PlayerProfile[]): PlayerProfile[] {
  const result: PlayerProfile[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const player of players) {
    const normalized = normalizePlayer(player);
    const key = playerIdentityKey(normalized);
    const existingIndex = indexByIdentity.get(key);
    if (existingIndex === undefined) {
      indexByIdentity.set(key, result.length);
      result.push(normalized);
      continue;
    }
    const existing = result[existingIndex];
    if (!existing) {
      continue;
    }
    const preferred =
      existing.playerId.startsWith("public-") && !normalized.playerId.startsWith("public-")
        ? normalized
        : existing;
    result[existingIndex] = {
      ...preferred,
      nickname: normalized.nickname,
      playerNumber: normalizePlayerNumber(normalized.playerNumber ?? existing.playerNumber),
      registeredAtMs: earlierKnownRegistration(existing.registeredAtMs, normalized.registeredAtMs),
      lastPlayedAtMs: laterPlayedAt(existing.lastPlayedAtMs, normalized.lastPlayedAtMs),
      highScore: Math.max(existing.highScore, normalized.highScore),
      playCount: Math.max(existing.playCount, normalized.playCount),
    };
  }
  return result;
}

function normalizeRecord(r: ScoreRecord): ScoreRecord {
  return {
    recordId: r.recordId,
    playerId: r.playerId,
    nickname: r.nickname,
    score: r.score,
    damageYen: r.damageYen,
    rank: r.rank,
    videoLevel: r.videoLevel,
    playedAtMs: r.playedAtMs,
    isHighScore: r.isHighScore,
  };
}

export function loadRankingBoard(storage: StorageLike): RankingBoardData {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return emptyBoard();
  }
  try {
    return sanitizeBoard(JSON.parse(raw) as unknown);
  } catch {
    return emptyBoard();
  }
}

export function saveRankingBoard(storage: StorageLike, board: RankingBoardData): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    ...board,
    players: deduplicatePlayers(board.players),
  }));
}

export function clearRankingBoard(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY);
}

export function scoreFromBreakdown(breakdown: ScoreBreakdown): number {
  return Math.max(0, Math.round(Number.isFinite(breakdown.baseDamageYen) ? breakdown.baseDamageYen : 0));
}

export function validateNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname);
}

export function normalizeNickname(nickname: string): string {
  return nickname.trim().toUpperCase();
}

export function registeredNicknameSuggestions(
  board: RankingBoardData,
  queryInput: string,
  maxCount = 4,
): PlayerProfile[] {
  const query = normalizeNickname(queryInput);
  if (query.length === 0 || maxCount <= 0) {
    return [];
  }
  return rankingRows({ ...board, players: deduplicatePlayers(board.players) })
    .filter((player) => normalizeNickname(player.nickname).startsWith(query))
    .slice(0, maxCount);
}

function nicknameKey(nickname: string): string {
  return nickname.toLowerCase();
}

function findPlayerIndexByNickname(board: RankingBoardData, nickname: string): number {
  const key = nicknameKey(nickname);
  return board.players.findIndex((p) => nicknameKey(p.nickname) === key);
}

// 同名（大文字小文字を無視）の既存プレイヤーを返す。新規作成はしない。
// 登録時の「この名前は登録済みです。あなたですか？」確認に使う。
export function findPlayerByNickname(board: RankingBoardData, nicknameInput: string): PlayerProfile | null {
  const nickname = normalizeNickname(nicknameInput);
  const index = findPlayerIndexByNickname(board, nickname);
  return index >= 0 ? (board.players[index] ?? null) : null;
}

function remotePlayerIdKey(remotePlayerId: string): string {
  return `remote-${remotePlayerId}`;
}

function nextLocalPlayerId(board: RankingBoardData, nowMs: number): string {
  for (let i = 0; i < 10; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const candidate = `local-${nowMs}-${suffix}`;
    if (!board.players.some((p) => p.playerId === candidate)) {
      return candidate;
    }
  }
  return `local-${nowMs}-${board.players.length + 1}`;
}

export function getOrCreatePlayerProfile(
  storage: StorageLike,
  nicknameInput: string,
  nowMs: number,
): PlayerProfile | null {
  const nickname = normalizeNickname(nicknameInput);
  if (!validateNickname(nickname)) {
    return null;
  }
  const board = loadRankingBoard(storage);
  const existingIndex = findPlayerIndexByNickname(board, nickname);
  if (existingIndex >= 0) {
    return board.players[existingIndex] ?? null;
  }

  const player: PlayerProfile = {
    playerId: nextLocalPlayerId(board, nowMs),
    nickname,
    registeredAtMs: nowMs,
    lastPlayedAtMs: null,
    highScore: 0,
    playCount: 0,
  };
  saveRankingBoard(storage, { ...board, players: [...board.players, player] });
  return player;
}

export function getOrCreateRemotePlayerProfile(
  storage: StorageLike,
  remotePlayerIdInput: string,
  nicknameInput: string,
  nowMs: number,
  playerNumberInput?: number | null,
): PlayerProfile | null {
  const remotePlayerId = remotePlayerIdInput.trim();
  const nickname = normalizeNickname(nicknameInput);
  if (!REMOTE_PLAYER_ID_PATTERN.test(remotePlayerId) || !validateNickname(nickname)) {
    return null;
  }
  const board = loadRankingBoard(storage);
  const playerId = remotePlayerIdKey(remotePlayerId);
  const requestedPlayerNumber = normalizePlayerNumber(playerNumberInput);
  const existingIndex = board.players.findIndex(
    (p) =>
      p.playerId === playerId ||
      (requestedPlayerNumber !== null && normalizePlayerNumber(p.playerNumber) === requestedPlayerNumber),
  );
  if (existingIndex >= 0) {
    const existing = board.players[existingIndex];
    if (!existing) {
      return null;
    }
    if (
      existing.playerId === playerId &&
      existing.nickname === nickname &&
      (requestedPlayerNumber === null || normalizePlayerNumber(existing.playerNumber) === requestedPlayerNumber)
    ) {
      return existing;
    }
    const playerNumber = requestedPlayerNumber ?? normalizePlayerNumber(existing.playerNumber);
    const updated: PlayerProfile = {
      ...existing,
      playerId,
      nickname,
      playerNumber,
    };
    const nextPlayers = [...board.players];
    nextPlayers[existingIndex] = updated;
    const nextRecords = board.records.map((record) =>
      record.playerId === existing.playerId
        ? { ...record, playerId, nickname }
        : record
    );
    saveRankingBoard(storage, { ...board, players: nextPlayers, records: nextRecords });
    return updated;
  }

  const player: PlayerProfile = {
    playerId,
    nickname,
    playerNumber: requestedPlayerNumber,
    registeredAtMs: nowMs,
    lastPlayedAtMs: null,
    highScore: 0,
    playCount: 0,
  };
  saveRankingBoard(storage, { ...board, players: [...board.players, player] });
  return player;
}

export function importRemoteRegisteredPlayers(
  storage: StorageLike,
  entries: RegisteredSessionEntry[],
): RankingBoardData {
  const board = loadRankingBoard(storage);
  const latestByPlayerId = new Map<string, RegisteredSessionEntry>();
  for (const entry of entries) {
    const remotePlayerId = entry.playerId.trim();
    const nickname = normalizeNickname(entry.playerName);
    if (!REMOTE_PLAYER_ID_PATTERN.test(remotePlayerId) || !validateNickname(nickname)) {
      continue;
    }
    const previous = latestByPlayerId.get(remotePlayerId);
    if (!previous || entry.registeredAtMs >= previous.registeredAtMs) {
      latestByPlayerId.set(remotePlayerId, entry);
    }
  }

  if (latestByPlayerId.size === 0) {
    return board;
  }

  const players = [...board.players];
  let changed = false;
  for (const entry of latestByPlayerId.values()) {
    const playerId = remotePlayerIdKey(entry.playerId.trim());
    const nickname = normalizeNickname(entry.playerName);
    const existingIndex = players.findIndex((p) => p.playerId === playerId);
    if (existingIndex >= 0) {
      const existing = players[existingIndex];
      if (existing && existing.nickname !== nickname) {
        players[existingIndex] = { ...existing, nickname };
        changed = true;
      }
      continue;
    }
    players.push({
      playerId,
      nickname,
      playerNumber: normalizePlayerNumber(entry.playerNumber),
      registeredAtMs: entry.registeredAtMs,
      lastPlayedAtMs: null,
      highScore: 0,
      playCount: 0,
    });
    changed = true;
  }

  if (!changed) {
    return board;
  }
  const nextBoard = { ...board, players };
  saveRankingBoard(storage, nextBoard);
  return nextBoard;
}

export function importServerPlayerRegistry(
  storage: StorageLike,
  serverPlayers: ServerPlayerProfile[],
): RankingBoardData {
  const board = loadRankingBoard(storage);
  const players = [...board.players];
  let changed = false;

  for (const serverPlayer of serverPlayers) {
    const nickname = normalizeNickname(serverPlayer.nickname);
    const playerNumber = normalizePlayerNumber(serverPlayer.playerNumber);
    if (!REMOTE_PLAYER_ID_PATTERN.test(serverPlayer.playerId) || !validateNickname(nickname) || playerNumber === null) {
      continue;
    }
    const existingIndex = players.findIndex((p) => p.playerId === serverPlayer.playerId);
    if (existingIndex >= 0) {
      const existing = players[existingIndex];
      if (!existing) {
        continue;
      }
      const merged: PlayerProfile = {
        ...existing,
        nickname,
        playerNumber,
        registeredAtMs: serverPlayer.registeredAtMs,
        lastPlayedAtMs: serverPlayer.lastSeenAtMs,
      };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        players[existingIndex] = merged;
        changed = true;
      }
      continue;
    }
    players.push({
      playerId: serverPlayer.playerId,
      nickname,
      playerNumber,
      registeredAtMs: serverPlayer.registeredAtMs,
      lastPlayedAtMs: serverPlayer.lastSeenAtMs,
      highScore: 0,
      playCount: 0,
    });
    changed = true;
  }

  if (!changed) {
    return board;
  }
  const nextBoard = { ...board, players };
  saveRankingBoard(storage, nextBoard);
  return nextBoard;
}

export function importPublicPlayerSuggestions(
  storage: StorageLike,
  suggestions: PublicPlayerSuggestion[],
): RankingBoardData {
  const board = loadRankingBoard(storage);
  const players = [...board.players];
  let changed = false;

  for (const suggestion of suggestions) {
    const nickname = normalizeNickname(suggestion.nickname);
    const playerNumber = normalizePlayerNumber(suggestion.playerNumber);
    const registeredAtMs = suggestion.registeredAtMs;
    const lastPlayedAtMs = suggestion.lastPlayedAtMs;
    if (
      !validateNickname(nickname) ||
      playerNumber === null ||
      !Number.isFinite(registeredAtMs) ||
      registeredAtMs < 0 ||
      (
        lastPlayedAtMs !== null &&
        (!Number.isFinite(lastPlayedAtMs) || lastPlayedAtMs < 0)
      )
    ) {
      continue;
    }

    const existingIndex = players.findIndex(
      (player) => normalizePlayerNumber(player.playerNumber) === playerNumber,
    );
    if (existingIndex >= 0) {
      const existing = players[existingIndex];
      if (!existing) {
        continue;
      }
      const merged: PlayerProfile = {
        ...existing,
        nickname,
        playerNumber,
        registeredAtMs: earlierKnownRegistration(existing.registeredAtMs, registeredAtMs),
        lastPlayedAtMs: laterPlayedAt(existing.lastPlayedAtMs, lastPlayedAtMs),
      };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        players[existingIndex] = merged;
        changed = true;
      }
      continue;
    }

    players.push({
      playerId: `public-${playerNumber}`,
      nickname,
      playerNumber,
      registeredAtMs,
      lastPlayedAtMs,
      highScore: 0,
      playCount: 0,
    });
    changed = true;
  }

  if (!changed) {
    return board;
  }
  const nextBoard = { ...board, players };
  saveRankingBoard(storage, nextBoard);
  return nextBoard;
}

export function importServerRankingPlayers(
  storage: StorageLike,
  serverBoard: RankingBoardData,
): RankingBoardData {
  const board = loadRankingBoard(storage);
  const players = [...board.players];
  let changed = false;

  for (const serverPlayer of serverBoard.players.map(normalizePlayer)) {
    if (!validateNickname(serverPlayer.nickname)) {
      continue;
    }
    const serverPlayerNumber = normalizePlayerNumber(serverPlayer.playerNumber);
    const existingIndex = players.findIndex(
      (p) =>
        p.playerId === serverPlayer.playerId ||
        (serverPlayerNumber !== null && normalizePlayerNumber(p.playerNumber) === serverPlayerNumber),
    );
    if (existingIndex >= 0) {
      const existing = players[existingIndex];
      if (!existing) {
        continue;
      }
      const merged: PlayerProfile = {
        ...existing,
        nickname: normalizeNickname(serverPlayer.nickname),
        playerNumber: normalizePlayerNumber(serverPlayer.playerNumber),
        registeredAtMs: serverPlayer.registeredAtMs,
        lastPlayedAtMs: serverPlayer.lastPlayedAtMs,
        highScore: serverPlayer.highScore,
        playCount: serverPlayer.playCount,
      };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        players[existingIndex] = merged;
        changed = true;
      }
      continue;
    }
    players.push(normalizePlayer({
      playerId: serverPlayer.playerId,
      nickname: normalizeNickname(serverPlayer.nickname),
      playerNumber: normalizePlayerNumber(serverPlayer.playerNumber),
      registeredAtMs: serverPlayer.registeredAtMs,
      lastPlayedAtMs: serverPlayer.lastPlayedAtMs,
      highScore: serverPlayer.highScore,
      playCount: serverPlayer.playCount,
    }));
    changed = true;
  }

  if (!changed) {
    return board;
  }
  const nextBoard = { ...board, players: deduplicatePlayers(players) };
  saveRankingBoard(storage, nextBoard);
  return nextBoard;
}

export function recordScoreForPlayer(
  storage: StorageLike,
  player: PlayerProfile,
  breakdown: ScoreBreakdown,
  nowMs: number,
): SavedScoreResult {
  const board = loadRankingBoard(storage);
  const score = scoreFromBreakdown(breakdown);
  const playerIndex = board.players.findIndex((p) => p.playerId === player.playerId);
  const existing = playerIndex >= 0 ? board.players[playerIndex] : player;
  const previousHighScore = existing.highScore;
  const isHighScore = score > previousHighScore;
  const updatedPlayer: PlayerProfile = {
    ...existing,
    lastPlayedAtMs: nowMs,
    highScore: isHighScore ? score : previousHighScore,
    playCount: existing.playCount + 1,
  };
  const record: ScoreRecord = {
    recordId: `${updatedPlayer.playerId}-${nowMs}-${board.records.length + 1}`,
    playerId: updatedPlayer.playerId,
    nickname: updatedPlayer.nickname,
    score,
    damageYen: breakdown.damageYen,
    rank: breakdown.rank,
    videoLevel: breakdown.videoLevel,
    playedAtMs: nowMs,
    isHighScore,
  };

  const nextPlayers = [...board.players];
  if (playerIndex >= 0) {
    nextPlayers[playerIndex] = updatedPlayer;
  } else {
    nextPlayers.push(updatedPlayer);
  }
  const nextBoard = {
    schemaVersion: 1 as const,
    players: nextPlayers,
    records: [...board.records, record],
  };
  saveRankingBoard(storage, nextBoard);

  return { player: updatedPlayer, record, previousHighScore, isHighScore, board: nextBoard };
}

export function recordScoreForDefaultPlayer(
  storage: StorageLike,
  breakdown: ScoreBreakdown,
  nowMs: number,
): SavedScoreResult {
  const board = loadRankingBoard(storage);
  const playerIndex = board.players.findIndex((p) => p.playerId === DEFAULT_PLAYER_ID);
  const player: PlayerProfile = {
    playerId: DEFAULT_PLAYER_ID,
    nickname: board.players[playerIndex]?.nickname ?? DEFAULT_NICKNAME,
    registeredAtMs: board.players[playerIndex]?.registeredAtMs ?? nowMs,
    lastPlayedAtMs: board.players[playerIndex]?.lastPlayedAtMs ?? null,
    highScore: board.players[playerIndex]?.highScore ?? 0,
    playCount: board.players[playerIndex]?.playCount ?? 0,
  };
  return recordScoreForPlayer(storage, player, breakdown, nowMs);
}

// 指定プレイヤーとそのスコア記録をランキングから削除する。
export function removePlayer(storage: StorageLike, playerId: string): RankingBoardData {
  const board = loadRankingBoard(storage);
  const nextBoard: RankingBoardData = {
    schemaVersion: 1,
    players: board.players.filter((p) => p.playerId !== playerId),
    records: board.records.filter((r) => r.playerId !== playerId),
  };
  saveRankingBoard(storage, nextBoard);
  return nextBoard;
}

export function rankingRows(board: RankingBoardData): PlayerProfile[] {
  return [...board.players].sort((a, b) => {
    if (b.highScore !== a.highScore) {
      return b.highScore - a.highScore;
    }
    return (a.registeredAtMs - b.registeredAtMs) || a.nickname.localeCompare(b.nickname);
  });
}

export function relativeTimeAgo(fromMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - fromMs);
  const minuteMs = 60_000;
  const dayMs = 24 * 60 * minuteMs;
  if (elapsedMs < minuteMs) {
    return "just now";
  }
  // 1 日未満は「時間」ではなく「分」で表記する（要望: 1 hour ではなく 60 min）。
  if (elapsedMs < dayMs) {
    const n = Math.floor(elapsedMs / minuteMs);
    return `${n} min ago`;
  }
  const n = Math.floor(elapsedMs / dayMs);
  return `${n} day${n === 1 ? "" : "s"} ago`;
}
