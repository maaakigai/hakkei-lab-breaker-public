# Run: 両手v2 発勁検出を D案（magnitude主判定＋前方gate＋net変位）へ

実施: claude（実装）/ 設計合意: claude×codex（agmsg team=hakkei, 2026-06-25）/ HEAD前: f3ebcf2

## なぜ
実機 mocopi で左手が forward 射影の加速度不足（5.40 < 8.0）で未発火→発勁不成立。
ユーザ要望: 利き手中立・対称性厳守（片側補正NG）＋発勁だけ個別検証したい＋将来の方向別/特殊/「何もしない」隠しイベント。
codex と設計議論し **D案** に合意（純Aは方向を捨て隠しイベント不可・横払い等で誤発火、Bはforward由来の非対称、Cはキャリブ段増）。

## D案（実装内容）
`src/renderer/hakkeiDetector.ts` の単手 observe を作り直し:
- 強さ判定は **magnitude**: 瞬時 |velocity| > vMin ∧ 瞬時 |acceleration| > aMin。前方射影をやめ **左右完全対称・利き手中立**
  （左手が forward 射影で目減りする問題が解消）。
- 変位は **window端-端の net直線距離** > dMin（Σ|Δp| path長ではない。往復・震えで稼げない。chargeはΣ|Δp|のまま）。
- 方向は **ゆるい前方 gate**: net変位ベクトルの前方成分 dot(netDelta, forward) > forwardGateMin。横払い/上げ直し/構え直しの誤発火を防ぐ（検出可否のみ・スコアには不使用）。
- **netDelta ベクトルを観測に保持** → 将来の上/下/後ろ突き・特殊モーション・「何もしない」隠しイベントの方向分類 seam（[[hidden-events-direction-vision]]）。
- DualHakkeiDetector の同期・平均ロジックは不変。スコア raw は magnitude の左右平均。

## config（config/score.config.json hakkei）
- hakkeiMinForwardVelocity 1.2（|velocity| 下限）/ hakkeiMinForwardAcceleration 4.0（|accel| 下限）
- hakkeiMinForwardDisplacement 0.08→**0.10**（net距離下限）
- **hakkeiForwardGateMin 0.03（新規・前方成分gate）**
- dualHakkeiSyncWindowMs 350維持。configTypes/appConfig 追従。
- ※フィールド名は後方互換で据え置き（score/診断経路を変えないため）。意味は magnitude/net に変更（コメント明記）。

## テスト（hakkei-detector.test.mjs に D保証群を追加・計125 pass）
- magnitude対称: forward射影で弱い斜め前方の左手も magnitude で発火 / 両手横払い→前方gateで0 / 両手上方向→0 /
  速い往復（小振幅 net不足）→0 / dual 静止jitter ±2cm/±5cm 10s→0 / 片手だけ強impulse→0 / netDelta ベクトル保持。
- 既存: single hand 閾値0.10へ追従、static誤検出(M7-09)・keyboard両手Enter・縦通しResult 緑維持。
- typecheck/lint/build 緑。

## 残り / 次
- 実機で D を一括検証（発勁単体テストで左手も発火・両手成立・横/上で誤発火0を確認）。閾値は実機の手応えで微調整（vel甘ければ1.3、netDisp 0.10〜0.15、gate）。
- 将来: netDelta を使った方向別/特殊/「何もしない」隠しイベント（別チャンク）。
