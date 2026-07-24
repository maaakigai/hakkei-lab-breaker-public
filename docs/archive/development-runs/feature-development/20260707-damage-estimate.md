# 2026-07-07 損害見積書システム（研究室 破損見積書）

## 目的・要件
損害額を「Power依存・非線形・ランク/Lv補正＋少しの乱数」で出し、Result を **研究室 破損見積書**（品目×金額・Σ＝合計）にする。動画18本の実測破壊度と対象研究室の高単価備品を突き合わせてリアリティのある額に較正（`docs/damage-estimate-candidates.md`）。

## ユーザー確定
- LV2 の額は **動画忠実（A・粉塵のみ≈¥15万）**。「本格破壊はLv2から」より実測優先。
- Critical は **同じ見積書体裁＋企業ビル用バスケット**。
- 消費税/端数行は **出さない（合計のみ）**。私物（バッグ）は出さない。

## 設計・実装
- 新規 `src/renderer/damageEstimate.ts`（純ロジック・決定的）:
  - `damageYenFromPower(power, score.power)` … `power.damageAnchors` の区分線形補間＋`damageVarianceRatio`（seed量子化の±乱数）。旧 `Math.round(power×yenCoefficient)` を置換。
  - `buildDamageEstimate(total, level, rank, report)` … 最低Lvを満たす品目へ按分。高単価優先の並び＋water-fill＋top-upで既存行に寄せ、末尾「調整行」で端数吸収 → **Σ＝total** を厳密保証。
  - `buildCriticalEstimate(baseYen, criticalItems, labInclusiveLabel)` … 企業ビル行＋研究室全損一式＝合計。
- アンカー（**現実性検証で改訂・下記追記**）: `0→0 /40k→0 /50k→¥5万 /150k→¥50万 /300k→¥200万 /600k→¥700万 /780k→¥3,000万`。Lv1≈¥0・Lv5全損≈¥1,850万（上端¥3,000万）。**億は Critical のみ**。
- `config/score.config.json`: `power.damageAnchors`/`damageVarianceRatio` 追加。`resultDamageReport` を `{maxLinesByLevel, reserveRatio, reconcileLabel(High), reconcileHighLevel, criticalLabInclusiveLabel, items[{label,unit,unitPriceMin,unitPriceMax,minLevel,maxCount,weight}]}` へ刷新（品目マスタ≈29件・対象研究室の高単価備品）。
- 型/検証: `configTypes.ts`（`DamageAnchorConfig`・`ResultDamageReportItemConfig` 刷新・power拡張）、`appConfig.ts`（アンカー昇順/範囲・見積書スキーマ検証）。
- 表示: `resultPresenter.ts` を見積書へ書換（`.est-line` 3カラム：品目/×N単位/¥金額。`est-building`＝Critical企業ビル赤、`est-reconcile`＝調整行控えめ）。`styles.css` 追加。**inline style は不使用**（CSPは class ベースのみ）。
- 配線: `punchCore.ts` / `scoreCalculator.ts` / `app.ts`(makeLevelFixture/makeCriticalFixture) の damageYen をアンカー補間へ。
- scripts/windows/Settings.bat（`settings.ts`）: 見積書アイテム表を新列（単価下限/上限/最低Lv/上限/出やすさ）へ。`power.damageVarianceRatio` ノブ追加、`yenCoefficient` は「現在未使用」注記。

## 検証
- typecheck / lint / build 緑。テスト **239件緑**（新規 `test/damage-estimate.test.mjs` 9件＝アンカー単調/上限頭打ち・Σ＝total・minLevelフィルタ・決定性・Critical合計。既存の damageYen 期待値を新契約へ書換）。
- 実 Electron capturePage（本番CSP `style-src 'self'`）で Lv3/Lv4/Lv5/Critical を描画確認 → **NO_CSP_VIOLATIONS**、3カラム見積書・企業ビル赤行・調整行が正しく表示。

## 追記（2026-07-07 現実性検証で損害ラダー改訂）
ユーザー提示の保守的ラダーの是非を、独立サブエージェント4体（資産価値査定/原状回復実務/大学調達の現実/現場研究者の肌感）で検証。全員一致で **初版の Lv4=¥4,000万・Lv5=¥1.2億 は対象研究室の「1部屋」として過大**（億は1フロア/GPUクラスタ/建物躯体の領域）。1部屋全損の現実は **¥1,500〜3,000万**。ユーザー選択で **忠実版（Lv4≤¥700万 / Lv5≤¥3,000万）** に確定。
- `damageAnchors` を上記へ改訂。`damageYenFromPower` は最終アンカー(¥3,000万×1.07)で頭打ち。
- 品目「研究室スラブ・壁構造復旧費（¥2,000〜6,000万・minLevel5）」を**削除**（躯体無事なら過大/二重計上）。「内装・天井・床 原状回復（全面）¥300〜900万」を追加。
- 検算（忠実版）: Lv2≈¥27.5万 / Lv3≈¥125万 / Lv4≈¥450万 / Lv5≈¥1,850万。全Lvで調整行 8〜13%＝良好な品目化。テスト较正を新レンジへ更新（239件緑）。
- 割り切り: 億・兆の派手さは **Critical（企業ビル）** が担当。通常Lvはリアルな見積書に振る住み分け。
