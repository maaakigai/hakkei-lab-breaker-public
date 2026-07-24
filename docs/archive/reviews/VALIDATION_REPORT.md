# VALIDATION_REPORT.md

ユーザー指摘事項の妥当性検証と修正内容です。

## 判定一覧

| 指摘 | 判定 | 理由 | 修正 |
|---|---|---|---|
| `docs/requirements.md` が参照不能 | 妥当 | `AGENTS.md` / `SPEC.md` / `MILESTONES.md` が最上位要件として参照しているため、ファイルがないと仕様判断の根拠が欠ける | `docs/requirements.md` を追加。AGENTS/SPEC/MILESTONESで「欠落時は実装前に配置」と明記 |
| `HUMAN_TEST_GUIDE.md` と `HUMAN_TEST_GUIDE_JA.md` が完全重複 | 妥当 | SHA256が同一で、見出しもJA名のままだと更新先が分からなくなる | `HUMAN_TEST_GUIDE_JA.md` を正本化。`HUMAN_TEST_GUIDE.md` は案内専用に変更 |
| motion JSONの `seq` が必須か任意か曖昧 | 妥当 | 標準契約と欠損時代替の記述が衝突する | v1仕様では `seq` 必須に統一。欠損はinvalidとして破棄。AGENTS/SPEC/MILESTONES/docs/requirementsへ反映 |
| IPC payloadが未定義 | 妥当 | イベント名だけではMain/Preload/Rendererで実装差が出る | `SPEC.md` に `MotionSamplePayload` / `MotionHeartbeatPayload` / `MotionStatusPayload` / `AppErrorPayload` を追加。heartbeatもIPC送信フローへ追加 |
| mocopi入力経路の図が読みづらい | 妥当 | Motion Source App、Unity Receiver Plugin、Unity Bridgeの境界が曖昧 | `SPEC.md` と `docs/requirements.md` の図をUnity Bridgeサブグラフ付きに修正。データ別送受信表を追加 |
| Debug Result Fixtureが共通入力経路を迂回しそう | 妥当 | 本番入力モードのように見えるとMotionSample共通化と衝突する | Debug Result FixtureはDiagnostics限定。scoreCalculatorとvideoManagerを通す動画確認機能に限定 |
| 安全要件が後半に寄りすぎ | 妥当 | 身体入力アプリでは安全表示・中断操作がMVPから必要 | Gate A、M1、M2、SPEC、手順書へ安全表示と中断操作を前倒し |
| 実機許容値が抽象的 | 妥当 | 「許容範囲」だけでは属人的になる | `jitterRmsM <= 0.03`、`jitterMaxM <= 0.08` をPASS、WARN/FAIL基準も追加 |
| Week 4の記述に対応する週割りがない | 妥当 | 締切駆動ではM番号だけでは判断しづらい | `MILESTONES.md` にWeek 1〜4の束ね表を追加 |
| 現リポジトリ実体はM0未満 | 妥当 | `package.json`、`tsconfig.json`、`config/*.json` などが未配置ならM0未完 | `MILESTONES.md` に現状認識とM0-00〜M0-12を追加。今回の成果物はMarkdown改善なので、非Markdown実装ファイルはM0作業として残す |

## 更新後の運用ルール

- 仕様判断の最上位は `docs/requirements.md`。
- 実装詳細は `SPEC.md`。
- 作業順とゲートは `MILESTONES.md`。
- 人間向け確認手順の正本は `HUMAN_TEST_GUIDE_JA.md`。
- `HUMAN_TEST_GUIDE.md` は案内専用で、本文を重複させない。
- motion JSON v1の `seq` は必須。
- heartbeatは `motion:heartbeat` と `motion:status` でRendererへ通知する。
- Debug Result Fixtureは入力モードではなく、Diagnostics内の動画・Result確認機能に限定する。
- 安全注意と中断操作はGate Aから必須。

## 残作業

今回の更新対象はMarkdown資料です。次の非Markdownファイルは、実リポジトリ側でM0として作成してください。

- `package.json`
- `tsconfig.json`
- `config/app.config.json`
- `config/input.config.json`
- `config/score.config.json`
- Electron最小起動コード


## 2026-06-05 targeted review v6

- `StatusWarningCode` を定義し、`UNKNOWN_FIELDS` warningの型実装穴を解消した。
- `motion:heartbeat`、`motion:session-changed`、`app:error-clear`、`config:get` をpreload APIに接続した。
- `AppConfigBundle` を定義した。
- validator系Error codeのseverity/recoverable/messageJa/固定条件を定義した。
- Gate D1 jitter条件を raw/filtered/validSampleRatio/静止誤検出0回で一本化した。
- `AGENTS.md` に各ステップ終了時の実装理由・根拠記録ルールを追加した。



## 2026-06-06 unresolved current resolution

`docs/archive/reviews/UNRESOLVED_ISSUES_CURRENT.md` の対象内指摘を再検証し、実装・型・IPC・validator・状態遷移・Calibration・score・動画・Gate技術判定に現実的な影響があるものを反映対象としました。運用、安全誘導、配布周辺だけの項目は今回も対象外です。

主な追加反映:

- Main生成 `MotionSample` 契約、Renderer再計算禁止、Keyboard generatorのMain責務を再固定。
- v1 packet common field、RightHand欠損時、seq duplicate、timestamp gap、unknown source count、source/mode排他を固定。
- `IpcResult<void>`、`config:get`、preload API、`motion:status` 周期再発行、diagnostics nullable sourceを固定。
- `InputConfig` / `ScoreConfig` / `AppConfig` のschemaと例を整合。
- Calibrationのdiscard、sample数、Hz、forward距離、破棄条件を固定。
- `validForScore=true` のsampleだけをscore/hakkeiに使用し、HakkeiReady timeoutをno-impactに統一。
- Gate B2は実Unity Bridge必須、Mockはvalidator/IPC確認に限定。
- Gate D1は2秒jitterとphase別validSampleRatioへ統一。
- Debug Result Fixtureを通常入力modeから分離。
