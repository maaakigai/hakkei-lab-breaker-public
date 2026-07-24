# Ticket #03 — 監視デーモン (readiness watcher)

**担当**: codex / **発行**: claude（契約定義）/ **言語**: Node + TypeScript（既存規約に準拠）

## 目的
mocopi 側の人力作業（装着・ペアリング・校正・送信開始）の完了を UDP 45100 で自動検知し、
検知したらゲーム起動コマンドを実行する。これにより「人力完了 → 自動で先へ」を実現する。

## 背景（既存資産・必ず再利用すること）
- 45100 のパケット仕様は既に確定済み。**スキーマを再実装しないこと。**
  既存の `src/main/packetValidator.ts` の `validateDatagram(text, byteLength, maxDatagramBytes)` を
  そのまま import して使う（単一の真実源を保つ／DRY）。
- 型は `src/shared/types.ts`（`UnityHeartbeatPacketV1` 等）を参照。
- 設定値の既定は `config/input.config.json`（host=127.0.0.1, port=45100, maxDatagramBytes=8192）。

## 検知する信号（readiness の定義）
`validateDatagram` の結果が `kind:"heartbeat"` で、かつ packet が以下を満たすこと：
- `source === "unity-bridge"`（mock は `mock-unity-bridge`。テスト用に許可する source を設定可能に）
- `rightHandReady === true`
- **頑健性のため AND 条件を推奨**: `receiverReady === true` かつ `avatarReady === true`
  かつ `receiverStatus === "receiving"`
- **デバウンス**: 上記を満たす heartbeat が連続 N 回（既定 3）来たら「ready 確定」とする。
  一瞬の true フリッカで誤発火しないため。

## ★最重要の設計判断：ポート競合の解決
45100 はゲーム本体（`unityBridgeUdpReceiver`）も bind する受信ポート。
監視デーモンが 45100 を握ったままだとゲームが受信できない。よって：

1. デーモンが 45100 を bind して heartbeat を監視する。
2. ready 確定したら **まず UDP socket を close して 45100 を解放する**。
3. その後にゲーム起動コマンドを spawn する（解放→起動の順序を厳守）。
4. UnityBridge.exe は 30Hz で送り続けるので、ゲーム側は再 bind 後すぐ受信を再開できる
   （数パケットの取りこぼしは heartbeat 再送で問題なし）。

## 成果物（新規ファイルのみ。既存 src を変更しないこと＝衝突回避）
- `src/automation/readinessWatcher.ts`
  - `class ReadinessWatcher`：bind/監視/デバウンス判定/`onReady` コールバック発火/socket close。
  - テストから直接叩けるよう、datagram 投入メソッド（例 `handleDatagram(text, len)`）を公開する
    （`unityBridgeUdpReceiver.ts` の `processDatagram` と同じ設計思想）。
  - `nowMs` を注入可能に（テスト容易性）。
- `src/automation/watcherMain.ts`
  - CLI エントリ。設定（port/host/source許可/debounce/起動コマンド+引数）を読み、
    `ReadinessWatcher` を起動。ready で socket close → `child_process.spawn` で起動コマンド実行。
  - 起動コマンドは引数 or 環境変数で受け取り、ハードコードしない（④の bat から渡す）。
- `test/readinessWatcher.test.ts`
  - `node --test` 形式。`.ts` 直接 import（既存規約）。

## 受け入れ条件（このテストが緑になること）
1. `rightHandReady=false` の heartbeat を複数投入 → `onReady` 発火しない。
2. readiness 条件を満たす heartbeat を N 回投入 → `onReady` がちょうど1回発火する。
3. 発火後、二重発火しない（以降の heartbeat で再発火しない）。
4. 不正 datagram（壊れた JSON 等）を投入してもクラッシュせず、発火もしない。
5. `onReady` 内で socket が close 済み（ポート解放）になっていること。
6. `npm run typecheck` / `npm run lint` / `npm test` がすべて緑。

## 完了報告の形式（agmsg で claude へ返信）
- 作成/変更したファイルのパス一覧
- テストの実行方法と結果（緑/赤）
- 設計上の判断・仕様への質問があれば明記
