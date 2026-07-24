# Run: Ready / Charge / HakkeiReady 中央メッセージHUD化

- 対象ステップ: M12 UI・演出調整 / プレイ中メッセージ表示
- 変更ファイル: `src/renderer/app.ts`, `src/renderer/styles.css`, `docs/verification_checklist_v2_ble.md`
- 採用した判断: Ready / Charge / HakkeiReady の中央文言を共通 `game-prompt` HUDへまとめ、状態ラベル、タイマー、主操作、短い補助文を同一プレート内に配置する。
- 理由・根拠: 研究室背景に直接テキストを置くと、天井・棚・照明に埋もれて読みにくく、通常プレイ中にもdebug文のように見える。既存の下部発勁ゲージHUDと調子を合わせ、半透明の暗いプレート、発光ライン、短い命令形の文言でゲーム画面として読めるようにする。
- 確認結果: `npm run typecheck` PASS、`npm run build` PASS。旧 `phaseHeader` / `instruction` / `countdown-big` は未使用になったため削除または参照なしを確認。
- 手動確認: `npm run dev:debug` → Keyboard → Ready / Charge / HakkeiReady へ進み、中央メッセージが背景画像の上でも読めること、Chargeのタイマーが更新されること、HakkeiReadyの構えカウントがHUD下段に表示されることを見る。
- 残課題: 実機BLE環境と外部ディスプレイ距離での視認性確認は未実施。

## 追記: プレイ中背景の暗転解除

- 採用した判断: Ready / Charge / HakkeiReady / ImpactDelay の `::after` 黒オーバーレイを `transparent` にし、同4状態の `::before` からも背景用の黒グラデーションを外す。
- 理由・根拠: ユーザ確認で、チャージ準備から発勁打ち出しまで背景が薄く暗く見える演出は不要と判断したため。中央HUD自体に半透明プレートと発光ラインがあり、背景全体を暗くしなくても指示文の視認性を確保できる。
- 確認: `npm run build` PASS。手動では Ready / Charge / HakkeiReady / ImpactDelay に進み、研究室背景が暗転しないことを見る。

## 追記: 発勁エネルギーゲージの常時表示

- 採用した判断: `chargeHudHtml()` を追加し、Ready / Charge / HakkeiReady / ImpactDelay の各画面テンプレートで同じ発勁エネルギーゲージを表示する。
- 理由・根拠: チャージ開始前から発勁打ち出しまでゲージを常時見せることで、プレイヤーが現在のタメ状態を見失わない。Charge中だけ値を更新し、HakkeiReady / ImpactDelayでは確定したチャージ量を保持表示する。
- 確認: `npm run typecheck` PASS、`npm run build` PASS。手動では Ready→Charge→HakkeiReady→ImpactDelay の各状態で下部ゲージが消えないことを見る。

## 追記: リリースUIの遷移文言整理

- 採用した判断: Ready画面から安全注意ブロックを削除し、HakkeiReadyの診断枠とImpactDelayの内部説明文はdebug UI時だけ表示する。`scripts/windows/release.bat` を追加し、`npm run dev` 経由でdebug flagなしのリリースUIを起動する。
- 理由・根拠: 安全注意はTitleで既に表示しており、Readyで再表示するとプレイ直前のHUDが冗長になる。HakkeiReadyの構えカウント/パンチ診断やImpactDelayの「発勁演出（短時間）」は実装説明に近く、通常プレイヤー向けではないためdebug UIに限定する。起動batは操作担当者がdebug UIとrelease UIを取り違えないよう名前で分ける。
- 確認: `npm run typecheck` PASS、`npm run build` PASS。手動では `scripts/windows/release.bat` 起動でTitleにdebug menuが出ないこと、Readyに安全注意文が再表示されないこと、HakkeiReadyに構え/パンチ診断が出ないこと、ImpactDelayで内部説明文が出ないことを見る。

## 追記: プレイ中HUDを「指示 + 秒数」に圧縮

- 採用した判断: Ready / Charge / HakkeiReady の中央HUDから状態ラベル、タイトル、補助文を外し、大きい命令文と秒数だけを表示する。文言は Ready=`姿勢を整えて`、Charge は mocopi=`腕を振り回せ！` / keyboard=`スペースキー連打！`、HakkeiReady は mocopi=`拳を突き出せ！` / keyboard=`Enterを押せ！` とする。
- 理由・根拠: プレイ中は画面注視時間が短く、4層の文言（状態ラベル、タイトル、操作、補足）があると操作担当者・体験者の読む場所が増える。SPEC §0.23 の現行フローは単手チャージ→前方発勁なので、通常UIでは内部状態名や補助説明よりも即時行動の命令を優先する。
- 確認: `npm run typecheck` PASS、`npm run build` PASS。手動では Keyboard と mocopi それぞれで Ready / Charge / HakkeiReady に進み、中央HUDが命令文と秒数だけになっていること、Ready / Charge / HakkeiReady の秒数が更新されることを見る。
- 残課題: 実機BLE・外部ディスプレイ距離での視認性確認は未実施。

## 追記: HakkeiReadyの構え猶予と発勁受付を分離表示

- 採用した判断: HakkeiReady突入直後の `hakkeiPrepMs` 中は `構えて` と残り秒数を表示し、検出arm後は mocopi=`拳を突き出せ！` / keyboard=`Enterを押せ！` と `hakkeiReadyTimeoutMs` の残り秒数へ切り替える。
- 理由・根拠: 実装上は構え直しの誤発火を避けるために、構え猶予と発勁受付が分かれている。表示も分離しないと、まだ検出していない時間に「突き出せ」と見えて入力タイミングがずれるため。
- 確認: `npm run lint` PASS、`npm run typecheck` PASS、`npm run build` PASS。手動では HakkeiReadyで最初に `構えて` の秒数、その後に入力モード別の発勁指示と秒数へ切り替わることを見る。

## 追記: Charge→HakkeiReady切替時の一瞬の誤表示修正

- 採用した判断: `Charge -> HakkeiReady` の遷移前に `hakkeiArmed=false`、detector、pending keyboard punch、強度ピークを初期化する `resetHakkeiPrepState()` を呼ぶ。HakkeiReady timer開始後ではなく、`render()` より前に構え状態へ戻す。
- 理由・根拠: 以前は `render()` 後の `startStateTimers()` 内で `hakkeiArmed=false` にしていたため、前回プレイや直前状態の `hakkeiArmed=true` が残ると、最初の描画だけ `拳を突き出せ！` / `Enterを押せ！` 側の文言が出る可能性があった。表示状態は描画前に確定させる必要がある。
- 確認: `npm run lint` PASS、`npm run typecheck` PASS、`npm run build` PASS。手動では Space連打後の切替瞬間に `構えて` 以外の文言が挟まらないことを見る。

## 追記: 指示HUDの縦位置固定

- 採用した判断: Ready / Charge / HakkeiReady の `.game-prompt` を同じ `fixed` top位置へ固定する。
- 理由・根拠: Chargeだけ下部ゲージ用の `padding-bottom` があり、flex中央寄せの基準が他状態と異なるため、指示プレートが状態ごとに上下へ動いて見える。プレイ中の視線位置を一定にするため、指示HUDは画面基準で固定する。
- 確認: `npm run lint` PASS、`npm run typecheck` PASS、`npm run build` PASS。手動では Ready / Charge / HakkeiReady の指示プレート上端が同じ位置に出ることを見る。

## 追記: プレイ中HUDの英語化

- 採用した判断: Title画面の英字UIに合わせ、Ready / Charge / HakkeiReady の指示文、秒表記、Critical強制モード、発勁エネルギーゲージの日本語文言を英語へ変更した。文言は短い命令形を優先し、既存のHUDレイアウトとCSSは変えない。
- 理由・根拠: 上部プロンプトはプレイ中に短時間で読む必要があり、Title画面の `START` / `INPUT SETTINGS` と同じ英字中心の見た目へ寄せるため。
- 確認: `npm run typecheck` PASS。

## 追記: 上部HUD切替時の下方向フェードイン

- 採用した判断: Ready / Charge / HakkeiReady の `.game-prompt` に 180ms の `hudFadeIn` を追加し、状態切替でHUDが差し替わる瞬間だけ下から上へ短くフェードインさせる。
- 理由・根拠: 上部HUDは状態ごとにDOMを再描画しているため、文言切替時に即時表示だと硬く見える。フェードだけでは出現方向が分かりにくいため、`translate(-50%, 14px)` から `translate(-50%, 0)` へ戻して、中央揃えを維持したまま下から入る見た目にする。
- 手動確認: Ready → Charge → HakkeiReady へ進み、上部HUDが下から短くフェードインすること、最終位置が既存の上部位置からずれないことを見る。

## 追記: 発勁ゲージ下段テキストの非表示

- 採用した判断: `chargeMeterHtml()` から `.hakkei-gauge-bottom` を削除し、ゲージ下に出ていた `current / ready` 数値と `OVERCHARGE` / `HAKKEI READY` / `BUILD CHARGE` ラベルを表示しない。
- 理由・根拠: ゲージ上部にはすでにパーセント表示があり、下段の数値と状態ラベルはプレイ中HUDの情報量を増やしていたため。ゲージ本体、上部ラベル、パーセント表示、overcharge時の色・振動・音は維持する。
- 手動確認: Ready / Charge / HakkeiReady / ImpactDelay の下部ゲージで、ゲージ下に数値や状態文字が表示されないことを見る。

## 追記: オーバーチャージ振動対象の限定

- 採用した判断: overcharge時の `hakkeiGaugeShake` を `.hakkei-gauge` 全体ではなく `.hakkei-gauge-body` に適用し、ゲージフレームとバーだけを揺らす。
- 理由・根拠: ラベル `HAKKEI ENERGY` とパーセント値まで揺れると数値の読み取りが落ちるため。オーバーチャージの危険感はゲージ本体の振動、色、ヒビ、音で維持し、情報表示は固定する。
- 手動確認: 100%を超えたとき、ゲージ本体だけが揺れ、`HAKKEI ENERGY` とパーセント表示は動かないことを見る。

## 追記: 発勁ゲージラベル色の同期

- 採用した判断: `HAKKEI ENERGY` ラベルをSVG text化し、`%` 表示と同じ `chargeValueColor()` の色を `fill` 属性で渡して、チャージ量に応じて同じ色へ変化させる。
- 理由・根拠: `index.html` の CSP は `style-src 'self'` でinline styleが効かない可能性があるため、`%` 表示と同じSVG属性方式に統一する。パーセント値だけ色が変わると上段表示内で情報のトーンが分かれるため、ラベルも同じ色にして、固定表示の読みやすさを保ちながらチャージ状態を一体的に見せる。
- 手動確認: チャージ量が増えるにつれて `HAKKEI ENERGY` と `%` 表示が同じ色で変わることを見る。

## 追記: 発勁ゲージ上部文字の視認性改善

- 採用した判断: `chargeValueColor()` の明度を 58% から 62% へ上げ、`HAKKEI ENERGY` と `%` のSVG strokeを太く濃くする。
- 理由・根拠: 背景やゲージ発光の上では色付き文字が溶けやすく、特に上部ラベルは通常テキストより小さく見える。半透明プレートは追加せず、既存デザインを維持したまま最低輝度と縁取りで読みやすさを上げる。
- 手動確認: Ready / Charge 中に `HAKKEI ENERGY` と `%` が背景に埋もれず、チャージ量に応じた色変化も見えることを確認する。
