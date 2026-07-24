# Register Server Suggestions

- 対象ステップ: Register画面 nickname候補のサーバー登録ユーザー同期。
- 変更ファイル: `src/renderer/rankingStore.ts`, `src/renderer/app.ts`, `test/ranking-store.test.mjs`, `docs/verification_checklist.md`, `docs/runs/20260709-register-server-suggestions.md`。
- 採用した判断: Register画面を開くたびにMain/preloadの限定API `registeredUsersList()` で `GET /api/session-entries` を取得し、`remote-<playerId>` の `PlayerProfile` としてローカル候補キャッシュへ取り込む。候補表示自体は既存の `registeredNicknameSuggestions(loadRankingBoard(localStorage), query)` を維持する。
- 理由・根拠: 候補UIはローカルRanking保存だけを参照していたため、サーバーに永続化済みでも、そのElectron起動中またはローカル保存済みのユーザーしか候補に出なかった。`registered-users:list` は既にMainがサーバー通信を担当するIPCとして存在し、Rendererへ任意fetchやファイル読取を増やさずにAGENTS.md 5.2のpreload境界を保てる。`remote-<playerId>` に寄せるとQR登録時の同一スマホlicense判定とも同じ主キーになる。
- 確認結果: `npm run typecheck` PASS。`node --test test/ranking-store.test.mjs` PASS。
- 手動確認: アプリを終了して再起動し、Titleの `START GAME` でRegister画面を開く。`PLAYER01` などサーバー登録済みnicknameの先頭文字を入力し、入力欄下に前方一致候補が出ることを見る。候補が出ない場合は `logs/state-YYYYMMDD.log` の `registered users sync failed` と、`scripts/windows/registered-users.bat` の一覧取得結果を確認する。
- 残課題: サーバーが落ちている場合は候補同期できないため、既存のローカル候補だけを表示する。Register画面上の同期失敗メッセージ表示は未実装。

## 追加: サーバーRanking準拠の候補同期

- 変更ファイル: `src/renderer/rankingStore.ts`, `src/renderer/app.ts`, `test/ranking-store.test.mjs`, `docs/verification_checklist.md`, `docs/runs/20260709-register-server-suggestions.md`。
- 採用した判断: Register画面の候補同期で `/api/session-entries` に加えて `/api/ranking-board` の `players` も取り込む。Registration画面上の候補表示上限は4件から8件へ広げる。
- 理由・根拠: スコア正本はサーバーRankingであり、過去のスコアが残っているユーザーがsession登録一覧に存在しない場合でも、名前入力候補には出るべきであるため。候補の並びは既存どおり `rankingRows` のhighScore順を使い、スコアが残っている人を優先する。
- 確認結果: `npm run typecheck` PASS。`node --test test/ranking-store.test.mjs` PASS。手動ではアプリ再起動後にRegister画面を開き、Ranking Boardにスコアがあるnicknameの先頭文字を入力して候補に出ることを見る。

## 追加: canonical player registry + display ID

- 変更ファイル: `CloudServer/hakkei-score-server/server.py`, `src/shared/types.ts`, `src/renderer/rankingStore.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`, `test/ranking-store.test.mjs`, `docs/verification_checklist.md`, `docs/runs/20260709-register-server-suggestions.md`。
- 採用した判断: サーバーに `data/players.json` を追加し、`/api/players` をユーザー台帳の正本にする。内部 `playerId` は既存互換のまま残し、表示用 `playerNumber` を `26001` から `26999` の範囲で採番する。
- 理由・根拠: `session-entries` はsession状態、`ranking-board` はスコア表示であり、どちらもユーザー台帳そのものではない。名前候補とRanking表示が同じユーザー集合・同じ表示IDを使うには、登録/スコア送信/既存データ移行の全入口で同じ台帳へupsertする必要がある。
- 採用した判断: 既存データは `/api/players` または `/api/ranking-board` アクセス時に `ranking-board.players` と `session-entries` から自動取り込みする。QR登録のsession conflictを確認してから台帳へupsertし、拒否された別playerを台帳へ作らない。
- 理由・根拠: 既存の公開データを手作業で失わずに移行し、古いQRや別端末による競合登録をユーザー台帳へ混入させないため。
- 確認結果: `npm run typecheck` PASS。`node --test test/ranking-store.test.mjs` PASS。`python -m py_compile CloudServer/hakkei-score-server/server.py` PASS。temp dataで `/api/players` 相当の migration が `ID26001` / `ID26002` を割り当て、Ranking playersへ `playerNumber` を反映することを確認。
- 手動確認: 公開反映後、`https://score.example.com/api/players` に `playerNumber` が `26001-26999` で出ることを見る。アプリを再起動して `START GAME` を開き、名前候補に `ID260xx` とnicknameが出ること、Ranking BoardにID列が出ることを見る。
- 公開反映: `deployment host:/srv/hakkei-score-server/server.py` を `server.py.bak-20260709-205919-before-player-registry` へバックアップ後に差し替えた。`systemctl restart` は認証が必要だったため旧PIDを終了し、Restart=alwaysで新PID `575446` が起動。`hakkei-score.service` は `active`。
- 公開確認: `https://score.example.com/api/players` が15人を返し、先頭から `26001`〜の `playerNumber` が付与された。`https://score.example.com/api/ranking-board` の `players` にも同じ `playerNumber` が反映された。

## 追加: スマホLicense画面の表示ID

- 変更ファイル: `CloudServer/hakkei-score-server/server.py`, `docs/runs/20260709-register-server-suggestions.md`。
- 採用した判断: スマホLicenseカードの名前直下に、小さく `ID260xx` を表示する。`playerNumber` が未取得のlocal-only licenseでは非表示にし、次回QR登録/名前変更レスポンスで保存済みlicenseへ取り込む。
- 理由・根拠: IDは参加者識別の補助情報であり、名前より強く見せる必要はない。名前変更では同じ `playerId` のまま `playerNumber` を維持するため、登録レスポンスをlocalStorageへ保存して表示する。
- 確認結果: `python -m py_compile CloudServer/hakkei-score-server/server.py` PASS。公開サーバーは `server.py.bak-20260709-212257-before-phone-id` へバックアップ後に差し替え、新PID `576515` で `hakkei-score.service` active。公開HTMLに `license-id`、`playerNumberLabel`、`playerFromRegistrationPayload` が含まれることを確認。既存playerで一時session登録し、期待 `26001` に対してレスポンス `playerNumber=26001` を確認、検証sessionはDELETE済み。
