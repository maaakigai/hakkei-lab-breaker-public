# 20260623 自動起動システム(②③④)— 規約レビューと保留判断

> 後日注記: 以下のClaude／Codex表記は、この試作時点におけるAIエージェント間の作業分担を示します。プロジェクト全体の課題設定、AI出力の採否、追加指示、受入・リリース判断は人間2名が共同で担当しました。現在の説明は[`docs/DEVELOPMENT_PROCESS.md`](../../../DEVELOPMENT_PROCESS.md)を参照してください。

## 対象
mocopi 1クリック自動起動の試作。Claude(契約/統合/検証)＋Codex(実装)を agmsg で分担して構築:
- ② 起動時入力モード自動選択: `src/main/startupInputMode.ts`、`src/main/index.ts`(getConfig に activeInputMode 追加・起動時 applyMode)、`src/shared/types.ts`、`src/renderer/app.ts`。
- ③ 監視デーモン: `src/automation/readinessWatcher.ts`、`src/automation/watcherMain.ts`、`test/readinessWatcher.test.ts`。
- ④ 起動bat: `起動.bat`、`起動_モックテスト.bat`、`scripts/build.mjs`(watcher の esm ビルド口)。

## 判定: 規約・仕様に複数抵触。当面「保留」。
最優先判断基準(AGENTS.md §1: requirements→SPEC→AGENTS→MILESTONES→既存→推測、推測で補完しない)を踏まずに実装したため、以下に抵触した。

| 重大度 | 指摘 | 典拠 |
|---|---|---|
| 高 | ElectronからのUnity自動起動は「初期は手動起動」が方針 | SPEC.md §21 Q-04 |
| 高 | 自動起動はP4(最低優先)・スコープ削減第3位・Week4新機能凍結 | MILESTONES.md §1/§7/§8 |
| 高 | 検知→自動起動が「プレイ前の安全確認」「InputCheck人手確認」をバイパス | SPEC §3.3 手順7/9、§11、operation.md §2 |
| 中 | 起動時モード選択(--input-mode/HAKKEI_INPUT_MODE)はSPEC外。正規は config `defaultInputMode` | SPEC §18.1/§0.13、AGENTS §8 |
| 中 | しきい値 debounce=3 をハードコード | AGENTS §8/§12 DoD |
| 低 | `src/automation/`・ルート直下 .bat は推奨構成に未記載 | AGENTS §4、SPEC §5 |

整合していた点: ③の検知フィールド(rightHandReady/receiverReady/avatarReady/receiverStatus=="receiving")は SPEC §7.4 と一致。port45100/8192 は config 由来。validateDatagram 再利用でスキーマ重複なし。mock を Gate 代替にしていない。

## 採用した判断と理由
- **保留(shelve)**: 自動起動は SPEC Q-04 と MILESTONES の優先度方針に従い、当面導入しない。
- 試作は破棄せず、正規フロー外の実験ツールとして隔離保存する。
- 理由: 動作はするが、安全確認バイパスと「当面手動起動」方針への抵触が無視できず、今は M9/M10(実機 Unity Bridge)が本筋のため。

## 残課題 / 次工程
- ②の製品コード混入(index.ts/types.ts/app.ts/build.mjs)の扱い(revert か 隔離保存か)を決定する。
- 本筋: M9(Unity Bridge 実装・Plugin/Avatar/実機、🚧雛形のみ)→ ① `UnityBridge.exe` スタンドアロンビルド(`BuildBridge.cs`、要 Unity Editor クローズ)→ M10(実機検証、Motion Source App 選定=M10-01 未着手)。
- 将来 自動起動を正式採用するなら、先に SPEC Q-04 と起動順・安全確認の仕様を改訂してから実装する。

## 協働テストの結果(別評価)
agmsg による Claude⇄Codex 分担は機能した(②79pass/③75pass+実プロセス疎通、close→onReady順序遵守、担当分離遵守)。Codex の send.sh はメッセージ全文を1引数でクォートする必要がある(本文欠落の既知事象)。
