# MILESTONES.md

> 後日注記: 以下の「2026-07-23」はこの記録の更新日で、展示日は2026年7月12日です。現在は、展示日全体のログに基づく概算として約30名・約40セッション、稼働1時間、運用観察上の重大障害0件と整理しています。準備・テストを含む集計条件は[`../../EXHIBITION_EVIDENCE.md`](../../EXHIBITION_EVIDENCE.md)を参照してください。以下の本文は当時の記録として保持しています。
>
> ✅ **現行 status（2026-07-23）**: 本線は **mocopi 1台 BLE直読・単手パンチ・magnitude-only**。
> 実装は `PunchInputSample`、BLE sidecar、単一 `Charge`、`HakkeiReady` のintensity peak判定、実験ウィザードまで進行済み。
> 旧 Unity Gate B/C/D・Calibration・上下/前後チャージ・方向分岐の前提は履歴として保持し、現行確認は [docs/CURRENT_USAGE_JA.md](docs/CURRENT_USAGE_JA.md) と [docs/verification_checklist_v2_ble.md](docs/verification_checklist_v2_ble.md) を優先する。
> v2 BLEの整理元は [docs/drafts/MILESTONES-v2-ble.md](docs/drafts/MILESTONES-v2-ble.md) と [docs/drafts/GATES-v2-ble.md](docs/drafts/GATES-v2-ble.md)。
>
> **2026-07-23 展示結果**: 約30名規模の会場で1時間の継続展示を完遂。ユーザー情報・スコア管理サーバーと展示機の双方で、展示中に観測された障害は0件。耐久課題は完了済み。

発勁ラボブレイカーの細分化マイルストーンです。アジャイル的に小さく進めるため、各ステップは「1つの成果物」「1つの確認方法」を持つ単位に分割しています。

この文書は `docs/requirements.md`、`SPEC.md`、`AGENTS.md` と合わせて使います。

---

## 0. 進捗状況（2026-07-23 時点）

実装リポジトリの現況。実装の背景・設計判断の根拠は [作業日誌](docs/development/作業日誌.md) と `docs/runs/` を参照。

### 0.1 現行BLE版

| 項目 | 状態 | 備考 |
|---|---|---|
| BLE probe | ✅ GO | mocopi 1個で36byte/50Hz、角速度信号を採用 |
| BLE sidecar / Main integration | ✅ 実装済み | `mocopi-ble` mode、sidecar/replay、Main生成 `PunchInputSample` |
| Renderer game loop | ✅ 実装済み | `Ready → Charge → HakkeiReady → VideoPlayback → Result` |
| Keyboard debug core | ✅ 実装済み | Space charge / Enter punch / R / Esc |
| 実験ウィザード | ✅ 実装済み | 静止床、パンチ、チャージ、タメ付きパンチの計測 |
| 自動チェック | ✅ 緑 | 2026-07-23: typecheck / lint / 281 tests / build |
| BLE実機Gate E/F | ✅ 完了 | 約30名規模・1時間の実展示を完遂。サーバーと展示機で観測障害0件 |
| 文書更新 | ✅ 完了 | 現行手順、チェックリスト、展示実績を反映。旧手順はlegacy扱い |

### 0.2 旧 Unity / Calibration 履歴

| マイルストーン | 状態 | 備考 |
|---|---|---|
| M0 リポジトリ基盤 | ✅ 完了 | Electron/TS、esbuildビルド、最小起動 |
| M1 画面と状態の骨格 | ✅ 完了 | 11状態・全画面・遷移テスト |
| M2 Keyboard縦通しMVP | ✅ 完了 | Main生成 `MotionSample`、Title→Result完走 |
| M3 スコア・動画の最小実装 | ✅ 完了※ | ※**チャージrawは暫定(ピーク速度)**。本計算はM11で変位積分に置換 |
| M4 設定ファイル化 | ✅ 完了 | `config/*.json` + schema検証 |
| M5 UDP受信・JSON契約 | ✅ 完了 | receiver/validator/mock、実UDPラウンドトリップ実証 |
| M6 InputCheck・診断表示 | ✅ 完了 | `motion:status`/`heartbeat` 購読表示 |
| M7 MotionSample処理・フィルタ | ✅ 完了 | EMA/外れ値/dt異常/2秒jitter/diagnostics |
| M8 Calibration・軸処理 | ✅ 完了 | discard→neutral→forward、pseudo(Keyboard) |
| M9 Unity Bridge最小実装 | ✅ 完了 | C#実装+契約検証+**実機Gate B1/B2 PASS**（mocopi PC app→12351→Unity→45100→Electron）→ [日誌](docs/runs/20260623-m9-unity-bridge.md) |
| M10 mocopi実機入力検証 | ✅ 完了 | 実機検証 M10-01〜10 全PASS＋レンジ調整。**Gate C 達成** → [日誌](docs/runs/20260623-m10-realdevice.md) |
| M11 チャージ・発勁本実装 | ✅ 完了 | 変位積分チャージ＋複合発勁(M11-06〜09)＋windowed HakkeiScore＋協調mock(M11-13)。**実機発勁PASS(M11-12)**・静止誤検出0。正規化レンジ/デッドゾーンはM10実測で確定 → [日誌](docs/runs/20260624-m11-06-09-hakkei-composite-implementation.md) |
| 両手入力v2（撤回） | ⚠ 撤回 | packet v2/leftHand/両手neutral/DualHakkeiDetector/D案(magnitude+netDelta+前方gate) を実装(test緑)。しかし「両腕同時の突き出しは爽快感が無い」とのユーザ指摘で**通常プレイは撤回**。資産は隠しイベント用に温存 → [HANDOFF](docs/runs/20260624-HANDOFF-dualhand-v2.md) / [D案日誌](docs/runs/20260625-v2-hakkei-D-magnitude.md) |
| M15 単手回帰＋方向/idle隠しイベント（Phase A） | 🚧 仕様確定・実装前 | **§0.23 が現行確定設計**。利き手1本でチャージ→前方発勁＝通常破壊。下/上/後ろ突き・idle(15s)を隠しイベント化。codexレビュー反映済(commit 086c5a1) → [日誌](docs/runs/20260625-spec-0.23-codex-review-fixes.md) |
| M16 特殊モーション・骨格v3（Phase B） | ⏭ optional/次版 | 領域展開・かめはめ波。骨格(skeleton/bodyForward) packet v3。**M12/M13/M14 の後・本番前提にしない**（codex 推奨） |
| M12 UI・演出調整 | ⏭ 未着手 | M15 後の見た目/演出/外部ディスプレイ。**旧上下/前後ゲージは単手charge gaugeへ置換**。利き手決定/隠し結果/back安全の最小UIは M15 側 |
| M13 ビルド・本番PC確認 | ⏭ 未着手 | |
| M14 発表リハーサル・凍結 | ⏭ 未着手 | |

- 自動テスト **127件パス**、`npm run typecheck / lint / build` すべて緑。
- Gate A(Keyboard完走・損害額/ランク/動画)は実機ウィンドウで縦通し確認済み（スコアの**本計算はM11で確定**）。
- **Gate C 達成(2026-06-23・実 mocopi)**: 実Unity入力で Calibration→上下/前後→発勁検出→Result まで通し成立。
  スコアはM3暫定・動画mp4は未作成 → [日誌](docs/runs/20260623-m10-realdevice.md)。
- **M11 完了(2026-06-24)**: 変位積分チャージ・複合発勁(SPEC §13.6)・windowed HakkeiScore(§14.3) を本実装。
  実機 mocopi で **M11-12 PASS**（鋭い突き発火／緩い突き非発火／10秒静止 誤検出0・500sample）。
  協調mock `mock:unity:calib` で実機なし回帰も成立（実UDP→Main経路でも発勁検出をE2E確認）
  → [M11-12日誌](docs/runs/20260624-m11-12-realdevice-hakkei.md) / [mock日誌](docs/runs/20260624-m11-13-cooperative-mock-implementation.md)。
- **方針転換(2026-06-25)**: 両手同期パンチ → **単手（利き手）回帰＋方向/特殊/idle 隠しイベント**（SPEC §0.23）。
  両手v2 の packet/型/Calibration/検出 資産は撤去せず隠しイベント用に温存。詳細は §0.23 と M15/M16。
- **推奨実施順（codexレビュー 2026-06-25）**: **M15(Phase A) → M12(UI/演出) → M13(build) → M14(リハ) → M16(Phase B=optional/次版)**。
  M15 内は「純粋ロジック/型を先・stateMachine rename は後」（既存127件テストへの波及を最後にまとめる）。
- 主要コマンド: `scripts/windows/run-dev.bat`(起動) / `npm run dev` / `npm run mock:unity`(疑似Unity) / `npm test`。

---

## 1. 進め方

- 1ステップは、できるだけ30分〜半日で終わる粒度にする。
- 必ずキーボード入力の縦通しを先に成立させる。
- 安全注意と中断操作は、見た目調整より先に入れる。
- Unity Bridge統合は早期に検証するが、ゲーム本体の完成をUnity待ちにしない。
- 各ステップは「実装完了」ではなく「人間が確認できる状態」で完了にする。
- Week 4は新機能を原則追加せず、調整・安定化・手順化に使う。

---


## 1.1 2026-06-06 確定契約に伴う進め方

`docs/archive/reviews/UNRESOLVED_ISSUES_CURRENT.md` の対象内指摘は、実装・型・IPC・validator・状態遷移・score・Gate判定に現実的な影響があるため、本マイルストーンへ反映します。既存タスクと衝突する場合は次を優先します。

- `MotionSample`、filter、速度、加速度、validityはElectron Mainで生成する。
- Rendererは `MotionSample.validForScore=true` のsampleだけでscore/hakkeiを進める。
- Mock Unity Bridgeは独立mode/sourceであり、Gate B2/D1の実Unity Bridge確認を代替しない。
- HakkeiReady timeoutはno-impactで、弱発勁扱いにしない。
- config schemaとconfig例は同時に更新する。`schemaVersion`、`maxDatagramBytes`、`coordinates`、`keyboard`、`rankThresholds` を欠かさない。
- Gate D1は2秒windowの `rawJitterRms2s` / `filteredJitterRms2s` 系に統一する。

運用、安全誘導、配布手順はこの追加契約の対象外です。

## 2. 現状認識

このドキュメントセットとして、Markdownの基盤は次の状態を目標とする。

| 項目 | 状態 | 備考 |
|---|---|---|
| `docs/requirements.md` | 必須 | 元要件定義書をそのまま参照可能にする |
| `README.md` | 必須 | 初見者向け入口 |
| `AGENTS.md` | 必須 | AI/共同開発者向けルール |
| `SPEC.md` | 必須 | 実装仕様 |
| `MILESTONES.md` | 必須 | 本ファイル |
| `HUMAN_TEST_GUIDE_JA.md` | 必須 | 日本語の正式な人間向け手順 |
| `HUMAN_TEST_GUIDE.md` | 互換用 | `HUMAN_TEST_GUIDE_JA.md` への案内に限定し、重複本文を置かない |
| `package.json` | 実装リポジトリ側で未完ならM0未完了 | このMarkdown更新だけでは作成しない |
| `tsconfig.json` | 実装リポジトリ側で未完ならM0未完了 | このMarkdown更新だけでは作成しない |
| `config/*.json` | 実装リポジトリ側で未完ならM0未完了 | M4で作る |

`README.md`、`package.json`、`tsconfig.json`、`config/*.json`、`docs/requirements.md` が実リポジトリに存在しない場合、そのリポジトリはM0未完了である。

---

## 3. 完了状態の定義

各マイルストーンは、次を満たしたら完了とする。

- 成果物がリポジトリに存在する。
- 起動またはテストの確認方法が書かれている。
- キーボード入力経路が壊れていない。
- 安全注意と中断操作が壊れていない。
- エラー時にアプリがクラッシュしない。
- 設定値が必要以上にハードコードされていない。
- 不明点があれば `TODO:` として残っている。
- 人間が確認できる手順が `HUMAN_TEST_GUIDE_JA.md` または `docs/verification_checklist.md` にある。

---

## 4. Week割り当て

| 週 | 目標 | 対象マイルストーン | ゲート |
|---|---|---|---|
| Week 1 | 文書・Electron骨格・Keyboard MVP・Unity Bridge入口検証 | M0〜M5の途中、M9の最小検証 | Gate A、Gate B入口 |
| Week 2 | 入力統合、設定ファイル、動画Lv、InputCheck、初回ビルド | M5〜M8、M13の初回 | Gate B、Gate C入口 |
| Week 3 | Calibration、前後チャージ、発勁判定、実機調整、UI整備 | M8〜M12 | Gate C、Gate D入口 |
| Week 4 | 凍結、調整、連続確認、リハーサル、手順固定 | M13〜M14 | Gate D |

Week 4に新機能を入れないため、M0〜M12の未完了が多い場合はスコープを削減する。

---

## 5. マイルストーン一覧

### M0: リポジトリ基盤

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M0-01 | XS | `README.md` にプロジェクト概要を書く | 概要、起動予定、入力方式が分かるREADME | 初見者がElectron本体とUnity Bridgeの役割を説明できる |
| M0-02 | XS | `docs/requirements.md` を配置する | 元要件定義書の保存 | 採用する構成、採用しない構成、送信元の意味が読める |
| M0-03 | XS | `AGENTS.md` を配置する | AI作業ルール | 禁止事項にElectron生UDP解析禁止、`seq` 必須、安全要件がある |
| M0-04 | XS | `SPEC.md` を配置する | 実装仕様 | MotionSample、UDP JSON、IPC payload、StatusWarningCode、AppConfigBundle、jitter基準が読める |
| M0-05 | XS | `MILESTONES.md` を配置する | 本ファイル | Week 1〜4の束ね方が見える |
| M0-06 | XS | `HUMAN_TEST_GUIDE_JA.md` を配置する | 日本語の正式手順 | キーボード確認、安全確認、Unity確認が読める |
| M0-07 | XS | `HUMAN_TEST_GUIDE.md` を案内ファイルにする | 互換用の短い案内 | SHAがJA版と同一でなく、正式更新先が明記されている |
| M0-08 | XS | `docs/operation.md` を配置する | 運用入口 | 本番起動順と手順書へのリンクがある |
| M0-09 | XS | `docs/verification_checklist.md` を配置する | 確認チェックリスト | PASS/FAIL記録欄がある |
| M0-10 | XS | `docs/asset_guidelines.md` を配置する | 動画素材条件 | mp4名、人物/文字情報禁止が読める |
| M0-11 | S | package管理を初期化する | `package.json` | `npm install` が通る |
| M0-12 | S | TypeScript設定を追加する | `tsconfig.json` | `npm run typecheck` が存在する |
| M0-13 | S | lint/testの土台を追加する | lint/test scripts | `npm run lint` と `npm test` が存在する |
| M0-14 | S | Electron最小起動を作る | 空ウィンドウ | `npm run dev` でウィンドウが出る |

### M1: 画面と状態の最小骨格

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M1-01 | XS | `stateMachine.ts` に状態型を定義する | `Title`〜`Error` のUnion型 | typecheckが通る |
| M1-02 | XS | 初期状態を `Title` にする | 起動直後Title | 画面にタイトルが出る |
| M1-03 | XS | Titleに入力モード選択の仮UIを置く | Keyboard / Unity Bridge選択 | クリックできる |
| M1-04 | XS | Titleに安全注意を仮表示する | 周囲確認メッセージ | 「周囲を確認してから開始」が見える |
| M1-05 | XS | `InputCheck` 画面を空で作る | 入力確認画面 | StartでInputCheckへ遷移する |
| M1-06 | XS | `Calibration` 画面を空で作る | キャリブレーション画面 | InputCheckから進める |
| M1-07 | XS | `Ready` 画面を作る | カウントダウン表示 | Ready表示が見える |
| M1-08 | XS | `Ready` に安全注意を出す | 開始前注意 | プレイ前に注意が読める |
| M1-09 | XS | `VerticalCharge` 画面を作る | 上下チャージ画面 | フェーズ名と残り時間が見える |
| M1-10 | XS | `ForwardCharge` 画面を作る | 前後チャージ画面 | フェーズ名と残り時間が見える |
| M1-11 | XS | `HakkeiReady` 画面を作る | 発勁待機画面 | 発勁指示が見える |
| M1-12 | XS | `ImpactDelay` 画面を作る | 暗転または仮表示 | 発勁後に短く表示される |
| M1-13 | XS | `VideoPlayback` 画面を作る | 仮video領域 | 動画画面へ遷移できる |
| M1-14 | XS | `Result` 画面を作る | 仮リザルト | 損害額欄が見える |
| M1-15 | XS | `Error` 画面を作る | エラー表示 | 任意のテストエラーを表示できる |
| M1-16 | S | `Esc` でTitleへ戻る共通処理を作る | 緊急復帰 | 主要状態からTitleへ戻れる |
| M1-17 | S | 状態遷移テストを書く | stateMachine unit test | 正常遷移と戻る遷移がテストで通る |

### M2: キーボード縦通しMVP

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M2-01 | XS | 入力モード型を定義する | `keyboard` / `unity-bridge` / `mock-unity-bridge` | Titleで選べる下地がある |
| M2-02 | XS | キーボードモード選択UIを作る | Titleの選択ボタン | Keyboardを選べる |
| M2-03 | S | `keyboardInput.ts` を作る | Space/A/D/Enter/R/Esc検出 | diagnosticに押下状態が出る |
| M2-04 | S | Mainの `keyboardSampleGenerator` を作る | `source="keyboard"` のMotionSample | Spaceでy方向sampleが出る |
| M2-05 | S | A/Dで前後疑似入力を生成する | 疑似zまたはforward軸 | A/Dで値が変わる |
| M2-06 | S | Enterで前方突きsample列を生成する | pseudo hakkei MotionSample | 通常Hakkei判定で検出される |
| M2-07 | S | Rで現在プレイをリセットする | reset処理 | Ready以降でRを押すと戻れる |
| M2-08 | S | `MotionSample` 型を定義する | 共通入力型 | keyboard sampleが型に合う |
| M2-09 | S | キーボード入力をMotionSample化する | keyboard MotionSample | diagnosticにsampleが出る |
| M2-10 | S | VerticalChargeを10秒で進める | timer | 10秒後にForwardChargeへ進む |
| M2-11 | S | ForwardChargeを10秒で進める | timer | 10秒後にHakkeiReadyへ進む |
| M2-12 | S | HakkeiReady timeoutを作る | no-impact fallback | 5秒後に `hakkeiTimedOut=true` / `hakkeiScore=0` / Lv0整合で進む |
| M2-13 | S | Resultまで仮完走させる | 縦通しMVP | KeyboardでTitle→Result完走 |
| M2-14 | S | Keyboard 10回連続確認を実施する | 記録 | クラッシュなし |

### M3: スコアと動画の最小実装

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M3-01 | S | `scoreCalculator.ts` を作る | 上下/前後/発勁の仮スコア | unit testが通る |
| M3-02 | S | 正規化関数を作る | clamp normalize | min/max/NaNテストが通る |
| M3-03 | S | Power計算を作る | `power = v*f*h*coef` | ResultにPowerが出る |
| M3-04 | S | 損害額計算を作る | damageYen | Resultに円表記が出る |
| M3-05 | S | 動画レベルしきい値を実装する | Lv0〜Lv5 selector | 境界値テストが通る |
| M3-06 | S | Lv0仮動画を再生する | HTML video | 動画終了後Resultへ進む |
| M3-07 | S | 動画欠落時Errorを出す | VIDEO_MISSING | 不足ファイル名が見える |
| M3-08 | S | Debug Result Fixtureを作る | Diagnostics/Dev menuの動画/Result確認 | 通常プレイ入力modeに混ざらない |

### M4: 設定ファイル化

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M4-01 | S | `config/app.config.json` を作る | app設定 | 起動時に読める |
| M4-02 | S | `config/input.config.json` を作る | UDP/filter/jitter設定 | `requireSeq: true` がある |
| M4-03 | S | `config/score.config.json` を作る | score/video設定 | 動画しきい値をJSONから読める |
| M4-04 | S | config schema validateを作る | validator | 不正configでError表示 |
| M4-05 | S | 設定値を直書きから移す | no hard-coded thresholds | grepで主要値が設定化されている |

### M5: UDP受信・JSON契約

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M5-01 | S | `unityBridgeUdpReceiver.ts` を作る | UDP listen | `127.0.0.1:45100` で待てる |
| M5-02 | S | mock UDP送信機を作る | `npm run mock:unity` | motion JSONが送れる |
| M5-03 | S | motion JSON validatorを作る | `UnityMotionPacketV1` validator | 正常packetが通る |
| M5-04 | XS | `seq` 欠損motionをinvalidにする | validator test | `seq` なしは破棄される |
| M5-05 | S | heartbeat JSON validatorを作る | heartbeat validator | heartbeatを状態更新する |
| M5-06 | S | 不正JSONを落とさず破棄する | try/catch | アプリがクラッシュしない |
| M5-07 | S | unknown typeを破棄する | drop処理 | invalid countが増える |
| M5-08 | S | Main→Renderer `motion:sample` IPCを作る | typed IPC | Rendererにsampleが届く |
| M5-09 | S | Main→Renderer `motion:heartbeat` IPCを作る | typed IPC | Rendererにheartbeatが届く |
| M5-10 | S | Main→Renderer `motion:status` IPCを作る | typed IPC | 受信Hz/最終時刻/warnings/errorsが届く |
| M5-11 | S | Main→Renderer `app:error` IPCを作る | typed IPC | `AppErrorCode`、severity、messageJaが届く |
| M5-12 | S | Main→Renderer `app:error-clear` IPCを作る | typed IPC | mode変更や復帰時にError表示が消える |
| M5-13 | S | Main→Renderer `motion:session-changed` IPCを作る | typed IPC | sessionId変更時にRendererがresetできる |
| M5-14 | S | `StatusWarningCode` と `StatusWarning` を定義する | warning型 | `UNKNOWN_FIELDS` / `SEQ_GAP` がstatusに出る |
| M5-15 | S | `AppConfigBundle` と `config:get` responseを定義する | config型 | preload `getConfig()` が設定bundleを返す |
| M5-16 | S | preload限定APIを作る | contextBridge API | `onMotionHeartbeat` / `onMotionSessionChanged` / `onAppErrorClear` / `getConfig` があり、`ipcRenderer` は露出しない |

### M6: InputCheck・診断表示

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M6-01 | XS | InputCheckに入力モードを表示する | mode表示 | Keyboard/Unityが読める |
| M6-02 | S | motion受信OK/NGを表示する | status UI | mock起動でOKになる |
| M6-03 | S | 最終motion受信時刻を表示する | age表示 | msが更新される |
| M6-04 | S | 受信Hzを表示する | Hz表示 | 30Hz前後が見える |
| M6-05 | S | heartbeat状態を表示する | alive/timeout | heartbeat停止でtimeout |
| M6-06 | S | rightHandReadyを出す | true/false | heartbeatで変わる |
| M6-07 | S | 現在座標を出す | x/y/z | 手またはmockで変化 |
| M6-08 | S | invalidPacketCountを出す | count | 不正JSONで増える |
| M6-09 | S | Keyboard切替ボタンを出す | fallback button | Unity NGでも進める |
| M6-10 | S | 初心者向け失敗理由を出す | short hint | ポート/Bridge確認が読める |

### M7: MotionSample処理・フィルタ

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M7-01 | S | `motionSampleBuilder.ts` を作る | raw→MotionSample | 位置からsampleが作れる |
| M7-02 | S | dt計算を入れる | dtMs | 連続sampleでdtが出る |
| M7-03 | S | droppedFrameCountを計算する | 欠落推定 | gapで増える |
| M7-04 | S | 位置EMAを実装する | filtered position | unit testが通る |
| M7-05 | S | 速度計算を実装する | velocity | 既知入力で期待値 |
| M7-06 | S | 加速度計算を実装する | acceleration | 既知入力で期待値 |
| M7-07 | S | 外れ値除去を実装する | outlier flags | jumpでflag |
| M7-08 | S | `rawJitterRms2s` / `rawMaxJitter2s` / `rawDrift2s` / `filteredJitterRms2s` / `filteredMaxJitter2s` / `filteredDrift2s` を計算する | jitter metrics | 2秒静止mockで2秒指標が出る |
| M7-09 | S | 静止発勁0回テストを作る | unit test | 10秒静止で発火しない |
| M7-10 | S | diagnosticにquality flagsを出す | flags UI | 欠落/外れ値が見える |

### M8: Calibration・軸処理

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M8-01 | S | `calibrationManager.ts` を作る | calibration state | 初期値がある |
| M8-02 | S | neutralHandPositionを保存する | neutral | discard後2秒、40valid sample以上のneutralが保存される |
| M8-03 | S | upVectorを定義する | up axis | 上下チャージに使われる |
| M8-04 | S | forwardVectorを定義する | forward axis | 前後チャージに使われる |
| M8-05 | S | 軸反転/入替設定を入れる | input config | 前後が逆なら直せる |
| M8-06 | S | calibrationQualityを作る | 品質表示 | 受信Hz/jitterが見える |
| M8-07 | S | Keyboard用疑似Calibrationを作る | fallback calibration | Keyboardで待ち続けない |

### M9: Unity Bridge最小実装

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M9-01 | S | Unity Bridgeプロジェクトを作る | `unity-bridge/` | Unityで開ける |
| M9-02 | S | Receiver Pluginを導入する | plugin | サンプルSceneが動く |
| M9-03 | S | Humanoid Avatarを設定する | avatar | Avatarが動く |
| M9-04 | S | RightHand Transform取得を書く | `RightHandUdpSender.cs` | Unityログに座標が出る |
| M9-05 | S | `LateUpdate` で座標取得する | frame timing | 値が更新される |
| M9-06 | S | UDP送信を実装する | motion JSON | Electron/mock receiverで受信 |
| M9-07 | XS | motion JSONに必ず `seq` を入れる | seq counter | seqが連番で増える |
| M9-08 | S | heartbeat送信を実装する | heartbeat JSON | rightHandReadyが出る |
| M9-09 | S | BridgeStatusViewを作る | 診断画面 | Receiver/Avatar/RightHand/Hzが見える |
| M9-10 | S | Bone ID 18 positionを使っていないことをレビューする | code review | `GetBoneTransform` 経由である |

### M10: mocopi実機入力検証

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M10-01 | S | Motion Source Appを選定する | mocopi PC appまたはXYN | 選定理由をdocsに記録 |
| M10-02 | S | Sensor data receiver接続を確認する | 接続ログ | PCでセンサー認識 |
| M10-03 | S | Motion Source App→Unity受信を確認する | Avatar動作 | Unity上でAvatarが動く |
| M10-04 | S | 右手上下を確認する | 実機ログ | 上げるとy増、下げるとy減 |
| M10-05 | S | 右手前後を確認する | 実機ログ | forward成分が変わる |
| M10-06 | S | 静止2秒jitterを記録する | jitter log | `rawJitterRms2s <= 0.05m`、`rawMaxJitter2s <= 0.12m`、`filteredJitterRms2s <= 0.03m`、`filteredMaxJitter2s <= 0.08m`、`filteredDrift2s <= 0.05m` を確認 |
| M10-07 | S | Diagnosticsの10秒静止発勁誤検出testを確認する | false fire run log | `staticFalseHakkeiCount10s=0` なら合格 |
| M10-08 | S | 受信30Hz以上を確認する | Hz log | Electronで30Hz以上 |
| M10-09 | S | 1秒以上欠落しないか確認する | gap log | 連続欠落なし |
| M10-10 | S | 不安定時Keyboard切替を確認する | fallback log | 30秒以内に切替 |

### M11: チャージ・発勁本実装

> **設計確定（2026-06-23）**: チャージ威力は **`upVector`/`forwardVector` へ射影した変位の積算**（SPEC §14.1/14.2）で導出する。
> 「加速度から導く」案はゲームデベロッパレビューで却下した（keyboardのA/D等速で加速度≈0となり3経路で不公平、ノイズ最弱項、発勁スコアとの二重計上）。
> M3で入れたピーク速度(`max|velocity|`)は暫定実装であり、ここで本実装へ置換する。根拠の詳細は [作業日誌](docs/development/作業日誌.md)「設計判断ログ」参照。
> M3暫定からの是正点: (a)ピーク速度→**変位積算**、(b)生軸→**Calibration軸へ射影**、(c)**`validForScore` のみ積算**、(d)**デッドゾーン** `verticalNoiseThreshold`/`forwardNoiseThreshold` を config 追加。

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M11-01 | S | 上下チャージ積算を実装する（変位を `upVector` へ射影し絶対値積算） | verticalRaw | 右手上下で増える／M3のピーク速度実装を置換 |
| M11-02 | S | verticalNoiseThreshold / forwardNoiseThreshold を設定化する | score.config | 静止で増えない |
| M11-03 | S | 前後チャージ積算を実装する（`forwardVector` へ射影） | forwardRaw | 前後で増える |
| M11-04 | S | forwardVector反映を確認する | axis test | 横振りで増えにくい |
| M11-04b | S | `validForScore=true` のsampleだけ積算する | valid gate | 無効sampleで増えない |
| M11-04c | S | 正規化レンジを変位[m]へ意味変更する | score.config | keyboard全押しで7〜8割に着地（実機はM10で確定） |
| M11-05 | S | 発勁閾値を設定化する | score.config | JSONで調整可能 |
| M11-06 | S | 複合条件で発勁検出する | hakkeiDetector | 速度+加速度+移動量で検出 |
| M11-07 | S | cooldownを実装する | 二重検出防止 | 連続Enter/連続突きで1回扱い |
| M11-08 | S | timeout no-impactを実装する | fallback score | `hakkeiDetected=false` / `hakkeiTimedOut=true` / `hakkeiScore=0` で進む |
| M11-09 | S | HakkeiScoreを計算する | 複合スコア | Resultに表示される |
| M11-10 | S | 静止ノイズテストを作る | unit test | 静止sampleでは発火しない |
| M11-11 | S | 横振りテストを作る | unit test | forward条件不足で発火しない |
| M11-12 | S | 実機発勁テストを実施する | 記録 | 誤検出/未検出を記録する |
| M11-13 | S | 協調mockモードを追加する（`npm run mock:unity --calib`：静止3秒→前進→チャージ揺動） | mock script | 実機なしで mock だけ Calibration→チャージ→Result を回帰テスト |

### M15: 単手回帰＋方向/idle 隠しイベント（Phase A）

> **現行確定設計は SPEC §0.23（2026-06-25・codexレビュー反映済 commit 086c5a1）**。両手同期パンチ撤回後の最新。
> 通常プレイ＝「利き手1本でチャージ→構え→前方へ突く＝通常破壊」。前方でない突き（下/上/後ろ）と idle(15s) を隠しイベント化。
> **タスク順序は codex レビュー（2026-06-25）に従い、純粋ロジック/型を先に単体テストで固め、stateMachine rename は後ろに置く**（既存127件テストへの波及を最後にまとめ、手戻りを減らす）。
> **最小 UI は M15 に含める**（利き手決定案内・隠し/noImpact の最低限 Result・back安全・idle待機）。見た目/ゲージ/外部ディスプレイ調整は M12。
> 両手v2 資産（packet v2/leftHand/両手neutral/DualHakkeiDetector）は撤去せず温存（Phase B/dev用）。

**着手前提・リスク対策（codex 指摘）**
- **M15-00 は「最小の権威化」に絞る**（型スケルトン・state一覧・責務分離・config key 例・Gate再定義TODO のみ。詳細式の全面改稿は各実装タスクで）。
- **DominantHandCheck は Calibration の後**（方向判定に forward/up が要る）。推奨フロー `InputCheck → Calibration → DominantHandCheck → Ready`。Keyboard は right 既定で skip 可。
- **config test を最初（M15-01）に更新**（後続が config invalid で詰まるのを防ぐ）。
- **hidden 動画未作成時は placeholder / lv0 割当 policy** を置く（`VIDEO_MISSING` で hidden path 全滅を防ぐ）。
- **idle は test config で `idleEventMs` 短縮**（本番 15000ms）。
- **Gate C/D は M15 後に再定義**（M15-08 実機検証で新 Gate 候補を置く）。

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M15-00 | S | ✅ SPEC 旧章を §0.23 へ**最小**権威化（§9.0 新型スケルトン・§10.0 新state一覧・§14/§15 責務分離・§16.0 最小UI受入条件・§18.3 config key例・§19 Gate再定義TODO） | 更新済 SPEC（commit 570d377） | ✅ 各章が §0.23 と矛盾しない。旧 vertical/forward/旧Gate は「旧参考」へ |
| M15-01 | S | ✅ 新型＋config＋純粋関数を**既存stateを触らず追加**（`DominantHand`・`OutcomeTrigger`・`Outcome`・`handKinematicsFor`・`resolveTrigger`・`resolveOutcome`＋config型/json/validator） | 型・純粋関数・config（outcomeResolver.ts・143件緑） | ✅ unit test: trigger境界(forward/down/up/back/hiddenMiss/noImpact)・outcome(forward=score表示/hidden=固定動画)・config invalid(idle矛盾/forwardCos>=dirCos) |
| M15-02 | S | ✅ `DominantHandCheck` ロジック（左右 margin 判定・曖昧時 retry）。UIは最小（M15-07） | 利き手決定（dominantHandSelector.ts・159件緑） | ✅ 右だけpunch→right/左だけ→left/両手同程度→ambiguous/静止→waiting/左手null可/reset。R/UI再選択は M15-05/07 で配線 |
| M15-03 | S | ✅ 単手 detector 配線：通常 path を `HakkeiDetector + handKinematicsFor`（利き手1本）へ。`DualHakkeiDetector` は punch-test(dev) に温存 | detector配線（app.ts） | ✅ 利き手1本で発火・両手同期不要・D案 magnitude/net 維持（前方 gate は方向分岐へ委譲） |
| M15-04 | S | ✅ 単手 charge accumulator（利き手 Σ\|Δp\| → rightChargeRaw） | playAccumulator "Charge"・165件緑 | ✅ 利き手で増える/非利き手で増えない/静止で増えない/validForScore=falseで増えない |
| M15-05 | S | ✅ stateMachine 新 flow（`…→Calibration→DominantHandCheck→Ready→Charge→HakkeiPrep→HakkeiReady→…`）。reset 契約を entry/manual pick で実装 | stateMachine・state-machine/play-loop テスト更新 | ✅ Keyboard Title→Result 完走（skip Calibration/DominantHandCheck）・Esc/R scope・DominantHandCheck は reset 対象外 |
| M15-06 | S | ✅ hidden/idle/outcome 本配線。HakkeiReady で magnitude 強さ＋`resolveTrigger` 分岐、`resolveOutcome` でアウトカム確定 | hidden/idle（app.ts） | ✅ down/up/back は gate 達成時のみ hidden・gate不足非前方は通常破壊に落とさず撃ち直し・idle は idleEnabled 時のみ低運動量で発火（現状 false で dormant） |
| M15-07 | S | ✅ 最小 UI / Result / videos（M12へ送らない）。`VideoSelection` で動画解決 | UI/Result（app.ts） | ✅ 利き手決定UI（突いて選ぶ＋手動 pick＋ambiguous retry）・hidden/no-score Result・back安全注意・単手ライブ診断・placeholder(lv0) |
| M15-08 | S | 🟡 Keyboard 核：Enter=前方発勁/Space=charge で新 flow 完走、L=利き手左右トグル(dev)。**方向キー(下/上/後ろ)と idle 短縮は未実装**（KeyboardKey 拡張要・dev follow-up） | keyboard | ✅ forward 完走・利き手切替。🟡 方向/idle 再現は follow-up |
| M15-09 | M | 実機 mocopi 検証＋閾値調整。計画=[docs/M15-09-experiment.md](docs/M15-09-experiment.md)、手順=[docs/M15-09-runbook.md](docs/M15-09-runbook.md)。trial境界付き連続記録→本番コードで offline replay→制約付き最適化（再現可能・主観限定） | ✅ ツール実装済（Recorder/offlineEvaluator/sweep CLI）・178件緑。🟡 実機データ収集＋閾値採用が残（人手） | 受入: static誤発火0/forward recall(holdout)≥90%/forward→hidden=0/double fire=0/weak誤発火≤10%/latency≤300ms |

### M16: 特殊モーション・骨格v3（Phase B）

> Phase A（M15）を完璧にしてから着手。特殊モーション（領域展開・かめはめ波）は手2点の加速度だけでは判別困難なため骨格入力を検討。
> **codex 推奨：M16 は optional stretch / 次版扱い**。実装順では M12/M13/M14 の後。**M13/M14 の前提にしない**。
> 本番前に入れる場合は **feature flag 必須**、packet v3 は **v2 fallback 必須**で **Gate D1 の前提にしない**（Phase A の緑を崩さない）。

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M16-01 | S | packet v3 を設計（v2 validator/builder 維持・skeleton optional block・`skeletonReady`/`bones`/`bodyForward`/`headForward`） | packet契約v3 | v2 packet を壊さない・v3 が validator を通る |
| M16-02 | S | Unity Bridge を骨格送信へ拡張（複数ボーン・体/頭の向き） | C#送信 | Unityで骨格JSONが出る |
| M16-03 | S | Main で骨格 derived payload を正規化（Renderer で score 値を作らない原則維持） | skeleton sample | 正規化済み payload が Renderer へ届く |
| M16-04 | S | 特殊モーション分類器（領域展開・かめはめ波）＋ `special_*` トリガー | special detector | タメ十分で特殊発火・足りなければ hiddenMiss |
| M16-05 | S | 真後ろ＝振り向き判定を bodyForward/headForward で厳密化 | back厳密化 | 振り向き検出が手位置のみより堅牢 |
| M16-06 | S | 特殊モーションの動画/Result と安全注意 | UI/Result | special_* で専用演出 |
| M16-07 | S | 実機 mocopi で特殊モーション・厳密 back を検証 | 記録 | 発火/誤発火を記録 |

### M12: UI・演出調整

M12は「見た目の調整」である。安全注意自体はM1〜M2で実装済みであること。
**※ §0.23/M15 優先**：M15 で最小 UI（利き手決定・隠し/no-score Result・back安全・idle待機）は実装済みの前提。M12 はその後の見た目/演出/外部ディスプレイに限定する。
**※ M12-03/M12-04 の上下/前後ゲージは §0.23 で廃止**。単手 charge gauge（リーキーメータ）に置換する（codex Risk 1）。

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M12-01 | XS | Titleを発表用文言にする | Title画面 | 入力モードが明確 |
| M12-02 | XS | 安全注意の文言と視認性を整える | 注意表示 | 離れても読める |
| M12-03 | S | 上下ゲージを実装する（表示用リーキーメータ `gauge=gauge·e^(−dt/τ)+\|dAxis\|`, τ≈1s。**採点とは分離**） | Vertical gauge | 振ると溜まり止めると減る |
| M12-04 | S | 前後ゲージを実装する（同上・表示専用） | Forward gauge | 振ると溜まり止めると減る |
| M12-05 | S | 発勁待機演出を入れる | HakkeiReady UI | いつ突くか分かる |
| M12-06 | S | ImpactDelay演出を入れる | 暗転/揺れ | 発勁後の間が出る |
| M12-07 | S | リザルト内訳を整える | Result UI | 損害額、Power、3スコアが見える |
| M12-08 | S | ランク表示を入れる | rank | Powerに応じて変わる |
| M12-09 | S | Error復帰ボタンを整える | Error UI | Title/InputCheckへ戻れる |
| M12-10 | S | 外部ディスプレイで見やすい文字サイズにする | CSS | 離れて読める |

### M13: ビルド・本番PC確認

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M13-01 | S | Electronビルド設定を作る | build script | `npm run build` が通る |
| M13-02 | S | 動画assetをビルドに含める | packaged videos | 本番ビルドで動画再生 |
| M13-03 | S | configをビルド後も読めるようにする | config path | 本番ビルドで設定反映 |
| M13-04 | S | 本番想定PCで起動する | exe/app | 起動確認 |
| M13-05 | S | 本番想定PCでキーボード完走する | test log | 1プレイ完走 |
| M13-06 | S | 本番想定PCで10回連続プレイする | stress log | クラッシュなし |
| M13-07 | S | Unity Bridgeと同時起動を確認する | real/mock test | InputCheck OK |
| M13-08 | S | 外部ディスプレイ確認をする | display test | 画面が崩れない |
| M13-09 | S | 音響確認をする | sound test | 適切な音量で鳴る |
| M13-10 | S | 安全中断を本番ビルドで確認する | safety log | R/Escで止まる |

### M14: 発表リハーサル・凍結

| ID | サイズ | 作業 | 成果物 | 確認方法 |
|---|---:|---|---|---|
| M14-01 | XS | 機能凍結を宣言する | freeze note | 新機能追加を止める |
| M14-02 | S | スコアしきい値を実測で調整する | score config | 弱/中/強で差が出る |
| M14-03 | S | 発勁しきい値を調整する | hakkei config | 静止誤検出が頻発しない |
| M14-04 | S | jitter基準と実測値を記録する | jitter report | 基準内または理由付き調整 |
| M14-05 | S | 動画しきい値を調整する | videoLevels | 体感とLvが概ね合う |
| M14-06 | S | 操作担当者が標準起動を練習する | rehearsal log | 手順を見ずに起動できる |
| M14-07 | S | キーボード切替を練習する | fallback rehearsal | 30秒以内に切替できる |
| M14-08 | S | mocopi不安定時の説明文を用意する | fallback script | 発表進行が止まらない |
| M14-09 | S | 予備動画または固定デモを用意する | backup | 入力なしでも説明できる |
| M14-10 | S | 当日チェックリストを印刷または保存する | checklist | 操作担当者が見られる |
| M14-11 | S | 最終リハーサルを1回通す | final log | 本番同等環境で成功 |

---


## 6. ゲート判定

この章は技術Gateだけを扱う。会場運用、安全誘導、配布手順は対象外。

### Gate A: Keyboard MVP

通過条件:

- Electron Appが起動する。
- `activeMode="keyboard"` でKeyboard入力がMain生成 `MotionSample.source="keyboard"` として流れる。
- Enterは直接Impactへ飛ばず、通常Hakkei判定を通る。
- キーボード入力でTitleからResultまで10回連続で完走する。
- Lv0〜Lv5動画境界、損害額、rank、ScoreBreakdownが表示される。
- `R` と `Esc` のreset scopeが仕様どおりである。

未通過なら、Unity Bridge統合を広げない。

### Gate B1: Unity Bridge入口調査

通過条件:

- UnityでRightHand Transformが取得できる。
- `RightHandUdpSender` がReceiver Plugin反映後に動く実行順になっている。
- motion JSONとheartbeat JSONに `protocolVersion`、`sessionId`、`timestampMs`、`source` がある。
- heartbeatに `receiverReady`、`receiverStatus`、`avatarReady`、`rightHandReady`、`frameRate`、`sendRateHz` がある。

### Gate B2: Unity Bridge入力成立

通過条件:

- `activeMode="unity-bridge"` で実Unity BridgeのUDP JSONを受信できる。
- Mock Unity BridgeだけでGate B2 PASSにしていない。
- motion JSONの `seq` 欠損、duplicate、rollback、gapが固定code/warningで見える。
- timestamp rollback / gapが固定code/warningで見える。
- heartbeatを受信し、`motion:heartbeat`、`motion:status`、必要に応じて `motion:session-changed` がpreload API経由でRendererへ届く。
- `config:get` は `IpcResult<AppConfigBundle>` を返す。

### Gate C: Unity上下チャージ成立

通過条件:

- Unity Bridge実入力でCalibrationが成立する。
- Unity Bridge実入力で上下チャージと前後チャージが動く。
- `motion:diagnostics` に2秒jitter、Hz、phase別validSampleRatioが出る。
- `StatusWarningCode` と `AppErrorCode` が型定義と表示に使われる。
- キーボード入力へ即時切替してもsource混入しない。
- Lv0〜Lv5動画選択が動く。

### Gate D1: Unity実入力で発表可能

通過条件:

- `activeMode="unity-bridge"`。
- motionHz平均30Hz以上、heartbeatHz 1Hz以上、timeoutなし。
- Vertical/Forward中の `validSampleRatio >= 0.95`、HakkeiReady中の `validSampleRatio >= 0.90`。
- 2秒静止で `rawJitterRms2s <= 0.05m`、`rawMaxJitter2s <= 0.12m`、`filteredJitterRms2s <= 0.03m`、`filteredMaxJitter2s <= 0.08m`、`filteredDrift2s <= 0.05m`。
- 10秒静止で発勁誤検出0回。
- 上下、前後、発勁、動画、Resultが一通り成立する。
- jitter WARNはGate D1 PASSではない。基準を変更する場合は、先にconfigと理由を更新して再測定する。

### Gate D2: Keyboard fallback承認済み

通過条件:

- `activeMode="keyboard"` で10回連続完走する。
- Keyboard由来 `MotionSample` が通常Hakkei判定と `calculatePowerFromScores()` を通る。
- Lv0〜Lv5の動画境界確認が済んでいる。
- Unity由来のErrorやwarningは `app:error-clear` で消える。

Gate D2はGate D1の代替であり、Gate D1を通った扱いにはしない。

## 7. 優先順位

| 優先度 | 内容 |
|---|---|
| P0 | 起動、要件参照、安全表示、中断、キーボード完走、動画再生、Result、再プレイ |
| P1 | UDP受信、`seq`必須validator、heartbeat、typed IPC、InputCheck、Unity Bridge RightHand、MotionSample |
| P2 | Calibration、前後チャージ、発勁複合判定、jitter測定、エラー復帰 |
| P3 | UI演出、音響、しきい値調整、発表品質 |
| P4 | ハイスコア、複数動画ランダム、ElectronからUnity自動起動 |

---

## 8. スコープ削減基準

時間が不足した場合は、次の順に削る。

1. ハイスコア。
2. 同一レベル内の複数動画ランダム再生。
3. ElectronからUnity Bridge自動起動。
4. 音響の細かい同期。
5. UI演出の細部。
6. mocopi入力の完成度。

削ってはいけないもの:

- `docs/requirements.md` の参照可能性。
- 安全表示。
- 中断操作。
- キーボード入力。
- Title〜Resultの完走。
- 動画再生。
- 損害額、ランク、スコア内訳。
- Errorからの復帰。



## 9. 2026-06-06 追加タスク

未解決指摘のうち、実装・テスト契約へ影響する項目を次のタスクとして追加します。

| ID | 追加先 | 作業 | 確認方法 |
|---|---|---|---|
| M4-09 | M4 | `app.config.json` を追加し、timer/video/audio/diagnostics設定をschema化する | `config:get` が `IpcResult<AppConfigBundle>` で成功/失敗を返す |
| M4-10 | M4 | `input.config.json` に `schemaVersion`、`maxDatagramBytes`、`coordinates`、`keyboard` を追加する | 添付例がvalidatorを通る |
| M4-11 | M4 | `score.config.json` に `rankThresholds`、`scoreDisplay`、video境界包含規則を追加する | rank/video境界値testが固定期待値で通る |
| M5-12 | M5 | seq duplicate、timestamp gap、common field invalid、unknown source countをvalidatorへ追加する | `mock:unity:seq-duplicate` 等で固定codeが出る |
| M5-13 | M5 | `motion:status` を250ms周期で再発行する | packet停止中にtimeout表示が更新される |
| M5-14 | M5 | mock異常系script名を固定して実装する | 予約script名が `npm run` で呼べる |
| M6-08 | M6 | InputCheck OK条件表をUIへ反映する | 実Unity/Mock/KeyboardのOK/NGが混同されない |
| M7-09 | M7 | dt/outlier処理表どおりにinvalid sampleを生成し、score除外する | validSampleRatioとflagsのunit testが通る |
| M8-08 | M8 | Calibrationのdiscard、sample数、Hz、forward距離、session破棄を実装する | neutral/forward失敗理由が表示される |
| M11-08 | M11 | phase初回valid sampleをbaseline化し、Hakkei timeoutをno-impactにする | timeout時に `hakkeiScore=0` になる |
| M11-09 | M11 | `ScoreBreakdown` 整合性validatorを追加する | NaN、境界、timeout、rankが固定testで通る |
| M12-07 | M12 | Debug Result FixtureをDiagnostics/Dev menuへ分離する | 通常入力mode一覧にFixtureが出ない |
| M13-06 | M13 | Gate D1/D2記録欄を2秒jitter、phase別validSampleRatio、Gate D2承認欄へ更新する | `docs/verification_checklist.md` で記録できる |

これらは会場運用、安全誘導、配布作業ではなく、実装・型・テスト・Gate技術判定の分岐を防ぐための追加タスクです。
## 2026-07-11 サーバーダウン時ローカル継続運用

- ✅ `scripts/windows/release_local.bat` / `--local-mode`、キーボード名前入力、ローカルランキング参照・保存
- ✅ ローカルモードのQR・スマホ進行・HTTP/WebSocket停止、mocopi BLE既定入力の維持
- ✅ 通常モードのVideoPlayback/Resultバックグラウンド同期
- 確認: typecheck、全自動テスト、手動手順は `HUMAN_TEST_GUIDE_JA.md`
