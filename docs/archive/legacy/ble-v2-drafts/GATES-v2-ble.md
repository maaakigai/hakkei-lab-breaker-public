# Gates v2 (DRAFT) — mocopi BLE direct / magnitude-only

> ⚠ DRAFT・未権威。BLE probe GO 後に `SPEC.md`/`MILESTONES.md` へ権威化。旧 Unity Gate B1/B2/C/D1 は本モデルでは凍結→ `docs/legacy/`。
> 定義は Codex docs-remake review（2026-06-26）準拠。閾値の確定値はスパイク実測後（今は TODO）。

## Gate A: Baseline App（実機不要）
- Electron 起動。**keyboard fallback で Title → Result 完走**。
- `npm run typecheck && npm run lint && npm test && npm run build` 緑。config load OK。

## Gate B: BLE Probe（実機・`tools/mocopi_ble_probe.py`）
- `QM-SS1` を scan で発見・connect 成功。
- start command 後、**36 byte payload notify** を受信。
- **sample rate 45–55Hz**・10秒以上連続・counter drop 許容内。
- disconnect/reconnect が複数回成功。
- → これが**本方針全体のゲート**。No-Go なら BLE 案を見直す。

## Gate C: BLE Sidecar Integration
- sidecar が localhost packet を Main へ送信。
- Main が packet validate ＋ IMU metrics 生成（Renderer 再計算なし）。
- Renderer `InputCheck` に connected/Hz/age/baseline/accelEnergy 表示。
- sidecar 停止で **app は落ちず** timeout/error/fallback 表示。

## Gate D: Signal Quality
- **静止10秒で false trigger 0**・noise floor 記録。
- 弱/中/強パンチが数値で分離。
- valid sample ratio ≥ 95%。
- low sample rate / malformed packet / disconnect が quality flags に出る。

## Gate E: Game Loop
- 利き手1本 BLE で **Charge → HakkeiReady → Result 完走**。
- noImpact timeout が Lv0、強パンチで Lv 上昇。
- **keyboard fallback が壊れていない**。

## Gate F: Demo Readiness（本番直前・BLE採用の最終判定 / Codex reliability review 2026-06-27）
**この Gate を通って初めて BLE を本番採用する。未達なら fallback（A1 6本 / 別デバイス）へ。** 運用は **非ボンディング + connect-once-keep-alive + 自前 auto-reconnect + keyboard fallback**（イヤホン級の自動再接続は狙わない）。

### F-1 BLE Connection Gate（耐久・センサーは机置きで可＝腕不要）
- **30分連続受信**・平均 45–55Hz・payload violation 0。
- disconnect 0 が理想。出る場合は **auto-reconnect が手操作なし3秒以内に復帰**。
- **>500ms gap = 0** / >200ms gap は 30分で 10回以下。

### F-2 Demo Operation Gate（交代運用）
- 接続は**デモ開始前1回だけ**（connect-once-keep-alive）。
- **センサー貼り替え交代10回で接続維持**・交代後 baseline 再取得3秒以内。
- 10連続プレイでクラッシュ0。BLE断時もアプリ生存・3秒以内に RECONNECTING/fallback UI。

### F-3 Signal Gate
- 静止10秒 false trigger 0 / 弱・強パンチが安定分離 / 二度撃ち0 / 静止角速度 noise floor 記録。

### No-Go（→fallback判断・2回試して未達なら切替）
- 30分内に手操作が必要な切断が1回でも出る / reconnect 10秒超 / 36byte・50Hz が安定しない / 貼り替えで切れる / 静止誤発火が残る。

> reconnect policy / sidecar states(DISCONNECTED..RECEIVING..RECONNECTING..READY) / scoring policy(RECEIVING+BASELINE_READY のみ validForScore) は `agmsg-out-ble-reliability.md`(Codex) 準拠で V6 実装。
