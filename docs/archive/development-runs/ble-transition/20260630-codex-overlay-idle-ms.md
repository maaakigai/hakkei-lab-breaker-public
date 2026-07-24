codex_overlay measurement idleMs

- 対象ステップ: codex_overlay 計測へ idle 時間をそのまま流す変更。
- 変更ファイル: `src/shared/punchInput.ts`, `src/main/punchInputAdapter.ts`, `src/main/mocopiBleAdapter.ts`, `src/renderer/app.ts`, `test/punch-input-adapter.test.mjs`, `test/mocopi-ble-adapter.test.mjs`。
- 採用: `PunchInputSample.idleMs` を Main 生成の連続 idle 時間として追加し、Renderer の計測 buffer/export は `sample.idleMs` を再計算せず保存する。
- 理由: 本リポジトリの契約は Main が input metrics を生成し Renderer は消費するだけなので、overlay 側で idle 判定を再実装しない。BLE は seq 差から得た実効 `dtMs` を静止中に加算し、keyboard/unity 系は `MotionSample.quality.dtMs` を加算する。
- 根拠: `AGENTS.md` 1.1 / 5.3、`SPEC.md` 0.24 draft の Main-generated metrics 方針。
- 確認: `npm run typecheck` 成功。`node --test test/punch-input-adapter.test.mjs test/mocopi-ble-adapter.test.mjs` 成功。
- 手動確認: mocopi BLE の InputCheck で「手動計測」を開始し、数秒静止してから JSON export する。画面の idle 秒数が増え、export した `samples[].idleMs` が増加していること、動かした直後に 0 へ戻ることを確認する。
- 残課題: `codex_overlay` という外部識別子は現コード上に存在しないため、現行の計測 overlay/export payload への反映として扱った。
