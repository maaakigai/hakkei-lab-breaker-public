import type { InputMode } from "../shared/types.ts";

const INPUT_MODES: readonly InputMode[] = ["none", "keyboard", "mock-unity-bridge", "unity-bridge"];
const CLI_PREFIX = "--input-mode=";

function isInputMode(value: string): value is InputMode {
  return (INPUT_MODES as readonly string[]).includes(value);
}

/** CLI has priority over the environment; an invalid explicit value safely selects none. */
export function resolveStartupInputMode(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): InputMode {
  const cli = argv.find((arg) => arg.startsWith(CLI_PREFIX));
  const requested = cli === undefined ? environment.HAKKEI_INPUT_MODE : cli.slice(CLI_PREFIX.length);
  if (requested === undefined || requested.length === 0) return "none";
  if (isInputMode(requested)) return requested;
  warn(`[main] Invalid input mode "${requested}"; falling back to none.`);
  return "none";
}
