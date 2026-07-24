# docs/operation.md

発勁ラボブレイカーの運用入口です。2026-07-24時点の本線は **mocopi 1台 BLE直読・単手パンチ・magnitude-only** です。

旧 Unity Bridge / Calibration 版の起動順は履歴として他文書に残していますが、現行運用ではこの文書と [CURRENT_USAGE_JA.md](CURRENT_USAGE_JA.md) を優先します。

## 1. 関連ドキュメント

| 目的 | ファイル |
|---|---|
| 現行利用手順 | [CURRENT_USAGE_JA.md](CURRENT_USAGE_JA.md) |
| 現行確認チェックリスト | [verification_checklist_v2_ble.md](verification_checklist_v2_ble.md) |
| 現行仕様 | [../SPEC.md](../SPEC.md) |
| BLE信号の実機検証 | [technical-notes/mocopi-ble-signal-validation.md](technical-notes/mocopi-ble-signal-validation.md) |
| 進捗 | [../MILESTONES.md](../MILESTONES.md) |
| 動画素材条件 | [asset_guidelines.md](asset_guidelines.md) |
| 旧版手順 | [archive/legacy/HUMAN_TEST_GUIDE_JA-unity-calibration.md](archive/legacy/HUMAN_TEST_GUIDE_JA-unity-calibration.md) |

## 2. 標準起動順（現行BLE）

1. mocopiをWindowsのペアリング済み状態から外し、青点滅のadvertising状態にする。
2. 公開体験では `scripts/windows/release.bat` を起動する。入力切替や診断UIを使う確認では次を実行する。
   ```bash
   npm run dev:debug
   ```
3. Debug UIで確認する場合は、Titleで `mocopi BLE（本命）` を選ぶ。Release UIではmocopi BLEが既定です。
4. `開始` でInputCheckへ進む。
5. 必要ならmocopiを軽く振って起こす。
6. InputCheckでsidecar状態、Hz、最終受信、charge、intensityを確認する。
7. Readyへ進み、Chargeで利き手を振る。
8. HakkeiReadyで構えカウント後に一発パンチする。
9. VideoPlaybackとResultを確認する。

## 3. 実機なし確認

InputCheckで `録画再生でテスト（実機なし）` を使います。これはBLE録画を再生して経路を確認するための手段であり、MVP完成判定の代替ではありません。

## 4. Keyboard debug fallback

BLE不調時やUI/score/videoの確認では `Keyboard（debug）` を使います。

| キー | 動作 |
|---|---|
| Space | Charge中に連打してタメを増やす |
| Enter | HakkeiReadyでパンチ |
| R | Ready以降をInputCheckへリセット |
| Esc | Titleへ戻る |

Keyboardで完走してもMVP完成扱いにはしません。MVP完成はmocopi BLE実機で判定します。

## 5. 旧版との差異

| 項目 | 旧版 | 現行版 |
|---|---|---|
| 起動対象 | Sensor data receiver、mocopi PC app、Unity Bridge、Electron | mocopi BLE、Electron、sidecar |
| 入力確認 | RightHand JSON、heartbeat、Calibration | BLE Hz、sidecar状態、角速度、charge/intensity |
| 標準プレイ | Calibration→上下→前後→発勁 | Ready→Charge→HakkeiReady |
| fallback | Keyboardは本番予備 | Keyboardはdebug fallback |

## 6. トラブル時の確認先

| 症状 | 最初に見る場所 |
|---|---|
| BLE未受信 | mocopiが青点滅か、Windowsでペアリング済みになっていないか、sidecar状態 |
| sidecarが止まる | InputCheckの `sidecar 再起動` |
| 実機がない | `録画再生でテスト（実機なし）` |
| ゲームを継続したい | `Keyboardに切替（debug fallback）` |
| Chargeが増えない | 利き手を振っているか、charge/intensity診断 |
| 動画が出ない | `assets/videos/LV1/`〜`LV5/` のmp4配置。Lv0は動画なしで背景画像を使用 |

詳細な合否判定は [verification_checklist_v2_ble.md](verification_checklist_v2_ble.md) に記録します。
