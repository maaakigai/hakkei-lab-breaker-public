import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(root, "src", "renderer", "app.ts"), "utf8");

test("VideoPlayback entry saves and starts ranking sync before the result screen", () => {
  assert.match(
    appSource,
    /if \(next === "VideoPlayback"\) \{\s*prepareVideoForPlayback\(\);\s*preSyncResultRanking\(\);\s*\}/,
  );
});

test("Result entry keeps score sync idempotent and notifies the phone separately", () => {
  assert.match(
    appSource,
    /case "Result": \{\s*const savedScore = ensureResultSaved\(\);\s*if \(savedScore !== null\) \{\s*void syncResultRanking\(savedScore\);\s*maybeNotifyPhoneResult\(savedScore\);\s*\}/,
  );
  assert.match(appSource, /path: "\/api\/session-complete"/);
  assert.match(appSource, /path: "\/api\/session-result-reveal"/);
  assert.match(
    appSource,
    /phoneResultNotifyInFlight = syncResultRanking\(saved\)\s*\.then\(\(synced\) => synced && notifyPhoneResult\(saved\)\)/,
  );
});
