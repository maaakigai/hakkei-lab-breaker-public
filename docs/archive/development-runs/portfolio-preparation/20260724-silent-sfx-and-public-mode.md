# 2026-07-24 無音音声と公開接続方針

## 対象ステップ

公開ポートフォリオのBGM・SFXを完全な無音へ変更し、READMEの公開サーバー説明を実際の`release.bat`の動作へ合わせる。

## 変更ファイル

- 音声生成・検査: `scripts/generate-placeholder-audio.mjs`、`test/placeholder-audio-assets.test.mjs`
- 素材説明: `ASSET_LICENSES.md`
- 公開説明: `README.md`
- 過去判断の注記: `docs/runs/20260723-portfolio-publication.md`、`docs/runs/20260723-portfolio-server-readme.md`

## 採用した判断

- `assets/Sound/`以下のBGM・SFX全25ファイルは、WAV形式を維持しながら全PCMサンプルを0にする。
- `release.bat`は共有デモサーバーへ既定接続し、`release_local.bat`は外部接続なしの継続経路として説明する。
- 公開URLは記載するが、保存データ、管理token、SSH・TLS・トンネル等の運用資格情報は収録しない。

## 理由・根拠

- 無音WAVなら既存の音声ロード・再生タイミングを壊さず、権利不明な音声を含まないことをサンプル値まで機械検査できる。
- 現行`config/app.config.json`は`remoteSession.enabled=true`で、`release.bat`は`--local-mode`を付けないため、共有デモサーバーへ接続する。旧READMEの「URLを含まない」「既定で無効」は実装と矛盾していた。

## 確認結果

- `npm run assets:audio-placeholders`: 25ファイルを再生成。
- BGM・SFX全25ファイルの全PCMサンプルが0であることを自動テストで確認。
- 型検査、Lint、全287件の自動テスト、クリーンビルド、`npm audit --audit-level=moderate`はすべてPASS。
- `release.bat`と`release_local.bat`が変更されていないことを確認。
