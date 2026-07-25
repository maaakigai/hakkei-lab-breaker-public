# QR登録・ランキングサーバー

`server.py`は、Electronアプリとスマートフォンの間でQR登録、セッション状態、プレイ結果、ランキングを同期する小規模な展示用サーバーです。ゲームロジック、スコア計算、mocopi入力処理はElectron側が担当します。

既定の待受先は次のとおりです。

- HTTP: `http://127.0.0.1:45200`
- WebSocket: `ws://127.0.0.1:45200/ws`
- 主系: WebSocket
- フォールバック: HTTP

## 起動

```bash
cd CloudServer/hakkei-score-server
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

未指定時の実行時保存先は`data/submission-runtime/`です。合成初期データを収録する`data/`直下とは分離しており、`HAKKEI_DATA_DIR`へ`data/`自体を指定すると起動を拒否します。

Internetへ接続する運用では既定値に依存せず、旧展示データとは別のアクセス制限したディレクトリを明示してください。

```bash
sudo install -d -m 700 -o <service-user> -g <service-group> \
  /srv/hakkei/private/submission-runtime
export HAKKEI_DATA_DIR=/srv/hakkei/private/submission-runtime
python server.py
```

## セッション契約

QRには十分長く推測困難な`sessionId`を含む`/join?sessionId=...`を表示します。ゲーム、スマートフォン、サーバーは同じ`sessionId`で状態を共有します。

展示版と同じ単純な契約へ戻しているため、次の認証機構はありません。

- game token
- join token
- phone control token
- session-open / session-release token
- admin token
- `PUBLIC_DEMO_MODE`

`/ws?client=game|phone&sessionId=...`が主経路です。WebSocketが利用できない場合は同じ`sessionId`を使うHTTP APIへフォールバックします。

## 永続データ

実行時に次のファイルを`HAKKEI_DATA_DIR`へ原子的に保存します。

- `session-entries.json`
- `players.json`
- `ranking-board.json`
- `session-events.log`

実行時JSONとログは`.gitignore`対象です。リポジトリには`PLAYER 001`から`PLAYER 010`までの合成初期データだけを収録しています。

- `data/session-entries.example.json`
- `data/players.example.json`
- `data/ranking-board.example.json`

3つの実行時JSONが1つも存在しない完全な初回起動時だけ、`players.example.json`と`ranking-board.example.json`を合成初期データとして読み込みます。いずれかの実行時JSONが存在する場合は既存データを優先し、初期データを再投入しません。実データや展示履歴を公開リポジトリへコピーしないでください。

### 運用先へ反映する前のデータ分離

旧版の`data/session-entries.json`、`data/players.json`、`data/ranking-board.json`がサーバー内に残っていても、提出版の実行時ディレクトリへ移動・コピーしないでください。旧データは非公開証拠としてアクセス制限した保全先へ残し、提出版には新規ディレクトリを使用します。

systemdでは、サービスの環境変数として同じ保存先を指定します。

```ini
[Service]
Environment=HAKKEI_DATA_DIR=/srv/hakkei/private/submission-runtime
UMask=0077
```

反映手順は次の順番で行います。

1. 前段プロキシからの新規受付と旧サービスを停止する。
2. 旧プログラム、旧実行時データ、設定を非公開でバックアップし、保全コピーのSHA-256を確認する。
3. 旧データと別の空ディレクトリを権限`0700`で作成し、`HAKKEI_DATA_DIR`へ設定する。
4. 提出版を起動し、同じ環境変数で`manage.py list`を実行する。
5. `dataDirectory`が新規ディレクトリであり、プレイヤー名が`PLAYER 001`から`PLAYER 010`までの10件だけであることを確認する。
6. ループバックからランキング、QR登録、WebSocketを確認した後に前段プロキシを再開する。

```bash
HAKKEI_DATA_DIR=/srv/hakkei/private/submission-runtime \
  python manage.py list
```

`manage.py`へサービスと異なる`HAKKEI_DATA_DIR`を渡すと別データを操作するため、常にsystemdと同じ値を使用してください。
プログラム更新用のコピーや`rsync --delete`には実行時ディレクトリを含めず、コード更新と保存データ管理を分離してください。

## 公開API

- `GET /join`、`GET /license`: スマートフォン画面
- `POST /api/session-entry`: ニックネーム登録
- `GET /api/session-entry?sessionId=...`: 当該セッション状態
- `POST /api/session-ready`、`POST /api/session-cancel`
- `POST /api/session-input-check`、`POST /api/session-input-ready`、`POST /api/session-input-exit`
- `POST /api/session-result`、`POST /api/session-result-exit`
- `GET /api/player-suggestions`
- `GET /api/ranking-board`、`POST /api/ranking-score`
- `GET /ws`

ランキングと候補APIが返すプレイヤー項目は次の6フィールドです。

- `nickname`
- `playerNumber`
- `registeredAtMs`
- `lastPlayedAtMs`
- `highScore`
- `playCount`

ランキングAPIだけは、ハイスコアを出した回の表示用Critical加算として`highScoreCriticalBonusYen`も返します。これは非負整数の10進文字列です。候補APIには含めません。内部`playerId`、セッション一覧、個別スコア記録は公開しません。

`POST /api/ranking-score`の成功応答だけは、送信したプレイヤーの行を結果画面で照合するため、トップレベルに`submittedPlayerNumber`を返します。この値は同じ応答内ですでに公開されている`playerNumber`のいずれかであり、`GET /api/ranking-board`には含めません。

次の管理・削除HTTP APIは実装せず、アクセスしても404です。

- 全データreset
- 全セッション一覧
- private player一覧
- セッションまたはプレイヤーの削除

管理は、SSH接続後にサーバー内で`manage.py`を直接実行します。HTTP管理APIと管理Web UIはありません。

```bash
# 非公開playerIdを含むサーバー内一覧
python manage.py list

# 1名と、そのランキング記録・セッションを削除
python manage.py delete-player remote-example-id --confirm DELETE_PLAYER_DATA

# 全ランタイムデータとイベントログを空にする
python manage.py reset --confirm DELETE_ALL_HAKKEI_DATA
```

`delete-player`と`reset`は書き込みを行うため、前段プロキシからの新規受付とサーバープロセスを停止し、対象データディレクトリのバックアップを作成してから実行してください。`reset`後は空のJSONを残すため、合成初期データが勝手に再投入されることはありません。

## ランキング計算

wire上の`record.score`は互換性のため残した名前で、意味は`baseDamageYen`です。`record.baseDamageYen`を併記する場合は同じ値でなければ拒否します。

Criticalの金額は`criticalBonusYen`へ別に保存し、`damageYen = baseDamageYen + criticalBonusYen`を検証します。ランキング順と`highScore`にはbaseだけを使い、Criticalボーナスを加えません。同じプレイヤー、プレイ日時、base、総額、Criticalボーナス、ランク、動画レベルの再送は1件として扱います。

## イベントログ

`session-events.log`はサーバー内の運用確認用です。ニックネーム、`playerName`、HTTP request body、payloadは記録しません。HTTPアクセスログはサーバー本体では無効です。

## テスト

```bash
cd CloudServer/hakkei-score-server
pip install -r requirements.txt
python -m unittest -v test_server.py
```

テストでは、初回の合成データ投入と再投入防止、永続化、WebSocket主系とHTTPフォールバック、入力サイズとschema、ランキング再送の冪等性、Criticalを順位へ加えないこと、公開応答のfield制限、管理・削除HTTP APIの404、サーバーローカル管理、ログの非記録項目を確認します。

## Internetへ接続する場合

この契約では`sessionId`以外の認証情報を使用しません。公開する場合は、十分長いランダムなsessionId、HTTPS/WSS、前段プロキシでのrate limit、オリジン到達元の制限、保存期間とバックアップ方針を用意してください。実行時データ、バックアップ、展示証拠はWeb公開ディレクトリの外に置いてください。
