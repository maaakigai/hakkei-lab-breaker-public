# Ticket: 両手v2 P2 — Calibration 両手化（左右 neutral＋共通 forward）

担当: codex / 起票: claude / 2026-06-24
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P1a(16cf927)・P1b(e629fbb)・P1c(mock両手化)

## 方針
Calibration で **左右の手の neutral を取得**し、**forwardVector は体の共通1本**にする（設計決定：左右別 forward は腕の開きで軸がぶれ、両手同期判定が不安定になるため）。
**後方互換で green 維持**：右手の calibration 挙動・既存テスト・既存消費側（playAccumulator/detector は右手のまま）を壊さない。**左手 neutral は追加するだけ**で、score/検出での左手利用は P3。

## 現状
- `src/renderer/calibrationManager.ts`：右手のみ。discard→neutral（右手 handPosition の平均）→forward（右手前方ジェスチャから forwardVector 推定）。`CALIB` 定数に時間/しきい値。`CalibrationResult` に neutralHandPosition / upVector / forwardVector。
- P1b で MotionSample に `leftHand: HandMotion|null` が追加済み（左手の position/velocity/validity が Main 生成で来る）。
- P1c で mock `--v2` が両手送信可（左手データを流せる＝P2 をテストできる）。

## 要件
1. **左手 neutral 取得**：neutral 計測中、右手と同様に **`sample.leftHand` の handPosition も平均**して `leftNeutralHandPosition` を保存。
   - 右手が無い/不安定なら従来どおり失敗。**左手は v2 入力時のみ取得**（v1/左手 unavailable のときは leftNeutral=null で、右手のみの従来結果を維持＝後方互換）。
2. **forwardVector は共通1本**（現状の右手前方ジェスチャ由来でよい）。左手専用 forward は作らない。
3. `CalibrationResult` に **`leftNeutralHandPosition: Vec3 | null`** を追加（右手系フィールドは据え置き）。
4. **触らない**：playAccumulator / hakkeiDetector / scoreCalculator / renderer のスコア経路（左手 neutral の利用は P3）。app.ts は calibResult の受け渡しに leftNeutral を含める程度の最小変更に留める。
5. UX：必要なら「両手をニュートラルに」の文言調整（任意・表示のみ）。判定/タイミング/契約は不変。

## テスト（test/・node --test）
- v2 入力（両手）で **leftNeutralHandPosition が右手と独立に取得される**。
- v1/左手 unavailable 入力では **leftNeutral=null、右手 calibration は従来どおり成立**（後方互換・回帰）。
- 既存 calibration テストは全 green 維持で新規追加。

## 不変ルール
- 後方互換（右手 calibration・既存テスト・消費側を壊さない）。
- Main 生成値のみ使用（Renderer 再計算禁止・AGENTS §6）。状態遷移を変えるなら SPEC・stateMachine・テスト同時更新（今回は遷移変更なしの想定）。
- TS3規約。commit/push しない（claude が区切りでコミット）。

## 検証 / 報告
- `npm run typecheck && npm run lint && npm test && npm run build` 全緑。
- 手動（任意）：`npm run dev`（Mock Unity Bridge）＋ `npm run mock:unity --v2 --calib`（または該当コマンド）で両手 neutral が取れることを確認、日誌に記録。
- 報告は **agmsg のファイル経由送信**（`printf '%s' "本文" > /tmp/p2.txt; send.sh hakkei codex claude "$(cat /tmp/p2.txt)"`）で、変更ファイル/テスト結果/設計判断/残TODO。詰まったら即相談。P3 以降は未着手で。
