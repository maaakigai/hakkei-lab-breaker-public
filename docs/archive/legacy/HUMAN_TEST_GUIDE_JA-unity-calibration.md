# HUMAN_TEST_GUIDE_JA.md

> **旧版注意（Unity Bridge / Calibration 版）**
>
> この手順書は旧 Unity Bridge / `MotionSample` / `Calibration` / `VerticalCharge` / `ForwardCharge` 前提の確認項目を多く含みます。
> 2026-06-28時点の現行本線は **mocopi 1台 BLE直読・単手パンチ・`PunchInputSample`・magnitude-only** です。
> 現行版の操作・確認には [docs/CURRENT_USAGE_JA.md](docs/CURRENT_USAGE_JA.md) と [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を使ってください。
>
> 旧版との差異: 現行版では Unity Bridge 起動、neutral/forward Calibration、上下/前後チャージ、Unity Gate B2/D1 を通常確認に使いません。

発勁ラボブレイカーを、人間が動作確認・テスト確認するための日本語手順書です。開発者でない人でも確認できるよう、何を起動し、何を押し、何が見えれば合格かを具体化しています。

このファイルは旧 Unity Bridge / Calibration 版の日本語手順です。`HUMAN_TEST_GUIDE.md` は互換用の案内ファイルであり、手順本文は重複させません。現行BLE版の手順を更新する場合は、`docs/CURRENT_USAGE_JA.md` と `docs/verification_checklist_v2_ble.md` を更新してください。

---

## 現行: scripts/windows/Settings.bat 設定GUI

1. `scripts/windows/Settings.bat` を起動する。
2. 設定画面が開き、`BGM音量`、`発勁スコア`、`被害報告アイテム` が表示されることを見る。
3. `発勁スコア 100% 強度` を現在値より大きい値に変更し、`保存` を押す。
4. `保存しました。ゲーム側は再起動後に反映されます。` と表示されることを見る。
5. `config/score.config.json` の `punch.punchMax` が変更後の値になっていることを見る。
6. 被害報告アイテムで品物名、単位、金額係数、上限などを変更または項目追加し、保存できることを見る。
7. `Critical` の `Sランク時の基本Critical率` を変更して保存できることを見る。`0` は発生なし、`1` はSランク時に必ずCritical。
8. `BGM音量` の `通常BGM`、`Critical/Result BGM` を0〜3、`チャージ音`、`オーバーチャージ音` を0〜10で変更して保存し、`config/app.config.json` の `audio.bgm.volume`、`audio.criticalBgm.volume`、`audio.chargeSound.volume`、`audio.overchargeSound.volume` が変更後の値になることを見る。1が通常音量、1超は増幅。
9. Result画面に入った直後、Rank EではResult SFXが鳴らず、Rank D/C/B/A/Sでは `assets/Sound/SFX/result_sfx` 配下の通常SFXがそれぞれ2/4/5/7/9個、広めの間隔でずれて鳴ることを見る。CriticalではCritical動画中にUnique以外の通常SFXが流れ、Result開始時に通常SFX 13個と `Unique_SFX` 1個だけが始まることを見る。鳴らない場合は `logs/state-YYYYMMDD.log` の `AUDIO missing(result-*)` と `dist/renderer/sounds/result-sfx-manifest.json` を確認する。
10. 不正値を入れた場合は保存せず、画面上部に config validator のエラーが表示されることを見る。

## 現行: Lv別動画フォルダ確認

1. `assets/videos/LV1`〜`assets/videos/LV5` が存在することを見る。Lv0動画フォルダは不要。
2. Lv1以上の各フォルダに、そのLvで再生したい `.mp4` を入れる。
3. `config/score.config.json` の `videoLevels` でLv0は `file` / `folder` なし、Lv1以上は `folder` を参照していることを見る。
4. Debug UIでLv5通常フローを複数回実行し、`assets/videos/LV5` 内の動画からランダムに1本再生されることを見る。
5. Debug UIでLv0通常フローを実行し、動画は再生されず背景画像のままResultへ進むことを見る。
6. `Lv5` フォルダ内の動画を増やした場合、アプリ再起動後に候補へ入ることを見る。

## 現行: Critical強制モード確認

1. Debug UIでReadyの `姿勢を整えて` 表示まで進み、`Ctrl` を押して `CRITICAL 強制モード` が表示されることを見る。
2. `Ctrl` を離しても表示が残ることを見る。
3. Charge、HakkeiReadyへ進んでも強制モード表示が残ることを見る。
4. HakkeiReadyの `構えて` カウント中に、mocopi BLEモードでは拳を突き出す。Keyboard debugでは `Enter` を押す。この時点では発勁判定が出ないことを見る。
5. 表示が `拳を突き出せ！` または `Enterを押せ！` になってから、mocopi BLEモードでは拳を突き出す。Keyboard debugでは `Enter` を押す。
6. Chargeでゲージが少しでも溜まったら公開用チャージ音が流れ始め、Lv動画が始まる直前まで流れ続けることを見る。
7. Chargeでゲージが100%を超えた瞬間、公開用オーバーチャージ音に切り替わることを見る。
8. Lv動画、Critical動画の順で再生され、Resultに `CRITICAL` とCritical被害報告が出ることを見る。
9. Lv5動画からCritical動画へ切り替わる瞬間、公開用transition音が鳴り、画面左から右へ素早く暗転してから左から右へ暗転が解除されることを見る。
10. 暗転解除が始まる辺りで通常BGMプレースホルダーが止まり、Critical用BGMプレースホルダーが流れ始めることを見る。
11. Critical動画終了後のResult画面でもCritical用BGMプレースホルダーが継続し、`再プレイ`または`終了`を押した時点で通常BGMプレースホルダーに戻ることを見る。
12. 再度Ready以降で同じキーを押すと、強制モード表示が消えることを見る。
13. この項目で確認していた実在施設の追加映像・名称・被害表示は、公開版から削除済み。

---


## 0. 2026-06-06 技術確認契約

この手順では、実装、型、IPC、validator、状態遷移、Calibration、score、動画、Gate技術判定に関係する確認だけを扱います。会場運用、安全誘導、配布手順の改善は本更新の対象外です。

確認時の固定事項:

- Mock確認では入力モードを必ず `Mock Unity Bridge` にする。`Unity Bridge` modeでMock packetをscore経路へ流してはいけない。
- Gate B2/D1は実 `Unity Bridge` 入力で確認する。MockだけではGate通過扱いにしない。
- HakkeiReady timeoutは弱発勁ではなくno-impact。`hakkeiDetected=false`、`hakkeiTimedOut=true`、`hakkeiScore=0`、Lv0整合を確認する。
- jitterは2秒windowの `rawJitterRms2s` / `filteredJitterRms2s` 系に統一する。
- Debug Result Fixtureは入力モードではなく、Diagnostics/Dev menuの動画・Result表示確認機能として扱う。

## 1. この手順書で確認するもの

| 段階 | 名前 | 目的 | mocopi必要 |
|---|---|---|---:|
| Level 0 | 安全確認 | 周囲確認と中断操作を確認する | 不要 |
| Level 1 | キーボード確認 | Electron本体が最後まで動くか確認する | 不要 |
| Level 2 | Mock Unity Bridge確認 | UnityなしでUDP受信とIPC表示を確認する | 不要 |
| Level 3 | Unity Bridge確認 | Unityから右手座標JSONが届くか確認する | 可能なら必要 |
| Level 4 | 発表リハーサル | 本番と同じ流れで確認する | 推奨 |

最初に必ずLevel 0とLevel 1を通してください。安全確認とキーボード完走が通れば、mocopiやUnityが不安定でも発表の最低ラインを維持できます。

---

## 2. 用語の簡単な説明

| 用語 | 初心者向け説明 |
|---|---|
| Electron App | 観客に見せるゲーム本体です。画面、動画、スコアを担当します。 |
| Unity Bridge | mocopiの動きを右手の座標に変換してElectronへ送る小さなUnityアプリです。 |
| Motion Source App | mocopi PC app または XYN Motion Studioです。mocopiセンサーから体の動きを作ります。 |
| Receiver Plugin | Unity内でmocopiモーションを受け取り、Avatarへ反映するプラグインです。 |
| InputCheck | 入力が届いているかを見る確認画面です。 |
| Calibration | プレイヤーの自然な姿勢と前方向を覚えさせる作業です。 |
| MotionSample | Electron内部で使う共通の入力データです。mocopiでもキーボードでも同じ形になります。 |
| heartbeat | Unity Bridgeが生きていることをElectronへ知らせる定期信号です。 |
| seq | motion JSONごとの連番です。v1仕様では必須です。 |
| jitter | 静止しているのに座標が揺れる量です。大きいと誤検出の原因になります。 |

---

## 3. 確認記録テンプレート

テスト時は、以下をコピーして記録してください。

```text
日付:
確認者:
PC:
OS:
アプリ版:
Unity Bridge版:
入力モード: Keyboard / Mock Unity Bridge / Unity Bridge
動画ファイル: Lv0 Lv1 Lv2 Lv3 Lv4 Lv5
lastSeq表示: あり / なし / 対象外
heartbeat表示: alive / timeout / 対象外
受信Hz:
rawJitterRms2s: m
rawMaxJitter2s: m
rawDrift2s: m
filteredJitterRms2s: m
filteredMaxJitter2s: m
filteredDrift2s: m
validSampleRatioByPhase: Vertical / Forward / HakkeiReady
10秒静止中の発勁誤検出回数:
Gate判定: A / B1 / B2 / C / D1 / D2 / 対象外
結果: PASS / FAIL
失敗内容:
スクリーンショット/ログ:
次に直すこと:
```

---

## 4. Level 0: 安全確認

目的: プレイヤーが身体を動かしても危険がないことと、操作担当者がすぐ中断できることを確認します。

### 4.1 周囲確認

手順:

1. プレイヤーの前後左右1m程度に障害物がないことを確認する。
2. 発勁動作を人や物に当てない位置に立つ。
3. センサー、ケーブル、衣服が引っかからないことを確認する。
4. 体調が悪い人にプレイを促していないことを確認する。

合格条件:

- プレイヤーの周囲にぶつかりそうな物がない。
- 発勁動作の前方に人や壊れやすい物がない。
- 操作担当者がプレイヤーの状態を見られる位置にいる。

失敗時:

- 周囲が狭い場合、プレイ位置を変える。
- 安全を確保できない場合、その場で身体入力プレイを実施しない。

### 4.2 画面上の安全表示

手順:

1. Electron Appを起動する。
2. TitleまたはReady画面を見る。
3. 安全注意の文言があるか確認する。

合格条件:

- 「周囲を確認してから開始」または同等の注意が見える。
- 発勁動作を人や物に当てない旨が分かる。

失敗時:

- 安全表示がない場合、Gate A未通過として扱う。
- 見た目が未完成でもよいので、M1〜M2の時点で仮文言を入れる。

### 4.3 中断操作

手順:

1. KeyboardモードでReady以降まで進む。
2. `R` を押す。
3. もう一度Ready以降まで進む。
4. `Esc` を押す。

合格条件:

- `R` で現在プレイを破棄し、InputCheckまたはTitleへ戻れる。
- `Esc` でTitleへ戻る、またはアプリを安全に終了できる。
- 中断後に再度Keyboardモードで開始できる。

失敗時:

- `R` や `Esc` が効かない場合、発表リハーサルに進まない。
- 状態ごとのキー入力受付範囲を確認する。

---

## 5. Level 1: キーボード確認

目的: mocopiなしで、Electron本体がTitleからResultまで完走することを確認します。

### 5.1 起動

開発中の場合:

```bash
npm install
npm run dev
```

ビルド済みの場合:

```text
配布されたアプリをダブルクリックして起動する。
```

合格条件:

- アプリのウィンドウが開く。
- タイトル画面が表示される。
- 起動直後から通常BGMプレースホルダーが聞こえ、終端後もループする。
- 入力モードとしてKeyboardを選べる。
- 安全注意が表示される。

失敗時に見るもの:

- ターミナルのエラー。
- アプリが一瞬で閉じていないか。
- `config/` と `assets/` が欠けていないか。
- BGMが鳴らない場合、`assets/Sound/BGM/placeholder-main-loop.wav`とビルド後の`dist/renderer/sounds/BGM/placeholder-main-loop.wav`が存在するか、DevTools consoleに`AUDIO_MISSING`または`BGM autoplay blocked`が出ていないか確認する。

### 5.2 InputCheck画面

手順:

1. タイトル画面で入力モードを `Keyboard` にする。
2. `Start` を押す。
3. InputCheck画面を見る。
4. 開始ボタン、または指定キーで次へ進む。

合格条件:

- `InputCheck` 画面へ進む。
- 入力モードが `Keyboard` と表示される。
- KeyboardモードではUnity Bridge未受信でも先へ進める。
- キーボード操作説明が見える。

失敗時:

- Unity Bridge未受信で止まってしまう場合、Keyboardモードのフォールバック条件が壊れている。

### 5.3 Calibration画面

Keyboardモードでは、Calibrationを簡略化しても構いません。

手順:

1. 画面に「自然な姿勢で構える」などの説明が表示されることを確認する。
2. 指示に従って完了操作を行う。

合格条件:

- Calibration完了後、Readyへ進む。
- `calibration: 実施済み` または同等の表示が出る。

失敗時:

- ずっと待機する場合、Keyboardモード用の疑似Calibrationが実装されているか確認する。

### 5.4 Ready画面

手順:

1. 安全注意を見る。
2. カウントダウンを見る。
3. 何も押さずに待つ。

合格条件:

- 安全注意が読める。
- 2〜3秒程度で `VerticalCharge` へ進む。
- 表示がカウントダウンとして読める。

### 5.5 VerticalCharge画面

手順:

1. 10秒間、`Space` を何度か押す。
2. 上下チャージゲージを見る。

合格条件:

- `Space` を押すと上下チャージゲージが増える。
- 残り時間が減る。
- 10秒後に `ForwardCharge` へ進む。

失敗時:

- Spaceで値が増えない場合、`keyboardInput.ts` と `MotionSample` 生成を確認する。
- 10秒で進まない場合、タイマー処理を確認する。

### 5.6 ForwardCharge画面

手順:

1. 10秒間、`A` と `D` を交互に押す。
2. 前後チャージゲージを見る。

合格条件:

- `A` または `D` で前後チャージゲージが増える。
- 10秒後に `HakkeiReady` へ進む。

失敗時:

- A/Dで値が増えない場合、前後疑似入力がMotionSample化されているか確認する。

### 5.7 HakkeiReady画面

手順:

1. 画面に発勁指示が出たら `Enter` を押す。
2. 別の回では、`Enter` を押さずに待つ。

合格条件:

- `Enter` で，前方向の速度・加速度・短時間移動量を満たした発勁として扱われる。
- `ImpactDelay` へ進む。
- `Enter` を押さない場合でも、最大5秒程度でno-impact扱いとして進む。

失敗時:

- Enterで反応しない場合，HakkeiReady中だけEnterを受け付ける条件と，Main生成sampleの前方向速度・加速度・移動量を確認する。
- 何も押さず永久待機する場合、timeout処理を確認する。

### 5.8 VideoPlayback画面

手順:

1. 破壊動画が再生されるか見る。
2. 動画が終わるまで待つ。

合格条件:

- ローカルmp4が再生される。
- 動画終了後、Resultへ進む。

失敗時:

- 動画が出ない場合、`assets/videos/` のファイル名を確認する。
- 真っ黒のままなら、videoタグの読み込みパスとビルド後のasset配置を確認する。
- 動画終了後に進まない場合、`ended` イベントを確認する。

### 5.9 Result画面

手順:

1. 損害額を見る。
2. Powerを見る。
3. 上下チャージ、前後チャージ、発勁スコアを見る。
4. ランクを見る。
5. 再プレイを押す。

合格条件:

- 損害額が最も大きく表示される。
- Powerと3つの内訳が表示される。
- ランクが表示される。
- 再プレイでInputCheckまたはTitleへ戻れる。

失敗時:

- NaN、Infinity、undefinedが出た場合、スコア計算のガードが不足している。
- 再プレイ後に前回のスコアが残る場合、状態リセットが不足している。

### 5.10 キーボード10回連続確認

手順:

1. Keyboardモードで1プレイ完走する。
2. Resultから再プレイする。
3. 同じことを10回繰り返す。
4. 何回目で失敗したかを記録する。

合格条件:

- 10回すべて完走する。
- アプリがクラッシュしない。
- 動画再生後に毎回Resultへ進む。
- 再プレイ時にタイマーとスコアがリセットされる。

記録例:

```text
1回目 PASS
2回目 PASS
3回目 PASS
4回目 PASS
5回目 PASS
6回目 PASS
7回目 PASS
8回目 PASS
9回目 PASS
10回目 PASS
```

---

## 6. Level 2: Mock Unity Bridge確認

目的: Unityなしで、ElectronのUDP受信、JSON検証、IPC表示を確認します。

### 6.1 前提

プロジェクトにmock送信コマンドがある場合:

```bash
npm run mock:unity
```

まだない場合は、このLevel 2は未実施で構いません。ただし、UDP受信実装のマイルストーンで必ず作ることを推奨します。

### 6.2 正常packet確認

手順:

1. Electronを起動する。
2. 入力モードを `Mock Unity Bridge` にする。
3. InputCheckへ進む。
4. 別ターミナルでmock送信を起動する。
5. mockが `seq` 付きmotion JSONとheartbeat JSONを送っていることを確認する。

合格条件:

- Unity Bridge受信が `OK` になる。
- 最終motion受信時刻が更新される。
- 受信頻度が30Hz前後になる。
- rightHandReadyがtrueになる。
- x/y/z座標が変化する。
- `lastSeq` が表示される、またはログ上で `seq` が連番で増える。
- heartbeat状態がaliveになる。
- `motion:status` 相当の表示で受信Hz、最終受信時刻、invalidPacketCountが見える。

失敗時:

- 受信がNGのままなら、ポート `45100` が一致しているか確認する。
- 受信Hzが0なら、mock送信先が `127.0.0.1` になっているか確認する。
- JSONエラーが出る場合、motion JSONの形式を確認する。
- `seq` 欠損のmotion JSONは仕様上invalidです。mock送信機側に `seq` を入れてください。

### 6.2.1 協調 mock 全経路確認

手順:

1. `npm run dev` でElectronを起動し，入力モードを `Mock Unity Bridge` にする。
2. Calibration開始直前に，別ターミナルで `npm run mock:unity:calib` を実行する。
3. Calibrationが完了し，Readyへ進むことを確認する。
4. VerticalChargeとForwardChargeで各ゲージが増えることを確認する。
5. HakkeiReadyで前方突きが検出され，ImpactDelay，VideoPlayback，Resultまで進むことを確認する。

合格条件:

- mock入力だけでCalibration，チャージ，発勁検出，Resultが一連で進む。
- Diagnosticsでsourceが `mock-unity-bridge` のままである。
- Gate B2/D1の実Unity Bridge確認としては記録しない。

失敗時:

- Calibrationが失敗した場合，mockを停止してからCalibration開始直前に再起動し，neutral局面から測定をやり直す。
- HakkeiReadyでtimeoutになる場合，`mock:unity:calib` を使っていることと設定ファイルの発勁閾値を確認する。

### 6.3 `seq` 必須確認

手順:

1. mock送信で `seq` 付きmotion JSONを送る。
2. InputCheckで受信OKになることを確認する。
3. 次に、テスト用として `seq` だけ欠損したmotion JSONを送る。
4. 欠損packetが破棄される、またはinvalidPacketCountが増えることを確認する。
5. 同じ状態で次の正常packetを送ると、再び座標が更新されることを確認する。

合格条件:

- 標準設定では `seq` 欠損motion JSONが有効入力にならない。
- 受信順による `seq` 補完が行われない。
- 欠損packet後も、次の正常packetで受信処理が復帰する。

失敗時:

- `seq` 欠損packetが通常入力として処理される場合、UDP validatorを修正する。

### 6.4 不正JSON確認

手順:

1. mock送信機能で壊れたJSONを1回送る。
2. `rightHand.x` が文字列になっているmotion JSONを1回送る。
3. `frameRate` がNaN相当のheartbeat JSONを1回送る。
4. アプリ画面とログを見る。

合格条件:

- アプリがクラッシュしない。
- Error画面へ強制遷移しない、または軽い警告として表示される。
- invalid JSON countまたはinvalidPacketCountが増える、またはログに記録される。
- 不正packetはMotionSample化されない。

失敗時:

- アプリが落ちる場合、UDP receiverのparse例外処理が不足している。

---

## 7. Level 3: Unity Bridge単体確認

目的: Unity Bridgeが右手座標を取れているか確認します。

### 7.1 Unity Bridgeを起動する

手順:

1. Unityで `unity-bridge/` を開く。
2. Unity Bridge用Sceneを開く。
3. mocopi Receiver Pluginの設定を確認する。
4. Playする、またはUnity Bridgeビルドを起動する。

合格条件:

- Unity Bridge診断画面が見える。
- `Receiver`, `Avatar`, `RightHand` の状態が表示される。
- `Target: 127.0.0.1:45100` が表示される。
- `Send Hz` と `Last Seq` が表示される。

失敗時:

- Unityでエラーが出る場合、Consoleの赤いエラーを記録する。
- `RightHand: NG` の場合、Humanoid Rig、Animator、Bone Mappingを確認する。

### 7.2 RightHand座標確認

手順:

1. 右手を上げる。
2. Unity Bridge診断の `rightHand.y` を見る。
3. 右手を下げる。
4. もう一度 `rightHand.y` を見る。
5. 右手を前に出し、キャリブレーション後の前方向成分を見る。

合格条件:

- 右手を上げると `rightHand.y` が増える。
- 右手を下げると `rightHand.y` が減る。
- 前方へ出すと前方向成分が増える。

失敗時:

- 値がほぼ固定なら、RightHandの取得対象が間違っている可能性がある。
- Bone ID 18のposition値を直接読んでいないか確認する。
- 前後が逆なら、Calibrationまたは軸反転設定を確認する。

### 7.3 送信Hz確認

手順:

1. Unity Bridge診断の `Send Hz` を見る。
2. ElectronのInputCheckの受信Hzを見る。

合格条件:

- Unity側Send Hzが30Hz以上。
- Electron側受信Hzも30Hz以上に近い。
- heartbeatが1Hz以上で届く。

失敗時:

- Unity側が30Hz未満なら、送信間隔制御を確認する。
- Unity側は高いのにElectron側が低い場合、UDP受信やIPC更新頻度を確認する。

### 7.4 静止jitter確認

目的: 静止しているだけでゲージが増えたり、発勁が誤発火したりしないか確認します。

手順:

1. Unity BridgeとElectron Appを起動し、InputCheckがOKの状態にする。
2. 右手を自然な位置で止める。
3. 2秒以上静止し、diagnosticまたはログに出る次の値を記録する。
   - `rawJitterRms2s`
   - `rawMaxJitter2s`
   - `filteredJitterRms2s`
   - `filteredMaxJitter2s`
   - `rawDrift2s`
   - `filteredDrift2s`
4. Diagnostics/Dev menuの `static-hakkei-false-positive-test` を開始する。HakkeiReady timeoutは無効化され、detectorだけが通常条件で10秒評価される。
5. 10秒静止し、`staticFalseHakkeiCount10s` を記録する。

合格条件:

| 項目 | 合格値 |
|---|---:|
| `rawJitterRms2s` | `0.05 m` 以下 |
| `rawMaxJitter2s` | `0.12 m` 以下 |
| `filteredJitterRms2s` | `0.03 m` 以下 |
| `filteredMaxJitter2s` | `0.08 m` 以下 |
| `rawDrift2s` | `0.08 m` 以下 |
| `filteredDrift2s` | `0.05 m` 以下 |
| `staticFalseHakkeiCount10s` | 0回 |
| 受信頻度 | 30Hz以上 |

判定:

- すべて合格値以内ならPASSです。
- WARN表示が出た場合は、原因と実測値を記録してください。ただし、WARNはGate D1のPASSではありません。
- 基準値を変更する場合は、先に設定ファイルと変更理由を更新し、もう一度測定してください。

失敗時:

- rawだけ大きい場合は、センサー固定、装着、mocopi側の追従を確認する。
- rawは小さいがfilteredが大きい場合は、filter、dt、外れ値処理を確認する。
- 10秒静止で発勁する場合は、`hakkeiMinForwardDisplacement`、前方向速度条件、加速度条件を見直す。

---

## 8. Level 3: Unity Bridge + Electron確認

目的: Unity BridgeからElectronへRightHand JSONが届き、ゲーム入力として使えるか確認します。

手順:

1. Unity Bridgeを起動する。
2. Electron Appを起動する。
3. Electronで `Unity Bridge` 入力モードを選ぶ。
4. InputCheckを見る。

合格条件:

- Unity Bridge受信がOK。
- 最終motion受信時刻が500ms以内で更新され続ける。
- 受信頻度が30Hz以上。
- rightHandReadyがtrue。
- heartbeat状態がalive。
- `lastSeq` が増え続ける。
- `motion:status` 相当の表示で受信Hz、最終受信時刻、invalidPacketCountが見える。
- 現在座標が右手の動きに合わせて変わる。

失敗時:

- Unity側Targetが `127.0.0.1:45100` か確認する。
- Electron側listen portが `45100` か確認する。
- heartbeatは来るがmotionが来ない場合、RightHand取得とmotion送信処理を確認する。
- それでも不安定ならKeyboardへ切り替える。

---

## 9. Level 3: Calibration確認

### 9.0 Calibrationの固定合格条件

Calibration確認では次を固定条件として記録します。

| 項目 | 合格条件 |
|---|---|
| filter reset後discard | 300ms後から測定している |
| neutral | discard後2秒、`validForCalibration=true` が40sample以上 |
| forward | discard後1秒、`validForCalibration=true` が20sample以上 |
| 受信Hz | 25Hz以上 |
| forward距離 | 0.15m以上 |
| 右手消失 | 500ms以上でCalibration失敗になる |
| session変更 | Calibration結果が破棄される |

失敗時は、単に「失敗」ではなく、`LOW_SAMPLE_RATE`、`RIGHT_HAND_UNAVAILABLE`、`JITTER_WARN`、`FORWARD_DISTANCE_TOO_SMALL` などの理由表示を確認します。


目的: プレイヤーの基準姿勢と前方向が保存されるか確認します。

手順:

1. InputCheckがOKの状態でCalibrationへ進む。
2. filter reset後、300msは測定に含めない表示またはログを確認する。
3. 自然な姿勢で右手を構え、discard後2秒静止する。
4. 前方向へ右手を0.15m以上出し、discard後1秒保持する。
5. 完了表示を見る。

合格条件:

- neutralは2秒、40valid sample以上で保存される。
- forwardは1秒、20valid sample以上で保存される。
- `calibration: 実施済み` になる。
- `forwardVector` と `upVector` が保存される。
- Readyへ進む。
- calibrationQualityに受信Hz、jitter、sample数が反映される。

失敗時:

- 静止しても完了しない場合、静止判定が厳しすぎる可能性がある。
- 受信Hzが低い場合、先にInputCheckへ戻る。

---

## 10. Level 3: 実動作プレイ確認

目的: mocopi入力で上下、前後、発勁が動くか確認します。

### 10.1 上下チャージ

手順:

1. VerticalChargeで右手を上下に動かす。
2. 上下チャージゲージを見る。

合格条件:

- 右手を上下に動かすとゲージが増える。
- 静止しているだけでは大きく増えない。

失敗時:

- ゲージが増えない場合、`upVector`、座標変化、noise thresholdを確認する。
- 静止で増え続ける場合、ノイズ閾値またはフィルタを確認する。

### 10.2 前後チャージ

手順:

1. ForwardChargeで右手を前後に動かす。
2. 前後チャージゲージを見る。

合格条件:

- 右手を前後に動かすとゲージが増える。
- 引き戻しでも増える。
- 横振りでは大きく増えにくい。

失敗時:

- 横振りで大きく増える場合、forwardVectorがずれている可能性がある。
- 前後で反応しない場合、Calibrationと軸設定を確認する。

### 10.3 発勁

手順:

1. HakkeiReadyで静止する。
2. 静止中に勝手に発勁しないか10秒程度見る。
3. 前方へ一撃を出す。

合格条件:

- 10秒静止中に発勁しない。
- 前方への一撃でImpactDelayへ進む。
- ResultにHakkeiScoreが表示される。

失敗時:

- 静止中に発火する場合、`hakkeiMinForwardDisplacement` を上げる候補。
- 軽い動きで高得点が出る場合、加速度ピーク依存を下げる候補。
- 強く突いても反応しない場合、平滑化が強すぎるか、forward方向が逆の可能性がある。

---

## 11. エラー復帰確認

### 11.1 Unity Bridge未受信

手順:

1. ElectronをUnity Bridge入力モードでInputCheckにする。
2. Unity Bridgeを停止する。
3. 1秒以上待つ。

合格条件:

- `UNITY_BRIDGE_TIMEOUT` と `Unity Bridge未接続` が表示される。
- アプリが落ちない。
- Keyboard入力へ切り替えられる。

### 11.2 RightHand未取得

手順:

1. Unity Bridge側でRightHandが取れない状態を作る、またはheartbeatで `rightHandReady=false` を送る。
2. ElectronのInputCheckを見る。

合格条件:

- `RIGHT_HAND_UNAVAILABLE` と `右手ボーンが取得できません` が表示される。
- Keyboard入力へ切り替えられる。

### 11.3 低受信頻度

手順:

1. mock送信またはUnity側設定で20Hz未満にする。
2. InputCheckを見る。

合格条件:

- `LOW_SAMPLE_RATE` と `入力が不安定です` が表示される。
- プレイ開始前に状態が分かる。
- Keyboard入力へ切り替えられる。

### 11.4 validator系エラー表示

固定script名:

```text
npm run mock:unity
npm run mock:unity:seq-gap
npm run mock:unity:seq-missing
npm run mock:unity:seq-duplicate
npm run mock:unity:timestamp-rollback
npm run mock:unity:timestamp-gap
npm run mock:unity:heartbeat-stall
npm run mock:unity:huge-json
npm run mock:unity:invalid-json
npm run mock:unity:right-hand-unavailable
npm run mock:unity:non-active-source
```

上記scriptの確認はvalidator / IPC / diagnostics用です。実Unity BridgeのGate B2/D1代替には使いません。


次の異常系は、SPEC固定表のcodeと日本語文言で表示されることを確認します。テスト用mock scriptが未実装の場合は、そのステップを未完了にしてください。

| 異常 | 期待code | 期待表示 |
|---|---|---|
| JSON parse失敗 | `INVALID_JSON` | `Unity Bridge出力形式エラー` |
| 巨大JSON | `JSON_TOO_LARGE` | `Unity Bridge出力が大きすぎます` |
| seq巻き戻り | `SEQ_ROLLBACK` | `motion seqが巻き戻りました` |
| timestamp巻き戻り | `TIMESTAMP_ROLLBACK` | `timestampが巻き戻りました` |

合格条件:

- codeと日本語表示が表のとおりである。
- アプリが落ちない。
- 正常入力へ戻したとき、`app:error-clear` により古いエラー表示が消える。

### 11.5 動画欠落

手順:

1. テスト用にLv3などの動画ファイル名を一時的に変える。
2. そのLvが選ばれるPowerでVideoPlaybackへ進む。

合格条件:

- アプリが落ちない。
- `動画ファイルが見つかりません` と不足ファイル名が表示される。
- TitleまたはInputCheckへ戻れる。

テスト後は必ずファイル名を元に戻す。

---



### 12.0 Debug Result Fixtureの扱い

Debug Result Fixtureは入力モードではありません。Diagnostics/Dev menuから次の2種類だけを確認します。

| Fixture | 確認対象 | 注意 |
|---|---|---|
| video-level-fixture | power直指定によるLv0〜Lv5再生経路 | score計算の合格判定に使わない |
| score-breakdown-fixture | vertical/forward/hakkeiから `calculatePowerFromScores()` を通したResult表示 | 通常play pathへ混ぜない |

記録欄の入力モードには `Debug Result Fixture` と書かず、`入力モード: 対象外 / Fixture種別: ...` と分けて記録します。

## 12. 動画レベル確認

目的: Powerに応じてLv0の背景表示、またはLv1〜Lv5の動画が選ばれるか確認します。

Debug Result Fixtureがある場合、次を確認してください。これはプレイ入力モードではなく、動画レベルとリザルト表示の境界値確認だけに使います。画面上で指定する値は `verticalScore`、`forwardScore`、`hakkeiScore` のプリセットでも、video selector単体確認用のPowerでも構いませんが、通常プレイ経路へ混ぜないでください。

| テストPowerまたはプリセット結果Power | 期待Lv | 期待表示 |
|---:|---:|---|
| 0 | Lv0 | 背景画像のみ |
| 9999 | Lv0 | 背景画像のみ |
| 10000 | Lv1 | `LV1_1.mp4` など |
| 49999 | Lv1 | `LV1_1.mp4` など |
| 50000 | Lv2 | `LV2_1.mp4` など |
| 150000 | Lv3 | `LV3_1.mp4` など |
| 300000 | Lv4 | `LV4_2.mp4` など |
| 600000 | Lv5 | `LV5_1.mp4` など |

合格条件:

- 境界値で期待通りのLvになる。
- Debug Result Fixtureの結果に `ScoreBreakdown` または同等の内訳が残る。
- 動画ファイルが再生される。
- 動画終了後Resultへ進む。
- Debug Result Fixtureを使った場合でも、通常プレイのKeyboard / Unity Bridge入力経路には影響しない。

---

## 13. 本番ビルド確認

目的: 開発環境ではなく、本番配布形態で動くか確認します。

手順:

1. ビルドを作る。

```bash
npm run build
```

2. 生成されたアプリを開く。
3. Keyboardモードで1プレイ完走する。
4. 動画が再生される。
5. Resultから再プレイする。
6. `R` と `Esc` の中断を確認する。

合格条件:

- 開発サーバーなしで起動する。
- 動画パスが解決される。
- configが読み込まれる。
- Keyboardモードで完走する。
- 中断操作が効く。

失敗時:

- 開発中だけ動く場合、ビルド後assetパスを確認する。
- configが読めない場合、パッケージ後の配置先を確認する。

---

## 14. Level 4: 発表リハーサル

目的: 本番当日の流れで、操作担当者が迷わず進行できるか確認します。

### 14.1 標準起動リハーサル

手順:

1. Sensor data receiverをPCへ接続する。
2. mocopiセンサーを装着し、Motion Source Appで認識する。
3. Unity Bridgeを起動する。
4. Unity BridgeでReceiver、Avatar、RightHandがOKであることを確認する。
5. Electron Appを起動する。
6. InputCheckでRightHand JSON受信を確認する。
7. Calibrationを行う。
8. 安全確認を読み上げる。
9. 1プレイ行う。
10. Resultを表示する。

合格条件:

- 操作担当者が手順を見ながら最後まで進められる。
- InputCheckのOK/NGを説明できる。
- プレイヤーに安全注意を伝えられる。
- Result表示まで行ける。

### 14.2 Keyboard切替リハーサル

手順:

1. Unity Bridge入力が不安定な状態を想定する。
2. 操作担当者がKeyboard入力へ切り替える。
3. Keyboardで1プレイ完走する。

合格条件:

- 30秒以内にKeyboard入力へ切り替えられる。
- 発表進行が止まらない。
- 「入力が不安定なため予備モードで続けます」と説明できる。

### 14.3 発表当日の中止基準

次のいずれかに該当する場合、mocopi入力に固執せずKeyboard入力へ切り替える。

- Unity Bridge入力が3分以内に安定しない。
- RightHandが取得できない。
- 受信頻度が20Hz未満で改善しない。
- 発勁判定が明らかに誤発火する。
- プレイ中に1秒以上入力が途切れる。
- 周囲の安全を確保できない。
- 発表進行に支障が出る。

---



## 14.4 Gate技術判定の固定条件

| Gate | 判定 |
|---|---|
| Gate A | Keyboard modeでMain生成 `MotionSample`、通常Hakkei判定、通常ScoreBreakdown、動画、Resultまで10回完走 |
| Gate B1 | Unity Bridge単体でRightHand取得、v1 common field、heartbeat readiness確認 |
| Gate B2 | 実 `Unity Bridge` packetだけでInputCheck OK。Mockのみは不可 |
| Gate C | Unity実入力でCalibration、上下/前後チャージ、source切替、動画選択が成立 |
| Gate D1 | 実Unity入力でmotionHz、heartbeatHz、phase別validSampleRatio、2秒jitter、10秒静止誤検出、実playがすべてPASS |
| Gate D2 | Keyboard fallback承認。Gate D1通過扱いにはしない |

Gate D1記録には、`rawJitterRms2s`、`rawMaxJitter2s`、`rawDrift2s`、`filteredJitterRms2s`、`filteredMaxJitter2s`、`filteredDrift2s`、Vertical/Forward/HakkeiReady別のvalidSampleRatioを必ず残します。

## 15. 最終チェックリスト

発表前に、次を確認してください。

```text
[ ] docs/requirements.md が存在する
[ ] docs/internal/AGENTS.md / SPEC.md / MILESTONES.md が最新版
[ ] HUMAN_TEST_GUIDE_JA.md が正式手順として更新されている
[ ] HUMAN_TEST_GUIDE.md は案内だけで、本文重複していない
[ ] TitleまたはReadyに安全注意が表示される
[ ] 起動直後から公開用BGMプレースホルダーが鳴り、終了後にループする
[ ] Chargeでゲージが少しでも溜まると公開用チャージ音が鳴り、Lv動画開始時に止まる
[ ] Critical発生時、Lv5再生中は通常プレースホルダー、CriticalVideoとResultではCritical用プレースホルダー、Result終了後は通常プレースホルダーが鳴る
[ ] R / Esc で中断できる
[ ] KeyboardでTitleからResultまで完走する
[ ] Keyboardで10回連続完走する
[ ] Lv1〜Lv5動画が配置されている。Lv0は背景画像を使う
[ ] 動画欠落時にErrorへ行ける
[ ] Mock Unity Bridgeでseq付きmotion JSONが届く
[ ] seq欠損motion JSONがinvalidになる
[ ] heartbeatがInputCheckに表示される
[ ] Unity BridgeでRightHand座標が変化する
[ ] 2秒静止filteredJitterRms2s <= 0.03 m
[ ] 2秒静止filteredMaxJitter2s <= 0.08 m
[ ] filteredDrift2s <= 0.05 m
[ ] 10秒静止で発勁誤検出0回
[ ] 本番ビルドで起動する
[ ] 外部ディスプレイで読める
[ ] Keyboard切替を30秒以内にできる
```
## 公開版QR登録の確認

1. PCをインターネットへ接続し、`scripts/windows/release.bat`をダブルクリックする。
2. `START GAME`を選び、REGISTRATIONに`https://score.hakkei.org/join?...`のQRと`Waiting for phone registration...`が表示されることを確認する。
3. スマートフォンの標準カメラでQRを読み、個人情報を含まないニックネームを登録する。
4. 成功条件: Electronが登録名を受け取ってInputCheckへ進み、スマートフォン側も入力機器待機画面へ切り替わる。
5. `logs/state-YYYYMMDD.log`に`ws status=open`または`fetch entry ... -> ok`が記録され、`Failed to fetch`がないことを確認する。

失敗時は、PCとスマートフォン双方のインターネット接続、QR下に表示されたURL、`https://score.hakkei.org/`がスマートフォンで開くか、同ログの`REMOTE`行を確認する。サーバー障害時は次のローカル継続運用へ切り替える。

## ローカル継続運用（サーバーダウン時）

1. 通常モードでサーバーが利用できる間に一度REGISTRATIONまたはプレイを行い、プレイヤー候補とランキングを同期する。
2. `scripts/windows/release_local.bat` をダブルクリックする。
3. REGISTRATIONにQRではなく `OFFLINE REGISTRATION` とキーボード名前入力が表示されることを確認する。
4. 名前欄へキーボードで名前を入力する。同期済みの名前候補とハイスコアが表示され、既存名を選べることを確認する。
5. 入力設定を変更していない状態でmocopi BLEが選択され、通常どおりプレイできることを確認する。
6. Resultまで進め、スコアがローカルランキングへ反映されることを確認する。
7. `logs/state-YYYYMMDD.log` の起動行に `localMode=true` があり、QR待機やサーバー同期エラーで進行が止まらないことを確認する。

失敗時は、同ログの起動行、名前入力欄、mocopi BLEの接続表示を確認する。ローカルモードはサーバー復旧後の未送信スコア自動アップロードを行わないため、ローカルで生じた記録はこのPC上の記録として扱う。

## 公開ポートフォリオ版の素材確認

1. `npm run assets:audio-placeholders`を実行し、`generated 25 public placeholder audio files`と表示されることを確認する。
2. `npm test`を実行し、公開用音声assetの検査がPASSすることを確認する。
3. `npm run build`を実行し、`dist/renderer/sounds/`へプレースホルダーWAVだけがコピーされることを確認する。
4. `npm run dev -- --local-mode`で起動し、Keyboardを選択してTitleからResultまで進める。
5. 通常BGM、チャージ、構え、パンチ、リザルトの各タイミングで、短い電子音だけが鳴ることを確認する。
6. Lv1〜Lv5とCritical動画を各1本再生し、映像が720p版への再圧縮後も停止・decode errorなく最後まで再生されることを確認する。

失敗時は、開発者コンソールの`AUDIO_MISSING`、`VIDEO_DECODE_FAILED`、`VIDEO_STALLED`と、`dist/renderer/sounds/result-sfx-manifest.json`を確認する。
