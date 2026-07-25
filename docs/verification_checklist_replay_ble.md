# BLE再プレイ確認チェックリスト

## 二回目以降の発勁反応

目的: `Result -> Play Again` と `Result -> Exit -> 開始` の両方で，BLEの前回状態を持ち越さず，二回目以降のパンチが反応することを見る．

手順:

1. `scripts/windows/release.bat` または `scripts/windows/debug.bat` で起動する．
2. mocopi BLE入力で `InputCheck -> Ready -> Charge -> HakkeiReady` まで進む．
3. `Charge` に入った瞬間，前回ゲージが一瞬残らず，0%から始まることを見る．
4. `HakkeiReady` の表示が `拳を突き出せ！` になってからパンチする．
5. すぐに `ImpactDelay` または動画再生へ進むことを見る．
6. Resultで `Play Again` を押し，2から5をもう一度行う．
7. Resultで `Exit` を押し，Titleから開始して2から5をもう一度行う．

成功条件:

- 二回目以降も `Charge` のゲージが前回値から始まらない．
- 二回目以降もHakkeiReadyでパンチするとtimeout待ちにならず，直後に次画面へ進む．
- Debug UIではHakkeiReady診断のパンチ強さが閾値を超えた後に遷移する．

失敗時に見る場所:

- Debug UIのHakkeiReady診断で `パンチ強さ` が閾値を超えているか．
- `motion:session-changed` がBLE session変更時に出ているか．
- `docs/archive/development-runs/feature-development/20260705-punch-detector-spike-finalize.md` の残課題．
