# 20260707 QR registration

- 対象ステップ: QR player registration for Ranking Board.
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `src/renderer/index.html`, `package.json`, `package-lock.json`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`.
- サーバー側変更: `/srv/hakkei-score-server/server.py`, `/etc/systemd/system/hakkei-score.service`（既存service継続利用）。
- 採用した判断: Register画面を開くたびに `hakkei-...` の一時 `sessionId` を生成し、QR URLを `https://score.example.com/join?sessionId=...` にする。Electronは `GET /api/session-entry?sessionId=...` を1.5秒間隔でポーリングし、登録済み名が来たら既存の `submitRegisterNickname()` に渡す。
- 理由・根拠: スマホからスコア値を送らせず、プレイヤー名だけを外部サーバーで受けることで、既存のElectron内スコア計算・ランキング保存境界を維持するため。WebSocketは初期実装では不要で、会場確認ではポーリングの方が失敗箇所を切り分けやすい。
- 採用した判断: QR生成は `qrcode` npm packageを使い、Rendererでcanvasへ描画する。CSPには `connect-src 'self' https://score.example.com` を追加した。
- 理由・根拠: QR符号化を自作すると読み取り不能時の原因が増えるため、既存ライブラリへ寄せる。外部通信は登録APIに限定し、CSPで接続先を明示する。
- 採用した判断: スマホ登録ページとサーバーvalidatorは `A-Z0-9_-` の1〜16文字だけを受理し、小文字は大文字へ正規化する。サイト表示は英語へ変更した。
- 理由・根拠: ゲーム側のNickname契約が大文字ローマ字系に限定されているため、スマホ登録でも同じ契約に揃え、Electron側で別の正規化ルールを増やさないため。
- 確認結果: `npm run typecheck` PASS。`npm run lint` PASS。`node --test test/ranking-store.test.mjs` PASS。`npm run build` PASS。
- サーバー確認結果: `https://score.example.com/api/session-entry` へ `playerName=player_01` をPOSTすると `PLAYER_01` として保存される。`playerName=日本語名` はHTTP 400で拒否される。`https://score.example.com/join?sessionId=case-test` は英語ページを返す。
- 手動確認: `npm run dev:debug` でTitleから `START GAME` を選び、Register画面のQRをスマホで読む。スマホで `player01` を登録し、ElectronがInputCheckへ自動遷移することを見る。Ranking Boardでは `PLAYER01` と表示されることを見る。
- 残課題: 実スコア登録サーバーはJSONファイル保存の最小実装。セッション期限切れ、登録済みentryの掃除、Electron側のオフライン表示改善は後続。

## 2026-07-07 phone page visual alignment

- サーバー側変更: `/srv/hakkei-score-server/server.py`, `/srv/hakkei-score-server/assets/title/logo.png`。
- 採用した判断: スマホ登録ページの見出しを `REGISTRATION` に変更し、`Hakkei Score` 表示を削除した。ページ最上部にはゲーム内と同じ `assets/images/title/logo.png` をコピーして `/assets/title/logo.png` で配信する。
- 理由・根拠: QR登録はゲーム内Register画面の延長導線なので、スマホ側だけ別ブランド表示にすると操作担当者と参加者の認識がずれるため。ゲーム内の登録画面と同じロゴ・暗色背景・発光ライン・大文字UIへ寄せた。
- 確認結果: `https://score.example.com/join?sessionId=ui-test-2` が `REGISTRATION` と `ENTER YOUR NAME` を返し、`Hakkei Score` を返さないことを確認。`https://score.example.com/assets/title/logo.png` はHTTP 200、`Content-Type: image/png`、`Content-Length: 294915`。

## 2026-07-07 license page split

- サーバー側変更: `/srv/hakkei-score-server/server.py`。
- 採用した判断: 初回または保存済みlicenseなしの端末は `/join?sessionId=...` の `REGISTRATION` を表示する。保存済みlicenseがある端末がQRを開いた場合は `/license?sessionId=...` へリダイレクトし、`LICENSE` ページで現在の名前を表示する。
- 採用した判断: `CHANGE NAME` はRegistrationから削除し、Licenseページだけに置いた。押下時はHTML dialogで新しい名前を入力し、保存済みlicenseと現在sessionのentryを更新する。
- 採用した判断: 誤登録対策として `DELETE LICENSE` をLicenseページに置いた。押下時は端末のlocalStorageを削除し、現在sessionのentryも `DELETE /api/session-entry?sessionId=...` で削除してからRegistrationへ戻す。
- 理由・根拠: 初回登録と登録済みユーザーの操作を分けることで、初回画面を単純化しつつ、名前変更・削除のような管理操作を登録済みユーザーだけに見せるため。サーバーentryも削除しないとElectron側ポーリングが古い名前を拾うため、DELETE APIを追加した。
- 確認結果: `/license?sessionId=flow-test` がHTTP 200。`DELETE /api/session-entry?sessionId=delete-test` 後に同sessionのGETがHTTP 404になることを確認。

## 2026-07-07 remote player id ranking

- 変更ファイル: `src/renderer/rankingStore.ts`, `src/renderer/app.ts`, `test/ranking-store.test.mjs`。
- 採用した判断: QR登録で受け取った `playerId` は `remote-${playerId}` としてRanking Boardの `PlayerProfile.playerId` に保存する。以後、同じスマホlicenseが名前を変えても `playerId` で既存profileを探し、`nickname` だけ更新する。
- 理由・根拠: スマホ側のlocalStorage licenseは名前変更後も同じ `playerId` を維持するため、Electron側もnicknameではなくremote `playerId` を同一人物判定の主キーにする必要がある。手動入力は従来通りnicknameベースに残し、QR登録と責務を分ける。
- 確認結果: `npm run typecheck` PASS。`node --test test/ranking-store.test.mjs` PASS（remote id name change回帰を追加）。`npm run lint` PASS。`npm run build` PASS。

## 2026-07-07 InputCheck Esc returns to Registration

- 変更ファイル: `src/renderer/app.ts`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: QR登録で一度InputCheckへ自動遷移した `sessionId` を `autoAdvancedRegisterSessionId` として記録し、同じsessionでRegistrationへ戻った後のpollでは再度 `dispatch("start")` しない。
- 採用した判断: `fetchRegisterEntry()` のawait前に `sessionId` を固定し、await後に現在画面・panel・sessionが変わっていた場合はレスポンスを破棄する。
- 理由・根拠: InputCheckでEscを押すと履歴復帰によりRegistrationが再描画され、同じQR sessionの登録済みentryをpollが再取得して即InputCheckへ戻していたため。Escの表示契約は `docs/verification_checklist.md` の「InputCheckでEscキーを押すとRegister画面へ戻る」であり、QR登録済みsessionの再pollがこの戻り操作を上書きしてはいけない。
- 確認結果: `npm run typecheck` PASS。手動では `START GAME -> QR登録 -> InputCheck -> Esc` 後、Registrationに留まり即InputCheckへ戻らないことを見る。

## 2026-07-07 Registration Back Reset

- 変更ファイル: `src/renderer/app.ts`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: Title外のInputCheckからRegistrationへ戻る場合は、`resetRegisterPanelState()` でnickname、error、suggestion、poll状態、QR sessionをタイトルメニューから初回遷移した時と同じ状態に戻す。
- 採用した判断: Title内の戻り操作ではリセットしない。Registration上で設定オーバーレイを閉じるような操作では入力中のnicknameを保持するため。
- 理由・根拠: InputCheckからEscで戻った画面は再登録の入口として扱う必要があり、前回QR認証済みnicknameや登録済みsessionを残すと「Enter your name」に名前が残り、同じsessionのQR描画・poll状態も初期表示と一致しないため。
- 確認結果: `npm run typecheck` を実行する。手動では `START GAME -> QR登録 -> InputCheck -> Esc` 後、Registrationの名前欄が空、QRコードとURLが新規sessionで表示されることを見る。

## 2026-07-07 License Page Scan QR

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホLicenseページに `SCAN QR` ボタンを追加し、押下時だけカメラを起動する。読み取り対象は同一originまたは `score.example.com` の `/join` / `/license` URLで、`sessionId` は既存APIと同じ `^[A-Za-z0-9_-]{1,80}$` に制限する。
- 採用した判断: QR読み取りはブラウザ標準の `BarcodeDetector` を使う。未対応ブラウザではカメラ起動を試さず `QR SCAN IS NOT SUPPORTED. USE THE PHONE CAMERA APP.` を表示する。
- 理由・根拠: License保持済みスマホから別の登録QRへ移る導線を画面内に置くため。外部ライブラリをサーバーへ追加せず、既存の単一 `server.py` 配信構成を保つ。iOS Safariは `BarcodeDetector` が標準有効ではないため、失敗するスキャンUIより明示的なフォールバックを優先した。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`https://score.example.com/license?sessionId=scan-test-after` がHTTP 200で、HTML内に `SCAN QR`、`scanner-video`、`BarcodeDetector`、未対応フォールバック文言が含まれることを確認。

## 2026-07-07 Safari QR Scan Fallback

- 変更ファイル: `/srv/hakkei-score-server/server.py`, `/srv/hakkei-score-server/assets/js/jsQR.js` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: `BarcodeDetector` 非対応ブラウザでは、埋め込みvideoのフレームをCanvasへ描画し、同梱したApache-2.0の `jsQR` でQRを読む。`BarcodeDetector` 対応ブラウザでは従来通りnative pathを使う。
- 理由・根拠: iOS Safariでも `getUserMedia` によるカメラ埋め込みは使えるが、QR解析APIは標準有効ではないため。外部CDNに依存せず `/assets/js/jsQR.js` として同一origin配信し、会場ネットワークでの失敗点を減らす。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`https://score.example.com/assets/js/jsQR.js` がHTTP 200、`https://score.example.com/license?sessionId=safari-scan-test` のHTMLに `/assets/js/jsQR.js`, `typeof jsQR`, `scannerCanvas`, `SCAN QR` が含まれることを確認。

## 2026-07-07 Scanner Visibility Fix

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: QRスキャナ停止は `pagehide` のみにし、`visibilitychange` では停止しない。読み取ったQRの `sessionId` が現在の `sessionId` と同じ場合は遷移しない。
- 理由・根拠: iOS Safariではカメラ許可やカメラ起動時に一時的なvisibility変化が起きることがあり、そこでスキャナを止めると「一瞬出て消える」挙動になるため。同一session QRで自己遷移すると、画面が再読み込みされたように見えるため無視する。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`https://score.example.com/license?sessionId=visibility-fix-test` のHTMLで `visibilitychange` が含まれず、`nextSessionId === sessionId` ガードと `pagehide` 停止だけが含まれることを確認。

## 2026-07-07 License Options

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: License画面では `SCAN QR` を主操作として残し、`CHANGE NAME` と `DELETE LICENSE` は `OPTION` ボタン配下の折りたたみ領域へ移す。初期状態は `aria-expanded="false"` で閉じる。
- 理由・根拠: 再QRスキャンを参加者の主導線にし、名前変更・ライセンス削除のような低頻度/破壊的操作を誤タップしにくい階層へ下げるため。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`https://score.example.com/license?sessionId=option-test` のHTMLに `OPTION`, `option-panel`, `CHANGE NAME`, `DELETE LICENSE`, `aria-expanded="false"` が含まれることを確認。

## 2026-07-07 Register QR Centering

- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: QR外側の白い背景を消し、QR canvas自体に白背景を持たせる。QR生成は `width: 282` に固定し、CSSの表示正方形と同じサイズへ揃える。
- 理由・根拠: 余白付きwrapperと生成済みcanvasのサイズ差で、QR背面の白い型紙がQRからはみ出して見えるため。Register画面の主操作はスマホ読み取りなので、QR本体が中央に見え、背景板がQRより大きく見えないことを優先する。
- 確認結果: `npm run typecheck` を実行する。手動では `START GAME` でRegister画面を開き、QR背面の細長い白板が出ず、QRがSCAN HEREの下で中央に見えることを見る。

## 2026-07-07 URL Known Preregistration

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: `/join` を `sessionId` なしでも登録可能にする。この場合はスマホのlocalStorageへplayer licenseだけ保存し、`/api/session-entry` へはPOSTしない。`sessionId` 付きQRを後から開いた時に、保存済みlicenseをそのsessionへPOSTする。
- 理由・根拠: ゲーム画面にQRが出ている短時間だけでなく、URLを知っている参加者が事前に名前を登録できるようにするため。Electron側は現在sessionのentryだけをpollする契約なので、sessionなし登録をサーバーentryに混ぜず、スマホlicenseの事前作成として扱う。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active (running)`。`https://score.example.com/join` と `https://score.example.com/join?sessionId=url-known-test` のHTMLに `LICENSE READY`、`THIS PHONE IS READY`、`localOnly` が含まれ、`MISSING SESSION ID` が含まれないことを確認。

## 2026-07-07 Registered Users Bat

- 変更ファイル: `scripts/windows/registered-users.bat`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: Windows標準のOpenSSHとPowerShellを使い、`deployment host:/srv/hakkei-score-server/data/session-entries.json` を読み取って一覧表示する。表示は最新ユーザー単位と直近20件のsession登録に分ける。
- 理由・根拠: 登録サーバーはsessionごとのJSON保存が唯一の永続データなので、APIを増やさず既存データを読む方が変更範囲が小さい。player licenseはスマホlocalStorage側にあり、sessionへ紐付くまではサーバー一覧に出ないため、一覧名は「serverに届いたsession登録」として扱う。
- 確認結果: `cmd /c "echo. | scripts/windows/registered-users.bat"` PASS。`Latest users` と `Recent session registrations` が表示されることを確認。

## 2026-07-07 Registered Users GUI

- 変更ファイル: `scripts/windows/registered-users.bat`, `package.json`, `scripts/build.mjs`, `eslint.config.mjs`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/registered-users.html`, `src/renderer/registered-users.css`, `src/renderer/registered-users.ts`, `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: `scripts/windows/registered-users.bat` はCLI表示ではなく、Settingsと同じElectron別画面として起動する。Mainは `https://score.example.com/api/session-entries` を取得し、preloadの限定API `registeredUsersList()` でRendererへ渡す。
- 採用した判断: サーバーには `GET /api/session-entries` を追加し、保存済みsession entryを `generatedAtMs` 付きで返す。GUIではplayerIdごとの最新ユーザー一覧と直近50件のsession登録を表示する。
- 理由・根拠: Rendererへ任意SSHやファイル読取を渡さず、既存preload境界を保つため。登録データはサーバーJSONが正なので、Electron側は一覧APIを読み取り専用で消費する。古いQR登録も履歴として見える一方、最新ユーザーはplayerIdでまとめると操作担当者が重複を見分けやすい。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/api/session-entries` が `generatedAtMs` と `entries` を返すことを確認。`npm run lint` PASS。`npm run typecheck` PASS。`npm run build` PASS。

## 2026-07-07 Phone Name Input Keyboard Hint

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホ登録ページの名前入力と名前変更入力に `autocomplete="off"`、`autocapitalize="characters"`、`autocorrect="off"`、`spellcheck="false"`、`enterkeyhint="done"`、`lang="en"` を追加する。既存の `inputmode="latin"` と `pattern="[A-Z0-9_-]{1,16}"` は維持する。
- 採用した判断: JSの `normalizeName()` は `value.normalize("NFKC")` を先に通し、全角英数字・全角記号の一部を半角へ寄せてから大文字化・許可文字フィルタを行う。
- 理由・根拠: iOS/AndroidのIMEはWebページから完全固定できないため、半角キーボード表示を促す属性と、全角で入ってしまった場合の自動半角化を組み合わせる。参加者の入力失敗を減らしつつ、サーバー側の `A-Z0-9_-` 契約は変えない。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `autocapitalize="characters"`、`autocorrect="off"`、`spellcheck="false"`、`normalize("NFKC")` が含まれることを確認。

## 2026-07-07 Phone Name Input Warning

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホ登録ページと名前変更dialogでは、入力中に不許可文字を消さず、半角 `A-Z/a-z/0-9/_/-` 以外が含まれる場合に赤文字で `半角英数字で入力してください` を表示する。送信時も同条件でサーバーPOSTを止める。
- 理由・根拠: 入力した文字が即座に消えると参加者は原因を理解しにくい。入力値を残したまま赤字警告を出す方が、IMEが全角のままになっていることを説明しやすい。半角小文字は参加者にとって英字入力なので許可し、登録時に既存契約通り大文字へ正規化する。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `半角英数字で入力してください`、`isHalfWidthNameInput`、`USE HALF-WIDTH` が含まれることを確認。

## 2026-07-07 Dot In Player Name

- 変更ファイル: `src/renderer/app.ts`, `src/renderer/rankingStore.ts`, `test/ranking-store.test.mjs`, `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: player nameの許可文字を `A-Z/a-z/0-9/./_/-` に拡張する。Electronの手入力、QR登録受信、ローカルRanking保存、スマホ登録ページ、サーバーvalidatorを同じ契約へ揃える。
- 採用した判断: スマホ登録ページの赤字警告は英語の `USE HALF-WIDTH A-Z, 0-9, ., _ OR -.` に変更し、英語hintも `A-Z, 0-9, ., _ OR -` にする。
- 理由・根拠: サーバーだけ `.` を許可するとElectron側の `REMOTE_NICKNAME_PATTERN` またはRanking保存で弾かれ、スマホでは登録成功に見えるのにゲームへ進まない不整合が起きるため。表示文言も許可文字と一致させる。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。公開APIへ `playerName="player.01"` をPOSTして `PLAYER.01` として保存されることを確認し、検証entryはDELETE済み。`npm run lint` PASS。`npm run typecheck` PASS。`node --test test/ranking-store.test.mjs` PASS。起動中Electronを閉じた後に `npm run build` PASS。

## 2026-07-07 Phone Warning English

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホ登録ページと名前変更dialogの赤字警告を `USE HALF-WIDTH A-Z, 0-9, ., _ OR -.` に統一する。
- 理由・根拠: スマホ登録ページ全体は英語UIとして運用しており、警告だけ日本語だと参加者向け表示が混在するため。入力契約自体は前項と同じ。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `USE HALF-WIDTH A-Z, 0-9, ., _ OR -.` が含まれ、`半角英数字` が含まれないことを確認。

## 2026-07-07 Phone Warning Weight

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: `.input-warning` の `font-size` を通常hintと同じ `0.82rem`、`font-weight` を通常hint相当の `400` にする。赤色は維持する。
- 理由・根拠: 警告文の内容は補助hintと同じ入力契約の説明なので、太さを揃えて画面内の視覚ノイズを減らす。エラー状態は色で示す。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLで `.input-warning` に `font-size: 0.82rem` と `font-weight: 400` が含まれることを確認。

## 2026-07-07 Disable Native Validation Bubble

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホ登録formと名前変更dialog formへ `novalidate` を追加し、Safariなどのブラウザ標準バリデーション吹き出しを出さない。入力エラー表示は既存の英語UI `USE HALF-WIDTH A-Z, 0-9, ., _ OR -.` に統一する。
- 理由・根拠: ブラウザ標準のvalidation messageは端末言語で表示され、日本語端末では `要求された書式...` のようにページ全体の英語UIと混在するため。アプリ側で既に入力判定と英語警告を持っているので、標準吹き出しを無効化する方が表示契約を固定できる。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `<form id="entry-form" novalidate>` と `<form method="dialog" id="change-name-form" novalidate>` が含まれることを確認。

## 2026-07-07 License Name Fit

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: License画面の名前表示は、名前長を `--name-len` CSS変数として渡し、枠幅と文字数から最大font-sizeを計算して1行内に収める。`text-wrap: nowrap` と `overflow: hidden` も指定する。
- 理由・根拠: 名前上限16文字を維持したまま、長い名前が枠外へはみ出すのを防ぐため。登録名を省略すると本人確認がしづらいので、省略より縮小を優先する。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `--name-len`、`font-size: min(...)`、`text-wrap: nowrap` が含まれることを確認。

## 2026-07-07 License Name Fit Measurement

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: License画面の名前表示はCSS計算だけでなく、表示後に `scrollWidth > clientWidth` を測り、入るまで1pxずつfont-sizeを下げる。13文字以上はletter-spacingを `0.02em` に抑える。
- 理由・根拠: 実機ではpanel内側paddingや文字間隔の影響で、CSSのviewport基準計算より実際の表示枠が狭く、15-16文字目が隠れたため。実測で収める方式にすると端末幅差に強い。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `function fitLicenseName`、`scrollWidth > licenseNameEl.clientWidth`、`white-space: nowrap` が含まれることを確認。

## 2026-07-07 License Option Subtle Buttons

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: Option配下の `CHANGE NAME` と `DELETE LICENSE` は専用CSSで、clip-pathなし、shadowなし、暗い背景、薄い枠線、小さめ文字へ下げる。主操作の `SCAN QR` は従来の強いボタンのまま残す。
- 理由・根拠: Option配下は低頻度/管理操作なので、主導線の `SCAN QR` と同じ視覚強度にすると参加者の視線を奪い、誤タップの誘因にもなるため。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLで `.option-panel button` に `font-size: 0.78rem`、`clip-path: none`、弱い色指定が含まれることを確認。

## 2026-07-07 Scanner Dialog

- 変更ファイル: `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: `SCAN QR` 押下時のカメラ表示をLicenseカード内の下方向展開から、`CHANGE NAME` と同じHTML dialog表示へ変更する。スキャン状態表示はdialog内の `scanner-status` へ出す。
- 理由・根拠: インライン展開ではスマホ縦画面でカメラ映像が下へ押し出され、Safariの下部UIやスクロール位置で見切れるため。dialogなら画面中央の独立モードとしてカメラを表示できる。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。`https://score.example.com/join` のHTMLに `<dialog id="scanner-dialog">`、`scannerDialog.showModal()`、`scanner-status` が含まれることを確認。

## 2026-07-07 Phone Ready Advance

- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: スマホ側のLicense画面に `I'M READY` ボタンを追加し、`POST /api/session-ready` で現在sessionのentryへ `readyAtMs` を保存する。Electronは `GET /api/session-entry?sessionId=...` のpollingを、QR登録完了後もInputCheck中だけ継続する。
- 採用した判断: Electronは `readyAtMs` だけでは進めず、`store.state === "InputCheck"`、現在の `registerSessionId` 一致、かつ `inputCheckReady()`（keyboardまたはmocopi BLE受信中）を満たした時だけ `inputOk` を発火する。
- 理由・根拠: 既存の古いQR対策はsessionId一致で守る。スマホReadyを先に押してもBLEが未接続なら待機し、BLE検出後に進めることで「mocopi BLE検出後、画面を進める作業をスマホでもできる」要望に合わせる。サーバーにはゲーム状態を持たせず、session entryの補助フラグだけにする。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は `active`。公開APIで `POST /api/session-entry` -> `POST /api/session-ready` -> `GET /api/session-entry` を実行し `readyAtMs` が返ることを確認、検証entryはDELETE済み。`https://score.example.com/join?sessionId=codex-ready-ui` のHTMLに `I'M READY`、`/api/session-ready`、`READY SENT` が含まれることを確認。`npm run typecheck` PASS。`npm run lint` PASS。`node --test test/ranking-store.test.mjs test/state-machine.test.mjs` PASS。`npm run build` PASS。
- 追加調整: `I'M READY` ボタンはLicenseカード表示直後ではなく、`POST /api/session-entry` が成功してゲーム側がInputCheckへ進める状態になってから表示する。登録POST中は `WAIT FOR THE GAME SCREEN TO CHANGE.` を表示する。
- 追加確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。`https://score.example.com/join?sessionId=codex-ready-ui` のHTMLに `showLicense(normalizedPlayer, false)`、`showLicense(normalizedPlayer, true)`、`WAIT FOR THE GAME SCREEN TO CHANGE.` が含まれることを確認。公開APIの `session-ready` 疎通確認PASS、検証entryはDELETE済み。
- 再調整: ゲーム側がInputCheckへ入ったことをElectronから `POST /api/session-input-check?sessionId=...` で通知し、スマホ側は `GET /api/session-entry` の `inputCheckAtMs` をpollingしてから `I'M READY` を表示する。これにより、License表示直後ではなくゲーム側画面遷移後にだけREADYボタンが出る。
- 再確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで登録直後は `inputCheckAtMs` がなく、`POST /api/session-input-check` 後に `inputCheckAtMs` が入り、その後 `POST /api/session-ready` で `readyAtMs` が入ることを確認、検証entryはDELETE済み。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- モーダル化: `I'M READY` はLicenseカード内のインラインボタンではなく、`CHANGE NAME` / `SCAN QR` と同じ `<dialog>` の `ARE YOU READY?` モーダルとして表示する。`inputCheckAtMs` 検知後に `readyDialog.showModal()` で開く。
- モーダル確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLでLicenseカード内に `ready-play` がなく、`<dialog id="ready-dialog">`、`ARE YOU READY?`、`readyDialog.showModal()` が含まれることを確認。公開APIの `session-input-check` / `session-ready` 疎通確認PASS、検証entryはDELETE済み。
- 不具合修正: スマホREADY後に入力方法を切り替えた瞬間だけ画面遷移する症状に対し、InputCheck中にmocopi BLEを一度検出した状態を `inputCheckBleReadySeen` として保持する。mocopiへ切り替えた時はこの保持と受信履歴をクリアし、キーボード準備状態をmocopi準備状態として流用しない。
- 修正理由: `readyAtMs` polling と `isBleReceiving()` の直近1秒窓がズレると、READY押下時に進まず、後続の入力モード切替で `inputCheckReady()` がtrueになった瞬間に遷移していたため。mocopiモード内のBLE検出だけをラッチすれば、pollingズレを吸収しつつモード切替による誤遷移を防げる。
- 追加修正: キーボードモード中のスマホREADYでも進めるよう、InputCheck中は `autoAdvancedRegisterSessionId` に依存せず現在の `registerSessionId` をpolling対象にする。キーボードへ切り替えた時もREADY pollingを再開する。
- 追加理由: キーボードは `inputCheckReady()` が常時trueだが、READY pollingがQR自動遷移sessionに絞られていると、モード切替後に `readyAtMs` を拾えず画面遷移しないため。
- 再追加修正: InputCheck中は入力モードに関係なく500msタイマーで `pollRegisterEntryOnce()` を呼び、スマホREADY状態を再取得する。`registerPollInFlight` で多重fetchは抑止する。
- 再追加理由: キーボードモードではmocopi用のInputCheck更新タイマーが動かず、READY取得が既存の登録pollingタイマーに依存していた。入力モード切替時だけ再評価される状態を避けるため、InputCheck自体の定期処理にREADY確認を含める。

## 2026-07-07 Server Ranking Source Of Truth

- 変更ファイル: `src/renderer/app.ts`, `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: Ranking Board表示は `localStorage` の `hakkei.rankingBoard.v1` ではなく、`GET https://score.example.com/api/ranking-board` のレスポンスだけを使う。ロード中/失敗時はローカルfallbackを表示せず、サーバー状態メッセージを出す。
- 採用した判断: Result到達時は既存のローカル保存をResult通知/CONTINUE互換のため残しつつ、同じ `player` と `record` を `POST https://score.example.com/api/ranking-score` へ送る。サーバーは `data/ranking-board.json` を正本として、playerId単位でplayCount/lastPlayedAtMs/highScoreを更新する。
- 理由・根拠: ローカルランキングを表示に使うと端末内のテストデータが本番ランキングに混ざる。表示だけでもサーバー正本に固定すれば、別端末/再起動後も同じランキングを見られ、ローカルテストデータを誤って見せない。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで `GET /api/ranking-board` が `{schemaVersion:1, players:[], records:[]}` を返すこと、`POST /api/ranking-score` でサーバーboardにスコアが入ることを確認。検証用 `codex-ranking-test` はサーバー正本ファイルから削除済み。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 起動直後Ranking修正: Titleの `RANKING BOARD` をクリック/タップした時に通る汎用 `data-action` handler側でも `fetchServerRankingBoard()` を呼ぶ。キーボードEnter経路だけでなく、マウス/タッチ経路でもサーバー正本を読み込む。
- 起動直後Ranking理由: `activateTitleMenu()` 経由では取得していたが、クリック/タップは `data-action="ranking-board"` のhandlerで直接画面を開いており、Result後に `postScoreToServer()` がstoreへboardを入れるまで空表示になっていたため。
- 起動直後Ranking確認: `GET https://score.example.com/api/ranking-board` が実データを返すことを確認。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 入力機器待機UI: ElectronはInputCheck入場時に `/api/session-input-check`、`inputCheckReady()` がtrueになった時に `/api/session-input-ready` を送る。スマホは `inputCheckAtMs` だけでは `ARE YOU READY?` を出さず、`CONNECTING` / `WAITING FOR INPUT DEVICE` dialogを表示し、`inputDeviceReadyAtMs` を受けてからReady dialogへ切り替える。
- 入力機器待機UI理由: ゲーム側InputCheck画面とスマホ側Ready表示の間に、mocopi BLE接続待ちの時間がある。Readyを先に出すと参加者が押せるのにゲーム側が進まないため、ゲーム側と同じ接続待ち状態をスマホにも出す。
- サーバー全削除設定: 設定GUIに `サーバーとこのPCの全ユーザー/スコア記録をリセット` を追加し、確認文字列 `DELETE_ALL_HAKKEI_DATA` 入力後だけ `/api/admin-reset` をPOSTする。成功後にこのPCの `localStorage` rankingも削除する。通常のローカル削除ボタンは残す。
- サーバー全削除理由: 本番前の初期化でサーバーランキングとスマホsession登録も正本側から消せる必要がある。公開APIのため、誤操作対策として固定確認文字列を要求し、設定GUIからのみ使う運用にする。
- 確認結果: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLに `device-wait-dialog`、`CONNECTING`、`WAITING FOR INPUT DEVICE`、`inputDeviceReadyAtMs`、`showDeviceWaitDialog` が含まれることを確認。公開APIで検証sessionへ `session-input-check` -> `session-input-ready` をPOSTし、`inputDeviceReadyAtMs` が返ることを確認、検証entryはDELETE済み。`/api/admin-reset` は誤確認文字列で400を返すことを確認。本番データ保護のため成功実行は未実施。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 入力モード切替追従: InputCheck中にKeyboardへ切り替えた時は即 `/api/session-input-ready` を送る。mocopiへ切り替えた時は `/api/session-input-check` を送り直して `inputDeviceReadyAtMs` を消す。これにより、ゲーム側の入力モード/準備状態に合わせてスマホ側の `CONNECTING` / `ARE YOU READY?` が切り替わる。
- CONNECTINGキャンセル: `device-wait-dialog` に `CANCEL` を追加し、押下後は `deviceWaitDismissed` で同じ待機状態の再表示を抑止する。後から `inputDeviceReadyAtMs` が来た場合は抑止を解除しReady dialogへ進む。
- 追加確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLに `device-wait-cancel`、`INPUT DEVICE WAIT CANCELLED`、`deviceWaitDismissed`、`closeDeviceWaitDialog` が含まれることを確認。公開APIで検証sessionへ `session-input-check` -> `session-input-ready` をPOSTし、`inputDeviceReadyAtMs` が返ることを確認、検証entryはDELETE済み。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 入力モード切替再修正: `session-input-check` と `session-input-ready` のPOST順がネットワーク上で前後し、遅れて届いた `session-input-check` が `inputDeviceReadyAtMs` を消す可能性があった。`input-ready` 通知は1回きりにせず、InputCheck中に `inputCheckReady()` がtrueなら定期更新ごとに再送する。POSTは `response.ok` を確認してから成功扱いにする。
- 入力モード切替再確認: `npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 初期Keyboard再修正: `session-input-check?ready=1` で `inputCheckAtMs` と `inputDeviceReadyAtMs` を同一POST内で保存できるようにする。Electronのready通知もこのatomic endpointへ寄せ、InputCheck開始通知の成功直後にも `inputCheckReady()` を見てready通知を送る。
- 初期Keyboard再修正理由: 初めからKeyboardの場合、InputCheck入場直後にスマホが `CONNECTING` を表示した後、ready通知が別POST/別tickになり、環境によって切り替えが遅延または取りこぼされる可能性があった。同一POSTでready状態まで保存できれば、最初からKeyboard readyの状態をサーバーentryへ一貫して反映できる。
- 初期Keyboard再確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで検証sessionへ `POST /api/session-input-check?ready=1` を実行し、`inputCheckAtMs` と `inputDeviceReadyAtMs` が同時に返ることを確認、検証entryはDELETE済み。公開HTMLに `inputDeviceReadyAtMs`、`device-wait-cancel`、`ARE YOU READY?` が含まれることを確認。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- 入力機器切替再検証: 入力機器を切り替えた時は `beginPhoneInputDeviceVerification()` で約900msの検証期間を置き、スマホへ `session-input-check` を送って一度 `CONNECTING` に戻す。その後、検証期間後も `inputCheckReady()` がtrueなら `session-input-check?ready=1` を送る。
- 入力機器切替再検証理由: 以前はReadyを検出したスマホ側がInputCheck監視を止めていたため、その後の入力機器切替を拾えなかった。スマホ側は監視を継続し、`inputDeviceReadyAtMs >= inputCheckAtMs` の時だけReady扱いにする。新しい `inputCheckAtMs` を見たらキャンセル抑止を解除し、古いReady dialogを閉じてCONNECTINGへ戻す。
- 入力機器切替再検証確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLに `lastSeenInputCheckAtMs`、`noteInputCheckSeen`、`readyAt >= inputCheckAt` が含まれることを確認。公開APIで `ready=1` -> 通常 `session-input-check` -> `ready=1` を順にPOSTし、readyが一度消えて再度有効になることを確認、検証entryはDELETE済み。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- Ready Cancel調整: `ARE YOU READY?` の副ボタン表記を `NOT YET` から `CANCEL` に変更し、押下時は `POST /api/session-cancel` で現在sessionへ `cancelAtMs` を保存してからQRスキャナーdialogを再表示する。
- Ready Cancel理由: 参加者が現在のReady操作を取り消した時は、同じLicense画面で待機し続けるより、新しいゲームQRを読み直せる状態へ戻す方が操作意図に合うため。Electron側はInputCheck中かつ現在session一致の `cancelAtMs` だけを処理し、古いQRや別sessionのCancelが現在ゲームへ影響しないようにする。
- Ready Cancelゲーム復帰: ElectronはInputCheck中のpollingで `cancelAtMs` を検知したら `navigateBack()` でRegistrationへ戻す。Registration復帰時は既存の `resetRegisterPanelState()` を通して新規session/QRを生成する。
- Ready Cancel確認: `python -m py_compile .tmp\server.py.remote` PASS。remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで `POST /api/session-entry` -> `POST /api/session-input-check?ready=1` -> `POST /api/session-ready` -> `POST /api/session-cancel` -> `GET /api/session-entry` を実行し、`cancelAtMs` が返り、`readyAtMs` と `inputDeviceReadyAtMs` が残らないことを確認、検証entryはDELETE済み。公開HTMLに `ready-cancel">CANCEL` と `/api/session-cancel` が含まれ、`NOT YET` が含まれないことを確認。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- Reload Connecting対策: ElectronがInputCheckから別画面へ遷移する時に `POST /api/session-input-exit` で `inputCheckExitAtMs` を保存する。スマホLicense画面は `inputCheckAtMs > inputCheckExitAtMs` の場合だけ `CONNECTING` / `ARE YOU READY?` の対象にする。
- Reload Connecting対策理由: スマホページのリロード時に古い `inputCheckAtMs` だけを見ると、ゲーム側が既にReady/Result/Title等へ進んでいても接続確認中と誤認するため。終了時刻をサーバーentryに残せば、サーバーにゲーム状態を常駐させずに古い接続確認表示だけを無効化できる。
- Reload Connecting対策確認: `python -m py_compile .tmp\server.py.remote` PASS。remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで `POST /api/session-input-check?ready=1` -> `POST /api/session-input-exit` -> `GET /api/session-entry` を実行し、`inputCheckExitAtMs` が返り、`inputDeviceReadyAtMs` が消えることを確認。さらに `POST /api/session-input-check` 再開時に `inputCheckExitAtMs` が消えることを確認、検証entryはDELETE済み。公開HTMLに `activeInputCheckAtMs` と `inputCheckExitAtMs` が含まれることを確認。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。
- Ready Cancel再スキャン対策: `/api/session-entry` の再POSTでは古い `cancelAtMs` を継承しない。Electron側も `cancelAtMs > registeredAtMs` の場合だけCancelとして扱い、再登録時刻より古いCancelは無視する。
- Ready Cancel再スキャン対策理由: `ARE YOU READY?` で `CANCEL` した後に同じQR/sessionを再スキャンすると、既存entryの `cancelAtMs` を再登録後も保持してしまい、Electronが再度キャンセル扱いしてReady dialogまで進めない可能性があったため。
- Ready Cancel再スキャン確認: `python -m py_compile .tmp\server.py.remote` PASS。remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで `session-cancel` 後に同じsessionへ再度 `session-entry` をPOSTし、`cancelAtMs` が消え、`registeredAtMs` が更新されることを確認、検証entryはDELETE済み。公開HTMLに `/api/session-cancel` と `ready-cancel">CANCEL` が含まれることを確認。`npm run typecheck` PASS。`npm run lint` PASS。`npm run build` PASS。

## 2026-07-07 Phone Result Exit

- 変更ファイル: `src/renderer/app.ts`, `/srv/hakkei-score-server/server.py` on `deployment host`, `docs/verification_checklist.md`, `docs/runs/20260707-qr-registration.md`。
- 採用した判断: ElectronがResultへ到達してスコア保存した時だけ `POST /api/session-result` で現在sessionへ `resultAtMs`、損害額、rankを保存する。スマホLicense画面はこの値をpollingし、`RESULT` dialogで損害額だけを表示する。
- 採用した判断: スマホResult dialogの `EXIT` は `POST /api/session-result-exit` で `resultExitAtMs` を保存する。ElectronはResult表示中、かつ現在sessionがQR自動登録sessionと一致し、`resultExitAtMs >= resultAtMs` の場合だけ `finish` を発火してTitleへ戻る。
- 採用した判断: ゲーム側の `Exit` / `Play Again` はスマホ側状態を変更しない。スマホExit要求はElectronがResult状態でない場合は読まない。
- 理由・根拠: スマホExitでゲームをTitleへ戻す要望を満たしつつ、ゲーム側操作とスマホ側表示の双方向同期を作ると古いQR/遅延操作が現在プレイへ混ざる。サーバーにはsession entryの時刻だけを保存し、Electron側で現在状態とsessionを最終判定する方が、古いQRやゲーム先行遷移への影響を閉じられる。
- 確認結果: `python -m py_compile .tmp\server.py.remote` PASS。remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIで `POST /api/session-entry` -> `POST /api/session-result` -> `POST /api/session-result-exit` -> `GET /api/session-entry` を実行し、`resultAtMs`、`resultDamageYenText`、`resultExitAtMs` が返ることを確認、検証entryはDELETE済み。公開HTMLに `result-dialog`、`/api/session-result-exit`、`waitForGameResult` が含まれることを確認。`npm run typecheck` PASS。`npm run lint` PASS。`node --test test/ranking-store.test.mjs test/state-machine.test.mjs` PASS。`npm run build` PASS。
- 追加調整: スマホResult dialogのデザインをPC側Resultの `RESULT` / `TOTAL DAMAGE` / 金色発光の損害額表示に寄せる。表示要素は `RESULT`、`TOTAL DAMAGE`、合計損害額、`EXIT` だけに絞る。
- 追加判断: 合計損害額は1行固定にせず、数字を3桁ごとのブロックへ分割して中央揃えで折り返せるHTMLにする。12桁超、18桁超で段階的にfont-sizeを下げる。
- 追加理由: PC側の理論値スコアはスマホ幅では1行表示が破綻しやすい。数字を省略すると結果確認として弱くなるため、省略ではなく3桁グループの折り返しで全桁を見せる。
- 追加確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLに `phone-result-title`、`TOTAL DAMAGE`、`phone-result-damage`、`damage-group`、`renderDamageAmount` が含まれ、古い `DAMAGE AMOUNT` が含まれないことを確認。公開APIで30桁の `damageYenText` を `/api/session-result` へ保存できることを確認、検証entryはDELETE済み。
- Change name対策: 名前変更submit後は `waitForGameInputCheck()` / `waitForGameResult()` を再起動しない。名前変更はライセンス名の更新だけに留め、既存sessionに残っている古い `inputCheckAtMs` によって `ARE YOU READY?` dialogが再表示されることを防ぐ。
- Change name対策確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLの `changeNameForm` handler内に `LICENSE UPDATED.` があり、`waitForGameInputCheck()` と `waitForGameResult()` が含まれないことを確認。
- Reload対策: `resultExitAtMs >= resultAtMs` のsessionは完了済みとして扱い、ページリロード後に古い `inputCheckAtMs` から `ARE YOU READY?` を再表示しない。未ExitのResultが残っている場合はResult dialogを優先し、同じpoll内でReadyを出さない。
- Reload対策確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開HTMLに `isResultClosed` / `isResultOpen` / `exitAt >= resultAt` が含まれることを確認。公開APIで `inputCheckAtMs`、`resultAtMs`、`resultExitAtMs` を持つ検証sessionを作り、`resultExitAtMs >= resultAtMs` になることを確認、検証entryはDELETE済み。
- Reload再修正: リロード時の `/api/session-entry` 再POSTで既存entryを作り直す際、`resultExitAtMs` も継承する。これまでは `resultAtMs` だけが残って `resultExitAtMs` が落ち、完了済みsessionが未Exit Resultとして復活していた。
- Reload再修正確認: remote `python3 -m py_compile /srv/hakkei-score-server/server.py` PASS。`hakkei-score.service` は新プロセスで `active`。公開APIでExit済みsessionへ再度 `POST /api/session-entry` しても `resultExitAtMs` が保持され、`resultExitAtMs >= resultAtMs` の完了済み判定が維持されることを確認、検証entryはDELETE済み。
