# Ticket: 両手v2 P3a — チャージ両手化（右手/左手 Σ|Δp|）

担当: codex / 起票: claude / 2026-06-25
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P1a/b/c・P2(26181fa)

## このチャンクの方針
チャージを **「フェーズ担当手の 3D 総移動量 Σ|Δp| の積算」** に変える（射影をやめる）。
- フェーズ1（現 VerticalCharge）= **右手チャージ**（右手 `sample.handPosition` の Σ|Δp|）。
- フェーズ2（現 ForwardCharge）= **左手チャージ**（左手 `sample.leftHand.handPosition` の Σ|Δp|）。
- **発勁（HakkeiReady）はこのチャンクでは単手のまま**（両手パンチは P3b）。
- **phase 名はまだ変えない**（VerticalCharge/ForwardCharge のまま・意味だけ右手/左手チャージ。rename は P3c）。
- **キーボード予備入力を壊さない（最重要・CLAUDE.md 不変ルール）**：左手チャージ用に keyboard も左手 sample を生成する。

## 現状
- `src/renderer/playAccumulator.ts` `accumulateCharge(play, phase, sample, axis, noiseThreshold)`：
  右手 `sample.handPosition` の差分を axis(up/forward) へ射影し |proj| を verticalRaw/forwardRaw に積算。baseline・noiseThreshold あり。
- `src/shared/types.ts` `ScoreRawInput`：verticalRaw / forwardRaw / hakkei系。`ScoreBreakdown` 同様。
- `src/renderer/scoreCalculator.ts`：normalizeScore(verticalRaw,…) で vertical/forward Score。`config/score.config.json` normalization に verticalRawMin/Max・forwardRawMin/Max・noiseThreshold。
- `src/renderer/app.ts` onSample：VerticalCharge→accumulateCharge(right, upVector)、ForwardCharge→accumulateCharge(right, forwardVector)。finalizeScore で verticalRaw/forwardRaw を ScoreRawInput へ。
- `src/main/keyboardSampleGenerator.ts`：Space=チャージtap（右手 y/z 往復）、Enter=前方突き。leftHand=null。
- `src/renderer/resultPresenter.ts`：「上下/前後 チャージ」表記。

## 要件
1. **charge = Σ|Δp|（3D 総移動量）**：`accumulateCharge` を「担当手の handPosition の連続差分の 3D ノルムを積算」に変更（射影 axis をやめる）。`validForScore=true` のみ・フェーズ最初は baseline・noiseThreshold 以下は無視（静止で増えない）は維持。担当手を引数で受ける（right=`sample.handPosition` / left=`sample.leftHand?.handPosition`）。
2. **ScoreRawInput / ScoreBreakdown**：`verticalRaw`→`rightChargeRaw`、`forwardRaw`→`leftChargeRaw` に名称変更（意味＝各手の総移動量[m]）。`scoreCalculator` / `app.ts` / `resultPresenter` / 関連テストを追従。
3. **config**：`score.config.json` normalization の `verticalRawMin/Max`→`rightChargeMin/Max`、`forwardRawMin/Max`→`leftChargeMin/Max`、`verticalNoiseThreshold`/`forwardNoiseThreshold`→`rightChargeNoiseThreshold`/`leftChargeNoiseThreshold`（値は据え置きでよい・実機チューニングは後）。configTypes/appConfig も追従。
4. **app.ts onSample**：VerticalCharge→右手 charge、ForwardCharge→**左手 charge**（`sample.leftHand`）。左手が無い（v1/unavailable）ときは積算しない（leftChargeRaw=0 のまま＝後述 keyboard で担保）。
5. **keyboard 両手（左手チャージ用）**：`keyboardSampleGenerator` に**左手チャージ用キー**を追加し、その押下で `leftHand` に左手の往復運動を生成（右手 Space と対称）。右手 Space／左手キー／Enter突き。キーは config 化（`input.config.json keyboard`）。**右手チャージ・Enter 発勁の既存挙動は維持**。
6. **Result 表記**：「上下/前後」→「右手/左手」チャージ（入力モード別文言は据え置きで可）。

## 不変ルール
- **キーボードで Title→Result 完走が維持される**（右手チャージ＋左手チャージ＋単手発勁で通る）。既存 play-loop / keyboard 回帰を緑に保つ。
- 発勁検出（hakkeiDetector）・両手パンチはこのチャンクで触らない（P3b）。Main生成値のみ・Renderer再計算禁止。TS3規約。commit/pushしない。
- 状態遷移は変えない（phase 名据え置き）。SPEC §14 の charge 記述は更新（Σ|Δp|・右手/左手）。

## テスト
- accumulateCharge：右手/左手それぞれ Σ|Δp| が積算される・静止で増えない・baseline・validForScore gate。
- 左右独立（右手 charge に左手の動きが混ざらない、その逆も）。
- keyboard：左手チャージキーで leftHand が動く・左手 charge が溜まる／右手 Space で右手 charge／Enter 発勁は従来どおり検出。
- 縦通し（keyboard）が Result まで到達。既存テストは全 green 維持で新規追加。

## 検証 / 報告
- `npm run typecheck && lint && test && build` 全緑。
- 報告は agmsg ファイル経由送信（不調なら claude が作業ツリーを直接検証するので、実装と日誌 docs/runs/ さえ残れば可）。詰まったら相談。P3b/c は未着手で。
