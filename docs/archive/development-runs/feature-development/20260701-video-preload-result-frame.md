# 20260701 video preload / Result final frame

## 対象ステップ

動画切替暗転対策 + Result最終フレーム背景化

## 変更ファイル

- `src/renderer/videoManager.ts`
- `src/renderer/app.ts`
- `src/renderer/styles.css`
- `docs/verification_checklist_v2_ble.md`
- `docs/runs/20260701-video-preload-result-frame.md`

## 採用した判断

- `ImpactDelay` 入場時に次の動画を `preloadVideo(file)` で読み込む。
- `VideoPlayback` 入場時は、同じ file の preload 済み `<video>` を再利用する。
- `<video>` は `loadeddata` / `canplay` 相当になるまで透明にし、研究室背景を残したまま上へ重ねる。
- `VideoPlayback` 画面と video host の黒背景は外し、preload が間に合わない場合も `lab-main-front-16x9-privacy.png` を見せる。
- `videoEnd` 遷移時だけ `VideoHandle.detachForResult()` で video 要素を退避し、Result の背面へ再配置する。
- `replay` / `finish` / `reset` / `esc` では保持した Result 背景 video を破棄する。
- Result 背景は canvas 化せず、停止した video 要素を保持する。

## 理由・根拠

- 暗転の主因は `screen-VideoPlayback::before` と `.video-background-host` の黒背景、および video 読み込み前から表示面が黒へ切り替わることだったため、背景の黒塗りをなくして研究室背景を残す方が失敗時も視覚的に安定する。
- preload を `ImpactDelay` へ置くと、発勁演出の短い待ち時間を動画読み込みに使える。timeout など `ImpactDelay` を通らない経路にも備え、`VideoPlayback` 遷移直前にも prepare を呼ぶ。
- Result の「壊れた研究室」は再生動画の実際の終端と一致する必要があるため、別画像や canvas 抽出ではなく、再生済み video の最終フレームを保持する実装が最小変更で破綻しにくい。
- `videoEnd` 以外の遷移で video を残すと次プレイに古い破壊映像が残るため、reset 系イベントで明示破棄する。

## 確認結果

- `npm run build`: PASS
- `npm run typecheck`: PASS
- `npm test`: PASS（222 tests）
- `npm run lint`: PASS
- Debug Lv5通常フロー: PASS
  - `VideoPlayback` の `<video src>` は `videos/fx_hadoken_seed2026.mp4`。
  - `screen-VideoPlayback::before` は研究室背景、`.video-background-host` は透明。
  - Result は同じ video 要素を保持し、`ended=true`、`currentTime=duration=5.0625`。
  - `replay` 後に Result 背景 video はDOMから消える。
- 動画欠落テスト: PASS
  - `動画ファイルが見つかりません: __missing_video__.mp4` で Error へ遷移。

## スクリーンショット

- `artifacts/video-preload-playback-lv5.png`
- `artifacts/result-final-frame-lv5.png`

## 残課題

- 実機BLEでの10連続確認は未実施。今回の変更は動画表示と画面遷移に限定し、入力処理、スコア、Lv判定は変更していない。

## 追記: 全Lv動画の起動時preload

### 採用した判断

- `config/score.config.json` の `videoLevels` と、固定動画指定の `outcomes.*.video.file` から動画ファイル一覧を作る。
- 設定読み込み直後に全動画を `PreparedVideo` としてpreload cacheへ登録する。
- preload用の `<video>` は不可視の `#video-preload-cache` に置く。detached要素の `load()` だけに依存しない。
- `VideoPlayback` では選ばれたfileのvideoをcacheから取り出して再生する。
- Result背景へ引き継いだvideoを破棄した後、消費したfileを含む全動画cacheを再補充する。
- preload中のvideoは `autoplay=false` とし、実再生時に `currentTime=0` を試みてから `play()` する。

### 理由・根拠

- ImpactDelay中の1本preloadだけでは、動画素材が大きくなった場合に読み込み開始が遅れ、VideoPlayback入場直後の透明待ちが見える可能性がある。
- 起動時にLv0〜Lv5を読み始めておけば、ゲーム中の動画選択は「読み込み済み候補から取り出す」処理になり、暗転・ローディング感を減らせる。
- detached video は環境によって読み込み挙動の観測が不安定なため、不可視DOMホストへ置いて通常のmedia要素としてpreloadする。
- preload用videoに `autoplay=true` を付けると、DOM表示前に再生位置が進む可能性があるため、再生時だけautoplay/playを有効にする。

### 確認結果

- `npm run build`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）
- Debug Lv5通常フロー: PASS
  - Title時点で `#video-preload-cache video` が6本。
  - preload対象は `lv0_no_damage.mp4`〜`lv4_heavy_destruction.mp4` と `fx_hadoken_seed2026.mp4`。
  - 6本すべて `readyState=4`。
  - Lv5再生時は `fx_hadoken_seed2026.mp4` がcacheから外れ、再生videoは `readyState=4`、`paused=false`。
  - Resultで最終フレーム保持後、`replay` でResult背景videoが消え、cacheが6本へ戻る。

### スクリーンショット

- `artifacts/video-cache-playback-lv5.png`

## 追記: 発勁エネルギーゲージHUD

### 変更ファイル

- `assets/images/hud/hakkei-gauge-frame.png`
- `assets/images/hud/hakkei-gauge-frame-cutout.png`
- `src/renderer/app.ts`
- `src/renderer/styles.css`
- `docs/runs/20260701-video-preload-result-frame.md`
- `docs/verification_checklist_v2_ble.md`

### 採用した判断

- ゲージ素材は画像生成で作成し、クロマキー除去後に `assets/images/hud/hakkei-gauge-frame.png` として保存する。
- `assets/images/hud/hakkei-gauge-frame-cutout.png` は、元生成画像から背景と中央ゲージ窓を透明に抜いた「フレームのみ」のPNGとして作成する。
- Charge画面に `#charge-hud` を追加し、Releaseでは診断テーブルではなく発勁エネルギーゲージを主表示にする。
- Debugでは従来の診断パネルも残し、ゲージと数値の両方を確認できるようにする。
- ゲージは画面下部へ固定し、研究室背景とプレイ中の中央表示を邪魔しない配置にする。
- ゲージ塗りは素材内の半透明パネル領域を広く使い、フレームだけが浮いて見えないようにする。
- ゲージフレーム画像の中央半透明パネルは透明に抜き、塗りレイヤーをフレーム背面に置く。塗り側も多角形 `clip-path` でフレーム内形状に合わせる。
- CSPでinline styleが効かないため、ゲージ塗り幅はSVG `rect width` 属性で制御する。表示値と同じく0.1%単位で更新する。

### 理由・根拠

- 画像素材をフレームに限定し、塗り幅はCSSで制御することで、タメ量のリアルタイム更新と素材の見た目を両立できる。
- 既存の診断テーブルはゲームHUDとして視認ノイズが大きいため、Releaseでは「現在どれだけ溜まっているか」をゲージで優先表示する。
- 動的 `style` はElectron RendererのCSPに阻まれるが、SVG属性はCSPに阻まれず小数幅を直接反映できるため、5%刻みではなく0.1%単位の滑らかなHUD更新にできる。
- 研究室背景を見せる方針では中央付近を空けるほど実プレイ時の視線が安定するため、Charge HUDは画面下部に固定する。
- 半透明パネルを残した画像の上に塗りを重ねると、別部品を雑に載せたように見えるため、中央を透明化して「フレームの内側にゲージが入っている」レイヤー構造にする。
- パネル付き元画像を直接上書きし続けると調整基準が曖昧になるため、アプリ参照用に切り抜き済みフレームを別ファイル化する。

### 確認結果

- `npm run build`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（222 tests）
- Debug Keyboard Charge確認: PASS
  - `images/hud/hakkei-gauge-frame.png` が表示される。
  - Space入力後、ゲージ値が `23.0%` 前後へ更新される。
  - fillはSVG `rect width="23.0"` になり、0.1%単位の表示値と一致する。
  - HUDは下部固定で、確認時の `hudRect.bottom=700.8125` / `wrapRect.width=701.90625` / `wrapRect.height=86.90625`。
- Debug Keyboard Charge確認（中央パネル切り抜き後）: PASS
  - `assets/images/hud/hakkei-gauge-frame-cutout.png` の中央alphaは0。
  - アプリ上の `<img>` は `images/hud/hakkei-gauge-frame-cutout.png` を参照する。
  - fillはフレーム背面 `z-index=2`、フレームは前面 `z-index=3`。
  - fillはフレームより少し広めに取り、`clip-path: polygon(...)` と前面フレームで見える範囲を制限する。
  - 追加の横幅調整後、上下寸法は維持したままfillをフレーム端に重なる想定で配置する。
  - 確認時の値は `24.6%`、SVG `rect width="24.6"`。
  - 横幅調整後の `wrap.width=780.625` / `frame.width=820` / 左右inset約`19.7px`。
- Debug Keyboard Charge確認（切り抜きフレーム別ファイル化後）: PASS
  - `frameSrc=images/hud/hakkei-gauge-frame-cutout.png`。
  - fillは背面 `z-index=2`、フレームは前面 `z-index=3`。
  - 確認時の値は `24.7%`、SVG `rect width="24.7"`。

### スクリーンショット

- `artifacts/hakkei-gauge-charge-hud-live.png`
- `artifacts/hakkei-gauge-charge-hud-bottom-smooth.png`
- `artifacts/hakkei-gauge-frame-cutout.png`
- `artifacts/hakkei-gauge-frame-cutout-wide.png`
- `artifacts/hakkei-gauge-frame-cutout-extra-wide.png`
- `artifacts/hakkei-gauge-frame-cutout-horizontal-wide.png`
- `artifacts/hakkei-gauge-cutout-frame-layered.png`
