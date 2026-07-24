# 発勁ラボブレイカー 現行仕様

最終更新: 2026-07-25

この文書は、ポートフォリオ公開版の現在の構成だけを説明します。Unity Bridgeを前提にしていた旧仕様書は、[docs/archive/legacy/SPEC-unity-era-20260627.md](docs/archive/legacy/SPEC-unity-era-20260627.md) に移しました。

## 1. 体験

発勁ラボブレイカーは、mocopiの身体入力またはキーボード入力でチャージし、パンチの勢いに応じた研究室の破壊映像、損害額、ランクを表示するElectronアプリです。

公開版で現行プレイに使う研究室破壊映像18本は、共同制作者が撮影した研究室写真を入力に、無改変の公式`Wan-AI/Wan2.2-I2V-A14B`チェックポイントをローカル環境で使用して生成した映像です。未使用の比較候補2本は公開版から除外しました。`lv5_total_destruction.mp4`は旧開発用の単色プレースホルダーで、現行再生対象ではありません。実在企業を対象にした映像・抽選イベント・専用演出は収録しません。

## 2. 入力経路

通常の展示経路は次のとおりです。

1. mocopiセンサー1個を腕に装着する。
2. `tools/mocopi_ble_sidecar.py` がBLE通知を受け、角速度からパンチ入力を生成する。
3. sidecarがローカルUDPでElectron Mainへ送る。
4. Electron Mainが検証・正規化した `PunchInputSample` をRendererへ渡す。
5. Rendererがチャージ、パンチ判定、スコア、動画、結果画面を進行する。

キーボード入力は実機が使えない場合のデバッグ・継続手段として残します。Release版の既定入力はmocopi BLEです。

## 3. 状態遷移

主要状態は次の順です。

`Title → Registration → InputCheck → Ready → Charge → HakkeiReady → ImpactDelay → VideoPlayback → Result`

動画や入力の障害時は、次のプレイヤーが続行できるようタイトルへ安全に復帰します。

## 4. QR登録とスコアサーバー

`release.bat` は外部接続を有効にした通常の公開体験を起動します。QR登録、セッション確認、ランキング同期は `https://score.hakkei.org` と `wss://score.hakkei.org/ws` を利用します。

共有サーバーは公開デモモードで稼働し、公開ランキングと登録名候補には合成データだけを返します。入力名は共有サーバーの有効な一時セッション、スマートフォンのタブ、展示アプリのプロセス内メモリにだけ保持し、スコアは送信元ゲームへの応答に限って匿名表示します。QR参加とゲーム側の状態取得はセッションごとのランダムトークンで認証し、展示当日の保存データは読み込みません。

`--local-mode` はサーバーを使わずに動作確認するための代替経路です。公開リポジトリにはサーバープログラムを `CloudServer/hakkei-score-server/` として同梱しますが、実ユーザー、ランキング、セッションの保存データや運用秘密情報は含めません。

## 5. 公開素材

- 研究室背景: 共同制作者が撮影した4:3写真を16:9へ加工した公開用画像。元の4:3写真は非公開保管
- 研究室破壊映像: 上記写真を入力に`Wan-AI/Wan2.2-I2V-A14B`で生成した現行プレイ用18本
- BGM・効果音: 無音の生成済みWAVプレースホルダー
- 公開MP4: 音声ストリームを除去
- 個別の扱い: `ASSET_LICENSES.md`
- 外部実装・ライブラリ: `THIRD_PARTY_NOTICES.md`

## 6. Electronセキュリティ

RendererではNode.jsを無効にし、`contextIsolation` と `sandbox` を有効にします。Mainとの通信はpreloadで限定公開したAPIだけを使い、外部ナビゲーションと新規ウィンドウを拒否します。

## 7. 検証

公開前には、型検査、静的解析、自動テスト、クリーンビルド、Electron起動、素材検査を実行します。実機BLEとQR登録は環境依存のため手動確認項目として記録します。

具体的な操作手順は [docs/CURRENT_USAGE_JA.md](docs/CURRENT_USAGE_JA.md)、検証項目は [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を参照してください。
