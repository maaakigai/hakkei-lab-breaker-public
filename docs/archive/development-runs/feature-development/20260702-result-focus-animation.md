# 20260702 Result focus animation

## 対象ステップ

M12 UI・演出調整 / Result主表示アニメーション

## 変更ファイル

- `src/renderer/resultPresenter.ts`
- `src/renderer/styles.css`
- `docs/verification_checklist_v2_ble.md`
- `docs/runs/20260702-result-focus-animation.md`

## 採用した判断

- Resultの主表示として、損害額とランクを表示する `result-focus` セクションをtableの上に追加した。
- アニメーションはCSS `@keyframes resultFocusIn` で実装し、大きいscaleと強いblurから、blurを落としながら標準scaleへ収束させる。
- 「判を押す」方向の潰れ・バウンドではなく、焦点が合って確定する動きに寄せた。
- 既存のPower、動画レベル、発勁、内訳、rawのtableは下に残し、少し遅れてフェードインする。

## 理由・根拠

- 今回の要求はDOM要素の表示タイミングと見た目の変化で完結し、スコア計算や状態遷移を変える必要がないため、CSSアニメーションが最小で安全。
- 損害額とランクは体験者が最初に読むべきResult情報なので、table内の1行ではなく主表示として独立させる。
- 既存tableを残すことで、debug確認や運用時のPower/Lv/raw確認を失わない。

## 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS

## 手動確認

- `npm run dev:debug` を起動する。
- Titleのdebug menuから `Result Fixture`、またはLv強制通常フローでResultへ進む。
- Result入場時に、損害額とランクがぼけた大きい表示から焦点が合い、標準サイズへ収束して確定することを見る。
- 背景の最終フレーム上でも損害額とランクが読めることを見る。

## 残課題

- 実機BLEでの通しResult表示と、外部ディスプレイ距離での視認性確認は未実施。

## 追記: 損害額カウントアップとRank遅延表示

### 採用した判断

- 損害額はCSSではなく `requestAnimationFrame` で0円から最終値までカウントアップする。
- カウントアップ時間は約1180msとし、終盤で減速する `easeOutCubic` 相当の式を使う。
- Rankは損害額カウントアップ完了後に、既存のフォーカスインアニメーションで表示する。
- 詳細tableはRank表示の後にフェードインする。

### 理由・根拠

- 損害額はスコア計算結果に応じた実数値なので、CSSだけで正確なカウントアップを作るより、DOMのテキストをJavaScriptで更新する方が単純で確実。
- ユーザ要望は「数字がだーって増えて止まる」「その後にランク」なので、損害額とRankの登場タイミングを分ける必要がある。
- 状態遷移、スコア計算、動画保持には触らず、Result表示内の演出だけに閉じる。

### 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）

### 手動確認

- Result入場時、損害額が `¥ 0` から最終損害額まで増えることを見る。
- 損害額が止まった後、Rankがぼけた大きい表示から焦点が合うように入ることを見る。
- Power、動画レベル、発勁、内訳、rawの詳細tableがRank後に遅れて表示されることを見る。

## 追記: 通常Resultの被害報告化

### 採用した判断

- 通常UIでは詳細tableを表示せず、同じ位置に被害報告を5件表示する。
- Debug UIでは被害報告に加えて、従来のPower、動画レベル、発勁、内訳、rawの詳細tableを残す。
- 被害報告はResult表示専用の固定候補から選び、動画Lvと損害額に応じて個数を増やす。

### 理由・根拠

- 体験者向けのResultでは、Powerやrawより「何が壊れたか」の方が損害額のネタとして伝わりやすい。
- 詳細tableはデバッグ・調整時には必要なため、debug UIに限定して残す。
- 壊したものはスコア計算ではなく演出表示なので、既存のPower・damageYen計算へ混ぜない。

### 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）

### 手動確認

- リリースUIのResultで被害報告が5件出ることを見る。
- Debug UIのResultで被害報告と詳細tableの両方が出ることを見る。

## 追記: Ctrl+Enter 強制クリティカル

### 採用した判断

- Release UI / Debug UI 共通で、HakkeiReady中にCtrl+Enterを押すと強制クリティカル発勁として扱う。
- 強制クリティカルは通常の入力強度やチャージ量に関係なく、Rank S / Lv5 / S閾値以上のPowerへ固定する。
- Resultには `CRITICAL` ラベルを表示し、通常のSランクと区別できるようにする。
- スコア計算式は変更せず、ショートカット時だけResult用 `ScoreBreakdown` を作る。

### 理由・根拠

- デモ運用で確実にクリティカル演出を出せる必要があるため、debug専用メニューではなくreleaseでも使えるキーボードショートカットにする。
- 通常のBLE/keyboard入力計算へ混ぜるとスコア調整に影響するため、強制クリティカルは明示的なショートカット結果として分離する。
- HakkeiReady中の操作に限定することで、Title/InputCheckなどの準備画面で誤ってResultへ飛ぶ事故を避ける。

### 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）

### 手動確認

- Release UIでHakkeiReadyに入り、Ctrl+EnterでImpactDelay→Lv5動画→Resultへ進み、CRITICAL / Rank S / Lv5になることを見る。
- Debug UIでも同じ操作が効くことを見る。

## 追記: クリティカル専用被害JSON

### 採用した判断

- `config/critical.config.json` を追加し、クリティカル専用の被害内容を通常の被害報告候補から分離する。
- クリティカルoutcomeは `videoFile`、`weight`、`damageItems` を1セットにし、動画と被害データがずれないようにする。
- クリティカルoutcomeには任意で `labVideoFile` を持てる。未指定時は通常のLv5研究室破壊動画を先に再生し、その後 `videoFile` のクリティカル動画を再生する。
- デモ用の既定アウトカムとして、実在施設を対象にした追加映像を設定していた。
- 対応する映像・設定・金額は公開版から削除済み。
- Ctrl+Enter強制クリティカル時は、通常のLv5/S相当損害額に、選ばれたoutcomeの `damageItems[].bonusDamageYen` 合計を加算する。
- Resultの被害報告では、クリティカル専用項目を先頭に表示し、通常項目と合わせて5件にする。
- クリティカルoutcome選択は `weight` によるweighted randomとし、選ばれたoutcomeを動画再生からResultまで保持する。
- VideoPlayback状態は増やさず、Renderer内の再生キューで `研究室破壊動画 → クリティカル動画 → Result` を実現する。

### 理由・根拠

- クリティカル専用の破壊対象は今後増える可能性があるため、コード直書きではなくJSON設定に分離する。
- ボーナス損害は演出上の固定加算であり、通常のPower計算式やRank判定には混ぜない。
- 動画と被害データを別々にランダム選択すると表示と映像が不一致になるため、1つのoutcomeとして選ぶ。
- 状態を増やすとstateMachineや手動手順の変更範囲が広がるため、今回は既存のVideoPlayback内でキュー再生する。
- 被害報告の先頭へ出すことで、クリティカルで何が壊れたかをResultで即座に読める。

### 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）

### 手動確認

- 当時は強制操作で追加映像と追加損害表示を確認していた。いずれも公開版から削除済み。

## 追記: 被害報告の上限・ブレ・baseDamageYen

### 採用した判断

- `ScoreBreakdown` に `baseDamageYen` を追加し、通常スコア由来の損害額と、クリティカル固定ボーナス込みの最終損害額を分ける。
- Resultの通常被害報告は `damageYen` ではなく `baseDamageYen` を使って個数を計算する。
- 通常被害報告の候補、上限、損害額係数、ブレ率は `score.config.json` の `resultDamageReport.items` に置く。
- ブレは完全ランダムではなく、被害名・動画Lv・baseDamageYen・Rankから決まる疑似乱数にする。
- Ctrl+Enter強制クリティカルは、現在のチャージ量と最大パンチ強度で通常スコアを再計算し、S/Lv5最低値を下回る場合だけS/Lv5最低値へ丸める。そのうえでクリティカルoutcomeの固定ボーナスを加算する。

### 理由・根拠

- 600億円ボーナスを通常被害の個数計算へ混ぜると、モニターや窓ガラスの個数が数千件へ跳ねるため、演出上の固定加算と通常被害のスケールを分離する必要がある。
- 上限やブレ率は演出調整値なので、コードではなくconfigから変更できる方がデモ前の調整がしやすい。
- Resultを再描画しただけで個数が変わると確認しづらいため、同じスコアなら同じブレになる決定的な計算にした。
- 強制クリティカルの元値が6000万円だった理由は、以前の実装がS/Lv5最低Power `600000` に `yenCoefficient=100` を掛けた固定値を使っていたため。デモショートカットとしては成立するが、実入力相当の損害額確認には不向きだった。

### 確認結果

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm test`: PASS

### 手動確認

- Ctrl+Enter強制クリティカルResultで、損害額に本社ビルの600億円が加算されることを見る。
- 同じResultで、通常被害報告の個数が `score.config.json` の `resultDamageReport.items[].maxCount` を超えないことを見る。
- チャージ無しの強制クリティカルでは元値がS/Lv5最低値相当になり、チャージ後の強制クリティカルでは元値が通常スコア再計算に応じて上がることを見る。
