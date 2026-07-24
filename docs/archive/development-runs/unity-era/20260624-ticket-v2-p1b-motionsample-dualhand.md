# Ticket: 両手v2 P1b — MotionSample 両手モデル＋builder/filter 左右独立

担当: codex / 起票: claude / 2026-06-24
親設計: docs/runs/20260624-design-dualhand-v2.md / 前段: P1a（packet v2 契約・コミット 16cf927）

## このチャンクの方針
Main が **左手の position/velocity/acceleration/availability/validity を右手と独立に生成**できるようにする。
**後方互換**を保ち（既存の右手フィールドはそのまま＝既存の renderer/score/hakkei/diagnostics 消費側は無変更で green）、
**左手データを追加**する。score/calibration/renderer/mock の挙動はこのチャンクでは変えない（P2/P3/P1c）。

## 現状
- `MotionSample`（src/shared/types.ts L30付近）は単一の手: `rawHandPosition/handPosition/velocity/acceleration/isAvailable/validForScore/validForCalibration/quality`。
- `MotionSampleBuilder`（src/main/motionSampleBuilder.ts）は packet(V1|V2) を受けるが **rightHand だけ**消費（P1a で型は V1|V2 受理済み）。`MotionFilter` を1つ保持。
- `MotionFilter`（src/main/motionFilter.ts）は1手ぶんの EMA/外れ値/速度/加速度/jitter 状態。

## 要件
1. **型（types.ts）**: `MotionSample` に**左手データを追加（後方互換・既存の右手フィールドは据え置き＝右手の意味のまま）**。
   推奨: `leftHand: HandMotion | null` を追加（`HandMotion = { rawHandPosition, handPosition, velocity, acceleration, isAvailable, validForScore, validForCalibration, quality? }`）。
   ※既存トップレベルのフィールドが「右手」を表す、と型コメントに明記。左手は V2 packet の leftHand 由来、V1/左手 unavailable 時は `leftHand=null` または isAvailable=false。
2. **builder（motionSampleBuilder.ts）**: V2 packet で leftHand があれば**左手の MotionSample 相当を独立生成**（右手と同じ dt/EMA/外れ値/速度/加速度/validity ロジック）。
   - **左右で MotionFilter インスタンスを分ける**（片手の外れ値・dtリセット・baseline が他方に影響しない）。
   - V1 packet（leftHand 無し）や左手 unavailable のときは左手 = unavailable（null か isAvailable=false で座標保持/速度0、右手の unavailable と同じ扱い）。
   - **右手の出力は完全に従来通り**（既存テストが緑のまま）。
3. **filter（motionFilter.ts）**: 1手ぶんのロジックは変更不要なら据え置き。builder が2インスタンス持てる形にする（必要なら最小リファクタ）。
4. **触らない**: renderer / playAccumulator / hakkeiDetector / calibrationManager / scoreCalculator / mock / SPEC の score 章。
   （左手を実際に使うのは P2 Calibration・P3 Score。mock の両手化は P1c。）

## テスト（test/・node --test）
- builder: **V2 packet（両手）から左手 MotionSample が右手と独立に生成される**（位置追従・速度・加速度・validForScore）。
- **左右独立**: 片手だけ位置 jump（外れ値）させても他方の validForScore/filtered は汚れない。
- V1 packet（または hasLeftHand=false）→ 左手 unavailable（既存右手の unavailable と同じ挙動）。
- 右手出力は従来テストどおり不変（回帰）。
- 既存テストは全 green のまま新規追加。

## 不変ルール
- 後方互換（既存右手フィールド・消費側・既存テストを壊さない）。MotionSample の右手意味は不変。
- `MotionSample`・速度・加速度・filter・validity は **Main 生成**（Renderer 再計算禁止）。
- TS3規約（`import type` / constructor 省略記法・enum 禁止 / 相対 import は `.ts`）。
- commit/push しない（claude が区切りでコミット）。

## 検証 / 報告
- `npm run typecheck && npm run lint && npm test && npm run build` 全緑。
- 報告は **agmsg のファイル経由送信**（`send.sh hakkei codex claude "$(cat 一時ファイル)"`）で、変更ファイル/テスト結果(pass数)/設計判断/残TODO。
- **詰まったら停滞せず即 agmsg で相談**（巻き取ります）。P1c 以降はまだ着手しない。
