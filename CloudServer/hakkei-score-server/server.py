#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import stat
import time
import uuid
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from aiohttp import WSMsgType, web

HOST = "127.0.0.1"
PORT = 45200
BASE_DIR = Path(__file__).resolve().parent


def positive_int_from_env(name: str, default: int) -> int:
    try:
        return max(60, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def bounded_int_from_env(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        return min(maximum, max(minimum, int(os.environ.get(name, str(default)))))
    except ValueError:
        return default


PUBLIC_DEMO_SENTINEL = BASE_DIR / ".public-demo-mode"
HAKKEI_MODE = os.environ.get("HAKKEI_MODE", "").strip().lower()
if HAKKEI_MODE not in ("", "persistent", "public-demo"):
    raise RuntimeError(
        "HAKKEI_MODE must be empty, 'persistent', or 'public-demo'; "
        f"got {HAKKEI_MODE!r}"
    )
if HAKKEI_MODE == "persistent" and PUBLIC_DEMO_SENTINEL.is_file():
    raise RuntimeError(
        "HAKKEI_MODE=persistent conflicts with the .public-demo-mode sentinel"
    )
# The public source snapshot fails safe: an omitted mode starts the
# non-persistent demo. Persistent storage must be selected explicitly.
PUBLIC_DEMO_MODE = HAKKEI_MODE != "persistent"
PUBLIC_DEMO_RUNTIME_DIR = (BASE_DIR / "public-demo-runtime").resolve()
DEFAULT_DATA_DIR = PUBLIC_DEMO_RUNTIME_DIR if PUBLIC_DEMO_MODE else BASE_DIR / "data"
DATA_DIR = Path(os.environ.get("HAKKEI_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser().resolve()
DATA_FILE = DATA_DIR / "session-entries.json"
SESSION_EVENT_LOG_FILE = DATA_DIR / "session-events.log"
RANKING_FILE = DATA_DIR / "ranking-board.json"
PLAYERS_FILE = DATA_DIR / "players.json"
ADMIN_TOKEN_FILE = Path(
    os.environ.get("HAKKEI_ADMIN_TOKEN_FILE", str(DATA_DIR / ".admin-token"))
).expanduser().resolve()
PUBLIC_DEMO_RANKING_FILE = Path(
    os.environ.get(
        "HAKKEI_PUBLIC_SEED_FILE",
        str(BASE_DIR / "public-demo-ranking.json"),
    )
).expanduser().resolve()
MAX_BODY_BYTES = 4096
MAX_NAME_LENGTH = 16
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PLAYER_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
GAME_TOKEN_RE = re.compile(r"^[A-Fa-f0-9]{64}$")
PLAYER_NUMBER_MIN = 26001
PLAYER_NUMBER_MAX = 26999
PUBLIC_DEMO_MAX_TTL_SECONDS = 4 * 60 * 60
PUBLIC_DEMO_DEFAULT_TTL_SECONDS = 15 * 60
PUBLIC_DEMO_UNREGISTERED_CREDENTIAL_TTL_SECONDS = 5 * 60
SESSION_TTL_SECONDS = positive_int_from_env(
    "HAKKEI_SESSION_TTL_SECONDS",
    (
        PUBLIC_DEMO_DEFAULT_TTL_SECONDS
        if PUBLIC_DEMO_MODE
        else PUBLIC_DEMO_MAX_TTL_SECONDS
    ),
)
if PUBLIC_DEMO_MODE:
    SESSION_TTL_SECONDS = min(SESSION_TTL_SECONDS, PUBLIC_DEMO_MAX_TTL_SECONDS)
PUBLIC_DEMO_MAX_ACTIVE_SESSIONS = bounded_int_from_env(
    "HAKKEI_PUBLIC_MAX_ACTIVE_SESSIONS",
    128,
    1,
    1000,
)
PUBLIC_DEMO_RATE_WINDOW_SECONDS = 60
PUBLIC_DEMO_OPEN_RATE_LIMIT = 12
PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT = 6
PUBLIC_DEMO_MUTATION_RATE_LIMIT = 240
PUBLIC_DEMO_WS_HANDSHAKE_RATE_LIMIT = 60
PUBLIC_DEMO_WS_MESSAGE_RATE_LIMIT = 240
PUBLIC_DEMO_RATE_KEY_MAX_COUNT = 2048
PUBLIC_DEMO_WS_MAX_CONNECTIONS = 256
PUBLIC_DEMO_WS_MAX_CONNECTIONS_PER_SESSION = 2
GAME_TOKEN_HEADER = "X-Hakkei-Game-Token"
JOIN_TOKEN_HEADER = "X-Hakkei-Join-Token"
PHONE_CONTROL_TOKEN_HEADER = "X-Hakkei-Phone-Control-Token"
PHONE_CONTROL_WS_PREFIX = "hakkei-phone-control."


def load_admin_token() -> str:
    environment_token = os.environ.get("HAKKEI_ADMIN_TOKEN", "").strip()
    if environment_token:
        return environment_token
    try:
        return ADMIN_TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


ADMIN_TOKEN = load_admin_token()
game_session_credentials: dict[str, tuple[str, int]] = {}
# The raw join token is retained only in process memory so an idempotent
# /api/session-open retry can return the same QR credential.
join_session_credentials: dict[str, tuple[str, int, str]] = {}
registered_public_demo_sessions: set[str] = set()
public_demo_rate_windows: dict[tuple[str, str], deque[int]] = {}
public_demo_global_open_timestamps: deque[int] = deque()
active_public_demo_ws_count = 0
active_public_demo_ws_by_session: dict[str, int] = {}


def now_ms() -> int:
    return int(time.time() * 1000)


def valid_game_token(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value.lower() if GAME_TOKEN_RE.fullmatch(value) else None


def game_token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def forget_session_credentials(session_id: str) -> None:
    game_session_credentials.pop(session_id, None)
    join_session_credentials.pop(session_id, None)
    registered_public_demo_sessions.discard(session_id)


def session_credential_ttl_seconds(session_id: str) -> int:
    if (
        PUBLIC_DEMO_MODE
        and session_id not in registered_public_demo_sessions
    ):
        return min(
            SESSION_TTL_SECONDS,
            PUBLIC_DEMO_UNREGISTERED_CREDENTIAL_TTL_SECONDS,
        )
    return SESSION_TTL_SECONDS


def session_credential_expired(
    session_id: str,
    claimed_at_ms: int,
    at_ms: int | None = None,
) -> bool:
    current = at_ms if at_ms is not None else now_ms()
    return claimed_at_ms <= (
        current - session_credential_ttl_seconds(session_id) * 1000
    )


def purge_session_credentials(at_ms: int | None = None) -> set[str]:
    expired = [
        session_id
        for session_id, (_, claimed_at_ms) in game_session_credentials.items()
        if session_credential_expired(
            session_id,
            claimed_at_ms,
            at_ms,
        )
    ]
    for session_id in expired:
        forget_session_credentials(session_id)
    return set(expired)


def claim_game_session(session_id: str, game_token: str) -> bool:
    purge_session_credentials()
    digest = game_token_digest(game_token)
    existing = game_session_credentials.get(session_id)
    if existing is not None and not hmac.compare_digest(existing[0], digest):
        return False
    if existing is not None:
        # Authentication must expire from the original claim. Reconnects and
        # retries must not keep an old QR session alive indefinitely.
        return True
    claimed_at_ms = now_ms()
    game_session_credentials[session_id] = (digest, claimed_at_ms)
    if PUBLIC_DEMO_MODE:
        join_token = secrets.token_hex(32)
        join_session_credentials[session_id] = (
            game_token_digest(join_token),
            claimed_at_ms,
            join_token,
        )
    return True


def game_session_authorized(session_id: str, game_token_value: object) -> bool:
    game_token = valid_game_token(game_token_value)
    existing = game_session_credentials.get(session_id)
    if game_token is None or existing is None:
        return False
    if session_credential_expired(session_id, existing[1]):
        return False
    return hmac.compare_digest(existing[0], game_token_digest(game_token))


def game_session_is_open(session_id: str) -> bool:
    existing = game_session_credentials.get(session_id)
    return (
        existing is not None
        and not session_credential_expired(session_id, existing[1])
    )


def join_token_for_session(session_id: str) -> str | None:
    existing = join_session_credentials.get(session_id)
    if (
        existing is None
        or session_credential_expired(session_id, existing[1])
    ):
        return None
    return existing[2]


def join_session_authorized(session_id: str, join_token_value: object) -> bool:
    if not PUBLIC_DEMO_MODE:
        return True
    join_token = valid_game_token(join_token_value)
    existing = join_session_credentials.get(session_id)
    if join_token is None or existing is None:
        return False
    if session_credential_expired(session_id, existing[1]):
        return False
    return hmac.compare_digest(existing[0], game_token_digest(join_token))


def session_read_authorized(
    session_id: str,
    join_token_value: object,
    game_token_value: object,
) -> bool:
    if not PUBLIC_DEMO_MODE:
        return True
    return (
        join_session_authorized(session_id, join_token_value)
        or game_session_authorized(session_id, game_token_value)
    )


def websocket_token_protocol(
    supplied_protocols: str,
    prefix: str,
) -> tuple[str | None, str | None]:
    for candidate in supplied_protocols.split(","):
        protocol = candidate.strip()
        if not protocol.startswith(prefix):
            continue
        token = valid_game_token(protocol[len(prefix):])
        if token is not None:
            return protocol, token
    return None, None


def new_session_release_token() -> str:
    return secrets.token_hex(32)


def session_release_authorized(entry: dict[str, object], token_value: object) -> bool:
    token = valid_game_token(token_value)
    expected_digest = entry.get("sessionReleaseTokenHash")
    if token is None or not isinstance(expected_digest, str):
        return False
    return hmac.compare_digest(expected_digest, game_token_digest(token))


def phone_control_authorized(
    entry: dict[str, object],
    token_value: object,
) -> bool:
    token = valid_game_token(token_value)
    expected_digest = entry.get("phoneControlTokenHash")
    # A previously issued release token can be migrated without giving the QR
    # join capability control over an already registered phone.
    if not isinstance(expected_digest, str):
        expected_digest = entry.get("sessionReleaseTokenHash")
    if token is None or not isinstance(expected_digest, str):
        return False
    return hmac.compare_digest(expected_digest, game_token_digest(token))


def admin_token_status(authorization: str | None) -> HTTPStatus | None:
    if not ADMIN_TOKEN:
        return HTTPStatus.SERVICE_UNAVAILABLE
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        return HTTPStatus.FORBIDDEN
    supplied = authorization[len(prefix):]
    return None if hmac.compare_digest(supplied, ADMIN_TOKEN) else HTTPStatus.FORBIDDEN


def normalized_ip(value: str | None) -> str | None:
    if not value or "," in value:
        return None
    try:
        return ipaddress.ip_address(value.strip().split("%", 1)[0]).compressed
    except ValueError:
        return None


def rate_limit_source_ip(value: str | None) -> str | None:
    normalized = normalized_ip(value)
    if normalized is None:
        return None
    address = ipaddress.ip_address(normalized)
    if address.version == 4:
        return address.compressed
    network = ipaddress.ip_network(f"{address.compressed}/64", strict=False)
    return f"{network.network_address.compressed}/64"


def public_demo_request_source(request: web.Request) -> str:
    remote = normalized_ip(request.remote) or "unknown"
    try:
        peer_is_loopback = ipaddress.ip_address(remote).is_loopback
    except ValueError:
        peer_is_loopback = False
    if peer_is_loopback:
        cloudflare_source = normalized_ip(
            request.headers.get("CF-Connecting-IP")
        )
        if cloudflare_source is not None:
            return rate_limit_source_ip(cloudflare_source) or "unknown"
    return rate_limit_source_ip(remote) or "unknown"


def consume_rate_window(
    timestamps: deque[int],
    limit: int,
    at_ms: int | None = None,
) -> int | None:
    current = at_ms if at_ms is not None else now_ms()
    window_ms = PUBLIC_DEMO_RATE_WINDOW_SECONDS * 1000
    cutoff = current - window_ms
    while timestamps and timestamps[0] <= cutoff:
        timestamps.popleft()
    if len(timestamps) >= limit:
        retry_ms = max(1, timestamps[0] + window_ms - current)
        return max(1, (retry_ms + 999) // 1000)
    timestamps.append(current)
    return None


def consume_public_demo_rate_limit(
    bucket: str,
    source: str,
    limit: int,
    at_ms: int | None = None,
) -> int | None:
    current = at_ms if at_ms is not None else now_ms()
    key = (bucket, source)
    timestamps = public_demo_rate_windows.get(key)
    if timestamps is None:
        cutoff = current - PUBLIC_DEMO_RATE_WINDOW_SECONDS * 1000
        stale_keys = [
            existing_key
            for existing_key, existing_timestamps in public_demo_rate_windows.items()
            if not existing_timestamps or existing_timestamps[-1] <= cutoff
        ]
        for stale_key in stale_keys:
            public_demo_rate_windows.pop(stale_key, None)
        if len(public_demo_rate_windows) >= PUBLIC_DEMO_RATE_KEY_MAX_COUNT:
            return PUBLIC_DEMO_RATE_WINDOW_SECONDS
        timestamps = deque()
        public_demo_rate_windows[key] = timestamps
    return consume_rate_window(timestamps, limit, current)


def ensure_runtime_directory_permissions() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not PUBLIC_DEMO_MODE or os.name != "posix":
        return
    DATA_DIR.chmod(0o700)
    actual_mode = stat.S_IMODE(DATA_DIR.stat().st_mode)
    if actual_mode != 0o700:
        raise RuntimeError(
            f"public-demo runtime directory must be mode 0700: {DATA_DIR} "
            f"(actual {actual_mode:04o})"
        )


def ensure_runtime_file_permissions(path: Path) -> None:
    if not PUBLIC_DEMO_MODE or not path.exists() or os.name != "posix":
        return
    path.chmod(0o600)
    actual_mode = stat.S_IMODE(path.stat().st_mode)
    if actual_mode != 0o600:
        raise RuntimeError(
            f"public-demo runtime file must be mode 0600: {path} "
            f"(actual {actual_mode:04o})"
        )


def write_runtime_json(path: Path, value: object) -> None:
    ensure_runtime_directory_permissions()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    ensure_runtime_file_permissions(tmp)
    tmp.replace(path)
    ensure_runtime_file_permissions(path)


def load_entries(at_ms: int | None = None) -> dict[str, dict[str, object]]:
    if not DATA_FILE.exists():
        return {}
    ensure_runtime_file_permissions(DATA_FILE)
    try:
        value = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(value, dict):
        return {}
    entries = {
        str(session_id): entry
        for session_id, entry in value.items()
        if isinstance(entry, dict)
    }
    if not PUBLIC_DEMO_MODE:
        return entries

    cutoff = (at_ms if at_ms is not None else now_ms()) - SESSION_TTL_SECONDS * 1000
    active_entries: dict[str, dict[str, object]] = {}
    for session_id, entry in entries.items():
        registered_at = entry.get("registeredAtMs")
        if isinstance(registered_at, (int, float)) and int(registered_at) >= cutoff:
            active_entries[session_id] = entry
    if len(active_entries) != len(entries):
        save_entries(active_entries)
    return active_entries


def save_entries(entries: dict[str, dict[str, object]]) -> None:
    if (
        PUBLIC_DEMO_MODE
        and len(entries) > PUBLIC_DEMO_MAX_ACTIVE_SESSIONS
    ):
        raise RuntimeError(
            "public-demo session entry limit exceeded: "
            f"{len(entries)} > {PUBLIC_DEMO_MAX_ACTIVE_SESSIONS}"
        )
    write_runtime_json(DATA_FILE, entries)


def append_session_event(action: str, session_id: str | None, detail: dict[str, object] | None = None) -> None:
    if PUBLIC_DEMO_MODE:
        return
    try:
        ensure_runtime_directory_permissions()
        event: dict[str, object] = {"atMs": now_ms(), "action": action}
        if session_id is not None:
            event["sessionId"] = session_id
        if detail:
            event.update(detail)
        ensure_runtime_file_permissions(SESSION_EVENT_LOG_FILE)
        with SESSION_EVENT_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
        ensure_runtime_file_permissions(SESSION_EVENT_LOG_FILE)
    except OSError:
        pass


def empty_ranking_board() -> dict[str, object]:
    return {"schemaVersion": 1, "players": [], "records": []}


def empty_player_registry() -> dict[str, object]:
    return {"schemaVersion": 1, "players": []}


def load_public_demo_ranking() -> dict[str, object]:
    """Load the fixed synthetic leaderboard used by the public portfolio demo."""
    try:
        value = json.loads(PUBLIC_DEMO_RANKING_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"cannot load public-demo synthetic ranking seed: {PUBLIC_DEMO_RANKING_FILE}"
        ) from error
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or value.get("dataMode") != "synthetic-demo"
        or not isinstance(value.get("players"), list)
    ):
        raise RuntimeError(
            "public-demo ranking seed must have schemaVersion=1, "
            "dataMode='synthetic-demo', and a players array"
        )
    raw_players = value["players"]
    players: list[dict[str, object]] = []
    seen_numbers: set[int] = set()
    for index, raw in enumerate(raw_players):
        if not isinstance(raw, dict):
            raise RuntimeError(f"invalid public-demo ranking player at index {index}")
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        last_played = finite_number(raw.get("lastPlayedAtMs"))
        high_score = finite_number(raw.get("highScore"))
        play_count = finite_number(raw.get("playCount"))
        if (
            nickname is None
            or not re.fullmatch(r"(?:PLAYER|DEMO)_[0-9]{3}", nickname)
            or player_number is None
            or player_number in seen_numbers
            or registered_at is None
            or registered_at < 0
            or (
                raw.get("lastPlayedAtMs") is not None
                and (last_played is None or last_played < 0)
            )
            or high_score is None
            or high_score < 0
            or play_count is None
            or play_count < 0
        ):
            raise RuntimeError(f"invalid public-demo ranking player at index {index}")
        seen_numbers.add(player_number)
        players.append({
            "nickname": nickname,
            "playerNumber": player_number,
            "registeredAtMs": int(registered_at),
            "lastPlayedAtMs": int(last_played) if last_played is not None else None,
            "highScore": max(0, int(round(high_score))),
            "playCount": max(0, int(round(play_count))),
        })
    players.sort(
        key=lambda player: (
            -int(player["highScore"]),
            int(player["registeredAtMs"]),
            str(player["nickname"]),
            int(player["playerNumber"]),
        )
    )
    return {
        "schemaVersion": 1,
        "dataMode": "synthetic-demo",
        "players": players,
    }


def path_is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_runtime_configuration() -> None:
    if not PUBLIC_DEMO_MODE:
        return
    if not 60 <= SESSION_TTL_SECONDS <= PUBLIC_DEMO_MAX_TTL_SECONDS:
        raise RuntimeError(
            "public-demo session TTL must be between 60 and 14400 seconds"
        )
    default_public_runtime = PUBLIC_DEMO_RUNTIME_DIR
    # Startup resets this directory and enforces mode 0700 on it. Restricting
    # the target to one resolved path prevents a typo from chmod'ing or
    # deleting files in a parent, backup, evidence, or otherwise unrelated
    # directory. Persistent mode may still use HAKKEI_DATA_DIR explicitly.
    if DATA_DIR != default_public_runtime:
        raise RuntimeError(
            "public-demo data directory must be the dedicated runtime path: "
            f"{default_public_runtime} (got {DATA_DIR})"
        )
    if path_is_within(PUBLIC_DEMO_RANKING_FILE, DATA_DIR):
        raise RuntimeError(
            "public-demo ranking seed must be outside the ephemeral runtime directory"
        )
    load_public_demo_ranking()


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
    if not isinstance(value, (int, float)):
        return None
    n = int(value)
    return n if PLAYER_NUMBER_MIN <= n <= PLAYER_NUMBER_MAX else None


def next_public_runtime_player_number(
    entries: dict[str, dict[str, object]],
    previous: dict[str, object] | None = None,
) -> int | None:
    if isinstance(previous, dict):
        previous_number = valid_player_number(previous.get("playerNumber"))
        if previous_number is not None:
            return previous_number
    used = {
        number
        for entry in entries.values()
        if isinstance(entry, dict)
        and (number := valid_player_number(entry.get("playerNumber"))) is not None
    }
    for number in range(PLAYER_NUMBER_MIN, 26800):
        if number not in used:
            return number
    return None


def public_demo_player_number(player_id_value: object) -> int:
    player_id = valid_player_id(player_id_value) or "anonymous"
    digest = hashlib.sha256(player_id.encode("utf-8")).digest()
    return PLAYER_NUMBER_MIN + int.from_bytes(digest[:4], "big") % 799


def public_demo_alias(player_number: int) -> str:
    return f"DEMO_{player_number - PLAYER_NUMBER_MIN + 1:03d}"


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


def player_registry_payload() -> dict[str, object]:
    if PUBLIC_DEMO_MODE:
        return {
            "generatedAtMs": now_ms(),
            "dataMode": "synthetic-demo",
            "players": [],
        }
    registry = sync_player_registry_from_existing_data()
    return {"generatedAtMs": now_ms(), "players": registry.get("players", [])}


def public_player_suggestions() -> dict[str, object]:
    """Return registered-player suggestions without persistent internal IDs."""
    if PUBLIC_DEMO_MODE:
        board = load_public_demo_ranking()
        players = [
            {
                "nickname": player["nickname"],
                "playerNumber": player["playerNumber"],
                "registeredAtMs": player["registeredAtMs"],
                "lastPlayedAtMs": player["lastPlayedAtMs"],
            }
            for player in board["players"]
            if isinstance(player, dict)
        ]
        return {
            "generatedAtMs": now_ms(),
            "dataMode": "synthetic-demo",
            "players": players,
        }
    registry = sync_player_registry_from_existing_data()
    board = load_ranking_board()
    ranking_by_id = {
        registry_player_id(player.get("playerId")): player
        for player in board.get("players", [])
        if isinstance(player, dict) and registry_player_id(player.get("playerId")) is not None
    }
    players: list[dict[str, object]] = []
    for raw in registry.get("players", []):
        if not isinstance(raw, dict):
            continue
        player_id = registry_player_id(raw.get("playerId"))
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        if player_id is None or nickname is None or player_number is None or registered_at is None:
            continue
        ranking_player = ranking_by_id.get(player_id)
        last_played = (
            finite_number(ranking_player.get("lastPlayedAtMs"))
            if isinstance(ranking_player, dict)
            else None
        )
        players.append({
            "nickname": nickname,
            "playerNumber": player_number,
            "registeredAtMs": int(registered_at),
            "lastPlayedAtMs": int(last_played) if last_played is not None else None,
        })
    players.sort(
        key=lambda player: (
            int(player["registeredAtMs"]),
            str(player["nickname"]),
            int(player["playerNumber"]),
        )
    )
    return {"generatedAtMs": now_ms(), "players": players}


def player_number_for(player_id_value: object) -> int | None:
    player_id = registry_player_id(player_id_value)
    if player_id is None:
        return None
    if PUBLIC_DEMO_MODE:
        for entry in load_entries().values():
            if not isinstance(entry, dict):
                continue
            if registry_player_id(entry.get("playerId")) == player_id:
                return valid_player_number(entry.get("playerNumber"))
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


def public_ranking_board() -> dict[str, object]:
    """Return only the fields needed to render the shared leaderboard."""
    if PUBLIC_DEMO_MODE:
        return load_public_demo_ranking()
    board = ranking_board_with_player_numbers()
    players: list[dict[str, object]] = []
    for raw in board.get("players", []):
        if not isinstance(raw, dict):
            continue
        nickname = valid_player_name(raw.get("nickname"))
        player_number = valid_player_number(raw.get("playerNumber"))
        high_score = finite_number(raw.get("highScore"))
        play_count = finite_number(raw.get("playCount"))
        registered_at = finite_number(raw.get("registeredAtMs"))
        last_played = finite_number(raw.get("lastPlayedAtMs"))
        if (
            nickname is None
            or player_number is None
            or high_score is None
            or play_count is None
            or registered_at is None
        ):
            continue
        players.append({
            "nickname": nickname,
            "playerNumber": player_number,
            "registeredAtMs": int(registered_at),
            "lastPlayedAtMs": int(last_played) if last_played is not None else None,
            "highScore": max(0, int(round(high_score))),
            "playCount": max(0, int(round(play_count))),
        })
    players.sort(
        key=lambda player: (
            -int(player["highScore"]),
            int(player["registeredAtMs"]),
            str(player["nickname"]),
            int(player["playerNumber"]),
        )
    )
    return {"schemaVersion": 1, "players": players}


def list_entries_payload() -> dict[str, object]:
    entries = [entry for entry in load_entries().values() if isinstance(entry, dict)]
    def registered_at(entry: dict[str, object]) -> int:
        value = entry.get("registeredAtMs", 0)
        return int(value) if isinstance(value, (int, float)) else 0

    entries.sort(key=registered_at, reverse=True)
    return {"generatedAtMs": now_ms(), "entries": entries}


def session_entry_payload(entry: dict[str, object]) -> dict[str, object]:
    """Remove fields used only for server-side score verification."""
    private_fields = {
        "resultScore",
        "resultVideoLevel",
        "resultPlayedAtMs",
        "rankingRecordedResultAtMs",
        "sessionReleaseTokenHash",
        "phoneControlTokenHash",
    }
    return {key: value for key, value in entry.items() if key not in private_fields}


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
    return normalized if PLAYER_ID_RE.fullmatch(normalized) else None


def finite_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and value == value and value not in (float("inf"), float("-inf")):
        return float(value)
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
    if player_id is None or nickname is None or registered_at is None:
        return None
    return {
        "playerId": player_id,
        "nickname": nickname,
        "registeredAtMs": int(registered_at),
        "lastPlayedAtMs": None,
        "highScore": 0,
        "playCount": 0,
    }


def build_ranking_record(value: object, player: dict[str, object], previous_high_score: int, record_index: int) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    score = finite_number(value.get("score"))
    damage_yen = finite_number(value.get("damageYen"))
    video_level = finite_number(value.get("videoLevel"))
    played_at = finite_number(value.get("playedAtMs"))
    rank = value.get("rank")
    if score is None or damage_yen is None or video_level is None or played_at is None or not isinstance(rank, str):
        return None
    score_i = max(0, int(round(score)))
    played_at_i = int(played_at)
    is_high_score = score_i > previous_high_score
    return {
        "recordId": f"{player['playerId']}-{played_at_i}-{record_index + 1}",
        "playerId": player["playerId"],
        "nickname": player["nickname"],
        "score": score_i,
        "damageYen": max(0, int(round(damage_yen))),
        "rank": rank,
        "videoLevel": max(0, min(5, int(round(video_level)))),
        "playedAtMs": played_at_i,
        "isHighScore": is_high_score,
    }


def ranking_payload_for_session(
    payload: object,
    entry: dict[str, object],
) -> dict[str, object] | None:
    """Bind an authenticated game's ranking submission to its registered player."""
    if not isinstance(payload, dict):
        return None
    player_value = payload.get("player")
    record_value = payload.get("record")
    if not isinstance(player_value, dict) or not isinstance(record_value, dict):
        return None

    entry_player_id = registry_player_id(entry.get("playerId"))
    submitted_player_id = registry_player_id(player_value.get("playerId"))
    entry_nickname = valid_player_name(entry.get("playerName"))
    submitted_nickname = valid_player_name(player_value.get("nickname"))
    entry_registered_at = finite_number(entry.get("registeredAtMs"))
    if (
        entry_player_id is None
        or submitted_player_id != entry_player_id
        or entry_nickname is None
        or submitted_nickname != entry_nickname
        or entry_registered_at is None
    ):
        return None

    player = {
        "playerId": entry_player_id,
        "nickname": entry_nickname,
        "registeredAtMs": int(entry_registered_at),
    }
    if build_ranking_record(record_value, player, 0, 0) is None:
        return None
    return {"player": player, "record": record_value}


def ranking_payload_for_direct_entry(payload: object) -> dict[str, object] | None:
    """Validate a score entered on the exhibition PC without phone registration."""
    if not isinstance(payload, dict):
        return None
    player = build_ranking_player(payload.get("player"))
    record_value = payload.get("record")
    if player is None or not isinstance(record_value, dict):
        return None

    submitted_number = valid_player_number(
        payload.get("player", {}).get("playerNumber")
        if isinstance(payload.get("player"), dict)
        else None
    )
    if PUBLIC_DEMO_MODE:
        normalized_id = registry_player_id(player["playerId"])
        if normalized_id is None:
            return None
        player["playerId"] = normalized_id
        if submitted_number is not None:
            player["playerNumber"] = submitted_number
        probe = build_ranking_record(record_value, player, 0, 0)
        if probe is None:
            return None
        return {"player": player, "record": record_value}
    if submitted_number is not None:
        registered = next(
            (
                candidate
                for candidate in sync_player_registry_from_existing_data().get("players", [])
                if isinstance(candidate, dict)
                and valid_player_number(candidate.get("playerNumber")) == submitted_number
            ),
            None,
        )
        if (
            not isinstance(registered, dict)
            or valid_player_name(registered.get("nickname")) != player["nickname"]
        ):
            return None
        player["playerId"] = registered["playerId"]
        player["registeredAtMs"] = int(
            finite_number(registered.get("registeredAtMs"))
            or player["registeredAtMs"]
        )
        player["playerNumber"] = submitted_number
    elif str(player["playerId"]).startswith("public-"):
        return None
    else:
        normalized_id = registry_player_id(player["playerId"])
        if normalized_id is None:
            return None
        player["playerId"] = normalized_id

    probe = build_ranking_record(record_value, player, 0, 0)
    if probe is None:
        return None
    return {"player": player, "record": record_value}


def record_ranking_score(
    payload: object,
    entry: dict[str, object] | None = None,
) -> dict[str, object] | None:
    validated_payload = (
        ranking_payload_for_session(payload, entry)
        if entry is not None
        else ranking_payload_for_direct_entry(payload)
    )
    if validated_payload is None:
        return None
    player = build_ranking_player(validated_payload.get("player"))
    if player is None:
        return None
    record_value = validated_payload.get("record")
    if PUBLIC_DEMO_MODE:
        submitted_player = validated_payload.get("player")
        player_number = (
            valid_player_number(entry.get("playerNumber"))
            if isinstance(entry, dict)
            else valid_player_number(
                submitted_player.get("playerNumber")
                if isinstance(submitted_player, dict)
                else None
            )
        )
        if player_number is None:
            player_number = public_demo_player_number(player.get("playerId"))
        record = build_ranking_record(record_value, player, 0, 0)
        if record is None:
            return None
        response = load_public_demo_ranking()
        synthetic_time = 1783814400000 + player_number
        submitted_row = {
            "nickname": public_demo_alias(player_number),
            "playerNumber": player_number,
            "registeredAtMs": synthetic_time,
            "lastPlayedAtMs": synthetic_time,
            "highScore": int(record["score"]),
            "playCount": 1,
        }
        public_players = [
            candidate
            for candidate in response.get("players", [])
            if isinstance(candidate, dict)
            and valid_player_number(candidate.get("playerNumber")) != player_number
        ]
        public_players.append(submitted_row)
        public_players.sort(
            key=lambda candidate: (
                -int(candidate["highScore"]),
                int(candidate["registeredAtMs"]),
                str(candidate["nickname"]),
                int(candidate["playerNumber"]),
            )
        )
        response["players"] = public_players
        response["submittedPlayerNumber"] = player_number
        response["submissionScope"] = "response-only"
        return response
    registry_player = upsert_player_registry(
        player.get("playerId"),
        player.get("nickname"),
        registered_at_ms=player.get("registeredAtMs"),
        last_seen_at_ms=record_value.get("playedAtMs") if isinstance(record_value, dict) else None,
    )
    if registry_player is not None:
        player["playerNumber"] = registry_player.get("playerNumber")
    board = load_ranking_board()
    players = [p for p in board.get("players", []) if isinstance(p, dict)]
    records = [r for r in board.get("records", []) if isinstance(r, dict)]
    existing_index = next((i for i, p in enumerate(players) if p.get("playerId") == player["playerId"]), -1)
    existing = players[existing_index] if existing_index >= 0 else None
    previous_high_score = int(existing.get("highScore", 0)) if isinstance(existing, dict) else 0
    record = build_ranking_record(record_value, player, previous_high_score, len(records))
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
            and finite_number(existing_record.get("videoLevel")) == record["videoLevel"]
            and existing_record.get("rank") == record["rank"]
        ),
        None,
    )
    if duplicate is not None:
        response = public_ranking_board()
        submitted_number = valid_player_number(player.get("playerNumber"))
        if submitted_number is not None:
            response["submittedPlayerNumber"] = submitted_number
        return response
    updated_player = {
        **player,
        "registeredAtMs": int(existing.get("registeredAtMs", player["registeredAtMs"]))
        if isinstance(existing, dict)
        else player["registeredAtMs"],
        "lastPlayedAtMs": record["playedAtMs"],
        "playerNumber": player.get("playerNumber", existing.get("playerNumber") if isinstance(existing, dict) else None),
        "highScore": max(previous_high_score, int(record["score"])),
        "playCount": (int(existing.get("playCount", 0)) if isinstance(existing, dict) else 0) + 1,
    }
    if existing_index >= 0:
        players[existing_index] = updated_player
    else:
        players.append(updated_player)
    next_board = {"schemaVersion": 1, "players": players, "records": [*records, record]}
    save_ranking_board(next_board)
    response = public_ranking_board()
    submitted_number = valid_player_number(updated_player.get("playerNumber"))
    if submitted_number is not None:
        response["submittedPlayerNumber"] = submitted_number
    return response


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
      text-align: left;
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
        <label><input id="player-name" name="playerName" maxlength="16" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" lang="en" inputmode="latin" pattern="[A-Z0-9._-]{1,16}" placeholder="PLAYER1" required></label>
        <p class="hint">1-16 CHARACTERS: A-Z, 0-9, ., _ OR -</p>
        <p class="privacy-note">__HAKKEI_PRIVACY_NOTE__</p>
        <p class="input-warning hidden" id="name-warning" role="alert">USE HALF-WIDTH A-Z, 0-9, ., _ OR -.</p>
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
      <label><input id="dialog-player-name" maxlength="16" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" lang="en" inputmode="latin" pattern="[A-Z0-9._-]{1,16}" required></label>
      <p class="hint">1-16 CHARACTERS: A-Z, 0-9, ., _ OR -</p>
      <p class="input-warning hidden" id="dialog-name-warning" role="alert">USE HALF-WIDTH A-Z, 0-9, ., _ OR -.</p>
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
    const publicDemoMode = __HAKKEI_PUBLIC_DEMO_MODE__;
    const playerStorage = publicDemoMode ? sessionStorage : localStorage;
    if (publicDemoMode) {
      localStorage.removeItem(storageKey);
    }
    const allowedNamePattern = /^[A-Z0-9._-]{1,16}$/;
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("sessionId") || "";
    const joinTokenKey = "hakkei-session-join-token:" + sessionId;
    const fragmentJoinToken = new URLSearchParams(location.hash.slice(1)).get("joinToken") || "";
    let joinToken = sessionId ? sessionStorage.getItem(joinTokenKey) || "" : "";
    if (sessionId && /^[A-Fa-f0-9]{64}$/.test(fragmentJoinToken)) {
      joinToken = fragmentJoinToken.toLowerCase();
      sessionStorage.setItem(joinTokenKey, joinToken);
    }
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    function newPhoneControlToken() {
      if (!window.crypto || typeof window.crypto.getRandomValues !== "function") return "";
      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }
    const sessionReleaseTokenKey = "hakkei-session-release-token:" + sessionId;
    const phoneControlTokenKey = "hakkei-session-phone-control-token:" + sessionId;
    let phoneControlToken = sessionId
      ? sessionStorage.getItem(phoneControlTokenKey) || sessionStorage.getItem(sessionReleaseTokenKey) || ""
      : "";
    if (publicDemoMode && sessionId && !/^[a-f0-9]{64}$/.test(phoneControlToken)) {
      phoneControlToken = newPhoneControlToken();
    }
    if (publicDemoMode && sessionId && phoneControlToken) {
      sessionStorage.setItem(phoneControlTokenKey, phoneControlToken);
    }
    let sessionReleaseToken = publicDemoMode
      ? phoneControlToken
      : (sessionId ? sessionStorage.getItem(sessionReleaseTokenKey) || "" : "");
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
      return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 16);
    }

    function isHalfWidthNameInput(value) {
      return /^[A-Za-z0-9._-]{1,16}$/.test(value);
    }

    function updateNameWarning(input, warningEl) {
      const hasWarning = input.value.length > 0 && !isHalfWidthNameInput(input.value);
      warningEl.classList.toggle("hidden", !hasWarning);
      return !hasWarning;
    }

    function getSavedPlayer() {
      try { return JSON.parse(playerStorage.getItem(storageKey) || "null"); }
      catch { return null; }
    }

    function savePlayer(player) {
      playerStorage.setItem(storageKey, JSON.stringify(player));
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
      playerStorage.removeItem(storageKey);
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

    function phoneHeaders(includeJson = false, includeControl = false) {
      const headers = {};
      if (includeJson) headers["Content-Type"] = "application/json";
      if (joinToken) headers["X-Hakkei-Join-Token"] = joinToken;
      if (includeControl && phoneControlToken) {
        headers["X-Hakkei-Phone-Control-Token"] = phoneControlToken;
      }
      return headers;
    }

    function currentJoinUrl(pathname) {
      const next = new URL(location.href);
      next.pathname = pathname;
      return next.pathname + next.search;
    }

    function sessionFromQrValue(value) {
      try {
        const url = new URL(value, location.href);
        const nextSessionId = url.searchParams.get("sessionId") || "";
        const nextJoinToken = new URLSearchParams(url.hash.slice(1)).get("joinToken") || "";
        if (!nextSessionId || !/^[A-Za-z0-9_-]{1,80}$/.test(nextSessionId)) return null;
        if (nextSessionId === sessionId) return null;
        if (url.origin !== location.origin) return null;
        if (url.pathname !== "/join" && url.pathname !== "/license") return null;
        if (nextJoinToken && !/^[A-Fa-f0-9]{64}$/.test(nextJoinToken)) return null;
        return { sessionId: nextSessionId, joinToken: nextJoinToken.toLowerCase() };
      } catch {
        return null;
      }
    }

    function openScannedSession(nextSession) {
      if (nextSession.joinToken) {
        sessionStorage.setItem(
          "hakkei-session-join-token:" + nextSession.sessionId,
          nextSession.joinToken
        );
      }
      location.href = "/license?sessionId=" + encodeURIComponent(nextSession.sessionId);
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
                const nextSession = sessionFromQrValue(code.rawValue || "");
                if (nextSession) {
                  stopQrScanner();
                  openScannedSession(nextSession);
                  return;
                }
              }
            } else if (scannerCanvasContext && scannerVideo.videoWidth > 0 && scannerVideo.videoHeight > 0) {
              scannerCanvas.width = scannerVideo.videoWidth;
              scannerCanvas.height = scannerVideo.videoHeight;
              scannerCanvasContext.drawImage(scannerVideo, 0, 0, scannerCanvas.width, scannerCanvas.height);
              const imageData = scannerCanvasContext.getImageData(0, 0, scannerCanvas.width, scannerCanvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
              const nextSession = sessionFromQrValue(code && code.data ? code.data : "");
              if (nextSession) {
                stopQrScanner();
                openScannedSession(nextSession);
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
      if (!allowedNamePattern.test(playerName)) throw new Error("USE A-Z, 0-9, ., _ OR -.");
      if (!sessionId) {
        return { sessionId: "", playerId, playerName, registeredAtMs: Date.now(), localOnly: true };
      }
      if (publicDemoMode && !/^[a-f0-9]{64}$/.test(phoneControlToken)) {
        throw new Error("SECURE PHONE TOKEN IS UNAVAILABLE. RELOAD AND SCAN THE QR AGAIN.");
      }
      const response = await fetch("/api/session-entry", {
        method: "POST",
        headers: phoneHeaders(true, true),
        body: JSON.stringify({ sessionId, playerId, playerName })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "REGISTRATION FAILED.");
      if (typeof payload.sessionReleaseToken === "string" && /^[a-f0-9]{64}$/.test(payload.sessionReleaseToken)) {
        sessionReleaseToken = payload.sessionReleaseToken;
        sessionStorage.setItem(sessionReleaseTokenKey, sessionReleaseToken);
      }
      return payload;
    }

    async function markReady(playerId) {
      if (!sessionId) return { localOnly: true };
      if (sendSessionWs("phone.ready", { playerId })) return { ws: true };
      const response = await fetch("/api/session-ready", {
        method: "POST",
        headers: phoneHeaders(true, true),
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
        headers: phoneHeaders(true, true),
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
        headers: phoneHeaders(true, true),
        body: JSON.stringify({ sessionId, playerId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "EXIT FAILED.");
      return payload;
    }

    async function fetchCurrentEntry() {
      if (!sessionId) return null;
      const response = await fetch("/api/session-entry?sessionId=" + encodeURIComponent(sessionId), {
        cache: "no-store",
        headers: phoneHeaders()
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

    function connectSessionSocket() {
      if (!sessionId || !("WebSocket" in window)) return;
      if (publicDemoMode && !/^[a-f0-9]{64}$/.test(phoneControlToken)) return;
      if (sessionSocket && (sessionSocket.readyState === WebSocket.OPEN || sessionSocket.readyState === WebSocket.CONNECTING)) return;
      const wsUrl = new URL("/ws", location.href);
      wsUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("client", "phone");
      wsUrl.searchParams.set("sessionId", sessionId);
      sessionSocketState = "connecting";
      sessionSocket = publicDemoMode
        ? new WebSocket(wsUrl.toString(), ["hakkei-phone-control." + phoneControlToken])
        : new WebSocket(wsUrl.toString());
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
          if (
            saved &&
            saved.playerId &&
            sessionId &&
            (!publicDemoMode || /^[a-f0-9]{64}$/.test(phoneControlToken))
          ) connectSessionSocket();
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
        connectSessionSocket();
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
        setStatus(statusEl, "USE HALF-WIDTH A-Z, 0-9, ., _ OR -.", true);
        nameInput.focus();
        return;
      }
      const playerName = normalizeName(nameInput.value);
      nameInput.value = playerName;
      const saved = getSavedPlayer();
      const playerId = saved && saved.playerId ? saved.playerId : randomId();
      if (publicDemoMode) {
        const pendingPlayer = { playerId, playerName };
        if (saved && typeof saved.playerNumber === "number") {
          pendingPlayer.playerNumber = saved.playerNumber;
        }
        // Persist the registration identity before the request so a response
        // lost after the server commit can be retried with the same playerId
        // and phone control token.
        savePlayer(pendingPlayer);
      }
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
        setStatus(licenseStatusEl, "USE HALF-WIDTH A-Z, 0-9, ., _ OR -.", true);
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

    async function releaseCurrentSessionEntry(playerId) {
      if (!sessionId || !playerId || !sessionReleaseToken) return;
      await fetch("/api/session-release", {
        method: "POST",
        headers: phoneHeaders(true, true),
        body: JSON.stringify(
          publicDemoMode
            ? { sessionId, playerId }
            : { sessionId, playerId, sessionReleaseToken }
        )
      }).catch(() => {});
    }

    deleteLicenseButton.addEventListener("click", async () => {
      const ok = confirm("DELETE THIS PLAYER LICENSE FROM THIS PHONE?");
      if (!ok) return;
      setStatus(licenseStatusEl, "DELETING LICENSE...");
      const saved = getSavedPlayer();
      await releaseCurrentSessionEntry(saved && saved.playerId ? saved.playerId : "");
      sessionStorage.removeItem(sessionReleaseTokenKey);
      sessionStorage.removeItem(phoneControlTokenKey);
      sessionReleaseToken = "";
      phoneControlToken = "";
      deletePlayer();
      location.replace(currentJoinUrl("/join"));
    });

    routeInitialView();
  </script>
</body>
</html>
"""


def rendered_join_html() -> str:
    if PUBLIC_DEMO_MODE:
        retention_minutes = max(1, (SESSION_TTL_SECONDS + 59) // 60)
        privacy_note = (
            "入力したニックネームは現在のデモセッションでのみ使用され、公開ランキングには表示されません。"
            "公開ランキングは合成データを使用し、"
            f"セッションデータは最大{retention_minutes}分で削除されます。"
            "<br>YOUR NAME IS USED ONLY FOR THE CURRENT DEMO SESSION. "
            "THE PUBLIC LEADERBOARD USES SYNTHETIC DATA. "
            f"SESSION DATA IS DELETED WITHIN {retention_minutes} MINUTES."
        )
    else:
        privacy_note = (
            "登録したニックネームとスコアは共有ランキングに公開され、デモ運用のためサーバーに保存されます。"
            "実名や個人情報は入力しないでください。"
            "<br>NICKNAME AND SCORE ARE SAVED AND SHOWN ON THE SHARED LEADERBOARD."
        )
    return (
        JOIN_HTML
        .replace("__HAKKEI_PRIVACY_NOTE__", privacy_note)
        .replace(
            "__HAKKEI_PUBLIC_DEMO_MODE__",
            "true" if PUBLIC_DEMO_MODE else "false",
        )
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "HakkeiScore/0.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - - [{self.log_date_time_string()}] {fmt % args}", flush=True)

    def send_text(self, status: HTTPStatus, body: str, content_type: str = "text/plain; charset=utf-8") -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def send_json(self, status: HTTPStatus, payload: object) -> None:
        self.send_text(status, json.dumps(payload, ensure_ascii=False), "application/json; charset=utf-8")

    def reject_unsupported_public_demo(self) -> bool:
        if not PUBLIC_DEMO_MODE:
            return False
        self.send_json(
            HTTPStatus.SERVICE_UNAVAILABLE,
            {"error": "public-demo mode requires the aiohttp server"},
        )
        return True

    def do_HEAD(self) -> None:
        if self.reject_unsupported_public_demo():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/assets/js/jsQR.js":
            js_path = BASE_DIR / "assets" / "js" / "jsQR.js"
            if not js_path.exists():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            data = js_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            return
        if parsed.path == "/assets/title/logo.png":
            logo_path = BASE_DIR / "assets" / "title" / "logo.png"
            if not logo_path.exists():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            data = logo_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            return
        if parsed.path == "/" or parsed.path == "/join" or parsed.path == "/license":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if parsed.path == "/api/session-entry" or parsed.path == "/api/session-open" or parsed.path == "/api/session-release" or parsed.path == "/api/session-entries" or parsed.path == "/api/players" or parsed.path == "/api/player-suggestions" or parsed.path == "/api/session-ready" or parsed.path == "/api/session-cancel" or parsed.path == "/api/session-input-check" or parsed.path == "/api/session-input-ready" or parsed.path == "/api/session-input-exit" or parsed.path == "/api/session-result" or parsed.path == "/api/session-result-exit" or parsed.path == "/api/admin-reset" or parsed.path == "/api/ranking-board" or parsed.path == "/api/ranking-score":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

    def do_GET(self) -> None:
        if self.reject_unsupported_public_demo():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/assets/js/jsQR.js":
            js_path = BASE_DIR / "assets" / "js" / "jsQR.js"
            if not js_path.exists():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            data = js_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/assets/title/logo.png":
            logo_path = BASE_DIR / "assets" / "title" / "logo.png"
            if not logo_path.exists():
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            data = logo_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/" or parsed.path == "/join" or parsed.path == "/license":
            self.send_text(HTTPStatus.OK, rendered_join_html(), "text/html; charset=utf-8")
            return
        if parsed.path == "/api/session-entry":
            params = parse_qs(parsed.query)
            session_id = valid_session_id(params.get("sessionId", [None])[0])
            if session_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId"})
                return
            if not session_read_authorized(
                session_id,
                self.headers.get(JOIN_TOKEN_HEADER),
                self.headers.get(GAME_TOKEN_HEADER),
            ):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "session authorization required"})
                return
            entry = load_entries().get(session_id)
            if entry is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return
        if parsed.path == "/api/session-entries":
            token_error = admin_token_status(self.headers.get("Authorization"))
            if token_error is not None:
                self.send_json(token_error, {"error": "admin authorization required"})
                return
            self.send_json(HTTPStatus.OK, list_entries_payload())
            return
        if parsed.path == "/api/players":
            token_error = admin_token_status(self.headers.get("Authorization"))
            if token_error is not None:
                self.send_json(token_error, {"error": "admin authorization required"})
                return
            self.send_json(HTTPStatus.OK, player_registry_payload())
            return
        if parsed.path == "/api/player-suggestions":
            self.send_json(HTTPStatus.OK, public_player_suggestions())
            return
        if parsed.path == "/api/ranking-board":
            self.send_json(HTTPStatus.OK, public_ranking_board())
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_DELETE(self) -> None:
        if self.reject_unsupported_public_demo():
            return
        parsed = urlparse(self.path)
        if parsed.path != "/api/session-entry":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        token_error = admin_token_status(self.headers.get("Authorization"))
        if token_error is not None:
            self.send_json(token_error, {"error": "admin authorization required"})
            return
        params = parse_qs(parsed.query)
        session_id = valid_session_id(params.get("sessionId", [None])[0])
        if session_id is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId"})
            return
        entries = load_entries()
        removed = entries.pop(session_id, None)
        save_entries(entries)
        forget_session_credentials(session_id)
        self.send_json(HTTPStatus.OK, {"sessionId": session_id, "deleted": removed is not None})

    def do_POST(self) -> None:
        if self.reject_unsupported_public_demo():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/session-input-check" or parsed.path == "/api/session-input-ready" or parsed.path == "/api/session-input-exit":
            params = parse_qs(parsed.query)
            session_id = valid_session_id(params.get("sessionId", [None])[0])
            if session_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId"})
                return
            if PUBLIC_DEMO_MODE and not game_session_authorized(
                session_id,
                self.headers.get(GAME_TOKEN_HEADER),
            ):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "game authorization failed"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                append_session_event("input_state_missing_entry", session_id, {"path": parsed.path})
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if parsed.path == "/api/session-input-exit":
                entry["inputCheckExitAtMs"] = now_ms()
                entry.pop("inputDeviceReadyAtMs", None)
                if params.get("play", [""])[0] in ("1", "true", "yes"):
                    entry["playStartedAtMs"] = entry["inputCheckExitAtMs"]
                append_session_event("input_exit", session_id, {"play": params.get("play", [""])[0]})
            elif parsed.path == "/api/session-input-check":
                entry["inputCheckAtMs"] = now_ms()
                entry.pop("inputCheckExitAtMs", None)
                entry.pop("playStartedAtMs", None)
                if params.get("ready", [""])[0] in ("1", "true", "yes"):
                    entry["inputDeviceReadyAtMs"] = now_ms()
                    append_session_event("input_check_ready", session_id)
                else:
                    entry.pop("inputDeviceReadyAtMs", None)
                    append_session_event("input_check_waiting", session_id)
            else:
                entry["inputCheckAtMs"] = entry.get("inputCheckAtMs", now_ms())
                entry.pop("inputCheckExitAtMs", None)
                entry["inputDeviceReadyAtMs"] = now_ms()
                append_session_event("input_ready", session_id)
            entries[session_id] = entry
            save_entries(entries)
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return

        if parsed.path not in ("/api/session-entry", "/api/session-open", "/api/session-release", "/api/session-ready", "/api/session-cancel", "/api/session-result", "/api/session-result-exit", "/api/admin-reset", "/api/ranking-score"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid content length"})
            return
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid body size"})
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
            return
        if not isinstance(payload, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid payload"})
            return
        if parsed.path in (
            "/api/session-entry",
            "/api/session-ready",
            "/api/session-cancel",
            "/api/session-result-exit",
        ):
            phone_session_id = valid_session_id(payload.get("sessionId"))
            if (
                PUBLIC_DEMO_MODE
                and phone_session_id is not None
                and not join_session_authorized(
                    phone_session_id,
                    self.headers.get(JOIN_TOKEN_HEADER),
                )
            ):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "phone authorization failed"})
                return
        if parsed.path == "/api/session-open":
            session_id = valid_session_id(payload.get("sessionId"))
            game_token = valid_game_token(payload.get("gameToken"))
            if session_id is None or game_token is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or gameToken"})
                return
            if not claim_game_session(session_id, game_token):
                self.send_json(HTTPStatus.CONFLICT, {"error": "session is already owned by another game"})
                return
            response: dict[str, object] = {"sessionId": session_id, "opened": True}
            join_token = join_token_for_session(session_id)
            if join_token is not None:
                response["joinToken"] = join_token
                response["dataMode"] = "synthetic-demo"
            self.send_json(HTTPStatus.OK, response)
            return
        if parsed.path == "/api/session-release":
            session_id = valid_session_id(payload.get("sessionId"))
            player_id = valid_player_id(payload.get("playerId"))
            entries = load_entries()
            entry = entries.get(session_id or "")
            if session_id is None or player_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or playerId"})
                return
            if not isinstance(entry, dict):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if entry.get("playerId") != player_id or not session_release_authorized(entry, payload.get("sessionReleaseToken")):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "session release authorization failed"})
                return
            entries.pop(session_id, None)
            save_entries(entries)
            append_session_event("entry_release", session_id, {"playerId": player_id})
            self.send_json(HTTPStatus.OK, {"sessionId": session_id, "released": True})
            return
        if parsed.path == "/api/admin-reset":
            token_error = admin_token_status(self.headers.get("Authorization"))
            if token_error is not None:
                self.send_json(token_error, {"error": "admin reset is unavailable"})
                return
            if payload.get("confirm") != "DELETE_ALL_HAKKEI_DATA":
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid confirmation"})
                return
            save_entries({})
            save_player_registry(empty_player_registry())
            save_ranking_board(empty_ranking_board())
            game_session_credentials.clear()
            join_session_credentials.clear()
            self.send_json(HTTPStatus.OK, {"ok": True, "entriesDeleted": True, "playersDeleted": True, "rankingDeleted": True})
            return
        if parsed.path == "/api/ranking-score":
            session_id = valid_session_id(payload.get("sessionId"))
            if session_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId"})
                return
            if not game_session_authorized(session_id, payload.get("gameToken")):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "game authorization failed"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if isinstance(entry, dict):
                board = record_ranking_score(payload, entry)
                if board is None:
                    self.send_json(HTTPStatus.CONFLICT, {"error": "ranking score does not match the registered player"})
                    return
                submitted_number = valid_player_number(entry.get("playerNumber"))
                if submitted_number is not None:
                    board["submittedPlayerNumber"] = submitted_number
            else:
                board = record_ranking_score(payload)
                if board is None:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid ranking score"})
                    return
            self.send_json(HTTPStatus.OK, board)
            return
        if parsed.path == "/api/session-ready":
            session_id = valid_session_id(payload.get("sessionId"))
            player_id = valid_player_id(payload.get("playerId"))
            if session_id is None or player_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or playerId"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                append_session_event("ready_missing_entry", session_id, {"playerId": player_id})
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if entry.get("playerId") != player_id:
                append_session_event("ready_player_mismatch", session_id, {"playerId": player_id, "entryPlayerId": str(entry.get("playerId"))})
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "playerId mismatch"})
                return
            entry["readyAtMs"] = now_ms()
            entry.pop("playStartedAtMs", None)
            entries[session_id] = entry
            save_entries(entries)
            append_session_event("ready", session_id, {"playerId": player_id})
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return

        if parsed.path == "/api/session-cancel":
            session_id = valid_session_id(payload.get("sessionId"))
            player_id = valid_player_id(payload.get("playerId"))
            if session_id is None or player_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or playerId"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                append_session_event("cancel_missing_entry", session_id, {"playerId": player_id})
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if entry.get("playerId") != player_id:
                append_session_event("cancel_player_mismatch", session_id, {"playerId": player_id, "entryPlayerId": str(entry.get("playerId"))})
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "playerId mismatch"})
                return
            play_started_at = entry.get("playStartedAtMs")
            ready_at = entry.get("readyAtMs")
            result_at = entry.get("resultAtMs")
            if (
                isinstance(play_started_at, (int, float))
                and isinstance(ready_at, (int, float))
                and play_started_at >= ready_at
                and not isinstance(result_at, (int, float))
            ):
                self.send_json(HTTPStatus.CONFLICT, {"error": "game is already playing", "sessionId": session_id})
                return
            entry["cancelAtMs"] = now_ms()
            entry.pop("readyAtMs", None)
            entry.pop("inputDeviceReadyAtMs", None)
            entries[session_id] = entry
            save_entries(entries)
            append_session_event("cancel", session_id, {"playerId": player_id})
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return

        if parsed.path == "/api/session-result":
            session_id = valid_session_id(payload.get("sessionId"))
            player_id = valid_player_id(payload.get("playerId"))
            score = finite_number(payload.get("score"))
            damage_yen = finite_number(payload.get("damageYen"))
            video_level = finite_number(payload.get("videoLevel"))
            played_at = finite_number(payload.get("playedAtMs"))
            rank = payload.get("rank")
            if session_id is None or player_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or playerId"})
                return
            if not game_session_authorized(session_id, payload.get("gameToken")):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "game authorization failed"})
                return
            if (
                score is None
                or score < 0
                or damage_yen is None
                or damage_yen < 0
                or video_level is None
                or int(round(video_level)) not in range(0, 6)
                or played_at is None
                or played_at < 0
                or not isinstance(rank, str)
                or not 1 <= len(rank) <= 16
            ):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid game result"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if entry.get("playerId") != player_id:
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "playerId mismatch"})
                return
            safe_score = int(round(score))
            safe_damage_yen = int(round(damage_yen))
            safe_video_level = int(round(video_level))
            safe_played_at = int(round(played_at))
            same_result = (
                finite_number(entry.get("resultAtMs")) is not None
                and finite_number(entry.get("resultScore")) == safe_score
                and finite_number(entry.get("resultDamageYen")) == safe_damage_yen
                and finite_number(entry.get("resultVideoLevel")) == safe_video_level
                and finite_number(entry.get("resultPlayedAtMs")) == safe_played_at
                and entry.get("resultRank") == rank
            )
            if not same_result:
                entry["resultAtMs"] = now_ms()
                entry.pop("rankingRecordedResultAtMs", None)
            entry["resultScore"] = safe_score
            entry["resultDamageYen"] = safe_damage_yen
            entry["resultDamageYenText"] = valid_damage_yen_text(payload.get("damageYenText"), safe_damage_yen)
            entry["resultVideoLevel"] = safe_video_level
            entry["resultPlayedAtMs"] = safe_played_at
            entry["resultRank"] = rank
            entry.pop("resultExitAtMs", None)
            entries[session_id] = entry
            save_entries(entries)
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return

        if parsed.path == "/api/session-result-exit":
            session_id = valid_session_id(payload.get("sessionId"))
            player_id = valid_player_id(payload.get("playerId"))
            if session_id is None or player_id is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId or playerId"})
                return
            entries = load_entries()
            entry = entries.get(session_id)
            if not isinstance(entry, dict):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "entry not found", "sessionId": session_id})
                return
            if entry.get("playerId") != player_id:
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "playerId mismatch"})
                return
            if not isinstance(entry.get("resultAtMs"), (int, float)):
                self.send_json(HTTPStatus.CONFLICT, {"error": "result is not available yet", "sessionId": session_id})
                return
            entry["resultExitAtMs"] = now_ms()
            entries[session_id] = entry
            save_entries(entries)
            self.send_json(HTTPStatus.OK, session_entry_payload(entry))
            return

        session_id = valid_session_id(payload.get("sessionId"))
        player_id = valid_player_id(payload.get("playerId"))
        player_name = valid_player_name(payload.get("playerName"))
        if session_id is None or player_id is None or player_name is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid sessionId, playerId, or playerName"})
            return
        if not game_session_is_open(session_id):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "game session is not open", "sessionId": session_id})
            return
        entries = load_entries()
        previous = entries.get(session_id)
        if isinstance(previous, dict) and previous.get("playerId") != player_id:
            append_session_event(
                "entry_player_conflict",
                session_id,
                {"playerId": player_id, "entryPlayerId": str(previous.get("playerId"))},
            )
            self.send_json(HTTPStatus.CONFLICT, {"error": "session already registered", "sessionId": session_id})
            return
        if PUBLIC_DEMO_MODE:
            player_number = next_public_runtime_player_number(entries, previous)
        else:
            registry_player = upsert_player_registry(player_id, player_name)
            player_number = registry_player.get("playerNumber") if registry_player is not None else None
        input_check_at = previous.get("inputCheckAtMs") if isinstance(previous, dict) else None
        input_check_exit_at = previous.get("inputCheckExitAtMs") if isinstance(previous, dict) else None
        result_at = previous.get("resultAtMs") if isinstance(previous, dict) else None
        result_exit_at = previous.get("resultExitAtMs") if isinstance(previous, dict) else None
        play_started_at = previous.get("playStartedAtMs") if isinstance(previous, dict) else None
        result_score = previous.get("resultScore") if isinstance(previous, dict) else None
        result_damage_yen = previous.get("resultDamageYen") if isinstance(previous, dict) else None
        result_damage_yen_text = previous.get("resultDamageYenText") if isinstance(previous, dict) else None
        result_rank = previous.get("resultRank") if isinstance(previous, dict) else None
        result_video_level = previous.get("resultVideoLevel") if isinstance(previous, dict) else None
        result_played_at = previous.get("resultPlayedAtMs") if isinstance(previous, dict) else None
        ranking_recorded_at = previous.get("rankingRecordedResultAtMs") if isinstance(previous, dict) else None
        session_release_token = new_session_release_token()
        entry = {
            "sessionId": session_id,
            "playerId": player_id,
            "playerName": player_name,
            "registeredAtMs": now_ms(),
            "playerNumber": player_number,
            "sessionReleaseTokenHash": game_token_digest(session_release_token),
        }
        if isinstance(input_check_at, (int, float)):
            entry["inputCheckAtMs"] = int(input_check_at)
        if isinstance(input_check_exit_at, (int, float)):
            entry["inputCheckExitAtMs"] = int(input_check_exit_at)
        if isinstance(play_started_at, (int, float)):
            entry["playStartedAtMs"] = int(play_started_at)
        if isinstance(result_at, (int, float)):
            entry["resultAtMs"] = int(result_at)
        if isinstance(result_exit_at, (int, float)):
            entry["resultExitAtMs"] = int(result_exit_at)
        if isinstance(result_score, (int, float)):
            entry["resultScore"] = max(0, int(round(result_score)))
        if isinstance(result_damage_yen, (int, float)):
            entry["resultDamageYen"] = max(0, int(round(result_damage_yen)))
        if isinstance(result_damage_yen_text, str):
            entry["resultDamageYenText"] = valid_damage_yen_text(result_damage_yen_text, result_damage_yen)
        if isinstance(result_rank, str) and 1 <= len(result_rank) <= 16:
            entry["resultRank"] = result_rank
        if isinstance(result_video_level, (int, float)):
            entry["resultVideoLevel"] = max(0, min(5, int(round(result_video_level))))
        if isinstance(result_played_at, (int, float)):
            entry["resultPlayedAtMs"] = max(0, int(round(result_played_at)))
        if isinstance(ranking_recorded_at, (int, float)):
            entry["rankingRecordedResultAtMs"] = int(ranking_recorded_at)
        entries = load_entries()
        entries[session_id] = entry
        save_entries(entries)
        append_session_event("entry_register", session_id, {"playerId": player_id, "hadPrevious": isinstance(previous, dict)})
        self.send_json(
            HTTPStatus.OK,
            {**session_entry_payload(entry), "sessionReleaseToken": session_release_token},
        )


entries_lock = asyncio.Lock()
ranking_lock = asyncio.Lock()
session_rooms: dict[str, set[web.WebSocketResponse]] = {}
seen_event_ids: set[str] = set()


def prune_public_demo_state_locked(
    at_ms: int | None = None,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    entries = load_entries(at_ms)
    registered_public_demo_sessions.clear()
    registered_public_demo_sessions.update(entries)
    expired = purge_session_credentials(at_ms)
    for session_id in set(join_session_credentials) - set(
        game_session_credentials
    ):
        join_session_credentials.pop(session_id, None)
    orphan_entry_ids = set(entries) - set(game_session_credentials)
    removed_entry_ids = expired | orphan_entry_ids
    changed = False
    for session_id in removed_entry_ids:
        if entries.pop(session_id, None) is not None:
            changed = True
    if changed:
        save_entries(entries)
    registered_public_demo_sessions.intersection_update(entries)
    return entries, removed_entry_ids


async def close_session_sockets(
    session_ids: set[str],
    message: bytes,
) -> None:
    for session_id in session_ids:
        sockets = list(session_rooms.pop(session_id, set()))
        for ws in sockets:
            if not ws.closed:
                await ws.close(code=1008, message=message)


async def open_game_session(
    session_id: str,
    game_token: str,
) -> tuple[HTTPStatus, str | None]:
    expired: set[str] = set()
    status = HTTPStatus.OK
    join_token: str | None = None
    async with entries_lock:
        if PUBLIC_DEMO_MODE:
            _, expired = prune_public_demo_state_locked()
        existing = game_session_credentials.get(session_id)
        if (
            existing is None
            and PUBLIC_DEMO_MODE
            and len(game_session_credentials) >= PUBLIC_DEMO_MAX_ACTIVE_SESSIONS
        ):
            status = HTTPStatus.TOO_MANY_REQUESTS
        elif not claim_game_session(session_id, game_token):
            status = HTTPStatus.CONFLICT
        else:
            join_token = join_token_for_session(session_id)
    if expired:
        await close_session_sockets(expired, b"session expired")
    return status, join_token


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
        payload["entry"] = session_entry_payload(entry)
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
        return web.Response(text=rendered_join_html(), content_type="text/html", charset="utf-8", headers={"Cache-Control": "no-store"})
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
        if not session_read_authorized(
            session_id,
            request.headers.get(JOIN_TOKEN_HEADER),
            request.headers.get(GAME_TOKEN_HEADER),
        ):
            return web.json_response(
                {"error": "session authorization required"},
                status=HTTPStatus.FORBIDDEN,
            )
        async with entries_lock:
            entry = load_entries().get(session_id)
        if entry is None:
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        return web.json_response(session_entry_payload(entry))
    if path == "/api/session-entries":
        token_error = admin_token_status(request.headers.get("Authorization"))
        if token_error is not None:
            return web.json_response({"error": "admin authorization required"}, status=token_error)
        async with entries_lock:
            payload = list_entries_payload()
        return web.json_response(payload)
    if path == "/api/players":
        token_error = admin_token_status(request.headers.get("Authorization"))
        if token_error is not None:
            return web.json_response({"error": "admin authorization required"}, status=token_error)
        async with entries_lock:
            async with ranking_lock:
                payload = player_registry_payload()
        return web.json_response(payload)
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


async def delete_session_entry(request: web.Request) -> web.Response:
    token_error = admin_token_status(request.headers.get("Authorization"))
    if token_error is not None:
        return web.json_response({"error": "admin authorization required"}, status=token_error)
    session_id = valid_session_id(request.query.get("sessionId"))
    if session_id is None:
        return web.json_response({"error": "invalid sessionId"}, status=HTTPStatus.BAD_REQUEST)
    async with entries_lock:
        entries = load_entries()
        removed = entries.pop(session_id, None)
        save_entries(entries)
        forget_session_credentials(session_id)
    await broadcast_session(session_id, "session.snapshot", "server", None)
    await close_session_sockets({session_id}, b"session deleted")
    return web.json_response({"sessionId": session_id, "deleted": removed is not None})


async def release_session_entry(request: web.Request) -> web.Response:
    payload = await read_json_body(request)
    if isinstance(payload, web.Response):
        return payload
    session_id = valid_session_id(payload.get("sessionId"))
    player_id = valid_player_id(payload.get("playerId"))
    if session_id is None or player_id is None:
        return web.json_response({"error": "invalid sessionId or playerId"}, status=HTTPStatus.BAD_REQUEST)
    async with entries_lock:
        entries = load_entries()
        entry = entries.get(session_id)
        if not isinstance(entry, dict):
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        release_authorized = (
            phone_control_authorized(
                entry,
                request.headers.get(PHONE_CONTROL_TOKEN_HEADER),
            )
            if PUBLIC_DEMO_MODE
            else session_release_authorized(
                entry,
                payload.get("sessionReleaseToken"),
            )
        )
        if entry.get("playerId") != player_id or not release_authorized:
            return web.json_response(
                {"error": "session release authorization failed"},
                status=HTTPStatus.FORBIDDEN,
            )
        entries.pop(session_id, None)
        save_entries(entries)
        registered_public_demo_sessions.discard(session_id)
        append_session_event("entry_release", session_id, {"playerId": player_id})
    await broadcast_session(session_id, "session.snapshot", "server", None)
    await close_session_sockets({session_id}, b"session released")
    return web.json_response({"sessionId": session_id, "released": True})


async def mutate_input_state(request: web.Request) -> web.Response:
    session_id = valid_session_id(request.query.get("sessionId"))
    if session_id is None:
        return web.json_response({"error": "invalid sessionId"}, status=HTTPStatus.BAD_REQUEST)
    if PUBLIC_DEMO_MODE and not game_session_authorized(
        session_id,
        request.headers.get(GAME_TOKEN_HEADER),
    ):
        return web.json_response(
            {"error": "game authorization failed"},
            status=HTTPStatus.FORBIDDEN,
        )
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
    return web.json_response(session_entry_payload(entry))


async def mutate_json_endpoint(request: web.Request) -> web.Response:
    payload = await read_json_body(request)
    if isinstance(payload, web.Response):
        return payload
    if request.path == "/api/session-open":
        session_id = valid_session_id(payload.get("sessionId"))
        game_token = valid_game_token(payload.get("gameToken"))
        if session_id is None or game_token is None:
            return web.json_response({"error": "invalid sessionId or gameToken"}, status=HTTPStatus.BAD_REQUEST)
        open_status, join_token = await open_game_session(session_id, game_token)
        if open_status == HTTPStatus.TOO_MANY_REQUESTS:
            return web.json_response(
                {"error": "public-demo active session limit reached"},
                status=open_status,
                headers={"Retry-After": str(PUBLIC_DEMO_RATE_WINDOW_SECONDS)},
            )
        if open_status == HTTPStatus.CONFLICT:
            return web.json_response(
                {"error": "session is already owned by another game"},
                status=HTTPStatus.CONFLICT,
            )
        response: dict[str, object] = {"sessionId": session_id, "opened": True}
        if join_token is not None:
            response["joinToken"] = join_token
            response["dataMode"] = "synthetic-demo"
        return web.json_response(response)
    if request.path == "/api/admin-reset":
        token_error = admin_token_status(request.headers.get("Authorization"))
        if token_error is not None:
            return web.json_response({"error": "admin reset is unavailable"}, status=token_error)
        if payload.get("confirm") != "DELETE_ALL_HAKKEI_DATA":
            return web.json_response({"error": "invalid confirmation"}, status=HTTPStatus.BAD_REQUEST)
        async with entries_lock:
            save_entries({})
            game_session_credentials.clear()
            join_session_credentials.clear()
            registered_public_demo_sessions.clear()
        async with ranking_lock:
            save_player_registry(empty_player_registry())
            save_ranking_board(empty_ranking_board())
        public_demo_rate_windows.clear()
        public_demo_global_open_timestamps.clear()
        await close_session_sockets(set(session_rooms), b"server reset")
        return web.json_response({"ok": True, "entriesDeleted": True, "playersDeleted": True, "rankingDeleted": True})
    if request.path == "/api/ranking-score":
        session_id = valid_session_id(payload.get("sessionId"))
        if session_id is None:
            return web.json_response({"error": "invalid sessionId"}, status=HTTPStatus.BAD_REQUEST)
        if not game_session_authorized(session_id, payload.get("gameToken")):
            return web.json_response({"error": "game authorization failed"}, status=HTTPStatus.FORBIDDEN)
        async with entries_lock:
            entries = load_entries()
            entry = entries.get(session_id)
            if isinstance(entry, dict):
                async with ranking_lock:
                    board = record_ranking_score(payload, entry)
                if board is None:
                    return web.json_response(
                        {"error": "ranking score does not match the registered player"},
                        status=HTTPStatus.CONFLICT,
                    )
                submitted_number = valid_player_number(entry.get("playerNumber"))
                if submitted_number is not None:
                    board["submittedPlayerNumber"] = submitted_number
            else:
                async with ranking_lock:
                    board = record_ranking_score(payload)
                if board is None:
                    return web.json_response({"error": "invalid ranking score"}, status=HTTPStatus.BAD_REQUEST)
        return web.json_response(board)
    if request.path in (
        "/api/session-entry",
        "/api/session-ready",
        "/api/session-cancel",
        "/api/session-result-exit",
    ):
        phone_session_id = valid_session_id(payload.get("sessionId"))
        if (
            PUBLIC_DEMO_MODE
            and phone_session_id is not None
            and not join_session_authorized(
                phone_session_id,
                request.headers.get(JOIN_TOKEN_HEADER),
            )
        ):
            return web.json_response(
                {"error": "phone authorization failed"},
                status=HTTPStatus.FORBIDDEN,
            )
    result = await apply_session_payload(
        request.path,
        payload,
        phone_control_token=request.headers.get(PHONE_CONTROL_TOKEN_HEADER),
    )
    return result


async def apply_session_payload(
    path: str,
    payload: dict[str, object],
    *,
    phone_control_token: object = None,
) -> web.Response:
    if path == "/api/session-entry":
        session_id = valid_session_id(payload.get("sessionId"))
        player_id = valid_player_id(payload.get("playerId"))
        player_name = valid_player_name(payload.get("playerName"))
        if session_id is None or player_id is None or player_name is None:
            return web.json_response({"error": "invalid sessionId, playerId, or playerName"}, status=HTTPStatus.BAD_REQUEST)
        control_token = (
            valid_game_token(phone_control_token)
            if PUBLIC_DEMO_MODE
            else None
        )
        if PUBLIC_DEMO_MODE and control_token is None:
            return web.json_response(
                {"error": "phone control authorization required"},
                status=HTTPStatus.FORBIDDEN,
            )
        async with entries_lock:
            if not game_session_is_open(session_id):
                return web.json_response(
                    {
                        "error": "game session is not open",
                        "sessionId": session_id,
                    },
                    status=HTTPStatus.NOT_FOUND,
                )
            entries = load_entries()
            previous = entries.get(session_id)
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
            if (
                PUBLIC_DEMO_MODE
                and isinstance(previous, dict)
                and not phone_control_authorized(previous, control_token)
            ):
                return web.json_response(
                    {"error": "phone control authorization failed"},
                    status=HTTPStatus.FORBIDDEN,
                )
            if PUBLIC_DEMO_MODE:
                player_number = next_public_runtime_player_number(entries, previous)
            else:
                registry_player = upsert_player_registry(player_id, player_name)
                player_number = registry_player.get("playerNumber") if registry_player is not None else None
            session_release_token = (
                None
                if PUBLIC_DEMO_MODE
                else new_session_release_token()
            )
            entry: dict[str, object] = {
                "sessionId": session_id,
                "playerId": player_id,
                "playerName": player_name,
                "registeredAtMs": now_ms(),
                "playerNumber": player_number,
            }
            if PUBLIC_DEMO_MODE and control_token is not None:
                entry["phoneControlTokenHash"] = game_token_digest(control_token)
            elif session_release_token is not None:
                entry["sessionReleaseTokenHash"] = game_token_digest(
                    session_release_token
                )
            if isinstance(previous, dict):
                for key in (
                    "inputCheckAtMs",
                    "inputCheckExitAtMs",
                    "playStartedAtMs",
                    "resultAtMs",
                    "resultExitAtMs",
                    "resultScore",
                    "resultDamageYen",
                    "resultDamageYenText",
                    "resultRank",
                    "resultVideoLevel",
                    "resultPlayedAtMs",
                    "rankingRecordedResultAtMs",
                ):
                    value = previous.get(key)
                    if isinstance(value, (int, float, str)):
                        entry[key] = value
            entries[session_id] = entry
            save_entries(entries)
            if PUBLIC_DEMO_MODE:
                registered_public_demo_sessions.add(session_id)
            append_session_event("entry_register", session_id, {"playerId": player_id, "hadPrevious": isinstance(previous, dict)})
        await broadcast_session(session_id, "session.registered", "phone", entry, playerId=player_id, playerName=player_name)
        response_payload = session_entry_payload(entry)
        if session_release_token is not None:
            response_payload["sessionReleaseToken"] = session_release_token
        return web.json_response(response_payload)

    session_id = valid_session_id(payload.get("sessionId"))
    player_id = valid_player_id(payload.get("playerId"))
    if session_id is None or player_id is None:
        return web.json_response({"error": "invalid sessionId or playerId"}, status=HTTPStatus.BAD_REQUEST)
    async with entries_lock:
        entries = load_entries()
        entry = entries.get(session_id)
        if not isinstance(entry, dict):
            return web.json_response({"error": "entry not found", "sessionId": session_id}, status=HTTPStatus.NOT_FOUND)
        if PUBLIC_DEMO_MODE and not game_session_is_open(session_id):
            return web.json_response(
                {"error": "game session is not open", "sessionId": session_id},
                status=HTTPStatus.NOT_FOUND,
            )
        if entry.get("playerId") != player_id:
            return web.json_response({"error": "playerId mismatch"}, status=HTTPStatus.FORBIDDEN)
        if (
            PUBLIC_DEMO_MODE
            and path in (
                "/api/session-ready",
                "/api/session-cancel",
                "/api/session-result-exit",
            )
            and not phone_control_authorized(entry, phone_control_token)
        ):
            return web.json_response(
                {"error": "phone control authorization failed"},
                status=HTTPStatus.FORBIDDEN,
            )
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
            if not game_session_authorized(session_id, payload.get("gameToken")):
                return web.json_response({"error": "game authorization failed"}, status=HTTPStatus.FORBIDDEN)
            score = finite_number(payload.get("score"))
            damage_yen = finite_number(payload.get("damageYen"))
            video_level = finite_number(payload.get("videoLevel"))
            played_at = finite_number(payload.get("playedAtMs"))
            rank = payload.get("rank")
            if (
                score is None
                or score < 0
                or damage_yen is None
                or damage_yen < 0
                or video_level is None
                or int(round(video_level)) not in range(0, 6)
                or played_at is None
                or played_at < 0
                or not isinstance(rank, str)
                or not 1 <= len(rank) <= 16
            ):
                return web.json_response({"error": "invalid game result"}, status=HTTPStatus.BAD_REQUEST)
            safe_score = int(round(score))
            safe_damage_yen = int(round(damage_yen))
            safe_video_level = int(round(video_level))
            safe_played_at = int(round(played_at))
            same_result = (
                finite_number(entry.get("resultAtMs")) is not None
                and finite_number(entry.get("resultScore")) == safe_score
                and finite_number(entry.get("resultDamageYen")) == safe_damage_yen
                and finite_number(entry.get("resultVideoLevel")) == safe_video_level
                and finite_number(entry.get("resultPlayedAtMs")) == safe_played_at
                and entry.get("resultRank") == rank
            )
            if not same_result:
                entry["resultAtMs"] = now_ms()
                entry.pop("rankingRecordedResultAtMs", None)
            entry["resultScore"] = safe_score
            entry["resultDamageYen"] = safe_damage_yen
            entry["resultDamageYenText"] = valid_damage_yen_text(payload.get("damageYenText"), safe_damage_yen)
            entry["resultVideoLevel"] = safe_video_level
            entry["resultPlayedAtMs"] = safe_played_at
            entry["resultRank"] = rank
            entry.pop("resultExitAtMs", None)
            event_type = "game.result"
        elif path == "/api/session-result-exit":
            if not isinstance(entry.get("resultAtMs"), (int, float)):
                return web.json_response({"error": "result is not available yet", "sessionId": session_id}, status=HTTPStatus.CONFLICT)
            entry["resultExitAtMs"] = now_ms()
            event_type = "phone.resultExit"
        else:
            return web.json_response({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
        entries[session_id] = entry
        save_entries(entries)
    await broadcast_session(session_id, event_type, "phone" if event_type.startswith("phone.") else "game", entry)
    return web.json_response(session_entry_payload(entry))


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    global active_public_demo_ws_count
    client = request.query.get("client")
    session_id = valid_session_id(request.query.get("sessionId"))
    if client not in ("game", "phone") or session_id is None:
        raise web.HTTPBadRequest(text="invalid websocket query")
    websocket_protocol: str | None = None
    phone_control_token: str | None = None
    supplied_protocols = request.headers.get("Sec-WebSocket-Protocol", "")
    if client == "game":
        prefix = "hakkei-game."
        websocket_protocol, game_token = websocket_token_protocol(
            supplied_protocols,
            prefix,
        )
        if game_token is None or not game_session_authorized(session_id, game_token):
            raise web.HTTPForbidden(text="game authorization failed")
    elif PUBLIC_DEMO_MODE:
        websocket_protocol, phone_control_token = websocket_token_protocol(
            supplied_protocols,
            PHONE_CONTROL_WS_PREFIX,
        )
        async with entries_lock:
            control_entry = load_entries().get(session_id)
        if (
            phone_control_token is None
            or not isinstance(control_entry, dict)
            or not game_session_is_open(session_id)
            or not phone_control_authorized(
                control_entry,
                phone_control_token,
            )
        ):
            raise web.HTTPForbidden(text="phone authorization failed")
    reserved_connection = False
    if PUBLIC_DEMO_MODE:
        session_connection_count = active_public_demo_ws_by_session.get(
            session_id,
            0,
        )
        if (
            active_public_demo_ws_count >= PUBLIC_DEMO_WS_MAX_CONNECTIONS
            or session_connection_count
            >= PUBLIC_DEMO_WS_MAX_CONNECTIONS_PER_SESSION
        ):
            raise web.HTTPTooManyRequests(
                text="websocket connection limit reached",
                headers={"Retry-After": str(PUBLIC_DEMO_RATE_WINDOW_SECONDS)},
            )
        active_public_demo_ws_count += 1
        active_public_demo_ws_by_session[session_id] = (
            session_connection_count + 1
        )
        reserved_connection = True
    ws = web.WebSocketResponse(
        heartbeat=20,
        protocols=(websocket_protocol,) if websocket_protocol is not None else (),
        max_msg_size=MAX_BODY_BYTES,
    )
    try:
        await ws.prepare(request)
        session_rooms.setdefault(session_id, set()).add(ws)
        await ws.send_json(
            event_payload(
                "server.hello",
                session_id,
                "server",
                None,
                client=client,
            )
        )
        async with entries_lock:
            entry = load_entries().get(session_id)
        if isinstance(entry, dict):
            await ws.send_json(
                event_payload(
                    "session.snapshot",
                    session_id,
                    "server",
                    entry,
                )
            )
        message_timestamps: deque[int] = deque()
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            if PUBLIC_DEMO_MODE:
                retry_after = consume_rate_window(
                    message_timestamps,
                    PUBLIC_DEMO_WS_MESSAGE_RATE_LIMIT,
                )
                if retry_after is not None:
                    await ws.send_json(
                        event_payload(
                            "server.error",
                            session_id,
                            "server",
                            None,
                            message="websocket rate limit exceeded",
                        )
                    )
                    await ws.close(
                        code=1013,
                        message=b"rate limit exceeded",
                    )
                    break
            if len(msg.data.encode("utf-8")) > MAX_BODY_BYTES:
                await ws.close(code=1009, message=b"message too large")
                break
            try:
                event = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_json(event_payload("server.error", session_id, "server", None, message="invalid json"))
                continue
            if not isinstance(event, dict) or event.get("protocolVersion") != 1 or event.get("sessionId") != session_id:
                await ws.send_json(event_payload("server.error", session_id, "server", None, message="invalid event"))
                continue
            event_id = str(event.get("eventId", ""))
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
            response = await apply_ws_event(
                client,
                str(event_type),
                session_id,
                event,
                phone_control_token=phone_control_token,
            )
            if response is not None:
                await ws.send_json(response)
    finally:
        session_rooms.get(session_id, set()).discard(ws)
        if not session_rooms.get(session_id):
            session_rooms.pop(session_id, None)
        if reserved_connection:
            active_public_demo_ws_count = max(
                0,
                active_public_demo_ws_count - 1,
            )
            remaining = max(
                0,
                active_public_demo_ws_by_session.get(session_id, 1) - 1,
            )
            if remaining:
                active_public_demo_ws_by_session[session_id] = remaining
            else:
                active_public_demo_ws_by_session.pop(session_id, None)
    return ws


async def apply_ws_event(
    client: str,
    event_type: str,
    session_id: str,
    event: dict[str, object],
    *,
    phone_control_token: object = None,
) -> dict[str, object] | None:
    if event_type == "phone.ready" and client == "phone":
        response = await apply_session_payload(
            "/api/session-ready",
            {**event, "sessionId": session_id},
            phone_control_token=phone_control_token,
        )
    elif event_type == "phone.cancel" and client == "phone":
        response = await apply_session_payload(
            "/api/session-cancel",
            {**event, "sessionId": session_id},
            phone_control_token=phone_control_token,
        )
    elif event_type == "phone.resultExit" and client == "phone":
        response = await apply_session_payload(
            "/api/session-result-exit",
            {**event, "sessionId": session_id},
            phone_control_token=phone_control_token,
        )
    elif event_type == "game.result":
        return event_payload(
            "server.error",
            session_id,
            "server",
            None,
            message="game.result requires authenticated HTTP",
        )
    elif event_type in ("game.inputCheck", "game.inputDeviceReady", "game.playStarted", "game.inputExit") and client == "game":
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
        await broadcast_session(session_id, event_type, "game", entry)
        return None
    else:
        return event_payload("server.error", session_id, "server", None, message="unknown event type")
    if response.status >= 400:
        return event_payload("server.error", session_id, "server", None, message=response.text)
    return None


@web.middleware
async def privacy_headers_middleware(
    request: web.Request,
    handler: object,
) -> web.StreamResponse:
    response = await handler(request)  # type: ignore[operator]
    if request.path.startswith("/api/session"):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Pragma"] = "no-cache"
    elif request.path in ("/api/player-suggestions", "/api/ranking-board", "/api/players"):
        response.headers["Cache-Control"] = "no-store"
    return response


@web.middleware
async def public_demo_rate_limit_middleware(
    request: web.Request,
    handler: object,
) -> web.StreamResponse:
    if not PUBLIC_DEMO_MODE:
        return await handler(request)  # type: ignore[operator]
    bucket: str | None = None
    limit = 0
    if request.path == "/api/session-open" and request.method == "POST":
        bucket = "session-open"
        limit = PUBLIC_DEMO_OPEN_RATE_LIMIT
    elif request.path == "/ws":
        bucket = "websocket-handshake"
        limit = PUBLIC_DEMO_WS_HANDSHAKE_RATE_LIMIT
    elif request.method in ("POST", "DELETE") and (
        request.path.startswith("/api/session")
        or request.path in ("/api/ranking-score", "/api/admin-reset")
    ):
        bucket = "mutation"
        limit = PUBLIC_DEMO_MUTATION_RATE_LIMIT
    if bucket is None:
        return await handler(request)  # type: ignore[operator]
    retry_after = consume_public_demo_rate_limit(
        bucket,
        public_demo_request_source(request),
        limit,
    )
    if retry_after is None and bucket == "session-open":
        retry_after = consume_rate_window(
            public_demo_global_open_timestamps,
            PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT,
        )
    if retry_after is not None:
        return web.json_response(
            {"error": "rate limit exceeded"},
            status=HTTPStatus.TOO_MANY_REQUESTS,
            headers={"Retry-After": str(retry_after)},
        )
    return await handler(request)  # type: ignore[operator]


async def purge_public_demo_sessions_once(at_ms: int | None = None) -> set[str]:
    if not PUBLIC_DEMO_MODE:
        return set()
    async with entries_lock:
        entries, expired = prune_public_demo_state_locked(at_ms)
        active_session_ids = set(entries) | set(game_session_credentials)
    stale_room_ids = set(session_rooms) - active_session_ids
    expired.update(stale_room_ids)
    await close_session_sockets(expired, b"session expired")
    return expired


async def public_demo_cleanup_context(app: web.Application):
    if not PUBLIC_DEMO_MODE:
        yield
        return
    await purge_public_demo_sessions_once()
    interval_seconds = min(60, max(1, SESSION_TTL_SECONDS // 4))

    async def cleanup_loop() -> None:
        while True:
            await asyncio.sleep(interval_seconds)
            await purge_public_demo_sessions_once()

    cleanup_task = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


def create_app() -> web.Application:
    if PUBLIC_DEMO_MODE:
        validate_runtime_configuration()
        ensure_runtime_directory_permissions()
    app = web.Application(
        middlewares=[
            privacy_headers_middleware,
            public_demo_rate_limit_middleware,
        ]
    )
    app.cleanup_ctx.append(public_demo_cleanup_context)
    app.router.add_get("/", json_get)
    app.router.add_get("/join", json_get)
    app.router.add_get("/license", json_get)
    app.router.add_get("/assets/js/jsQR.js", json_get)
    app.router.add_get("/assets/title/logo.png", json_get)
    app.router.add_get("/api/session-entry", json_get)
    app.router.add_get("/api/session-entries", json_get)
    app.router.add_get("/api/players", json_get)
    app.router.add_get("/api/player-suggestions", json_get)
    app.router.add_get("/api/ranking-board", json_get)
    app.router.add_delete("/api/session-entry", delete_session_entry)
    app.router.add_post("/api/session-release", release_session_entry)
    app.router.add_post("/api/session-input-check", mutate_input_state)
    app.router.add_post("/api/session-input-ready", mutate_input_state)
    app.router.add_post("/api/session-input-exit", mutate_input_state)
    for path in ("/api/session-open", "/api/session-entry", "/api/session-ready", "/api/session-cancel", "/api/session-result", "/api/session-result-exit", "/api/admin-reset", "/api/ranking-score"):
        app.router.add_post(path, mutate_json_endpoint)
    app.router.add_get("/ws", websocket_handler)
    return app


def reset_public_demo_runtime() -> None:
    """Clear the validated ephemeral public-demo runtime on process start."""
    global active_public_demo_ws_count
    if not PUBLIC_DEMO_MODE:
        return
    validate_runtime_configuration()
    ensure_runtime_directory_permissions()
    runtime_files = (DATA_FILE, SESSION_EVENT_LOG_FILE, RANKING_FILE, PLAYERS_FILE)
    for path in runtime_files:
        for candidate in (path, path.with_suffix(path.suffix + ".tmp")):
            candidate.unlink(missing_ok=True)
            if candidate.exists():
                raise RuntimeError(
                    f"failed to clear public-demo runtime file: {candidate}"
                )
    game_session_credentials.clear()
    join_session_credentials.clear()
    registered_public_demo_sessions.clear()
    public_demo_rate_windows.clear()
    public_demo_global_open_timestamps.clear()
    active_public_demo_ws_count = 0
    active_public_demo_ws_by_session.clear()
    ensure_runtime_directory_permissions()


def main() -> None:
    if PUBLIC_DEMO_MODE:
        os.umask(0o077)
        reset_public_demo_runtime()
    else:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    mode = "public-demo" if PUBLIC_DEMO_MODE else "persistent"
    print(
        f"Hakkei score server listening on http://{HOST}:{PORT} "
        f"(aiohttp + websocket, mode={mode})",
        flush=True,
    )
    web.run_app(create_app(), host=HOST, port=PORT, access_log=None)


if __name__ == "__main__":
    main()
