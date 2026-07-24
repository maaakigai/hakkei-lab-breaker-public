import assert from "node:assert/strict";
import test from "node:test";
import { resolveStartupInputMode } from "../src/main/startupInputMode.ts";

test("CLI input mode takes priority and accepts unity-bridge", () => {
  assert.equal(
    resolveStartupInputMode(["electron", "app", "--input-mode=unity-bridge"], { HAKKEI_INPUT_MODE: "keyboard" }),
    "unity-bridge",
  );
});

test("environment input mode is used when CLI is absent", () => {
  assert.equal(resolveStartupInputMode(["electron", "app"], { HAKKEI_INPUT_MODE: "unity-bridge" }), "unity-bridge");
});

test("missing input mode remains none", () => {
  assert.equal(resolveStartupInputMode(["electron", "app"], {}), "none");
});

test("invalid explicit input mode warns and falls back to none", () => {
  const warnings: string[] = [];
  const mode = resolveStartupInputMode(
    ["electron", "app", "--input-mode=not-a-mode"],
    { HAKKEI_INPUT_MODE: "unity-bridge" },
    (message) => warnings.push(message),
  );
  assert.equal(mode, "none");
  assert.equal(warnings.length, 1);
});
