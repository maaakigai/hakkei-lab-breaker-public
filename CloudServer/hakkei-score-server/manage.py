#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from typing import NoReturn

import server

DELETE_CONFIRMATION = "DELETE_PLAYER_DATA"
RESET_CONFIRMATION = "DELETE_ALL_HAKKEI_DATA"


def management_snapshot() -> dict[str, object]:
    registry = server.load_player_registry()
    board = server.load_ranking_board()
    entries = server.load_entries()
    return {
        "dataDirectory": str(server.DATA_DIR),
        "sessionCount": len(entries),
        "playerCount": len(registry.get("players", [])),
        "rankingPlayerCount": len(board.get("players", [])),
        "rankingRecordCount": len(board.get("records", [])),
        "players": registry.get("players", []),
    }


def delete_player_data(player_id_value: object) -> dict[str, int]:
    player_id = server.registry_player_id(player_id_value)
    if player_id is None:
        raise ValueError("invalid player id")

    registry = server.load_player_registry()
    registry_players = [
        player
        for player in registry.get("players", [])
        if isinstance(player, dict)
        and server.registry_player_id(player.get("playerId")) != player_id
    ]

    board = server.load_ranking_board()
    ranking_players = [
        player
        for player in board.get("players", [])
        if isinstance(player, dict)
        and server.registry_player_id(player.get("playerId")) != player_id
    ]
    ranking_records = [
        record
        for record in board.get("records", [])
        if isinstance(record, dict)
        and server.registry_player_id(record.get("playerId")) != player_id
    ]

    entries = server.load_entries()
    remaining_entries = {
        session_id: entry
        for session_id, entry in entries.items()
        if not isinstance(entry, dict)
        or server.registry_player_id(entry.get("playerId")) != player_id
    }

    removed = {
        "players": len(registry.get("players", [])) - len(registry_players),
        "rankingPlayers": len(board.get("players", [])) - len(ranking_players),
        "rankingRecords": len(board.get("records", [])) - len(ranking_records),
        "sessions": len(entries) - len(remaining_entries),
    }
    server.save_player_registry({"schemaVersion": 1, "players": registry_players})
    server.save_ranking_board(
        {
            "schemaVersion": 1,
            "players": ranking_players,
            "records": ranking_records,
        }
    )
    server.save_entries(remaining_entries)
    return removed


def reset_runtime_data() -> None:
    server.save_entries({})
    server.save_player_registry(server.empty_player_registry())
    server.save_ranking_board(server.empty_ranking_board())
    server.DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    server.SESSION_EVENT_LOG_FILE.write_text("", encoding="utf-8")


def fail(message: str) -> NoReturn:
    raise SystemExit(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Server-local Hakkei data management. No HTTP admin API is exposed."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list", help="print the private server-local registry")

    delete_parser = subparsers.add_parser(
        "delete-player",
        help="delete one player, their ranking records, and their sessions",
    )
    delete_parser.add_argument("player_id")
    delete_parser.add_argument("--confirm", required=True)

    reset_parser = subparsers.add_parser(
        "reset",
        help="replace all runtime data and the event log with empty files",
    )
    reset_parser.add_argument("--confirm", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server.initialize_runtime_data()
    if args.command == "list":
        result: object = management_snapshot()
    elif args.command == "delete-player":
        if args.confirm != DELETE_CONFIRMATION:
            fail(f"--confirm must be {DELETE_CONFIRMATION}")
        result = delete_player_data(args.player_id)
    elif args.command == "reset":
        if args.confirm != RESET_CONFIRMATION:
            fail(f"--confirm must be {RESET_CONFIRMATION}")
        reset_runtime_data()
        result = management_snapshot()
    else:
        fail("unknown command")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
