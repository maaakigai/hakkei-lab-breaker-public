
# UNRESOLVED_ISSUES_RESOLUTION_2026-06-06.md

作成日: 2026-06-06

## 方針

`docs/archive/reviews/UNRESOLVED_ISSUES_CURRENT.md` の指摘を、実装・型・IPC・validator・状態遷移・Calibration・score・動画・Gate技術判定・テスト契約へ現実的な影響があるかで判定した。該当する指摘は妥当として反映した。運用、安全誘導、配布周辺だけの項目は対象外とし、既存文書の該当章には踏み込んでいない。

## 判定

P0 / P1 / P2の対象内指摘は、ほぼすべて実装分岐、テスト期待値の不一致、Gate判定の揺れにつながるため妥当と判定した。特に以下はP0/P1相当として優先反映した。

- Main / Renderer責務分担、Renderer再計算禁止。
- v1 UDP JSON、RightHand欠損、session、seq duplicate、timestamp gap、source/mode排他。
- `MotionSample`、`validForScore`、`validForCalibration`、dt/outlier処理。
- `IpcResult<void>`、`config:get`、preload購読解除、status/diagnostics payload。
- config schemaとconfig例の不一致。
- Calibration品質条件、forward vector優先順位、session変更時破棄。
- HakkeiReady timeout no-impact、HakkeiScore window、ScoreBreakdown整合性。
- Gate B2/D1の実Unity Bridge必須化、Mockの位置付け固定。
- Debug Result Fixtureの通常入力modeからの分離。

## 追加で発見した未記載課題と反映

| 追加課題 | 影響 | 反映 |
|---|---|---|
| `docs/requirements.md` と `docs/verification_checklist.md` が添付内に存在しない一方、複数資料が参照している | 初見実装者が判断順位とGate記録を参照できない | 最小の整合版を新規作成 |
| root `README.md` と `docs/runs/README.md` が同名アップロードとして混在している | 参照先の誤解 | 出力ではcanonical pathへ整理 |
| Unity BridgeのScript Execution Orderが未記載 | `LateUpdate` でもRightHand取得順が保証されない可能性 | `SPEC.md` 0.22へ追加 |
| video event / timeoutにplay identityがない | 古い動画eventで状態遷移する可能性 | `videoPlayId` 契約を追加 |
| config変更の反映タイミングが不明 | 実行中の設定変更でテスト期待値が割れる | 起動時読込、次回起動反映に固定 |

## 反映ファイル

| ファイル | 主な反映 |
|---|---|
| `SPEC.md` | 確定実装契約を追加し、責務、packet、MotionSample、IPC、config、Calibration、score、Gateを固定 |
| `AGENTS.md` | AI/共同開発者向けの現行契約、Renderer禁止事項、v1 JSON、MotionSample、mock scriptを更新 |
| `MILESTONES.md` | 追加タスク、Gate条件、Mock/Gate分離、no-impact timeoutを反映 |
| `HUMAN_TEST_GUIDE_JA.md` | Mock mode、jitter 2秒、Calibration固定条件、Debug Fixture、Gate判定欄を更新 |
| `README.md` | 確定技術方針と読む順序を更新 |
| `docs/asset_guidelines.md` | video selector / no-impact / audio missingの技術契約を追加 |
| `docs/runs/README.md` | Gate記録必須項目を追加 |
| `docs/requirements.md` | 添付にない参照先を整合版として新規作成 |
| `docs/verification_checklist.md` | 添付にない参照先を整合版として新規作成 |
| `docs/archive/reviews/VALIDATION_REPORT.md` / `docs/archive/reviews/TARGETED_REVIEW_FIX_REPORT.md` / `docs/archive/reviews/DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md` | 追加反映履歴を追記 |
| `docs/archive/reviews/UNRESOLVED_ISSUES_CURRENT.md` | 入力資料として保持し、反映済み注記を追加 |

## 残る注意

実コード、`package.json`、Unity project、実assetは添付されていないため、今回の成果物はMarkdown資料の整合化に限定される。実装リポジトリへ適用した後は、`docs/verification_checklist.md` に沿ってGateを再測定する必要がある。
