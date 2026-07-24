# 20260628 現行BLE版ドキュメント整備

- 対象ステップ: 文書追従。旧 Unity / Calibration 版の手順を旧版として明示し、現行BLE直読版の利用手順と確認チェックリストを作成。
- 変更ファイル: `README.md`、`docs/CURRENT_USAGE_JA.md`、`docs/verification_checklist_v2_ble.md`、`docs/operation.md`、`HUMAN_TEST_GUIDE.md`、`HUMAN_TEST_GUIDE_JA.md`、`docs/verification_checklist.md`、`MILESTONES.md`。
- 採用した判断: 旧手順書は削除せず、先頭に旧版注意を追加して履歴として残す。現行版は別ファイル化し、READMEとoperationから現行文書へ誘導する。
- 理由・根拠: 現行コードは `mocopi-ble`、Main生成 `PunchInputSample`、単一 `Charge`、`HakkeiReady` intensity peak判定へ移行済み。旧 `Calibration` / `VerticalCharge` / `ForwardCharge` / Unity Gate文書をそのまま正式手順にすると確認者が誤ったGateを実施するため。
- 旧版との差異: Unity Bridge起動、RightHand UDP、neutral/forward Calibration、上下/前後チャージ、Unity Gate B2/D1は現行通常確認から外し、BLE Probe、sidecar、静止10秒false trigger 0、単一Charge、intensity peak、BLE実機10連続を現行確認にした。
- 確認結果: Markdown文書更新のみ。リンク先ファイルの存在を確認。自動テストはコード未変更のため未実施。
- 残課題: `SPEC.md` / `AGENTS.md` 全体のv2権威化、旧 Unity 章のlegacy分離、BLE実機Gate E/Fの記録更新。
