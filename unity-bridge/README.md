# Unity Bridge（旧入力経路・比較検証用）

このフォルダは、開発初期に使用した **Unity Bridge入力経路**を比較検証用に残したものです。現行の公開版は mocopi 1台をBLEで直接読み取るため、通常の起動やポートフォリオ体験にUnityは必要ありません。現行手順は [`../docs/CURRENT_USAGE_JA.md`](../docs/CURRENT_USAGE_JA.md) を参照してください。

以下は当時の設計と再現手順です。Unity Bridgeはゲーム本体ではなく、責務を次に限定していました。

1. mocopi Receiver Plugin で mocopi モーションを受信する。
2. Humanoid Avatar へ反映する。
3. **反映後の RightHand Transform** を取得する（`LateUpdate`）。
4. RightHand ワールド座標を v1 motion JSON で `127.0.0.1:45100`（UDP）へ送る。
5. heartbeat JSON を送る。
6. Receiver / Avatar / RightHand / Hz を診断表示する。

スコア計算・動画・Result・状態管理は持ちません。

---

## 0. 同梱ファイル（このリポジトリで作成済み）

| パス | 役割 |
|---|---|
| `ProjectSettings/ProjectVersion.txt` | 基準 Unity 版（**Unity 6 / 6000.0 LTS**）。 |
| `Packages/manifest.json` | 最小パッケージ依存（ugui / animation / imgui ほか）。 |
| `Assets/Scripts/RightHandUdpSender.cs` | コア。RightHand 取得＋ v1 motion/heartbeat UDP 送信。 |
| `Assets/Scripts/BridgeStatusView.cs` | 旧入力経路の診断HUD。 |
| `Assets/Scripts/MocopiReceiverStatusBridge.cs` | Receiver Plugin の受信状態（`MocopiAvatar.FrameArrivalRate`）を渡すグルー。 |
| `Assets/Scenes/UnityBridge.unity` | 旧入力経路を確認するための同梱シーン。 |

> Unity が生成する `Library/`、`.csproj`、`obj/` 等は `.gitignore` 済みです。
> `.meta` ファイルは Unity が初回起動時に自動生成します。

---

## 1. 前提ソフトの導入

### 1-1. Unity Hub をインストール

PowerShell で:

```powershell
winget install --id Unity.UnityHub -e
```

GUI 派なら <https://unity.com/download> から Unity Hub をダウンロードしても可。
インストール後に Unity Hub を起動し、Unity ID でサインインします（**ライセンス認証が必要**：
個人なら Personal ライセンスを取得 → アクティベートまで実施してください。ここは対話操作が必要です）。

### 1-2. Unity 6 LTS Editor をインストール

Unity Hub → **Installs → Install Editor** で **Unity 6 (6000.0 LTS)** の最新パッチを選択。

- 追加モジュールは Windows 用途なら既定のままで可（Android/iOS 等は不要）。
- `ProjectVersion.txt` は `6000.0.77f1`（導入済みEditorのLTS）を指定しています。

---

## 2. プロジェクトを開く

Unity Hub → **Projects → Add → Add project from disk** で、この `unity-bridge/` フォルダを選択して開きます。
初回はインポートに数分かかります。`Assets/Scripts/*.cs` がコンパイルエラーなく通り、同梱の
`Assets/Scenes/UnityBridge.unity` を開けることを確認します。

---

## 3. mocopi Receiver Plugin for Unity（導入済み）

**v1.1.0（Apache License 2.0, 公式 https://github.com/sony/mocopi-receiver-plugin-unity）を
`Assets/MocopiReceiver/` へ導入済み**です。改めて Import する必要はありません。Unity バッチモードで
コンパイル0エラー・`com.sony.mocopi.receiver.dll` 生成を確認済み（2026-06-23）。

- 同梱物: `Runtime/`（`MocopiUdpReceiver` / `MocopiSimpleReceiver` / `MocopiAvatar`）、
  `Resources/Prefab/MocopiSimpleReceiver.prefab`。
- 公開ポートフォリオ版では容量削減のため、公式PluginのサンプルSceneとサンプルAvatarを除外しています。
  必要な場合は上記の公式配布元から同じversionのサンプルを取得してください。
- 必要 Unity: **6000.0.60f1 以降**（本プロジェクトは 6000.0.77f1）。
- mocopi のロゴ/アイコンのみ別ライセンス。コードは Apache 2.0。

> ✅ **Humanoid 互換を確認済み**: プラグインは実行時に `AvatarBuilder.BuildHumanAvatar` で Unity Humanoid
> アバターを構築し `Animator` を保持します。よって本 Bridge の
> `Animator.GetBoneTransform(HumanBodyBones.RightHand)` 経由（= Bone ID 18 を直接使わない）が
> そのまま機能します。

### 動かすには Motion Source（実機）が必要
プラグインは mocopi アプリ（モバイル/PC）＋センサーから UDP でモーションを受けます。**ハードが無い場合、
アバターは静止のまま**ですが、RightHand Transform は存在するので「座標→UDP→Electron」の配線確認は静止でも可能です。

---

## 4. Humanoid Avatar を用意する

- Receiver Plugin が反映する Avatar は **Rig = Humanoid** に設定された Animator を持つこと。
- Plugin のサンプル Avatar をそのまま使うのが簡単です。
- `RightHandUdpSender` の `avatarAnimator` にこの Avatar の `Animator` を割り当てます（未指定なら同一 GameObject から自動取得）。

---

## 5. UnityBridge.unity シーンを確認・再構成する

`Assets/Scenes/UnityBridge.unity` を同梱しています。公開版では公式PluginのサンプルSceneとサンプルAvatarを除外しているため、依存素材を再取得して構成を確認する場合は次の手順を使います。

1. 必要に応じて **File → New Scene**（Basic / Empty）から検証用シーンを作る。
2. Receiver Plugin のサンプルから **Receiver + Humanoid Avatar** をこのシーンへ配置（または流用）。
3. 空の GameObject `Bridge` を作り、次を追加:
   - `RightHandUdpSender`（`avatarAnimator` に Humanoid Animator を割当。`targetIp=127.0.0.1`, `targetPort=45100`）
   - `BridgeStatusView`（`sender` に上の `RightHandUdpSender` を割当）
   - 推奨で `MocopiReceiverStatusBridge`（`mocopiAvatar` に Plugin の `MocopiAvatar` を割当 →
     `RightHandUdpSender.receiverStatusSourceBehaviour` にこの Bridge を割当）。未設定でも座標変化からの簡易判定で動きます。

### 5-1. 実行順序（重要）

`RightHandUdpSender` は **Receiver Plugin が Avatar へ姿勢を反映した後**に RightHand を読む必要があります。
`LateUpdate` で読んでいますが、Plugin も `LateUpdate` で反映する場合は順序保証のため
**Edit → Project Settings → Script Execution Order** で
`RightHandUdpSender` を Plugin の反映スクリプトより**後ろ（大きい値）**に設定してください。

---

## 6. 動作確認（Electron なしでも可）

### 6-1. Unity単体での旧経路確認

Play して `BridgeStatusView` の HUD に次が出ることを確認:

- `Receiver / Avatar / RightHand` が `OK`
- `Send Hz` が 30Hz 以上（目標 50Hz）、`Heartbeat Hz` が 1Hz 以上
- `Last Seq` が連番で増える、`RightHand x/y/z` が手を動かすと変化する

### 6-2. UDP 受信を覗く（Electron 不要の簡易リスナー）

別の PowerShell で `45100` に来る JSON を観測できます:

```powershell
$udp = New-Object System.Net.Sockets.UdpClient(45100)
$ep  = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
while ($true) {
  $bytes = $udp.Receive([ref]$ep)
  [System.Text.Encoding]::UTF8.GetString($bytes)
}
```

> Electron Mainも `45100` で待ち受けるため、同時に起動すると
> このリスナーとポートが競合します。確認後は Ctrl+C で止めてください。

### 6-3. 実mocopi入力による旧経路確認

センサー装着 → Sensor data receiver → Motion Source App → Unity の順に起動し、
右手の上下で `y`、前後で `forward` 成分が変わることを確認します。

---

## 7. 旧送信仕様（参照）

当時の詳しい仕様は [`../docs/archive/legacy/SPEC-unity-era-20260627.md`](../docs/archive/legacy/SPEC-unity-era-20260627.md) に保存しています。本 `RightHandUdpSender.cs` の送信契約は次のとおりです。

- `protocolVersion:1`, `source:"unity-bridge"`, `sessionId`（起動ごとに発行）, `timestampMs`（**session 開始からの単調増加ms**）。
- motion: `seq`（連番）, `isTracked`, `rightHand`（未取得時は `null` の valid unavailable packet）, `avatar.{isHuman,hasRightHand,forward}`。
- heartbeat: `receiverReady`, `receiverStatus`, `avatarReady`, `rightHandReady`, `frameRate`, `sendRateHz`。
- 1 datagram は 8192 bytes 以下。座標補正（axisMap/sign/scale/offset）は **行わず**、Unity ワールド座標を素のまま送る（補正は Electron Main の責務）。

---

## 現行版との関係

- 現行版の入力は `tools/mocopi_ble_sidecar.py` からElectron Mainへ渡すBLE直読経路です。
- 通常の公開体験、QR登録、スコア、映像再生にUnity Bridgeは使用しません。
- このフォルダは、旧設計の比較、姿勢座標経路の研究、実装経緯の確認に限って保持しています。
- 現行版の起動・確認は [`../docs/CURRENT_USAGE_JA.md`](../docs/CURRENT_USAGE_JA.md) と [`../docs/verification_checklist_v2_ble.md`](../docs/verification_checklist_v2_ble.md) を参照してください。
