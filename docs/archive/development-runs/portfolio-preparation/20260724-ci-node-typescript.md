# 2026-07-24 CI Node.js TypeScript実行互換

## 対象ステップ

公開ポートフォリオのGitHub Actionsで、Node.js 22.12でもTypeScriptを直接読み込むテストを再現可能にする。

## 変更ファイル

- `package.json`

## 採用した判断

- `npm test`を`node --experimental-strip-types --test`で実行する。
- CIと公開要件のNode.js 22.12以上は維持する。

## 理由・根拠

- 初回CIでは型検査とLintは成功したが、Node.js 22.12がテストからimportされた`.ts`を標準では読み込まず、`ERR_UNKNOWN_FILE_EXTENSION`で失敗した。
- Node.js 22.12にはTypeScript type stripping機能があるが、22.18より前では`--experimental-strip-types`の明示が必要である。
- Node.js要件を22.18へ引き上げるより、テストが依存する実行条件をスクリプトへ明記する方が、READMEの22.12以上という公開要件と一致する。

## 確認

- Node.js 24.18で`npm test`: PASS（286件）。
- `npx -y node@22.12.0 --experimental-strip-types --test`: PASS（286件）。
- Node.js 22.12のGitHub Actionsで型検査、Lint、テスト、ビルドが通ることを確認する。
