# QR登録・ランキングサーバー

`server.py`は、Electronアプリとスマートフォンの間でQR登録、セッション状態、プレイ結果、ランキングを同期するためのPythonサーバーです。ゲームロジック、スコア計算、mocopi入力処理はElectron側が担当します。

同梱版は、標準でPC内の次のアドレスに待ち受けます。

- ホスト: `127.0.0.1`
- ポート: `45200`
- HTTP: `http://127.0.0.1:45200`
- WebSocket: `ws://127.0.0.1:45200/ws`

## ローカルで起動する

```bash
cd CloudServer/hakkei-score-server
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

起動後、ルートの`config/app.config.json`にある`remoteSession.httpBaseUrl`と`wsUrl`を上記のローカル接続先へ変更します。

`127.0.0.1`はゲームPC自身からしか到達できません。スマートフォンでQR登録まで試す場合は、同一LANから到達可能なHTTPS/WSSリバースプロキシ、またはトンネルが必要です。

## 実行モードとデータ

通常モードでは、サーバーは必要に応じて`data/`以下へ次のファイルを作成します。

- `session-entries.json`
- `ranking-board.json`
- `players.json`
- `session-events.log`

これらは登録名、スコア、セッション履歴を含む実行時データのためGit管理しません。リポジトリには、内容を空にした構造例だけを収録しています。

- `session-entries.example.json`
- `ranking-board.example.json`
- `players.example.json`

この公開スナップショットは、`HAKKEI_MODE`未指定時も安全側の`public-demo`として起動します。インターネット向けのポートフォリオデモでは、設定を明示するため`HAKKEI_MODE=public-demo`を指定してください。このモードでは次のプライバシー保護を行います。

- `/api/ranking-board`と`/api/player-suggestions`は`public-demo-ranking.json`の合成データだけを返す
- 体験者が送信したスコアは、そのゲームへの応答だけに匿名化して合成し、公開GETやランキングファイルへ保存しない
- ニックネームとセッション状態は公開ランキングへ出さず、隔離した実行時ディレクトリへ既定15分、設定上も最大4時間だけ保持する。未登録のQR認証情報は5分で削除する
- QRの個別状態取得と初回登録は参加トークン、登録後のスマートフォン操作は端末生成の制御トークン、ゲーム側のWebSocketとHTTPフォールバックはゲームトークンで認証する
- スマートフォンではタブ単位の`sessionStorage`、Electronではプロセス内メモリだけに参加者情報を保持し、旧版の永続ランキングキャッシュを消去する
- 公開デモではイベントログを生成しない
- アクティブセッション、送信元ごとの更新頻度、レート制限用テーブル、WebSocket接続数・メッセージ頻度、HTTP/WebSocket本文サイズを固定上限内に収める
- セッションAPIへ`Cache-Control: private, no-store`を付ける

主な環境変数は次のとおりです。

```dotenv
HAKKEI_MODE=public-demo
HAKKEI_PUBLIC_SEED_FILE=/path/to/public-demo-ranking.json
HAKKEI_SESSION_TTL_SECONDS=900
HAKKEI_PUBLIC_MAX_ACTIVE_SESSIONS=128
HAKKEI_ADMIN_TOKEN_FILE=/path/to/.admin-token
```

`HAKKEI_MODE`は空値、`persistent`、`public-demo`だけを受け付け、不明な値では起動しません。空値は`public-demo`として扱い、永続保存は`HAKKEI_MODE=persistent`を明示した場合だけ有効です。`.public-demo-mode`と`persistent`を同時指定すると起動を拒否します。公開デモのTTLは既定900秒、設定可能な上限は14,400秒です。未登録のゲーム・参加認証情報は300秒で削除します。保存先を解決済みの標準`public-demo-runtime/`へ固定し、`HAKKEI_DATA_DIR`による別ディレクトリ指定は拒否するため、設定ミスで通常データ、バックアップ、証拠保管先、親ディレクトリの権限やファイルを変更しません。アクティブセッション数は既定128件、設定可能範囲は1〜1,000件です。systemdでは環境変数に加えて`UMask=0077`を設定してください。サーバー自身も公開ランタイムを`0700`、作成ファイルを`0600`へ固定し、起動時と定期処理で期限切れデータを削除します。

サービス管理側で環境変数を設定できない場合に限り、`server.py`と同じディレクトリへGit管理外の`.public-demo-mode`を置くと、`public-demo-runtime/`を使う同じモードで起動します。この専用ランタイムはプロセス起動時に初期化されます。

## 主なエンドポイント

- `/join`、`/license`: スマートフォン用の登録・操作画面
- `/api/session-open`: ゲームPCがランダムなゲーム認証情報でセッションを開始
- `/api/session-entry`: QRからのセッション登録・個別状態取得
- `/api/session-release`: スマートフォンが保持する端末別の制御トークンで現在の登録だけを解放。通常モードでは登録時に受け取る解放トークンを使用
- `/api/session-ready`、`/api/session-cancel`: スマートフォン側の準備・キャンセル
- `/api/player-suggestions`: 通常モードでは未プレイを含む登録名候補、公開デモモードでは合成候補
- `/api/ranking-board`、`/api/ranking-score`: ランキング取得・更新
- `/ws`: ゲームとスマートフォンへのリアルタイム通知

公開デモモードでは、`POST /api/session-open`がゲームPCだけに64桁の`joinToken`を返します。QRには`#joinToken=...`というURLフラグメントで載せるため、トークンはHTTPやプロキシのURLログへ送られません。スマートフォン画面はフラグメントを`sessionStorage`へ退避してURLから消し、個別状態の取得と初回登録では`X-Hakkei-Join-Token`として提示します。

スマートフォンは暗号学的乱数を使って端末別の`phoneControlToken`を生成し、同じタブの`sessionStorage`だけに保持します。サーバーはそのSHA-256ダイジェストだけをセッション状態へ保存します。同じプレイヤーの再登録、準備完了、キャンセル、結果画面終了、登録解放は`X-Hakkei-Phone-Control-Token`、スマートフォンWebSocketは`hakkei-phone-control.<phoneControlToken>`サブプロトコルを必要とします。したがって、同じQRを後から読み取った別端末は個別状態を閲覧できますが、登録済み端末の操作権限を取得できません。初回登録をどちらの端末が先に行うかという競合は防がないため、QRはプレイ開始時にその参加者へ提示してください。

スマートフォンのニックネーム情報も公開デモでは`sessionStorage`だけを使用し、旧版が`localStorage`へ残した値は画面起動時に削除します。ゲームPCの個別セッションGETとHTTPフォールバックは`X-Hakkei-Game-Token`が必要です。通常モードでは従来クライアントとの互換性を維持します。

`/api/session-entries`、`/api/players`、`DELETE /api/session-entry`は管理トークンが必要です。通常モードの公開ランキングはニックネーム、公開用プレイヤー番号、ハイスコア、プレイ回数、登録日時、最終プレイ日時を返します。公開デモモードでは、これらの項目をすべて合成人物の固定データへ置き換えます。登録名候補APIも内部プレイヤーIDやセッションIDを返しません。個別スコア記録は公開しません。

ランキングはオリジナル展示版と同じく、破壊映像の再生中に先行して同期します。QR登録時はゲーム認証と登録プレイヤーの一致を確認し、Result画面へ入った時点でスマートフォンへ結果を通知します。展示機で名前を手入力した場合も、同じゲーム認証を確認したうえで共有ランキングへ保存します。公開用プレイヤー番号がある場合は既存プレイヤーへ統合し、同じ結果の再送は重複登録されません。

## 共有デモサーバー

公開版の`release.bat`は、プロジェクトの共有HTTPS/WSSデモサーバーへ接続する設定です。共有サーバーは公開デモモードで運用し、展示当日の実ユーザー、ランキング、セッション履歴を読み込みません。公開ランキングと登録名候補は合成データです。

新しい体験者のニックネームは現在のデモセッションにだけ使用し、公開ランキングには表示しません。共有サーバーの一時状態は既定15分、設定上も最大4時間、未登録のQR認証情報は5分で削除します。スマートフォン側はそのタブ、Electron側はそのプロセスの存続中だけ保持します。送信スコアは、そのゲームへの応答に限って`DEMO_###`の匿名名で表示し、後の公開APIアクセスからは取得できません。この説明はスマートフォンの登録画面にも表示します。

## 管理API

`/api/admin-reset`は、サーバープロセスに`HAKKEI_ADMIN_TOKEN`が設定されていない場合は無効です。systemdの環境変数を変更しにくい場合は、`data/.admin-token`から読み込むこともできます。そのファイルは`0600`相当の権限で保護してください。

Electronの設定画面からサーバー全体をリセットする場合や、`registered-users.bat`で管理一覧を開く場合も、同じ値をElectronプロセスへ渡す必要があります。確認文字列`DELETE_ALL_HAKKEI_DATA`は誤操作防止用であり、管理トークンの代わりではありません。公開リポジトリにはトークンを収録していないため、許可する管理PCごとに環境変数を設定してください。

### 管理トークンを新しく作る

管理PCのPowerShellで暗号学的乱数32バイトから64文字のトークンを生成します。

```powershell
$tokenBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($tokenBytes)
$rng.Dispose()
$adminToken = [BitConverter]::ToString($tokenBytes).Replace("-", "").ToLowerInvariant()
```

`$adminToken`はパスワードと同じ秘密情報です。README、Git、Issue、チャット、スクリーンショットへ貼り付けないでください。

### サーバーと管理PCへ設定する

管理PCからSSHの標準入力経由でサーバーへ渡すと、トークンを画面やコマンド引数へ表示せず、`data/.admin-token`へ原子的に配置できます。

```powershell
$server = "<ssh-user>@<server-host>"
$tokenPath = "/path/to/hakkei-score-server/data/.admin-token"

$adminToken | ssh $server "umask 077; tr -d '\r\n' > '${tokenPath}.new' && chmod 600 '${tokenPath}.new' && mv '${tokenPath}.new' '$tokenPath'"

[Environment]::SetEnvironmentVariable(
  "HAKKEI_ADMIN_TOKEN",
  $adminToken,
  "User"
)

Remove-Variable adminToken, tokenBytes, rng, tokenPath
ssh -t $server "sudo systemctl restart <score-server-service-name>"
Remove-Variable server
```

`Settings.bat`と`registered-users.bat`は、プロセス環境にトークンがなければこのユーザー環境変数を読み込みます。`npm run settings`を既に開いていたターミナルから直接実行する場合は、ターミナルを開き直してください。

トークンを作り直す場合は、サーバーと許可済み管理PCの両方を同じ新しい値へ更新します。古い値は更新後に利用できなくなります。サービス再起動では進行中のQRセッション認証も消えるため、プレイ中の利用者がいない時間に行ってください。トークンはサービスの環境変数または保護した環境ファイルに保存し、リポジトリへ登録しないでください。

## サーバーテスト

```bash
cd CloudServer/hakkei-score-server
pip install -r requirements.txt
python -m unittest -v test_server.py
```

テストでは、管理一覧と削除の認証、本人セッションだけの解放、ゲーム認証、QR登録プレイヤーとの一致、動画中のランキング先行同期、手入力スコアの既存プレイヤーへの統合、再送時の重複防止、公開応答からの内部情報除外を確認します。加えて、公開デモモードで実データファイルを読み書きせず、合成データだけを返すこと、イベントログを生成しないこと、参加トークンだけでは登録後の操作やスマートフォンWebSocketを使えないこと、制御トークンを平文保存しないこと、セッション・レート・接続数・本文サイズの上限を確認します。2026年7月25日の提出前確認では23件すべて成功しました。

## 公開運用時の注意

このサーバーは展示・デモ向けの小規模な実装です。公開デモモードでは`/api/session-open`を送信元ごとに毎分12回、全送信元合計で毎分6回に制限し、IPv6は送信元を`/64`単位で集約します。アクティブセッションは既定128件、WebSocketは全体256接続かつ1セッション2接続までとし、ほかのREST/WebSocketハンドシェイク、メッセージ頻度、本文サイズにも固定上限があります。`CF-Connecting-IP`はaiohttpへの直接接続元がloopbackの場合だけ参照するため、前段プロキシは外部から受け取った同名ヘッダーをそのまま転送せず、信頼できる接続情報で上書きするか削除してください。

`/api/session-open`自体は配備秘密情報を要求しないため、多数の分散送信元による可用性攻撃を完全には防ぎません。インターネットへ公開する場合は、用途に応じて次も用意してください。

- HTTPS/WSSのTLS終端
- 前段プロキシまたはCDNでの追加レート制限、オリジン到達元の制限
- 通常モードで個人データを保持する場合の保存期間、アクセス制御、バックアップ方針
- ログ監視とプロセス監視

公開環境固有のCloudflare Tunnel設定、ドメイン設定、認証情報、実ユーザーデータは、このリポジトリには含めていません。
