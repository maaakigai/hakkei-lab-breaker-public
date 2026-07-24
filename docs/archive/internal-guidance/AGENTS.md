# AGENTS.md（内部開発資料）

> 公開ポートフォリオの閲覧入口ではありません。開発時のAIコーディングエージェント向け作業規律を履歴として保管しています。

発勁ラボブレイカー開発用のAIエージェント指示書です。対象は、Electron / TypeScript / Unity / C# を編集するAIコーディングエージェント、レビュー担当者、共同開発者です。

## 1. 最優先の判断基準

このリポジトリで作業するときは、次の順で判断してください。

1. `docs/requirements.md` または元要件定義書の固定前提。
2. `SPEC.md` の実装仕様。
3. `AGENTS.md` の作業規律。
4. `MILESTONES.md` の現在ステップ。
5. 既存コードの挙動。
6. 推測。

推測で仕様を補完してはいけません。実装に必要な未確定点がある場合は、`TODO:` として明示し、最小の仮実装に留めてください。


## 1.1 2026-06-06 確定作業契約

`docs/archive/reviews/UNRESOLVED_ISSUES_CURRENT.md` の対象内指摘を反映し、以後の実装では次を固定します。古い記述と衝突する場合は `SPEC.md` の「2026-06-06 確定実装契約」を優先してください。

| 項目 | 固定 |
|---|---|
| Main / Renderer | filter、速度、加速度、`MotionSample`、`validForScore`、`validForCalibration` はElectron Mainが生成する。Rendererで再計算しない |
| Keyboard | Rendererはkeydown/keyupを送るだけ。Mainの `keyboardSampleGenerator` が `source="keyboard"` のsampleを60Hzで生成する |
| Mock | `mock-unity-bridge` は独立source/mode。Unity実入力Gateの代用にしない |
| Score / Hakkei | `validForScore=true` のsampleだけを使う。`isAvailable=true` だけで判定しない |
| Hakkei timeout | no-impact。`hakkeiDetected=false`、`hakkeiTimedOut=true`、`hakkeiScore=0` |
| Config | `schemaVersion`、`maxDatagramBytes`、`coordinates`、`keyboard`、`rankThresholds` を必須契約として扱う |
| Gate | Gate B2/D1は実 `unity-bridge` 必須。Mockだけでは通過扱いにしない |

運用、安全誘導、配布手順の改善はこの作業契約の対象外です。ただし、`R` / `Esc` のreset scope、mode変更、Error復帰のように状態遷移や実装契約に関わる項目は対象内です。

## 2. プロジェクトの固定前提

本プロジェクトは、身体入力つきインタラクティブ映像アプリです。

- プロジェクト名: 発勁ラボブレイカー
- 本体アプリ: Electron / TypeScript / HTML / CSS
- mocopi入力: Unity Bridge + mocopi Receiver Plugin for Unity
- mocopiモーション送信元: mocopi PC app または XYN Motion Studio
- 標準接続: Sensor data receiver for mocopi を使うPC接続
- 主な出力: 研究室破壊動画、損害額、ランク、スコア内訳

役割分担は固定です。

| 領域 | 担当 | 原則 |
|---|---|---|
| mocopiモーション受信 | Unity Bridge | Receiver Pluginを使う |
| アバター反映 | Unity Bridge | Humanoid Avatarへ反映する |
| 右手座標取得 | Unity Bridge | `RightHand Transform.position` を読む |
| UDP JSON受信 | Electron Main | `127.0.0.1:45100` を標準にする |
| MotionSample生成 | Electron Main | Unity/Mock/Keyboardを同じ入力型へ寄せる |
| 状態管理 | Electron Renderer | TypeScriptで管理する |
| スコア計算 | Electron Renderer | テスト可能な純粋関数を優先する |
| 動画再生 | Electron Renderer | HTML videoでローカルmp4を再生する |
| 予備入力 | Electron Renderer | キーボード入力を必須で残す |

## 3. 実装してはいけないこと

次の構成は標準構成に含めません。作業中に追加しないでください。

- スマホ版mocopiアプリを標準入力経路にすること。
- Tailscaleを標準構成に入れること。
- Electronでmocopi生UDPを直接解析すること。
- 自作Motion Serializerデコーダーを作ること。
- BVH Senderを本番リアルタイム入力の標準経路にすること。
- Unity単体でゲーム全体を作ること。
- Unity Bridge側にスコア計算、動画再生、リザルト表示、ゲーム状態管理を入れること。
- キーボード入力を削除すること。
- 設定値をコードに散らして固定すること。
- `Bone ID 18` の `position_x/y/z` を右手ワールド座標として直接採用すること。

## 4. 推奨リポジトリ構成

```text
src/
  main/
    index.ts
    unityBridgeUdpReceiver.ts
    appConfig.ts
    processHealth.ts
    motionSampleBuilder.ts
    motionFilter.ts
    keyboardSampleGenerator.ts

  preload/
    index.ts

  renderer/
    index.html
    styles.css
    app.ts
    stateMachine.ts
    inputManager.ts
    keyboardInput.ts
    unityMotionInput.ts
    calibrationManager.ts
    scoreCalculator.ts
    hakkeiDetector.ts
    videoManager.ts
    resultPresenter.ts
    diagnosticPanel.ts
    audioManager.ts

unity-bridge/
  Assets/
    Scripts/
      RightHandUdpSender.cs
      BridgeStatusView.cs
    Scenes/
      UnityBridge.unity

assets/
  videos/
    lv0_no_damage.mp4
    lv1_small_damage.mp4
    lv2_light_destruction.mp4
    lv3_medium_destruction.mp4
    lv4_heavy_destruction.mp4
    lv5_total_destruction.mp4
  sounds/
    charge.mp3
    hakkei.mp3
    impact.mp3
    result.mp3

config/
  app.config.json
  score.config.json
  input.config.json

docs/
  requirements.md
  operation.md
  asset_guidelines.md
  verification_checklist.md
```

既存構成がこの形と異なる場合は、無断で大規模移動をしないでください。新規追加時は上記に寄せます。

## 5. モジュール境界

### 5.1 Electron Main Process

責務:

- Electronアプリの起動。
- `127.0.0.1:45100` のUDP listen。
- Unity Bridge JSONのparse。
- スキーマ検証。
- heartbeat状態管理。
- RendererへのIPC送信。
- 設定ファイル読込。
- プロセスヘルス監視。

禁止:

- ゲームスコア計算。
- UI状態管理。
- 発勁判定。
- mocopi生データ形式の解析。

### 5.2 Preload

責務:

- MainとRendererの安全な橋渡し。
- `contextBridge` による限定API公開。
- RendererにNode.js機能を直接渡さない。

禁止:

- 任意のファイルアクセスAPIをRendererへ広く公開すること。
- `ipcRenderer` をそのまま公開すること。

### 5.3 Electron Renderer

責務:

- 画面描画。
- 状態遷移。
- 入力モード選択。
- キーボードkeydown/keyupをpreload API経由でMainへ送る。
- Main生成済みの `MotionSample` を消費する。
- Calibrationのphase制御とCalibration結果の保持。
- 上下チャージ、前後チャージ、発勁判定。
- スコア正規化。
- 動画選択。
- リザルト表示。
- エラー表示。

禁止:

- 平滑化、速度、加速度、filter状態、`validForScore`、`validForCalibration` をRendererで再計算すること。
- Keyboard疑似座標をRendererから直接scoreへ入れること。
- Debug Result Fixtureを通常入力モードとして実装すること。

### 5.4 Unity Bridge

責務:

- mocopi Receiver Pluginでモーションを受信。
- Humanoid Avatarへ反映。
- `Animator.GetBoneTransform(HumanBodyBones.RightHand)` で右手Transformを取得。
- `LateUpdate` で `Transform.position` を読む。
- UDP JSONを `127.0.0.1:45100` へ送信。
- 診断ログを表示。

禁止:

- ゲーム本体化。
- スコア計算。
- ElectronのUI状態を直接操作すること。


## 6. データ契約を壊さない

Unity Bridge / Mock Unity BridgeからElectronへ送るpacketは、v1共通fieldを必ず含めます。

```ts
export type BridgePacketSource = "unity-bridge" | "mock-unity-bridge";

export type BridgePacketBaseV1 = {
  protocolVersion: 1;
  type: "motion" | "heartbeat";
  sessionId: string;
  timestampMs: number;
  source: BridgePacketSource;
};
```

motion JSONの標準形は次です。`isTracked=false`、`avatar.isHuman=false`、`avatar.hasRightHand=false` の場合、`rightHand` は省略または `null` でもよいですが、Mainは `isAvailable=false`、score/calibration除外sampleとして扱います。

```json
{
  "protocolVersion": 1,
  "type": "motion",
  "sessionId": "unity-20260606-001",
  "seq": 1234,
  "timestampMs": 123456,
  "source": "unity-bridge",
  "isTracked": true,
  "rightHand": { "x": 0.12, "y": 1.24, "z": -0.33 },
  "avatar": { "isHuman": true, "hasRightHand": true, "forward": { "x": 0, "y": 0, "z": 1 } }
}
```

heartbeat JSONの標準形は次です。

```json
{
  "protocolVersion": 1,
  "type": "heartbeat",
  "sessionId": "unity-20260606-001",
  "timestampMs": 123456,
  "source": "unity-bridge",
  "receiverReady": true,
  "receiverStatus": "receiving",
  "avatarReady": true,
  "rightHandReady": true,
  "frameRate": 50.0,
  "sendRateHz": 30.0
}
```

Electron内部の共通入力は必ずMain生成の `MotionSample` に寄せます。

```ts
export type MotionSource = "unity-bridge" | "mock-unity-bridge" | "keyboard";

type MotionQualityFlag =
  | "DT_RESET"
  | "DT_TOO_SMALL"
  | "DT_TOO_LARGE"
  | "SEQ_GAP"
  | "TIMESTAMP_GAP"
  | "NOT_TRACKED"
  | "AVATAR_NOT_READY"
  | "RIGHT_HAND_UNAVAILABLE"
  | "COORDINATE_RANGE_WARN"
  | "OUTLIER_POSITION_JUMP"
  | "OUTLIER_VELOCITY"
  | "OUTLIER_ACCELERATION"
  | "RECOVERED_FROM_UNAVAILABLE"
  | "LOW_SAMPLE_RATE";

export type MotionSample = {
  protocolVersion: 1;
  source: MotionSource;
  sessionId: string;
  seq: number;
  timestampMs: number;
  receivedAtMs: number;
  rawHandPosition: { x: number; y: number; z: number };
  handPosition: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  acceleration: { x: number; y: number; z: number };
  isAvailable: boolean;
  validForScore: boolean;
  validForCalibration: boolean;
  quality: {
    dtMs: number;
    sampleRateHz: number;
    isFiltered: boolean;
    droppedFrameCount: number;
    invalidPacketCount: number;
    flags: MotionQualityFlag[];
  };
};
```

`quality.flags` を自由文字列にしないでください。Unionへ追加する場合は `SPEC.md`、`AGENTS.md`、`MILESTONES.md`、`HUMAN_TEST_GUIDE_JA.md`、`docs/verification_checklist.md` を同時更新します。

## 7. 状態遷移を守る

状態は次を基本とします。

```text
Title
InputCheck
Calibration
Ready
VerticalCharge
ForwardCharge
HakkeiReady
ImpactDelay
VideoPlayback
Result
Error
```

新しい状態を追加するときは、`stateMachine.ts`、UI表示、テスト、手動確認手順を同時に更新してください。

## 8. TypeScript実装規約

- `strict` を有効にしてください。
- `any` は原則禁止です。外部入力は `unknown` で受け、検証してから型を付けます。
- スコア計算、正規化、フィルタ、状態遷移は可能な限り純粋関数にしてください。
- DOM操作と計算ロジックを混ぜないでください。
- 設定値は `config/*.json` から読み込む構造にしてください。
- 単位を変数名に入れてください。例: `timestampMs`, `dtMs`, `sampleRateHz`。
- NaN、Infinity、異常dtを明示的に処理してください。
- 非同期処理はエラーを握りつぶさず、画面上のErrorまたはdiagnosticへ伝播させてください。

## 9. C# / Unity実装規約

- 右手座標取得は `LateUpdate` を標準にします。
- `Animator` と `RightHand Transform` のnullを初期化時と送信前に確認してください。
- 送信先IP、ポート、送信HzはInspectorまたは設定値から変更できるようにしてください。
- UDP送信失敗はログに出してください。
- 画面またはログに `Receiver`, `Avatar`, `RightHand`, `Send Hz`, `Target`, `RightHand Position` を出してください。
- Unity Bridge内に発表用UIやゲーム演出を増やさないでください。

## 10. テスト方針

必須テスト:

| 対象 | テスト内容 |
|---|---|
| JSON validator | motion / heartbeat / 不正JSON / 欠損フィールド |
| UDP receiver | 受信、parse失敗、unknown type破棄、heartbeat更新 |
| MotionSample builder | dt、速度、加速度、欠落フラグ |
| motionFilter | EMA、外れ値、dt範囲外 |
| calibrationManager | neutral、forward、up、品質 |
| scoreCalculator | 正規化、Power、damageYen、動画レベル |
| hakkeiDetector | 前方向速度、加速度、移動量、クールダウン |
| stateMachine | 全状態の正常遷移とError復帰 |
| keyboardInput | Space / A / D / Enter / R / Esc |
| videoManager | Lv0〜Lv5のファイル選択、欠落時Error |

推奨コマンド:

```bash
npm run lint
npm run typecheck
npm test
npm run dev
npm run build
```

未作成のスクリプトがある場合は、最初の該当マイルストーンで追加してください。

validator / IPC確認用に、次のmock script名を予約します。未実装の場合、該当マイルストーンで同名を追加してください。

```text
mock:unity
mock:unity:seq-gap
mock:unity:seq-missing
mock:unity:seq-duplicate
mock:unity:timestamp-rollback
mock:unity:timestamp-gap
mock:unity:heartbeat-stall
mock:unity:huge-json
mock:unity:invalid-json
mock:unity:right-hand-unavailable
mock:unity:non-active-source
```

Gate B2/D1の判定では `mock:*` を実Unity Bridgeの代替にしません。


## 11. 手動確認を必ず残す

AIエージェントが実装した機能は、人間が確認できるようにしてください。

- 何を押すか。
- 何が表示されれば成功か。
- 失敗時に何を見るか。
- スクリーンショットやログのどこを確認するか。

手動確認手順は `HUMAN_TEST_GUIDE_JA.md` または `docs/verification_checklist.md` に追記してください。

## 11.1 各ステップ終了時の実装理由・根拠を残す

各マイルストーンまたはIssueの終了時には、実装内容だけでなく「なぜその実装にしたか」を記録してください。記録先は、PR本文、Issueコメント、または `docs/runs/YYYYMMDD-<step-id>.md` のいずれかです。

最低限、次を残します。

| 項目 | 書く内容 |
|---|---|
| 対象ステップ | 例: `M5-09 motion:heartbeat IPC` |
| 変更ファイル | 実装・テスト・設定・Markdown |
| 採用した判断 | timeout、しきい値、責務分離、payload型、fallback条件など |
| 理由・根拠 | `SPEC.md` の該当章、実測値、失敗再現、初心者確認のしやすさ |
| 確認結果 | 自動テスト、手動確認、ログ、未確認なら `BLOCKED_*` |
| 残課題 | 次ステップへ送るTODO。推測で完了扱いしない |

書き方の例:

```text
M5-09 motion:heartbeat IPC
- 採用: heartbeat timeoutは1500ms。
- 理由: Unity Bridgeのheartbeat最低条件は1Hzであり、1000msぴったりだとタイマー揺れでInputCheck表示が点滅しやすいため。
- 根拠: SPEC.md 7.1 / 9.2 / 17.1。
- 確認: mock:unity:heartbeat-stallで1500ms後にUNITY_BRIDGE_TIMEOUT、復帰時にapp:error-clearを確認。
```

```text
M7-08 jitter diagnostics
- 採用: Gate D1はrawとfilteredの両方を見る。
- 理由: rawだけではゲーム入力の揺れが分からず、filteredだけではセンサー固定不良を見落とすため。
- 根拠: SPEC.md 13.5 / 19.5。
```

「仕様どおり」「なんとなく」「一般的に妥当」だけでは完了理由として不足です。判断理由が書けない変更は、仕様不足として扱い、先に `SPEC.md` または該当Issueを更新してください。


## 12. Definition of Done

1タスクは、次の条件を満たすまで完了にしません。

- 実装範囲が1つの目的に閉じている。
- TypeScriptまたはC#の型エラーがない。
- 該当する自動テストがある、または手動確認手順がある。
- 既存のキーボード入力経路が壊れていない。
- 既存のUnity Bridge入力経路が壊れていない、または未実装時は明示されている。
- 設定値をハードコードしていない。
- 初心者が確認できる画面表示またはログがある。
- 不明点を隠していない。
- そのステップで採用した実装理由・根拠が記録されている。

## 13. 小さく作る原則

アジャイル的に進めるため、1回の変更は小さくしてください。

良い例:

- `Title` 画面だけを出す。
- `Space` キーだけで上下チャージ値を増やす。
- mock UDPのmotion JSONだけを受信する。
- heartbeat表示だけをInputCheckに追加する。
- Lv0動画だけ再生する。

悪い例:

- 状態管理、動画、mocopi、UI演出を同時に実装する。
- Unity BridgeとElectronの大規模統合を一度に行う。
- 発勁判定とスコア調整を同じ変更で行う。
- 動く前に演出やデザインを作り込む。

## 14. 失敗時の標準対応

| 症状 | 最初に見る場所 | 原則対応 |
|---|---|---|
| アプリが起動しない | Main Processログ | 起動失敗をError画面へ出す |
| Unity Bridge未受信 | InputCheck / UDP receiverログ | ポート、IP、firewall、Bridge起動を確認 |
| RightHandが取れない | Unity Bridge診断 | Animator、Humanoid Rig、Bone Mapping確認 |
| 静止中に発勁する | hakkeiDetectorテスト / diagnostic | 加速度単独判定を避け、移動量条件を上げる |
| 動画が出ない | videoManagerログ | ファイル名、パス、ビルド時asset配置を確認 |
| 本番中に入力不安定 | InputCheck | キーボード入力へ切替 |

## 15. レビュー観点

レビュー時は、実装者ではなく初見の操作担当者の視点で見直してください。

- 画面を見れば次に何をすべきか分かるか。
- 失敗時に何が悪いか分かるか。
- キーボード入力だけで発表を継続できるか。
- Unity Bridgeが不安定でもElectron本体が落ちないか。
- しきい値を設定ファイルから変えられるか。
- 10回連続プレイでクラッシュしないか。
