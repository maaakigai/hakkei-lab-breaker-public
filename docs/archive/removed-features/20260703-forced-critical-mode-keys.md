# Forced Critical mode keys

- 対象ステップ: Critical / SuperCritical 強制確認ショートカット
- 変更ファイル: `src/renderer/keyboardInput.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`, `HUMAN_TEST_GUIDE_JA.md`, `docs/CURRENT_USAGE_JA.md`
- 採用した判断: `Ctrl` は `CRITICAL 強制モード`、`Shift` は `SUPER CRITICAL 強制モード` のトグルとしてRendererで保持し、Ready / Charge / HakkeiReady中に明示表示する。同じキーをもう一度押すと解除し、別モードのキーを押すと切り替える。HakkeiReadyで通常のパンチ検出が成立した時、またはKeyboard debugの `Enter` 強制ショートカット時に、現在の強制モードを見てCriticalまたはSuperCriticalの強制発勁を実行する。
- 理由・根拠: 強制Critical / SuperCriticalは通常のMotionSampleやPunchInputSampleではなく、確認用の明示ショートカット結果として既に分離されている。Mainのkeyboard sample生成契約を変えず、Rendererの演出確認操作に閉じることで、通常のkeyboard fallbackとBLE入力経路への影響を避ける。
- 確認結果: `npm run typecheck` 成功。
- 手動確認: Debug UIでReadyの `姿勢を整えて` 表示へ進み、`Ctrl` でCritical強制モード表示、再度 `Ctrl` で解除、`Shift` でSuperCritical強制モード表示、再度 `Shift` で解除、Charge / HakkeiReadyへ進んでも表示が保持されることを見る。各モードON中にHakkeiReadyでmocopi BLEの拳検出、またはKeyboard debugの `Enter` により対象演出へ進むことを見る。
- 残課題: 実画面での手動確認は未実施。
