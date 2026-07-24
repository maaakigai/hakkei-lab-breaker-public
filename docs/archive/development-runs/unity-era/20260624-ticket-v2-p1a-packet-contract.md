# Ticket: 両手v2 P1a — packet 契約の土台（後方互換・green維持）

担当: codex / 起票: claude / 2026-06-24
親設計: docs/runs/20260624-design-dualhand-v2.md（両手入力v2 設計ロック）

## このチャンクの方針
v2 packet の**型と validator の土台だけ**を追加する。**後方互換**を保ち（v1 packet も当面 valid）、
既存テストを壊さず green を維持する。**「v2必須・v1拒否」の強制は後段（P1c：消費側を両手化してから）**。
このチャンクでは builder / filter / receiver / mock / score / calibration は**触らない**。

## 現状（参照）
- 型: `src/shared/types.ts` の `UnityMotionPacketV1`(L94 付近: protocolVersion:1, rightHand?, avatar.{isHuman,hasRightHand,forward?})、
  `UnityHeartbeatPacketV1`(L110: + rightHandReady)、`AppErrorCode`(L155)。
- validator: `src/main/packetValidator.ts`（protocolVersion!==1 を INVALID_PACKET_BASE で弾く・motion は available 時 rightHand 必須）。

## タスク
1. `types.ts`:
   - `UnityMotionPacketV2` を追加: `protocolVersion: 2`、`rightHand?: Vec3|null`、`leftHand?: Vec3|null`、
     `avatar.{ isHuman, hasRightHand, hasLeftHand, forward? }`。他 base(seq/timestampMs/source/sessionId/isTracked)は v1 同様。
   - `UnityHeartbeatPacketV2` を追加: v1 に `leftHandReady: boolean` を加える。
   - `AppErrorCode` に `"UNSUPPORTED_PROTOCOL_VERSION"` を追加（このチャンクでは未使用でよい・後段で使用）。
   - v1 型は残す（後方互換）。
2. `packetValidator.ts`:
   - `protocolVersion` は **1 も 2 も受理**（それ以外は従来通り弾く）。
   - v2 motion: rightHand に加え **leftHand を同条件で検証**（`available = isTracked && avatar.isHuman && avatar.hasXxxHand` で、
     available な手は座標必須・有限。available でなければ null/省略可）。`avatar.hasLeftHand` は boolean 必須（v2 のとき）。
   - v2 heartbeat: `leftHandReady` boolean 必須（v2 のとき）。
   - v1 は**現状のまま valid**（rightHand のみ・hasLeftHand/leftHand を要求しない）。
   - 戻り値型 `ValidationResult` は v1/v2 両対応に（`UnityMotionPacketV1 | UnityMotionPacketV2` 等）。
3. `SPEC.md` §7 に **v2 packet 節**を追記: v2 motion/heartbeat の形状、両手必須の意図、
   **移行方針（当面 v1 も受理、消費側を両手化後に v2 必須へ＝P1c で `UNSUPPORTED_PROTOCOL_VERSION` 強制）**を明記。
4. テスト `test/packet-validator.test.mjs`（＋必要なら `unity-bridge-contract.test.mjs`）:
   - v2 motion（両手 available）valid。
   - v2 で available なのに leftHand 欠損 → `INVALID_MOTION_PACKET`。
   - v2 heartbeat で `leftHandReady` 欠如 → `INVALID_HEARTBEAT_PACKET`。
   - **v1 motion/heartbeat は引き続き valid（回帰）**。

## 不変ルール
- v1 経路・既存テストを壊さない（**全 green 維持**）。このチャンクで builder/filter/receiver/mock を変更しない。
- TS3規約（`import type` / constructor 省略記法・enum 禁止 / 相対 import は `.ts`）。
- commit/push しない（区切りは claude が管理）。

## 検証 / 報告
- `npm run typecheck && npm run lint && npm test && npm run build` 全緑。
- 完了後、変更ファイル/テスト結果(pass数)/設計判断/残TODO を **agmsg（ファイル経由送信 "$(cat file)"）**で報告。
- **詰まったら停滞せず即 agmsg で相談**してください（巻き取り判断します）。
