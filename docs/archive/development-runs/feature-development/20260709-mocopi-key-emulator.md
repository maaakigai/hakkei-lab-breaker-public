# 20260709 mocopi key emulator

- 対象ステップ: mocopi BLE入力のキーボードエミュレータ追加。
- 変更ファイル: `scripts/mocopi-key-emulator.mjs`, `scripts/windows/MocopiKeyboardEmulator.bat`, `docs/runs/20260709-mocopi-key-emulator.md`。
- 採用した判断: RendererのKeyboardモードではなく、Electron Mainのmocopi BLE UDP入口 `127.0.0.1:45150` へ `source="mocopi-ble"` のimu JSONを50Hzで送る。Spaceは短い腕振りburst、EnterはパンチburstとしてquaternionのX軸回転を変化させる。
- 理由・根拠: 接続テストから確認したい目的では、RendererのKeyboard fallbackではなくmocopi BLE受信経路を通す必要がある。既存の `scripts/inject-mocopi-ble.mjs` と同じpacket契約を使うことで、Mainの `MocopiBleUdpReceiver` / `MocopiBleAdapter` / `PunchInputSample` 経路を壊さずに確認できる。ターミナルはキーアップを安定して取れないため、Space押下1回を一定時間の腕振りに変換する。
- 確認結果: `node --check scripts/mocopi-key-emulator.mjs` PASS。`npm run typecheck` PASS。`npm run build` PASS。実Electron画面での手動確認は未実施。
- 手動確認: ゲームを起動し、Titleでmocopi BLEを選んでInputCheckへ進む。`scripts/windows/MocopiKeyboardEmulator.bat` を起動し、InputCheckが `CONNECTED` になることを見る。ChargeでSpaceを数回押してゲージが増えること、HakkeiReadyでEnterを押して発勁判定が進むことを確認する。終了はエミュレータ画面で `Q` または `Ctrl+C`。
- 残課題: 実mocopiの代替としてMVP/Gate通過扱いにはしない。実機BLE確認は別途必要。
