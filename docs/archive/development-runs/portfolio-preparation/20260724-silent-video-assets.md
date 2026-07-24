# 2026-07-24 公開動画の音声トラック除去

> 2026-07-25追加更新: 未使用のWan比較候補2本を公開版から除外したため、現行の公開MP4は20本。以下の22本という記載は除外前の確認記録である。
>
> 2026-07-24追加更新: 初回無音化後、公開版から実在企業の映像5本を削除したため、現在の公開MP4は22本。

## 対象ステップ

公開ポートフォリオの動画から音声トラックを除去し、映像だけを収録する。

## 変更ファイル

- 公開動画: `assets/videos/`、`docs/media/keyboard-demo.mp4`
- 変換・検査: `scripts/strip-video-audio.mjs`、`test/silent-video-assets.test.mjs`
- 実行入口: `package.json`
- 素材・公開説明: `ASSET_LICENSES.md`、`README.md`

## 採用した判断

- 初回変換時にGitの公開対象だったMP4全27本を対象にする。権利整理後の現行対象は22本。
- 音声トラックがあった26本は、映像を再圧縮せずにvideo stream copyで音声だけを除去する。既に映像のみだった1本は変更しない。
- `.gitignore`対象の`assets/videos/Backups/`と`assets/videos/Temp/`は制作データであり、公開対象ではないため変更しない。
- 変換後は映像codec、解像度、encoded video streamのMD5が変わっていないことを置換前に検査する。
- 自動テストではMP4 containerのtrack handlerを読み、全公開動画に`vide`があり`soun`がないことを検査する。

## 理由・根拠

- 映像自体はプロジェクト制作物として公開できる一方、動画内の音声にも独立した権利確認が必要なため。
- video stream copyなら画質を変えず、音声だけを確実に公開対象から外せる。
- Gitの公開対象から検査対象を得ることで、無視している制作バックアップを誤って変更せず、将来追加する公開動画の音声も検出できる。

## 確認結果

- `npm run assets:strip-video-audio`: 初回は26本から音声を除去。権利整理後の再実行は現行22本中変更0本。
- `ffprobe`: 現行公開動画22本すべて映像streamあり、音声stream 0本。
- 専用自動テスト: PASS。
- 後続の機能整理後、型検査、Lint、全285件の自動テスト、クリーンビルド、`npm audit --audit-level=moderate`はすべてPASS。
- ビルド出力内のMP4も`ffprobe`で音声stream 0本を確認。
- `release.bat`と`release_local.bat`が変更されていないことを確認。
