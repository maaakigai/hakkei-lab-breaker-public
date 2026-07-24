// scripts/launch-electron.mjs
//
// Electron をウィンドウ付きで起動するためのランチャ。
// 環境によっては ELECTRON_RUN_AS_NODE=1 が設定されており、これがあると
// electron.exe が「素のNode」として動きウィンドウが出ない。ここで確実に除去する。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// require('electron') は実行ファイルへの絶対パス文字列を返す。
const electronExe = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExe, [root, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("close", (code) => process.exit(code ?? 0));
