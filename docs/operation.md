# docs/operation.md

発勁ラボブレイカーの運用入口です。2026-07-26時点の本線は **mocopi 1台 BLE直読・単手パンチ・magnitude-only** です。

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

### 録画専用ダミーQR

画面収録時だけ`scripts/windows/release_demo_qr.bat`を使用できます。登録画面には`DEMO QR — RECORDING ONLY`と`https://example.invalid/hakkei-demo`の無効なQRを表示し、公開サーバーへは通信しません。名前はキーボードで入力します。このモードは実際のQR登録、ランキング同期、ネットワーク疎通の確認には使用しません。

## 3. 実機なし確認

InputCheckで `録画再生でテスト（実機なし）` を使います。これはBLE録画を再生して経路を確認するための手段であり、MVP完成判定の代替ではありません。

## 4. キーボード診断用フォールバック

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

## 7. QRサーバー運用

- Release版は、設定されたQR登録・ランキングサーバーへ接続します。2026年7月26日に、運用先への提出版反映後のスマートフォン実機疎通を確認済みです。
- 同梱の提出版サーバーは展示当日の保存データを読み込まず、完全な初回起動時に`PLAYER 001`等の合成初期ランキング10件を投入します。その後の新規登録と結果は永続保存します。
- QRとスマートフォン操作はセッションIDだけで動作します。展示機はQR表示前に短期game tokenを登録し、ゲーム側の状態変更と結果送信だけを認証します。tokenはQRへ含めません。
- 管理用HTTP APIは実装しません。運用者がSSHでサーバーへ入り、`manage.py`をサーバー内で直接実行します。
- イベントログはサーバー内だけに保存し、公開APIやリポジトリへは含めません。
- 運用先では、旧展示データが残る`data/`を提出版の保存先に再利用しません。権限`0700`の新規ディレクトリを作り、systemdと`manage.py`の両方へ同じ`HAKKEI_DATA_DIR`を設定します。
- 前段プロキシを再開する前に、`manage.py list`の`dataDirectory`と、`PLAYER 001`から`PLAYER 010`までの10件だけが入っていることをサーバーローカルで確認します。詳しい順序は[`CloudServer/hakkei-score-server/README.md`](../CloudServer/hakkei-score-server/README.md)を参照してください。

## 8. Critical確認

- Participant Assistでmocopi入力時のチャージ成立基準が下がることと、動作確認用forced CriticalでCriticalを確実に発生させられることを、それぞれ確認します。Assist単独ではCriticalを保証しません。
- Criticalでは通常Lv映像の後に大型電波塔の映像が再生され、結果へ650億円のボーナスが加わることを確認します。
- ランキング送信・順位比較には、Criticalボーナス加算前のbase scoreだけが使われることを確認します。

## 9. 公開素材

- ゲーム背景は、共同制作者が撮影した元の研究室写真です。
- 通常Lv映像は同写真を入力にした1280×720のWan2.2 I2V、Critical専用映像はGeminiを用いた大型電波塔映像です。
- 公開版のBGM・SFXはすべて無音で、公開MP4には音声トラックがありません。

詳細な合否判定は [verification_checklist_v2_ble.md](verification_checklist_v2_ble.md) に記録します。
