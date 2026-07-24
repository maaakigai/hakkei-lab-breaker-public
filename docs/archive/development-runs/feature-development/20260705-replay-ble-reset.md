# 20260705 replay BLE reset

- 対象ステップ: 二回目以降のプレイでパンチが反応しない不具合修正
- 変更ファイル: `src/main/mocopiBleUdpReceiver.ts`, `src/main/index.ts`, `src/renderer/app.ts`, `test/mocopi-ble-udp-receiver.test.mjs`
- 採用: `Charge`入場前に`store.chargeRaw`を0へ戻し，描画後のリセットをやめる．
- 理由: 描画後に`startStateTimers()`で0へ戻していたため，二回目以降のCharge画面で前回ゲージが一瞬表示されてから空に戻っていた．
- 採用: `app:reset-play`で`MocopiBleUdpReceiver`のadapterもresetする．
- 理由: mocopi BLE経路はMain側adapterが前回quaternion，seq，timestampを保持するため，再プレイ境界ではkeyboard/Unity adapterと同じく連続状態を切る必要がある．
- 確認: `npm.cmd run typecheck` PASS，`npm.cmd test -- --test-name-pattern=mocopi-ble` PASS，`npm.cmd run lint` PASS，`npm.cmd run build` PASS．
- 確認: `npm.cmd test` は1件失敗．原因は今回未変更の`assets/videos/LV5/fx_hadoken_seed2026.mp4`削除状態により，`test/config-loader.test.mjs`のLV5候補確認が落ちたため．
- 残課題: 実機mocopiで二回連続プレイし，二回目Charge入場時にゲージ残りが出ないこと，HakkeiReadyでパンチが検出されることを見る．LV5動画削除状態は別作業で整理する．
