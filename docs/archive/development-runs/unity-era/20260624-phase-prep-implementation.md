# 20260624 各アクション前の3秒「構え」猶予（prep）

由来: 実機 M11-12 プレイ時のユーザー要望「上下・前後・突き、それぞれの行動の前に3秒ほど猶予がほしい」。
チケット: docs/runs/20260624-ticket-phase-prep-countdown.md。
担当: codex 実装（途中まで）→ **claude が巻き取って完了**（codex が agmsg で巻き取り要請）。

## 実装（codex 完了分）
- `config/app.config.json` の `timers.chargePrepMs=3000` を追加。`configTypes.ts` / `appConfig.ts`（validateApp の
  timers ループに `chargePrepMs` を追加・負値不可）を更新。
- `stateMachine.ts`: 新ステート `ForwardPrep` / `HakkeiPrep` と新イベント `forwardPrepDone` / `hakkeiPrepDone`。
  新フロー = `VerticalCharge → ForwardPrep → ForwardCharge → HakkeiPrep → HakkeiReady`。`RESETTABLE_STATES` にも追加。
- `app.ts`: ForwardPrep/HakkeiPrep 突入時に `chargePrepMs` のカウントダウン → 猶予明けに本 timer 開始。
  VerticalCharge/ForwardCharge 本開始時に baseline(prevPos/prevPhase) reset、HakkeiReady 本開始時に detector.reset。
  prep ステートは `onSample` の switch 対象外＝**猶予中は積算・発勁検出をしない**。表示は「② 前後チャージの準備／
  ③ 発勁の準備 — 構えて…」を入力モード別に。
- `play-loop.test.mjs`: 縦通しのイベント列に `forwardPrepDone`/`hakkeiPrepDone` を挿入し新フローへ整合。

## 設計判断
- **Ready の既存カウントダウン(`readyCountdownMs`)を VerticalCharge の構え猶予として兼用**し、上下の前に二重待ちを作らない。
  Forward と Hakkei の前にだけ新規の構え猶予（`chargePrepMs`）を `ForwardPrep`/`HakkeiPrep` として追加。
- 猶予は「いつ採点を始めるか」の制御のみ。採点・発勁判定ロジック・閾値は不変。

## claude 巻き取り分（本コミットで追加）
- SPEC §10.1 状態表に ForwardPrep/HakkeiPrep、§10.2 遷移図に新遷移・Esc を追記。
- `state-machine.test.mjs`: prep ステートは prep-done だけ受理し、猶予スキップ（旧 `forwardDone`/`hakkeiDetected` 直行）を
  弾くこと、prep 中も Esc/reset が効くことを検証。`正常系` パスも新フロー反映済み。
- `config-loader.test.mjs`: `timers.chargePrepMs` 負値で CONFIG_INVALID。
- 「猶予中は不積算・不検出」は app.ts の `onSample` switch が prep ステートを含まないことで構造的に保証
  （DOM 結合のため直接ユニットテストは置かず、stateMachine の prep gating ＋ コード検査で担保）。

## 確認
- `npm run typecheck / lint / test / build` 緑（テスト件数は prep 関連で増加）。
- 手動確認（要記録）: keyboard か実機で各フェーズ前に「構えて あと3秒」が出て、猶予中は溜まらない・撃てないこと。
  → 次回プレイ時に確認しログ追記。
