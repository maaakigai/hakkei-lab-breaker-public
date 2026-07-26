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

## 録画専用ダミーQR

1. `scripts/windows/release_demo_qr.bat`を起動する。
2. Titleから登録画面へ進み、`DEMO QR — RECORDING ONLY`と表示されることを確認する。
3. QRの表示先が予約済み無効ドメインの`https://example.invalid/hakkei-demo`であり、スマートフォン登録には使用できないことを確認する。
4. 公開QRサーバーへ接続・送信せず、キーボードで名前を入力してゲーム画面を収録できることを確認する。
5. このモードを実際のQR登録、ランキング同期、サーバー疎通の合否判定には使用しない。

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

## Critical

1. Participant Assistを有効にし、mocopi入力時のチャージ成立基準が下がることを確認する。Assist単独ではCriticalを保証しない。
2. Debug版のforced Critical経路で、通常フローの後にCriticalが確実に発生することを確認する。
3. 通常Lvの研究室破壊映像に続いて大型電波塔の映像が再生されることを確認する。
4. ResultにCritical表示と650億円のボーナスが加わることを確認する。
5. サーバーへ送信されるスコアとランキング順位は、Criticalボーナス加算前のbase scoreだけを使い、650億円が順位へ混入しないことを確認する。

## QRサーバー

1. 旧展示データを非公開保全先へ残し、別の空ディレクトリを権限`0700`で作成して`HAKKEI_DATA_DIR`へ設定する。systemdと`manage.py`で同じ値を使用していることを確認する。
2. 前段プロキシを開く前に`manage.py list`をサーバーローカルで実行し、`dataDirectory`が新規ディレクトリで、`PLAYER 001`等の合成初期ランキング10件だけから開始することを確認する。
3. 展示当日のニックネーム、スコア、セッション履歴を提出版DBへ読み込む処理やデータファイルがないことを確認する。
4. 確認用ニックネームを新規登録して結果を送信し、サーバープロセス再起動後もランキングとプレイ回数が保持されることを確認する。
5. QRとスマートフォン操作が従来どおりで、QRへgame tokenが含まれず、tokenなしのゲーム側状態変更・結果送信だけが403になることを確認する。
6. 管理用HTTP APIへInternet側から到達できず、SSH接続後にサーバー内の`manage.py`からだけ確認・操作できることを確認する。
7. イベントログがサーバー内にだけ作成され、公開APIと公開リポジトリから取得できないことを確認する。

## 設定画面

1. `scripts/windows/Settings.bat` を起動する。
2. BLEしきい値、チャージ基準、ランク、音量、見積項目を変更できることを確認する。
3. 保存後に再読み込みし、値が保持されることを確認する。
4. 不正な値は保存されず、エラーが表示されることを確認する。

## 素材

1. 待機画面とLv0で、共同制作者が撮影した元の研究室写真を16:9・1280×720へ合わせた背景が表示されることを確認する。
2. Lv1〜Lv5のWan2.2 I2V研究室破壊動画を各1本再生し、1280×720で停止やデコードエラーがないことを確認する。
3. Geminiを用いたCriticalの大型電波塔映像を再生し、停止やデコードエラーがないことを確認する。
4. 公開版のWAVがすべて無音であることを自動テストで確認する。
5. 通常Lv、Critical、デモを含む公開版のMP4に音声ストリームがないことを自動テストで確認する。

詳細チェックリストは [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を参照してください。
