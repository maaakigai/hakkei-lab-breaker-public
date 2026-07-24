# 現行確認チェックリスト（BLE直読・単手パンチ版）

このチェックリストは現行BLE版用です。旧版は [archive/legacy/verification_checklist-unity-calibration.md](archive/legacy/verification_checklist-unity-calibration.md) に移しました。

## 0. 旧版との差異

| 項目 | 旧版チェック | 現行チェック |
|---|---|---|
| 実入力Gate | Unity Bridge受信、RightHand、Calibration | BLE probe、sidecar、50Hz、角速度 |
| 静止品質 | raw/filtered jitter、validSampleRatio | 静止10秒false trigger 0、noise floor |
| チャージ | Vertical/Forward別ゲージ | 単一Chargeの積分 |
| 発火 | forward速度/加速度/変位 | intensity peak threshold |
| 完走 | Unityまたはmock | BLE実機10連続、keyboardはdebugのみ |

## 1. 自動チェック

- [ ] `npm run typecheck` が通る。
- [ ] `npm run lint` が通る。
- [ ] `npm test` が通る。
- [ ] `npm run build` が通る。
- [ ] 作業ツリーに意図しない差分がない。

## 2. Gate A: Baseline App

- [ ] `npm run dev:debug` で診断・入力切替を含むDebug UIとしてElectronが起動する。
- [ ] `scripts/windows/release.bat` でリリースUIとしてElectronが起動する。
- [ ] `START GAME`で共有デモサーバーのHTTPS URLを含むQRが表示され、`Failed to fetch`にならない。
- [ ] スマートフォンでQRを読み、ニックネーム登録後にElectronがInputCheckへ進む。
- [ ] `logs/state-YYYYMMDD.log`に`ws status=open`またはHTTPの`fetch entry ... -> ok`が記録される。
- [ ] Debug UIのTitleに `mocopi BLE（本命）`、`Keyboard（debug）`、`None` が出る。
- [ ] Debug UIのTitleにある `（dev）メニューを開く` からLv0〜Lv5の再生経路を確認できる。Lv0は動画なしで背景画像のままResultへ進む。
- [ ] Debug UIの `動画欠落テスト（VIDEO_MISSING）` でError経路を確認できる。
- [ ] Debug UIのKeyboard入力で `Title → InputCheck → Ready → Charge → HakkeiReady → VideoPlayback → Result` を完走できる。
- [ ] DebugのLv強制はLv5を既定確認対象にし、通常フローを通って `assets/videos/LV5/` 配下の動画が画面全体で再生される。
- [ ] Title表示後、Lv1〜Lv5の動画が不可視preload cacheに登録され、VideoPlaybackでは選択Lvのvideoがcacheから再生される。Lv0はpreload対象外。
- [ ] `ImpactDelay → VideoPlayback` で黒背景に切り替わらず、研究室背景の上に動画が重なる。
- [ ] Resultでは再生動画の最終フレームが背景として停止し、その上のResult表示が読める。
- [ ] Resultでは損害額が0円から最終値までカウントアップし、停止後にランクがぼけた大きい表示から焦点が合って標準サイズへ収束する。
- [ ] リリースUIのResultでは詳細tableではなく、被害報告が5件表示される。
- [ ] Debug UIのResultでは被害報告に加えてPower、動画レベル、発勁、内訳、rawの詳細tableが表示される。
- [ ] `replay` / `finish` / `Esc` 後にResultの最終フレーム背景が残らない。
- [ ] Ready / Charge / HakkeiReady の中央メッセージがゲームHUD風のプレートで表示され、背景画像の上でも読める。
- [ ] リリースUIではReadyに安全注意文が重複表示されず、HakkeiReadyの構え/パンチ診断やImpactDelayの内部説明文が出ない。
- [ ] 発勁エネルギーゲージが Ready / Charge / HakkeiReady / ImpactDelay の間ずっと表示される。
- [ ] Space連打でChargeが増える。
- [ ] Charge画面では発勁エネルギーゲージが画面下部に表示され、Spaceまたは実入力で0.1%単位の値と塗り幅が滑らかに更新される。
- [ ] Charge画面の発勁エネルギー `%` 表示が、低い値では水色、中間では黄色、高い値では赤系へ連続的に変化する。
- [ ] Chargeを100%より多く溜めると、数値が100%超で表示され、表示文言が `オーバーチャージ` になる。ただしResultのチャージ効果は100%相当から増えない。
- [ ] Chargeを125%まで溜めるとガラスのひび割れ素材が初めて表示され、2種類の公開用プレースホルダーSFXから再生処理がランダムに選ばれる。その後150%、175%、200%... の25%刻みでひび割れが増えるたびに同様に選ばれる。公開版WAVは完全無音のため、音が聞こえることは合格条件にしない。
- [ ] Enterでパンチ扱いになり、Resultに進む。
- [ ] Rank Sでも研究室破壊動画は1本だけ再生され、追加の企業映像や特別イベントへ分岐しない。
- [ ] HakkeiReadyで何もしないとtimeoutし、no-impact / Lv0になる。
- [ ] RでReady以降からInputCheckへ戻る。
- [ ] EscでTitleへ戻る。

## 3. Gate B: BLE Probe

- [ ] mocopiがWindowsのペアリング済み状態ではなく、青点滅のadvertising状態である。
- [ ] `tools/mocopi_ble_probe.py` またはsidecarでQM-SS1を発見できる。
- [ ] 36byte payloadを受信できる。
- [ ] 10秒以上、45〜55Hzで受信できる。
- [ ] 静止時の角速度noise floorを記録した。
- [ ] パンチ時のpeak角速度が静止より十分大きい。

## 4. Gate C: Sidecar Integration

- [ ] Titleで `mocopi BLE（本命）` を選ぶとsidecarが起動する。
- [ ] InputCheckにsidecar状態が表示される。
- [ ] 受信Hz、最終受信age、charge、intensityが表示される。
- [ ] sidecar再起動ボタンで復帰できる。
- [ ] `録画再生でテスト（実機なし）` が動く。
- [ ] sidecar停止や実機未接続でもアプリが落ちない。
- [ ] Keyboard debug fallbackへ切り替えられる。

## 5. Gate D: Signal Quality

- [ ] 完全静止10秒でfalse trigger 0。
- [ ] 静止時のnoise floorを記録した。
- [ ] 弱い動作、ゆっくり突き、本気パンチのpeakが区別できる。
- [ ] 本気パンチのpeak分布を記録した。
- [ ] 連続受信中に大きなgapがない。
- [ ] 不正packet、低Hz、disconnectが診断に出る。

## 6. Gate E: Game Loop via BLE

- [ ] BLE実機でReadyへ進める。
- [ ] Charge中に利き手を振るとタメが増える。
- [ ] HakkeiReadyで一発パンチするとImpactDelayへ進む。
- [ ] 動画Lvがタメ量とパンチ強度で変わる。
- [ ] Resultに損害額、ランク、内訳が出る。
- [ ] 10連続プレイでクラッシュ0。
- [ ] timeout時はno-impact / Lv0になる。

## 7. Gate F: Demo Readiness

- [ ] 30分連続受信で平均45〜55Hz。
- [ ] payload violation 0。
- [ ] >500ms gap 0。
- [ ] >200ms gapが30分で10回以下。
- [ ] disconnect時に手操作なしで3秒以内に復帰する、またはKeyboard fallbackへ誘導される。
- [ ] センサー貼り替え10回で接続維持または復帰手順が明確。
- [ ] 本番PCで10連続プレイできる。
- [ ] 本番動画ファイルLv1〜Lv5が配置済み。Lv0は背景画像を使うため動画なし。

## 8. 記録欄

```text
日付:
実施者:
commit:
PC:
mocopi:
入力:

typecheck:
lint:
test:
build:

BLE Hz:
payload:
static false trigger:
noise floor:
punch peak:
10連続:
30分耐久:

判断:
残課題:
```
