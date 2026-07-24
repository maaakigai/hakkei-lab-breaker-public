// test/smoke.test.mjs
// M0-13 の最小テスト土台。node:test 組み込みランナーを使う（追加依存なし）。
// 後続マイルストーンで stateMachine / validator / score の単体テストをここに足していく。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("package.json は最小スクリプトを備える", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const s of ["build", "typecheck", "lint", "test", "dev", "mock:unity", "mock:unity:calib"]) {
    assert.ok(pkg.scripts[s], `script "${s}" が存在する`);
  }
  assert.equal(pkg.main, "dist/main/index.js");
});

test("Electron エントリの想定パスが main と一致する", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.match(pkg.main, /^dist\/main\/index\.js$/);
});
