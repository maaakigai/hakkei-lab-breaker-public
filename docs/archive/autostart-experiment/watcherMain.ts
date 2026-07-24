import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigBundle } from "../main/appConfig.ts";
import type { BridgePacketSource } from "../shared/types.ts";
import { ReadinessWatcher } from "./readinessWatcher.ts";

type CliOptions = {
  host: string;
  port: number;
  maxDatagramBytes: number;
  source: BridgePacketSource;
  debounceCount: number;
  command: string;
  commandArgs: string[];
};

function usage(): string {
  return "Usage: watcherMain --command <game-command> [args...] [--host HOST] [--port PORT] [--source unity-bridge|mock-unity-bridge] [--debounce N]";
}

function integerOption(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

export function parseWatcherArgs(args: string[], defaults: Omit<CliOptions, "command" | "commandArgs">): CliOptions {
  let host = defaults.host;
  let port = defaults.port;
  let source = defaults.source;
  let debounceCount = defaults.debounceCount;
  let command: string | null = null;
  let commandArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--command") {
      command = args[index + 1] ?? null;
      commandArgs = args.slice(index + 2);
      break;
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === "--host") host = value;
    else if (arg === "--port") port = integerOption(value, "port", 1);
    else if (arg === "--debounce") debounceCount = integerOption(value, "debounce", 1);
    else if (arg === "--source" && (value === "unity-bridge" || value === "mock-unity-bridge")) source = value;
    else if (arg === "--source") throw new Error("source must be unity-bridge or mock-unity-bridge");
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }

  if (command === null || command.length === 0) throw new Error(usage());
  return { host, port, maxDatagramBytes: defaults.maxDatagramBytes, source, debounceCount, command, commandArgs };
}

export function runWatcher(args: string[] = process.argv.slice(2)): void {
  const configResult = loadConfigBundle(resolve(process.cwd(), "config"), Date.now());
  if (!configResult.ok) throw new Error(configResult.messageJa);
  const udp = configResult.value.input.udp;
  const options = parseWatcherArgs(args, {
    host: udp.host,
    port: udp.port,
    maxDatagramBytes: udp.maxDatagramBytes,
    source: "unity-bridge",
    debounceCount: 3,
  });

  const watcher = new ReadinessWatcher({
    host: options.host,
    port: options.port,
    maxDatagramBytes: options.maxDatagramBytes,
    source: options.source,
    debounceCount: options.debounceCount,
    onSocketError: (error) => console.error(`[readiness-watcher] UDP error: ${error.message}`),
    onReady: () => {
      // ReadinessWatcher calls this only after its UDP socket has closed.
      const child = spawn(options.command, options.commandArgs, { stdio: "inherit", shell: false });
      child.on("error", (error) => console.error(`[readiness-watcher] Game launch failed: ${error.message}`));
    },
  });
  watcher.start();
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runWatcher();
  } catch (error) {
    console.error(error instanceof Error ? error.message : usage());
    process.exitCode = 1;
  }
}
