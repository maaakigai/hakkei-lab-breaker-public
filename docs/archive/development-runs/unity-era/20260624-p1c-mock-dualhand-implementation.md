# P1c mock dual-hand v2

- 対象ステップ: `P1c mock dualhand`
- 変更ファイル: `scripts/mock-unity.mjs`，`scripts/mock-unity-calib-profile.mjs`，`test/mock-unity-v2-profile.test.mjs`
- 採用した判断: `mock-unity` は既定 v1 を維持し，`--v2` 指定時だけ `protocolVersion: 2`，`leftHand`，`avatar.hasLeftHand`，`leftHandReady` を送る．`--bad` と `--calib` の既存挙動は維持する．
- 理由・根拠: Ticket P1c は実 Unity Bridge の v2 enforcement を後段に送り，mock だけを v2 両手送信可能にする指定．P1a validator と P1b MotionSampleBuilder の v2 契約を使い，Renderer / score / calibration と Unity C# は触らない．
- 採用した判断: calib profile は既存 `sampleAt` を右手互換 API として残し，追加の `sampleHandsAt` で右手を x 軸 mirror した左手を返す．
- 理由・根拠: 既存 M11-13 テストと v1 mock 経路を壊さず，P2/P3 の両手 charge / punch 検証用に同じ phase を持つ両手位置を供給できるため．
- 確認結果: `node --test test/mock-unity-v2-profile.test.mjs` PASS．`node --test test/mock-unity-calib-profile.test.mjs` PASS．`npm.cmd run typecheck` PASS．`npm.cmd run lint` PASS．`npm.cmd test` PASS，107 tests．`npm.cmd run build` PASS．
- 注意: `npm` は PowerShell 実行ポリシーで `npm.ps1` がブロックされたため，Windows の `npm.cmd` で検証した．`node --test` と `build` は sandbox の子プロセス起動制限で EPERM になったため，権限付きで再実行した．
- 残課題: 実 Unity Bridge の v2 送信と score 側の両手消費は後段で扱う．
