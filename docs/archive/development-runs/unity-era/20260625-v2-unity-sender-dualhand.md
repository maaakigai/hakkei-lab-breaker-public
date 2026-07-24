# Run: 両手v2 — Unity sender v2化（実機で両手 packet を送る）

実施: claude（直接実装） / 2026-06-25
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P3a(f49c478)・P3b(ce01d62)

## なぜ（背景）
両手v2の **Electron 側コード実装（チャージ両手化 P3a・両手パンチ P3b）は完成・全緑**。
キーボードでは両手完走できるが、**実機 mocopi では Unity Bridge が v1（rightHand のみ）packet しか送らない**ため、
Electron 側で `sample.leftHand` が常に null → `DualHakkeiDetector` が左手を待ち続けて発勁が成立しない。
よって「実機で両手が動く」本命の不足は P3c の rename ではなく **Unity C# sender の v2化**。
ユーザー判断（2026-06-25）でこれを最優先。

## やったこと
1. `unity-bridge/Assets/Scripts/RightHandUdpSender.cs` を v2 送信化。
   - `Animator.GetBoneTransform(HumanBodyBones.LeftHand)` で左手 Transform を取得（右手と対称・Bone直参照しない）。
   - motion packet に `leftHand`（tracked かつ左手取得時のみ座標、それ以外 null）と `avatar.hasLeftHand` を追加。
   - heartbeat に `leftHandReady` を追加。
   - `AppendCommon` の `protocolVersion` を 1 → 2。
   - `leftTracked = isTracked && LeftHandReady`。null 表現・有無判定は rightHand と完全対称
     （Electron `packetValidator` v2 の `leftAvailable = isTracked && isHuman && hasLeftHand` 契約に一致）。
   - **クラス名／ファイル名は据え置き**（rename すると Scene のコンポーネント参照 GUID が外れるため）。
     LeftHand は Humanoid Avatar に既にあるので **Scene 再配線は不要**。
2. `unity-bridge/Assets/Scripts/BridgeStatusView.cs` に LeftHand の OK/NG と座標表示を追加
   （実機 InputCheck で左手トラッキングを目視確認できるように）。
3. `test/unity-bridge-contract.test.mjs` の golden 文字列を v2 出力へ更新（バイト単位で C# の Append 順を再現）。
   - tracked 両手 / unavailable 両手 null / **右手のみ tracked・左手欠損** / heartbeat(leftHandReady) を検証。
   - これにより C# の v2 出力が `packetValidator` を通ることを TS 側で回帰ロック（契約ドリフト検知）。

## 検証
- `npm run typecheck && lint && test && build` 全緑（**test 117 pass**・新規 +1）。
- C# はテスト対象外だが、契約テストの golden 文字列が C# の実出力をバイト再現しているため、
  C# のフォーマットを変えれば落ちる。

## 残り（次の一手）
- **Electron v2必須化**：`packetValidator` で protocolVersion=1 を `UNSUPPORTED_PROTOCOL_VERSION` 拒否
  ＋ `mock:unity` の既定を v2 化 ＋ 関連テスト更新。**Unity が v2 を送る今なら順序的に安全**。
- 静止誤検出テスト nit：`staticHakkeiTest` を `DualHakkeiDetector` へ寄せ＋コメント修正（P3b レビュー指摘）。
- P5 実機検証（このデスクトップで mocopi 両手：Calibration→右手/左手チャージ→両手パンチ→Result）。
- P3c phase 名 rename（VerticalCharge→RightCharge 等・cosmetic・後回し）。

## 続き（同日）: v2必須化 ＋ 静止テスト nit
Unity sender を v2化（実機が v2 を送る）した直後に enforce する正しい順序で実施。
1. **packetValidator v2必須化**：base 検証で `protocolVersion===1` を `UNSUPPORTED_PROTOCOL_VERSION` で明示拒否
   （メッセージ「Unity を再ビルドしてください」）。v2 以外は従来どおり INVALID_PACKET_BASE。
   validateMotion/Heartbeat の `protocolVersion===2` 条件分岐は常時真になったため簡素化（hasLeftHand/leftHand/leftHandReady は無条件必須）。
   ValidationResult を V2 のみへ narrow し、V1 型 import を削除。**v2 は config トグルではなく契約として無条件拒否**（v1 は永続的に dead。実機は Unity 再ビルドで必ず v2）。
2. **mock 既定 v2**：`scripts/mock-unity.mjs` の既定を v2 に。`--v1` で旧 v1（拒否される）を送れる（拒否確認用）。
3. **テスト移行**：`packet-validator.test.mjs` の baseline を v2 化＋「protocolVersion=1 は UNSUPPORTED_PROTOCOL_VERSION」を追加（旧「v1 remains valid」は反転削除）。
   `udp-receiver.test.mjs` の motion()/heartbeat を v2 化。`mock-unity-calib-profile`/`static-hakkei`/`motion-sample-builder` は **builder 直叩き**で validator を経由しないため v1 のまま（builder の v1 後方互換は維持）。
4. **静止テスト nit（P3b レビュー指摘）**：`staticHakkeiTest.ts` のヘッダコメントを正確化。
   単手（右手）ハーネスは両手 AND・同期より厳しい下限であり production gate として保守的に妥当、という安全根拠を明文化（コード/挙動は変えない）。

検証: typecheck/lint/test/build 全緑・**test 117 pass**。キーボード予備入力は validator を通らないため不変（Title→Result 完走維持）。

## 実機での確認手順（ノート）
1. Unity Hub で `unity-bridge/` を開き、Scene `UnityBridge.unity` を再生。
2. mocopi PC アプリを起動・キャリブ → Unity の BridgeStatusView で **RightHand / LeftHand 両方 OK** を確認。
3. `npm run build` 済みの Electron を `npm run dev` で起動 → InputCheck が Unity 入力 OK（両手 ready）になることを確認。
4. もし旧 Unity ビルド（v1）を起動していると Electron は `UNSUPPORTED_PROTOCOL_VERSION` を出す → Unity を再ビルドすればよい。
