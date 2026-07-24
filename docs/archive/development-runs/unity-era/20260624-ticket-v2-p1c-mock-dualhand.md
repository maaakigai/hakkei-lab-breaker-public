# Ticket: 両手v2 P1c — mock の両手化（v2 送信）

担当: codex / 起票: claude / 2026-06-24
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P1a(16cf927) packet契約・P1b(e629fbb) MotionSample両手

## 方針（重要・スコープ見直し）
**「v2必須化（v1拒否）」はこのチャンクではやらない。** 実 Unity Bridge（RightHandUdpSender.cs）はまだ v1 送信のため、
今 enforce すると実機入力が弾かれる。enforcement は **Unity C# sender の v2 化＋score の両手消費が済んだ後段**へ。
P1c は **mock を v2（両手）で送れるようにする**だけ。v1 受理は維持し、green を保つ。

## ゴール
`mock:unity`（既定）と `mock:unity:calib` が **protocolVersion 2 の両手 packet** を送れるようにし、
実機なしで「左手データ込みの MotionSample」をパイプラインに流せるようにする（P2/P3 の検証用土台）。

## 現状
- `scripts/mock-unity.mjs`: 既定 mock は v1 motion（protocolVersion:1, rightHand, avatar.{isHuman,hasRightHand,forward}）＋heartbeat（rightHandReady）。`--calib` は `mock-unity-calib-profile.mjs` の右手位置プロファイル。
- `scripts/mock-unity-calib-profile.mjs`: 右手の位置プロファイル（neutral/forward/上下/前後/発勁pulse）を返す純関数。
- P1a で validator は v2 受理可、P1b で builder は v2 の leftHand から左手 MotionSample を生成可。

## タスク
1. `scripts/mock-unity.mjs`:
   - **v2 packet を送るモードを追加**（フラグ例 `--v2`、または既定を v2 化）。v2 motion = `protocolVersion:2`、`rightHand`、`leftHand`、
     `avatar.{isHuman,hasRightHand,hasLeftHand,forward}`。heartbeat = `protocolVersion:2`＋`leftHandReady`。
   - **v1 送信モードも残す**（後方互換確認・実機 Unity がまだ v1 のため）。どちらを既定にするかは明記（推奨: `--v1`/`--v2` で選択、既定は当面 v1 のままでも可）。
   - 既存 `--bad` と通常動作を壊さない。
2. `scripts/mock-unity-calib-profile.mjs`（または mock 側）:
   - **左手の位置も生成**（v2 時）。最小は「右手をミラーした左手」か、左右別プロファイル。P3 の両手チャージ/両手パンチ検証に使えるよう、
     左手も neutral→forward→上下→前後→発勁pulse を出す（右手と同様の作りで可）。設計判断は記録。
   - 純関数のテスト容易性は P1b 同様に保つ。
3. テスト:
   - mock 由来の **v2 packet が validator を通り、builder で MotionSample.leftHand が生成される**ことを確認（実 UDP 不要の単体で可。既存の calib-profile テストに準じる）。
   - 既存の v1 mock 経路テストは維持（回帰）。
4. **触らない**: validator の enforcement（v1拒否はしない）、renderer/score/calibration、Unity C#、SPEC の score 章。

## 不変ルール
- v1 受理・既存テストを壊さず全 green 維持。v2必須化は後段。
- mock は位置と heartbeat の UDP を出すだけ（velocity/accel/validity は Main 生成・AGENTS §6）。
- TS/JS 規約は既存 `.mjs` に合わせる。commit/push しない。

## 検証 / 報告
- `npm run typecheck && npm run lint && npm test && npm run build` 全緑。
- 手動（任意・分類器/実機不要）: `node scripts/mock-unity.mjs --v2 --port 45101` 等で v2 送信を数秒確認、日誌に記録。
- 報告は **agmsg のファイル経由送信**で（変更ファイル/テスト結果/設計判断/残TODO）。詰まったら即相談。
