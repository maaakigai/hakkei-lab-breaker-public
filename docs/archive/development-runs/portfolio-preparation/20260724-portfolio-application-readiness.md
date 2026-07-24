# 2026-07-24 ポートフォリオ応募前整備

> 2026-07-25追加更新: 未使用のWan比較候補2本を公開版から除外し、現行の公開MP4は20本（Wan gameplay 18本、単色プレースホルダー1本、再現デモ1本）となった。以下の22本・比較候補2本という記載は、それ以前の確認記録である。
>
> 2026-07-24追加更新: 後続対応でCritical機能、実在企業の映像5本、ホスピタリティモードと人物画像を削除した。現在はBGM・SFX全22本が完全な無音WAVで、公開MP4全22本に音声トラックはない。以下の25本・27本という記載は削除前の確認記録である。
>
> 後日注記: 本文の「自作破壊映像」は、制作チームが管理する作品素材という意味で使った当時の表現であり、生成方法の説明としては不十分だった。現行プレイ用18本と比較候補2本は、共同制作者が撮影した研究室写真を入力に、無改変の公式`Wan-AI/Wan2.2-I2V-A14B`チェックポイントをローカル環境で使用して2026年7月5日に生成した。`lv5_total_destruction.mp4`は旧開発用の単色プレースホルダーでWan生成物ではない。正確な出典はリポジトリ直下の`ASSET_LICENSES.md`を参照する。

## 対象ステップ

ポケットペア応募前の公開ポートフォリオ整備。権利確認できない音声の除去、公開容量、初見可読性、担当根拠、CI、Electronセキュリティ説明を対象とする。

## 変更ファイル

- 音声・設定: `assets/Sound/`、`config/app.config.json`、`scripts/generate-placeholder-audio.mjs`
- 映像・Unity: `assets/videos/LV1/`〜`LV5/`、`unity-bridge/Assets/MocopiReceiver/Samples/`
- 実装: `src/main/index.ts`、`src/renderer/app.ts`、`src/renderer/settings.ts`、関連する設計コメント
- テスト・CI: `test/placeholder-audio-assets.test.mjs`、`test/portfolio-docs.test.mjs`、`.github/workflows/ci.yml`
- 公開説明: `README.md`、`ASSET_LICENSES.md`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、`docs/CONTRIBUTIONS.md`、`docs/architecture/electron-security.md`
- 文書整理: `AGENTS.md`、`CLAUDE.md`を`docs/internal/`へ移動、操作・確認資料を更新

## 採用した判断

- 公開版の音声は、旧音声を一切残さず、単純な正弦波だけで作る25個の短いWAVへ置換した。
- 音声の出自をコードで再現できるようにし、録音音声、楽曲sample、外部生成サービスを使わない。
- 自作破壊映像は削除せず、Lv1〜Lv5の18本を1920×1080の高bitrate版から1280×720のH.264公開版へ変換した。
- Sony Pluginは実行に必要なRuntimeとライセンスを残し、作品固有でない公式sample scene/avatarだけを公開版から除外した。
- AI名が残ったコードコメントは、人物・tool名ではなく設計意図と回帰防止理由へ書き換えた。
- Renderer preloadが`contextBridge`、`ipcRenderer`、`process.versions`のsandbox対応範囲だけを使っていたため、`sandbox=true`へ変更した。新規windowと画面内navigationも拒否した。
- 公開側のコミット履歴で開発担当を示せないため、自己申告であることを明記した上で、ファイル・領域単位の`CONTRIBUTIONS.md`を追加した。
- ソース全体へオープンソースライセンスを推測で付けず、`NOTICE.md`でポートフォリオ閲覧目的と第三者ライセンスの境界を明記した。
- 展示担当者がコマンド入力なしで使える`scripts/windows/*.bat`はすべて維持し、READMEに用途別の入口を追加した。

## 理由・根拠

- 権利確認できない音声は、ファイル名変更だけではなくbinary自体を公開対象から除く必要がある。
- placeholderを生成scriptと固定testの両方で管理すると、将来の差し替えで権利不明音声や大容量WAVが再混入するのを検出できる。
- 破壊映像は作品評価の中心であり、削除よりも720p公開encodeの方が作品性とclone負担のバランスがよい。比較frameで亀裂、破片、室内輪郭が保持されることを確認した。
- Electron公式のsecurity checklistはprocess sandboxing、context isolation、Node.js integration無効化を推奨している。現行preloadはsandbox内で利用可能な限定APIだけで成立する。
- `SPEC.md` 0.19の「音声欠落はwarningで進行を止めない」と、Main / Preload / Rendererの責務分離は維持した。

## 確認結果

- `npm ci`: PASS、147 packages、既知脆弱性0件
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: PASS（現行285件）
- `npm run clean && npm run build`: PASS
- 音声: 現行22 WAV、合計約310KiB。build後manifestはnormal 10 / unique 1 / featured 1
- 動画: 現行の公開対象22本を検査し、全件映像streamあり・音声streamなし。Lv1〜Lv5の18本は全件1280×720
- Electron: `--local-mode`で起動し、Mainの起動と通常BGM開始ログを確認。sandbox有効化によるpreload errorなし
- 公開版の作業ツリー見積り: 約66.4MiB（変更前約428.6MiB）
- `git diff --check`: PASS

## 残課題

- 公開Git履歴には旧大容量binaryが残っているため、通常の`git clone`容量は今回のHEAD容量まで縮まらない。履歴書き換えと`main`へのforce-pushは破壊的操作なので、この変更とは分離し、リポジトリ所有者の明示承認後に実施する。
- GitHub Actionsの実行結果とbadgeは、変更を公開リポジトリへpushした後に確認する。
- mocopi実機、実スピーカーでの音量、KeyboardによるTitleからResultまでの完全手動プレイは`HUMAN_TEST_GUIDE_JA.md`に従って人間が確認する。
