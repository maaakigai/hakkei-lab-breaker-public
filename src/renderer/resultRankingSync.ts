import {
  rankingRows,
  type PlayerProfile,
  type RankingBoardData,
} from "./rankingStore.ts";

function samePlayer(a: PlayerProfile, b: PlayerProfile): boolean {
  if (a.playerId === b.playerId) {
    return true;
  }
  return (
    typeof a.playerNumber === "number" &&
    typeof b.playerNumber === "number" &&
    a.playerNumber === b.playerNumber
  );
}

export function rankingPlayerFor(
  board: RankingBoardData | null,
  player: PlayerProfile,
): PlayerProfile | null {
  return board?.players.find((candidate) => samePlayer(candidate, player)) ?? null;
}

export function rankingPositionFor(
  board: RankingBoardData | null,
  player: PlayerProfile,
): number | null {
  if (board === null) {
    return null;
  }
  const index = rankingRows(board).findIndex((candidate) => samePlayer(candidate, player));
  return index >= 0 ? index + 1 : null;
}
