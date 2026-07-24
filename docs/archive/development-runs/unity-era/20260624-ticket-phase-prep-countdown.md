# Ticket: 各アクション前の3秒「構え」猶予（上下／前後／突き）

担当: codex / 起票: claude（agmsg連携）/ 2026-06-24
由来: 実機 M11-12 プレイ時のユーザー要望「上下に振る・前後に振る・突き、それぞれの行動の前に3秒ほど猶予がほしい」。

## ゴール
**VerticalCharge / ForwardCharge / HakkeiReady の各フェーズ開始前に、約3秒の「構え」カウントダウン**を入れる。
猶予中はそのフェーズの採点・検出を行わず、本処理は猶予明けから始める。既存の Calibration 構え猶予
（`calibrationPrepMs` / `calibPrepDeadlineMs`）と同じ前例パターンに倣う。

## 現状
- フロー: … → Calibration → Ready（`readyCountdownMs` カウントダウン）→ VerticalCharge(`verticalChargeMs`)
  → ForwardCharge(`forwardChargeMs`) → HakkeiReady(`hakkeiReadyTimeoutMs`) → …
- Calibration には既に構え猶予 `app.timers.calibrationPrepMs`(=3000) が `app.ts` の `calibPrepDeadlineMs` で実装済み
  （日誌 20260623-m10-realdevice.md 参照。表示「構えてください（あと N 秒）」、締切到達で計測開始）。
- 各フェーズの指示文は入力モード別に出し分け済み（① 上下/② 前後/③ 突き）。

## 要件
1. **config 追加**: `app.config.json` の `timers` に `chargePrepMs`（既定 3000ms）。`configTypes.ts` / `appConfig.ts`(validateApp)
   にも型・検証を追加（負値・非有限不可）。**ハードコード禁止**。
2. **VerticalCharge / ForwardCharge / HakkeiReady の各突入時に `chargePrepMs` の構え猶予**を設ける。猶予中:
   - チャージ積算をしない（`accumulateCharge` を呼ばない）／発勁検出をしない（`detector.observe` を呼ばない）。
   - そのフェーズの本タイマー（`verticalChargeMs`/`forwardChargeMs`/`hakkeiReadyTimeoutMs`）は**猶予明けから**開始する
     （猶予分を本時間に含めない）。
   - 表示: 「構えて… あと N 秒」＋次アクション（① 上下／② 前後／③ 突き）を入力モード別文言で（既存 UX 文言に合わせる）。
   - 猶予明けに **baseline をリセット**（チャージは `play.prevPos=null` 相当で猶予中の動きを積算に混ぜない／
     HakkeiReady は `detector.reset()` で window/cooldown をクリア）してから本処理開始。
3. **Ready との二重待ち回避**: VerticalCharge の前には既に Ready(`readyCountdownMs`) のカウントダウンがある。
   Vertical 前で「Ready + 3秒猶予」の二重待ちにならないよう調整する（例: Ready を Vertical の構え猶予に統合する、
   または Vertical だけ Ready を構え猶予として扱う）。**Forward と Hakkei の前には新規に3秒猶予を追加**。
   どう統合したかを SPEC と日誌に明記。
4. **キーボード経路でも同様に猶予を入れる**（mocopi/keyboard で一貫）。Space連打チャージ＋Enter発射の予備経路を壊さない。

## 不変ルール
- 採点・検出ロジック自体（複合発勁・変位積分・閾値）は変更しない。猶予は「いつ採点を始めるか」の制御だけ。
- `MotionSample`・速度・加速度・filter・validity は Main 生成（AGENTS §6）。Renderer 再計算しない。
- TS3規約（`import type` / `constructor`省略記法・`enum` 禁止 / 相対 import は `.ts`）。
- **状態遷移を変えるので SPEC・stateMachine・テストを同時更新（AGENTS §7）**。SPEC §11（状態表/タイマー）と
  §14 周辺の該当記述、`config/*.json` 例とスキーマを揃える（§1.1 の config 同時更新契約）。

## テスト（`test/` / node --test）
- 猶予中は積算・検出が起きない（猶予中 sample を与えても verticalRaw/forwardRaw 増えない・発勁検出しない）。
- 本タイマーが猶予明けから開始する（猶予を含めて短縮されない）。
- 猶予明けに baseline リセットされる（猶予中の移動が猶予明け初回 sample で積算に混ざらない）。
- 状態遷移テスト（stateMachine）を更新し、猶予サブフェーズ込みで正常遷移・戻り（Esc/R）が通る。
- 既存テストは緑のまま、新規追加。

## 検証
- `npm run typecheck && npm run lint && npm test && npm run build` 全緑。
- 手動: `npm run dev`（keyboard でも可）で各フェーズ前に「構えて あと3秒」が出て、猶予中は溜まらない・撃てないことを確認し日誌に記録。
- commit/push しない。

## 進め方
- Ready 統合方針など設計判断で迷ったら推測せず agmsg で claude に質問。
- 完了後、変更ファイル / テスト結果(pass数) / Ready との統合方針 / 残TODO を agmsg（ファイル経由送信）で報告。
