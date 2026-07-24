# 発勁ラボブレイカー

[![CI](https://github.com/maaakigai/hakkei-lab-breaker-public/actions/workflows/ci.yml/badge.svg)](https://github.com/maaakigai/hakkei-lab-breaker-public/actions/workflows/ci.yml)

> mocopiを手首に装着し、「タメ」とパンチの勢いで研究室を破壊する体験型インスタレーション。

**完成・展示済み**　制作1か月 / 共同制作者2名＋生成AI支援 / メンター3名<br>
共同開発: [maaakigai](https://github.com/maaakigai) / [attack114514](https://github.com/attack114514)

画面内の英題`UBi-Lab Break Simulator`は、発勁ラボブレイカーの展示用タイトルです。

![発勁ラボブレイカーのリザルト画面](docs/images/result-screen.png)

画面内のメーカー名・製品名は、研究室内に実在する備品を識別して架空の再調達見積を作るために表示しています。各メーカーを破壊対象とする意図、批判、提携・推奨を示すものではなく、金額もゲーム演出用のシミュレーションです。

## 作品概要

発勁ラボブレイカーは、Sonyのモーションセンサー「mocopi」1台を使ったElectron製のインタラクティブ映像作品です。Bluetooth Low Energy（BLE）で取得した手首の回転からタメ量とパンチ強度を推定し、威力に応じた破壊映像、推定損害額、ランク、ランキングを表示します。

参加者はスマートフォンでQRコードを読み取って名前を登録し、mocopiを装着してプレイします。実運用ではセルフホストのLinuxサーバー上に構築したPython製サーバーを使用し、展示機とHTTP / WebSocketで進行状況と結果を同期しました。

## 展示実績

2026年7月12日、共同開発者が所属する研究室の発表会で1時間展示しました。正式な開始・終了時刻が残っていないため、参加者数とセッション数は展示日全体のサーバーログに基づく概算です。

| 項目 | 実績 |
|---|---|
| 制作期間 | 1か月 |
| 展示参加者 | 約30名 |
| 処理セッション | 約40セッション |
| 継続展示 | 1時間 |
| 観測された重大障害 | 0件 |
| QR登録・スコア連携 | セルフホスト型サーバーで実運用 |

展示日全体のログには準備・テストのセッションが含まれるため、人数とセッション数は概数として示しています。重大障害0件は当日の運用観察に基づき、ログだけから証明するものではありません。集計条件と証拠保全方法は[`docs/EXHIBITION_EVIDENCE.md`](docs/EXHIBITION_EVIDENCE.md)に記載しています。

## 体験の流れ

```text
QR登録 → 入力確認 → チャージ → パンチ
      → 破壊映像 → 損害額・ランク・ランキング
```

1. スマートフォンから名前を登録します。
2. 利き手にmocopiを装着し、接続状態を確認します。
3. 腕を動かしてチャージし、合図に合わせてパンチします。
4. 威力別の破壊映像と結果を展示機・スマートフォンに表示します。

## 再現デモ

[![キーボード予備入力による再現デモ](docs/images/charge-screen.png)](docs/media/keyboard-demo.mp4)

▶ [約30秒の再現デモを再生する](docs/media/keyboard-demo.mp4)

この動画は実展示の録画ではなく、公開版のローカル登録画面からキーボード予備入力でチャージ、パンチ、破壊映像、リザルトまでを再現したものです。ゲームの画面遷移と演出はmocopi入力時と共通です。公開版は音声トラックを含みません。

## 制作体制と担当

本作品は、共同制作者2名が責任を持ち、CodexとClaudeを生成AIエージェントとして活用して開発しました。人間2名が共同で課題設定、AI案の採用・修正・棄却、追加指示、受入判断、リリース判断、展示運用を担当しました。AIエージェントはマイルストーン案、コード、テスト、文書の草案作成に使用し、生成結果は人間が実行結果と実機動作を確認して採否を判断しました。

以下の担当は、設計責任、AIへの指示、生成結果の採否・修正、検証、統合を含む主担当を示します。ファイルの全行を本人だけが手入力したという意味ではありません。3名のメンターからは、設計とmocopi 1台化方針について助言を受けました。

### [maaakigai](https://github.com/maaakigai)

- システム全体の初期設計と、装着後に展示機へ戻る動作や名前の再入力を減らすスマートフォン中心の体験導線を設計。
- QRプレイヤー登録、スマートフォン操作、スコア・ランキング、WebSocket切断時のHTTP代替通信、登録端末ごとの制御トークンによる操作保護、サーバー停止時のローカル継続を実装。
- Linux / systemdへのデプロイ、HTTPS、ドメイン、リバースプロキシ、Cloudflare、ログ、バックアップ、監視、復旧手順を整備。
- ゲーム内エフェクト、チャージゲージ、全体UIの調整、展示会場のネットワーク設定と運用監視、自動・実機・負荷・継続稼働検証を担当。

### [attack114514](https://github.com/attack114514)

- 初期設計を基にMVPとゲーム操作部分を実装。
- メンターの助言を受けてmocopi 1台で動作する構成へ改良し、BLEパケット解析、Python補助プロセス、姿勢データから角速度への変換を実装。
- スコア設計、タイトル・リザルト画面、タイトルロゴ、UIを制作・改良し、Wan2.2 I2Vの生成指示、出力選定・編集を担当。
- 展示会場の設営と参加者対応を担当。

### 共同で行ったこと

スケジュールと仕様を共同管理し、mocopiを所持している側が実機依存の作業を進めました。それ以外は担当を固定しすぎず、互いに気づいた箇所を改善し、AI出力の評価、レビュー、統合も共同で行いました。

代表的な設計変更として、当初のスマートフォン同期はRESTポーリング中心でしたが、画面遷移時に不安定な挙動を確認しました。人間側からWebSocketによるサーバープッシュ優先方式への変更を提案し、AIエージェントへ再実装を指示しました。初期同期と障害時のRESTフォールバックは残し、変更後の実機確認と展示中には同現象は観測されませんでした。

ファイル・モジュール単位の主担当は[`docs/CONTRIBUTIONS.md`](docs/CONTRIBUTIONS.md)に整理しています。
開発の進め方と生成AIの利用範囲は[`docs/DEVELOPMENT_PROCESS.md`](docs/DEVELOPMENT_PROCESS.md)に整理しています。

## 技術的な特徴

| 展示で想定した課題 | 設計・実装 |
|---|---|
| センサー値の欠落やノイズ | 受信頻度、タイムアウト、欠落、静止時ノイズをMain Processで監視し、無効な入力をスコアから除外 |
| 入力方式ごとの実装差 | mocopi BLE、録画再生、キーボードを共通の`PunchInputSample`へ変換 |
| 通信障害時の展示停止 | ローカル継続モード、ローカルランキング、キーボード予備入力を用意 |
| 会場ごとの判定・演出調整 | 判定値、スコア、ランク、動画レベル、音量を`config/*.json`へ集約 |
| 描画プロセスの権限肥大化 | Main / Preload / Rendererを分離し、`contextIsolation`とsandboxを有効化。限定したAPIだけを`contextBridge`で公開 |

## mocopi 1台を主入力にした仕組み

現行の主入力では、公式アプリやUnity Bridgeを介さず、手首に装着したmocopi 1台へWindowsパソコンからBLE通信で直接接続します。

```text
mocopiの姿勢データ（約50Hz）
  → Python補助プロセスで受信・解析
  → Electron Mainで角速度と入力品質を算出
  → チャージ量・パンチ強度としてゲームへ反映
```

- バイナリパケットから手首の姿勢を表すクォータニオン（四元数）を読み取ります。暗号の復号ではなく、実機検証に基づくバイナリ解析です。
- 連続する姿勢の回転差を時間で割り、角速度（angular velocity）へ変換します。
- 角速度の積算値をチャージ量、瞬間的なピークをパンチ強度の指標として使用します。

パケット内の加速度らしき値は実機で動きに反応せず、入力には採用しませんでした。一方、静止時とパンチ時の角速度には最大値で約400倍の差があり、1台でも強弱判定に使えることを確認しました。

角速度は物理的な打撃力や手の直線速度そのものではなく、パンチの勢いをゲーム入力へ変換するための指標です。実測と判断の詳細は[`mocopi BLE信号の実機検証`](docs/technical-notes/mocopi-ble-signal-validation.md)にまとめています。

## QR登録とスコア管理

展示機が発行するセッション別QRコードをスマートフォンで読み取ると、参加者は名前を登録してゲームへ参加できます。登録後の入力待機、準備完了、結果表示までをスマートフォンと展示機で同期します。展示機で名前を直接入力する経路も同じ共有ランキングへ記録され、スマートフォンへの進行通知だけを省略します。

- スマートフォンから受け取る情報を、プレイヤー情報と操作状態に限定。
- スコアは展示機側で計算し、確定した結果だけをサーバーへ送信。
- ゲームごとの一時認証情報で結果送信を保護し、公開応答から内部IDと個別スコア履歴を除外。
- 展示版では、登録日時・最終プレイ日時と未プレイを含む登録名候補を配信し、展示機間で表示と候補を統一。
- 展示版サーバーはプレイヤーIDごとのハイスコア、プレイ回数、最終プレイ時刻を管理。
- ランキングはサーバーを正本として展示機へ配信し、通信不能時はローカル継続モードへ切り替え。

`release.bat`はQR体験を確認できる共有デモサーバーへ接続します。公開ランキングと登録名候補には合成データだけを使用し、展示当日の実データは読み込みません。新たに入力した名前は現在のデモセッションに限って使用し、公開ランキングには表示しません。共有サーバー上の一時状態は既定15分、設定上も最大4時間で削除し、登録前のQR認証情報は5分で削除します。スマートフォンではタブ単位、展示アプリではプロセス内メモリだけに保持します。

QRに含める参加トークンは、個別状態の取得と初回登録だけに使用します。登録時にスマートフォン側で別の制御トークンを生成し、サーバーはハッシュだけを保持します。準備完了、キャンセル、結果画面終了、登録解放、スマートフォンWebSocketにはこの制御トークンが必要なため、登録成立後はQRを読み取っただけの別端末から操作できません。ゲーム側の状態取得・結果送信は、さらに別のゲームトークンで認証します。送信スコアは、そのゲームへの応答にだけ`DEMO_###`の匿名名で合成され、後の公開APIからは取得できません。公開デモではイベントログを生成せず、セッション数、WebSocket接続数、本文サイズ、送信頻度にも固定上限を設けています。リポジトリにはサーバー上のユーザー情報、個別スコア、セッション履歴、管理用秘密情報を収録していません。

## アーキテクチャ

| 経路 | データの流れ |
|---|---|
| 主入力 | mocopi 1台 → BLE通信 → Python補助プロセス → ローカルUDP → Electron Main |
| 予備入力 | キーボード → Electron Main |
| 登録・スコア | スマートフォン ↔ Pythonスコアサーバー ↔ Electron Main |
| ゲーム処理 | Electron Main → Electron Renderer → 破壊映像・損害額・ランク |

旧Unity Bridge経路は、入力方式を比較・検証するための開発資産として残しています。

## 技術スタック

| 領域 | 技術 |
|---|---|
| デスクトップアプリ | Electron 43 / TypeScript 5.9 / HTML / CSS |
| ビルド | esbuild / Node.js 22.12+ |
| モーション入力 | mocopi BLE / Python補助プロセス / ローカルUDP |
| ユーザー・スコア管理 | Python / aiohttp / WebSocket |
| 旧入力経路 | Unity / C# / mocopi Receiver Plugin |
| テスト | Node.js test runner / ESLint / TypeScript |

## ローカルで試す

Node.js 22.12以上とnpmが必要です。mocopiがなくてもキーボード予備入力で体験できます。

```bash
npm ci
npm run dev -- --local-mode
```

1. タイトル画面で`START GAME`を選び、名前登録を済ませてInputCheckへ進みます。
2. InputCheck画面右下の`[ K ] KEYBOARD MODE`をクリックするか、`K`キーを押します。タイトル画面で先に切り替える場合は、`S`キーで`INPUT SETTINGS`を開きます。
3. `PROCEED`を選び、キーボード予備入力でゲームを進めます。

| キー | 動作 |
|---|---|
| `S` | タイトル画面で入力設定を開く |
| `K` / `M` | InputCheckでキーボード / mocopi入力へ切り替える |
| `Space` | チャージ中にタメを増やす |
| `Enter` | 発勁待機中にパンチ |
| `R` | 入力確認画面へリセット |
| `Esc` | タイトル画面へ戻る |

詳しい操作、mocopiの接続方法、診断表示は[`docs/CURRENT_USAGE_JA.md`](docs/CURRENT_USAGE_JA.md)を参照してください。

### Windows用ショートカット

コマンド入力なしで起動・設定できるバッチファイルも`scripts/windows/`に残しています。

| ファイル | 用途 |
|---|---|
| [`release.bat`](scripts/windows/release.bat) | QR登録を含む通常の展示用起動 |
| [`release_local.bat`](scripts/windows/release_local.bat) | サーバー停止時のローカル継続起動 |
| [`Settings.bat`](scripts/windows/Settings.bat) | スコア・音量などの設定画面 |
| [`registered-users.bat`](scripts/windows/registered-users.bat) | 管理トークン設定時の登録ユーザー確認画面 |
| [`run-dev.bat`](scripts/windows/run-dev.bat) | 開発用起動 |
| [`debug.bat`](scripts/windows/debug.bat) | 診断表示つき起動 |
| [`MocopiKeyboardEmulator.bat`](scripts/windows/MocopiKeyboardEmulator.bat) | mocopiキー入力エミュレーター |

管理一覧とサーバー全削除を許可するPCには、非公開の管理トークンをWindowsユーザー環境変数へ設定します。作成・配置・更新方法は[`CloudServer/hakkei-score-server/README.md`](CloudServer/hakkei-score-server/README.md#管理api)にまとめています。PC内のスコアリセットには管理トークンは不要です。

<details>
<summary>ローカルスコアサーバーも試す</summary>

通常起動は共有デモサーバーへ接続します。ローカル確認用のサーバープログラムは[`CloudServer/hakkei-score-server/`](CloudServer/hakkei-score-server/)として同梱しています。PC内で独立したサーバーを試す場合は次を起動し、`config/app.config.json`の`remoteSession.httpBaseUrl`と`wsUrl`をローカル接続先へ変更してください。

```bash
cd CloudServer/hakkei-score-server
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

同梱サーバーの接続先は`http://127.0.0.1:45200`、`ws://127.0.0.1:45200/ws`です。スマートフォンから使う場合は、同一LANから到達できるHTTPS/WSSのリバースプロキシまたはトンネルが必要です。

サーバーの役割、実行時データ、主なAPI、公開運用時の注意は[`CloudServer/hakkei-score-server/README.md`](CloudServer/hakkei-score-server/README.md)にまとめています。

</details>

## 品質確認

pushとpull requestでは[GitHub Actions](https://github.com/maaakigai/hakkei-lab-breaker-public/actions/workflows/ci.yml)が次を自動実行します。

```bash
npm run typecheck
npm run lint
npm test
npm run build
cd CloudServer/hakkei-score-server
python -m unittest -v test_server.py
```

Electron実起動、mocopi実機、展示ネットワーク、連続プレイはCIでは再現せず、[`HUMAN_TEST_GUIDE_JA.md`](HUMAN_TEST_GUIDE_JA.md)に沿って手動確認します。主な自動テスト対象は設定検証、UDP受信、入力データ生成、フィルター、状態遷移、スコア、発勁判定、ランキング、動画選択、公開用音声・動画assetです。

Electronの権限分離とsandbox設定の意図は[`docs/architecture/electron-security.md`](docs/architecture/electron-security.md)に記録しています。

2026年7月25日の提出前ローカル確認では、Node.js自動テスト297件、Pythonサーバーテスト23件、型検査、静的解析、クリーンビルド、公開素材検査、`npm audit`を通過しました。Releaseビルドを実起動し、ローカル登録からキーボード入力による1プレイ、Result、タイトル復帰まで完走しています。mocopi実機とスマートフォン実機は手動確認項目です。展示用音声は公開版に含まないため、音量バランスは公開版の確認対象外です。

最終監査で採用した判断と確認結果は[`docs/runs/20260725-submission-final-audit.md`](docs/runs/20260725-submission-final-audit.md)に記録しています。

<details>
<summary>ディレクトリ構成を見る</summary>

```text
src/              Electronアプリ本体
config/           入力、スコア、演出の設定
CloudServer/      登録・ランキングサーバー
assets/           映像・静止画・生成プレースホルダー音声
scripts/          ビルド、モック、Windows起動スクリプト
tools/            mocopi BLE補助プロセス・調査ツール
test/             自動テスト
docs/             仕様、検証記録、運用手順、開発資料
unity-bridge/     旧Unity入力経路と検証資産
```

</details>

## 公開版について

このリポジトリは、実装と設計判断を閲覧できるポートフォリオ用スナップショットです。開発元リポジトリは非公開のためリンクしていません。

### 展示版との差分

展示版には、最上位結果時に追加の建物映像と損害表示を出す抽選演出、および会場内向けの隠し演出がありました。公開版では、これらの実行コード、設定、映像、人物画像、専用音声を収録していません。コア体験であるmocopi入力、チャージ・パンチ判定、研究室の破壊映像、スコア、QR登録、ランキングは維持しています。

展示時は当時の会場と利用条件に照らして運用判断を行いました。一方、インターネット公開では第三者が継続的に閲覧・複製できるため、権利関係と公開条件を明示できない素材、および実在の人物・組織を想起させる演出を予防的に省略しました。これは展示時の法的評価を改めて断定するものではなく、公開・再配布条件に合わせたポートフォリオ版の整理です。

- 展示当日の実ユーザー、ランキング、セッションの保存データは、リポジトリと共有デモサーバーに含みません。元データはアクセス制限した非公開スナップショットとして保全し、公開資料には集計値とSHA-256だけを記載しています。
- 共有デモサーバーの公開URLと接続設定を含み、`release.bat`は既定でHTTPS/WSS接続、QR登録、状態同期、合成ランキングを有効にします。入力したニックネームは共有サーバーの一時セッション、スマートフォンのタブ、展示アプリのプロセス内メモリにだけ保持し、公開GETや端末の永続ランキング領域へは出しません。スコアは送信元ゲームへの応答にだけ匿名表示し、共有ランキングへ保存しません。
- `release_local.bat`は外部サーバーへ接続せず、キーボード名前入力とローカルランキングで継続するオフライン経路です。
- サーバー管理token、SSH情報、TLS・トンネル・サービス設定などの非公開な運用資格情報は含みません。
- 展示時の音声は収録していません。`assets/Sound/`以下のBGM・SFXは、PCMサンプルがすべて0の完全な無音WAVです。
- 現行プレイ用18本の研究室破壊映像は、共同制作者が撮影した研究室写真を入力に、無改変の公式`Wan-AI/Wan2.2-I2V-A14B`チェックポイントをローカル環境で使用し、2026年7月5日に各生成のプロンプトとシード値を固定して作成しました。未使用の比較候補2本は公開版から除外しました。`assets/videos/lv5_total_destruction.mp4`だけは旧開発用の2秒・単色プレースホルダーで、Wan生成物でも現行再生対象でもありません。再現デモを含む公開MP4全20本から音声トラックを除去しています。
- `assets/images/lab-backgrounds/lab-main-front-16x9-privacy.png`は、上記生成映像の
  入力にも使った4:3写真から作成した公開用背景です。元写真と無加工の16:9画像は
  非公開で保管し、公開版では白板・掲示・紙面などの情報部分をAI支援で除去しています。
  撮影者である共同制作者の同意は、ゲーム内利用、Wan I2Vへの入力、編集済み生成映像を
  含むGitHub公開・採用応募利用を含みます。
- 映像・静止画に付随して写るロゴと、損害見積に表示するメーカー名・製品名は研究室備品の識別に限って使用し、権利者による提携・推奨を示しません。
- 開発時の判断根拠、検証記録、手動確認手順は`docs/`に残しています。

素材の権利・出典は[`ASSET_LICENSES.md`](ASSET_LICENSES.md)、第三者コードは[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)、公開条件は[`NOTICE.md`](NOTICE.md)に整理しています。
