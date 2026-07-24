// scripts/build.mjs
//
// esbuild で main / preload / renderer をビルドする。
//   - main / preload: Node(CommonJS)向け。electron は external。
//   - renderer: ブラウザ(IIFE)向けにバンドル（stateMachine などの import を解決）。
// 併せて renderer の静的ファイル(html/css)を dist へコピーする。
import * as esbuild from "esbuild";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const excludedVideoDirectories = new Set(["Backups", "Temp"]);

const shared = {
  bundle: true,
  sourcemap: true,
  target: "es2020",
  logLevel: "info",
};

const configs = [
  {
    ...shared,
    entryPoints: [join(root, "src/main/index.ts")],
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: join(root, "dist/main/index.js"),
  },
  {
    ...shared,
    entryPoints: [join(root, "src/preload/index.ts")],
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: join(root, "dist/preload/index.js"),
  },
  {
    ...shared,
    entryPoints: [join(root, "src/renderer/app.ts")],
    platform: "browser",
    format: "iife",
    outfile: join(root, "dist/renderer/app.js"),
  },
  {
    ...shared,
    entryPoints: [join(root, "src/renderer/settings.ts")],
    platform: "browser",
    format: "iife",
    outfile: join(root, "dist/renderer/settings.js"),
  },
  {
    ...shared,
    entryPoints: [join(root, "src/renderer/registered-users.ts")],
    platform: "browser",
    format: "iife",
    outfile: join(root, "dist/renderer/registered-users.js"),
  },
];

async function copyStatic() {
  const srcRenderer = join(root, "src", "renderer");
  const distRenderer = join(root, "dist", "renderer");
  await mkdir(distRenderer, { recursive: true });
  for (const f of [
    "index.html",
    "styles.css",
    "settings.html",
    "settings.css",
    "registered-users.html",
    "registered-users.css",
  ]) {
    await cp(join(srcRenderer, f), join(distRenderer, f));
  }
  // 動画は renderer 同階層 dist/renderer/videos/ にコピーして 'self' で参照する。
  const videosSrc = join(root, "assets", "videos");
  const videosDest = join(distRenderer, "videos");
  // 再ビルドで削除済み・差し替え済み動画を確実に反映し、古い公開素材を残さない。
  await rm(videosDest, { recursive: true, force: true });
  if (existsSync(videosSrc)) {
    await cp(videosSrc, videosDest, {
      recursive: true,
      force: true,
      filter: (source) => {
        const [topLevelDirectory] = relative(videosSrc, source).split(/[\\/]/);
        return !excludedVideoDirectories.has(topLevelDirectory);
      },
    });
  }
  // 静止画は renderer 同階層 dist/renderer/images/ にコピーして 'self' で参照する。
  const imagesSrc = join(root, "assets", "images");
  if (existsSync(imagesSrc)) {
    await cp(imagesSrc, join(distRenderer, "images"), { recursive: true, force: true });
  }
  // 音声は renderer 同階層 dist/renderer/sounds/ にコピーして 'self' で参照する。
  const soundsSrc = join(root, "assets", "Sound");
  if (existsSync(soundsSrc)) {
    await cp(soundsSrc, join(distRenderer, "sounds"), { recursive: true, force: false });
    await writeResultSfxManifest(soundsSrc, join(distRenderer, "sounds"));
  }
  console.log("copied static files -> dist/renderer");
}

async function audioFilesIn(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(wav|mp3)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "ja-JP"));
}

async function writeResultSfxManifest(soundsSrc, distSounds) {
  const normalDir = join(soundsSrc, "SFX", "result_sfx");
  const uniqueDir = join(normalDir, "Unique_SFX");
  const featuredDir = join(normalDir, "Featured");
  const normal = (await audioFilesIn(normalDir)).map((name) => `SFX/result_sfx/${name}`);
  const unique = (await audioFilesIn(uniqueDir)).map((name) => `SFX/result_sfx/Unique_SFX/${name}`);
  const featured = (await audioFilesIn(featuredDir)).map((name) => `SFX/result_sfx/Featured/${name}`);
  await writeFile(
    join(distSounds, "result-sfx-manifest.json"),
    `${JSON.stringify({ normal, unique, featured }, null, 2)}\n`,
    "utf8",
  );
}

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  await copyStatic();
  console.log("esbuild watching…");
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  await copyStatic();
  console.log("build complete");
}
