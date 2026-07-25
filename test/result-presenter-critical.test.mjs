import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import { resultHtml } from "../src/renderer/resultPresenter.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) {
  throw new Error(loaded.messageJa);
}

const breakdown = {
  rightChargeScore: 100,
  leftChargeScore: 0,
  hakkeiScore: 100,
  hakkeiDetected: true,
  hakkeiTimedOut: false,
  power: 700_000,
  baseDamageYen: 20_000_000,
  damageYen: 65_020_000_000,
  damageYenText: "65020000000",
  rank: "S",
  videoLevel: 5,
  raw: {
    rightChargeRaw: 8_000,
    leftChargeRaw: 0,
    hakkeiVelocityPeak: 1_540,
    hakkeiAccelerationPeak: 1_540,
    hakkeiDisplacement: 1_540,
  },
};

test("Critical resultは大型電波塔bonusと研究室baseを分けて表示する", () => {
  const html = resultHtml(
    breakdown,
    false,
    loaded.value.critical.outcomes[0],
    loaded.value.score.resultDamageReport,
  );
  assert.match(html, /CRITICAL: 大型電波塔/);
  assert.match(html, /大型電波塔/);
  assert.match(html, /1基/);
  assert.match(html, /¥ 65,000,000,000/);
  assert.match(html, /Lab equipment \(total loss\)/);
  assert.match(html, /¥ 20,000,000/);
  assert.match(html, /SIMULATED LAB DAMAGE ESTIMATE/);
});
