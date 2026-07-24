
# docs/verification_checklist.md

> **旧版注意（Unity Bridge / Calibration 版）**
>
> このチェックリストは旧 Unity Bridge / `MotionSample` / Calibration / 上下・前後チャージ前提です。
> 2026-06-28時点の現行本線は **mocopi 1台 BLE直読・単手パンチ・`PunchInputSample`・magnitude-only** です。
> 現行版の確認には [verification_checklist_v2_ble.md](../../verification_checklist_v2_ble.md) を使ってください。
>
> 旧版との差異: 現行版では Unity Bridge Gate、`validForCalibration`、Vertical/Forward別validSampleRatioではなく、BLE Probe、sidecar、静止10秒false trigger 0、単一Charge、intensity peakを確認します。

技術Gate確認用チェックリストです。運用、安全誘導、配布手順はここでは扱いません。

## Settings: サーバー/このPCのランキング全削除

- サーバープロセスとSettings起動環境の両方へ、同じ非公開の`HAKKEI_ADMIN_TOKEN`を設定する。トークン未設定の公開版では全削除は拒否される。
- `scripts/windows/Settings.bat` を起動する。
- 「ランキング記録」セクションの「サーバーも含めて全削除」入力欄に `DELETE_ALL_HAKKEI_DATA` と入力する。
- 右側の「実行」ボタンが有効になったことを確認してクリックする。
- 成功条件: 画面上部に「サーバーとこのPCのユーザー台帳/ID/スコア記録をすべてリセットしました」と表示され、同じセクションの登録ユーザー/プレイ履歴が0になる。
- 削除後、新規ユーザーを1人登録すると `https://score.example.com/api/players` の `playerNumber` が `26001` から再採番される。
- 失敗時確認: 画面上部の赤いステータスに表示されるHTTPステータス、管理トークン未設定、または通信エラーを確認する。サーバー本番データを消す操作なので、展示前など削除してよいタイミングでだけ実行する。

## 共通記録

```text
日付:
確認者:
PC / OS:
アプリ版:
Unity Bridge版:
activeMode:
source:
sessionId:
lastSeq:
motionHz:
heartbeatHz:
heartbeat timeout: yes / no
motion timeout: yes / no
validSampleRatioByPhase: Vertical / Forward / HakkeiReady
rawJitterRms2s:
rawMaxJitter2s:
rawDrift2s:
filteredJitterRms2s:
filteredMaxJitter2s:
filteredDrift2s:
staticFalseHakkeiCount10s:
Gate: A / B1 / B2 / C / D1 / D2
結果: PASS / FAIL
失敗理由:
ログ/スクリーンショット:
```

## Gate A

- [ ] `activeMode="keyboard"`。
- [ ] Keyboard入力がMain生成 `MotionSample.source="keyboard"` として流れる。
- [ ] Enterは直接Impactへ飛ばず、通常Hakkei判定を通る。
- [ ] TitleからResultまで10回連続完走。
- [ ] 動画Lv0〜Lv5境界確認済み。
- [ ] VideoPlaybackで見出しや枠ではなく、画面全体が破壊動画に切り替わる。
- [ ] DebugのLv強制は直接動画へ飛ばず、InputCheckから通常フローを通ってVideoPlaybackへ入る。
- [ ] Titleの `RANKING BOARD` から一覧を開ける。
- [ ] Titleの `START GAME` で直接InputCheckへ進まず、Register画面が開く。
- [ ] Register画面ではゲームタイトルロゴが表示されない。
- [ ] Register画面ではBACKボタンが表示されない。
- [ ] Register画面でEscキーを押すとTitleへ戻る。
- [ ] InputCheckでEscキーを押すとRegister画面へ戻る。
- [ ] InputCheck右下の `[ Esc ]` コマンドが直前画面の名前を表示し、クリックでもその画面へ戻る。
- [ ] InputCheck右下のデバッグヒントが直前画面の名前を使って `Esc=REGISTRATION` のように表示される。
- [ ] Register画面上部に `REGISTRATION` が表示される。
- [ ] Register画面中央に `SCAN HERE` と実QRコードが表示される。
- [ ] Register画面のQR下に `https://score.example.com/join?sessionId=...` が表示される。
- [ ] Register画面表示中、Electron側 `logs/state-YYYYMMDD.log` の `[REMOTE]` に `ws status=connecting` から `ws status=open` が出る。
- [ ] スマホでQRを読むと英語の `Hakkei Score` 登録ページが開く。
- [ ] スマホLicense画面を開くとサーバーのWebSocket `/ws?client=phone&sessionId=...` に接続し、`session.snapshot` で `CONNECTING` / `ARE YOU READY?` / `RESULT` 表示が更新される。
- [ ] スマホ登録ページの名前入力は小文字を大文字に変換し、日本語や許可外記号では `USE HALF-WIDTH A-Z, 0-9, ., _ OR -.` が表示される。
- [ ] スマホ登録ページでは `PLAYER.01` のように `.` を含む名前を登録できる。
- [ ] スマホで名前登録すると、ElectronのRegister画面が自動でInputCheckへ進む。
- [ ] InputCheckでmocopi BLEが `CONNECTED` になると、Electron側に `PROCEED` が表示される。
- [ ] InputCheckでmocopi BLE未接続または `CONNECTION ERROR` の間は、Electron側の `PROCEED` が表示・押下できず、Enterキーでも次へ進まない。
- [ ] QR登録直後のスマホLicense画面では、ゲーム側がInputCheckへ変わるまで `I'M READY` ボタンが表示されない。
- [ ] ゲーム側がInputCheckへ変わっても入力機器が未接続の場合、スマホLicense画面には `CONNECTING` / `WAITING FOR INPUT DEVICE` のモーダルが表示され、`I'M READY` はまだ表示されない。
- [ ] InputCheckがmocopi未接続で `CONNECTING` 表示中にゲーム側をKeyboardへ切り替えると、スマホ側は `ARE YOU READY?` モーダルへ切り替わる。
- [ ] InputCheckでmocopi BLEが `CONNECTED` / `PROCEED` の状態からゲーム側をKeyboardへ切り替えても、スマホ側は `CONNECTING` のまま残らず `ARE YOU READY?` モーダルを表示する。
- [ ] InputCheckで `mocopi未接続 -> Keyboard ready -> mocopi未接続` と切り替えると、スマホ側は `ARE YOU READY?` から `CONNECTING` へ戻る。
- [ ] InputCheck中にゲーム側の入力機器を切り替えると、スマホ側は一度 `CONNECTING` へ戻り、切替後の入力機器が準備完了になってから `ARE YOU READY?` へ切り替わる。
- [ ] `scripts/windows/Settings.bat` の `接続確認` で `現在受信中だけready（安全）` を選ぶと、mocopi BLE停止から設定window経過後にゲーム側/スマホ側が未接続扱いへ戻る。
- [ ] `scripts/windows/Settings.bat` の `接続確認` で `一度受信したらready維持（旧仕様）` を選ぶと、InputCheck中に一度mocopi BLEを受信した後は旧仕様どおりready表示を維持する。
- [ ] QR登録後、ElectronのRegister画面からInputCheckへの自動遷移とスマホ側CONNECTING/READY表示の切り替わりが概ね1秒以内に反映される。
- [ ] スマホ側 `CONNECTING` モーダルの `CANCEL` を押すとElectronはRegister画面へ戻り、スマホ側は `SESSION CANCELED. SCAN THE GAME QR AGAIN.` を表示する。
- [ ] ゲーム側がInputCheck以外の画面へ進んだ後にスマホページをリロードしても、古い `CONNECTING` モーダルは再表示されない。
- [ ] ゲーム側がInputCheckへ変わった後、スマホLicense画面上に `ARE YOU READY?` モーダルダイアログが開き、そこに `I'M READY` ボタンが表示される。
- [ ] スマホ側 `ARE YOU READY?` モーダルの副ボタンは `CANCEL` と表示され、押すとQRスキャナーダイアログが再表示される。
- [ ] ゲーム側がInputCheck表示中にスマホ側 `ARE YOU READY?` の `CANCEL` を押すと、ElectronはRegister画面へ戻り、新しいQRを表示する。
- [ ] スマホ側 `ARE YOU READY?` の `CANCEL` 後、スマホ側は `SESSION CANCELED. SCAN THE GAME QR AGAIN.` を表示し、`WAITING FOR GAME SCREEN...` を残さない。
- [ ] キャンセル済みsessionの `/join?sessionId=...` または `/license?sessionId=...` をリロードしても、`ARE YOU READY?` やdevice-waitは再表示されず、CANCELED表示へ復元される。
- [ ] スマホ側 `ARE YOU READY?` の `CANCEL` 後にQRを再スキャンすると、古いCancel状態に引っ張られず再び `ARE YOU READY?` が表示される。
- [ ] スマホ側 `ARE YOU READY?` または `CONNECTING` の `CANCEL` 後、ゲーム側がREGISTRATIONへ戻ったら新しいQRを読み直す。スマホ側が `CONNECTING` のまま止まらず、入力機器準備後に `ARE YOU READY?` へ進む。
- [ ] 上記の再スキャン後に `I'M READY` を押しても `ENTRY NOT FOUND` が表示されず、ElectronがReady画面へ進む。
- [ ] ゲーム開始後にゲーム側 `Esc` でREGISTRATIONへ戻り、スマホ側で `SCAN QR` を押してもQRスキャナーが短時間で勝手に閉じない。これを3回繰り返してもカメラが開いたまま読み取り待ちになる。
- [ ] 再発時はElectron側 `logs/state-YYYYMMDD.log` の `[REMOTE]` 行で `fetch entry`、`input-check notify ok`、`input-ready notify ok`、`phone ready -> inputOk` を確認し、スコアサーバー側 `data/session-events.log` に `ready_missing_entry` / `cancel_missing_entry` / `entry_register` が出ていないか確認する。
- [ ] InputCheckでmocopi BLEが `CONNECTED` の状態でスマホの `I'M READY` を押すと、ElectronがReady画面へ進む。
- [ ] WebSocket接続中はスマホの `I'M READY` 押下から1秒以内にElectronがReady画面へ進む。
- [ ] WebSocketを一時的に切断しても、REST fallback pollingでREADY / CANCEL / Result EXITが従来どおり動く。
- [ ] スマホの `I'M READY` 押下後は `ARE YOU READY?` ダイアログが閉じ、スマホ側は `PLAYING. WATCH THE GAME SCREEN.` を表示し、CANCELボタンは表示されない。
- [ ] ゲーム進行中に `/api/session-cancel` が直接呼ばれてもHTTP 409になり、sessionに `cancelAtMs` が残らず、ElectronはResultまで進行する。
- [ ] スマホの `I'M READY` をmocopi BLE接続前に押した場合は、BLEが `CONNECTED` になったタイミングでElectronがReady画面へ進む。
- [ ] 古いQRまたは別sessionのスマホ画面で `I'M READY` を押しても、現在のElectron画面は進まない。
- [ ] 同じQR/sessionを同じスマホ/playerでリロードまたは再登録しても、既存登録として扱われ、Electronの現在プレイヤーが変わらない。
- [ ] 同じQR/sessionを別スマホ/playerで登録しようとすると、サーバーはHTTP 409または `server.error` を返し、既存entryの `playerId` / `nickname` が上書きされない。
- [ ] 同じQR/sessionへ別player登録を試した後、その別player側の `I'M READY` / `CANCEL` / `EXIT` が現在のElectron画面に影響しない。
- [ ] スマホ登録で `player01` と入れた場合、Ranking BoardのNickname列は `PLAYER01` になる。
- [ ] Register画面に入力モード切替UIが表示されない。
- [ ] Register画面の青い `Nickname` ラベルが表示されず、入力欄とJOINボタンが中央に揃っている。
- [ ] TitleのInput Settingsでは従来どおり入力モードを切り替えられる。
- [ ] Register画面で登録済みnicknameの先頭文字をローマ字入力すると、入力欄の下に前方一致候補が表示される。
- [ ] Register画面のnickname候補に `ID26001` のような表示IDとnicknameが表示される。
- [ ] アプリ再起動直後でも、Register画面を開いてサーバー登録済みnicknameの先頭文字を入力すると候補が表示される。
- [ ] アプリ再起動直後でも、Ranking Boardにスコアが残っているnicknameの先頭文字を入力すると候補が表示される。
- [ ] Register画面のnickname候補は最大8件まで表示される。
- [ ] Register画面のnickname候補は、入力文字が増えるごとに絞り込まれる。
- [ ] Register画面のnickname候補をクリックすると、その名前で入力欄が埋まる。
- [ ] Register画面のnickname候補は、EnterでJOINするか候補をクリックした後に消える。
- [ ] `A` が登録済みでも、入力欄に `A` と入れた時は `AAA` や `ABC` のような前方一致候補が表示される。
- [ ] `A` のような1文字nicknameで `JOIN GAME` するとInputCheckへ進む。
- [ ] 空欄や `PLAYER01!` ではJoinできず、nicknameエラーが表示される。
- [ ] `JOIN GAME` がInputCheckの `PROCEED` と同じ雰囲気のボタンで表示される。
- [ ] `PLAYER01` など有効なnicknameで `JOIN GAME` するとInputCheckへ進む。
- [ ] 同じnicknameを大小違いで入力してもRanking Boardに別プレイヤー行が増えない。
- [ ] Ranking BoardのNickname列とCurrent local playerは小文字入力でも大文字で表示される。
- [ ] 未プレイ時は `No scores recorded yet.` が表示される。
- [ ] Result到達後、Registerで選んだnicknameの `High Score` がRanking Boardに保存される。
- [ ] Result画面には今回スコアのRanking Board順位を表示しない。
- [ ] Result到達後、動画再生中に開始したランキング同期により、Ranking Board画面には最新High Scoreが反映される。
- [ ] High Score更新時、Result画面のTOTAL DAMAGE金額の下に `NEW HIGH SCORE` だけが表示される。
- [ ] High Score更新なしのResultではHigh Score通知が表示されない。
- [ ] Result画面の `LAB DAMAGE ESTIMATE` と `EXIT` の間に自己ベスト/順位カードが表示される。
- [ ] High Score更新時、自己ベスト/順位カードの見出しが `RANK UPDATE` になり、`PREVIOUS #n → CURRENT #m` が表示され、順位が上がった場合だけ `CURRENT` 側に `↑` が付く。
- [ ] High Score更新なしのResultでは、自己ベスト/順位カードの見出しが `PERSONAL BEST RESULT` になり、`BEST DAMAGE` と過去High Score、改行した `RANK` と自己ベスト順位が表示され、順位番号はHigh Score金額と同じ強さで目立つ。
- [ ] ResultのRanking Board順位色は `#1` が金、`#2` が銀、`#3` が銅の質感になり、`#4`〜`#9` がRank A色、`#10`〜`#15` がRank B色、`#16`〜`#20` がRank C色、`#21`〜`#25` がRank D色、`#26`以降がRank E色になる。
- [ ] Ranking Board同期中は `RANKING BOARD SYNCING...`、通信失敗時は `RANKING BOARD UNAVAILABLE` が表示され、古い順位を現在順位として表示しない。
- [ ] Ranking Boardの表示はローカルテストデータではなく、`https://score.example.com/api/ranking-board` のサーバーランキングだけを表示する。
- [ ] Ranking Boardに `ID26001` のようなID列が表示され、名前入力候補のIDと一致する。
- [ ] `https://score.example.com/api/players` がユーザー台帳として `playerNumber`、`playerId`、`nickname` を返す。
- [ ] 新規ユーザー登録時、`playerNumber` は `26001`〜`26999` の未使用番号で採番される。
- [ ] Result到達後、スコアが `https://score.example.com/api/ranking-score` へ送信され、別端末/再起動後のRanking Boardにも反映される。
- [ ] 同じユーザーが複数回遊んでもRanking Boardには1行だけ表示される。
- [ ] `Registered` と `Last Played` が `3 minutes ago` のような相対時間で表示される。
- [ ] 低いスコアで再プレイしてもRanking Boardの `High Score` が下がらない。
- [ ] 高いスコアで再プレイするとResultに `New High Score!` が表示される。
- [ ] Result画面にはRankやRanking Board形式の情報は表示されず、High Score更新時の通知だけが出る。
- [ ] ゲームがResult画面へ到達すると、スマホLicense画面に `RESULT` ダイアログが表示され、損害額が表示される。
- [ ] ゲームがResult画面へ到達してから、スマホLicense画面の `RESULT` ダイアログが概ね1秒以内に表示される。
- [ ] スマホResultダイアログの `EXIT` を押すと、スマホはダイアログを閉じてLicense画面へ戻り、ゲーム側はResultからTitleへ戻る。
- [ ] ゲーム側Resultの `Exit` や `Play Again` を押しても、スマホ側のLicense画面やResultダイアログ表示はゲーム操作に追従して消えない。
- [ ] ゲーム側が先に `Exit` または `Play Again` でResultを離れた後にスマホResultダイアログの `EXIT` を押しても、現在のゲーム画面には影響しない。
- [ ] `scripts/windows/Settings.bat` の設定GUIに `ランキング記録` が表示される。
- [ ] 設定GUIの `このPCのユーザー/スコア記録をリセット` でこのPCの登録ユーザー、High Score、プレイ履歴が消える。
- [ ] 設定GUIの `サーバー台帳も含めて全削除` は確認文字列なしでは実行されず、確認文字列入力後にサーバーのユーザー台帳、ID採番、QR session、ランキング、このPCのランキング記録を削除する。
- [ ] サーバー全削除後、新規登録した最初のユーザーに `ID26001` が割り振られる。
- [ ] `scripts/windows/registered-users.bat` でElectronの登録ユーザー一覧GUIが開く。
- [ ] 登録ユーザー一覧GUIに `最新ユーザー` と `直近session登録` が表示される。
- [ ] 登録ユーザー一覧GUIの `更新` ボタンで `https://score.example.com` の最新登録が再取得される。
- [ ] アプリ起動直後の1回目の `START GAME` でRegistration画面にQRコードが表示される。
- [ ] Titleへ戻って再度 `START GAME` してもRegistration画面にQRコードが表示される。

## Gate B1

- [ ] （前提）`UnityBridge.unity` に `MocopiReceiverStatusBridge` を配置し、`mocopiAvatar`=MocopiAvatar、`RightHandUdpSender.receiverStatusSourceBehaviour`=その Bridge を割当（未割当だと receiverStatus が簡易推定になる）。
- [ ] `Assets/Scripts/*.cs` がUnity Editorでコンパイルエラー無し。
- [ ] Unity BridgeがReceiver Pluginでmotionを受ける。
- [ ] RightHand Transformが取得できる。
- [ ] motion/heartbeatに `protocolVersion`、`sessionId`、`timestampMs`、`source` がある。
- [ ] heartbeatに `receiverReady`、`receiverStatus`、`avatarReady`、`rightHandReady`、`frameRate`、`sendRateHz` がある。

## Gate B2

- [ ] `activeMode="unity-bridge"`。
- [ ] 実Unity BridgeのpacketだけでInputCheck OK。
- [ ] MockだけでPASSにしていない。
- [ ] `seq` 欠損、duplicate、rollback、gapの表示が固定codeで出る。
- [ ] `motion:heartbeat`、`motion:status`、`motion:session-changed` がpreload API経由で届く。

## Gate C

- [ ] Calibration neutralはdiscard後2秒、40valid sample以上。
- [ ] Calibration forwardはdiscard後1秒、20valid sample以上、forward距離0.15m以上。
- [ ] Unity実入力で上下チャージ、前後チャージが増える。
- [ ] source切替時に古いwarning/errorがclearされる。

## Gate D1

- [ ] `activeMode="unity-bridge"`。
- [ ] motionHz平均30Hz以上。
- [ ] heartbeatHz 1Hz以上、timeoutなし。
- [ ] Vertical/Forward validSampleRatio 0.95以上。
- [ ] HakkeiReady validSampleRatio 0.90以上。
- [ ] `rawJitterRms2s <= 0.05m`。
- [ ] `rawMaxJitter2s <= 0.12m`。
- [ ] `filteredJitterRms2s <= 0.03m`。
- [ ] `filteredMaxJitter2s <= 0.08m`。
- [ ] `filteredDrift2s <= 0.05m`。
- [ ] Diagnosticsの `static-hakkei-false-positive-test` で `staticFalseHakkeiCount10s=0`。
- [ ] 実playで上下、前後、発勁、動画、Resultが成立。

## Gate D2

- [ ] `activeMode="keyboard"`。
- [ ] Keyboard fallbackとして10回連続完走。
- [ ] Gate D1を通った扱いにしていない。
- [ ] Unity由来warning/errorが `app:error-clear` で消える。

# 2026-07-09 InputCheck display alignment

- [ ] Start with `scripts/windows/release.bat`.
- [ ] The release main window is fullscreen，with no Electron menu bar and no Windows taskbar over the app.
- [ ] On InputCheck，the status ring，status title，`PROCEED` button，and phone-ready text share the same horizontal center.
- [ ] Start with `scripts/windows/debug.bat`.
- [ ] The debug window still opens as a normal development window.
