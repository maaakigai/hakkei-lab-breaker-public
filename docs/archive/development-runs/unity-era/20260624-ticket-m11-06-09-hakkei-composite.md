# Ticket: M11-06〜09 発勁複合判定 + HakkeiScore windowed 本実装

担当: codex / 起票: claude（agmsg連携）/ 2026-06-24

## ゴール
単軸 `velocity.z` 判定を **SPEC §13.6 の複合条件**へ置換し、HakkeiScore を **SPEC §14.3 の「検出sampleを終端とする過去 `hakkeiWindowMs` の valid sample window」**で算出する。
閾値・重み・正規化レンジは `config/score.config.json` に**既に存在する**ため **config 変更は原則不要**。

## 現状（置換対象）
- `src/renderer/hakkeiDetector.ts`: `velocity.z >= minForwardVelocity` + cooldown の単軸（M2サブセット）。構築は `minForwardVelocity, cooldownMs` のみ。
- `src/renderer/playAccumulator.ts`: `accumulateHakkei` が **z軸ピーク**を収集（`hakkeiVelPeak=max velocity.z` / `hakkeiAccelPeak=max|accel.z|` / `hakkeiZMin/Max`）。暫定。
- `src/renderer/app.ts`:
  - `onSample` の `HakkeiReady`（L217-225）: `accumulateHakkei` → `detector.detect(sample)`。
  - `finalizeScore`（L131-146）: `store.play` から `ScoreRawInput` を組成（`hakkeiDisplacement = zMax - zMin` の暫定）。
  - detector 構築は **2箇所**（L577, L811-814）。
  - forwardVector は既に `calibResult?.forwardVector ?? coord.defaultForwardVector` を使用（L213）。
- `config/score.config.json`（変更不要・参照のみ）:
  - `normalization`: `hakkeiVelocityMin/Max=0.5/3.0`, `hakkeiAccelerationMin/Max=3.0/18.0`, `hakkeiDisplacementMin/Max=0.03/0.35`
  - `hakkei`: `hakkeiMinForwardVelocity=1.2`, `hakkeiMinForwardAcceleration=8.0`, `hakkeiMinForwardDisplacement=0.08`, `hakkeiWindowMs=200`, `hakkeiCooldownMs=500`, `velocityWeight=0.5`, `accelerationWeight=0.35`, `displacementWeight=0.15`
- `ScoreRawInput` / `ScoreBreakdown`（`src/shared/types.ts`）と `scoreCalculator.ts`（`computeHakkeiScore` = `velocityWeight*V + accelerationWeight*A + displacementWeight*D`）は**そのまま再利用**できる想定。

## 要件

### 検出条件（SPEC §13.6 / HakkeiReady 中、すべて満たしたら発勁検出）
1. `sample.validForScore === true`
2. `forwardVelocity = dot(velocity, forwardVector) > hakkeiMinForwardVelocity`
3. `forwardAcceleration = dot(acceleration, forwardVector) > hakkeiMinForwardAcceleration`（後方成分=負は0扱い＝負は不成立）
4. `forwardDisplacement = dot(p_detect − p_oldest, forwardVector) > hakkeiMinForwardDisplacement`
   （`p_oldest` = 過去 `hakkeiWindowMs` 内の最古 valid sample の `handPosition`）
5. 直近 `hakkeiCooldownMs` 以内に検出済みでない（cooldown）

### HakkeiScore（SPEC §14.3 / 検出時、過去 `hakkeiWindowMs` の valid window から。未来sampleは待たない）
- `hakkeiVelocityPeak` = window 内 `forwardVelocity` の最大
- `hakkeiAccelerationPeak` = window 内 `forwardAcceleration` の最大（負は 0 clamp）
- `hakkeiDisplacement` = 上記#4 の `forwardDisplacement`（0未満は 0 clamp）
- これらを既存 `buildScoreBreakdown` / `computeHakkeiScore` に渡す（重み・正規化レンジは現状のまま）。

## 実装方針（詳細設計は裁量。下記の不変条件を満たすこと）
- `HakkeiDetector` を複合化:
  - 構築引数を `{ minForwardVelocity, minForwardAcceleration, minForwardDisplacement, windowMs, cooldownMs }` へ拡張。
  - 内部に過去 `windowMs` の valid sample リングを保持（`timestampMs`, `forwardPos=dot(handPosition,forwardVector)`, `forwardVelocity`, `forwardAcceleration`）。`timestampMs` で古いものを破棄。
  - `forwardVector` は sample 毎に渡す（例 `observe(sample, forwardVector)`）か HakkeiReady 開始時に確定保持。
  - 例: `observe()` が `{ detected, forwardVelocityPeak, forwardAccelerationPeak, forwardDisplacement }` を返す。
  - `reset()` で window と lastFire をクリア。
- `app.ts` `HakkeiReady`: `accumulateHakkei` + `detector.detect` を `observe` ベースへ置換。`detected` なら window 値を `ScoreRawInput`（`store.play` 経由でも可）へ反映し `finalizeScore(true,false)` → `dispatch("hakkeiDetected")`。
- `playAccumulator.ts`: z軸ピーク（`hakkeiVelPeak/AccelPeak/hakkeiZMin/Max/hakkeiZSeen`）を forward 射影 windowed 値へ置換 or 撤去。`finalizeScore`（app.ts L134-144）の `hakkeiDisplacement = zMax−zMin` 暫定計算も window 値へ置換。
- detector 構築 **2箇所**（app.ts L577, L811）を新シグネチャへ更新。
- **速度/加速度/filter は Main 生成値の射影のみ。Renderer で再計算しない（AGENTS §6）。**

## 不変ルール（厳守 / 破ったら不可）
- **キーボード fallback 厳守（最重要・Gate D2・CLAUDE.md 不変ルール）**:
  Enter の疑似発勁（`keyboardSampleGenerator`）が複合条件（`forwardVelocity>1.2`, `forwardAcceleration>8.0`, `forwardDisplacement>0.08`, `defaultForwardVector` 上）を満たして**従来通り発火**することを必ず確認。満たさなければ疑似sample生成側を調整して維持する（「Enter は通常 Hakkei 判定を通る」= SPEC §0.16 / P1-17）。Space連打チャージ＋Enter発射の予備経路は壊さない。
- 閾値・係数の**ハードコード禁止**。すべて `config/score.config.json` 由来のまま。
- TS 3規約: 型のみ import は `import type`、`constructor(private x)`/`enum` 禁止（フィールド宣言＋本体代入）、相対 import は `.ts` 拡張子必須。
- 未確定点は推測で埋めず `TODO:` を残し、**agmsg で claude に質問**してから進める（AGENTS §1）。

## テスト（`test/` 配下・`node --test`）
- 既存 hakkei/score 関連テストを forward 射影・windowed 意味へ更新。
- **M11-10**: 10秒相当の静止 valid sample で発火0（誤検出なし）。
- **M11-11**: 横振り（`forwardVector` 直交方向の動き）で forward 条件不足 → 発火しない。
- 各条件**単独不足**で発火しない（velocityのみ / accelのみ / dispのみ満たすケース）。
- window 境界（`windowMs` 外の古い sample が peak/displacement に混ざらない）。
- keyboard Enter 疑似発勁が複合条件で発火する回帰テスト。
- 既存 **86件は緑のまま**、新規追加。

## 検証コマンド（全部緑にする）
```
npm run typecheck && npm run lint && npm test && npm run build
```

## 進め方
- commit / push は**しない**（指示があるまで作業ツリーのみ）。
- 完了したら agmsg（Git Bash 経由テンプレート）で `claude` に報告: 変更ファイル / テスト結果(pass数) / 設計判断 / 残TODO。
