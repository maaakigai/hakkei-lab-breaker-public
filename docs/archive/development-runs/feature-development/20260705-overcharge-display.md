# 20260705 overcharge display

- 対象ステップ: Charge HUD のオーバーチャージ表示復活。
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `test/punch-core.test.mjs`, `docs/CURRENT_USAGE_JA.md`, `docs/verification_checklist_v2_ble.md`。
- 採用: `chargeRaw` の実値から算出した `%` は100%を超えて表示する。ゲージ塗り幅はHUD枠内に収めるため100%で止め、100%超では `is-overcharge` 表示と `オーバーチャージ` 文言だけを出す。
- 理由・根拠: 現行RendererはMain生成 `PunchInputSample.chargeDelta` を積算しており、蓄積値自体は上限で止めていない。今回の要件は「表示だけで効果はまだ変えない」なので、`buildPunchScoreBreakdown` の `clamp01(chargeRaw / chargeMax)` は維持し、スコア・動画Lvへの効果は100%相当で固定する。
- 確認結果: `buildPunchScoreBreakdown` にオーバーチャージ入力を入れても、100%入力と同じ `rightChargeScore` / `power` / `videoLevel` になるテストを追加。
- 手動確認: `npm run dev:debug` → Keyboard → ChargeでSpaceを100%超まで連打し、発勁エネルギーが100%超表示になり、文言が `オーバーチャージ` になることを見る。その後EnterでResultへ進み、チャージ効果が100%相当から増えていないことを見る。
- 残課題: オーバーチャージの実効果、減衰、上限、演出強化は未実装。

追記:
- 採用: `オーバーチャージ` 文言は赤色固定にし、超過量20%ごとの `overcharge-tier-1..5` でゲージ全体の赤いoverlay opacityと発光を段階的に強める。
- 理由・根拠: CSP対応済みHUDなのでinline styleで動的opacityを渡さず、Rendererが算出した段階classをCSSで表現する。効果はまだ変えないため、変更対象はHUD classとCSSだけに閉じる。

追記2:
- 採用: overlayだけでは既存グラデーションとフレーム発光に負けて赤化が見えにくいため、`overcharge-tier` ごとに `.hakkei-gauge-fill-rect` の `fill` 自体を赤系へ直接切り替える。
- 確認観点: 100%超過時にゲージ塗りが橙赤へ変わり、超過量が増えるほど赤が濃くなることを見る。

追記3:
- 採用: 段階的な `fill` 切り替えをやめ、100〜200%の超過率からSVGグラデーション3点の色を連続補間する。
- 理由: 20%刻みのclass切り替えでは見た目がカクつくため。CSSのfilter段階は補助発光だけに残し、ゲージ本体色はsample更新ごとに滑らかに赤へ寄せる。

追記4:
- 採用: 100%超過でヒビ1本、以後10%ごとに1本ずつ増やす。表示上限は14本。
- 理由: 要件の「100越えた瞬間」「以降10%おき」をそのままHUD表示へ写す。上限なしで増やすとゲージが線で潰れるため、演出密度の上限だけ設ける。ヒビ本数が増えた時だけ `is-crack-impact` を付け、毎sampleのHUD再描画で割れ演出が連続発火しないようにする。

追記5:
- 採用: CSS線のヒビを廃止し、AI生成したガラスひび割れPNGを `assets/images/hud/hakkei-gauge-cracks.png` として保存。125%で最初の断片を表示し、以降25%ごとにPNGの別領域をクリップして追加表示する。
- 理由: ユーザー指定の「ガラスのひび割れっぽい画像を透過素材で作って貼り付ける」方向へ合わせるため。スコア効果は引き続き変更せず、HUD表示だけに閉じる。
- 素材生成: built-in imagegenで #00ff00 クロマキー背景の横長ひび割れ画像を生成し、`remove_chroma_key.py` で透過PNG化。alpha channelあり、四隅alpha=0を確認。

追記6:
- 採用: ひび割れ本数が増えた瞬間だけ `SFX/Crack1.mp3` / `SFX/Crack2.mp3` をランダムに単発再生する。音量は既存の `app.audio.chargeSound.volume` を流用する。
- 理由: 今回は「ヒビが入るとき鳴らす」要件であり、音量設定契約を増やす必要はまだない。既存のチャージ系SE音量に追従させることでSettings GUI変更なしで会場音量調整に乗せられる。

追記7:
- 採用: 陽炎案は採用せず、100%超過時の `overcharge-tier-1..5` に応じてゲージ全体を平行移動だけで振動させる。tierが上がるほど移動量を増やし、animation durationを短くする。
- 理由: 透明な揺らぎは実機画面で認識しづらかったため、フレームごとの振動として明確に見える演出へ切り替える。スコア効果は変えず、CSS classに閉じる。
- 確認結果: `npm run typecheck` 成功。

追記8:
- 採用: 振動が右斜め上へ偏って見えたため、keyframesを細かくし、上下左右へ不規則に散らす平行移動へ調整した。回転は引き続き使わない。
- 理由: 規則的な往復だと特定方向の移動に見えるため、各frameの符号と倍率を散らしてランダム感を出す。
- 確認結果: `npm run typecheck` 成功。
