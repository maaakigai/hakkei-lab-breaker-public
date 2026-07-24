# TARGETED_REVIEW_FIX_REPORT.md

作成日: 2026-06-05

## 対象

ユーザーから提示された次の指摘を検証した。

- `StatusWarningCode` 未定義。
- Inbound IPCに対してpreload APIの購読口が不足。
- `config:get` の返却型 `AppConfigBundle` 未定義。
- Error code一覧に対する固定条件表不足。
- Gate D1のjitter条件の揺れ。
- `SPEC.md` のレビュー根拠参照先の不整合。
- `AGENTS.md` に各ステップ終了時の実装理由・根拠記録ルールを追加する要望。

## 判定

上記はいずれも、運用・安全・配布周辺ではなく、型実装、IPC契約、validatorテスト、Gate技術判定に直接影響するため妥当と判定した。

## 反映

| ファイル | 反映内容 |
|---|---|
| `SPEC.md` | `StatusWarningCode`、preload API、`AppConfigBundle`、Error固定表、Gate D1 jitter条件、レビュー参照先を修正 |
| `AGENTS.md` | 各ステップ終了時に実装理由・根拠を記録するルールを追加 |
| `MILESTONES.md` | M5 IPC/型タスク、Gate D1/D2、jitter 2秒指標を更新 |
| `HUMAN_TEST_GUIDE_JA.md` | jitter確認とvalidator系エラー表示を初心者向けに明確化 |
| `docs/verification_checklist.md` | Gate D1技術判定メモとIPC/config/Error確認を追加 |
| `docs/requirements.md` | motion/heartbeat JSONとMotionSampleの最上位例を現行契約に合わせた |

## 対象外

会場運用、安全誘導、配布・署名・ビルド配布手順は今回の修正対象外とした。



## 2026-06-06 追加反映

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
