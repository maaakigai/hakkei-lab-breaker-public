# 20260705 punch detector spike finalize

- 対象ステップ: 二回目以降のプレイでHakkeiReadyのパンチが反応しない不具合の追加調査
- 変更ファイル: `src/renderer/punchCore.ts`，`src/renderer/app.ts`，`src/main/mocopiBleUdpReceiver.ts`，`src/main/index.ts`，`src/shared/types.ts`，`test/punch-core.test.mjs`，`test/mocopi-ble-udp-receiver.test.mjs`，`docs/verification_checklist_replay_ble.md`
- 採用した判断1: `PunchDetector` はスパイク立ち上がり後，stop閾値未満への減衰を待つだけでなく，無効sample到着時または180ms保持時にも追跡済みピークで発火確定する．
- 理由・根拠1: 既存修正でCharge入場時のゲージ残りとBLE baseline resetは対処済みだったが，実機BLEではピーク後の減衰sampleが欠ける，または `validForScore=false` になると `inSpike` が残り，HakkeiReady中に即時遷移しない可能性が残っていた．SPEC.md 365行付近の `validForScore=true` sampleだけを使う契約は維持し，無効sample自体の強さは採用せず，直前までに追跡した有効ピークだけを確定する．
- 採用した判断2: `Result -> Title` の `finish` 経路でも `resetPlayState()` を通し，Mainの `app:reset-play` を呼ぶ．
- 理由・根拠2: `replay/reset/esc` はプレイ境界としてRendererとMainの状態を切っていたが，`finish` はResult動画だけを消しており，Titleへ戻ってから再開した場合にBLE adapterの連続状態が残る可能性があった．
- 採用した判断3: BLE packetの `sessionId` 変化時に `MocopiBleUdpReceiver` がadapterをresetし，`motion:session-changed` をRendererへ通知する．
- 理由・根拠3: Unity経路はsession変更でbuilderをresetしRendererへ通知するが，BLE経路は `prevQuat`，`prevTs`，`prevSeq` を持つstateful adapterなのにsession境界を見ていなかった．BLEでも入力連続性はMain側で切る必要がある．
- 確認結果: `npm.cmd run typecheck` PASS．`npm.cmd test -- --test-name-pattern=PunchDetector` PASS．`npm.cmd test -- --test-name-pattern=mocopi-ble` PASS．`npm.cmd run lint` PASS．`npm.cmd run build` PASS．`npm.cmd test` PASS．
- 残課題: 実機mocopi BLEで二回連続プレイし，二回目のHakkeiReadyでパンチ直後にImpactDelayへ進むことを確認する．
