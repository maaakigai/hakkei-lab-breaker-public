# 作業日誌

発勁ラボブレイカーの実装作業ログ。**何を・なぜ変更したか**と**設計判断の根拠**を時系列で残す。
計画(MILESTONES.md)・仕様(SPEC.md)からは読み取れない「背景・意思決定」を補完するのが目的。

- 表記: ✅完了 / 🚧進行中 / ⏭未着手
- 関連: [MILESTONES.md](MILESTONES.md) / [SPEC.md](SPEC.md) / [README.md](README.md)

---

## サマリ（2026-06-23 時点）

- **M0〜M8 を実装・テスト済み**（Electron/TS 基盤 → 状態機械 → Keyboard 縦通し → スコア/動画/Result → 設定JSON化 → Unity UDP受信/validator/mock → InputCheck診断 → フィルタ/jitter → Calibration）。
- 自動テスト **71件パス**、`npm run typecheck / lint / build` すべて緑。
- 残: **M11(チャージ・発勁本実装)**, M9-M10(実Unity/mocopi、手作業中心), M12-M14(UI・ビルド・リハーサル)。
- 主要コマンド: `scripts/windows/run-dev.bat`(起動) / `npm run dev` / `npm run mock:unity`(疑似Unity) / `npm test`。

---

## 2026-06-21 環境構築

### Unity 開発環境
- Unity Hub を winget で導入、Unity **6000.0.77f1 (Unity 6 LTS)** を導入。
- **落とし穴と回避**:
  - Hub CLI の `--headless install` が `ITranslate is not in the container` バグ＋複数インスタンス競合で展開不可 → 公式URLからインストーラを取得し **MD5検証→サイレントインストール**で回避。
  - 競合した並列DLで初回インストーラが破損(3.01GB/正規4.03GB, exit code 2) → 単一DLで取り直し。
- `unity-bridge/` 雛形(ProjectVersion/manifest/`RightHandUdpSender.cs`/`BridgeStatusView.cs`)を作成。バッチモードでコンパイル0エラー確認。
- 詳細はメモリ [[unity-bridge-env]]。

### Electron / Node 環境
- Node.js **v24.17.0 LTS** を winget で導入。
- **落とし穴**: 環境変数 `ELECTRON_RUN_AS_NODE=1` がグローバル設定されており、(1)`electron .` が素のNodeとして動きウィンドウが出ない、(2)`npm install` の electron postinstall がバイナリ展開をスキップ。
  - **回避**: `scripts/launch-electron.mjs`(この変数を消して spawn)経由で起動。バイナリ未展開時はキャッシュzipを手動展開。
- 詳細はメモリ [[electron-env]]。

---

## 2026-06-21 M0〜M4

### ✅ M0: リポジトリ基盤
- ドキュメント10種は既存。欠けていた `docs/operation.md` を作成。
- `package.json` / `tsconfig.json` / Electron最小起動を新規。
- **ビルド方針の決定**: renderer のモジュール分割に備え **esbuild** を採用(`scripts/build.mjs`)。main/preload は CJS、renderer は IIFE にバンドル。tsc は型チェック専用(`noEmit`)。

### ✅ M1: 画面と状態の最小骨格
- `stateMachine.ts`(11状態 Union + 遷移表、初期=Title)、全11画面、`Esc`=Title/`R`=InputCheck、遷移テスト。

### ✅ M2: キーボード縦通しMVP
- Main `keyboardSampleGenerator`(60Hz, Space=上下サイン波 / A・D=前後等速 / Enter=前方突き)、typed IPC、preload限定API、`MotionSample`型。
- **TS/テスト規約3点を確定**（無いとテストが実行時に壊れる）→ メモリ [[ts-build-test-conventions]]:
  1. `verbatimModuleSyntax`(型のみimportは `import type`)
  2. `erasableSyntaxOnly`(constructor parameter properties 禁止)
  3. 相対importは `.ts` 拡張子必須 + `allowImportingTsExtensions`

### ✅ M3: スコアと動画の最小実装
- `scoreCalculator.ts`(normalize/Power/damage/rank/動画Lv)、`videoManager.ts`、`resultPresenter.ts`、Debug Result Fixture。
- **動画素材**: ffmpeg を winget で導入し、SPEC命名の placeholder mp4 6本(H.264/yuv420p)を生成。Electron で `readyState=4`(再生可)を実証。
- **⚠ 重要な暫定実装**: チャージの raw を **ピーク速度**(`max|velocity.y|` / `max|velocity.z|`)で実装した。これは M3「最小実装」の暫定であり、**SPEC §14.1/14.2 の正は「変位積分」**。本実装は M11 で行う（下の設計判断ログ参照）。

### ✅ M4: 設定ファイル化
- `config/app|input|score.config.json` を作成、`appConfig.ts` で schema 検証(fatal invalid→Error画面)。
- 直書き定数(`motionConfig.ts`/`scoreConfig.ts`)を**削除し config 由来へ全面移行**。

---

## 2026-06-23 M5〜M8

### ✅ M5: UDP受信・JSON契約
- `unityBridgeUdpReceiver.ts`(dgram `127.0.0.1:45100`)、`packetValidator.ts`、`motionSampleBuilder.ts`、mock送信機(`npm run mock:unity`)。
- seq(rollback/dup/gap)・timestamp・session 管理、**active sourceのpacketだけ `motion:sample`** へ。status/heartbeat/error/session-changed IPC、preload拡充。
- 実 UDP ラウンドトリップをテストで実証。

### ✅ M6: InputCheck・診断表示
- `motion:status`/`heartbeat` 購読、受信OK/NG・age・Hz・rightHandReady・座標・invalidPacket を表示。Keyboard fallbackボタン・失敗ヒント。Title に Mock モード追加。

### ✅ M7: MotionSample処理・フィルタ
- `motionFilter.ts`: Hz非依存EMA(位置/速度/加速度)・外れ値(位置jump/速度/加速度)・dt異常・`JitterTracker`(2秒 raw/filtered RMS/Max/drift)。
- `motion:diagnostics` 配線(500ms)、`validSampleRatio`、quality flags 表示。
- **10秒静止で発勁0回**(M7-09)をフルパイプラインで確認。

### ✅ M8: Calibration・軸処理
- `calibrationManager.ts`: discard300ms→neutral2s(≥40)→forward1s(≥20,≥0.15m)、up/forward vector、失敗理由、品質(Hz/jitter)。
- Keyboard は pseudo calibration(default vector)で待たせない。`input:reset-filter` IPC 追加。

---

## 設計判断ログ

### 2026-06-23 チャージ威力の導出方法（加速度案を却下→変位積分を採用）

**経緯**: 「チャージ威力を加速度から導けないか」を検討。ゲームデベロッパ視点のサブエージェントレビューを実施。

**結論**: **加速度ベースは却下。SPEC §14.1/14.2 の「変位積分」を採用**（＝当初計画 M11-01〜04 と一致）。

**加速度を却下した理由**:
1. **3経路の不公平**: keyboard の A/D は等速移動 → 加速度≈0。加速度ベースだと前後チャージが keyboard/mock で0点になり、発表fallback(Gate A/D2)が構造的に破綻。正規化では直せない(物理的に a=0)。
2. **ノイズ最弱項**: 加速度は二階差分で jitter に最も弱く、微振動"ガン待ち"で稼げる。
3. **発勁との二重計上**: HakkeiScore が既に加速度を使用 → Power が加速度³的に過敏・スパイキー化。
4. **メタファ不整合**: ピーク加速度では「ためる」手応えが出ない。

**変位積分が正しい理由**:
- 位置の移動距離(経路長)を積むので Space/A・D/実mocopi のすべてで素直に加点 → **3経路で公平**。
- 一階差分でノイズに強く dt 非依存。
- hakkei=爆発(速度+加速度) / チャージ=蓄積(変位) と**物理量が分離**し二重計上が消える。
- **実 mocopi/Unity でこそ自然**(実際に腕が動く)。加速度案は実機で最悪だった。

**実機(mocopi)での成立性**: パイプラインが filtered `handPosition` と Calibration の up/forward vector を既に供給。残る実機特有の懸念は (a)静止jitterの積み上がり→**デッドゾーン**で対策、(b)緩やかなドリフト→実腕振りに対し誤差レベル。**最終閾値/正規化レンジは M10 で実測チューニング**。

**実装で是正すべき現状の乖離（M3暫定 → M11本実装）**:
| 項目 | M3暫定(現状) | M11本実装(SPEC準拠) |
|---|---|---|
| チャージraw | `max\|velocity\|`(ピーク速度) | 変位の絶対値を**積算** |
| 軸 | 生 `velocity.y/z` | `upVector`/`forwardVector` へ**射影** |
| valid判定 | チャージ分岐で未チェック | `validForScore` のみ積算 |
| デッドゾーン | なし | `verticalNoiseThreshold`/`forwardNoiseThreshold`(config新規) |

**付随する新タスク（MILESTONESへ反映）**:
- 協調 mock(`npm run mock:unity --calib`): 静止3秒→前進→チャージ中揺動 のスクリプトで、**実機が無くても mock だけで Calibration→チャージ→Result を回帰テスト**。
- 表示用リーキーメータ(M12-03/04): `gauge=gauge·e^(−dt/τ)+|dAxis|`(τ≈1s)で「振ると溜まる」演出。**採点とは分離**。

### 2026-06-21 ビルド/テスト基盤の選択
- esbuild バンドル + `node --test` で `.ts` を直接 import する構成を採用。理由・必須tsconfigフラグはメモリ [[ts-build-test-conventions]] に記録。

---

## 既知の保留事項 / TODO

- `validSampleRatioByPhase`(フェーズ別)は枠のみ。phase を Renderer→Main へ渡せば埋まる(M11/M12で検討)。
- mock-unity-bridge は現状 Calibration を完了できない(常時揺動)。→ 協調mock(--calib)で解消予定。
- 正規化レンジ(`verticalRawMax` 等)は変位[m]へ意味変更が必要。実機実測前の暫定値になる(M10で確定)。
- M9-M10 は Unity Editor / 実 mocopi の手作業が中心(コードでは完結しない)。
