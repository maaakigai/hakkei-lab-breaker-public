# DOC_REVIEW_ALL_FINDINGS_RESOLUTION_REPORT.md

添付レビュー `DOC_REVIEW_ALL_FINDINGS.md` の妥当性検証と反映結果です。

## 方針

- 現実の実装・テスト・Gate判定が分岐する指摘は「妥当」と判定しました。
- 運用・安全・配布周辺は今回の対象から除外しました。
- `対象内` は原則反映しました。
- `境界` は、実装判断・テスト判定・Gate判定に影響するものだけ反映しました。

## 集計

- 全指摘: 156件
- 妥当として反映: 151件
- 対象外: 5件

## 主な反映領域

| 領域 | 反映内容 |
|---|---|
| Main/Renderer責務 | MotionSampleはMain生成、Renderer再計算禁止、KeyboardもMain共通経路 |
| UDP JSON | protocolVersion/sessionId/seq/timestamp/safe integer/boolean/unknown fields/source identity/session順序 |
| IPC | input:set-mode, keyboard:control, calibration:set-state, input:reset-filter, reset-play, diagnostics, session-changed |
| MotionSample | rawHandPosition, receivedAtMs, validForScore, validForCalibration, flags union, unavailable/recovery sample |
| Calibration | raw座標使用、filter reset、300ms discard、2秒/1秒条件、forward距離、破棄条件 |
| score | 速度積分、Hakkei複合条件、timeout no-impact、ScoreBreakdown整合性、powerCoefficient統一 |
| Gate/test | Gate A/B1/B2/C/D1/D2整理、Mockの扱い、validSampleRatio、heartbeatHz、jitter、script名 |
| 人間向け技術確認 | 初心者向け手順を `HUMAN_TEST_GUIDE_JA.md` に集約 |

## 全件対応表

| No | 元分類 | 判定 | 対応 |
|---:|---|---|---|
| 001 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 002 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 003 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 004 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 005 | 対象内 | 妥当 | 実装分岐を避けるため対象内として仕様へ反映。 |
| 006 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 007 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 008 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 009 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 010 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 011 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 012 | 対象外扱い | 対象外 | 運用・安全・配布周辺として今回の仕様修正対象から除外。必要最小限の参照整理以外は未対応。 |
| 013 | 対象外扱い | 対象外 | 運用・安全・配布周辺として今回の仕様修正対象から除外。必要最小限の参照整理以外は未対応。 |
| 014 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 015 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 016 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 017 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 018 | 対象外扱い | 対象外 | 運用・安全・配布周辺として今回の仕様修正対象から除外。必要最小限の参照整理以外は未対応。 |
| 019 | 対象外扱い | 対象外 | 運用・安全・配布周辺として今回の仕様修正対象から除外。必要最小限の参照整理以外は未対応。 |
| 020 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 021 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 022 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 023 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 024 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 025 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 026 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 027 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 028 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 029 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 030 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 031 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 032 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 033 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 034 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 035 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 036 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 037 | 対象内 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 038 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 039 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 040 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 041 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 042 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 043 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 044 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 045 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 046 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 047 | 対象内 | 妥当 | 実装分岐を避けるため対象内として仕様へ反映。 |
| 048 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 049 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 050 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 051 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 052 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 053 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 054 | 対象内 | 妥当 | 実装分岐を避けるため対象内として仕様へ反映。 |
| 055 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 056 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 057 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 058 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 059 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 060 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 061 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 062 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 063 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 064 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 065 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 066 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 067 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 068 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 069 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 070 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 071 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 072 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 073 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 074 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 075 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 076 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 077 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 078 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 079 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 080 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 081 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 082 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 083 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 084 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 085 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 086 | 対象内 | 妥当 | 実装分岐を避けるため対象内として仕様へ反映。 |
| 087 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 088 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 089 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 090 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 091 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 092 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 093 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 094 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 095 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 096 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 097 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 098 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 099 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 100 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 101 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 102 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 103 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 104 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 105 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 106 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 107 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 108 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 109 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 110 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 111 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 112 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 113 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 114 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 115 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 116 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 117 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 118 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 119 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 120 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 121 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 122 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 123 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 124 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 125 | 対象外扱い | 対象外 | 運用・安全・配布周辺として今回の仕様修正対象から除外。必要最小限の参照整理以外は未対応。 |
| 126 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 127 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 128 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 129 | 対象内 | 妥当 | 実装分岐を避けるため対象内として仕様へ反映。 |
| 130 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 131 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 132 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 133 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 134 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 135 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 136 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 137 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 138 | 境界 | 妥当 | Calibration条件、破棄条件、人間確認条件として `SPEC.md` / guide / checklistへ反映。 |
| 139 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 140 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 141 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 142 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 143 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 144 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 145 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 146 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 147 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 148 | 境界 | 妥当 | Gate/テスト/文書整合に影響する境界項目として `MILESTONES.md` / checklist / guide / READMEへ反映。 |
| 149 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 150 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 151 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 152 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 153 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 154 | 対象内 | 妥当 | スコア、Hakkei、Result、動画/音声、ScoreBreakdown契約として `SPEC.md` / `MILESTONES.md` / checklistへ反映。 |
| 155 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |
| 156 | 対象内 | 妥当 | UDP/IPC/MotionSample/input mode/config/status/diagnostics契約として `SPEC.md` / `AGENTS.md` / requirementsへ反映。 |

## 対象外にした項目

今回の依頼で除外指定があったため、次は仕様改善対象から外しました。

| No | 理由 |
|---:|---|
| 012 | operation側のjitter threshold表現が仕様本文と揺れている。 |
| 013 | 文書更新規則で `docs/operation.md` / `docs/asset_guidelines.md` が確認対象から漏れる場合がある。 |
| 018 | production build commandが不足している。 |
| 019 | 中断操作のcapture責務が安全面として曖昧。 |
| 125 | `Esc` semanticsがSPEC/MILESTONES/guide/checklistでreturn-titleかquitか揺れている。 |



## 2026-06-06 追加整合化

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
