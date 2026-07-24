from __future__ import annotations

import asyncio
import json
import secrets
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer

import server

GAME_TOKEN = "a" * 64
WRONG_TOKEN = "b" * 64


class ScoreServerSecurityTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.original_paths = (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.ADMIN_TOKEN_FILE,
            server.ADMIN_TOKEN,
            server.PUBLIC_DEMO_MODE,
            server.PUBLIC_DEMO_RUNTIME_DIR,
            server.PUBLIC_DEMO_RANKING_FILE,
            server.SESSION_TTL_SECONDS,
            server.PUBLIC_DEMO_MAX_ACTIVE_SESSIONS,
            server.PUBLIC_DEMO_OPEN_RATE_LIMIT,
            server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT,
            server.PUBLIC_DEMO_MUTATION_RATE_LIMIT,
            server.PUBLIC_DEMO_WS_HANDSHAKE_RATE_LIMIT,
            server.PUBLIC_DEMO_WS_MESSAGE_RATE_LIMIT,
            server.PUBLIC_DEMO_RATE_KEY_MAX_COUNT,
            server.PUBLIC_DEMO_WS_MAX_CONNECTIONS,
            server.PUBLIC_DEMO_WS_MAX_CONNECTIONS_PER_SESSION,
        )
        server.DATA_DIR = data_dir
        server.DATA_FILE = data_dir / "session-entries.json"
        server.SESSION_EVENT_LOG_FILE = data_dir / "session-events.log"
        server.RANKING_FILE = data_dir / "ranking-board.json"
        server.PLAYERS_FILE = data_dir / "players.json"
        server.ADMIN_TOKEN_FILE = data_dir / ".admin-token"
        server.ADMIN_TOKEN = "test-admin-token"
        server.PUBLIC_DEMO_MODE = False
        server.PUBLIC_DEMO_RUNTIME_DIR = data_dir
        server.SESSION_TTL_SECONDS = 4 * 60 * 60
        server.entries_lock = asyncio.Lock()
        server.ranking_lock = asyncio.Lock()
        server.session_rooms.clear()
        server.seen_event_ids.clear()
        server.game_session_credentials.clear()
        server.join_session_credentials.clear()
        server.registered_public_demo_sessions.clear()
        server.public_demo_rate_windows.clear()
        server.public_demo_global_open_timestamps.clear()
        server.active_public_demo_ws_count = 0
        server.active_public_demo_ws_by_session.clear()
        self.join_tokens: dict[str, str] = {}
        self.control_tokens: dict[str, str] = {}
        self.client = TestClient(TestServer(server.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        server.game_session_credentials.clear()
        server.join_session_credentials.clear()
        server.registered_public_demo_sessions.clear()
        server.public_demo_rate_windows.clear()
        server.public_demo_global_open_timestamps.clear()
        server.active_public_demo_ws_count = 0
        server.active_public_demo_ws_by_session.clear()
        (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.ADMIN_TOKEN_FILE,
            server.ADMIN_TOKEN,
            server.PUBLIC_DEMO_MODE,
            server.PUBLIC_DEMO_RUNTIME_DIR,
            server.PUBLIC_DEMO_RANKING_FILE,
            server.SESSION_TTL_SECONDS,
            server.PUBLIC_DEMO_MAX_ACTIVE_SESSIONS,
            server.PUBLIC_DEMO_OPEN_RATE_LIMIT,
            server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT,
            server.PUBLIC_DEMO_MUTATION_RATE_LIMIT,
            server.PUBLIC_DEMO_WS_HANDSHAKE_RATE_LIMIT,
            server.PUBLIC_DEMO_WS_MESSAGE_RATE_LIMIT,
            server.PUBLIC_DEMO_RATE_KEY_MAX_COUNT,
            server.PUBLIC_DEMO_WS_MAX_CONNECTIONS,
            server.PUBLIC_DEMO_WS_MAX_CONNECTIONS_PER_SESSION,
        ) = self.original_paths
        self.temp_dir.cleanup()

    async def register(
        self,
        session_id: str = "session-1",
        player_id: str = "phone-1",
        player_name: str = "ALICE",
    ) -> dict[str, object]:
        opened = await self.client.post(
            "/api/session-open",
            json={"sessionId": session_id, "gameToken": GAME_TOKEN},
        )
        self.assertEqual(opened.status, 200)
        opened_payload = await opened.json()
        join_token = opened_payload.get("joinToken")
        headers = {}
        if isinstance(join_token, str):
            self.join_tokens[session_id] = join_token
            headers[server.JOIN_TOKEN_HEADER] = join_token
        if server.PUBLIC_DEMO_MODE:
            control_token = self.control_tokens.setdefault(
                session_id,
                secrets.token_hex(32),
            )
            headers[server.PHONE_CONTROL_TOKEN_HEADER] = control_token
        response = await self.client.post(
            "/api/session-entry",
            json={"sessionId": session_id, "playerId": player_id, "playerName": player_name},
            headers=headers,
        )
        self.assertEqual(response.status, 200)
        return await response.json()

    async def record_result(
        self,
        session_id: str = "session-1",
        player_id: str = "phone-1",
        score: int = 1234,
        played_at_ms: int = 1,
    ) -> None:
        response = await self.client.post(
            "/api/session-result",
            json={
                "sessionId": session_id,
                "gameToken": GAME_TOKEN,
                "playerId": player_id,
                "score": score,
                "damageYen": 5678,
                "damageYenText": "5,678",
                "rank": "A",
                "videoLevel": 3,
                "playedAtMs": played_at_ms,
            },
        )
        self.assertEqual(response.status, 200)

    def ranking_payload(
        self,
        session_id: str = "session-1",
        player_id: str = "remote-phone-1",
        nickname: str = "ALICE",
        score: int = 1234,
        played_at_ms: int = 1,
    ) -> dict[str, object]:
        return {
            "sessionId": session_id,
            "gameToken": GAME_TOKEN,
            "player": {
                "playerId": player_id,
                "nickname": nickname,
                "registeredAtMs": 1,
            },
            "record": {
                "score": score,
                "damageYen": 5678,
                "rank": "A",
                "videoLevel": 3,
                "playedAtMs": played_at_ms,
            },
        }

    async def test_private_lists_and_delete_require_admin_token(self) -> None:
        await self.register()

        for path in ("/api/session-entries", "/api/players"):
            response = await self.client.get(path)
            self.assertEqual(response.status, 403)
            authorized = await self.client.get(
                path,
                headers={"Authorization": "Bearer test-admin-token"},
            )
            self.assertEqual(authorized.status, 200)

        response = await self.client.delete("/api/session-entry?sessionId=session-1")
        self.assertEqual(response.status, 403)
        self.assertEqual((await self.client.get("/api/session-entry?sessionId=session-1")).status, 200)

        authorized = await self.client.delete(
            "/api/session-entry?sessionId=session-1",
            headers={"Authorization": "Bearer test-admin-token"},
        )
        self.assertEqual(authorized.status, 200)
        self.assertTrue((await authorized.json())["deleted"])

    async def test_phone_can_release_only_its_own_session(self) -> None:
        unopened = await self.client.post(
            "/api/session-entry",
            json={"sessionId": "not-open", "playerId": "phone-1", "playerName": "ALICE"},
        )
        self.assertEqual(unopened.status, 404)
        registration = await self.register()
        release_token = registration["sessionReleaseToken"]
        ranked = await self.client.post("/api/ranking-score", json=self.ranking_payload())
        self.assertEqual(ranked.status, 200)
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

        denied = await self.client.post(
            "/api/session-release",
            json={
                "sessionId": "session-1",
                "playerId": "another-phone",
                "sessionReleaseToken": release_token,
            },
        )
        self.assertEqual(denied.status, 403)
        wrong_token = await self.client.post(
            "/api/session-release",
            json={
                "sessionId": "session-1",
                "playerId": "phone-1",
                "sessionReleaseToken": "b" * 64,
            },
        )
        self.assertEqual(wrong_token.status, 403)

        released = await self.client.post(
            "/api/session-release",
            json={
                "sessionId": "session-1",
                "playerId": "phone-1",
                "sessionReleaseToken": release_token,
            },
        )
        self.assertEqual(released.status, 200)
        self.assertTrue((await released.json())["released"])
        self.assertEqual((await self.client.get("/api/session-entry?sessionId=session-1")).status, 404)
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

        reregistered = await self.client.post(
            "/api/session-entry",
            json={"sessionId": "session-1", "playerId": "phone-2", "playerName": "BOB"},
        )
        self.assertEqual(reregistered.status, 200)
        self.assertEqual((await reregistered.json())["playerName"], "BOB")
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

    async def test_qr_ranking_is_saved_before_phone_result_and_is_idempotent(self) -> None:
        registration = await self.register()

        unauthorized_payload = self.ranking_payload()
        unauthorized_payload["gameToken"] = "b" * 64
        unauthorized = await self.client.post("/api/ranking-score", json=unauthorized_payload)
        self.assertEqual(unauthorized.status, 403)

        mismatched_player = await self.client.post(
            "/api/ranking-score",
            json=self.ranking_payload(player_id="remote-phone-2"),
        )
        self.assertEqual(mismatched_player.status, 409)

        entry_before_score = await self.client.get("/api/session-entry?sessionId=session-1")
        self.assertEqual(entry_before_score.status, 200)
        self.assertNotIn("resultAtMs", await entry_before_score.json())

        accepted = await self.client.post("/api/ranking-score", json=self.ranking_payload())
        self.assertEqual(accepted.status, 200)
        public_board = await accepted.json()
        self.assertEqual(public_board["schemaVersion"], 1)
        self.assertNotIn("records", public_board)
        self.assertEqual(public_board["submittedPlayerNumber"], registration["playerNumber"])
        self.assertEqual(len(public_board["players"]), 1)
        self.assertEqual(
            {
                "nickname": public_board["players"][0]["nickname"],
                "playerNumber": public_board["players"][0]["playerNumber"],
                "highScore": public_board["players"][0]["highScore"],
                "playCount": public_board["players"][0]["playCount"],
            },
            {
                "nickname": "ALICE",
                "playerNumber": 26001,
                "highScore": 1234,
                "playCount": 1,
            },
        )
        self.assertIsInstance(public_board["players"][0]["registeredAtMs"], int)
        self.assertEqual(public_board["players"][0]["lastPlayedAtMs"], 1)

        entry_after_score = await self.client.get("/api/session-entry?sessionId=session-1")
        self.assertEqual(entry_after_score.status, 200)
        self.assertNotIn("resultAtMs", await entry_after_score.json())

        repeated = await self.client.post("/api/ranking-score", json=self.ranking_payload())
        self.assertEqual(repeated.status, 200)
        self.assertEqual((await repeated.json())["players"][0]["playCount"], 1)
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

        await self.record_result()
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)
        repeated_after_result = await self.client.post(
            "/api/ranking-score",
            json=self.ranking_payload(),
        )
        self.assertEqual(repeated_after_result.status, 200)
        self.assertEqual((await repeated_after_result.json())["players"][0]["playCount"], 1)
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

        public_entry = await self.client.get("/api/session-entry?sessionId=session-1")
        serialized_entry = str(await public_entry.json())
        self.assertNotIn("resultScore", serialized_entry)
        self.assertNotIn("resultVideoLevel", serialized_entry)
        self.assertNotIn("resultPlayedAtMs", serialized_entry)
        self.assertNotIn("rankingRecordedResultAtMs", serialized_entry)
        self.assertNotIn("sessionReleaseToken", serialized_entry)

        second_play_payload = self.ranking_payload(played_at_ms=2)
        second_play = await self.client.post("/api/ranking-score", json=second_play_payload)
        self.assertEqual(second_play.status, 200)
        self.assertEqual((await second_play.json())["players"][0]["playCount"], 2)
        repeated_second_play = await self.client.post(
            "/api/ranking-score",
            json=second_play_payload,
        )
        self.assertEqual(repeated_second_play.status, 200)
        self.assertEqual((await repeated_second_play.json())["players"][0]["playCount"], 2)
        await self.record_result(played_at_ms=2)
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)

    async def test_manual_entry_uses_the_same_shared_player_and_is_idempotent(self) -> None:
        registration = await self.register()
        await self.record_result()
        first_phone_score = await self.client.post(
            "/api/ranking-score",
            json=self.ranking_payload(),
        )
        self.assertEqual(first_phone_score.status, 200)
        player_number = registration["playerNumber"]

        manual_session = "manual-session"
        opened = await self.client.post(
            "/api/session-open",
            json={"sessionId": manual_session, "gameToken": GAME_TOKEN},
        )
        self.assertEqual(opened.status, 200)
        manual_payload = {
            "sessionId": manual_session,
            "gameToken": GAME_TOKEN,
            "player": {
                "playerId": f"public-{player_number}",
                "playerNumber": player_number,
                "nickname": "ALICE",
                "registeredAtMs": 2,
            },
            "record": {
                "score": 2222,
                "damageYen": 7777,
                "rank": "A",
                "videoLevel": 4,
                "playedAtMs": 2,
            },
        }
        manual_score = await self.client.post("/api/ranking-score", json=manual_payload)
        self.assertEqual(manual_score.status, 200)
        manual_board = await manual_score.json()
        self.assertEqual(manual_board["submittedPlayerNumber"], player_number)
        self.assertEqual(len(manual_board["players"]), 1)
        self.assertEqual(manual_board["players"][0]["highScore"], 2222)
        self.assertEqual(manual_board["players"][0]["playCount"], 2)

        repeated = await self.client.post("/api/ranking-score", json=manual_payload)
        self.assertEqual(repeated.status, 200)
        self.assertEqual((await repeated.json())["players"][0]["playCount"], 2)
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)

        unauthorized = await self.client.post(
            "/api/ranking-score",
            json={**manual_payload, "gameToken": "b" * 64},
        )
        self.assertEqual(unauthorized.status, 403)

    async def test_public_join_notice_and_leaderboard_do_not_expose_internal_fields(self) -> None:
        join_response = await self.client.get("/join?sessionId=session-1")
        self.assertEqual(join_response.status, 200)
        join_html = await join_response.text()
        self.assertIn("ニックネームとスコアは共有ランキングに公開", join_html)
        self.assertIn("実名や個人情報は入力しないでください", join_html)
        self.assertIn("const publicDemoMode = false;", join_html)

        await self.register()
        await self.record_result()
        await self.client.post("/api/ranking-score", json=self.ranking_payload())
        response = await self.client.get("/api/ranking-board")
        self.assertEqual(response.status, 200)
        payload = await response.json()
        self.assertIsInstance(payload["players"][0]["registeredAtMs"], int)
        self.assertEqual(payload["players"][0]["lastPlayedAtMs"], 1)
        serialized = str(payload)
        for private_field in (
            "playerId",
            "recordId",
            "playedAtMs",
            "damageYen",
            "videoLevel",
            "isHighScore",
        ):
            self.assertNotIn(private_field, serialized)

    async def test_public_player_suggestions_include_unplayed_players_without_internal_ids(self) -> None:
        registration = await self.register()

        response = await self.client.get("/api/player-suggestions")
        self.assertEqual(response.status, 200)
        payload = await response.json()
        self.assertEqual(len(payload["players"]), 1)
        suggestion = payload["players"][0]
        self.assertEqual(suggestion["nickname"], "ALICE")
        self.assertEqual(suggestion["playerNumber"], registration["playerNumber"])
        self.assertIsInstance(suggestion["registeredAtMs"], int)
        self.assertLessEqual(suggestion["registeredAtMs"], registration["registeredAtMs"])
        self.assertIsNone(suggestion["lastPlayedAtMs"])
        serialized = str(payload)
        self.assertNotIn("playerId", serialized)
        self.assertNotIn("sessionId", serialized)

        private_players = await self.client.get("/api/players")
        self.assertEqual(private_players.status, 403)
        authorized_players = await self.client.get(
            "/api/players",
            headers={"Authorization": "Bearer test-admin-token"},
        )
        self.assertEqual(authorized_players.status, 200)
        self.assertIn("playerId", str(await authorized_players.json()))

    async def test_public_demo_uses_only_synthetic_public_data_and_response_scoped_score(self) -> None:
        server.save_player_registry({
            "schemaVersion": 1,
            "players": [{
                "playerId": "remote-private-player",
                "nickname": "PRIVATE_NAME",
                "playerNumber": 26090,
                "registeredAtMs": 100,
                "lastSeenAtMs": 200,
            }],
        })
        server.save_ranking_board({
            "schemaVersion": 1,
            "players": [{
                "playerId": "remote-private-player",
                "nickname": "PRIVATE_NAME",
                "playerNumber": 26090,
                "registeredAtMs": 100,
                "lastPlayedAtMs": 200,
                "highScore": 99999,
                "playCount": 4,
            }],
            "records": [],
        })
        private_registry_before = server.PLAYERS_FILE.read_bytes()
        private_ranking_before = server.RANKING_FILE.read_bytes()
        server.PUBLIC_DEMO_RANKING_FILE = Path(server.__file__).with_name("public-demo-ranking.json")
        server.PUBLIC_DEMO_MODE = True

        join_response = await self.client.get("/join?sessionId=demo-session")
        join_html = await join_response.text()
        self.assertIn("現在のデモセッションでのみ使用", join_html)
        self.assertIn("公開ランキングは合成データ", join_html)

        public_ranking = await self.client.get("/api/ranking-board")
        self.assertEqual(public_ranking.status, 200)
        self.assertEqual(public_ranking.headers.get("Cache-Control"), "no-store")
        ranking_payload = await public_ranking.json()
        self.assertEqual(ranking_payload["dataMode"], "synthetic-demo")
        self.assertTrue(ranking_payload["players"])
        for player in ranking_payload["players"]:
            self.assertRegex(player["nickname"], r"^(?:PLAYER|DEMO)_[0-9]{3}$")
        self.assertNotIn("PRIVATE_NAME", str(ranking_payload))

        suggestions = await self.client.get("/api/player-suggestions")
        suggestion_payload = await suggestions.json()
        self.assertEqual(suggestion_payload["dataMode"], "synthetic-demo")
        self.assertNotIn("PRIVATE_NAME", str(suggestion_payload))

        registration = await self.register(
            session_id="demo-session",
            player_id="private-phone",
            player_name="VISITOR_NAME",
        )
        session_response = await self.client.get(
            "/api/session-entry?sessionId=demo-session",
            headers={
                server.JOIN_TOKEN_HEADER: self.join_tokens["demo-session"],
            },
        )
        self.assertEqual(session_response.headers.get("Cache-Control"), "private, no-store")
        ranked = await self.client.post(
            "/api/ranking-score",
            json=self.ranking_payload(
                session_id="demo-session",
                player_id="remote-private-phone",
                nickname="VISITOR_NAME",
                score=12345,
                played_at_ms=300,
            ),
        )
        self.assertEqual(ranked.status, 200)
        ranked_payload = await ranked.json()
        self.assertEqual(ranked_payload["submissionScope"], "response-only")
        self.assertEqual(
            ranked_payload["submittedPlayerNumber"],
            registration["playerNumber"],
        )
        self.assertNotIn("VISITOR_NAME", str(ranked_payload))
        for player in ranked_payload["players"]:
            self.assertRegex(player["nickname"], r"^(?:PLAYER|DEMO)_[0-9]{3}$")

        ranking_after_submission = await self.client.get("/api/ranking-board")
        self.assertEqual(await ranking_after_submission.json(), ranking_payload)
        self.assertEqual(server.PLAYERS_FILE.read_bytes(), private_registry_before)
        self.assertEqual(server.RANKING_FILE.read_bytes(), private_ranking_before)
        self.assertFalse(server.SESSION_EVENT_LOG_FILE.exists())

    async def test_public_demo_expires_entries_from_server_registration_time(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.SESSION_TTL_SECONDS = 60
        current_time = server.now_ms()
        server.save_entries({
            "stale-session": {
                "sessionId": "stale-session",
                "playerId": "stale-player",
                "playerName": "STALE_NAME",
                "registeredAtMs": current_time - 60_001,
                "resultPlayedAtMs": current_time + 10_000_000,
            },
            "active-session": {
                "sessionId": "active-session",
                "playerId": "active-player",
                "playerName": "ACTIVE_NAME",
                "registeredAtMs": current_time,
            },
        })

        entries = server.load_entries()
        self.assertEqual(list(entries), ["active-session"])
        persisted = json.loads(server.DATA_FILE.read_text(encoding="utf-8"))
        self.assertEqual(list(persisted), ["active-session"])

    async def test_public_demo_requires_join_and_game_credentials_for_session_routes(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_RANKING_FILE = Path(server.__file__).with_name("public-demo-ranking.json")
        session_id = "protected-session"

        opened = await self.client.post(
            "/api/session-open",
            json={"sessionId": session_id, "gameToken": GAME_TOKEN},
        )
        self.assertEqual(opened.status, 200)
        opened_payload = await opened.json()
        join_token = opened_payload["joinToken"]
        control_token = "c" * 64
        self.assertRegex(join_token, r"^[a-f0-9]{64}$")
        self.assertEqual(opened_payload["dataMode"], "synthetic-demo")

        repeated = await self.client.post(
            "/api/session-open",
            json={"sessionId": session_id, "gameToken": GAME_TOKEN},
        )
        self.assertEqual((await repeated.json())["joinToken"], join_token)
        conflict = await self.client.post(
            "/api/session-open",
            json={"sessionId": session_id, "gameToken": WRONG_TOKEN},
        )
        self.assertEqual(conflict.status, 409)

        registration_payload = {
            "sessionId": session_id,
            "playerId": "private-phone",
            "playerName": "VISITOR_NAME",
        }
        missing_join = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
        )
        self.assertEqual(missing_join.status, 403)
        wrong_join = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
            headers={
                server.JOIN_TOKEN_HEADER: WRONG_TOKEN,
                server.PHONE_CONTROL_TOKEN_HEADER: control_token,
            },
        )
        self.assertEqual(wrong_join.status, 403)
        missing_control = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
            headers={server.JOIN_TOKEN_HEADER: join_token},
        )
        self.assertEqual(missing_control.status, 403)
        registered = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
            headers={
                server.JOIN_TOKEN_HEADER: join_token,
                server.PHONE_CONTROL_TOKEN_HEADER: control_token,
            },
        )
        self.assertEqual(registered.status, 200)
        registered_payload = await registered.json()
        self.assertNotIn("sessionReleaseToken", registered_payload)
        self.assertNotIn("phoneControlToken", registered_payload)

        copied_qr_reregistration = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
            headers={
                server.JOIN_TOKEN_HEADER: join_token,
                server.PHONE_CONTROL_TOKEN_HEADER: WRONG_TOKEN,
            },
        )
        self.assertEqual(copied_qr_reregistration.status, 403)
        same_phone_reregistration = await self.client.post(
            "/api/session-entry",
            json=registration_payload,
            headers={
                server.JOIN_TOKEN_HEADER: join_token,
                server.PHONE_CONTROL_TOKEN_HEADER: control_token,
            },
        )
        self.assertEqual(same_phone_reregistration.status, 200)

        entry_url = f"/api/session-entry?sessionId={session_id}"
        self.assertEqual((await self.client.get(entry_url)).status, 403)
        self.assertEqual(
            (
                await self.client.get(
                    entry_url,
                    headers={server.JOIN_TOKEN_HEADER: WRONG_TOKEN},
                )
            ).status,
            403,
        )
        phone_read = await self.client.get(
            entry_url,
            headers={server.JOIN_TOKEN_HEADER: join_token},
        )
        self.assertEqual(phone_read.status, 200)
        game_read = await self.client.get(
            entry_url,
            headers={server.GAME_TOKEN_HEADER: GAME_TOKEN},
        )
        self.assertEqual(game_read.status, 200)

        input_url = f"/api/session-input-check?sessionId={session_id}&ready=1"
        self.assertEqual((await self.client.post(input_url)).status, 403)
        self.assertEqual(
            (
                await self.client.post(
                    input_url,
                    headers={server.JOIN_TOKEN_HEADER: join_token},
                )
            ).status,
            403,
        )
        authorized_input = await self.client.post(
            input_url,
            headers={server.GAME_TOKEN_HEADER: GAME_TOKEN},
        )
        self.assertEqual(authorized_input.status, 200)

        ready_payload = {"sessionId": session_id, "playerId": "private-phone"}
        self.assertEqual(
            (await self.client.post("/api/session-ready", json=ready_payload)).status,
            403,
        )
        join_only_ready = await self.client.post(
            "/api/session-ready",
            json=ready_payload,
            headers={server.JOIN_TOKEN_HEADER: join_token},
        )
        self.assertEqual(join_only_ready.status, 403)
        authorized_ready = await self.client.post(
            "/api/session-ready",
            json=ready_payload,
            headers={
                server.JOIN_TOKEN_HEADER: join_token,
                server.PHONE_CONTROL_TOKEN_HEADER: control_token,
            },
        )
        self.assertEqual(authorized_ready.status, 200)

        with self.assertRaises(WSServerHandshakeError) as missing_ws_token:
            await self.client.ws_connect(
                f"/ws?client=phone&sessionId={session_id}",
            )
        self.assertEqual(missing_ws_token.exception.status, 403)
        with self.assertRaises(WSServerHandshakeError) as wrong_ws_token:
            await self.client.ws_connect(
                f"/ws?client=phone&sessionId={session_id}",
                protocols=[f"{server.PHONE_CONTROL_WS_PREFIX}{WRONG_TOKEN}"],
            )
        self.assertEqual(wrong_ws_token.exception.status, 403)
        with self.assertRaises(WSServerHandshakeError) as join_ws_token:
            await self.client.ws_connect(
                f"/ws?client=phone&sessionId={session_id}",
                protocols=[f"hakkei-phone.{join_token}"],
            )
        self.assertEqual(join_ws_token.exception.status, 403)
        phone_ws = await self.client.ws_connect(
            f"/ws?client=phone&sessionId={session_id}",
            protocols=[f"{server.PHONE_CONTROL_WS_PREFIX}{control_token}"],
        )
        self.assertEqual((await phone_ws.receive_json())["type"], "server.hello")
        snapshot = await phone_ws.receive_json()
        self.assertEqual(snapshot["type"], "session.snapshot")
        self.assertEqual(snapshot["entry"]["playerName"], "VISITOR_NAME")
        self.assertNotIn("phoneControlTokenHash", snapshot["entry"])
        await phone_ws.close()

        persisted = server.DATA_FILE.read_text(encoding="utf-8")
        self.assertNotIn(join_token, persisted)
        self.assertNotIn(control_token, persisted)
        self.assertIn(server.game_token_digest(control_token), persisted)
        self.assertFalse(server.SESSION_EVENT_LOG_FILE.exists())

        copied_release = await self.client.post(
            "/api/session-release",
            json={"sessionId": session_id, "playerId": "private-phone"},
            headers={server.JOIN_TOKEN_HEADER: join_token},
        )
        self.assertEqual(copied_release.status, 403)
        authorized_release = await self.client.post(
            "/api/session-release",
            json={"sessionId": session_id, "playerId": "private-phone"},
            headers={
                server.PHONE_CONTROL_TOKEN_HEADER: control_token,
            },
        )
        self.assertEqual(authorized_release.status, 200)
        self.assertFalse(server.load_entries())
        self.assertFalse(server.SESSION_EVENT_LOG_FILE.exists())

    async def test_public_demo_cleanup_expires_credentials_entries_and_old_qr(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.SESSION_TTL_SECONDS = 60
        current_time = server.now_ms()
        claimed_at = current_time - 60_001
        join_token = "c" * 64
        server.game_session_credentials["old-session"] = (
            server.game_token_digest(GAME_TOKEN),
            claimed_at,
        )
        server.join_session_credentials["old-session"] = (
            server.game_token_digest(join_token),
            claimed_at,
            join_token,
        )
        server.save_entries({
            "old-session": {
                "sessionId": "old-session",
                "playerId": "old-player",
                "playerName": "OLD_NAME",
                "registeredAtMs": current_time,
            },
        })

        expired = await server.purge_public_demo_sessions_once(current_time)
        self.assertIn("old-session", expired)
        self.assertNotIn("old-session", server.game_session_credentials)
        self.assertNotIn("old-session", server.join_session_credentials)
        self.assertNotIn("old-session", server.load_entries(current_time))
        self.assertFalse(server.game_session_authorized("old-session", GAME_TOKEN))
        self.assertFalse(server.join_session_authorized("old-session", join_token))

    async def test_public_demo_unregistered_credentials_expire_after_five_minutes(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.SESSION_TTL_SECONDS = server.PUBLIC_DEMO_DEFAULT_TTL_SECONDS
        current_time = server.now_ms()
        claimed_at = (
            current_time
            - server.PUBLIC_DEMO_UNREGISTERED_CREDENTIAL_TTL_SECONDS * 1000
            - 1
        )
        join_token = "c" * 64
        for session_id in ("unregistered-old", "registered-active"):
            server.game_session_credentials[session_id] = (
                server.game_token_digest(GAME_TOKEN),
                claimed_at,
            )
            server.join_session_credentials[session_id] = (
                server.game_token_digest(join_token),
                claimed_at,
                join_token,
            )
        server.registered_public_demo_sessions.add("registered-active")

        expired = server.purge_session_credentials(current_time)
        self.assertEqual(expired, {"unregistered-old"})
        self.assertNotIn(
            "unregistered-old",
            server.game_session_credentials,
        )
        self.assertFalse(
            server.join_session_authorized(
                "unregistered-old",
                join_token,
            )
        )
        self.assertTrue(
            server.game_session_authorized(
                "registered-active",
                GAME_TOKEN,
            )
        )
        self.assertTrue(
            server.join_session_authorized(
                "registered-active",
                join_token,
            )
        )

    async def test_public_demo_global_open_rate_limit_applies_across_sources(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_OPEN_RATE_LIMIT = 12
        server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT = 6
        server.public_demo_rate_windows.clear()
        server.public_demo_global_open_timestamps.clear()

        for index in range(6):
            response = await self.client.post(
                "/api/session-open",
                json={
                    "sessionId": f"global-rate-{index}",
                    "gameToken": GAME_TOKEN,
                },
                headers={
                    "CF-Connecting-IP": f"198.51.100.{index + 1}",
                },
            )
            self.assertEqual(response.status, 200)
        globally_limited = await self.client.post(
            "/api/session-open",
            json={"sessionId": "global-rate-6", "gameToken": GAME_TOKEN},
            headers={"CF-Connecting-IP": "198.51.100.100"},
        )
        self.assertEqual(globally_limited.status, 429)
        self.assertGreaterEqual(
            int(globally_limited.headers["Retry-After"]),
            1,
        )
        self.assertEqual(
            len(server.public_demo_global_open_timestamps),
            6,
        )

    async def test_public_demo_ipv6_rate_sources_are_grouped_by_64(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_OPEN_RATE_LIMIT = 1
        server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT = 6
        server.public_demo_rate_windows.clear()
        server.public_demo_global_open_timestamps.clear()

        first = await self.client.post(
            "/api/session-open",
            json={"sessionId": "ipv6-1", "gameToken": GAME_TOKEN},
            headers={"CF-Connecting-IP": "2001:db8:1234:5678::1"},
        )
        self.assertEqual(first.status, 200)
        same_64 = await self.client.post(
            "/api/session-open",
            json={"sessionId": "ipv6-2", "gameToken": GAME_TOKEN},
            headers={"CF-Connecting-IP": "2001:db8:1234:5678::abcd"},
        )
        self.assertEqual(same_64.status, 429)
        different_64 = await self.client.post(
            "/api/session-open",
            json={"sessionId": "ipv6-3", "gameToken": GAME_TOKEN},
            headers={"CF-Connecting-IP": "2001:db8:1234:5679::1"},
        )
        self.assertEqual(different_64.status, 200)
        self.assertIn(
            ("session-open", "2001:db8:1234:5678::/64"),
            server.public_demo_rate_windows,
        )
        self.assertIn(
            ("session-open", "2001:db8:1234:5679::/64"),
            server.public_demo_rate_windows,
        )

    async def test_default_ttl_and_global_open_limit_cannot_sustain_full_active_cap(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.SESSION_TTL_SECONDS = server.PUBLIC_DEMO_DEFAULT_TTL_SECONDS
        server.public_demo_global_open_timestamps.clear()
        base_time = 1_000_000
        max_active = 0

        for minute in range(30):
            at_ms = base_time + minute * 60_000
            server.purge_session_credentials(at_ms)
            for request_index in range(
                server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT
            ):
                self.assertIsNone(
                    server.consume_rate_window(
                        server.public_demo_global_open_timestamps,
                        server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT,
                        at_ms,
                    )
                )
                session_id = f"sustained-{minute}-{request_index}"
                join_token = f"{minute * 10 + request_index:064x}"
                server.game_session_credentials[session_id] = (
                    server.game_token_digest(GAME_TOKEN),
                    at_ms,
                )
                server.join_session_credentials[session_id] = (
                    server.game_token_digest(join_token),
                    at_ms,
                    join_token,
                )
                server.registered_public_demo_sessions.add(session_id)
            self.assertIsNotNone(
                server.consume_rate_window(
                    server.public_demo_global_open_timestamps,
                    server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT,
                    at_ms,
                )
            )
            max_active = max(
                max_active,
                len(server.game_session_credentials),
            )

        expected_max = (
            server.PUBLIC_DEMO_GLOBAL_OPEN_RATE_LIMIT
            * server.PUBLIC_DEMO_DEFAULT_TTL_SECONDS
            // server.PUBLIC_DEMO_RATE_WINDOW_SECONDS
        )
        self.assertEqual(max_active, expected_max)
        self.assertLess(
            max_active,
            server.PUBLIC_DEMO_MAX_ACTIVE_SESSIONS,
        )

    async def test_public_demo_active_session_cap_keeps_credentials_and_entries_synchronized(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_MAX_ACTIVE_SESSIONS = 2
        server.SESSION_TTL_SECONDS = 60

        for index in (1, 2):
            session_id = f"bounded-{index}"
            registered = await self.register(
                session_id=session_id,
                player_id=f"phone-{index}",
                player_name=f"PLAYER_{index}",
            )
            self.assertEqual(registered["sessionId"], session_id)

        capped = await self.client.post(
            "/api/session-open",
            json={"sessionId": "bounded-3", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(capped.status, 429)
        self.assertIn("Retry-After", capped.headers)

        idempotent = await self.client.post(
            "/api/session-open",
            json={"sessionId": "bounded-1", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(idempotent.status, 200)
        conflict = await self.client.post(
            "/api/session-open",
            json={"sessionId": "bounded-1", "gameToken": WRONG_TOKEN},
        )
        self.assertEqual(conflict.status, 409)
        self.assertEqual(len(server.game_session_credentials), 2)
        self.assertEqual(len(server.join_session_credentials), 2)
        self.assertEqual(len(server.load_entries()), 2)

        current_time = server.now_ms()
        for session_id, (digest, _) in list(
            server.game_session_credentials.items()
        ):
            server.game_session_credentials[session_id] = (
                digest,
                current_time - 60_001,
            )
        for session_id, (digest, _, raw_token) in list(
            server.join_session_credentials.items()
        ):
            server.join_session_credentials[session_id] = (
                digest,
                current_time - 60_001,
                raw_token,
            )
        expired = await server.purge_public_demo_sessions_once(current_time)
        self.assertEqual(expired, {"bounded-1", "bounded-2"})
        self.assertFalse(server.game_session_credentials)
        self.assertFalse(server.join_session_credentials)
        self.assertFalse(server.load_entries(current_time))

        reopened = await self.client.post(
            "/api/session-open",
            json={"sessionId": "bounded-3", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(reopened.status, 200)

    async def test_public_demo_open_rate_limit_uses_trusted_cloudflare_source(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_OPEN_RATE_LIMIT = 2
        server.PUBLIC_DEMO_RATE_KEY_MAX_COUNT = 2
        server.public_demo_rate_windows.clear()
        source_a = {"CF-Connecting-IP": "203.0.113.10"}
        source_b = {"CF-Connecting-IP": "203.0.113.11"}

        for index in (1, 2):
            response = await self.client.post(
                "/api/session-open",
                json={
                    "sessionId": f"rate-a-{index}",
                    "gameToken": GAME_TOKEN,
                },
                headers=source_a,
            )
            self.assertEqual(response.status, 200)
        limited = await self.client.post(
            "/api/session-open",
            json={"sessionId": "rate-a-3", "gameToken": GAME_TOKEN},
            headers=source_a,
        )
        self.assertEqual(limited.status, 429)
        self.assertGreaterEqual(int(limited.headers["Retry-After"]), 1)

        independent_source = await self.client.post(
            "/api/session-open",
            json={"sessionId": "rate-b-1", "gameToken": GAME_TOKEN},
            headers=source_b,
        )
        self.assertEqual(independent_source.status, 200)
        self.assertIn(
            ("session-open", "203.0.113.10"),
            server.public_demo_rate_windows,
        )
        self.assertIn(
            ("session-open", "203.0.113.11"),
            server.public_demo_rate_windows,
        )
        bounded_source_table = await self.client.post(
            "/api/session-open",
            json={"sessionId": "rate-c-1", "gameToken": GAME_TOKEN},
            headers={"CF-Connecting-IP": "203.0.113.12"},
        )
        self.assertEqual(bounded_source_table.status, 429)
        self.assertEqual(len(server.public_demo_rate_windows), 2)

    async def test_public_demo_websocket_connection_and_message_limits(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_WS_MAX_CONNECTIONS_PER_SESSION = 1
        server.PUBLIC_DEMO_WS_MESSAGE_RATE_LIMIT = 1
        opened = await self.client.post(
            "/api/session-open",
            json={"sessionId": "bounded-ws", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(opened.status, 200)

        ws = await self.client.ws_connect(
            "/ws?client=game&sessionId=bounded-ws",
            protocols=[f"hakkei-game.{GAME_TOKEN}"],
        )
        self.assertEqual((await ws.receive_json())["type"], "server.hello")
        with self.assertRaises(WSServerHandshakeError) as capped:
            await self.client.ws_connect(
                "/ws?client=game&sessionId=bounded-ws",
                protocols=[f"hakkei-game.{GAME_TOKEN}"],
            )
        self.assertEqual(capped.exception.status, 429)

        await ws.send_json({
            "protocolVersion": 1,
            "eventId": "bounded-ws-ping-1",
            "type": "client.ping",
            "sessionId": "bounded-ws",
            "sentAtMs": 1,
            "actor": "game",
        })
        self.assertEqual((await ws.receive_json())["type"], "server.hello")
        await ws.send_json({
            "protocolVersion": 1,
            "eventId": "bounded-ws-ping-2",
            "type": "client.ping",
            "sessionId": "bounded-ws",
            "sentAtMs": 2,
            "actor": "game",
        })
        self.assertEqual((await ws.receive_json())["type"], "server.error")
        await ws.close()
        for _ in range(20):
            if server.active_public_demo_ws_count == 0:
                break
            await asyncio.sleep(0.01)
        self.assertEqual(server.active_public_demo_ws_count, 0)
        self.assertNotIn(
            "bounded-ws",
            server.active_public_demo_ws_by_session,
        )

    async def test_public_demo_configuration_seed_and_runtime_reset_are_fail_closed(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.PUBLIC_DEMO_RANKING_FILE = Path(server.__file__).with_name("public-demo-ranking.json")
        server.validate_runtime_configuration()

        invalid_seed = server.DATA_DIR.parent / "invalid-public-demo-seed.json"
        invalid_seed.write_text(
            json.dumps({"schemaVersion": 1, "players": []}),
            encoding="utf-8",
        )
        server.PUBLIC_DEMO_RANKING_FILE = invalid_seed
        with self.assertRaises(RuntimeError):
            server.validate_runtime_configuration()
        invalid_seed.unlink()

        server.PUBLIC_DEMO_RANKING_FILE = Path(server.__file__).with_name("public-demo-ranking.json")
        server.DATA_DIR = (server.BASE_DIR / "backups" / "public-demo-runtime").resolve()
        with self.assertRaises(RuntimeError):
            server.validate_runtime_configuration()
        server.DATA_DIR = Path(server.BASE_DIR.anchor).resolve()
        with self.assertRaises(RuntimeError):
            server.validate_runtime_configuration()
        server.DATA_DIR = (server.BASE_DIR / "data").resolve()
        with self.assertRaises(RuntimeError):
            server.validate_runtime_configuration()
        server.DATA_DIR = server.PUBLIC_DEMO_RUNTIME_DIR

        server.SESSION_TTL_SECONDS = server.PUBLIC_DEMO_MAX_TTL_SECONDS + 1
        with self.assertRaises(RuntimeError):
            server.validate_runtime_configuration()
        server.SESSION_TTL_SECONDS = 60

        server.save_entries({
            "startup-stale": {
                "sessionId": "startup-stale",
                "playerId": "old-player",
                "playerName": "OLD_NAME",
                "registeredAtMs": server.now_ms(),
            },
        })
        server.DATA_FILE.with_suffix(server.DATA_FILE.suffix + ".tmp").write_text(
            "temporary",
            encoding="utf-8",
        )
        server.reset_public_demo_runtime()
        self.assertFalse(server.DATA_FILE.exists())
        self.assertFalse(
            server.DATA_FILE.with_suffix(server.DATA_FILE.suffix + ".tmp").exists()
        )

    async def test_join_page_consumes_fragment_without_putting_token_in_request_url(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        server.SESSION_TTL_SECONDS = server.PUBLIC_DEMO_DEFAULT_TTL_SECONDS
        response = await self.client.get("/join?sessionId=fragment-session")
        self.assertEqual(response.status, 200)
        html = await response.text()
        self.assertIn("const publicDemoMode = true;", html)
        self.assertIn("セッションデータは最大15分", html)
        self.assertIn("SESSION DATA IS DELETED WITHIN 15 MINUTES.", html)
        self.assertIn(
            "const playerStorage = publicDemoMode ? sessionStorage : localStorage;",
            html,
        )
        self.assertIn("localStorage.removeItem(storageKey);", html)
        self.assertIn("playerStorage.setItem(storageKey", html)
        self.assertNotIn("localStorage.setItem(storageKey", html)
        self.assertIn('new URLSearchParams(location.hash.slice(1))', html)
        self.assertIn('history.replaceState(null, "", location.pathname + location.search)', html)
        self.assertIn('"X-Hakkei-Join-Token"', html)
        self.assertIn("window.crypto.getRandomValues(bytes)", html)
        self.assertIn('"hakkei-session-phone-control-token:" + sessionId', html)
        self.assertIn('"X-Hakkei-Phone-Control-Token"', html)
        self.assertIn('"hakkei-phone-control." + phoneControlToken', html)
        self.assertIn("headers: phoneHeaders(true, true)", html)
        self.assertIn("savePlayer(pendingPlayer);", html)
        self.assertNotIn('searchParams.set("joinToken"', html)
        self.assertNotIn('searchParams.set("phoneControlToken"', html)
        self.assertNotIn('wsUrl.searchParams.set("playerId"', html)

    async def test_equal_scores_are_sorted_by_registration_time_then_name(self) -> None:
        server.save_player_registry({
            "schemaVersion": 1,
            "players": [
                {
                    "playerId": "remote-zed",
                    "nickname": "ZED",
                    "playerNumber": 26001,
                    "registeredAtMs": 100,
                    "lastSeenAtMs": 10,
                },
                {
                    "playerId": "remote-beta",
                    "nickname": "BETA",
                    "playerNumber": 26002,
                    "registeredAtMs": 200,
                    "lastSeenAtMs": 20,
                },
                {
                    "playerId": "remote-alpha",
                    "nickname": "ALPHA",
                    "playerNumber": 26003,
                    "registeredAtMs": 200,
                    "lastSeenAtMs": 30,
                },
            ],
        })
        server.save_ranking_board({
            "schemaVersion": 1,
            "players": [
                {
                    "playerId": "remote-beta",
                    "nickname": "BETA",
                    "registeredAtMs": 200,
                    "lastPlayedAtMs": 20,
                    "highScore": 5000,
                    "playCount": 1,
                },
                {
                    "playerId": "remote-alpha",
                    "nickname": "ALPHA",
                    "registeredAtMs": 200,
                    "lastPlayedAtMs": 30,
                    "highScore": 5000,
                    "playCount": 1,
                },
                {
                    "playerId": "remote-zed",
                    "nickname": "ZED",
                    "registeredAtMs": 100,
                    "lastPlayedAtMs": 10,
                    "highScore": 5000,
                    "playCount": 1,
                },
            ],
            "records": [],
        })

        response = await self.client.get("/api/ranking-board")
        self.assertEqual(response.status, 200)
        payload = await response.json()
        self.assertEqual(
            [player["nickname"] for player in payload["players"]],
            ["ZED", "ALPHA", "BETA"],
        )

    async def test_game_websocket_requires_token_and_cannot_submit_results(self) -> None:
        with self.assertRaises(WSServerHandshakeError) as denied:
            await self.client.ws_connect("/ws?client=game&sessionId=ws-session")
        self.assertEqual(denied.exception.status, 403)

        opened = await self.client.post(
            "/api/session-open",
            json={"sessionId": "ws-session", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(opened.status, 200)
        ws = await self.client.ws_connect(
            "/ws?client=game&sessionId=ws-session",
            protocols=[f"hakkei-game.{GAME_TOKEN}"],
        )
        hello = await ws.receive_json()
        self.assertEqual(hello["type"], "server.hello")
        await ws.send_json({
            "protocolVersion": 1,
            "eventId": "test-game-result",
            "type": "game.result",
            "sessionId": "ws-session",
            "sentAtMs": 1,
            "actor": "game",
        })
        rejected = await ws.receive_json()
        self.assertEqual(rejected["type"], "server.error")
        self.assertIn("authenticated HTTP", rejected["message"])
        await ws.close()


class ThreadedHandlerParityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.original_paths = (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.ADMIN_TOKEN_FILE,
            server.ADMIN_TOKEN,
            server.PUBLIC_DEMO_MODE,
            server.PUBLIC_DEMO_RANKING_FILE,
            server.SESSION_TTL_SECONDS,
        )
        server.DATA_DIR = data_dir
        server.DATA_FILE = data_dir / "session-entries.json"
        server.SESSION_EVENT_LOG_FILE = data_dir / "session-events.log"
        server.RANKING_FILE = data_dir / "ranking-board.json"
        server.PLAYERS_FILE = data_dir / "players.json"
        server.ADMIN_TOKEN_FILE = data_dir / ".admin-token"
        server.ADMIN_TOKEN = "test-admin-token"
        server.PUBLIC_DEMO_MODE = False
        server.SESSION_TTL_SECONDS = 4 * 60 * 60
        server.game_session_credentials.clear()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        (
            server.DATA_DIR,
            server.DATA_FILE,
            server.SESSION_EVENT_LOG_FILE,
            server.RANKING_FILE,
            server.PLAYERS_FILE,
            server.ADMIN_TOKEN_FILE,
            server.ADMIN_TOKEN,
            server.PUBLIC_DEMO_MODE,
            server.PUBLIC_DEMO_RANKING_FILE,
            server.SESSION_TTL_SECONDS,
        ) = self.original_paths
        self.temp_dir.cleanup()

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, object] | None = None,
        token: str | None = None,
    ) -> tuple[int, dict[str, object]]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_threaded_handler_fails_closed_in_public_demo_mode(self) -> None:
        server.PUBLIC_DEMO_MODE = True
        status, payload = self.request("/")
        self.assertEqual(status, 503)
        self.assertIn("aiohttp", str(payload))

    def test_threaded_handler_matches_security_and_idempotency_policy(self) -> None:
        status, _ = self.request(
            "/api/session-open",
            method="POST",
            payload={"sessionId": "thread-session", "gameToken": GAME_TOKEN},
        )
        self.assertEqual(status, 200)
        status, registration = self.request(
            "/api/session-entry",
            method="POST",
            payload={"sessionId": "thread-session", "playerId": "phone-1", "playerName": "ALICE"},
        )
        self.assertEqual(status, 200)
        release_token = registration["sessionReleaseToken"]

        self.assertEqual(self.request("/api/session-entries")[0], 403)
        self.assertEqual(self.request("/api/players")[0], 403)
        self.assertEqual(self.request("/api/session-entries", token="test-admin-token")[0], 200)
        self.assertEqual(self.request("/api/session-entry?sessionId=thread-session", method="DELETE")[0], 403)

        suggestions_status, suggestions = self.request("/api/player-suggestions")
        self.assertEqual(suggestions_status, 200)
        self.assertEqual(len(suggestions["players"]), 1)
        self.assertEqual(suggestions["players"][0]["nickname"], "ALICE")
        self.assertIsNone(suggestions["players"][0]["lastPlayedAtMs"])
        self.assertNotIn("playerId", str(suggestions))
        self.assertNotIn("sessionId", str(suggestions))

        ranking_payload = {
            "sessionId": "thread-session",
            "gameToken": GAME_TOKEN,
            "player": {"playerId": "remote-phone-1", "nickname": "ALICE", "registeredAtMs": 1},
            "record": {
                "score": 1234,
                "damageYen": 5678,
                "rank": "A",
                "videoLevel": 3,
                "playedAtMs": 1,
            },
        }
        self.assertEqual(
            self.request(
                "/api/ranking-score",
                method="POST",
                payload={**ranking_payload, "gameToken": "b" * 64},
            )[0],
            403,
        )
        mismatched_payload = {
            **ranking_payload,
            "player": {**ranking_payload["player"], "playerId": "remote-phone-2"},
        }
        self.assertEqual(
            self.request("/api/ranking-score", method="POST", payload=mismatched_payload)[0],
            409,
        )

        first_status, first_board = self.request("/api/ranking-score", method="POST", payload=ranking_payload)
        second_status, second_board = self.request("/api/ranking-score", method="POST", payload=ranking_payload)
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(first_board, second_board)
        self.assertEqual(first_board["players"][0]["playCount"], 1)
        self.assertIsInstance(first_board["players"][0]["registeredAtMs"], int)
        self.assertEqual(first_board["players"][0]["lastPlayedAtMs"], 1)
        self.assertNotIn("records", first_board)
        entry_status, entry_before_result = self.request(
            "/api/session-entry?sessionId=thread-session",
        )
        self.assertEqual(entry_status, 200)
        self.assertNotIn("resultAtMs", entry_before_result)

        result_payload = {
            "sessionId": "thread-session",
            "gameToken": GAME_TOKEN,
            "playerId": "phone-1",
            "score": 1234,
            "damageYen": 5678,
            "damageYenText": "5,678",
            "rank": "A",
            "videoLevel": 3,
            "playedAtMs": 1,
        }
        self.assertEqual(
            self.request(
                "/api/session-result",
                method="POST",
                payload={**result_payload, "gameToken": "b" * 64},
            )[0],
            403,
        )
        self.assertEqual(self.request("/api/session-result", method="POST", payload=result_payload)[0], 200)
        self.assertEqual(
            self.request("/api/ranking-score", method="POST", payload=ranking_payload)[1]["players"][0]["playCount"],
            1,
        )
        self.assertEqual(len(server.load_ranking_board()["records"]), 1)

        second_play_payload = {
            **ranking_payload,
            "record": {**ranking_payload["record"], "playedAtMs": 2},
        }
        second_play_status, second_play_board = self.request(
            "/api/ranking-score",
            method="POST",
            payload=second_play_payload,
        )
        repeated_second_status, repeated_second_board = self.request(
            "/api/ranking-score",
            method="POST",
            payload=second_play_payload,
        )
        self.assertEqual((second_play_status, repeated_second_status), (200, 200))
        self.assertEqual(second_play_board["players"][0]["playCount"], 2)
        self.assertEqual(repeated_second_board["players"][0]["playCount"], 2)
        second_result_payload = {**result_payload, "playedAtMs": 2}
        self.assertEqual(
            self.request(
                "/api/session-result",
                method="POST",
                payload=second_result_payload,
            )[0],
            200,
        )
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)

        public_status, public_board = self.request("/api/ranking-board")
        self.assertEqual(public_status, 200)
        public_serialized = str(public_board)
        self.assertIn("registeredAtMs", public_serialized)
        self.assertIn("lastPlayedAtMs", public_serialized)
        for private_field in ("playerId", "records", "recordId", "playedAtMs", "damageYen"):
            self.assertNotIn(private_field, public_serialized)

        self.assertEqual(
            self.request(
                "/api/session-release",
                method="POST",
                payload={
                    "sessionId": "thread-session",
                    "playerId": "phone-1",
                    "sessionReleaseToken": "b" * 64,
                },
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "/api/session-release",
                method="POST",
                payload={
                    "sessionId": "thread-session",
                    "playerId": "phone-1",
                    "sessionReleaseToken": release_token,
                },
            )[0],
            200,
        )
        self.assertEqual(self.request("/api/session-entry?sessionId=thread-session")[0], 404)
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)

        reregister_status, reregistered = self.request(
            "/api/session-entry",
            method="POST",
            payload={"sessionId": "thread-session", "playerId": "phone-2", "playerName": "BOB"},
        )
        self.assertEqual(reregister_status, 200)
        self.assertEqual(reregistered["playerName"], "BOB")
        self.assertEqual(len(server.load_ranking_board()["records"]), 2)


if __name__ == "__main__":
    unittest.main()
