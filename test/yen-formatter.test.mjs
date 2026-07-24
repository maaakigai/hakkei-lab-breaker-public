import test from "node:test";
import assert from "node:assert/strict";

import { formatBigIntYen } from "../src/renderer/yenFormatter.ts";

test("formatBigIntYen: comma separated full value", () => {
  assert.equal(formatBigIntYen(15680000000078000000n), "15,680,000,000,078,000,000");
});

test("formatBigIntYen: keeps every digit for large damage", () => {
  const value = 15680000000078000000n;
  assert.equal(formatBigIntYen(value).replace(/,/g, ""), value.toString());
});
