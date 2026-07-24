# 2026-07-06 チャージ/スコア再設計（UI線形 × スコア飽和曲線）

## 背景・要件
実測で本気10秒チャージが chargeRaw ≈9000 に達する一方、旧設計は `chargeReadyThreshold=2000`（表示100%）/ `chargeMax=3000`（スコアA=1）で、本気の1/3でA=1に張り付き＝誰でも高ランクの懸念。UI表示%とスコア計算を明確に分離したい。

## 決定（ユーザー確定）
- **表示100%基準 `chargeReadyThreshold` = 7500**（本気9000 = 120%表示）。UI%は線形・上限なし（従来どおり数字は clamp しない）。scripts/windows/Settings.bat で可変。
- **スコア用チャージ補正 A を割合(f)基準のロジスティック飽和曲線に置換**:
  `A = clamp01( 1/(1+exp(−(f − chargeScoreMid)/chargeScoreWidth)) )`, `f = chargeRaw / chargeReadyThreshold`。
  既定 `chargeScoreMid=0.60`, `chargeScoreWidth=0.133`（寛容め較正）。
  割合基準なので keyboard（基準10）と BLE（基準7500）が**同一カーブを共有**＝キーボード予備入力が壊れない（不変ルール順守）。
- **ランク閾値は据え置き**（S≥600000 等）。`selectRank(power)` のシグネチャも不変（シンプル案）。
- `chargeMax` / `chargeMaxKeyboard` は**スコアから引退**（config には後方互換で残置・未使用）。
- 演出（tier/crack/色）は 100〜150% を演出フル域に再アンカー（別変更）。

## 較正の帰結（本気=1540 / 中=1100 / 弱=700 deg/s 想定）
- 100%(7500)+本気 = 656k → **S**（寛容め）／80%+本気 = 525k → A／低チャージ本気は上位不可。
- **弱パンチは最高C**（S/A不可）、**中パンチは最高A**（S不可）＝チャージとパンチ両方が効く。
- 100%到達だけではA確定しない（100%+弱=C）、120%到達だけではS確定しない（120%+弱=C）。
- オーバーチャージは 100→120→150→300% で 656k→694k→704k→706k と**飽和**（上限=powerK=780000 で有限頭打ち）。

## 契約反転（重要）
旧契約「**オーバーチャージは表示だけ・スコア効果は100%相当で固定**」（`A=clamp01(chargeRaw/chargeMax)`）を**破棄**。新契約は「**100%超も飽和曲線で緩やかに効果が増え、やがて powerK 天井に漸近**」。`test/punch-core.test.mjs` の該当テスト（アンカー表 / 「表示だけで効果を増やさない」/ chargeMaxOverride）を新契約へ書換済み。

## 変更ファイル
- `src/renderer/punchCore.ts`（A算出＝ロジスティック、第3引数 `chargeMaxOverride`→`chargeReadyOverride`）
- `src/shared/configTypes.ts`（`chargeScoreMid`/`chargeScoreWidth` 追加、`chargeMax` を非推奨コメント化）
- `src/main/appConfig.ts`（新キー検証・width>0）
- `config/score.config.json`（`chargeReadyThreshold=7500`、新キー追加）
- `src/renderer/app.ts`（`currentChargeMax` 廃止 → `currentChargeReady` に統一）
- `test/punch-core.test.mjs`（3テスト書換）
- 演出再アンカー: `src/renderer/app.ts` の `overchargeTier`(/10)・`overchargeCrackCount`(100%開始/6.25%刻み)・`overchargeLevel`(/50)

## 残作業
- scripts/windows/Settings.bat 画面に「表示100%基準」「スコア中点(f)」「曲線の効き(width)」を露出＋旧ラベル修正。
- デバッグ隠しコマンド（S/A/Critical/Result 注入・実スコア経路）。
- 損害額を「破損見積書」化（枠組み先行・品目リストは後日）。
- keyboard の Space 連打が実際に何%まで届くかの実測較正（`chargeReadyThresholdKeyboard`）。
