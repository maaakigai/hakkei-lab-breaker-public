# 🛟 シェルター: mocopi 自動起動システム 試作（保留・正規フロー外）

> **これは本番(製品)コードではありません。** 規約レビューの結果、当面「保留」と判断した
> 試作一式を、捨てずに隔離保管しています。`src/` や `test/`、ビルド対象には含まれません。
> 判断の経緯と典拠は [`20260623-automation-hold.md`](../development-runs/unity-era/20260623-automation-hold.md)。
>
> 後日注記: 以下のClaude／Codex表記はAIエージェント間の作業分担を示します。プロジェクト全体の判断責任は人間2名が共同で担いました。現在の説明は[`docs/DEVELOPMENT_PROCESS.md`](../../DEVELOPMENT_PROCESS.md)を参照してください。

## これは何か
「起動.bat 一発 → 人力(装着・ペアリング・校正・送信開始)が終わったら、監視が自動検知して
ゲームを Unity Bridge モードで自動起動する」自動化の試作。Claude(契約/統合/検証)＋ Codex(実装)を
agmsg で分担して構築した。動作・テストは通っている(下記)。

## なぜ保留か（規約は絶対）
最優先判断基準 AGENTS.md §1（requirements→SPEC→AGENTS→MILESTONES→既存→推測、推測で補完しない）に対し、
SPEC を確認せず実装したため複数抵触した。要点:

| 重大度 | 抵触 | 典拠 |
|---|---|---|
| 高 | Electron からの Unity 自動起動は「初期は手動起動」が方針 | SPEC §21 Q-04 |
| 高 | 自動起動は P4(最低優先)・スコープ削減第3位・Week4 凍結 | MILESTONES §1/§7/§8 |
| 高 | 検知→自動起動が「プレイ前の安全確認」「InputCheck 人手確認」をバイパス | SPEC §3.3 手順7/9・§11 |
| 中 | 起動時モード選択(--input-mode/HAKKEI_INPUT_MODE)は SPEC 外（正規は config `defaultInputMode`） | SPEC §18.1/§0.13 |
| 中 | しきい値 debounce=3 のハードコード | AGENTS §8・§12 DoD |
| 低 | `src/automation/`・ルート直下 .bat は推奨構成に未記載 | AGENTS §4・SPEC §5 |

## 同梱物
| ファイル | 役割 |
|---|---|
| `readinessWatcher.ts` | ③ 監視デーモン本体。45100 で heartbeat の readiness を連続3回検知し、socket close 後に onReady |
| `watcherMain.ts` | ③ CLI エントリ。config 読込→ReadinessWatcher 起動→検知でゲーム起動コマンドを spawn |
| `startupInputMode.ts` | ② 起動時入力モード解決（CLI `--input-mode=` > env `HAKKEI_INPUT_MODE` > none）※ SPEC 外機構 |
| `readinessWatcher.archived.ts` | ③ のテスト（`.test.` を外し自動実行対象から除外。復活時に要パス修正） |
| `startup-input-mode.archived.ts` | ② のテスト（同上） |
| `起動.bat` | ④ 実機用ランチャ（CP932/CRLF） |
| `起動_モックテスト.bat` | ④ 実機不要のモックテスト用ランチャ |
| `ticket-02-auto-select-mode.md` / `ticket-03-readiness-watcher.md` | Codex へ渡した実装チケット（契約仕様） |

## 検知契約（参考・SPEC §7.4 と整合していた部分）
45100 の heartbeat で `source==="unity-bridge"` かつ
`receiverReady && avatarReady && rightHandReady && receiverStatus==="receiving"` を連続3回で readiness 確定。
スキーマは本体の `src/main/packetValidator.ts` の `validateDatagram` を再利用していた。
45100 はゲーム本体の受信ポートでもあるため、検知後はまず socket を close してからゲームを spawn する順序だった。

## 検証実績（保留時点）
- ②: `npm test` 79 pass、③: 75 pass（いずれも当時）。typecheck/lint 緑。
- ③ を .mjs ビルドして mock 送信器で実プロセス疎通も確認（検知→起動コマンド発火 OK）。

## 製品コードから戻した（revert した）変更 — 復活時はこれを再適用
保留にあたり、以下の製品コード混入を **元(SPEC 準拠)に戻した**。自動起動を将来正式採用する場合は、
**先に SPEC Q-04・起動順・安全確認の仕様を改訂**したうえで、以下を再実装すること。

1. `src/main/index.ts`
   - `import { resolveStartupInputMode } from "./startupInputMode.ts";` を追加していた。
   - `getConfig` を `activeInputMode` 込みで返すよう変更（`ConfigResponse` 型を追加）していた。
   - `app.whenReady` 内 `createReceiver` の後に `applyMode(resolveStartupInputMode(process.argv, process.env));` を追加していた。
2. `src/shared/types.ts`
   - `getConfig(): Promise<IpcResult<AppConfigBundle & { activeInputMode: InputMode }>>;` に拡張していた（元は `AppConfigBundle`）。
3. `src/renderer/app.ts`
   - `start()` 内で `store.inputMode = res.value.activeInputMode;` を追加していた（元は既定 `"keyboard"` のまま）。
4. `scripts/build.mjs`
   - `dist/automation/watcherMain.mjs` を出力する esbuild(esm) エントリを追加していた。

## 復活手順（将来、規約を整えた後に）
1. SPEC Q-04 等を改訂（自動起動・起動順・安全確認・モード供給を仕様化）。
2. 上記4ファイルの変更を再適用（または config `defaultInputMode` ベースの正規機構として再設計）。
3. `readinessWatcher.ts` / `watcherMain.ts` / `startupInputMode.ts` を `src/` 配下へ戻す。
4. しきい値(debounce 等)を `config/*.json` 化（ハードコード禁止）。
5. 安全確認・InputCheck 確認を自動フローに組み込む。
6. テストを `test/` へ戻し（`.test.ts` 名に復名）、HUMAN_TEST_GUIDE_JA.md / verification_checklist.md に手順追記。
