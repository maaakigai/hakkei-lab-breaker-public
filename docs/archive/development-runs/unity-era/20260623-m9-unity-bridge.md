# 20260623 M9 Unity Bridge最小実装 — コード完了と実機ライブ確認の引き継ぎ

## 対象ステップ
M9（Unity Bridge最小実装）M9-01〜M9-10。SPEC §6 / §0.22 / §7、AGENTS §9。

## 結論
**コード完了・契約クロス検証済・実機 Gate B1 / B2 ともに PASS。M9 完了。**
（当初は人手のライブ確認を残課題としていたが、2026-06-23 に実機で確認完了。下記「ライブ確認結果」参照。）

## ライブ確認結果（2026-06-23）
実機: mocopi センサー6 + Sensor data receiver + **mocopi PC app**（= SPEC §3.2 / §21 Q-01 の暫定標準。
AGENTS §3 非目標のスマホ直送ではなく規約準拠経路）。Unity 6000.0.77f1 で Play。

- **Scene 最終配線**: `MocopiAvatar` オブジェクトに `MocopiReceiverStatusBridge` を追加し、
  `mocopiAvatar`=MocopiAvatar、`RightHandUdpSender.receiverStatusSourceBehaviour`=その Bridge を割当。
  Script Execution Order で `RightHandUdpSender`=100（Default Time より後）に設定。コンパイル0エラー。
- **Gate B1（Unity 単体）PASS**: HUD で `Receiver=OK(receiving)` / `Avatar=OK` / `RightHand=OK`、
  `Send Hz≈50` / `Heartbeat Hz=2`。右手を上下/前後/左右に動かすと `pos x/y/z` が追従。
  データ経路は mocopi PC app → UDP `127.0.0.1:12351`（Scene の MocopiSimpleReceiver ポート）。
- **Gate B2（Electron 連携）PASS**: `scripts/windows/run-dev.bat` で Electron 起動 → 入力モード `unity-bridge` →
  InputCheck が motion受信 OK / 受信 50.0Hz / heartbeat OK(receiving) / rightHandReady OK /
  invalidPacket 0 / validSampleRatio 100% / quality flags なし。実 packet のみで OK（Mock 不使用）。

### 観測メモ（M10 / Gate D1 へ送る）
- jitter が raw rms≈106mm / filtered≈99mm、drift raw≈187mm / filtered≈165mm と高め（config 閾値
  rawJitterRms2sMaxM=0.05 / filteredJitterRms2sMaxM=0.03 を超過）。ただし測定中に体が動いていた可能性が高く、
  **静止2秒での正式測定は未実施**。Gate D1 の静止 jitter 判定と閾値チューニングは M10 で行う。
- Electron 側 heartbeat 実測が 1.3Hz 表示（Unity 自己申告 2Hz）。1Hz 下限は満たすため B2 は問題なし。
  測定窓のタイミング差。M10 で要観察。

## M9 サブタスクの状態

| ID | 内容 | 状態 |
|---|---|---|
| M9-01 | Unity Bridge プロジェクト | ✅ `unity-bridge/` 存在（Unity 6000.0.77f1 LTS） |
| M9-02 | Receiver Plugin 導入 | ✅ `Assets/MocopiReceiver/` 導入済（Sample Scene あり） |
| M9-03 | Humanoid Avatar 設定 | ✅ Scene に Humanoid rig + `MocopiAvatar` + `MocopiSimpleReceiver` 配線済（実動作はライブ確認） |
| M9-04 | RightHand Transform 取得 | ✅ `RightHandUdpSender.UpdateAvatarState()` |
| M9-05 | `LateUpdate` 取得 | ✅ 反映後座標を `LateUpdate` で読む |
| M9-06 | UDP 送信 | ✅ + 契約テストで validator 通過を検証 |
| M9-07 | seq 連番 | ✅ + 契約テストで検証 |
| M9-08 | heartbeat 送信 | ✅ + `MocopiReceiverStatusBridge` を実プラグイン連携に置換 |
| M9-09 | BridgeStatusView | ✅ OnGUI で Receiver/Avatar/RightHand/Hz/Target/Seq/座標を表示 |
| M9-10 | Bone ID 18 非使用レビュー | ✅ `Animator.GetBoneTransform(HumanBodyBones.RightHand)` 経由のみ |

## 変更ファイル
- `unity-bridge/Assets/Scripts/MocopiReceiverStatusBridge.cs`: TODO スタブを実装に置換。
  `MocopiAvatar.FrameArrivalRate`（直近1秒の到着フレーム数）を読み、`receiving` / `stale` / `not-started`
  を実データから判定。SerializeField を `mocopiReceiverComponent`(MonoBehaviour) →
  `mocopiAvatar`(MocopiAvatar) + `staleSeconds` に変更。
- `test/unity-bridge-contract.test.mjs`（新規）: `RightHandUdpSender.cs` が出力する motion(tracked /
  unavailable) / heartbeat の JSON 文字列を「バイト列まで再現」した golden を `validateDatagram` に通し、
  motion/heartbeat として受理されること・rightHand=null 許容・maxDatagramBytes 以内を検証。

## 採用した判断と理由
- **受信判定に `FrameArrivalRate` を採用**: Plugin の `MocopiSimpleReceiver` は `MocopiUdpReceiver` を
  private 生成し受信イベントを公開しないが、`MocopiAvatar.FrameArrivalRate` は public で直近1秒の到着
  フレーム数を返す。これが「受信中か」を最も素直に表す（>0=receiving）。SPEC §7.4 の receiverStatus に対応。
- **契約をバイト単位の golden でテスト**: M9 最大のリスクは Unity の JSON 文字列が Electron validator と
  食い違うこと。C# の `FormatFloat("0.######")`（末尾ゼロ無し、`1`/`0` 整数表記）や key 順、rightHand=null、
  avatar.forward を実出力どおりに固定し、C# のフォーマットを変えたらテストが落ちるようにした。
- **フィールド名変更の安全性確認**: Scene(`UnityBridge.unity`) は `MocopiReceiverStatusBridge` を未配置で、
  `RightHandUdpSender.receiverStatusSourceBehaviour` も未割当(`fileID:0`)だったため、旧 `mocopiReceiverComponent`
  への参照は存在せず、フィールド名変更による配線破壊は無い。

## 確認結果
- `npm run typecheck` / `npm run lint` / `npm run build` 緑。`npm test` 79 pass / 0 fail（契約テスト4件追加）。
- C# はコンパイル未実施（Unity Editor 必須）。プラグイン API（`MocopiAvatar.FrameArrivalRate` / `Animator`）は
  `Assets/MocopiReceiver/Runtime/MocopiAvatar.cs:298,308` で確認済み。

## 残課題 — 人手で行う実機ライブ確認（Gate B1 / B2）
本環境では Unity Editor も mocopi 実機も動かせないため、以下は手作業。`docs/verification_checklist.md` の
Gate B1 / B2 欄に記録する。

1. **Scene 仕上げ（推奨）**: `UnityBridge.unity` に `MocopiReceiverStatusBridge` を1つ追加し、
   `mocopiAvatar` を MocopiAvatar に、`RightHandUdpSender.receiverStatusSourceBehaviour` をその Bridge に
   割り当てる。未割当のままでも RightHand の動きからの簡易推定で動くが、receiverStatus が実状態にならない。
2. **コンパイル確認**: Unity Editor でプロジェクトを開き、`Assets/Scripts/*.cs` がエラー無くコンパイルされる。
3. **Gate B1**: mocopi PC app / XYN Motion Studio + Sensor data receiver を起動 → Avatar が動く →
   BridgeStatusView に Receiver=OK / Avatar=OK / RightHand=OK と座標・Send Hz・Heartbeat Hz が出る。
4. **Gate B2**: Electron を `activeMode="unity-bridge"` で起動し、実 Unity Bridge packet だけで InputCheck OK。
   Mock では代替不可（SPEC §0.21）。

## 次工程
M10（mocopi 実機入力検証・閾値実測チューニング、M10-01 Motion Source App 選定が未着手）。
スタンドアロン配布が必要なら `Assets/Editor/BuildBridge.cs` で `UnityBridge.exe` をビルド（要 Editor クローズ）。
