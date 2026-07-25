# docs/asset_guidelines.md

動画・音響素材の作成ガイドです。

## 動画ファイル

| レベル | ファイル名 |
|---:|---|
| Lv0 | 動画なし。現行背景画像 `assets/images/lab-backgrounds/lab-main-front-16x9.png` を表示 |
| Lv1 | `assets/videos/LV1/` 配下の `.mp4` |
| Lv2 | `assets/videos/LV2/` 配下の `.mp4` |
| Lv3 | `assets/videos/LV3/` 配下の `.mp4` |
| Lv4 | `assets/videos/LV4/` 配下の `.mp4` |
| Lv5 | `assets/videos/LV5/` 配下の `.mp4` |
| Critical | `assets/videos/CriticalVideo/critical-radio-tower.mp4` |

通常Lvの現行18本は、非公開保全アーカイブ`6ba`から復元した1280×720の公開用encodeです。全18本に音声トラックとぼかし処理はありません。共同制作者が撮影した元の研究室写真を入力に、2026年7月5日に無改変の公式`Wan-AI/Wan2.2-I2V-A14B`チェックポイントをローカル環境で使用して生成したI2V映像です。attack114514が生成操作、プロンプト、シード値の設定を主に担当し、出力の採用・棄却は人間2名が共同で判断しました。

Criticalの大型電波塔映像はGeminiを用いて制作した1280×720・音声トラックなしの公開用encodeです。

## 動画条件

- 形式はmp4。
- 通常Lvは4〜6秒程度。Criticalは現行素材の10秒を上限目安とする。
- 現行公開素材の解像度は1280×720。置換時も実装を変更しない限り同じ解像度にそろえる。
- 人物を登場させない。
- 顔を映さない。
- 公開前に、PC画面、文字情報、未公開情報、個人名、読める書類の有無を複数時点で確認する。
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
| `assets/images/lab-backgrounds/` | 共同制作者が撮影した元の研究室写真を16:9・1280×720へ合わせたゲーム背景 |

現行の正規背景は`assets/images/lab-backgrounds/lab-main-front-16x9.png`です。撮影者である共同制作者から、ゲーム内利用、Wan I2Vへの入力、生成映像を含むGitHub公開、採用応募資料での利用について同意を得ています。この同意記録は、施設管理者による別個の書面許可があることを表明するものではありません。

同じ視点からLv別動画を作る場合は、破壊前の静止画を `assets/images/lab-backgrounds/` に置き、最終的にゲームで再生するmp4を `assets/videos/` に置きます。RendererからはPC依存の絶対パスではなく、静止画は `images/...`、動画は `videos/...` の相対パスで参照します。生成途中の説明文そのままの長いファイル名は避け、レベル別フォルダ内で短い英数字名へ寄せます。未使用の比較候補は公開版へ含めません。

画像や動画を追加・置換するときは、公開可否と撮影者の同意範囲を再確認します。現行18本の通常動画については、非公開保全アーカイブ`6ba`を復元元として維持し、来歴の異なる素材と混在させません。

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
