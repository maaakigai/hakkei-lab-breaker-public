# M15-09 実行手順書（RUNBOOK）— 再現可能な閾値チューニング

目的: **主観でなく数値で**、単手モデル（§0.23）の検出閾値を決める。
方法論の根拠は [docs/M15-09-experiment.md](M15-09-experiment.md)。本書は**手を動かす順番**だけを書く。

前提: 実機 mocopi 一式＋Unity Bridge（このデスクトップは実機あり）。コードは緑（typecheck/lint/test/build）。

---

## 0. 用語
- **trial（試行）**: 1回の動作（例: 前突き1回、10秒静止1本）。意図ラベルを付ける。
- **recording（記録）**: 連続 MotionSample ＋ trial 境界 ＋ calibration ＋ config snapshot の JSON。
- **sweep（掃引）**: 記録を本番コードで再生し、config を変えて指標を出し、制約を満たす候補を選ぶ。

---

## 1. 記録する（実機・人の作業）

### 1.1 起動
1. mocopi PC アプリ → Unity（`unity-bridge/`, 6000.0.77f1, `UnityBridge.unity`）を Play。
2. `npm run dev` → Title で **Unity Bridge** を選択 → **開始** → InputCheck。
3. InputCheck で受信 OK（Hz・座標が動く）を確認。
4. **利き手**を決める: 画面の `H` キーで右/左をトグル（記録パネルに「利き手=右/左」が出る）。本番の操作担当の利き手に合わせる。
5. （任意・推奨）先に1回 Calibration を通して forward/up を確定させると、記録の calibration が実測になる。
   Calibration まで進めたら InputCheck へ戻る（Esc → 再度 開始 → InputCheck）。

### 1.2 SHA を控える（再現性）
記録前に現在のコミットを記録: `git rev-parse HEAD` の値をメモ（記録 JSON の `commitSha` は "unknown" で出るため手で控える）。

### 1.3 trial を録る（InputCheck の「記録(M15-09)」パネル）
操作はパネルのボタンだけ:
- **ラベルボタン**（forward/down/up/back/weak-forward/static/sideways/diagonal-*/non-dominant-hand/small-fast-jitter）を押す → その瞬間に**前の試行が確定**し、**新しい試行が始まる**（自動で記録開始）。
- 1動作したら、次のラベルを押す（＝前試行を閉じて次へ）。同じ動作を続けるなら同じラベルを押し直す。
- フォームが崩れた試行は **「bad-formで終了」** で閉じる（集計から自動除外される）。
- 最後に **「この試行を終了(valid)」** で閉じる。

**録る量（最低構成・docs 準拠）**: forward×20 / down×20 / up×20 / back×20 / weak-forward×20 / static-10s×3 /
sideways×10 / diagonal-forward-up×10 / diagonal-forward-down×10 / non-dominant-hand×10 / small-fast-jitter×10。

**やり方の注意（妥当性）**:
- ラベルの順番は**固定しない**（forward 20連続などにしない）。数種をブロックでランダムに混ぜ、ブロック毎に休憩。
- `static` は10秒じっと。`non-dominant-hand` は**利き手でない方**で突く（利き手は H 設定のまま）。
- `weak-forward` は「弱くだらっと前」。`sideways` は真横払い。`diagonal-*` は前斜め上/下。
- **発勁したらすぐ次の label か「終了」を押す**（trial を長く開けっぱなしにすると二度撃ち/誤発火が混ざる）。
- **記録パネルの calibration 表示が「実測」**であることを確認（「未実測（default 軸）」警告が出ていたら、先に1回 Calibration を通す）。default 軸の記録は方向評価の正当性が落ちる。

### 1.4 書き出し
- **「JSON書き出し」** を押す → `recording-<timestamp>.json` がダウンロードされる。
- これを **session A（tune用）** とする。
- **別日 or 休憩後にもう1セット**録って **session B（holdout用）** にする（過学習チェック）。

---

## 2. 閾値を決める（オフライン・PCだけ・主観なし）

### 2.1 sweep を回す
```bash
# tune（A）だけで候補を見る
npm run sweep -- --tune path/to/recording-A.json --top 10

# holdout（B）で検証まで（推奨）
npm run sweep -- --tune path/to/recording-A.json --holdout path/to/recording-B.json --out sweep-out.json
```
複数ファイルを tune にしたいときは `--tune a.json --tune b.json` と繰り返す（**各記録を個別に評価して集約**するので timestamp は衝突しない）。
JSON が PowerShell 由来で **BOM 付き**でも読める（loader が除去）。

冒頭に出る診断:
- **ラベル別 valid trial 数**: 各ラベルが十分録れているか（10 未満は警告＝recall 不安定）。
- **自動 review フラグ**: ラベルと実方向の矛盾 / valid 比 < 0.95 / 品質 flag を持つ trial 数。多いなら記録を見直す。
- **hiddenChargeGate 警告**: 全 trial chargeRaw=0 なら gate は識別不能として 0 固定で掃引（§4 の制限）。

### 2.2 出力の読み方
- `feasible`: **安全制約を全て満たした** config 数。0 なら制約が厳しすぎるか記録が不足。
- 上位候補: 制約OKの中で **forwardRecall 最大 → latency 最小** の順。
- **Pareto 候補**: 支配されない数点。ここから「演出感」など宣言済みの主観で1つ選んでよい（※下記）。
- **holdout metrics**: tune で選んだ best を別セッションに当てた結果。ここでも制約OKなら過学習していない。

### 2.3 安全制約（`scripts/sweep.mjs` の `CONSTRAINTS`・docs 受入基準）
- static 誤発火 = 0
- forward→hidden = 0
- double fire = 0
- weak-forward の forward 発火率 ≤ 0.1
- down/up/back recall 各 ≥ 0.7
制約は本書の方針なので、変えるときは docs/M15-09-experiment.md の受入基準と一緒に更新する。

### 2.4 採用
- holdout でも制約を満たす候補の config 値を `config/score.config.json` に反映:
  `forwardCos` / `dirCos` / `hiddenChargeGate` / `hakkeiMinForwardVelocity` / `...Acceleration` / `...Displacement`。
- 反映後 `npm run typecheck && npm test`（appConfig バリデーションも通ること）。
- 反映の根拠（採用 config・holdout 指標・記録ファイル名・SHA）を `docs/runs/` に1本残す。

---

## 3. 主観が入る箇所（宣言済み・docs）
- 意図ラベルの正しさ／フォーム有効性（`bad-form` 除外）／forward と diagonal の境界の置き方／
  hidden の狙いやすさ（Pareto からの最終選択）／weak をどこまで no-impact にするか。
- → これらは「先に宣言し、数値（混同行列・recall・誤発火）で再現できる判断に落とす」。なくすのではなく場所を限定する。

---

## 4. 既知の制限（今イテレーション）
- **chargeRaw=0 で記録**している（InputCheck にはチャージ局面がないため）。そのため `hiddenChargeGate` の掃引は
  「0 近傍」しか実データで効かない。gate を本格的に詰めるには、charge 局面込みの記録（将来拡張）か、
  in-game フローでの観察が要る。当面 `hiddenChargeGate=0.0` を baseline とし、正値候補は人工 charge で感度だけ確認。
- **idle** は `app.config.json` の `idleEnabled=false` で dormant。idle を検証するときは `idleEnabled=true`＋
  `hakkeiReadyTimeoutMs >= idleEventMs+grace`（バリデーション強制）にしてから、別途 in-game で確認。
- **利き手決定の精度**（dominantHandDecisionAccuracy）は本 sweep の対象外（別 harness）。
- 記録の `commitSha` は "unknown"。1.2 で手控えした SHA を docs/runs に残す。

---

## 5. パイプライン動作確認（実機なしのスモーク）
実機の前に配線だけ確認したいとき:
```bash
npm run make:recording > rec-synth.json   # 人工データ（閾値決定には使わない）
npm run sweep -- --tune rec-synth.json --top 3
```
feasible 候補と Pareto が出れば配線OK（人工データなので指標は満点になる）。
