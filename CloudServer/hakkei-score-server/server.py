#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from http import HTTPStatus
from pathlib import Path

from aiohttp import WSMsgType, web

HOST = "127.0.0.1"
PORT = 45200
BASE_DIR = Path(__file__).resolve().parent
SEED_DATA_DIR = BASE_DIR / "data"
DEFAULT_RUNTIME_DATA_DIR = SEED_DATA_DIR / "submission-runtime"
DATA_DIR = Path(
    os.environ.get("HAKKEI_DATA_DIR", str(DEFAULT_RUNTIME_DATA_DIR))
).expanduser().resolve()
DATA_FILE = DATA_DIR / "session-entries.json"
SESSION_EVENT_LOG_FILE = DATA_DIR / "session-events.log"
RANKING_FILE = DATA_DIR / "ranking-board.json"
PLAYERS_FILE = DATA_DIR / "players.json"
SEED_PLAYERS_FILE = SEED_DATA_DIR / "players.example.json"
SEED_RANKING_FILE = SEED_DATA_DIR / "ranking-board.example.json"
MAX_BODY_BYTES = 4096
MAX_WS_MESSAGE_BYTES = 4096
MAX_NAME_LENGTH = 16
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PLAYER_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
PLAYER_NAME_RE = re.compile(r"^[A-Z0-9._ -]{1,16}$")
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
PLAYER_NUMBER_MIN = 26001
PLAYER_NUMBER_MAX = 26999


def now_ms() -> int:
    return int(time.time() * 1000)


def load_entries() -> dict[str, dict[str, object]]:
    if not DATA_FILE.exists():
        return {}
    try:
        value = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def write_runtime_json(path: Path, value: object) -> None:
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    tmp.replace(path)


def save_entries(entries: dict[str, dict[str, object]]) -> None:
    write_runtime_json(DATA_FILE, entries)


def append_session_event(action: str, session_id: str | None, detail: dict[str, object] | None = None) -> None:
    """Write a server-local operational event without names or request bodies."""
    try:
        DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        event: dict[str, object] = {"atMs": now_ms(), "action": action}
        if session_id is not None:
            event["sessionId"] = session_id
        if detail:
            blocked_keys = {
                "body",
                "httpbody",
                "nickname",
                "payload",
                "playername",
                "requestbody",
            }
            event.update(
                {
                    key: value
                    for key, value in detail.items()
                    if key.lower() not in blocked_keys
                    and isinstance(value, (bool, int, float, str))
                }
            )
        with SESSION_EVENT_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError:
        pass


def empty_ranking_board() -> dict[str, object]:
    return {"schemaVersion": 1, "players": [], "records": []}


def empty_player_registry() -> dict[str, object]:
    return {"schemaVersion": 1, "players": []}


def _load_seed_json(path: Path, label: str) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot load {label} seed data: {path}") from exc
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise RuntimeError(f"invalid {label} seed data: {path}")
    return value


def initialize_runtime_data() -> bool:
    """Seed a completely new data directory with the public synthetic fixture."""
    if DATA_DIR == SEED_DATA_DIR.resolve():
        raise RuntimeError(
            "HAKKEI_DATA_DIR must not be the bundled data/ seed directory; "
            "use a separate access-controlled runtime directory"
        )
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(path.exists() for path in (DATA_FILE, PLAYERS_FILE, RANKING_FILE)):
        return False

    registry = _load_seed_json(SEED_PLAYERS_FILE, "player registry")
    board = _load_seed_json(SEED_RANKING_FILE, "ranking board")
    expected_names = [f"PLAYER {index:03d}" for index in range(1, 11)]
    registry_players = registry.get("players")
    ranking_players = board.get("players")
    ranking_records = board.get("records")
    if (
        not isinstance(registry_players, list)
        or not isinstance(ranking_players, list)
        or not isinstance(ranking_records, list)
        or [player.get("nickname") for player in registry_players if isinstance(player, dict)]
        != expected_names
        or [player.get("nickname") for player in ranking_players if isinstance(player, dict)]
        != expected_names
        or len(ranking_records) != 10
    ):
        raise RuntimeError("synthetic seed must contain PLAYER 001 through PLAYER 010")

    write_runtime_json(DATA_FILE, {})
    write_runtime_json(PLAYERS_FILE, registry)
    write_runtime_json(RANKING_FILE, board)
    return True


def load_ranking_board() -> dict[str, object]:
    if not RANKING_FILE.exists():
        return empty_ranking_board()
    try:
        value = json.loads(RANKING_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return empty_ranking_board()
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        return empty_ranking_board()
    players = value.get("players")
    records = value.get("records")
    return {
        "schemaVersion": 1,
        "players": players if isinstance(players, list) else [],
        "records": records if isinstance(records, list) else [],
    }


def save_ranking_board(board: dict[str, object]) -> None:
    write_runtime_json(RANKING_FILE, board)


def registry_player_id(value: object) -> str | None:
    player_id = valid_player_id(value)
    if player_id is None:
        return None
    if player_id.startswith("remote-") or player_id.startswith("local-"):
        return player_id
    return f"remote-{player_id}"


def valid_player_number(value: object) -> int | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not float(value).is_integer()
    ):
        return None
    n = int(value)
    return n if PLAYER_NUMBER_MIN <= n <= PLAYER_NUMBER_MAX else None


def load_player_registry() -> dict[str, object]:
    if not PLAYERS_FILE.exists():
        return empty_player_registry()
    try:
        value = json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return empty_player_registry()
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        return empty_player_registry()
    players = []
    seen_ids: set[str] = set()
    seen_numbers: set[int] = set()
    for raw in value.get("players", []):
        if not isinstance(raw, dict):
            continue
        player_id = registry_player_id(raw.get("playerId"))
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        last_seen = finite_number(raw.get("lastSeenAtMs"))
        if (
            player_id is None
            or nickname is None
            or player_number is None
            or registered_at is None
            or player_id in seen_ids
            or player_number in seen_numbers
        ):
            continue
        seen_ids.add(player_id)
        seen_numbers.add(player_number)
        players.append({
            "playerId": player_id,
            "nickname": nickname,
            "playerNumber": player_number,
            "registeredAtMs": int(registered_at),
            "lastSeenAtMs": int(last_seen) if last_seen is not None else None,
        })
    players.sort(key=lambda p: int(p["playerNumber"]))
    return {"schemaVersion": 1, "players": players}


def save_player_registry(registry: dict[str, object]) -> None:
    write_runtime_json(PLAYERS_FILE, registry)


def next_player_number(players: list[dict[str, object]]) -> int | None:
    used = {
        int(p["playerNumber"])
        for p in players
        if isinstance(p.get("playerNumber"), int)
        and PLAYER_NUMBER_MIN <= int(p["playerNumber"]) <= PLAYER_NUMBER_MAX
    }
    for n in range(PLAYER_NUMBER_MIN, PLAYER_NUMBER_MAX + 1):
        if n not in used:
            return n
    return None


def upsert_player_registry(
    player_id_value: object,
    nickname_value: object,
    *,
    registered_at_ms: object | None = None,
    last_seen_at_ms: object | None = None,
) -> dict[str, object] | None:
    player_id = registry_player_id(player_id_value)
    nickname = valid_player_name(nickname_value)
    if player_id is None or nickname is None:
        return None
    registry = load_player_registry()
    players = [p for p in registry.get("players", []) if isinstance(p, dict)]
    now = now_ms()
    registered_at = finite_number(registered_at_ms)
    last_seen = finite_number(last_seen_at_ms)
    existing_index = next((i for i, p in enumerate(players) if p.get("playerId") == player_id), -1)
    if existing_index >= 0:
        existing = players[existing_index]
        existing_registered = finite_number(existing.get("registeredAtMs"))
        existing_last_seen = finite_number(existing.get("lastSeenAtMs"))
        next_registered = int(min(
            existing_registered if existing_registered is not None else registered_at or now,
            registered_at if registered_at is not None else existing_registered or now,
        ))
        next_last_seen = int(max(
            existing_last_seen if existing_last_seen is not None else 0,
            last_seen if last_seen is not None else now,
        ))
        updated = {
            **existing,
            "nickname": nickname,
            "registeredAtMs": next_registered,
            "lastSeenAtMs": next_last_seen,
        }
        players[existing_index] = updated
        save_player_registry({"schemaVersion": 1, "players": players})
        return updated
    player_number = next_player_number(players)
    if player_number is None:
        return None
    player = {
        "playerId": player_id,
        "nickname": nickname,
        "playerNumber": player_number,
        "registeredAtMs": int(registered_at if registered_at is not None else now),
        "lastSeenAtMs": int(last_seen if last_seen is not None else now),
    }
    players.append(player)
    players.sort(key=lambda p: int(p["playerNumber"]))
    save_player_registry({"schemaVersion": 1, "players": players})
    return player


def sync_player_registry_from_existing_data() -> dict[str, object]:
    board = load_ranking_board()
    for raw in board.get("players", []):
        if isinstance(raw, dict):
            upsert_player_registry(
                raw.get("playerId"),
                raw.get("nickname"),
                registered_at_ms=raw.get("registeredAtMs"),
                last_seen_at_ms=raw.get("lastPlayedAtMs"),
            )
    for raw in load_entries().values():
        if isinstance(raw, dict):
            upsert_player_registry(
                raw.get("playerId"),
                raw.get("playerName"),
                registered_at_ms=raw.get("registeredAtMs"),
                last_seen_at_ms=raw.get("registeredAtMs"),
            )
    return load_player_registry()


def player_number_for(player_id_value: object) -> int | None:
    player_id = registry_player_id(player_id_value)
    if player_id is None:
        return None
    registry = sync_player_registry_from_existing_data()
    for player in registry.get("players", []):
        if isinstance(player, dict) and player.get("playerId") == player_id:
            number = valid_player_number(player.get("playerNumber"))
            if number is not None:
                return number
    return None


def ranking_board_with_player_numbers() -> dict[str, object]:
    registry = sync_player_registry_from_existing_data()
    by_id = {
        str(player.get("playerId")): player
        for player in registry.get("players", [])
        if isinstance(player, dict) and isinstance(player.get("playerId"), str)
    }
    board = load_ranking_board()
    changed = False
    players = []
    for raw in board.get("players", []):
        if not isinstance(raw, dict):
            continue
        player_id = registry_player_id(raw.get("playerId"))
        registry_player = by_id.get(player_id or "")
        if registry_player is not None:
            next_player = {**raw, "playerNumber": registry_player.get("playerNumber")}
            if next_player != raw:
                changed = True
            players.append(next_player)
        else:
            players.append(raw)
    next_board = {"schemaVersion": 1, "players": players, "records": board.get("records", [])}
    if changed:
        save_ranking_board(next_board)
    return next_board


def public_player_suggestions() -> dict[str, object]:
    """Return only fields used by the name-selection UI."""
    registry = sync_player_registry_from_existing_data()
    board = load_ranking_board()
    ranking_by_id = {
        registry_player_id(raw.get("playerId")): raw
        for raw in board.get("players", [])
        if isinstance(raw, dict)
        and registry_player_id(raw.get("playerId")) is not None
    }
    players: list[dict[str, object]] = []
    for raw in registry.get("players", []):
        if not isinstance(raw, dict):
            continue
        player_id = registry_player_id(raw.get("playerId"))
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        if (
            player_id is None
            or nickname is None
            or player_number is None
            or registered_at is None
        ):
            continue
        ranked = ranking_by_id.get(player_id)
        last_played = (
            finite_number(ranked.get("lastPlayedAtMs"))
            if isinstance(ranked, dict)
            else None
        )
        high_score = (
            finite_number(ranked.get("highScore"))
            if isinstance(ranked, dict)
            else 0.0
        )
        play_count = (
            finite_number(ranked.get("playCount"))
            if isinstance(ranked, dict)
            else 0.0
        )
        players.append(
            {
                "nickname": nickname,
                "playerNumber": player_number,
                "registeredAtMs": int(registered_at),
                "lastPlayedAtMs": (
                    int(last_played) if last_played is not None else None
                ),
                "highScore": max(0, int(round(high_score or 0))),
                "playCount": max(0, int(round(play_count or 0))),
            }
        )
    players.sort(
        key=lambda player: (
            int(player["registeredAtMs"]),
            str(player["nickname"]),
            int(player["playerNumber"]),
        )
    )
    return {"players": players}


def public_ranking_board(
    *,
    submitted_player_number: object = None,
) -> dict[str, object]:
    """Return no persistent IDs or per-play records."""
    board = ranking_board_with_player_numbers()
    players: list[dict[str, object]] = []
    for raw in board.get("players", []):
        if not isinstance(raw, dict):
            continue
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        last_played = finite_number(raw.get("lastPlayedAtMs"))
        high_score = finite_number(raw.get("highScore"))
        high_score_critical_bonus = valid_bonus_yen(
            raw.get("highScoreCriticalBonusYen")
        )
        play_count = finite_number(raw.get("playCount"))
        if (
            nickname is None
            or player_number is None
            or registered_at is None
            or high_score is None
            or high_score_critical_bonus is None
            or play_count is None
        ):
            continue
        players.append(
            {
                "nickname": nickname,
                "playerNumber": player_number,
                "registeredAtMs": int(registered_at),
                "lastPlayedAtMs": (
                    int(last_played) if last_played is not None else None
                ),
                "highScore": max(0, int(round(high_score))),
                "highScoreCriticalBonusYen": high_score_critical_bonus,
                "playCount": max(0, int(round(play_count))),
            }
        )
    players.sort(
        key=lambda player: (
            -int(player["highScore"]),
            int(player["registeredAtMs"]),
            str(player["nickname"]),
            int(player["playerNumber"]),
        )
    )
    response: dict[str, object] = {"schemaVersion": 1, "players": players}
    submitted_number = valid_player_number(submitted_player_number)
    if submitted_number is not None:
        # POSTしたクライアントが、公開レスポンスから自分の行を安全に特定するための
        # response-only marker。公開済みのplayerNumberだけを返し、playerIdは公開しない。
        response["submittedPlayerNumber"] = submitted_number
    return response


def valid_session_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if SESSION_ID_RE.fullmatch(value) else None


def valid_player_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if PLAYER_ID_RE.fullmatch(value) else None


def valid_player_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if not normalized or len(normalized) > MAX_NAME_LENGTH:
        return None
    return normalized if PLAYER_NAME_RE.fullmatch(normalized) else None


def finite_number(value: object) -> float | None:
    if (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and value == value
        and value not in (float("inf"), float("-inf"))
    ):
        return float(value)
    return None


def valid_bonus_yen(value: object) -> str | None:
    if value is None:
        return "0"
    if isinstance(value, str) and re.fullmatch(r"^\d{1,32}$", value):
        return str(int(value))
    number = finite_number(value)
    if number is not None and 0 <= number <= 9_007_199_254_740_991:
        return str(int(round(number)))
    return None


def valid_damage_yen_text(value: object, fallback: object = None) -> str:
    if isinstance(value, str):
        digits = re.sub(r"\D", "", value)
        if digits:
            return digits
    if isinstance(fallback, (int, float)) and fallback >= 0:
        return str(int(round(fallback)))
    return "0"


def build_ranking_player(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    player_id = valid_player_id(value.get("playerId"))
    nickname = valid_player_name(value.get("nickname"))
    registered_at = finite_number(value.get("registeredAtMs"))
    if (
        player_id is None
        or nickname is None
        or registered_at is None
        or registered_at < 0
        or registered_at > 9_999_999_999_999
        or not registered_at.is_integer()
    ):
        return None
    return {
        "playerId": player_id,
        "nickname": nickname,
        "registeredAtMs": int(registered_at),
        "lastPlayedAtMs": None,
        "highScore": 0,
        "highScoreCriticalBonusYen": "0",
        "playCount": 0,
    }


def build_ranking_record(value: object, player: dict[str, object], previous_high_score: int, record_index: int) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    # `score` is the legacy wire name for baseDamageYen. Critical bonus is
    # stored independently and never contributes to leaderboard ordering.
    score = finite_number(value.get("score"))
    explicit_base = finite_number(value.get("baseDamageYen"))
    damage_yen = finite_number(value.get("damageYen"))
    video_level = finite_number(value.get("videoLevel"))
    played_at = finite_number(value.get("playedAtMs"))
    rank = value.get("rank")
    critical_bonus = valid_bonus_yen(value.get("criticalBonusYen"))
    if (
        score is None
        or damage_yen is None
        or video_level is None
        or played_at is None
        or critical_bonus is None
        or not isinstance(rank, str)
        or not 1 <= len(rank) <= 16
        or score < 0
        or damage_yen < 0
        or played_at < 0
        or score > 9_007_199_254_740_991
        or damage_yen > 9_007_199_254_740_991
        or not score.is_integer()
        or not damage_yen.is_integer()
        or not played_at.is_integer()
        or not video_level.is_integer()
        or not 0 <= video_level <= 5
    ):
        return None
    if "baseDamageYen" in value and explicit_base is None:
        return None
    if explicit_base is not None and explicit_base != score:
        return None
    score_i = max(0, int(round(score)))
    damage_yen_i = max(0, int(round(damage_yen)))
    if damage_yen_i != score_i + int(critical_bonus):
        return None
    played_at_i = int(played_at)
    is_high_score = score_i > previous_high_score
    return {
        "recordId": f"{player['playerId']}-{played_at_i}-{record_index + 1}",
        "playerId": player["playerId"],
        "nickname": player["nickname"],
        "score": score_i,
        "baseDamageYen": score_i,
        "damageYen": damage_yen_i,
        "criticalBonusYen": critical_bonus,
        "rank": rank,
        "videoLevel": max(0, min(5, int(round(video_level)))),
        "playedAtMs": played_at_i,
        "isHighScore": is_high_score,
    }


def record_ranking_score(payload: object) -> dict[str, object] | None:
    if not isinstance(payload, dict):
        return None
    player = build_ranking_player(payload.get("player"))
    if player is None:
        return None
    if build_ranking_record(payload.get("record"), player, 0, 0) is None:
        return None
    registry_player = upsert_player_registry(
        player.get("playerId"),
        player.get("nickname"),
        registered_at_ms=player.get("registeredAtMs"),
        last_seen_at_ms=payload.get("record", {}).get("playedAtMs") if isinstance(payload.get("record"), dict) else None,
    )
    if registry_player is not None:
        player["playerNumber"] = registry_player.get("playerNumber")
    board = load_ranking_board()
    players = [p for p in board.get("players", []) if isinstance(p, dict)]
    records = [r for r in board.get("records", []) if isinstance(r, dict)]
    existing_index = next((i for i, p in enumerate(players) if p.get("playerId") == player["playerId"]), -1)
    existing = players[existing_index] if existing_index >= 0 else None
    previous_high_score = int(existing.get("highScore", 0)) if isinstance(existing, dict) else 0
    record = build_ranking_record(payload.get("record"), player, previous_high_score, len(records))
    if record is None:
        return None
    duplicate = next(
        (
            existing_record
            for existing_record in records
            if existing_record.get("playerId") == record["playerId"]
            and finite_number(existing_record.get("playedAtMs")) == record["playedAtMs"]
            and finite_number(existing_record.get("score")) == record["score"]
            and finite_number(existing_record.get("damageYen")) == record["damageYen"]
            and str(existing_record.get("criticalBonusYen", "0"))
            == record["criticalBonusYen"]
            and finite_number(existing_record.get("videoLevel"))
            == record["videoLevel"]
            and existing_record.get("rank") == record["rank"]
        ),
        None,
    )
    if duplicate is not None:
        append_session_event(
            "ranking_duplicate",
            None,
            {"playerId": str(record["playerId"])},
        )
        return public_ranking_board(
            submitted_player_number=player.get("playerNumber"),
        )
    updated_player = {
        **player,
        "registeredAtMs": int(existing.get("registeredAtMs", player["registeredAtMs"])) if isinstance(existing, dict) else player["registeredAtMs"],
        "lastPlayedAtMs": record["playedAtMs"],
        "playerNumber": player.get("playerNumber", existing.get("playerNumber") if isinstance(existing, dict) else None),
        "highScore": max(previous_high_score, int(record["score"])),
        "highScoreCriticalBonusYen": record["criticalBonusYen"] if record["isHighScore"] else (
            existing.get("highScoreCriticalBonusYen", "0") if isinstance(existing, dict) else "0"
        ),
        "playCount": (int(existing.get("playCount", 0)) if isinstance(existing, dict) else 0) + 1,
    }
    if existing_index >= 0:
        players[existing_index] = updated_player
    else:
        players.append(updated_player)
    next_board = {"schemaVersion": 1, "players": players, "records": [*records, record]}
    save_ranking_board(next_board)
    append_session_event(
        "ranking_recorded",
        None,
        {"playerId": str(record["playerId"])},
    )
    return public_ranking_board(
        submitted_player_number=player.get("playerNumber"),
    )


JOIN_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>REGISTRATION</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: clamp(14px, 3vh, 28px) 0;
      background:
        radial-gradient(circle at 50% 0%, rgba(255, 140, 72, 0.18), transparent 32%),
        radial-gradient(circle at 50% 38%, rgba(88, 216, 255, 0.12), transparent 42%),
        linear-gradient(180deg, #070b13 0%, #101723 48%, #05070d 100%);
      color: rgba(232, 240, 252, 0.92);
      overflow-x: hidden;
    }
    main { width: min(720px, 96vw); animation: titleMenuIn 420ms ease-out both; }
    @keyframes titleMenuIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
    .title-logo {
      display: block;
      width: min(760px, 86vw);
      margin: 0 auto clamp(12px, 2vh, 18px);
      filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.46));
      user-select: none;
    }
    .register-topbar {
      position: relative;
      display: grid;
      grid-template-columns: 1fr;
      align-items: center;
      justify-items: center;
      min-height: 2.9rem;
      margin-bottom: 0.75rem;
    }
    h1 {
      position: relative;
      width: min(100%, 620px);
      margin: 0 auto;
      padding: 0.4rem 0.6rem 0.62rem;
      color: #fff2df;
      font-size: clamp(1.35rem, 6.2vw, 3rem);
      font-weight: 900;
      letter-spacing: clamp(0.12em, 2.4vw, 0.28em);
      line-height: 1.12;
      text-align: center;
      text-indent: clamp(0.12em, 2.4vw, 0.28em);
      text-transform: uppercase;
      white-space: nowrap;
      text-shadow: 0 0 18px rgba(255, 150, 70, 0.34), 0 2px 14px rgba(0, 0, 0, 0.95);
    }
    h1::before, h1::after {
      content: "";
      position: absolute;
      left: 8%;
      right: 8%;
      height: 1px;
      pointer-events: none;
    }
    h1::before { top: 0; background: linear-gradient(90deg, transparent, rgba(120, 232, 255, 0.78), transparent); }
    h1::after { bottom: 0; background: linear-gradient(90deg, transparent, rgba(255, 196, 120, 0.84), transparent); filter: drop-shadow(0 0 5px rgba(255, 120, 60, 0.48)); }
    .register-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: clamp(1rem, 3vh, 1.55rem) 1rem 1rem;
      border-top: 1px solid rgba(120, 232, 255, 0.22);
      background: linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.34));
      box-shadow: inset 0 0 0 1px rgba(120, 232, 255, 0.12), 0 16px 42px rgba(0, 0, 0, 0.28);
    }
    .register-divider {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      width: min(460px, 100%);
      margin: 0 0 0.75rem;
      color: rgba(255, 212, 121, 0.74);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .register-divider::before, .register-divider::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(255, 196, 120, 0.58), transparent); }
    form, .license-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      padding: 0.95rem 1rem 1rem;
      background: rgba(0, 0, 0, 0.28);
      box-shadow: inset 0 -1px 0 rgba(255, 196, 120, 0.2), inset 0 0 0 1px rgba(120, 232, 255, 0.1);
    }
    label { width: min(460px, 100%); }
    input {
      width: 100%;
      min-height: 3.35rem;
      padding: 0 1.1rem;
      border: 1px solid rgba(120, 232, 255, 0.32);
      border-radius: 0;
      background: rgba(3, 7, 13, 0.76);
      color: #fff2df;
      font-size: clamp(1.35rem, 7vw, 2.6rem);
      font-weight: 900;
      letter-spacing: 0.16em;
      text-align: center;
      text-transform: uppercase;
      outline: none;
      box-shadow: inset 0 0 24px rgba(120, 232, 255, 0.08), 0 0 18px rgba(0, 0, 0, 0.22);
    }
    input:focus { border-color: rgba(255, 196, 120, 0.72); box-shadow: 0 0 0 2px rgba(255, 196, 120, 0.16), inset 0 0 24px rgba(120, 232, 255, 0.1); }
    input::placeholder { color: rgba(232, 240, 252, 0.35); }
    .hint, .license-note {
      width: min(460px, 100%);
      margin: 0.55rem 0 0.85rem;
      color: rgba(232, 240, 252, 0.62);
      font-size: 0.82rem;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
      line-height: 1.5;
    }
    .privacy-note {
      width: min(460px, 100%);
      margin: 0 0 0.9rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid rgba(255, 196, 120, 0.28);
      color: rgba(255, 232, 198, 0.86);
      font-size: 0.74rem;
      line-height: 1.55;
      text-align: center;
    }
    .license-name {
      width: min(460px, 100%);
      min-height: 3.35rem;
      display: grid;
      place-items: center;
      min-width: 0;
      margin-bottom: 0.75rem;
      padding: 0.35rem 0.75rem;
      border: 1px solid rgba(120, 232, 255, 0.32);
      background: rgba(3, 7, 13, 0.76);
      color: #fff2df;
      font-size: clamp(1.15rem, 12vw, 3.2rem);
      font-weight: 900;
      letter-spacing: clamp(0.02em, 1vw, 0.16em);
      line-height: 1.05;
      overflow: hidden;
      text-align: center;
      text-transform: uppercase;
      text-wrap: nowrap;
      white-space: nowrap;
      box-shadow: inset 0 0 24px rgba(120, 232, 255, 0.08), 0 0 18px rgba(0, 0, 0, 0.22);
    }
    .license-id {
      min-height: 1rem;
      margin: -0.35rem 0 0.65rem;
      color: rgba(120, 232, 255, 0.72);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-align: center;
      text-transform: uppercase;
    }
    button {
      position: relative;
      width: min(460px, 100%);
      min-height: 3.35rem;
      border: 1px solid rgba(255, 196, 120, 0.72);
      border-radius: 0;
      background: linear-gradient(180deg, rgba(255, 130, 62, 0.22), rgba(255, 96, 48, 0.08)), rgba(5, 10, 18, 0.92);
      color: #fff2df;
      font-size: clamp(1rem, 4.6vw, 1.45rem);
      font-weight: 900;
      letter-spacing: 0.24em;
      text-indent: 0.24em;
      text-transform: uppercase;
      text-shadow: 0 0 14px rgba(255, 150, 70, 0.5), 0 2px 10px rgba(0, 0, 0, 0.95);
      clip-path: polygon(3% 0, 97% 0, 100% 50%, 97% 100%, 3% 100%, 0 50%);
    }
    button.secondary, button.danger {
      margin-top: 0.72rem;
      border-color: rgba(120, 232, 255, 0.38);
      background: rgba(0, 0, 0, 0.24);
      color: rgba(232, 240, 252, 0.86);
      font-size: 0.82rem;
      letter-spacing: 0.18em;
      text-indent: 0.18em;
    }
    button.danger { border-color: rgba(255, 120, 120, 0.58); color: rgba(255, 184, 184, 0.92); }
    button.ready-button {
      margin: 0.35rem 0 0.72rem;
      border-color: rgba(138, 255, 198, 0.78);
      background: linear-gradient(180deg, rgba(64, 255, 173, 0.22), rgba(30, 156, 114, 0.12)), rgba(5, 10, 18, 0.92);
      color: #d9ffe9;
      text-shadow: 0 0 14px rgba(112, 255, 188, 0.45), 0 2px 10px rgba(0, 0, 0, 0.95);
    }
    button.ready-button:disabled {
      opacity: 0.68;
      color: rgba(217, 255, 233, 0.72);
    }
    .option-panel {
      width: min(460px, 100%);
      margin-top: 0.72rem;
      padding-top: 0.62rem;
      border-top: 1px solid rgba(120, 232, 255, 0.18);
    }
    .option-panel button:first-child { margin-top: 0; }
    .option-panel button {
      min-height: 2.85rem;
      margin-top: 0.56rem;
      border-color: rgba(120, 232, 255, 0.24);
      background: rgba(0, 0, 0, 0.18);
      color: rgba(232, 240, 252, 0.74);
      font-size: 0.78rem;
      letter-spacing: 0.16em;
      text-indent: 0.16em;
      text-shadow: none;
      box-shadow: none;
      clip-path: none;
    }
    .option-panel button.danger {
      border-color: rgba(255, 120, 120, 0.34);
      background: rgba(0, 0, 0, 0.14);
      color: rgba(255, 170, 170, 0.78);
    }
    .status {
      width: min(460px, 100%);
      margin-top: 0.85rem;
      min-height: 1.4em;
      color: rgba(148, 255, 198, 0.92);
      font-weight: 900;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .status.error { color: rgba(255, 130, 130, 0.92); }
    .input-warning {
      width: min(460px, 100%);
      margin: -0.35rem 0 0.85rem;
      color: rgba(255, 130, 130, 0.96);
      font-size: 0.82rem;
      font-weight: 400;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .hidden { display: none !important; }
    .scanner-panel {
      width: 100%;
      padding: 0;
      border: 1px solid rgba(120, 232, 255, 0.28);
      background: rgba(0, 0, 0, 0.32);
      box-shadow: inset 0 0 22px rgba(120, 232, 255, 0.08);
    }
    .scanner-panel video {
      display: block;
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      background: #02050a;
    }
    .scanner-note {
      margin: 0.65rem 0 0;
      color: rgba(232, 240, 252, 0.68);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1.45;
      text-align: center;
      text-transform: uppercase;
    }
    .scanner-status {
      width: 100%;
      margin-top: 0.75rem;
    }
    dialog {
      width: min(460px, 92vw);
      border: 1px solid rgba(120, 232, 255, 0.34);
      padding: 1rem;
      background: #060b13;
      color: rgba(232, 240, 252, 0.92);
      box-shadow: 0 22px 80px rgba(0, 0, 0, 0.72), inset 0 0 0 1px rgba(255, 196, 120, 0.16);
    }
    dialog::backdrop { background: rgba(0, 0, 0, 0.68); }
    .dialog-title { margin: 0 0 0.9rem; color: #fff2df; font-size: 1.1rem; font-weight: 900; letter-spacing: 0.16em; text-align: center; text-transform: uppercase; }
    #result-dialog {
      width: min(560px, 94vw);
      padding: clamp(1rem, 4vw, 1.35rem);
      border-color: rgba(120, 232, 255, 0.36);
      background:
        radial-gradient(circle at 50% 0%, rgba(255, 160, 64, 0.18), transparent 38%),
        radial-gradient(circle at 50% 44%, rgba(84, 205, 255, 0.12), transparent 54%),
        linear-gradient(180deg, #05080f 0%, #0b111d 52%, #03050a 100%);
      box-shadow:
        0 24px 88px rgba(0, 0, 0, 0.78),
        inset 0 0 0 1px rgba(255, 196, 120, 0.14),
        inset 0 0 38px rgba(120, 232, 255, 0.07);
    }
    #result-dialog form {
      width: 100%;
      padding: 0.3rem 0 0;
      background: transparent;
      box-shadow: none;
    }
    .phone-result-title {
      position: relative;
      width: 100%;
      margin: 0 auto 1.05rem;
      padding: 0.2rem 0 0.52rem;
      color: #f8fbff;
      font-size: clamp(1.7rem, 9vw, 3.2rem);
      font-weight: 950;
      letter-spacing: 0.24em;
      text-indent: 0.24em;
      text-align: center;
      text-transform: uppercase;
      text-shadow:
        0 0 10px rgba(120, 232, 255, 0.38),
        0 3px 18px rgba(0, 0, 0, 0.96);
    }
    .phone-result-title::before,
    .phone-result-title::after {
      content: "";
      position: absolute;
      left: 9%;
      right: 9%;
      height: 1px;
      pointer-events: none;
    }
    .phone-result-title::before { top: 0; background: linear-gradient(90deg, transparent, rgba(120, 232, 255, 0.78), transparent); }
    .phone-result-title::after { bottom: 0; background: linear-gradient(90deg, transparent, rgba(255, 196, 120, 0.86), transparent); filter: drop-shadow(0 0 5px rgba(255, 140, 60, 0.5)); }
    .phone-result-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.7em;
      width: 100%;
      margin: 0.1rem 0 0.45rem;
      color: #ffe08a;
      font-size: clamp(0.78rem, 3.3vw, 1rem);
      font-weight: 900;
      letter-spacing: 0.25em;
      text-indent: 0.25em;
      text-align: center;
      text-transform: uppercase;
      text-shadow:
        0 0 13px rgba(255, 172, 62, 0.7),
        0 2px 12px rgba(0, 0, 0, 0.92);
    }
    .phone-result-label::before,
    .phone-result-label::after {
      content: "";
      flex: 1 1 48px;
      max-width: 92px;
      height: 2px;
      border-radius: 2px;
      box-shadow: 0 0 10px rgba(255, 176, 66, 0.48);
    }
    .phone-result-label::before { background: linear-gradient(90deg, transparent, rgba(255, 196, 92, 0.92)); }
    .phone-result-label::after { background: linear-gradient(90deg, rgba(255, 196, 92, 0.92), transparent); }
    .phone-result-damage {
      width: 100%;
      min-height: clamp(4.3rem, 19vw, 6.5rem);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.04em 0.17em;
      margin: 0.1rem auto 0.95rem;
      padding: 0.2rem 0.15rem 0.35rem;
      color: #ffd479;
      font-size: clamp(1.8rem, 10vw, 3.9rem);
      font-weight: 950;
      line-height: 1.02;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      text-align: center;
      text-shadow:
        0 2px 8px rgba(0, 0, 0, 0.95),
        0 0 22px rgba(255, 160, 64, 0.72);
    }
    .phone-result-damage.long {
      font-size: clamp(1.35rem, 7.4vw, 3rem);
      line-height: 1.08;
    }
    .phone-result-damage.mega {
      font-size: clamp(1.05rem, 5.8vw, 2.35rem);
      line-height: 1.12;
    }
    .phone-result-damage .yen-mark {
      flex: 0 0 auto;
      font-size: 0.74em;
      opacity: 0.92;
    }
    .phone-result-damage .damage-group {
      display: inline-block;
      white-space: nowrap;
    }
    .phone-result-damage .damage-group:not(:last-child)::after {
      content: ",";
      margin-left: 0.02em;
      opacity: 0.76;
    }
    .device-wait-card {
      width: 100%;
      padding: 0.9rem 0.35rem 0.55rem;
      text-align: center;
    }
    .device-wait-ring {
      width: clamp(6rem, 34vw, 9rem);
      height: clamp(6rem, 34vw, 9rem);
      display: grid;
      place-items: center;
      margin: 0 auto 0.95rem;
      border: 2px solid rgba(120, 232, 255, 0.38);
      border-radius: 50%;
      background: radial-gradient(circle, rgba(120, 232, 255, 0.14), rgba(5, 10, 18, 0.88) 58%, rgba(0, 0, 0, 0.96));
      box-shadow:
        0 0 26px rgba(120, 232, 255, 0.24),
        inset 0 0 26px rgba(120, 232, 255, 0.14);
      animation: deviceWaitPulse 1.25s ease-in-out infinite;
    }
    .device-wait-ring::before {
      content: "";
      width: 46%;
      height: 46%;
      border: 2px solid rgba(255, 196, 120, 0.86);
      border-top-color: transparent;
      border-radius: 50%;
      animation: deviceWaitSpin 1s linear infinite;
      filter: drop-shadow(0 0 8px rgba(255, 176, 66, 0.55));
    }
    .device-wait-en {
      color: #f8fbff;
      font-size: clamp(1.25rem, 6.4vw, 2rem);
      font-weight: 950;
      letter-spacing: 0.2em;
      text-indent: 0.2em;
      text-transform: uppercase;
      text-shadow: 0 0 16px rgba(120, 232, 255, 0.35), 0 2px 14px rgba(0, 0, 0, 0.95);
    }
    .device-wait-ja {
      margin-top: 0.2rem;
      color: rgba(255, 224, 138, 0.9);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    @keyframes deviceWaitPulse {
      0%, 100% { transform: scale(1); opacity: 0.82; }
      50% { transform: scale(1.04); opacity: 1; }
    }
    @keyframes deviceWaitSpin {
      to { transform: rotate(360deg); }
    }
    #result-exit {
      border-color: rgba(255, 196, 120, 0.56);
      color: rgba(255, 242, 223, 0.92);
      background: rgba(0, 0, 0, 0.34);
    }
  </style>
</head>
<body>
  <main>
    <img class="title-logo" src="/assets/title/logo.png" alt="UBI-LAB BREAK SIMULATOR" draggable="false">
    <div class="register-topbar"><h1 id="page-title">REGISTRATION</h1></div>
    <section class="register-panel">
      <form id="entry-form" novalidate>
        <div class="register-divider"><span>ENTER YOUR NAME</span></div>
        <label><input id="player-name" name="playerName" maxlength="16" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" lang="en" inputmode="latin" pattern="[A-Z0-9._ -]{1,16}" placeholder="PLAYER 001" required></label>
        <p class="hint">1-16 CHARACTERS: A-Z, 0-9, SPACE, ., _ OR -</p>
        <p class="privacy-note">登録したニックネームとスコアは共有ランキングに公開され、デモ運用のためサーバーに保存されます。実名や個人情報は入力しないでください。<br>NICKNAME AND SCORE ARE SAVED AND SHOWN ON THE SHARED LEADERBOARD.</p>
        <p class="input-warning hidden" id="name-warning" role="alert">USE HALF-WIDTH A-Z, 0-9, SPACE, ., _ OR -.</p>
        <button type="submit">REGISTER</button>
        <div class="status" id="status" role="status" aria-live="polite"></div>
      </form>
      <div class="license-card hidden" id="license-card">
        <div class="register-divider"><span>PLAYER LICENSE</span></div>
        <div class="license-name" id="license-name"></div>
        <div class="license-id hidden" id="license-id"></div>
        <p class="license-note" id="license-note">THIS PHONE WILL USE THIS NAME FOR THE CURRENT PLAY.</p>
        <button type="button" id="scan-qr">SCAN QR</button>
        <button type="button" class="secondary" id="option-toggle" aria-expanded="false" aria-controls="option-panel">OPTION</button>
        <div class="option-panel hidden" id="option-panel">
          <button type="button" id="change-name">CHANGE NAME</button>
          <button type="button" class="danger" id="delete-license">DELETE LICENSE</button>
        </div>
        <div class="status" id="license-status" role="status" aria-live="polite"></div>
      </div>
    </section>
  </main>
  <dialog id="name-dialog">
    <form method="dialog" id="change-name-form" novalidate>
      <p class="dialog-title">CHANGE NAME</p>
      <label><input id="dialog-player-name" maxlength="16" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" lang="en" inputmode="latin" pattern="[A-Z0-9._ -]{1,16}" required></label>
      <p class="hint">1-16 CHARACTERS: A-Z, 0-9, SPACE, ., _ OR -</p>
      <p class="input-warning hidden" id="dialog-name-warning" role="alert">USE HALF-WIDTH A-Z, 0-9, SPACE, ., _ OR -.</p>
      <button value="confirm">SAVE NAME</button>
      <button type="button" class="secondary" id="dialog-cancel">CANCEL</button>
    </form>
  </dialog>
  <dialog id="scanner-dialog">
    <form method="dialog">
      <p class="dialog-title">SCAN QR</p>
      <div class="scanner-panel" id="scanner-panel">
        <video id="scanner-video" playsinline muted></video>
        <p class="scanner-note">POINT THE CAMERA AT THE REGISTRATION QR.</p>
      </div>
      <div class="status scanner-status" id="scanner-status" role="status" aria-live="polite"></div>
      <button type="button" class="secondary" id="scanner-cancel">CANCEL SCAN</button>
    </form>
  </dialog>
  <dialog id="ready-dialog">
    <form method="dialog">
      <p class="dialog-title">ARE YOU READY?</p>
      <p class="scanner-note">MOCOPI IS LINKED ON THE GAME SCREEN.</p>
      <button type="button" class="ready-button" id="ready-play">I'M READY</button>
      <button type="button" class="secondary" id="ready-cancel">CANCEL</button>
      <div class="status scanner-status" id="ready-status" role="status" aria-live="polite"></div>
    </form>
  </dialog>
  <dialog id="device-wait-dialog">
    <form method="dialog">
      <p class="dialog-title">INPUT CHECK</p>
      <div class="device-wait-card">
        <div class="device-wait-ring" aria-hidden="true"></div>
        <div class="device-wait-en">CONNECTING</div>
        <div class="device-wait-ja">WAITING FOR INPUT DEVICE</div>
        <p class="scanner-note">KEEP THIS PAGE OPEN UNTIL THE GAME SCREEN SHOWS CONNECTED.</p>
        <button type="button" class="secondary" id="device-wait-cancel">CANCEL</button>
      </div>
    </form>
  </dialog>
  <dialog id="result-dialog">
    <form method="dialog" class="result-dialog-form">
      <p class="phone-result-title">RESULT</p>
      <div class="phone-result-label">TOTAL DAMAGE</div>
      <div class="phone-result-damage" id="result-damage">¥ 0</div>
      <button type="button" class="secondary" id="result-exit">EXIT</button>
    </form>
  </dialog>
  <script src="/assets/js/jsQR.js"></script>
  <script>
    const storageKey = "hakkei-score-player-v1";
    const allowedNamePattern = /^[A-Z0-9._ -]{1,16}$/;
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("sessionId") || "";
    const isLicensePath = location.pathname === "/license";
    const titleEl = document.getElementById("page-title");
    const form = document.getElementById("entry-form");
    const licenseCard = document.getElementById("license-card");
    const nameInput = document.getElementById("player-name");
    const licenseNameEl = document.getElementById("license-name");
    const licenseIdEl = document.getElementById("license-id");
    const licenseNoteEl = document.getElementById("license-note");
    const statusEl = document.getElementById("status");
    const licenseStatusEl = document.getElementById("license-status");
    const nameWarningEl = document.getElementById("name-warning");
    const scanQrButton = document.getElementById("scan-qr");
    const scannerDialog = document.getElementById("scanner-dialog");
    const scannerPanel = document.getElementById("scanner-panel");
    const scannerVideo = document.getElementById("scanner-video");
    const scannerCancel = document.getElementById("scanner-cancel");
    const scannerStatusEl = document.getElementById("scanner-status");
    const readyDialog = document.getElementById("ready-dialog");
    const readyPlayButton = document.getElementById("ready-play");
    const readyCancel = document.getElementById("ready-cancel");
    const readyStatusEl = document.getElementById("ready-status");
    const deviceWaitDialog = document.getElementById("device-wait-dialog");
    const deviceWaitCancel = document.getElementById("device-wait-cancel");
    const resultDialog = document.getElementById("result-dialog");
    const resultDamageEl = document.getElementById("result-damage");
    const resultExit = document.getElementById("result-exit");
    const optionToggle = document.getElementById("option-toggle");
    const optionPanel = document.getElementById("option-panel");
    const changeNameButton = document.getElementById("change-name");
    const deleteLicenseButton = document.getElementById("delete-license");
    const nameDialog = document.getElementById("name-dialog");
    const changeNameForm = document.getElementById("change-name-form");
    const dialogNameInput = document.getElementById("dialog-player-name");
    const dialogNameWarningEl = document.getElementById("dialog-name-warning");
    const dialogCancel = document.getElementById("dialog-cancel");
    let scannerStream = null;
    let scannerActive = false;
    let lastShownResultAtMs = 0;
    let resultPollingStarted = false;
    let deviceWaitDismissed = false;
    let lastSeenInputCheckAtMs = 0;
    let localPlayingStarted = false;
    let uiEpoch = 0;
    const inputCheckPollMs = 400;
    const inputCheckSlowPollMs = 900;
    const resultPollMs = 800;
    let sessionSocket = null;
    let sessionSocketState = "closed";
    const scannerCanvas = document.createElement("canvas");
    const scannerCanvasContext = scannerCanvas.getContext("2d", { willReadFrequently: true });

    function setStatus(target, message, isError = false) {
      target.textContent = message;
      target.classList.toggle("error", isError);
    }

    function normalizeName(value) {
      return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9._ -]/g, "").trim().replace(/ +/g, " ").slice(0, 16);
    }

    function isHalfWidthNameInput(value) {
      return /^[A-Za-z0-9._ -]{1,16}$/.test(value);
    }

    function updateNameWarning(input, warningEl) {
      const hasWarning = input.value.length > 0 && !isHalfWidthNameInput(input.value);
      warningEl.classList.toggle("hidden", !hasWarning);
      return !hasWarning;
    }

    function getSavedPlayer() {
      try { return JSON.parse(localStorage.getItem(storageKey) || "null"); }
      catch { return null; }
    }

    function savePlayer(player) {
      localStorage.setItem(storageKey, JSON.stringify(player));
    }

    function playerNumberLabel(player) {
      const n = player && typeof player.playerNumber === "number" ? Math.round(player.playerNumber) : 0;
      return n >= 26001 && n <= 26999 ? "ID" + n : "";
    }

    function playerFromRegistrationPayload(payload, fallbackPlayer) {
      const next = {
        playerId: payload && payload.playerId ? payload.playerId : fallbackPlayer.playerId,
        playerName: payload && payload.playerName ? payload.playerName : fallbackPlayer.playerName
      };
      if (payload && typeof payload.playerNumber === "number") {
        next.playerNumber = payload.playerNumber;
      } else if (typeof fallbackPlayer.playerNumber === "number") {
        next.playerNumber = fallbackPlayer.playerNumber;
      }
      return next;
    }

    function deletePlayer() {
      localStorage.removeItem(storageKey);
    }

    function randomId() {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    }

    function remoteEvent(type, extra = {}) {
      return Object.assign({
        protocolVersion: 1,
        eventId: "phone-" + randomId(),
        type,
        sessionId,
        sentAtMs: Date.now(),
        actor: "phone"
      }, extra);
    }

    function sendSessionWs(type, extra = {}) {
      if (!sessionId || !sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return false;
      sessionSocket.send(JSON.stringify(remoteEvent(type, extra)));
      return true;
    }

    function currentJoinUrl(pathname) {
      const next = new URL(location.href);
      next.pathname = pathname;
      return next.pathname + next.search;
    }

    function sessionIdFromQrValue(value) {
      try {
        const url = new URL(value, location.href);
        const nextSessionId = url.searchParams.get("sessionId") || "";
        if (!nextSessionId || !/^[A-Za-z0-9_-]{1,80}$/.test(nextSessionId)) return "";
        if (nextSessionId === sessionId) return "";
        if (url.origin !== location.origin && url.hostname !== "score.hakkei.org") return "";
        if (url.pathname !== "/join" && url.pathname !== "/license") return "";
        return nextSessionId;
      } catch {
        return "";
      }
    }

    function stopQrScanner() {
      scannerActive = false;
      if (scannerStream) {
        scannerStream.getTracks().forEach((track) => track.stop());
        scannerStream = null;
      }
      scannerVideo.srcObject = null;
      if (scannerDialog.open) scannerDialog.close();
    }

    async function startQrScanner() {
      if (!("BarcodeDetector" in window) && typeof jsQR !== "function") {
        setStatus(licenseStatusEl, "QR SCAN IS NOT SUPPORTED. USE THE PHONE CAMERA APP.", true);
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus(licenseStatusEl, "CAMERA ACCESS IS NOT AVAILABLE.", true);
        return;
      }
      uiEpoch += 1;
      stopQrScanner();
      scannerDialog.showModal();
      setStatus(scannerStatusEl, "STARTING CAMERA...");
      try {
        scannerStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        scannerVideo.srcObject = scannerStream;
        await scannerVideo.play();
        const detector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
        scannerActive = true;
        setStatus(scannerStatusEl, "SCANNING QR...");
        const scanFrame = async () => {
          if (!scannerActive) return;
          try {
            if (detector) {
              const codes = await detector.detect(scannerVideo);
              for (const code of codes) {
                const nextSessionId = sessionIdFromQrValue(code.rawValue || "");
                if (nextSessionId) {
                  stopQrScanner();
                  location.href = "/license?sessionId=" + encodeURIComponent(nextSessionId);
                  return;
                }
              }
            } else if (scannerCanvasContext && scannerVideo.videoWidth > 0 && scannerVideo.videoHeight > 0) {
              scannerCanvas.width = scannerVideo.videoWidth;
              scannerCanvas.height = scannerVideo.videoHeight;
              scannerCanvasContext.drawImage(scannerVideo, 0, 0, scannerCanvas.width, scannerCanvas.height);
              const imageData = scannerCanvasContext.getImageData(0, 0, scannerCanvas.width, scannerCanvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
              const nextSessionId = sessionIdFromQrValue(code && code.data ? code.data : "");
              if (nextSessionId) {
                stopQrScanner();
                location.href = "/license?sessionId=" + encodeURIComponent(nextSessionId);
                return;
              }
            }
          } catch {
            setStatus(scannerStatusEl, "QR SCAN FAILED.", true);
            stopQrScanner();
            return;
          }
          setTimeout(() => requestAnimationFrame(scanFrame), detector ? 0 : 140);
        };
        requestAnimationFrame(scanFrame);
      } catch (error) {
        stopQrScanner();
        setStatus(licenseStatusEl, error && error.message ? error.message : "CAMERA ACCESS DENIED.", true);
      }
    }

    async function register(playerName, playerId) {
      if (!allowedNamePattern.test(playerName)) throw new Error("USE A-Z, 0-9, SPACE, ., _ OR -.");
      if (!sessionId) {
        return { sessionId: "", playerId, playerName, registeredAtMs: Date.now(), localOnly: true };
      }
      const response = await fetch("/api/session-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, playerId, playerName })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "REGISTRATION FAILED.");
      return payload;
    }

    async function markReady(playerId) {
      if (!sessionId) return { localOnly: true };
      if (sendSessionWs("phone.ready", { playerId })) return { ws: true };
      const response = await fetch("/api/session-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, playerId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "READY FAILED.");
      return payload;
    }

    async function markCancel(playerId) {
      if (!sessionId) return { localOnly: true };
      if (sendSessionWs("phone.cancel", { playerId })) return { ws: true };
      const response = await fetch("/api/session-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, playerId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "CANCEL FAILED.");
      return payload;
    }

    async function markResultExit(playerId) {
      if (!sessionId) return { localOnly: true };
      if (sendSessionWs("phone.resultExit", { playerId })) return { ws: true };
      const response = await fetch("/api/session-result-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, playerId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "EXIT FAILED.");
      return payload;
    }

    async function fetchCurrentEntry() {
      if (!sessionId) return null;
      const response = await fetch("/api/session-entry?sessionId=" + encodeURIComponent(sessionId), {
        cache: "no-store"
      });
      if (response.status === 404) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "SESSION CHECK FAILED.");
      return payload;
    }

    async function restoreCurrentEntry(playerId) {
      const saved = getSavedPlayer();
      if (!sessionId || !saved || saved.playerId !== playerId || !saved.playerName) {
        throw new Error("ENTRY NOT FOUND. SCAN THE GAME QR AGAIN.");
      }
      return await register(normalizeName(saved.playerName), playerId);
    }

    async function retryAfterMissingEntry(action, playerId) {
      try {
        return await action();
      } catch (error) {
        const message = error && error.message ? String(error.message).toLowerCase() : "";
        if (!message.includes("entry not found")) {
          throw error;
        }
        await restoreCurrentEntry(playerId);
        return await action();
      }
    }

    function applySessionEntry(entry) {
      if (!entry || entry.sessionId !== sessionId) return;
      if (isResultOpen(entry)) {
        showResultDialog(entry);
        return;
      }
      if (isPlaying(entry)) {
        showPlayingState();
        return;
      }
      if (isCanceled(entry)) {
        showCanceledState();
        return;
      }
      if (isResultClosed(entry)) {
        if (resultDialog.open) resultDialog.close();
        if (readyDialog.open) readyDialog.close();
        if (deviceWaitDialog.open) deviceWaitDialog.close();
        setStatus(licenseStatusEl, "LICENSE ACTIVE.");
        return;
      }
      noteInputCheckSeen(entry);
      if (isInputDeviceReady(entry)) {
        enableReadyButton();
      } else if (activeInputCheckAtMs(entry) > 0) {
        if (readyDialog.open) readyDialog.close();
        showDeviceWaitDialog();
      } else {
        setStatus(licenseStatusEl, "WAITING FOR GAME SCREEN...");
      }
    }

    function connectSessionSocket(playerId) {
      if (!sessionId || !("WebSocket" in window)) return;
      if (sessionSocket && (sessionSocket.readyState === WebSocket.OPEN || sessionSocket.readyState === WebSocket.CONNECTING)) return;
      const wsUrl = new URL("/ws", location.href);
      wsUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("client", "phone");
      wsUrl.searchParams.set("sessionId", sessionId);
      if (playerId) wsUrl.searchParams.set("playerId", playerId);
      sessionSocketState = "connecting";
      sessionSocket = new WebSocket(wsUrl.toString());
      sessionSocket.addEventListener("open", () => {
        sessionSocketState = "open";
      });
      sessionSocket.addEventListener("message", (event) => {
        let payload = null;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (!payload || payload.protocolVersion !== 1 || payload.sessionId !== sessionId) return;
        if (payload.entry) applySessionEntry(payload.entry);
      });
      sessionSocket.addEventListener("close", () => {
        sessionSocketState = "closed";
        sessionSocket = null;
        setTimeout(() => {
          const saved = getSavedPlayer();
          if (saved && saved.playerId && sessionId) connectSessionSocket(saved.playerId);
        }, 1500);
      });
      sessionSocket.addEventListener("error", () => {
        sessionSocketState = "fallback";
      });
    }

    function enableReadyButton() {
      const saved = getSavedPlayer();
      if (!saved || !saved.playerId || !sessionId) return;
      deviceWaitDismissed = false;
      showLicense(saved, false);
      setStatus(licenseStatusEl, "LICENSE ACTIVE. TAP READY WHEN THE GAME SCREEN IS CONNECTED.");
      setStatus(readyStatusEl, "");
      readyPlayButton.disabled = false;
      readyPlayButton.textContent = "I'M READY";
      if (deviceWaitDialog.open) deviceWaitDialog.close();
      if (!readyDialog.open) {
        readyDialog.showModal();
      }
    }

    function showDeviceWaitDialog() {
      if (deviceWaitDismissed) return;
      if (readyDialog.open || resultDialog.open) return;
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId) {
        showLicense(saved, false);
      }
      setStatus(licenseStatusEl, "WAITING FOR INPUT DEVICE...");
      if (!deviceWaitDialog.open) {
        deviceWaitDialog.showModal();
      }
    }

    function damageDigits(entry) {
      const rawText = entry && typeof entry.resultDamageYenText === "string" ? entry.resultDamageYenText.replace(/\\D/g, "") : "";
      if (rawText) return rawText.replace(/^0+(?=\\d)/, "") || "0";
      const rawNumber = entry && typeof entry.resultDamageYen === "number" ? entry.resultDamageYen : 0;
      return String(Math.max(0, Math.round(rawNumber)));
    }

    function renderDamageAmount(entry) {
      const digits = damageDigits(entry);
      const groups = [];
      for (let i = digits.length; i > 0; i -= 3) {
        groups.unshift(digits.slice(Math.max(0, i - 3), i));
      }
      resultDamageEl.classList.toggle("long", digits.length > 12);
      resultDamageEl.classList.toggle("mega", digits.length > 18);
      resultDamageEl.innerHTML = '<span class="yen-mark">¥</span>' + groups.map((group) => {
        return '<span class="damage-group">' + group + '</span>';
      }).join("");
    }

    function resultAtMs(entry) {
      return entry && typeof entry.resultAtMs === "number" ? entry.resultAtMs : 0;
    }

    function resultExitAtMs(entry) {
      return entry && typeof entry.resultExitAtMs === "number" ? entry.resultExitAtMs : 0;
    }

    function isResultClosed(entry) {
      const resultAt = resultAtMs(entry);
      const exitAt = resultExitAtMs(entry);
      return resultAt > 0 && exitAt >= resultAt;
    }

    function isResultOpen(entry) {
      return resultAtMs(entry) > 0 && !isResultClosed(entry);
    }

    function inputCheckAtMs(entry) {
      return entry && typeof entry.inputCheckAtMs === "number" ? entry.inputCheckAtMs : 0;
    }

    function inputCheckExitAtMs(entry) {
      return entry && typeof entry.inputCheckExitAtMs === "number" ? entry.inputCheckExitAtMs : 0;
    }

    function activeInputCheckAtMs(entry) {
      const inputCheckAt = inputCheckAtMs(entry);
      return inputCheckAt > inputCheckExitAtMs(entry) ? inputCheckAt : 0;
    }

    function inputDeviceReadyAtMs(entry) {
      return entry && typeof entry.inputDeviceReadyAtMs === "number" ? entry.inputDeviceReadyAtMs : 0;
    }

    function playStartedAtMs(entry) {
      return entry && typeof entry.playStartedAtMs === "number" ? entry.playStartedAtMs : 0;
    }

    function isPlaying(entry) {
      const playStartedAt = playStartedAtMs(entry);
      return (localPlayingStarted || playStartedAt > 0) && resultAtMs(entry) <= 0;
    }

    function cancelAtMs(entry) {
      return entry && typeof entry.cancelAtMs === "number" ? entry.cancelAtMs : 0;
    }

    function registeredAtMs(entry) {
      return entry && typeof entry.registeredAtMs === "number" ? entry.registeredAtMs : 0;
    }

    function isCanceled(entry) {
      return cancelAtMs(entry) > registeredAtMs(entry) && !isPlaying(entry) && resultAtMs(entry) <= 0;
    }

    function noteInputCheckSeen(entry) {
      const inputCheckAt = activeInputCheckAtMs(entry);
      if (inputCheckAt > lastSeenInputCheckAtMs) {
        lastSeenInputCheckAtMs = inputCheckAt;
        deviceWaitDismissed = false;
      }
    }

    function isInputDeviceReady(entry) {
      const inputCheckAt = activeInputCheckAtMs(entry);
      const readyAt = inputDeviceReadyAtMs(entry);
      return inputCheckAt > 0 && readyAt >= inputCheckAt;
    }

    function showPlayingState() {
      localPlayingStarted = true;
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId) {
        showLicense(saved, false);
      }
      if (readyDialog.open) readyDialog.close();
      if (deviceWaitDialog.open) deviceWaitDialog.close();
      if (scannerDialog.open) stopQrScanner();
      setStatus(readyStatusEl, "");
      setStatus(licenseStatusEl, "PLAYING. WATCH THE GAME SCREEN.");
      licenseNoteEl.textContent = "PLAYING. WATCH THE GAME SCREEN.";
      waitForGameResult();
    }

    function showCanceledState() {
      localPlayingStarted = false;
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId) {
        showLicense(saved, false);
      }
      if (readyDialog.open) readyDialog.close();
      if (deviceWaitDialog.open) deviceWaitDialog.close();
      if (scannerDialog.open) stopQrScanner();
      if (nameDialog.open) nameDialog.close();
      setStatus(readyStatusEl, "");
      setStatus(licenseStatusEl, "SESSION CANCELED. SCAN THE GAME QR AGAIN.");
      licenseNoteEl.textContent = "SESSION CANCELED. SCAN THE GAME QR AGAIN.";
    }

    function showResultDialog(entry) {
      const resultAt = resultAtMs(entry);
      if (!isResultOpen(entry) || resultAt <= lastShownResultAtMs) return;
      lastShownResultAtMs = resultAt;
      renderDamageAmount(entry);
      if (readyDialog.open) readyDialog.close();
      if (deviceWaitDialog.open) deviceWaitDialog.close();
      if (scannerDialog.open) stopQrScanner();
      if (nameDialog.open) nameDialog.close();
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId) {
        showLicense(saved, false);
      }
      setStatus(licenseStatusEl, "RESULT RECEIVED.");
      if (!resultDialog.open) resultDialog.showModal();
    }

    async function closeResultDialog() {
      if (resultDialog.open) resultDialog.close();
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId) {
        showLicense(saved, false);
        try {
          await markResultExit(saved.playerId);
          setStatus(licenseStatusEl, "EXIT SENT. LICENSE ACTIVE.");
          return;
        } catch {
          setStatus(licenseStatusEl, "LICENSE ACTIVE.");
          return;
        }
      }
      setStatus(licenseStatusEl, sessionId ? "LICENSE ACTIVE." : "THIS PHONE IS READY. SCAN THE GAME QR TO JOIN.");
    }

    function waitForGameResult() {
      if (!sessionId) return;
      if (resultPollingStarted) return;
      resultPollingStarted = true;
      const pollEpoch = uiEpoch;
      const poll = async () => {
        if (pollEpoch !== uiEpoch) return;
        try {
          const entry = await fetchCurrentEntry();
          if (pollEpoch !== uiEpoch) return;
          if (isResultOpen(entry)) {
            showResultDialog(entry);
          } else if (isPlaying(entry)) {
            showPlayingState();
          } else if (isResultClosed(entry)) {
            if (resultDialog.open) resultDialog.close();
            if (readyDialog.open) readyDialog.close();
            if (deviceWaitDialog.open) deviceWaitDialog.close();
            setStatus(licenseStatusEl, "LICENSE ACTIVE.");
          }
        } catch {
          // Result polling is passive. Keep the license UI usable even if a transient request fails.
        }
        if (pollEpoch !== uiEpoch) return;
        setTimeout(poll, resultPollMs);
      };
      poll();
    }

    function waitForGameInputCheck() {
      if (!sessionId) return;
      let stopped = false;
      let attempts = 0;
      const pollEpoch = uiEpoch;
      const poll = async () => {
        if (pollEpoch !== uiEpoch) return;
        if (stopped) return;
        attempts += 1;
        try {
          const entry = await fetchCurrentEntry();
          if (pollEpoch !== uiEpoch) return;
          if (isResultOpen(entry)) {
            showResultDialog(entry);
            stopped = true;
            return;
          }
          if (isPlaying(entry)) {
            showPlayingState();
            stopped = true;
            return;
          }
          if (isCanceled(entry)) {
            showCanceledState();
            stopped = true;
            return;
          }
          if (isResultClosed(entry)) {
            stopped = true;
            if (readyDialog.open) readyDialog.close();
            if (deviceWaitDialog.open) deviceWaitDialog.close();
            setStatus(licenseStatusEl, "LICENSE ACTIVE.");
            return;
          }
          noteInputCheckSeen(entry);
          if (isInputDeviceReady(entry)) {
            enableReadyButton();
          } else if (activeInputCheckAtMs(entry) > 0) {
            if (readyDialog.open) readyDialog.close();
            showDeviceWaitDialog();
          } else {
            setStatus(licenseStatusEl, "WAITING FOR GAME SCREEN...");
          }
        } catch (error) {
          setStatus(licenseStatusEl, error.message || "SESSION CHECK FAILED.", true);
        }
        if (pollEpoch !== uiEpoch) return;
        setTimeout(poll, attempts < 180 ? inputCheckPollMs : inputCheckSlowPollMs);
      };
      poll();
    }

    function showRegistration() {
      titleEl.textContent = "REGISTRATION";
      form.classList.remove("hidden");
      licenseCard.classList.add("hidden");
    }

    function showLicense(player, readyVisible = false) {
      titleEl.textContent = "LICENSE";
      form.classList.add("hidden");
      licenseCard.classList.remove("hidden");
      licenseNameEl.textContent = player.playerName;
      licenseNameEl.style.setProperty("--name-len", String(Math.max(1, player.playerName.length)));
      const idLabel = playerNumberLabel(player);
      licenseIdEl.textContent = idLabel;
      licenseIdEl.classList.toggle("hidden", !idLabel);
      requestAnimationFrame(fitLicenseName);
      licenseNoteEl.textContent = sessionId
        ? (readyVisible
          ? "MOCOPI LINKED ON THE GAME SCREEN? TAP READY TO START."
          : "WAIT FOR THE GAME SCREEN TO CHANGE.")
        : "THIS PHONE IS READY. SCAN THE GAME QR TO JOIN A PLAY.";
    }

    function fitLicenseName() {
      const name = licenseNameEl.textContent || "";
      if (!name) return;
      licenseNameEl.style.fontSize = "";
      licenseNameEl.style.letterSpacing = "";
      const maxPx = Math.min(52, Math.max(22, window.innerWidth * 0.12));
      const minPx = 16;
      let fontPx = Math.min(maxPx, Math.max(minPx, (licenseNameEl.clientWidth - 24) / Math.max(1, name.length * 0.92)));
      licenseNameEl.style.fontSize = fontPx + "px";
      if (name.length >= 13) {
        licenseNameEl.style.letterSpacing = "0.02em";
      }
      for (let i = 0; i < 18 && licenseNameEl.scrollWidth > licenseNameEl.clientWidth && fontPx > minPx; i += 1) {
        fontPx -= 1;
        licenseNameEl.style.fontSize = fontPx + "px";
      }
    }

    async function registerSavedPlayer(player) {
      const playerName = normalizeName(player.playerName);
      if (!allowedNamePattern.test(playerName)) {
        deletePlayer();
        location.replace(currentJoinUrl("/join"));
        return;
      }
      const normalizedPlayer = { playerId: player.playerId, playerName };
      if (typeof player.playerNumber === "number") normalizedPlayer.playerNumber = player.playerNumber;
      savePlayer(normalizedPlayer);
      connectSessionSocket(normalizedPlayer.playerId);
      showLicense(normalizedPlayer, false);
      if (!sessionId) {
        setStatus(licenseStatusEl, "LICENSE READY. SCAN GAME QR TO JOIN.");
        return;
      }
      setStatus(licenseStatusEl, "REGISTERING LICENSE...");
      try {
        const registered = await register(playerName, normalizedPlayer.playerId);
        const registeredPlayer = playerFromRegistrationPayload(registered, normalizedPlayer);
        savePlayer(registeredPlayer);
        showLicense(registeredPlayer, false);
        setStatus(licenseStatusEl, "WAITING FOR GAME SCREEN...");
        waitForGameInputCheck();
        waitForGameResult();
      } catch (error) {
        setStatus(licenseStatusEl, error.message, true);
      }
    }

    function routeInitialView() {
      const saved = getSavedPlayer();
      if (saved && saved.playerName && saved.playerId && !isLicensePath) {
        location.replace(currentJoinUrl("/license"));
        return;
      }
      if ((!saved || !saved.playerName || !saved.playerId) && isLicensePath) {
        location.replace(currentJoinUrl("/join"));
        return;
      }
      if (saved && saved.playerName && saved.playerId) {
        connectSessionSocket(saved.playerId);
        registerSavedPlayer(saved);
      } else {
        showRegistration();
      }
    }

    nameInput.addEventListener("input", () => updateNameWarning(nameInput, nameWarningEl));
    dialogNameInput.addEventListener("input", () => updateNameWarning(dialogNameInput, dialogNameWarningEl));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!updateNameWarning(nameInput, nameWarningEl) || !isHalfWidthNameInput(nameInput.value)) {
        setStatus(statusEl, "USE HALF-WIDTH A-Z, 0-9, SPACE, ., _ OR -.", true);
        nameInput.focus();
        return;
      }
      const playerName = normalizeName(nameInput.value);
      nameInput.value = playerName;
      const saved = getSavedPlayer();
      const playerId = saved && saved.playerId ? saved.playerId : randomId();
      setStatus(statusEl, "REGISTERING...");
      try {
        const registered = await register(playerName, playerId);
        savePlayer(playerFromRegistrationPayload(registered, { playerId, playerName, playerNumber: saved ? saved.playerNumber : undefined }));
        location.replace(currentJoinUrl("/license"));
      } catch (error) {
        setStatus(statusEl, error.message, true);
      }
    });

    changeNameButton.addEventListener("click", () => {
      const saved = getSavedPlayer();
      dialogNameInput.value = saved && saved.playerName ? normalizeName(saved.playerName) : "";
      nameDialog.showModal();
      dialogNameInput.focus();
      dialogNameInput.select();
    });

    scanQrButton.addEventListener("click", () => {
      startQrScanner();
    });

    readyPlayButton.addEventListener("click", async () => {
      const saved = getSavedPlayer();
      if (!saved || !saved.playerId) {
        setStatus(licenseStatusEl, "REGISTER YOUR LICENSE FIRST.", true);
        return;
      }
      readyPlayButton.disabled = true;
      readyPlayButton.textContent = "READY SENT";
      setStatus(licenseStatusEl, "SENDING READY...");
      try {
        await retryAfterMissingEntry(() => markReady(saved.playerId), saved.playerId);
        showPlayingState();
      } catch (error) {
        readyPlayButton.disabled = false;
        readyPlayButton.textContent = "I'M READY";
        setStatus(readyStatusEl, error.message, true);
      }
    });

    async function cancelCurrentSession() {
      if (readyDialog.open) readyDialog.close();
      if (deviceWaitDialog.open) deviceWaitDialog.close();
      const saved = getSavedPlayer();
      if (saved && saved.playerId) {
        try {
          await retryAfterMissingEntry(() => markCancel(saved.playerId), saved.playerId);
          showCanceledState();
          return;
        } catch (error) {
          setStatus(licenseStatusEl, error.message || "CANCEL FAILED.", true);
          return;
        }
      }
      showCanceledState();
    }

    readyCancel.addEventListener("click", () => void cancelCurrentSession());

    deviceWaitCancel.addEventListener("click", () => void cancelCurrentSession());
    deviceWaitDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      void cancelCurrentSession();
    });

    resultExit.addEventListener("click", () => void closeResultDialog());

    scannerCancel.addEventListener("click", () => {
      stopQrScanner();
      setStatus(licenseStatusEl, "SCAN CANCELLED.");
    });
    scannerDialog.addEventListener("cancel", () => {
      stopQrScanner();
      setStatus(licenseStatusEl, "SCAN CANCELLED.");
    });

    optionToggle.addEventListener("click", () => {
      const nextExpanded = optionPanel.classList.contains("hidden");
      optionPanel.classList.toggle("hidden", !nextExpanded);
      optionToggle.setAttribute("aria-expanded", String(nextExpanded));
    });

    window.addEventListener("pagehide", stopQrScanner);
    window.addEventListener("resize", fitLicenseName);

    dialogCancel.addEventListener("click", () => nameDialog.close());

    changeNameForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saved = getSavedPlayer();
      if (!updateNameWarning(dialogNameInput, dialogNameWarningEl) || !isHalfWidthNameInput(dialogNameInput.value)) {
        setStatus(licenseStatusEl, "USE HALF-WIDTH A-Z, 0-9, SPACE, ., _ OR -.", true);
        dialogNameInput.focus();
        return;
      }
      const playerName = normalizeName(dialogNameInput.value);
      dialogNameInput.value = playerName;
      const playerId = saved && saved.playerId ? saved.playerId : randomId();
      setStatus(licenseStatusEl, "UPDATING LICENSE...");
      try {
        const registered = await register(playerName, playerId);
        const registeredPlayer = playerFromRegistrationPayload(registered, { playerId, playerName, playerNumber: saved ? saved.playerNumber : undefined });
        savePlayer(registeredPlayer);
        nameDialog.close();
        showLicense(registeredPlayer, false);
        setStatus(licenseStatusEl, "LICENSE UPDATED.");
      } catch (error) {
        setStatus(licenseStatusEl, error.message, true);
      }
    });

    deleteLicenseButton.addEventListener("click", async () => {
      const ok = confirm("DELETE THIS PLAYER LICENSE FROM THIS PHONE?");
      if (!ok) return;
      setStatus(licenseStatusEl, "DELETING LICENSE...");
      deletePlayer();
      location.replace(currentJoinUrl("/join"));
    });

    routeInitialView();
  </script>
</body>
</html>
"""


entries_lock = asyncio.Lock()
ranking_lock = asyncio.Lock()
session_rooms: dict[str, set[web.WebSocketResponse]] = {}
seen_event_ids: set[str] = set()


def event_payload(event_type: str, session_id: str, actor: str, entry: dict[str, object] | None = None, **extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "protocolVersion": 1,
        "eventId": f"server-{uuid.uuid4()}",
        "type": event_type,
        "sessionId": session_id,
        "sentAtMs": now_ms(),
        "actor": actor,
    }
    if entry is not None:
        payload["entry"] = entry
    payload.update(extra)
    return payload


async def broadcast_session(session_id: str, event_type: str, actor: str, entry: dict[str, object] | None = None, **extra: object) -> None:
    sockets = list(session_rooms.get(session_id, set()))
    if not sockets:
        return
    snapshot = event_payload("session.snapshot", session_id, "server", entry)
    specific = event_payload(event_type, session_id, actor, entry, **extra)
    for ws in sockets:
        if ws.closed:
            continue
        await ws.send_json(snapshot)
        if event_type != "session.snapshot":
            await ws.send_json(specific)


async def read_json_body(request: web.Request) -> dict[str, object] | web.Response:
    if request.content_length is None or request.content_length <= 0 or request.content_length > MAX_BODY_BYTES:
        return web.json_response({"error": "invalid body size"}, status=HTTPStatus.BAD_REQUEST)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=HTTPStatus.BAD_REQUEST)
    if not isinstance(payload, dict):
        return web.json_response({"error": "invalid payload"}, status=HTTPStatus.BAD_REQUEST)
    return payload


async def json_get(request: web.Request) -> web.Response:
    path = request.path
    if path in ("/", "/join", "/license"):
        return web.Response(text=JOIN_HTML, content_type="text/html", charset="utf-8", headers={"Cache-Control": "no-store"})
    if path == "/assets/js/jsQR.js":
        js_path = BASE_DIR / "assets" / "js" / "jsQR.js"
        if not js_path.exists():
            return web.json_response({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
        return web.FileResponse(js_path, headers={"Cache-Control": "public, max-age=86400"})
    if path == "/assets/title/logo.png":
        logo_path = BASE_DIR / "assets" / "title" / "logo.png"
        if not logo_path.exists():
            return web.json_response({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
        return web.FileResponse(logo_path, headers={"Cache-Control": "public, max-age=86400"})
    if path == "/api/session-entry":
        session_id = valid_session_id(request.query.get("sessionId"))
        if session_id is None:
            return web.json_response({"error": "invalid sessionId"}, status=HTTPStatus.BAD_REQUEST)
        async with entries_lock:
            entry = load_entries().get(session_id)
        if entry is None:
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        return web.json_response(entry)
    if path == "/api/player-suggestions":
        async with entries_lock:
            async with ranking_lock:
                payload = public_player_suggestions()
        return web.json_response(payload)
    if path == "/api/ranking-board":
        async with ranking_lock:
            board = public_ranking_board()
        return web.json_response(board)
    return web.json_response({"error": "not found"}, status=HTTPStatus.NOT_FOUND)


async def mutate_input_state(request: web.Request) -> web.Response:
    session_id = valid_session_id(request.query.get("sessionId"))
    if session_id is None:
        return web.json_response({"error": "invalid sessionId"}, status=HTTPStatus.BAD_REQUEST)
    async with entries_lock:
        entries = load_entries()
        entry = entries.get(session_id)
        if not isinstance(entry, dict):
            append_session_event("input_state_missing_entry", session_id, {"path": request.path})
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        event_type = "game.inputCheck"
        if request.path == "/api/session-input-exit":
            entry["inputCheckExitAtMs"] = now_ms()
            entry.pop("inputDeviceReadyAtMs", None)
            if request.query.get("play") in ("1", "true", "yes"):
                entry["playStartedAtMs"] = entry["inputCheckExitAtMs"]
                event_type = "game.playStarted"
            else:
                event_type = "game.inputExit"
            append_session_event("input_exit", session_id, {"play": request.query.get("play", "")})
        elif request.path == "/api/session-input-check":
            entry["inputCheckAtMs"] = now_ms()
            entry.pop("inputCheckExitAtMs", None)
            entry.pop("playStartedAtMs", None)
            if request.query.get("ready") in ("1", "true", "yes"):
                entry["inputDeviceReadyAtMs"] = now_ms()
                event_type = "game.inputDeviceReady"
                append_session_event("input_check_ready", session_id)
            else:
                entry.pop("inputDeviceReadyAtMs", None)
                append_session_event("input_check_waiting", session_id)
        else:
            entry["inputCheckAtMs"] = entry.get("inputCheckAtMs", now_ms())
            entry.pop("inputCheckExitAtMs", None)
            entry["inputDeviceReadyAtMs"] = now_ms()
            event_type = "game.inputDeviceReady"
            append_session_event("input_ready", session_id)
        entries[session_id] = entry
        save_entries(entries)
    await broadcast_session(session_id, event_type, "game", entry)
    return web.json_response(entry)


async def mutate_json_endpoint(request: web.Request) -> web.Response:
    payload = await read_json_body(request)
    if isinstance(payload, web.Response):
        return payload
    if request.path == "/api/ranking-score":
        async with ranking_lock:
            board = record_ranking_score(payload)
        if board is None:
            return web.json_response({"error": "invalid ranking score"}, status=HTTPStatus.BAD_REQUEST)
        return web.json_response(board)
    result = await apply_session_payload(request.path, payload)
    return result


async def apply_session_payload(path: str, payload: dict[str, object]) -> web.Response:
    if path == "/api/session-entry":
        session_id = valid_session_id(payload.get("sessionId"))
        player_id = valid_player_id(payload.get("playerId"))
        player_name = valid_player_name(payload.get("playerName"))
        if session_id is None or player_id is None or player_name is None:
            return web.json_response({"error": "invalid sessionId, playerId, or playerName"}, status=HTTPStatus.BAD_REQUEST)
        async with entries_lock:
            previous = load_entries().get(session_id)
            if isinstance(previous, dict) and previous.get("playerId") != player_id:
                append_session_event(
                    "entry_player_conflict",
                    session_id,
                    {"playerId": player_id, "entryPlayerId": str(previous.get("playerId"))},
                )
                return web.json_response(
                    {"error": "session already registered", "sessionId": session_id},
                    status=HTTPStatus.CONFLICT,
                )
            registry_player = upsert_player_registry(player_id, player_name)
            player_number = registry_player.get("playerNumber") if registry_player is not None else None
            entry: dict[str, object] = {"sessionId": session_id, "playerId": player_id, "playerName": player_name, "registeredAtMs": now_ms(), "playerNumber": player_number}
            if isinstance(previous, dict):
                for key in ("inputCheckAtMs", "inputCheckExitAtMs", "playStartedAtMs", "resultAtMs", "resultExitAtMs", "resultDamageYen", "resultDamageYenText", "resultRank"):
                    value = previous.get(key)
                    if isinstance(value, (int, float, str)):
                        entry[key] = value
            entries = load_entries()
            entries[session_id] = entry
            save_entries(entries)
            append_session_event("entry_register", session_id, {"playerId": player_id, "hadPrevious": isinstance(previous, dict)})
        await broadcast_session(session_id, "session.registered", "phone", entry, playerId=player_id, playerName=player_name)
        return web.json_response(entry)

    session_id = valid_session_id(payload.get("sessionId"))
    player_id = valid_player_id(payload.get("playerId"))
    if session_id is None or player_id is None:
        return web.json_response({"error": "invalid sessionId or playerId"}, status=HTTPStatus.BAD_REQUEST)
    async with entries_lock:
        entries = load_entries()
        entry = entries.get(session_id)
        if not isinstance(entry, dict):
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        if entry.get("playerId") != player_id:
            return web.json_response({"error": "playerId mismatch"}, status=HTTPStatus.FORBIDDEN)
        event_type = "session.snapshot"
        if path == "/api/session-ready":
            entry["readyAtMs"] = now_ms()
            entry.pop("playStartedAtMs", None)
            append_session_event("ready", session_id, {"playerId": player_id})
            event_type = "phone.ready"
        elif path == "/api/session-cancel":
            play_started_at = entry.get("playStartedAtMs")
            ready_at = entry.get("readyAtMs")
            result_at = entry.get("resultAtMs")
            if isinstance(play_started_at, (int, float)) and isinstance(ready_at, (int, float)) and play_started_at >= ready_at and not isinstance(result_at, (int, float)):
                return web.json_response({"error": "game is already playing", "sessionId": session_id}, status=HTTPStatus.CONFLICT)
            entry["cancelAtMs"] = now_ms()
            entry.pop("readyAtMs", None)
            entry.pop("inputDeviceReadyAtMs", None)
            append_session_event("cancel", session_id, {"playerId": player_id})
            event_type = "phone.cancel"
        elif path == "/api/session-result":
            damage_yen = finite_number(payload.get("damageYen"))
            damage_yen_text = payload.get("damageYenText")
            rank = payload.get("rank")
            if (
                damage_yen is None
                or damage_yen < 0
                or damage_yen > 9_007_199_254_740_991
                or not damage_yen.is_integer()
                or not isinstance(rank, str)
                or not 1 <= len(rank) <= 16
                or (
                    damage_yen_text is not None
                    and (
                        not isinstance(damage_yen_text, str)
                        or len(damage_yen_text) > 32
                        or re.fullmatch(r"[0-9,]+", damage_yen_text) is None
                    )
                )
            ):
                return web.json_response(
                    {"error": "invalid game result"},
                    status=HTTPStatus.BAD_REQUEST,
                )
            safe_damage_yen = int(damage_yen)
            entry["resultAtMs"] = now_ms()
            entry["resultDamageYen"] = safe_damage_yen
            entry["resultDamageYenText"] = valid_damage_yen_text(
                damage_yen_text,
                safe_damage_yen,
            )
            entry.pop("resultExitAtMs", None)
            entry["resultRank"] = rank
            append_session_event(
                "result",
                session_id,
                {"playerId": player_id},
            )
            event_type = "game.result"
        elif path == "/api/session-result-exit":
            if not isinstance(entry.get("resultAtMs"), (int, float)):
                return web.json_response({"error": "result is not available yet", "sessionId": session_id}, status=HTTPStatus.CONFLICT)
            entry["resultExitAtMs"] = now_ms()
            append_session_event(
                "result_exit",
                session_id,
                {"playerId": player_id},
            )
            event_type = "phone.resultExit"
        else:
            return web.json_response({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
        entries[session_id] = entry
        save_entries(entries)
    await broadcast_session(session_id, event_type, "phone" if event_type.startswith("phone.") else "game", entry)
    return web.json_response(entry)


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    client = request.query.get("client")
    session_id = valid_session_id(request.query.get("sessionId"))
    if client not in ("game", "phone") or session_id is None:
        raise web.HTTPBadRequest(text="invalid websocket query")
    ws = web.WebSocketResponse(
        heartbeat=20,
        max_msg_size=MAX_WS_MESSAGE_BYTES,
    )
    await ws.prepare(request)
    session_rooms.setdefault(session_id, set()).add(ws)
    await ws.send_json(event_payload("server.hello", session_id, "server", None, client=client))
    async with entries_lock:
        entry = load_entries().get(session_id)
    if isinstance(entry, dict):
        await ws.send_json(event_payload("session.snapshot", session_id, "server", entry))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                event = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_json(event_payload("server.error", session_id, "server", None, message="invalid json"))
                continue
            if not isinstance(event, dict) or event.get("protocolVersion") != 1 or event.get("sessionId") != session_id:
                await ws.send_json(event_payload("server.error", session_id, "server", None, message="invalid event"))
                continue
            event_id_value = event.get("eventId")
            event_id = (
                event_id_value
                if isinstance(event_id_value, str)
                and EVENT_ID_RE.fullmatch(event_id_value)
                else ""
            )
            if event_id_value is not None and not event_id:
                await ws.send_json(
                    event_payload(
                        "server.error",
                        session_id,
                        "server",
                        None,
                        message="invalid eventId",
                    )
                )
                continue
            if event_id and event_id in seen_event_ids:
                continue
            if event_id:
                seen_event_ids.add(event_id)
                if len(seen_event_ids) > 2000:
                    seen_event_ids.clear()
            event_type = event.get("type")
            if event_type == "client.ping":
                await ws.send_json(event_payload("server.hello", session_id, "server", None))
                continue
            response = await apply_ws_event(str(event_type), session_id, event)
            if response is not None:
                await ws.send_json(response)
    finally:
        session_rooms.get(session_id, set()).discard(ws)
    return ws


async def apply_ws_event(event_type: str, session_id: str, event: dict[str, object]) -> dict[str, object] | None:
    if event_type == "phone.register":
        response = await apply_session_payload("/api/session-entry", {**event, "sessionId": session_id})
    elif event_type == "phone.ready":
        response = await apply_session_payload("/api/session-ready", {**event, "sessionId": session_id})
    elif event_type == "phone.cancel":
        response = await apply_session_payload("/api/session-cancel", {**event, "sessionId": session_id})
    elif event_type == "phone.resultExit":
        response = await apply_session_payload("/api/session-result-exit", {**event, "sessionId": session_id})
    elif event_type == "game.result":
        response = await apply_session_payload("/api/session-result", {**event, "sessionId": session_id})
    elif event_type in ("game.inputCheck", "game.inputDeviceReady", "game.playStarted", "game.inputExit"):
        async with entries_lock:
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                return event_payload("server.error", session_id, "server", None, message="entry not found")
            if event_type == "game.inputDeviceReady":
                entry["inputCheckAtMs"] = now_ms()
                entry["inputDeviceReadyAtMs"] = now_ms()
                entry.pop("inputCheckExitAtMs", None)
                entry.pop("playStartedAtMs", None)
            elif event_type == "game.playStarted":
                entry["inputCheckExitAtMs"] = now_ms()
                entry["playStartedAtMs"] = entry["inputCheckExitAtMs"]
                entry.pop("inputDeviceReadyAtMs", None)
            elif event_type == "game.inputExit":
                entry["inputCheckExitAtMs"] = now_ms()
                entry.pop("inputDeviceReadyAtMs", None)
            else:
                entry["inputCheckAtMs"] = now_ms()
                entry.pop("inputCheckExitAtMs", None)
                entry.pop("playStartedAtMs", None)
                entry.pop("inputDeviceReadyAtMs", None)
            entries[session_id] = entry
            save_entries(entries)
            append_session_event(
                "ws_input_state",
                session_id,
                {"eventType": event_type},
            )
        await broadcast_session(session_id, event_type, "game", entry)
        return None
    else:
        return event_payload("server.error", session_id, "server", None, message="unknown event type")
    if response.status >= 400:
        return event_payload("server.error", session_id, "server", None, message=response.text)
    return None


async def not_found(_request: web.Request) -> web.Response:
    return web.json_response(
        {"error": "not found"},
        status=HTTPStatus.NOT_FOUND,
    )


def create_app() -> web.Application:
    app = web.Application(client_max_size=MAX_BODY_BYTES)
    app.router.add_get("/", json_get)
    app.router.add_get("/join", json_get)
    app.router.add_get("/license", json_get)
    app.router.add_get("/assets/js/jsQR.js", json_get)
    app.router.add_get("/assets/title/logo.png", json_get)
    app.router.add_get("/api/session-entry", json_get)
    app.router.add_get("/api/player-suggestions", json_get)
    app.router.add_get("/api/ranking-board", json_get)
    app.router.add_post("/api/session-input-check", mutate_input_state)
    app.router.add_post("/api/session-input-ready", mutate_input_state)
    app.router.add_post("/api/session-input-exit", mutate_input_state)
    for path in (
        "/api/session-entry",
        "/api/session-ready",
        "/api/session-cancel",
        "/api/session-result",
        "/api/session-result-exit",
        "/api/ranking-score",
    ):
        app.router.add_post(path, mutate_json_endpoint)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_route("*", "/{tail:.*}", not_found)
    return app


def main() -> None:
    initialize_runtime_data()
    print(f"Hakkei score server listening on http://{HOST}:{PORT} (aiohttp + websocket)", flush=True)
    web.run_app(create_app(), host=HOST, port=PORT, access_log=None)


if __name__ == "__main__":
    main()
