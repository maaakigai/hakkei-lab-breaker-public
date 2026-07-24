# 現行利用手順（BLE直読・単手パンチ版）

この文書は、2026-07-24時点の公開版に基づく現行手順です。旧 Unity Bridge / Calibration / 上下・前後チャージ版とは異なります。

## 1. 現行版の目的

利き手手首に装着した mocopi 1台からBLEで姿勢quaternionを受け取り、Electron Mainで角速度ベースの `PunchInputSample` を生成します。Rendererはこのsampleだけをゲーム入力として使い、タメ量、パンチ強度、動画Lv、損害額、ランクを表示します。

## 2. 旧版との差異

| 項目 | 旧版 | 現行版 |
|---|---|---|
| 入力経路 | Unity Bridge UDP `127.0.0.1:45100` | BLE sidecar → Main |
| センサー数 | 右手座標、途中で両手v2も検討 | mocopi 1台 |
| 入力型 | `MotionSample` | `PunchInputSample` |
| フロー | `Calibration → VerticalCharge → ForwardCharge → HakkeiReady` | `Ready → Charge → HakkeiReady` |
| 判定 | forward/up軸、速度、加速度、変位 | 角速度 magnitude、charge積分、intensity peak |
| キーボード | 本番予備入力 | debug fallback |
| Gate | Unity実入力Gate | BLE Probe / Sidecar / Signal / Game Loop |

## 3. 起動

```bash
npm install
npm run dev:debug
```

上記は入力切替や診断UIを使う確認用です。通常の公開体験は `scripts/windows/release.bat` から起動します。品質確認では次も通します。

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 4. 操作フロー

1. Titleで `mocopi BLE（本命）` を選びます。
2. `開始` でInputCheckへ進みます。
3. mocopiを青点滅の接続待ち状態にし、必要なら軽く振って起こします。
4. sidecarが受信すると、InputCheckの診断にHz、最終受信、charge、intensityが出ます。
5. `Ready` で構えます。
6. `Charge` で利き手を振り、タメを増やします。
   - ゲージの数値は100%を超えて表示されます。ただし現時点では表示のみで、スコア計算上のチャージ効果は100%相当で上限です。
   - 125%からガラスのひび割れ演出が入り、以降25%ごとにひび割れが増えます。ひび割れが増える瞬間は2種類の公開用プレースホルダーSFXから再生処理がランダムに選ばれます。公開版のWAVは完全無音です。
7. `HakkeiReady` で構えカウント後に一発パンチします。
8. 動画再生後、Resultで損害額、ランク、タメ、パンチ強度を確認します。

## 5. 実機がない場合

InputCheckで `録画再生でテスト（実機なし）` を押すと、録画CSVを使ってBLE経路の代替確認ができます。

`Keyboard（debug）` では次の操作で通し確認できます。

| キー | 動作 |
|---|---|
| Space | Charge中に連打してタメを増やす |
| Enter | HakkeiReadyでパンチ |
| R | Ready以降をInputCheckへリセット |
| Esc | どの主要状態からでもTitleへ戻る |

Keyboardで完走してもMVP完成扱いにはしません。MVPの主語はmocopi BLE実機です。

## 5.1 動画Lvの強制確認（Debug / Dev menu）

Title画面の `（dev）メニューを開く` から、`Lv0`〜`Lv5` を直接選べます。

この操作は通常プレイ経路ではありません。選んだLvの代表 `ScoreBreakdown` を作り、直接 `VideoPlayback` へ進めて、Lv0の背景表示または対応するmp4再生とResult遷移を確認するためのものです。

用途:

- Lv0は動画なしで背景画像のままResultへ進むか確認する。
- Lv1〜Lv5の動画ファイルが正しく再生できるか確認する。
- 動画欠落時にError表示へ進むか確認する。
- 実機BLEやKeyboard入力を使わず、映像素材だけを順番に確認する。

関連ボタン:

| ボタン | 動作 |
|---|---|
| `Lv0`〜`Lv5` | 指定Lvの再生経路を確認する。Lv0は背景画像のみ |
| `Result Fixture` | 代表Result表示を直接確認する |
| `動画欠落テスト（VIDEO_MISSING）` | 存在しない動画名でError経路を確認する |
| `テストエラー表示` | Error画面表示を確認する |

## 6. BLE操作

InputCheckのBLE操作ボタンを使います。

| ボタン | 用途 |
|---|---|
| `sidecar 再起動` | BLE受信プロセスを再起動する |
| `録画再生でテスト（実機なし）` | 実機なしで記録CSVを流す |
| `実験ウィザードを始める（自動・推奨）` | 静止、パンチ、チャージ、タメ付きパンチの計測を進める |
| `Keyboardに切替（debug fallback）` | BLE不調時にdebug入力へ逃がす |

## 7. 実験ウィザード

実験ウィザードは、スコア設定を実測から決めるための計測UIです。静止床、本気パンチ、チャージ量、タメ付きパンチを順に記録し、最後にJSONを保存します。

旧版との差異: 旧版のCalibration確認ではなく、現行版では角速度のノイズ床、タメ積分、パンチpeakを測ります。

## 8. 成功条件

現行MVPの完成条件は次です。

- mocopi 1台BLEで `Charge → HakkeiReady → Result` が10連続で落ちずに通る。
- 静止10秒で誤発火0。
- タメ小/大、弱/強で動画Lvが変わる。
- BLE断でもアプリが落ちず、Keyboard debug fallbackへ切り替えられる。
- `npm run typecheck && npm run lint && npm test && npm run build` が通る。

## 9. 失敗時に見る場所

| 症状 | 確認 |
|---|---|
| BLE未受信 | mocopiが青点滅か、Windowsでペアリング済みになっていないか、sidecar状態 |
| Hzが出ない | InputCheck診断、sidecar再起動、録画再生での再現 |
| 静止で発火 | `punch.intensityThresholdBle`、`chargeNoiseFloor`、静止床計測 |
| Chargeが増えない | `chargeDelta`、`chargeReadyThreshold`、利き手を振っているか |
| ResultがLv0だけ | パンチpeak、`scoreGateMin`、`detectGateMin` |
| 動画が出ない | `assets/videos/LV1/`〜`LV5/` のmp4配置。Lv0は動画なしで背景画像を使用 |

## 10. 現行版で使わない旧手順

次は旧版手順です。履歴として残していますが、現行BLE MVPの確認には使いません。

- Unity Bridgeを起動して右手Transformを送る。
- `Calibration` でneutral/forwardを測る。
- `VerticalCharge` と `ForwardCharge` を別々に確認する。
- Gate B2/D1をUnity Bridge実入力で判定する。
- `validForCalibration` を現行ゲームフローの合格条件にする。
