# Ticket #02 — ゲームの Unity Bridge モード起動時自動選択

**担当**: codex / **発行**: claude（契約定義）/ **言語**: TypeScript（既存規約に準拠）

## 目的
起動.bat からゲーム(Electron)を起動したとき、人手で UI を操作せずに
入力モードを `unity-bridge` に自動選択した状態で立ち上げる。
これにより「監視デーモンがゲームを spawn → そのまま Unity Bridge モードでプレイ開始」が成立する。

## 現状（把握済み）
- 起動時 `activeMode = "none"`（src/main/index.ts:23）。
- モード切替は IPC `setInputMode` 経由（src/main/index.ts:52-66 / `applyMode()` 39-47）。
- レンダラ側が UI 操作で `setInputMode` を呼ぶ設計。起動直後は none。

## ★設計方針（この通り実装すること）
1. **起動時のモード指定口を main に追加**：
   - 優先順: CLI 引数 `--input-mode=<mode>` → 環境変数 `HAKKEI_INPUT_MODE` → 既定 `none`。
   - 受理値は既存の `InputMode`（none / keyboard / mock-unity-bridge / unity-bridge）。不正値は無視して
     `none` にフォールバックし、`console.warn` で警告（クラッシュ厳禁）。
2. **適用タイミング**：`createReceiver()` の後（receiver 生成済みが前提、index.ts:139-149 の app.whenReady 内）。
   解決したモードを `applyMode(mode)` で適用する。
3. **レンダラ UI との同期（重要・out-of-sync を防ぐ）**：
   - 起動時に解決したモードをレンダラへ伝え、UI の選択状態が `unity-bridge` を反映するようにする。
   - 既存の IPC 設計に合わせること。`getConfig` の結果に初期モードを載せる、もしくは
     新規 IPC イベント（例 `motion:initial-mode` 相当）で push する、のいずれか。
     **レンダラ側のモード初期化処理を調査し、既存パターンに最も沿う方法を選ぶこと。**
     新規 IPC チャンネルを足す場合は `src/shared/types.ts` の `IPC` と型に正しく追加する。

## 触ってよいファイル（②は既存コード変更が前提）
- `src/main/index.ts`（起動時モード解決 + applyMode 呼び出し）
- レンダラのモード初期化箇所（`src/renderer/` 内。要調査）
- `src/shared/types.ts`（新規 IPC チャンネル/型を足す場合のみ）
- 関連テスト（`test/` に追加）
※ #03 の `src/automation/` には触らないこと（担当分離）。

## 受け入れ条件
1. `--input-mode=unity-bridge` 付き起動 → 起動直後に receiver の activeMode が `unity-bridge`、
   かつレンダラ UI が `unity-bridge` 選択を表示。
2. 引数/環境変数なしの起動 → 従来どおり `none`（既存挙動を壊さない＝回帰なし）。
3. 不正値（例 `--input-mode=foo`）→ クラッシュせず `none` にフォールバック + 警告ログ。
4. 環境変数 `HAKKEI_INPUT_MODE=unity-bridge` でも同様に効く。
5. `npm run typecheck` / `npm run lint` / `npm test` がすべて緑（既存テストの回帰なし）。

## 完了報告（agmsg で claude へ返信）
- 変更/追加ファイルのパス一覧、レンダラ同期にどの方式を採ったか、テスト結果。
- ※ 返信メッセージはシングルクォートで囲み、本文に `#` を使わないこと（前回 # 以降が欠落しました）。
