# 20260623 M10 mocopi実機入力検証 — 進行ログ

## 対象ステップ
M10（mocopi 実機入力検証）M10-01〜M10-10。前提として M9（Unity Bridge）が Gate B1/B2 PASS 済
（[M9 日誌](20260623-m9-unity-bridge.md)）。

## 結論（2026-06-24 完了）
**M10 完了。M10-01〜10 すべて PASS ＋ 正規化レンジ実測チューニング済み。Gate C 達成。**
実機 mocopi で通しプレイ（Calibration→上下/前後→発勁→Result）が成立し、Keyboard fallback も確認。

## M10-01 Motion Source App 選定（採用と理由）
- **採用: mocopi PC app**。
- 理由:
  - SPEC §21 Q-01 の暫定標準が「まず mocopi PC app を標準候補にする」であり、これに一致。
  - AGENTS §3 はスマホ版 mocopi アプリの標準入力経路化を禁止。PC app は規約準拠経路（SPEC §3.2 の
    「mocopi PC app / XYN Motion Studio」）。
  - 実機で Gate B1（Unity 単体）/ Gate B2（Electron InputCheck）を PASS 済（2026-06-23）。
  - ユーザーが mocopi PC app（課金プラン）を保有しており、追加導入なしで標準経路を満たせる。
- 代替: XYN Motion Studio（同じく SPEC §3.2 の許容 Source）。mocopi PC app が不調な場合の予備。
- データ経路: mocopi PC app → UDP `127.0.0.1:12351`（Unity Scene の MocopiSimpleReceiver 受信ポート。
  ※ 12351 は指示書ではなく Scene/プラグイン既定値）→ Unity Bridge → UDP `45100`（SPEC §7.1）→ Electron。

## M10-02〜M10-10 実機測定結果（記入中）

| ID | 確認項目 | 基準 | 結果 | 備考 |
|---|---|---|---|---|
| M10-02 | Sensor data receiver 接続 | PCでセンサー認識 | **PASS** | mocopi PC app でセンサー認識・全経路でモーション到達を確認済み |
| M10-03 | Source→Unity 受信 | Avatarが動く | PASS(B1で確認) | |
| M10-04 | 右手上下 | 上げy増/下げy減 | PASS(B1で確認) | pos追従を確認 |
| M10-05 | 右手前後 | forward成分変化 | PASS(B1で確認) | pos z追従を確認 |
| M10-06 | 静止2秒 jitter | rawRms≤0.05 / filtRms≤0.03 / filtDrift≤0.05 (m) | **PASS** | 静止実測 raw rms 2mm / filt 2mm / drift 4mm。大幅クリア（106mmは動作中の値だった） |
| M10-07 | 10秒静止 発勁誤検出 | staticFalseHakkeiCount10s=0 | **PASS** | 実機 staticFalseHakkeiCount10s=0（482 sample 評価）。誤検出ゼロ |
| M10-08 | 受信Hz | Electronで≥30Hz | PASS(50Hz)(B2で確認) | |
| M10-09 | 欠落 | 連続1秒以上の欠落なし | **PASS** | 実機通しプレイ中フリーズ・連続欠落なし |
| M10-10 | Keyboard fallback | 30秒以内に切替 | **PASS** | InputCheckで「Keyboードに切替」→src=keyboard即切替・キーボードで通常プレイ成立 |

## サブエージェント監査（2026-06-23）
M10 が依存する測定パイプラインを2観点で監査。
- **規約違反: 0件・疑い0件**。jitter 命名(rawJitterRms2s系/2秒/3Dノルム)・Main生成・validForScore契約(V-1)・
  config化・TS規約・最近の変更(playAccumulator/新規テスト/C# StatusBridge)すべて準拠。中核計算
  （jitter rms/max/drift・単位m→mm・Hz・droppedFrame）も正しいことを確認。
- **デバッグ: 重大2件（計算誤りではなく測定機能の欠落）**。
  1. `staticFalseHakkeiCount10s` を出すハーネスが未実装 → M10-07 が読めない。→ **本ステップで実装**（下記）。
  2. `validSampleRatioByPhase` が常に空 `{}`（`unityBridgeUdpReceiver.ts:518`）→ Gate D1 の phase別判定が読めない。
     → 設計が **UNRESOLVED P2-02 で未確定**（diagnostics に持たせるか Result/run log か未決）。推測実装せず
     SPEC 解決待ちとする（AGENTS §1）。M10-06 の jitter と全体 validSampleRatio は読めるので M10 は進行可。

## M10-07 ハーネス実装（static-hakkei-false-positive-test / SPEC §0.16.1）
- 追加 `src/renderer/staticHakkeiTest.ts`: DOM/timer 非依存の純粋クラス
  `StaticHakkeiFalsePositiveTest`。start で detector.reset()（cooldown reset）、feed は
  `validForScore=true` の sample だけを評価、window(=config `staticFalseHakkeiWindowMs`=10000ms)経過で確定、
  PASS=count<=`staticFalseHakkeiMaxCount`(=0)。出力 `staticFalseHakkeiCount10s` は Renderer ローカル表示で
  motion:diagnostics payload には入れない（SPEC §0.16.1 準拠）。
- 変更 `src/renderer/app.ts`: InputCheck 画面（=Diagnostics UI）に「10秒静止 発勁誤検出テスト」ボタンと結果表示を
  追加。onSample で実行中ハーネスに sample を供給。通常 play の detector とは別インスタンスを使い干渉回避。
  resetPlayState で staticTest をクリア。
- 追加 `test/static-hakkei-test.test.mjs`: 静止0/閾値超え計上/invalid無視/window外無視/再実行reset の5ケース。
- 設計判断: 現 HakkeiDetector は velocity.z 単軸（forwardVector 未使用）のため、ハーネスも同条件で評価し
  Calibration 有無に結果は依存しない。detector が forwardVector dot（SPEC §13.6）へ更新される M11 時点で
  SPEC §0.16.1 の「Calibration完了必須・採用済みforwardVector」を呼び出し側で満たすこと（コードに TODO 明記）。
- 確認: typecheck/lint/build 緑、`npm test` 84 pass（+5）。

### 使い方（実機 M10-07）
1. Electron を unity-bridge モードで起動（mocopi PC app 送信中）→ InputCheck 画面へ。
2. mocopi を装着したまま**完全に静止**し、「10秒静止 発勁誤検出テスト」を押す。
3. 10秒間まったく動かない。終了後 `staticFalseHakkeiCount10s` と PASS/FAIL が表示される。
4. **0 回（PASS）なら M10-07 合格**。FAIL なら config `score.hakkei.hakkeiMinForwardVelocity` 等を M10 で調整。

## M11-04c 正規化レンジ実測チューニング（M10で確定）
実機 mocopi の2プレイで raw[m] を実測し、SPEC「本気で7〜8割」へ合わせた。
- 本気プレイ: 上下 ~13.9m（max20 で 69%）/ 前後 ~6.9m（max8 で 86%）。
- 疲れ気味プレイ: 上下 8.3m（41%）/ 前後 5.9m（74%）。Result raw 行で実測。
- 判断: **verticalRawMax=20 は据え置き**（本気 69%＝目標どおり、上限に S 用の余地）。
  **forwardRawMax を 8→9 へ**（前後は可動域が小さく低maxだと飽和しやすい。本気 86%→77% で目標域へ）。
- デッドゾーン 0.003m は静止 jitter rms 2mm を下回らせる良い値（M10-06）。据え置き。
- 確認: typecheck/lint/build 緑、テスト 86 pass（score-calculator の 100% 入力を forwardRawMax=9 に追従）。
- 留意: 本気プレイ値は2サンプルのみ。max effort で S(100%) に届くかは追加プレイで要確認（微調整は config のみ）。

## 不具合修正: Unity が非フォーカスで停止（Electron 操作中に送信が止まる）
- 症状: Electron をクリックして Unity がバックグラウンドになると Play が一時停止し、`LateUpdate` 停止＝
  motion 送信停止＝アバター静止。Gate B2（Electron 操作中も Unity が送り続ける）を阻害。
- 原因: Unity の既定（runInBackground=false）。非フォーカス時に Play を間引く。
- 対応: `RightHandUdpSender.OnEnable` で `Application.runInBackground = true;` を強制（Player Settings の
  同名設定に依存せず、将来の UnityBridge.exe スタンドアロンでも有効）。即効策として Player Settings →
  Resolution and Presentation → Run In Background チェックも可。
- 根拠: Unity Bridge は「裏で動き続けるデータ源」（SPEC §6.1）。送信継続は責務の一部。

## UX改善: Calibration 画面の指示を平易化（実機で「指示が分からない」との指摘）
- 症状: Calibration 進行中の指示が「neutral 計測中」「forward 計測中」「N samples」など専門語前面で、
  プレイヤーが何をすればよいか分かりにくい。
- 対応（`src/renderer/app.ts` 表示文のみ。timing/閾値/判定ロジックは不変）:
  - 画面名 `Calibration` → `位置あわせ`＋「① じっと立つ → ② 右手を前に出す」の流れを明記。
  - neutral: 「そのまま動かず、まっすぐ立ってください」＋補助「腕は自然に下ろしたまま、じっと静止」＋「ステップ 1/2」。
  - forward: 「右手を まっすぐ前に のばしてください」＋補助「ゆっくり前へ（15cm 以上）。出したら止めてください」＋「ステップ 2/2」。
  - カウントダウンを「あと X 秒」、サンプル数は補助行（計測サンプル: N）へ降格。
  - 失敗理由コード（FORWARD_DISTANCE_TOO_SMALL 等）を平易な日本語＋対処に変換。
  - 完了/開始ボタン文言を平易化（「準備OK！ 次へ」「位置あわせを はじめる」）。
- 根拠: AGENTS §12 DoD「初心者が確認できる画面表示」、§15「画面を見れば次に何をすべきか分かるか」。
  確定作業契約（実装契約）は不変のため §1.1 対象外の表示改善として実施。確認: typecheck/lint/build 緑、テスト 84 pass。

## 不具合修正: Calibration が開始ボタン押下直後に計測開始して失敗
- 症状: 右手（=計測対象）でキャリブレーション開始ボタンを押すと、押した手が基準位置へ戻る前に
  neutral 計測が始まり、JITTER_WARN / 位置ズレで失敗する。300ms の discard は filter リセット用で
  プレイヤーが構え直す時間ではない。
- 対応: 計測前に「構える猶予」カウントダウンを追加。
  - config `app.config.json timers.calibrationPrepMs`(=3000ms) を新設（configTypes / appConfig validateApp も更新）。
  - `app.ts`: Calibration 進入時に `calibPrepDeadlineMs` を立て、`startCalibrationPrep()` で
    「構えてください（あと N 秒で計測開始）」を表示。締切到達で初めて `startCalibration()`（discard→neutral→forward）。
    inputUnityOk / calib-retry / resetPlayState で猶予をリセット。
  - 計測契約（SPEC §12: discard 300ms / neutral 2000ms / forward 1000ms / 各しきい値）は不変。猶予は表示層のみ。
- 根拠: AGENTS §8（設定値は config 化）、§12 DoD / §15（初心者が確認できる画面）。確認: typecheck/lint/build 緑、84 pass。

## UX改善: プレイ各フェーズの指示を体の動作・入力モード別に
- 症状: VerticalCharge/ForwardCharge/HakkeiReady の指示が「Space で」「A・D で」「Enter で」と
  キーボード前提で、mocopi プレイヤーに何をすればよいか伝わらない。
- 対応（`app.ts` 表示文のみ。判定/タイミング/状態は不変）: 入力モードで出し分け。
  - VerticalCharge: 見出し「① 上下に振る」、mocopi 時「腕を 上下 に大きく振る」、keyboard 時「Space で…」。
  - ForwardCharge: 見出し「② 前後に振る」、mocopi 時「腕を 前後 に大きく振る」、keyboard 時「A・D で…」。
  - HakkeiReady: 見出し「③ 構えて … 撃つ！」、mocopi 時「右手を 前へ 鋭く突いて！」、keyboard 時「Enter で…」。
- 根拠: AGENTS §12 DoD / §15。確認: typecheck/lint/build 緑、84 pass。
- 補足: 「構えて」は HakkeiReady 突入＝待機の言い換え。明示的な「構えて…3,2,1…撃て!」の timed cue は
  新サブ状態が要る（AGENTS §7: stateMachine/テスト/SPEC 同時更新）ため未実施。要望あれば別ステップで。

## ★ Gate C 達成（2026-06-23・実機 mocopi）
mocopi PC app + 6センサーの実入力で、通しプレイが Result まで成立。
- 入力モード: unity-bridge（実 mocopi）。Calibration（位置あわせ）**通過**。
  ※ Run In Background 対策が効き、Electron フォーカス中も Unity が送信継続 → RIGHT_HAND_UNAVAILABLE 解消。
- フロー成立: 位置あわせ → ① 上下 → ② 前後 → ③ 構えて撃つ → **発勁検出** → 映像 → Result。
- Result 実測例: 損害額 ¥18,001,875 / ランク B / Power 180,019 / Lv3 / 発勁検出 /
  スコア内訳 上下 91.1・前後 40.6・発勁 48.6。
- Gate C 条件（実Unity入力で Calibration・上下/前後チャージ・動画選択が成立）を満たす。
- 留意: スコアは **M3 暫定（ピーク速度）**。本計算（変位積分）は M11。数値の意味づけは仮。
- 留意: 動画素材（assets/videos の mp4）**未作成**。VideoPlayback は実ファイル無し（skip 通過）。
  実 mp4 は `docs/asset_guidelines.md` の条件で別途用意（M12 / 素材タスク）。

## 残課題 / 観測メモ
- B2 観測時の jitter（raw rms≈106mm / filtered≈99mm / drift 187/165mm）は閾値超過だが、測定中に
  体が動いていた可能性が高い。M10-06 は **静止2秒**で測り直して判定する。
- Electron heartbeat 実測 1.3Hz 表示（Unity 自己申告 2Hz）。1Hz 下限は満たすが測定窓差を M10 で要観察。
