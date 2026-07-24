# V3 app.ts magnitude-only 改修 計画（次の集中作業ハンドオフ）

Claude×Codex 合意（2026-06-27）。**現在の緑チェックポイント=commit `e65484f`（210緑）**。
本書は「赤窓に入る前に固定する事項」（Codex app-refactor review 準拠）。次セッションはこれに沿って実行する。

## 判定
- **今は push-through しない。`e65484f` で区切る。** 長セッション末尾の一気書換は危険。
- 次は **2 commit**: ① `punch` config additive（緑）→ ② app.ts＋stateMachine＋テスト一塊（赤窓許容・最後に緑）。
- app.ts は **surgical 除去でなく MVP 向けの薄い書き直し**（残す配線だけ移植）。

## Commit 1: `punch` config（additive・緑で切る）
- `config/score.config.json`（or app.config）に `punch` ブロック追加:
  - `intensityThreshold`(角速度 deg/s・暫定 TODO・実機 still~2 / punch~800 deg/s より弱パンチも拾う初期値) /
    `chargeNoiseFloor` / `chargeReadyThreshold` / `timeoutMs` / `cooldownMs`
- `src/shared/configTypes.ts` に型追加、`src/main/appConfig.ts` に validation（非負等）、config test 追加。
- **この時点で app.ts からは未使用でよい**。schema/defaults は後続 app.ts が読む名前で固定。

## Commit 2: app.ts / stateMachine / tests を magnitude-only MVP へ

### 新 stateMachine 状態一覧（Calibration/DominantHandCheck/HakkeiPrep 撤去）
`Title → InputCheck → Ready → Charge → HakkeiReady → ImpactDelay → VideoPlayback → Result (+ Error)`
- events: start / **inputOk**(InputCheck→Ready) / countdownEnd / chargeDone(Charge→HakkeiReady) / hakkeiDetected / hakkeiTimeout / impactDone / videoEnd / videoError / replay / finish / back / recover / recheck / fail / esc / reset
- RESETTABLE: Ready/Charge/HakkeiReady/ImpactDelay/VideoPlayback

### app.ts で「残す責務」（薄い MVP app へ移植）
config load / preload IPC 購読 / **`onPunchInput` 消費** / keyboard debug keydown-keyup 送信 / state dispatch /
charge 積算(`accumulatePunchCharge`) / punch 検出(`PunchDetector` intensity ゲート) / timeout=noImpact /
video 選択・再生(`videoManager`/`videoFileForLevel`) / result 表示(`resultHtml`) / error 表示 / diagnostics 最小表示。
- score: `finalizeScore`→`buildPunchScoreBreakdown({chargeRaw, punchStrengthRaw, punchDetected, punchTimedOut})`。
- 入力: `onPunchInput`(PunchInputSample) でゲーム進行。`onMotionSample` は diagnostics 表示のみに残す。

### app.ts で「捨てる機能」（今回撤去）
Calibration 計測 / DominantHandCheck / directionProbe / outcomeResolver / DualHakkeiDetector /
sampleRecorder / staticHakkeiTest / playAccumulator / direction・hidden outcome UI。
- import 撤去: calibrationManager / dominantHandSelector / directionProbe / outcomeResolver / hakkeiDetector /
  sampleRecorder / staticHakkeiTest / playAccumulator。
- `onMotionSessionChanged` の livePlay 配列を新 state へ更新。起動の HakkeiDetector/DominantHandSelector 生成撤去。

### テスト：置換 vs 削除
- **新仕様へ置換**: state-machine / play-loop(app flow) / punch-core(済) / punch-input-adapter(済) / videoManager / score breakdown / keyboard が PunchInputSample 経路に届く。
- **削除**: direction-probe / dominant-hand / outcome-resolver / DualHakkei / calibration(旧flow前提) / static-hakkei / sample-recorder / offline direction。
- **削除理由を docs/runs に記録**（「MVP 入力が利き手 mocopi 1台 magnitude-only へ変更、方向/利き手/calibration測定を標準flowから外したため」）。

### legacy ファイル削除（V3e・**Commit2(1100c0c)後の状態で絡みを確認済**）
**Commit2 で app.ts からは全 import 撤去済（orphan・緑・各テストは通る）。** 削除は絡みがあるので focused 作業で。
- **単独（安全に即削除可）**: `dominantHandSelector.ts`＋test / `sampleRecorder.ts`＋test / `playAccumulator.ts`＋test。
- **方向クラスタ（まとめて）**: `directionProbe.ts` / `outcomeResolver.ts` / `hakkeiDetector.ts`（DualHakkei含む）/ `staticHakkeiTest.ts` ＋ `src/tools/offlineEvaluator.ts` ＋ `scripts/sweep.mjs` / `scripts/make-synthetic-recording.mjs` ＋ 各 test（direction-probe/outcome-resolver/hakkei-detector/static-hakkei*/offline-evaluator）。相互 import あり。
- **要注意の外部参照（テスト/ツールを先に手当て）**:
  - `hakkeiDetector` を **keyboard-generator.test.mjs / mock-unity-calib-profile.test.mjs** が import（直接 game 無関係の assertion）。削除前にこの2テストの hakkeiDetector 依存を除く。
  - `calibrationManager` を **scripts/mock-unity.mjs / mock-unity-calib-profile.test / mock-unity-v2-profile.test** が使用。calibration は game から外したが mock-unity ツールが依存 → mock ツール側の扱い（calib 機能を mock から外すか、calibrationManager を tool 用に残すか）を決めてから。
- SPEC/MILESTONES/HUMAN_TEST_GUIDE の旧記述掃除は別作業（コード掃除と混ぜない）。

## ⚠ Commit 2 で要・設計判断: intensity の source 間スケール
**未解決の設計フォーク（次セッションで先に決める）**: `intensity` の単位が source 依存。
- keyboard: `|acceleration|` ≈ 10 m/s²（Enter パルス。`enterForwardDisplacementM`/`enterDurationMs` 由来）。
- BLE: 角速度 ≈ 800 deg/s（強パンチ）/ 静止 ~2 deg/s。
- → **単一 `intensityThreshold` では両方を発火できない**。選択肢:
  - **案1（推奨・最小）**: punch config に **source 別閾値**（`intensityThresholdKeyboard` ≈ 8、`intensityThresholdBle` ≈ 150）を持ち、app.ts が `store.inputMode` で選ぶ。adapter 無改修。
  - 案2: 各 adapter が intensity を **0..1 正規化**（source 別 reference で割る）し、閾値を 0..1 に。設計綺麗だが adapter（committed）改修＋test 波及。
- **決定（2026-06-27・ユーザ）＝案1**。config を source 別へ差し替え済み（`intensityThresholdKeyboard`=8.0 / `intensityThresholdBle`=150.0・暫定 TODO）。
  Commit 2 の app.ts は `store.inputMode` で keyboard/BLE 閾値を選び `PunchDetector` に渡す（active source が keyboard なら keyboard 閾値、mocopi-ble なら BLE 閾値）。

## 現在地（このセッション終了時）
- ✅ commit `2b7c599` 計画 doc / ✅ commit `f14fa24` punch config additive（210緑）。
- Commit 2（app.ts 薄い書き直し＋stateMachine＋テスト置換）は未着手＝**次の集中作業**。上の intensity スケールを先に決めてから着手する。

## Commit 2 着手手順（Codex commit2-start review 2026-06-27・確定）
**入口 = `d03602b`（区切り妥当・clean/210緑・intensity フォーク解決済）。次の集中作業で実施。**
順序:
1. stateMachine を新フローへ
2. app.ts を `onPunchInput` 消費の薄い MVP app へ置換
3. **最初の Gate = keyboard debug 完走**（Title→InputCheck→Ready→Charge→HakkeiReady→ImpactDelay→VideoPlayback→Result）。※報告上 keyboard を MVP 完了扱いにしない（debug core）。
4. score/result/video の最小表示を接続
5. 旧テスト削除/置換
6. `npm run typecheck && npm run lint && npm test && npm run build`（全緑）→ docs/runs に結果記録。

### 赤窓に入る前に明文化（Codex 必須）
- **閾値選択**: `store.inputMode` と `PunchInputSample.source` が食い違ったら **active input mode 優先**で閾値選択、diagnostic に不一致表示。
- **no input / invalid sample 中は charge も punch detector も進めない**。
- **timeout = noImpact / Lv0 / `punchTimedOut=true`**。
- **`onMotionSample` は diagnostics のみ**、game loop には使わない（`onPunchInput` が game）。
- 旧 calibration/direction/dominant 系は Commit2 で**復活させない**。

## 最後に通すコマンド
`npm run typecheck && npm run lint && npm test && npm run build`（全緑）。その後 docs/runs に結果記録。

## 参考
- Codexレビュー: 開発時のローカルレビュー記録2件
- 設計: `docs/drafts/{MVP,SPEC,MILESTONES,GATES}-v2-*.md`。実機/信号: `docs/runs/20260627-ble-spike-result.md`。
- 済み土台: V2a/b/c・V3a・V4a（PunchInputSample / adapter / punchCore / mocopiBleAdapter / Main emit）。
