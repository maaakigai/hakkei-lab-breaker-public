# 20260705 charge sound

- 対象ステップ: チャージゲージ連動音の追加
- 変更ファイル: `config/app.config.json`, `src/shared/configTypes.ts`, `src/main/appConfig.ts`, `src/renderer/app.ts`, `src/renderer/settings.ts`, `test/config-loader.test.mjs`, `test/audio-manager.test.mjs`, `HUMAN_TEST_GUIDE_JA.md`
- 採用: `app.config.audio.chargeSound.file="SFX/charge0to100.wav"` を追加し、Charge中に `chargeRaw` が0から正の値へ変わった瞬間にloop再生する。`VideoPlayback` のmount直前、またはreset/replay/finish/escで停止する。Settings GUIでは `チャージ音` の音量も編集できる。
- 理由・根拠: タメ量はRendererで再計算せずMain生成 `PunchInputSample.chargeDelta` の積算結果 `chargeRaw` を使う既存契約に従う。Lv動画開始まで鳴らす要件は、既存状態を増やさず `VideoPlayback` mountを音声停止境界にするのが最小変更。
- 確認結果: `npm run typecheck` PASS。`npm test` は音量設定がGUIで変更可能になったため固定値期待を範囲検証へ修正後PASS（229 tests、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`npm run build` PASS。`npm run lint` PASS。`dist/renderer/sounds/SFX/charge0to100.wav` へのコピーを確認。
- 残課題: `charge0to100.wav` とBGMの音量バランスは会場スピーカーで手動調整する。

## 追記: チャージ音量上限

- 採用: `app.config.audio.chargeSound.volume` だけ上限を10に広げ、現在値を5にした。Settings GUIのチャージ音入力も0〜10にし、WebAudio gainのclampもチャージ音再生時だけ10まで許可する。
- 理由・根拠: 通常BGMとCritical BGMまで10倍を許すと常時音量が過大になりやすい一方、チャージ音は短い演出音で「まだ小さい」調整対象が明確なため、既存のBGM上限0〜3は維持してチャージ音だけ拡張する。
- 確認結果: `npm run typecheck` 成功。`node --test test/config-loader.test.mjs test/audio-manager.test.mjs` 成功（12 tests pass、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。

## 追記: 100%超過チャージ音

- 採用: `app.config.audio.overchargeSound.file="SFX/charge100over.wav"` を追加し、Charge中に `chargeRaw` が `currentChargeReady()` を超えた瞬間、再生中の `charge0to100.wav` を止めて `charge100over.wav` のloopへ切り替える。
- 理由・根拠: 100%判定はRendererで新しいスコア計算をせず、既存のMain生成 `PunchInputSample.chargeDelta` の積算値 `chargeRaw` と、source別しきい値 `currentChargeReady()` の比較だけで行う。音声pathと音量はconfig契約に入れ、コード内固定を避ける。
- 確認結果: `npm run typecheck` 成功。`node --test test/config-loader.test.mjs test/audio-manager.test.mjs` 成功（12 tests pass、既存の MODULE_TYPELESS_PACKAGE_JSON warning のみ）。`assets/Sound/SFX/charge100over.wav` の存在を確認。

## 追記: オーバーチャージ音量GUI

- 採用: Settings GUIのBGM音量セクションに `audio.overchargeSound.volume` を個別項目として追加した。範囲はチャージ音と同じ0〜10。
- 理由・根拠: 100%未満のチャージ音と100%超過音は再生タイミングも音源も別なので、現場で音量バランスを別々に調整できる方が確認しやすい。
- 確認結果: `npm run typecheck` 成功。
