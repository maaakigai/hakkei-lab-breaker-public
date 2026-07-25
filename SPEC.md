# 発勁ラボブレイカー 現行仕様

最終更新: 2026-07-25

この文書は、ポートフォリオ公開版の現在の構成だけを説明します。Unity Bridgeを前提にしていた旧仕様書は、[docs/archive/legacy/SPEC-unity-era-20260627.md](docs/archive/legacy/SPEC-unity-era-20260627.md) に移しました。

## 1. 体験

発勁ラボブレイカーは、mocopiの身体入力またはキーボード入力でチャージし、パンチの勢いに応じた研究室の破壊映像、損害額、ランク、ランキングを表示するElectronアプリです。

公開版で現行プレイに使う通常Lvの研究室破壊映像18本は、共同制作者が撮影した元の研究室写真を入力に、無改変の公式`Wan-AI/Wan2.2-I2V-A14B`チェックポイントをローカル環境で使用して生成した1280×720のI2V映像です。未使用の比較候補2本は公開版から除外しました。`lv5_total_destruction.mp4`は旧開発用の単色プレースホルダーで、現行再生対象ではありません。

Criticalでは、Geminiを用いて制作した大型電波塔の映像を追加再生し、結果演出に650億円のボーナスを加えます。Participant Assistはmocopi入力時のチャージ成立基準を下げますが、Criticalを保証しません。動作確認用のforced CriticalだけがCriticalを確実に発生させます。ランキングの順位比較と送信に使用するのは、Criticalボーナス加算前のbase scoreだけです。

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

同梱の提出版サーバーは、旧展示データと別の新規`HAKKEI_DATA_DIR`へ、完全な初回起動時に`PLAYER 001`等の合成初期ランキング10件を投入します。合成fixtureを収録する`data/`自体は実行時保存先として使用できず、展示当日のニックネーム、スコア、セッション履歴は読み込みません。運用先へ提出版を反映した後に登録されたプレイヤーと送信された結果は、通常のランキングデータとして永続保存します。既存の公開接続先への反映とスマートフォン実機疎通は別工程です。

QR参加、スマートフォン操作、ゲーム側の状態取得・結果送信にtokenは使用しません。管理用HTTP APIは実装せず、運用者がSSHでサーバーへ入った後、`manage.py`をサーバー内で直接実行します。イベントログはサーバー内だけに保存し、公開APIやリポジトリからは取得できません。

`--local-mode` はサーバーを使わずに動作確認するための代替経路です。公開リポジトリにはサーバープログラムを `CloudServer/hakkei-score-server/` として同梱しますが、運用中のユーザー、ランキング、セッション、イベントログの保存データやSSH資格情報は含めません。

## 5. 公開素材

- 研究室背景: 共同制作者が撮影した元の研究室写真を16:9・1280×720へ合わせたゲーム背景
- 通常Lvの研究室破壊映像: 上記写真を入力に`Wan-AI/Wan2.2-I2V-A14B`で生成した1280×720のI2V映像18本
- Critical映像: Geminiを用いて制作した大型電波塔映像
- BGM・効果音: 公開版ではすべて無音のWAV
- 公開MP4: すべて音声ストリームなし
- 個別の扱い: `ASSET_LICENSES.md`
- 外部実装・ライブラリ: `THIRD_PARTY_NOTICES.md`

## 6. Electronセキュリティ

RendererではNode.jsを無効にし、`contextIsolation` と `sandbox` を有効にします。Mainとの通信はpreloadで限定公開したAPIだけを使い、外部ナビゲーションと新規ウィンドウを拒否します。

## 7. 検証

公開前には、型検査、静的解析、自動テスト、クリーンビルド、Electron起動、素材検査を実行します。実機BLEとQR登録は環境依存のため手動確認項目として記録します。

具体的な操作手順は [docs/CURRENT_USAGE_JA.md](docs/CURRENT_USAGE_JA.md)、検証項目は [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を参照してください。
