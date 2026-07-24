# docs/asset_guidelines.md

動画・音響素材の作成ガイドです。

## 動画ファイル

| レベル | ファイル名 |
|---:|---|
| Lv0 | 動画なし。現行背景画像 `assets/images/lab-backgrounds/lab-main-front-16x9-privacy.png` を表示 |
| Lv1 | `assets/videos/LV1/` 配下の `.mp4` |
| Lv2 | `assets/videos/LV2/` 配下の `.mp4` |
| Lv3 | `assets/videos/LV3/` 配下の `.mp4` |
| Lv4 | `assets/videos/LV4/` 配下の `.mp4` |
| Lv5 | `assets/videos/LV5/` 配下の `.mp4` |

## 動画条件

- 形式はmp4。
- 長さは4〜6秒程度。
- 解像度は1280×720以上。
- 人物を登場させない。
- 顔を映さない。
- PC画面、文字情報、未公開情報を読み取れない状態にする。
- I2Vの生成モーションで元写真の文字が再出現しないか、開始・中間・終了だけでなく複数時点を確認する。固定領域の除去で不十分なら、公開用の安全な入力画像から再生成するか、情報を判読できない全画面処理を行う。
- 固定カメラ推奨。

## 音響ファイル

公開版の音響素材は、すべて `scripts/generate-placeholder-audio.mjs` で生成した完全無音のPCM WAVです。展示時に使用した音声は含みません。

| パス | 用途 |
|---|---|
| `assets/Sound/BGM/placeholder-main-loop.wav` | BGMの無音プレースホルダー |
| `assets/Sound/SFX/placeholder-charge-loop.wav` | チャージ中の無音プレースホルダー |
| `assets/Sound/SFX/placeholder-overcharge-loop.wav` | オーバーチャージ中の無音プレースホルダー |
| `assets/Sound/SFX/placeholder-cue-*.wav` | 構え・パンチ等のキュー用無音プレースホルダー |
| `assets/Sound/SFX/placeholder-crack-*.wav` | ひび割れ演出用の無音プレースホルダー |
| `assets/Sound/SFX/result_sfx/` | リザルト用の無音プレースホルダー |

追加・置換時も、公開版へ実音声を入れない方針を維持し、`npm run assets:audio-placeholders` で再生成します。

## 画像ファイル

研究室背景などの静止画素材は `assets/images/` に置きます。

| フォルダ | 用途 |
|---|---|
| `assets/images/lab-backgrounds/` | 情報部分を除去した公開用の研究室背景（無加工の元写真は非公開） |

画像素材も動画素材と同じく、人物、顔、PC画面、文字情報、未公開情報、個人名、読める書類を含めない状態にしてから使います。

同じ視点からLv別動画を作る場合は、破壊前の静止画を `assets/images/lab-backgrounds/` に置き、最終的にゲームで再生するmp4を `assets/videos/` に置きます。RendererからはPC依存の絶対パスではなく、静止画は `images/...`、動画は `videos/...` の相対パスで参照します。生成途中の説明文そのままの長いファイル名は避け、レベル別フォルダ内で短い英数字名へ寄せます。未使用の比較候補は公開版へ含めません。

ゲーム内の破壊前表示には、動画生成時の構図を保ちながら情報部分を除去した公開用画像を
使います。現行の背景は
`images/lab-backgrounds/lab-main-front-16x9-privacy.png`です。
無加工の元写真を公開リポジトリへ戻さず、追加の加工が必要な場合は非公開保管物から
作業して、公開用の出力だけを差し替えます。

## 技術契約との対応

動画・音響素材はscore / video selectorのテスト期待値と結び付くため、次を固定します。

| 項目 | 固定 |
|---|---|
| 動画level境界 | `score.config.json.videoLevels` の `minPower <= power < maxPower`。`maxPower=null` は上限なし |
| Lv0 | HakkeiReady timeout no-impact、またはPowerがLv0範囲のときに動画なしで背景画像を使う |
| path解決 | Rendererでは `assets/videos/<file>` として解決し、`..` を含むpathを拒否する |
| 動画欠落 | `VIDEO_MISSING`。score計算自体は成功扱いで、Result値は保持する |
| 音響欠落 | `AUDIO_MISSING` warning。ゲーム進行は止めない |
| no-impact timeout | 発勁・破壊開始に対応するSFX再生処理を開始しない |
| 画像path | build時に `assets/images/` を `dist/renderer/images/` へコピーし、Rendererから `images/<file>` として参照する |

素材品質の運用・安全・公開可否判断はこのファイルの既存条件を参照しますが、本更新では実装・テスト契約に関係する上表だけを追加対象にしています。
