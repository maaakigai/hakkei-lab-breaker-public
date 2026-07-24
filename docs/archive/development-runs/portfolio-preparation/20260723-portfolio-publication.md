# 2026-07-23 Portfolio publication

> 2026-07-24更新: 外部接続を既定OFFとする判断は、公開QR体験を提供する現行方針に置き換えられた。現在は`release.bat`が共有デモサーバーへ接続し、`release_local.bat`が外部接続なしの経路を担当する。
>
> 後日注記: 展示実績は追加の証拠保全後、2026年7月12日・1時間・約30名・約40セッションとして整理した。人数とセッション数は、準備・テストを含む展示日全体のログに基づく概算である。重大障害0件は当日の運用観察に基づき、サーバーと展示機それぞれをログだけで証明するものではない。現行の集計条件は[`docs/EXHIBITION_EVIDENCE.md`](../../../EXHIBITION_EVIDENCE.md)を参照する。

- 対象ステップ: `同期用`ブランチのポートフォリオ公開スナップショット作成。
- 変更ファイル: `README.md`、`.gitignore`、`config/app.config.json`、`src/main/index.ts`、`src/renderer/index.html`、`CloudServer/`、`THIRD_PARTY_NOTICES.md`、`docs/images/result-screen.png`、本記録。
- 採用した判断: GitHub上の`同期用`最新コミットを基準にし、過去ブランチや旧コミット履歴を持たない単一の初期コミットとして公開する。
- 理由・根拠: ポートフォリオ閲覧者が現行成果物へ直接到達できるようにし、実ユーザー情報や過去の生成物をGit履歴へ残さないため。
- 採用した判断: `output/`、`outputs/`、生計測CSVを除外し、重複スクリーンショットのうち作品説明に必要な1枚だけを`docs/images/`へ移す。
- 理由・根拠: 実行に不要な生成物を削減しつつ、READMEだけで完成画面を確認できるようにするため。
- 採用した判断: ランキングとセッションの実データを削除し、空の`*.example.json`だけを残す。
- 理由・根拠: nickname、playerId、プレイ記録、sessionIdをPublicリポジトリへ含めないため。サーバーはデータファイル欠落時も空状態で起動できる。
- 採用した判断: 外部スコアサーバー接続を既定OFFとし、fallback、CSP、設定例を`127.0.0.1:45200`へ統一する。
- 理由・根拠: 閲覧者がアプリを起動しただけで実運用サーバーへ接続・書き込みしないようにするため。
- 採用した判断: 旧トンネル配備スクリプトを除外し、CloudServer文書をローカル開発向けに書き直す。
- 理由・根拠: 固有ホストへの配備手順ではなく、再現可能なポートフォリオ構成を示すため。
- 採用した判断: 公開前の`npm audit`で検出した既知脆弱性を解消するため、Electronを43系、esbuildを0.28系へ更新し、Node.js要件を22.12以上へ合わせる。
- 理由・根拠: 初回監査でHigh 3件・Moderate 1件が検出され、Electronの監査推奨修正版がNode.js 22.12以上を要求したため。
- 確認: `npm run typecheck` PASS、`npm run lint` PASS、`npm test` 281件PASS、`npm run build` PASS、Python compile PASS、Electron 43.2.0で`--local-mode`起動と`UBI-Lab Break Simulator`ウィンドウ生成を確認。`npm audit`は脆弱性0件。
- 2026-07-23追記: 約30名規模の会場で1時間の継続展示を完遂し、ユーザー情報・スコア管理サーバーと展示機の双方で観測された障害は0件だった。耐久課題は完了済み。素材の再利用許諾は付与しない。
