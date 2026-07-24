# 2026-06-27 BLE 直読スパイク結果（Gate B = PASS）＋信号は角速度

## 結論
**mocopi 1 個 BLE 直読は GO**（Gate B PASS）。ただし **パンチ/運動の信号はクォータニオン角速度**で取る（packet の「accel」フィールドは動きに無反応で使えない）。

## 経緯
- `tools/mocopi_ble_probe.py`（自作・moslime のプロトコル事実のみ使用・コード非流用）で実機検証。
- Windows BLE のハマり: **ペアリングすると advertising 停止 → scan に出ない**。Windows 設定で「デバイスの削除」して青点滅(advertising)のまま放置 → bleak が直接 connect。
- 接続は **BLEDevice 経由（find_device_by_address）＋接続リトライ**で安定化。**静止でスリープ**するため接続確立まではセンサーを振って起こす。**接続後は静止でも 50Hz ストリーム継続**。

## 計測（ble-raw3.csv・静止→パンチ）
| 区間 | 角速度 deg/sample | deg/s 換算 |
|---|---|---|
| 静止 (sec4-9) | mean 0.02 / max 0.04 | ~2°/s |
| パンチ (sec10-17) | mean 5-6.5 / max 16-17 | ~800°/s |
- **分離比 約400x**（GO 基準 5x を圧倒）。パンチ強弱も peak 角速度で段階付け可能。
- rate 50.0Hz・payload 36byte 違反 0。

## パケット解析（生 hex オフライン解析で確定）
- `[8..15]`=quaternion 現在(int16×4, /8192)、`[16..23]`=quaternion 前回。**quaternion は安定(unit norm)**。
- `[24..35]`=「accel」とされるフィールドだが、**int16/float16/uint16 どの解釈でも振っても静止でも norm がほぼ一定で動きに無反応**（moslime も accel 軸は「未同定」と明記）。→ **線形加速度としては使えない**。
- **採用信号 = 連続 quaternion 間の回転角**（`2*acos(|dot(q_t, q_{t-1})|)`）。= 角速度。静止≈0、運動で大きく上がる。

## 設計への反映（SPEC v2）
- **パンチ強さ** = ウィンドウ内 **peak 角速度**。**charge（運動量）** = 角速度の時間積分。重力/accel 差し引きは不要に。
- packet 契約 `MocopiBlePacketV1` は **quaternion を必須**にし、`accelRaw/accelMagnitude` は参考（信頼しない）。Main が quaternion から角速度・peak・積分を生成（Renderer 再計算しない）。
- `PunchInputSample.strength` は「accelEnergy」名から **source 非依存の intensity（角速度由来）** へ寄せる（V4 BLE adapter 実装時に整理）。keyboard adapter は擬似変位ベースのままで可（同じ intensity スカラに正規化）。

## 接続信頼性（sidecar 実機・2026-06-27 追記）
`tools/mocopi_ble_sidecar.py`（auto-reconnect・非ブロッキング）で検証:
- **定常**: 60秒 50.0Hz・**最大 gap 90ms・>200ms gap 0・切断0**（rock solid）。
- 重要: 前回 probe stress の gap(330ms/7回)は**通知コールバック内 CSV 書き込みの自爆**。非ブロッキング sidecar では gap 90ms に改善＝実際の接続は当初印象より安定。
- **自動再接続**: 強制切断5回すべて手操作なしで自動復帰・アプリ生存。**センサー在の再接続 ~1.0-1.2s**（<3s 達成）。6.7s/14.0s は「センサーを実際にその秒数 OFF/別室にしていた不在時間」を含む値（sidecar の遅延ではない）。
- 結論: connect-once-keep-alive + auto-reconnect + keyboard fallback で**有人デモ実用可**（イヤホン級シームレスは出ない）。
- TODO(tooling): sidecar の再接続メトリクスは「センサー不在時間」と「再接続オーバヘッド」を分離して F-1 を公平に測る。本番前に 30分定常耐久(机置き無人)で spontaneous drop 率を確認。

## 残リスク / 次
- 接続前 advertising が不安定（要シェイク・リトライ）。本番運用は「開始前に振って接続→以後安定」＋keyboard fallback。Gate F で再接続手順を runbook 化。
- 次: SPEC/AGENTS v2 権威化（V1）→ sidecar は quaternion を送る（probe の --emit-udp を流用）→ Main で角速度 metrics → renderer magnitude-only（角速度版）。app.ts 大改修（V3b-d）に GO 確信を持って着手可。
