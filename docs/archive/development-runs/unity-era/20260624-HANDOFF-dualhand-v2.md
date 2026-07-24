# HANDOFF: 両手入力 v2（チャット切替・復旧後の継続用）

最終更新: 2026-06-25 / 作成: claude（agmsg 連携セッション）
**新しいセッション（チャット切替）はまずこれを読む。** 併せて docs/runs/20260624-design-dualhand-v2.md（設計ロック）と MEMORY.md。

> 後日注記: 本文の「claude＝ブレイン／codex＝実装」は、この作業時点におけるAIエージェント間の分担を示します。プロジェクト全体では、人間2名が共同で課題設定、AI案の採否・修正・棄却、追加指示、受入・リリース判断、展示運用を担当しました。全体像は[`docs/DEVELOPMENT_PROCESS.md`](../../../DEVELOPMENT_PROCESS.md)を参照してください。以下の履歴本文は当時の記録として保持しています。

## 0. いま何をしているか（目的）
発勁ラボブレイカーを **両手入力 v2**（右手の変位 / 左手の変位 / 両手のパンチ）へ作り変える。
- 体制: **claude=ブレイン（要件定義・指示・検証・コミット）／codex=実装**、agmsg(team=hakkei) で連携。
- 設計は確定ロック済み → docs/runs/20260624-design-dualhand-v2.md。

## 1. 進捗（コミット済み = done）
- 環境構築・M11完遂・prep（3秒構え）・pre-commit フック … すべて完了済み。
- **P1a** packet v2契約の土台 = `16cf927` / **P1b** MotionSample 両手＋builder/filter 左右独立 = `e629fbb`
- **P1c** mock 両手化（`--v2`）= `e8f5759`
- **P2** Calibration 両手化（左右 neutral・共通 forward）= `26181fa`
- **P3a** チャージ両手化（右手/左手 Σ|Δp|・rightChargeRaw/leftChargeRaw）= `f49c478`
- **P3b** 両手パンチ（DualHakkeiDetector・同期window・平均スコア・keyboard両手Enter）= `ce01d62`（sonnet サブエージェント PASS-WITH-NITS）
- **Unity sender v2化**（RightHandUdpSender.cs を protocolVersion 2・leftHand/hasLeftHand/leftHandReady）= `57df1a8`
- **v2必須化＋静止テスト nit**（packetValidator が v1 を UNSUPPORTED_PROTOCOL_VERSION 拒否・mock 既定 v2・staticHakkeiTest コメント正確化）= 本コミット
  → **両手v2 のコード実装は完成。test 117 pass・typecheck/lint/build 緑。**

## 2. v2 ロードマップ（残り）
- **P5 実機検証**（このデスクトップで mocopi 両手）= 次の一手。手順は下記＆ docs/runs/20260625-v2-unity-sender-dualhand.md。
  1. Unity Hub で `unity-bridge/` を開き Scene `UnityBridge.unity` を再生 → BridgeStatusView で **RightHand/LeftHand 両方 OK**。
  2. `npm run build` 済み Electron を `npm run dev` 起動 → InputCheck が Unity 入力 OK → Calibration（左右 neutral・共通 forward）→ 右手チャージ→左手チャージ→**両手同期パンチ**→Result まで通す。
  3. 実機 mocopi の閾値（score.config.json hakkei・normalization rightCharge/leftCharge・dualHakkeiSyncWindowMs）を実測でチューニング。
- **P3c**（cosmetic・後回し可）phase 名 rename：VerticalCharge→RightCharge / ForwardPrep→LeftPrep / ForwardCharge→LeftCharge / HakkeiPrep→DualHakkeiPrep / HakkeiReady→DualHakkei（states/events/timers/CSS/UI/SPEC/tests 横断）。挙動不変。
- **P5 UX 補強（任意）**：heartbeat.leftHandReady を内部 payload→InputCheck の両手 ready ゲートへ反映（今は rightHandReady のみ）。受信側 `unityBridgeUdpReceiver.ts` の onHeartbeat 周辺。

各チャンクは「green 維持 → claude＋サブエージェントで検証 → 全緑 clean checkpoint で commit → 次」。

## 3. agmsg 正しい運用（重要・今回の反省）
**意図 = ハンズフリー（人間はコピペ係にならない）。ユーザーは Claude(これ) だけ操作し、Codex は agmsg で自律連携。**
- **claude = monitor モード**（リアルタイム・自動ターン化）。SessionStart hook が watch.sh を起動。新セッションでは resume ディレクティブに従い Monitor ツールを再起動する。
- **codex = turn モード（2026-06-24 確定）**。codex monitor(beta) は **Windows+Git Bash パスのバグ**で使えないため断念：`codex-bridge.js:118` が `path.resolve('/c/Users/...')` を `C:\c\Users\...`（余計な \c\）に壊し、`identities.sh` 照合が 0件→`"no matching codex identity"` 無限ループ。`--team/--name` 明示でも不可（resolve 前に壊れるため）。→ patch しない限り直らず、得は「1キー削減」だけなので不採用。
- **確定運用（二人三脚・コピペ係にならない）**: 私(claude)=完全自律(monitor)。私が agmsg で codex に投げる → **ユーザーは codex で `$agmsg` を1回打つ(1キー pull)** → full-access なら自動実装→ファイル経由送信で報告 → 私が monitor で自動受信して検証・コミット。
- 注意: `delivery.sh set <mode> codex ...` は**既存の watch.sh を全部 kill する**（claude の monitor も巻き込む）。codex モード変更後は claude の Monitor を再起動すること。
- **落とし穴（厳守）**:
  - claude から **codex の inbox を `inbox.sh hakkei codex` で見ない**（既読化して codex に届かなくなる）。送信確認は `history.sh`。
  - codex の送信は**ファイル経由必須**（`printf '%s' "本文" > /tmp/x.txt; send.sh hakkei codex claude "$(cat /tmp/x.txt)"`）。直書きは半角スペースで切れる。
- 環境: `~/.bashrc` にエージェント用PATHとローカル実行ファイルのパスを設定。codexはVS Code統合ターミナル（Git Bash）でshim経由で起動。
- codex permission: `~/.codex/config.toml` トップレベルに `approval_policy="never"` / `sandbox_mode="danger-full-access"` を入れて固定する（未設定だと再起動で workspace に戻る）。※ユーザー確認の上。

## 4. いまのブロッカー
- **なし**（API 過負荷は回復済み）。両手v2 のコード実装は完了し、次は P5 実機検証（mocopi 実機作業）。
- ~~codex monitor bridge~~ → **解決済み（codex=turn 採用・bridge は使わない）**。§3 参照。
- 運用メモ: Unity sender v2化・v2必須化は **claude が直接実装**した（critical path の TS/C# で claude が全緑検証でき、codex→claude の agmsg 報告が不調なため）。codex 連携は P3c 等の機械的横断作業に向く。

## 5. 通常運用（チャンクの回し方）
1. claude は monitor（resume ディレクティブで watch.sh 起動済み）。
2. **P1c は commit 済み（e8f5759）。** 以降の各チャンクも全緑の区切りで commit。
3. **P2 以降の出し方**: 私が P2 ticket を `send.sh hakkei claude codex "$(cat 一時file)"` で codex に投げる → **ユーザーが codex で `$agmsg` を1回** → codex が ticket を読んで実装→ファイル経由送信で報告 → 私が monitor で受信して検証（必要なら軽量モデルのサブエージェント）→ 全緑で commit → 次。
4. P2→P3→P4→P5、最後に v2必須化＋Unity C# sender v2化。

### P1c コミット文面
```
両手v2 P1c: mock の両手化（--v2 で v2 両手 packet 送信）

- scripts/mock-unity.mjs: --v2 で protocolVersion 2 の両手 motion（rightHand+leftHand+avatar.hasLeftHand）＋leftHandReady heartbeat。既定 v1 維持。calib は両手プロファイル送信。
- scripts/mock-unity-calib-profile.mjs: sampleHandsAt（右手＋ミラー左手）追加。
- test: v2 両手 mock 検証（計107 pass）。v2必須化は後段。validator/builder/filter/renderer/score 未変更。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## 6. コミット運用（事故防止）
- **共有作業ツリー**。codex 編集中にコミットすると未完成分を巻き込む（過去に "M11完了" が prep 途中を巻き込んだ）。**全緑の区切りでのみコミット**。
- pre-commit フック（.git/hooks/pre-commit）が typecheck+test を強制し赤コミットをブロック。
- main 直コミット運用（既存フロー踏襲）。push はしていない。
