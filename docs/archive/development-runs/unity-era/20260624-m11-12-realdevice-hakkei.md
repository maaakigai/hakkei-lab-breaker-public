# 20260624 M11-12 実機発勁テスト（複合判定の実機確認）

## 対象
M11-12（実機 mocopi での発勁検出確認）。M11-06〜09 で発勁が複合条件（forwardVector 射影の
速度＋加速度＋過去 hakkeiWindowMs 変位＋cooldown / SPEC §13.6・§14.3）になった後の実機妥当性。

## 環境
- このデスクトップに mocopi センサー6個＋レシーバー実機あり（[[mocopi-realdevice-desktop]]）。
- 経路: mocopi PC app（「このPCに接続」=127.0.0.1 / ポート 12351）→ Unity 6000.0.77f1（UnityBridge.unity / Play）
  → UDP 45100 → Electron（`npm run dev`・unity-bridge モード）。
- InputCheck: motion受信OK / 受信50.0Hz / heartbeat OK / rightHandReady OK / invalidPacket 0 / validSampleRatio 100%。

## 結果（PASS）
- **静止発勁誤検出（Gate D1 / SPEC §0.16.1）**: `staticFalseHakkeiCount10s = 0`（評価 500 sample）→ **PASS**。
  新複合検出器は実機静止で誤発火しない。
- **鋭い突き → 発勁検出される**（狙いどおり発火）。
- **緩い突き → 発勁検出されない**（複合条件で正しく弾く）。
- 結論: 複合発勁判定は実機で意図どおり弁別する。M11-12 合格。

## 留意 / 残
- jitter は静止2秒測定で raw rms 2mm 級（M10-06 実績）。プレイ中表示の高値は体動由来。
- 正規化レンジ（verticalRawMax=20 / forwardRawMax=9）・デッドゾーン 0.003 は M10 実測で確定済み。複合発勁化後も
  発火感に問題なし（緩い突き非発火・鋭い突き発火）。現状 config 変更不要。
- 別途ユーザー要望: 上下／前後／突きの各アクション前に ~3秒の猶予時間（構え時間）を入れる
  → 別チケットで対応（SPEC/stateMachine/テスト同時更新）。
