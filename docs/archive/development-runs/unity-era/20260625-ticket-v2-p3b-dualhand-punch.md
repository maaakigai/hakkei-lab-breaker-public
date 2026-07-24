# Ticket: 両手v2 P3b — 両手パンチ（同期検出・平均スコア）

担当: codex / 起票: claude / 2026-06-25
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P3a(f49c478)

## このチャンクの方針
発勁を**単手→両手パンチ**へ。**両手が同期 window 内に各自 forward 複合条件を満たしたとき**だけ検出。
スコアは**両手の windowed raw の平均**（ユーザー決定）。片手だけ／片手欠損は**検出しない＝揃うまで待機**し、
`hakkeiReadyTimeoutMs` 到達で no-impact。**phase 名は据え置き（HakkeiReady のまま・rename は P3c）。キーボード予備入力を壊さない（最重要）。**

## 現状
- `src/renderer/hakkeiDetector.ts` `HakkeiDetector.observe(sample, forwardVector)`：単手。`sample.handPosition/velocity/acceleration`（右手）を forwardVector へ射影し複合判定（SPEC §13.6）。window から forwardVelocityPeak/forwardAccelerationPeak/forwardDisplacement を返す。
- `src/renderer/app.ts` HakkeiReady：`detector.observe(sample, forwardVector)`→detected で finalizeScore(true,false,observation)。observation の3値を ScoreRawInput(hakkeiVelocityPeak/AccelerationPeak/Displacement) へ。
- `src/main/keyboardSampleGenerator.ts`：Enter は**右手のみ**前方突き（leftHand は突かない）。
- `config/score.config.json` hakkei：閾値・window・cooldown・weight。

## 要件
1. **detector を手の運動量で受ける形へリファクタ**：`HakkeiDetector.observe` を `MotionSample` 依存から
   `(position, velocity, acceleration, validForScore, timestampMs, forwardVector)` 受け取りへ（accumulateCharge と同様の decouple）。
   1手ぶんのロジック（複合条件・window・cooldown・peak）は不変。
2. **両手化**：右手用・左手用に detector を**2インスタンス**持つ（または dual ラッパ）。
   - 右手 = `sample` のトップレベル（handPosition/velocity/acceleration）。左手 = `sample.leftHand`（position/velocity/acceleration）。forwardVector は**共通**（calibResult?.forwardVector ?? defaultForwardVector）。
   - **検出条件**：両手がそれぞれ複合条件を満たし、かつ**両手の検出 timestamp 差が同期 window 以内**のときだけ「両手パンチ検出」。
   - 片手のみ／左手欠損（v1/unavailable）→ 検出しない（揃うまで待機）。`hakkeiReadyTimeoutMs` で no-impact（既存の timeout 経路を維持）。
3. **スコア＝両手の平均**：ScoreRawInput の hakkeiVelocityPeak/hakkeiAccelerationPeak/hakkeiDisplacement を
   **両手 windowed raw の平均**にする（右と左の各 peak/displacement の平均）。`scoreCalculator` の計算式は不変（平均値を入れるだけ）。
4. **config**：`score.config.json hakkei` に `dualHakkeiSyncWindowMs`（例 150–250ms）を追加。configTypes/appConfig 追従。
5. **keyboard 両手パンチ**：Enter で**右手と左手の両方**を前方へ突く（両手 detector が同期 window 内で検出できるように）。
   右手チャージ／左手チャージ／既存挙動は維持。
6. **触らない**：playAccumulator のチャージ（P3a 済）、phase 名（P3c）、Result の charge 表記（済）。

## 不変ルール（最重要）
- **キーボードで Title→Result 完走を維持**（右手チャージ＋左手チャージ＋**両手 Enter パンチ**で発勁検出→Result）。
- 静止で誤検出しない（静止誤検出テスト＝両手とも静止なら検出0を維持）。
- Main 生成値のみ・Renderer 再計算禁止。TS3規約。commit/pushしない。状態遷移は変えない（HakkeiReady のまま）。

## テスト
- 両手同期で検出・スコアは平均：両手が複合条件＆同期window内→detected、hakkeiVelocityPeak 等が右左の平均。
- 片手のみ→非検出（揃わない）。左手欠損(v1/unavailable)→非検出（→timeout no-impact）。
- 同期 window 外（片手が遅れる）→非検出。
- 静止両手→検出0（誤検出なし）。
- **keyboard 統合**：Enter で両手が突き、両手 detector が検出（＝キーボード発勁が両手で成立）。あわせて P3a NIT の
  「keyboard で右手/左手チャージが両方溜まる」統合確認も1本追加。
- 既存テストは全 green 維持で新規追加。

## 検証 / 報告
- `npm run typecheck && lint && test && build` 全緑。SPEC §13.6 を両手パンチへ更新。
- 報告は agmsg ファイル経由送信（不調なら実装＋日誌 docs/runs/ を残せば claude が直接検証）。詰まったら相談。P3c は未着手で。
