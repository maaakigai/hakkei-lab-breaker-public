# 発勁ラボブレイカー 公開版手動確認

最終更新: 2026-07-25

旧Unity Bridge / Calibration版の長い手順は、[docs/archive/legacy/HUMAN_TEST_GUIDE_JA-unity-calibration.md](docs/archive/legacy/HUMAN_TEST_GUIDE_JA-unity-calibration.md) に移しました。

## Release版

1. `scripts/windows/release.bat` を起動する。
2. Title画面で `START GAME` を選ぶ。
3. QRコードをスマートフォンで読み、ニックネームを登録する。
4. PC側が登録を検出し、InputCheckへ進むことを確認する。
5. mocopi BLEを受信すると `CONNECTED` になり、ゲームへ進めることを確認する。
6. 腕を振ってチャージし、構えのカウント後に前へパンチする。
7. パンチの強さに対応する研究室破壊動画が再生されることを確認する。
8. Resultに損害額、ランク、見積内訳、`RANK UPDATE`または`PERSONAL BEST RESULT`がすぐ表示され、共有ランキングにも反映されることを確認する。
9. ResultからTitleへ戻り、次のプレイを開始できることを確認する。

失敗時は `logs/state-YYYYMMDD.log`、InputCheckの受信表示、サーバー接続メッセージを確認します。

## 名前手入力

1. `scripts/windows/release.bat` の登録画面で、QRを使わず名前を入力する。
2. 登録済み候補を選んだ場合は、同じ公開用プレイヤー番号でInputCheckへ進むことを確認する。
3. ゲームを完走し、Resultで `RANK UPDATE`または`PERSONAL BEST RESULT`がすぐ表示されることを確認する。
4. Titleの `LEADERBOARD` を開き、手入力時のスコアもQR登録時と同じ共有ランキングへ反映されることを確認する。
5. 同じ結果通知を再送しても、プレイ回数が二重加算されないことを確認する。

## キーボード確認

1. `scripts/windows/debug.bat` を起動し、入力モードをKeyboardへ切り替える。
2. `Space` でチャージし、`Enter` でパンチする。
3. Lv動画からResultまで完走することを確認する。
4. `R` でInputCheckへ、`Esc` でTitleへ安全に戻れることを確認する。

## 設定画面

1. `scripts/windows/Settings.bat` を起動する。
2. BLEしきい値、チャージ基準、ランク、音量、見積項目を変更できることを確認する。
3. 保存後に再読み込みし、値が保持されることを確認する。
4. 不正な値は保存されず、エラーが表示されることを確認する。

## 素材

1. 公開版のWAVがすべて無音であることを自動テストで確認する。
2. 公開版のMP4に音声ストリームがないことを自動テストで確認する。
3. Lv1〜Lv5の研究室破壊動画を各1本再生し、停止やデコードエラーがないことを確認する。

詳細チェックリストは [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を参照してください。
