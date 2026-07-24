# SuperCritical damage SVG display

- 対象ステップ: SuperCritical Result金額演出
- 変更ファイル: `src/renderer/resultPresenter.ts`, `src/renderer/styles.css`, `src/renderer/app.ts`, `src/renderer/choyenCanvas.ts`, `HUMAN_TEST_GUIDE_JA.md`, `THIRD_PARTY_NOTICES.md`
- 採用した判断: SuperCritical時だけ損害額表示を多層SVG textに切り替え、通常Resultは既存のテキスト表示を維持する。カウントアップは既存の`requestAnimationFrame`を使い、SVG内の全`text`レイヤーを同じ金額文字列で更新する。
- 理由・根拠: SuperCriticalは演出表示であり、`damageYenText`のBigInt文字列とスコア計算契約を変更する必要がない。既存のResult表示責務に閉じることで、通常Critical/通常Resultの挙動を変えずに「5000兆円欲しい」風の赤グラデーション、多重縁取り、ハイライトを追加できる。
- 確認結果: `npm run typecheck`、`npm run build`通過。
- 追記: 参照画像に寄せるため、青背景は追加せず、文字側に銀フチ、黒い奥行き影、金属調の下半分ベベル、斜めハイライトを追加した。Result背景や動画最終フレームを隠さないため、背景プレートは使わない。
- 追記2: `rare25/5000choyen` がMIT Licenseで利用可能だったため、SuperCritical損害額表示をSVGからCanvas描画へ置き換えた。元実装のstroke/fill多層描画をローカルTypeScript関数へ移植し、カウントアップ中は毎フレームCanvasを再描画する。CSP上外部Google Fontsは使わず、ローカル/OSフォントfallbackで描画する。
- 追記3: 本番表示を1920x1080基準にし、SuperCritical金額のCSS表示枠を最大1800px x 230pxへ拡大した。Canvas内部フォントは`950 136px`にし、各stroke幅も増やして長桁表示でも文字の太さが残るようにした。
- 手動確認: `Ctrl+Shift+Enter`で強制SuperCriticalを発生させ、損害額が`¥ 0`から大量桁の最終金額までカウントアップし、SuperCritical時だけ赤グラデーションと多重縁取りのSVG表示になることを見る。
- 残課題: 元ミーム画像や特定フォントファイルは同梱しない。見た目調整が必要な場合はSVGのstroke幅、viewBox、色を追加調整する。
