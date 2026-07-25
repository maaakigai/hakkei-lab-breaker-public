from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

import server
import manage


PUBLIC_SUGGESTION_FIELDS = {
    "nickname",
    "playerNumber",
    "registeredAtMs",
    "lastPlayedAtMs",
    "highScore",
    "playCount",
}
PUBLIC_RANKING_FIELDS = {
    *PUBLIC_SUGGESTION_FIELDS,
    "highScoreCriticalBonusYen",
}


class ScoreServerContractTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.original_state = (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.entries_lock,
            server.ranking_lock,
        )
        server.DATA_DIR = data_dir
        server.DATA_FILE = data_dir / "session-entries.json"
        server.SESSION_EVENT_LOG_FILE = data_dir / "session-events.log"
        server.RANKING_FILE = data_dir / "ranking-board.json"
        server.PLAYERS_FILE = data_dir / "players.json"
        server.entries_lock = asyncio.Lock()
        server.ranking_lock = asyncio.Lock()
        server.session_rooms.clear()
        server.seen_event_ids.clear()
        self.client = TestClient(TestServer(server.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.entries_lock,
            server.ranking_lock,
        ) = self.original_state
        server.session_rooms.clear()
        server.seen_event_ids.clear()
        self.temp_dir.cleanup()

    async def register(
        self,
        *,
        session_id: str = "session-1",
        player_id: str = "phone-1",
        player_name: str = "ALICE",
    ) -> dict[str, object]:
        response = await self.client.post(
            "/api/session-entry",
            json={
                "sessionId": session_id,
                "playerId": player_id,
                "playerName": player_name,
            },
        )
        self.assertEqual(response.status, 200, await response.text())
        return await response.json()

    def ranking_payload(
        self,
        *,
        player_id: str = "remote-phone-1",
        nickname: str = "ALICE",
        registered_at_ms: int = 1,
        base_damage_yen: int = 1_234,
        critical_bonus_yen: int = 0,
        played_at_ms: int = 2,
        rank: str = "A",
        video_level: int = 4,
        include_explicit_base: bool = True,
    ) -> dict[str, object]:
        record: dict[str, object] = {
            "score": base_damage_yen,
            "damageYen": base_damage_yen + critical_bonus_yen,
            "criticalBonusYen": str(critical_bonus_yen),
            "rank": rank,
            "videoLevel": video_level,
            "playedAtMs": played_at_ms,
        }
        if include_explicit_base:
            record["baseDamageYen"] = base_damage_yen
        return {
            "player": {
                "playerId": player_id,
                "nickname": nickname,
                "registeredAtMs": registered_at_ms,
            },
            "record": record,
        }

    async def test_tokenless_http_fallback_flow_is_persistent(self) -> None:
        registered = await self.register()
        self.assertEqual(registered["sessionId"], "session-1")
        self.assertEqual(registered["playerNumber"], 26001)
        self.assertTrue(server.DATA_FILE.is_file())
        self.assertTrue(server.PLAYERS_FILE.is_file())

        ready = await self.client.post(
            "/api/session-ready",
            json={"sessionId": "session-1", "playerId": "phone-1"},
        )
        self.assertEqual(ready.status, 200)

        input_check = await self.client.post(
            "/api/session-input-check?sessionId=session-1&ready=1",
        )
        self.assertEqual(input_check.status, 200)
        self.assertIn("inputDeviceReadyAtMs", await input_check.json())

        play = await self.client.post(
            "/api/session-input-exit?sessionId=session-1&play=1",
        )
        self.assertEqual(play.status, 200)
        self.assertIn("playStartedAtMs", await play.json())

        result = await self.client.post(
            "/api/session-result",
            json={
                "sessionId": "session-1",
                "playerId": "phone-1",
                "damageYen": 1234,
                "damageYenText": "1,234",
                "rank": "A",
            },
        )
        self.assertEqual(result.status, 200)
        result_body = await result.json()
        self.assertEqual(result_body["resultDamageYen"], 1234)
        self.assertEqual(result_body["resultDamageYenText"], "1234")

        exit_response = await self.client.post(
            "/api/session-result-exit",
            json={"sessionId": "session-1", "playerId": "phone-1"},
        )
        self.assertEqual(exit_response.status, 200)
        self.assertIn("resultExitAtMs", await exit_response.json())

        persisted = json.loads(server.DATA_FILE.read_text(encoding="utf-8"))
        self.assertEqual(persisted["session-1"]["playerName"], "ALICE")
        registry = json.loads(server.PLAYERS_FILE.read_text(encoding="utf-8"))
        self.assertEqual(registry["players"][0]["nickname"], "ALICE")

    async def test_first_run_seeds_exact_synthetic_ranking_once(self) -> None:
        for path in (server.DATA_FILE, server.PLAYERS_FILE, server.RANKING_FILE):
            path.unlink(missing_ok=True)

        self.assertTrue(server.initialize_runtime_data())
        self.assertFalse(server.initialize_runtime_data())
        registry = server.load_player_registry()
        board = server.public_ranking_board()
        expected_names = [f"PLAYER {index:03d}" for index in range(1, 11)]
        self.assertEqual(
            [player["nickname"] for player in registry["players"]],
            expected_names,
        )
        self.assertEqual(
            [player["nickname"] for player in board["players"]],
            expected_names,
        )
        self.assertEqual(board["players"][0]["highScore"], 30_000_000)
        self.assertEqual(
            board["players"][0]["highScoreCriticalBonusYen"],
            "65000000000",
        )
        new_player = server.upsert_player_registry("new-player", "NEW PLAYER")
        self.assertIsNotNone(new_player)
        self.assertEqual(new_player["playerNumber"], 26011)

    async def test_runtime_data_cannot_reuse_the_bundled_seed_directory(self) -> None:
        self.assertNotEqual(
            server.DEFAULT_RUNTIME_DATA_DIR.resolve(),
            server.SEED_DATA_DIR.resolve(),
        )
        current_data_dir = server.DATA_DIR
        try:
            server.DATA_DIR = server.SEED_DATA_DIR.resolve()
            with self.assertRaisesRegex(
                RuntimeError,
                "must not be the bundled data/ seed directory",
            ):
                server.initialize_runtime_data()
        finally:
            server.DATA_DIR = current_data_dir

    async def test_server_local_management_delete_and_reset(self) -> None:
        for path in (server.DATA_FILE, server.PLAYERS_FILE, server.RANKING_FILE):
            path.unlink(missing_ok=True)
        server.initialize_runtime_data()
        server.save_entries(
            {
                "fixture-session": {
                    "playerId": "fixture-001",
                    "playerName": "PLAYER 001",
                }
            }
        )
        server.SESSION_EVENT_LOG_FILE.write_text("event\n", encoding="utf-8")

        removed = manage.delete_player_data("remote-fixture-001")
        self.assertEqual(
            removed,
            {
                "players": 1,
                "rankingPlayers": 1,
                "rankingRecords": 1,
                "sessions": 1,
            },
        )
        self.assertEqual(
            len(manage.management_snapshot()["players"]),
            9,
        )

        manage.reset_runtime_data()
        snapshot = manage.management_snapshot()
        self.assertEqual(snapshot["sessionCount"], 0)
        self.assertEqual(snapshot["playerCount"], 0)
        self.assertEqual(snapshot["rankingPlayerCount"], 0)
        self.assertEqual(snapshot["rankingRecordCount"], 0)
        self.assertEqual(
            server.SESSION_EVENT_LOG_FILE.read_text(encoding="utf-8"),
            "",
        )
        self.assertFalse(server.initialize_runtime_data())

    async def test_websocket_is_primary_and_duplicate_event_id_is_ignored(self) -> None:
        ws = await self.client.ws_connect(
            "/ws?client=phone&sessionId=ws-session"
        )
        hello = await ws.receive_json()
        self.assertEqual(hello["type"], "server.hello")

        event = {
            "protocolVersion": 1,
            "eventId": "phone-register-1",
            "type": "phone.register",
            "sessionId": "ws-session",
            "sentAtMs": 1,
            "actor": "phone",
            "playerId": "phone-ws",
            "playerName": "SOCKET",
        }
        await ws.send_json(event)
        received_types = {
            (await ws.receive_json())["type"],
            (await ws.receive_json())["type"],
        }
        self.assertEqual(
            received_types,
            {"session.snapshot", "session.registered"},
        )
        first_registered_at = server.load_entries()["ws-session"][
            "registeredAtMs"
        ]

        await ws.send_json(event)
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(ws.receive(), timeout=0.05)
        self.assertEqual(
            server.load_entries()["ws-session"]["registeredAtMs"],
            first_registered_at,
        )
        self.assertEqual(
            server.load_entries()["ws-session"]["playerName"],
            "SOCKET",
        )
        await ws.close()

    async def test_websocket_schema_and_message_size_are_bounded(self) -> None:
        ws = await self.client.ws_connect(
            "/ws?client=phone&sessionId=bounded-ws"
        )
        await ws.receive_json()

        await ws.send_json(
            {
                "protocolVersion": 1,
                "eventId": "../invalid",
                "type": "client.ping",
                "sessionId": "bounded-ws",
            }
        )
        error = await ws.receive_json()
        self.assertEqual(error["type"], "server.error")
        self.assertEqual(error["message"], "invalid eventId")
        await ws.close()

        oversized = await self.client.ws_connect(
            "/ws?client=phone&sessionId=oversized-ws"
        )
        await oversized.receive_json()
        await oversized.send_str("x" * (server.MAX_WS_MESSAGE_BYTES + 1))
        message = await oversized.receive()
        self.assertIn(
            message.type,
            {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR},
        )
        await oversized.close()

    async def test_removed_auth_and_management_endpoints_return_404(self) -> None:
        cases = [
            ("GET", "/api/session-entries"),
            ("GET", "/api/players"),
            ("POST", "/api/admin-reset"),
            ("POST", "/api/session-open"),
            ("POST", "/api/session-release"),
            ("DELETE", "/api/session-entry?sessionId=session-1"),
            ("DELETE", "/api/player?playerId=phone-1"),
            ("GET", "/data/players.json"),
            ("GET", "/data/session-entries.json"),
            ("GET", "/data/session-events.log"),
        ]
        for method, path in cases:
            response = await self.client.request(
                method,
                path,
                json={} if method == "POST" else None,
            )
            self.assertEqual(
                response.status,
                404,
                f"{method} {path}: {await response.text()}",
            )

    async def test_join_contract_uses_session_id_without_tokens(self) -> None:
        response = await self.client.get("/join?sessionId=qr-session")
        self.assertEqual(response.status, 200)
        html = await response.text()
        self.assertIn('params.get("sessionId")', html)
        self.assertIn('new WebSocket(wsUrl.toString())', html)
        self.assertIn("ニックネームとスコアは共有ランキングに公開", html)
        for forbidden in (
            "gameToken",
            "joinToken",
            "phoneControlToken",
            "sessionReleaseToken",
            "PUBLIC_DEMO_MODE",
        ):
            self.assertNotIn(forbidden, html)

    async def test_public_ranking_and_suggestions_have_only_ui_fields(self) -> None:
        await self.register()
        score = await self.client.post(
            "/api/ranking-score",
            json=self.ranking_payload(),
        )
        self.assertEqual(score.status, 200, await score.text())

        for path, expected_fields in (
            ("/api/ranking-board", PUBLIC_RANKING_FIELDS),
            ("/api/player-suggestions", PUBLIC_SUGGESTION_FIELDS),
        ):
            response = await self.client.get(path)
            self.assertEqual(response.status, 200)
            payload = await response.json()
            self.assertEqual(len(payload["players"]), 1)
            player = payload["players"][0]
            self.assertEqual(set(player), expected_fields)
            self.assertNotIn("playerId", str(payload))
            self.assertNotIn("records", payload)
            self.assertEqual(player["nickname"], "ALICE")
            self.assertEqual(player["highScore"], 1234)
            self.assertEqual(player["playCount"], 1)
            if path == "/api/ranking-board":
                self.assertEqual(player["highScoreCriticalBonusYen"], "0")

    async def test_critical_bonus_is_separate_from_leaderboard_score(self) -> None:
        critical = self.ranking_payload(
            player_id="remote-critical",
            nickname="CRITICAL",
            registered_at_ms=10,
            base_damage_yen=30_000_000,
            critical_bonus_yen=65_000_000_000,
            played_at_ms=100,
            rank="S",
            video_level=5,
        )
        first = await self.client.post("/api/ranking-score", json=critical)
        self.assertEqual(first.status, 200, await first.text())

        higher_base = self.ranking_payload(
            player_id="remote-base",
            nickname="BASE",
            registered_at_ms=11,
            base_damage_yen=40_000_000,
            critical_bonus_yen=0,
            played_at_ms=101,
            rank="S",
            video_level=5,
        )
        second = await self.client.post("/api/ranking-score", json=higher_base)
        self.assertEqual(second.status, 200, await second.text())
        public_board = await second.json()
        self.assertEqual(
            [player["nickname"] for player in public_board["players"]],
            ["BASE", "CRITICAL"],
        )
        critical_public = next(
            player
            for player in public_board["players"]
            if player["nickname"] == "CRITICAL"
        )
        self.assertEqual(critical_public["highScore"], 30_000_000)
        self.assertEqual(
            critical_public["highScoreCriticalBonusYen"],
            "65000000000",
        )

        internal = server.load_ranking_board()
        critical_record = next(
            record
            for record in internal["records"]
            if record["nickname"] == "CRITICAL"
        )
        self.assertEqual(critical_record["score"], 30_000_000)
        self.assertEqual(critical_record["baseDamageYen"], 30_000_000)
        self.assertEqual(
            critical_record["criticalBonusYen"],
            "65000000000",
        )
        self.assertEqual(critical_record["damageYen"], 65_030_000_000)

        repeated = await self.client.post("/api/ranking-score", json=critical)
        self.assertEqual(repeated.status, 200)
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)
        repeated_player = next(
            player
            for player in (await repeated.json())["players"]
            if player["nickname"] == "CRITICAL"
        )
        self.assertEqual(repeated_player["playCount"], 1)

        smaller_base_larger_bonus = self.ranking_payload(
            player_id="remote-critical",
            nickname="CRITICAL",
            registered_at_ms=10,
            base_damage_yen=29_000_000,
            critical_bonus_yen=70_000_000_000,
            played_at_ms=102,
            rank="S",
            video_level=5,
        )
        third = await self.client.post(
            "/api/ranking-score",
            json=smaller_base_larger_bonus,
        )
        self.assertEqual(third.status, 200, await third.text())
        critical_after = next(
            player
            for player in (await third.json())["players"]
            if player["nickname"] == "CRITICAL"
        )
        self.assertEqual(critical_after["highScore"], 30_000_000)
        self.assertEqual(critical_after["playCount"], 2)
        internal_player = next(
            player
            for player in server.load_ranking_board()["players"]
            if player["nickname"] == "CRITICAL"
        )
        self.assertEqual(
            internal_player["highScoreCriticalBonusYen"],
            "65000000000",
        )

    async def test_invalid_ranking_schema_has_no_persistent_side_effect(self) -> None:
        mismatch = self.ranking_payload()
        mismatch["record"]["baseDamageYen"] = 999
        response = await self.client.post("/api/ranking-score", json=mismatch)
        self.assertEqual(response.status, 400)
        self.assertFalse(server.PLAYERS_FILE.exists())
        self.assertFalse(server.RANKING_FILE.exists())

        wrong_total = self.ranking_payload(critical_bonus_yen=100)
        wrong_total["record"]["damageYen"] = 1234
        response = await self.client.post(
            "/api/ranking-score",
            json=wrong_total,
        )
        self.assertEqual(response.status, 400)

        invalid_video = self.ranking_payload()
        invalid_video["record"]["videoLevel"] = 6
        response = await self.client.post(
            "/api/ranking-score",
            json=invalid_video,
        )
        self.assertEqual(response.status, 400)

    async def test_http_body_and_session_schema_validation(self) -> None:
        oversized = await self.client.post(
            "/api/session-entry",
            data=json.dumps({"pad": "x" * server.MAX_BODY_BYTES}),
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(oversized.status, 400)

        invalid_json = await self.client.post(
            "/api/session-entry",
            data="{",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(invalid_json.status, 400)

        invalid_shape = await self.client.post(
            "/api/session-entry",
            json=["not", "an", "object"],
        )
        self.assertEqual(invalid_shape.status, 400)

        invalid_registration = await self.client.post(
            "/api/session-entry",
            json={
                "sessionId": "../bad",
                "playerId": "phone-1",
                "playerName": "ALICE",
            },
        )
        self.assertEqual(invalid_registration.status, 400)

        await self.register()
        mismatch = await self.client.post(
            "/api/session-ready",
            json={"sessionId": "session-1", "playerId": "phone-2"},
        )
        self.assertEqual(mismatch.status, 403)

        invalid_result = await self.client.post(
            "/api/session-result",
            json={
                "sessionId": "session-1",
                "playerId": "phone-1",
                "damageYen": "1234",
                "damageYenText": "1234",
                "rank": "A",
            },
        )
        self.assertEqual(invalid_result.status, 400)

    async def test_same_session_cannot_be_claimed_by_another_player(self) -> None:
        await self.register()
        conflict = await self.client.post(
            "/api/session-entry",
            json={
                "sessionId": "session-1",
                "playerId": "phone-2",
                "playerName": "BOB",
            },
        )
        self.assertEqual(conflict.status, 409)
        entry = server.load_entries()["session-1"]
        self.assertEqual(entry["playerId"], "phone-1")
        self.assertEqual(entry["playerName"], "ALICE")

    async def test_event_log_excludes_names_and_http_bodies(self) -> None:
        await self.register(player_name="PRIVATE_NAME")
        server.append_session_event(
            "privacy-probe",
            "session-1",
            {
                "nickname": "PRIVATE_NAME",
                "playerName": "PRIVATE_NAME",
                "body": {"secret": "PRIVATE_NAME"},
                "httpBody": "PRIVATE_NAME",
                "requestBody": "PRIVATE_NAME",
                "payload": {"playerName": "PRIVATE_NAME"},
                "playerId": "phone-1",
                "ok": True,
            },
        )
        log_text = server.SESSION_EVENT_LOG_FILE.read_text(encoding="utf-8")
        self.assertNotIn("PRIVATE_NAME", log_text)
        self.assertNotIn('"body"', log_text)
        self.assertNotIn('"payload"', log_text)
        self.assertIn('"playerId": "phone-1"', log_text)
        self.assertIn('"ok": true', log_text)

    def test_synthetic_examples_have_ten_non_personal_players(self) -> None:
        data_dir = Path(__file__).resolve().parent / "data"
        players = json.loads(
            (data_dir / "players.example.json").read_text(encoding="utf-8")
        )["players"]
        ranking = json.loads(
            (data_dir / "ranking-board.example.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(len(players), 10)
        self.assertEqual(len(ranking["players"]), 10)
        self.assertEqual(len(ranking["records"]), 10)
        self.assertEqual(
            [player["nickname"] for player in players],
            [f"PLAYER {index:03d}" for index in range(1, 11)],
        )
        self.assertTrue(
            all(
                server.valid_player_name(player["nickname"])
                == player["nickname"]
                for player in players
            )
        )
        server.PLAYERS_FILE.write_text(
            (data_dir / "players.example.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        server.RANKING_FILE.write_text(
            (data_dir / "ranking-board.example.json").read_text(
                encoding="utf-8"
            ),
            encoding="utf-8",
        )
        public_board = server.public_ranking_board()
        self.assertEqual(len(public_board["players"]), 10)
        self.assertEqual(
            [player["nickname"] for player in public_board["players"]],
            [f"PLAYER {index:03d}" for index in range(1, 11)],
        )
        self.assertEqual(
            public_board["players"][0]["highScoreCriticalBonusYen"],
            "65000000000",
        )
        self.assertEqual(server.load_entries(), {})

    def test_server_source_contains_no_removed_token_or_demo_mode(self) -> None:
        source = Path(server.__file__).read_text(encoding="utf-8")
        for forbidden in (
            "PUBLIC_DEMO_MODE",
            "GAME_TOKEN",
            "JOIN_TOKEN",
            "PHONE_CONTROL_TOKEN",
            "ADMIN_TOKEN",
            "game_session_credentials",
            "join_session_credentials",
        ):
            self.assertNotIn(forbidden, source)
        self.assertNotIn('placeholder="MIURA"', source)
        self.assertIn('placeholder="PLAYER 001"', source)


if __name__ == "__main__":
    unittest.main()
