# 20260707 損害見積書のリアリティ調整（5桁級を多数壊す2パス配分）

## 背景 / 課題
リザルトの破損見積書が「高価な品が1つずつ壊れている」表示になり、動画の破壊描写（モニタ等が多数壊れる）とズレてリアリティが無かった。要望: 5桁円クラス（1〜9万円）の壊れた個数を増やし、動画に近い現実的な内訳にする。

## 動画内容の確認（サブエージェント解析）
`assets/videos/LV1〜LV5` の代表動画から start/mid/end フレームを ffmpeg 抽出し、サブエージェントで内容をカタログ化。要点:
- 全レベルとも**同一の室内オープンラボ**。外窓は無い（インテリア）。
- 目安在庫: モニタ ~13、机 ~6、椅子 ~6-8、小型機材多数、金属ラック 4-5、ドロップ天井（蛍光灯+吸音パネル）。
- 破壊数の跳ね上がりは **LV3→LV4**（数点→数十点、家具が「移動」から「破壊」へ）と **LV4→LV5**（全損＋天井/壁の構造被害）。
- LV別の現実的な破壊数の目安を取得（モニタ LV2:2-3 / LV3:4-5 / LV4:8-10 / LV5:12-14 等）。

## 実装
損害総額（power→アンカー補間）を品目へ按分する `buildDamageEstimate` を **2パス方式**へ変更（`src/renderer/damageEstimate.ts`）:
1. **ワークホース品**（`unitPriceMax <= workhorsePriceCeiling`＝5桁級）を `seededOrderByWeight`（出やすさ優先・単価は使わない）で先に並べ、`workhorseBudgetShareByLevel` 分の予算を等分して数量化。→ モニタ/机/椅子/センサ等が多数壊れて主役になる。
2. **高額品**（ceiling超）を `seededOrderByPrice`（高単価優先）で `bigTicketLinesByLevel` 行だけ置き、残予算を少数行で吸収（調整行の肥大化を防止）。
3. top-up は高単価行から埋め、最後に調整行で端数吸収（Σ=総額は不変）。

旧実装は「単価×weight 降順」で高額品を先頭に置いていたため、限られた行を高額品が各×1で占有し、5桁品が押し出されていた（＝課題の原因）。

## config 変更（`config/score.config.json` の `resultDamageReport`）
- 追加: `workhorsePriceCeiling=120000`, `workhorseBudgetShareByLevel=[1,1,0.85,0.55,0.4,0.3]`, `bigTicketLinesByLevel=[0,0,1,2,3,5]`
- `maxLinesByLevel` を `[3,3,4,6,8,10]`→`[3,3,5,7,9,12]`（品目バリエーション増）
- items の weight/maxCount を動画準拠に再調整（5桁級=高weight・大maxCount、高額品=低weight）
- 外窓が無いため「Window glass」→「Fluorescent light fixture」に差し替え（動画のドロップ天井照明）

## 結果（代表値）
- LV3(¥1.3M): Dellモニタ×3 / センサ×7 / 椅子×7 / Toshibaモニタ×6 / MacBook Air×2 / …
- LV4(¥4.5M): 机×8 / モニタ×7 / 椅子×10 / ラック×8 / センサ×13 ＋ ワークステーション少数
- LV5(¥18M): モニタ×14/×10 / センサ×30 / 机×8 / ラック×8 / 天井×多数 ＋ 構造復旧・高額機材

## 検証
`npm run typecheck && lint && test(264) && build` 緑。回帰テスト追加（`test/damage-estimate.test.mjs`）:「Lv3/4/5 で 5桁級が count>=2 の行として複数登場」「Σ=総額」。
