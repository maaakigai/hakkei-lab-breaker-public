# 20260623 V-1 是正 — score/hakkei の validForScore ガード

## 対象ステップ
規約監査で検出した契約違反 **V-1** の是正（M3/M8 の score 取り込み経路）。
SPEC §0.16 / UNRESOLVED_ISSUES_CURRENT P0-11 の「score・発勁判定は `validForScore===true` の sample だけを使う」契約への適合。

## 指摘内容（是正前）
`src/renderer/app.ts` の `onSample`（VerticalCharge / ForwardCharge / HakkeiReady）が、
チャージ／発勁ピーク集計を `validForScore`（`isAvailable` すら）でガードせず、**全 sample を無条件で
score raw 入力に取り込んでいた**。`hakkeiDetector.detect()` だけが内部で `validForScore` を見ていたが、
その手前の `hakkeiVelPeak` / `hakkeiAccelPeak` / `hakkeiZMin/Max` 集計が素通りしていた。
→ `DT_TOO_SMALL` / `OUTLIER_*` 付き sample が威力計算（velocity/accel/変位ピーク）を汚染し得る。

## 変更ファイル
- 追加 `src/renderer/playAccumulator.ts`: `PlayRaw` 型・`freshPlay()`・`accumulatePlaySample()` を
  純粋関数として分離。`validForScore=false` の sample は play を変更せず `false` を返す。
- 変更 `src/renderer/app.ts`: ローカルの `PlayRaw`/`freshPlay` を削除し新モジュールから import。
  `onSample` の各 charge ケースを `accumulatePlaySample()` 呼び出しへ置換。HakkeiReady は
  取り込み成功（戻り値 true）時のみ `detector.detect()` を呼ぶようにした。
- 追加 `test/play-accumulator.test.mjs`: valid 取り込み・invalid 無視・ピーク集計・混在時の4ケース。
- 更新 `MILESTONES.md`: 自動テスト件数 71 → 75。

## 採用した判断と理由
- **DOM を持つ app.ts から純粋ロジックを分離**したのは、AGENTS §10/DoD の「該当する自動テスト」を
  満たすため。app.ts は preload `window.hakkei` をモジュール読込時に参照し node test で import 不可のため、
  集計ロジックを独立モジュールに出して単体テスト可能にした。
- **ガードは「sample を捨てる」方式**（play を更新しない）。SPEC §0.16 は無効 sample を score/hakkei に
  使わないと規定しており、clamp ではなく除外が契約に合致（P0-12 の整理とも整合）。
- velocity/acceleration は **Main 生成値をそのまま使用**しており、Renderer 側で速度・加速度・filter を
  再計算していない（AGENTS §6 準拠は維持）。

## 確認結果
- `npm run typecheck` / `npm run lint` / `npm run build` すべて緑。
- `npm test` 75 pass / 0 fail（V-1 是正テスト4件を含む。既存71件は不変）。

## 残課題（次工程へ送る）
- **C-1 / M11**: チャージは依然「ピーク速度」の M3 暫定。SPEC §14.1/14.2 の変位積分（upVector/forwardVector
  射影の絶対値積算）への置換は M11。`playAccumulator.ts` 冒頭に TODO(M11) として明記済み。
- **HakkeiScore の評価窓（P1-20）**: 現状 HakkeiReady 滞在中の全ピーク累積。`hakkeiWindowMs` 窓制御は未実装。
- **defaultInputMode 未配線（中・別件）**: `config/app.config.json` に値はあるが `app.ts` 初期値が
  ハードコード `"keyboard"`、`validateApp` も未検証。SPEC §0.13/§18.1 適合は別ステップ。
- 本筋は M9（Unity Bridge 実機）→ M10。本是正は M11 置換まで有効な契約適合として独立に成立。
