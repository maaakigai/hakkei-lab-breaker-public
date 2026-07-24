# CLAUDE.md — エージェント向けオンボーディング（内部開発資料）

> 公開ポートフォリオの閲覧入口ではありません。開発支援ツール向けのオンボーディング資料を履歴として保管しています。

このファイルは Claude Code 等のエージェントがクローン直後に読む前提の「環境構築＋作業の勘所」です。
人間向け概要は `README.md`、コーディング規約は `AGENTS.md`、仕様は `SPEC.md` を参照。

## このプロジェクト
発勁ラボブレイカー＝身体入力つきインタラクティブ映像アプリ。mocopi で右腕を動かし「上下チャージ→前後チャージ→発勁」で威力を計算し、ローカル mp4 の破壊動画・損害額・ランクを出す。
本体: **Electron / TypeScript**。モーション入力: **Unity Bridge + mocopi Receiver Plugin**（`unity-bridge/`）。

## 開発環境セットアップ（コードのみ・実機不要）

```bash
npm install
npm run typecheck && npm run lint && npm test && npm run build   # 全部緑が正常（テスト 86件）
npm run dev          # アプリ起動（Keyboard モードで一通り遊べる）
npm run mock:unity   # 疑似 Unity 入力（実機不要で UDP→Electron を確認）
```

### ⚠️ ハマりどころ（重要・memory 由来でリポジトリ外には無い知識）
1. **Node.js は v24 LTS を使う**（dev 実績は v24.17.0）。テストは `node --test` で `.ts` を直接 import する（Node ネイティブ型ストリップ）ため **Node 23.6 未満だとテストが動かない**。`package.json` の `engines` は `>=20` だが実質 24 推奨。
2. **`ELECTRON_RUN_AS_NODE` を消してから起動する**。この変数が立っていると (a) `electron .` が素の Node として動きウィンドウが出ない、(b) `npm install` の electron postinstall がバイナリ展開をスキップして「Electron failed to install correctly」になる。**起動は必ず `npm run dev` / `scripts/windows/run-dev.bat` 経由**（`scripts/launch-electron.mjs` が `delete env.ELECTRON_RUN_AS_NODE` して spawn する）。素の `electron .` は使わない。
3. **新規 TS ファイルの 3 規約**（`tsconfig.json` で強制・違反は typecheck かテスト実行時に落ちる）:
   - 型のみ import は `import type` / `import { type X }`（`verbatimModuleSyntax`）。
   - `constructor(private x)` や `enum` 禁止（`erasableSyntaxOnly`）。フィールド宣言＋本体代入で書く。
   - 相対 import は **`.ts` 拡張子必須**（`allowImportingTsExtensions`）。
4. ビルドは **esbuild**（`scripts/build.mjs`）。`tsc` は型チェック専用（`noEmit`）。

## Unity 作業をするとき（`unity-bridge/`）
- **Unity Editor 6000.0.77f1 (Unity 6 LTS)** が必要。Unity Hub で `unity-bridge/` を開く → 初回は `Library/`（gitignore 済）を自動再生成（数分）。
- mocopi Receiver Plugin は `Assets/MocopiReceiver/` に導入済み。Scene は `Assets/Scenes/UnityBridge.unity`。
- Hub CLI の `--headless install` は当環境で `ITranslate` バグで失敗する → 公式 installer を直接サイレントインストールで回避（詳細 `unity-bridge/README.md`）。
- Avatar/Scene の配線・実機 mocopi は GUI/ハード必須の手作業。

## 実機 mocopi / 本番（ノーパソ限定）
- 実機 mocopi 検証（Gate B1/B2/C/D1）・実機チューニング・本番ビルド/リハーサルは **mocopi 一式があるノーパソ**でのみ可能。
- 開発（コード・テスト・Keyboard/mock 検証・Unity C#）は任意の PC（デスクトップ）で可能。
- フロー: デスクトップで実装→push → ノーパソで `git pull`→`npm run build`→mocopi で検証。

## まず読む順（推測で補完しない・AGENTS §1）
1. `docs/requirements.md`（最優先要件）
2. `SPEC.md`（実装仕様。特に「0. 2026-06-06 確定実装契約」）
3. `AGENTS.md`（作業規約・禁止事項）
4. `MILESTONES.md`（細分化手順・「0. 進捗状況」に現況）
5. `docs/runs/`（作業日誌＝なぜそう実装したかの根拠）

## 中核の不変ルール（詳細は AGENTS.md / SPEC.md）
- `MotionSample`・filter・速度・加速度・`validForScore`/`validForCalibration` は **Electron Main が生成**。Renderer で再計算しない。
- score/hakkei は `validForScore=true` の sample だけ使う。
- 設定値は `config/*.json` から読む（ハードコード禁止）。
- キーボード入力（Space 連打チャージ＋Enter 発射）は予備として必ず残す。
- 仕様の未確定点は推測で埋めず `TODO:` を残し、先に SPEC/Issue を更新する。
