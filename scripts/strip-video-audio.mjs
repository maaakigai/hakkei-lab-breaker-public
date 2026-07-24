// Removes audio tracks from public portfolio videos without re-encoding their
// video streams. Requires ffmpeg and ffprobe on PATH.

import { existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm"]);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function probe(path) {
  return JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,width,height",
      "-of",
      "json",
      path,
    ]),
  );
}

function videoStreamMd5(path) {
  return run("ffmpeg", [
    "-v",
    "error",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-f",
    "md5",
    "-",
  ]);
}

const videoFiles = run("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "--",
  "assets/videos",
  "docs/media",
])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((path) => resolve(root, path))
  .filter(existsSync)
  .filter((path) => videoExtensions.has(extname(path).toLowerCase()))
  .sort();

let changedCount = 0;

for (const videoPath of videoFiles) {
  const absolutePath = resolve(videoPath);
  if (!absolutePath.startsWith(`${root}\\`) && !absolutePath.startsWith(`${root}/`)) {
    throw new Error(`Video escaped workspace: ${absolutePath}`);
  }
  if (!statSync(absolutePath).isFile()) {
    throw new Error(`Video target is not a file: ${absolutePath}`);
  }

  const before = probe(absolutePath);
  const beforeVideo = before.streams.find((stream) => stream.codec_type === "video");
  const hasAudio = before.streams.some((stream) => stream.codec_type === "audio");
  if (!beforeVideo) {
    throw new Error(`No video stream: ${absolutePath}`);
  }
  if (!hasAudio) {
    continue;
  }

  const temporaryPath = join(
    dirname(absolutePath),
    `.silent-video-${randomUUID()}${extname(absolutePath)}`,
  );

  try {
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      absolutePath,
      "-map",
      "0:v:0",
      "-map_metadata",
      "0",
      "-map_chapters",
      "0",
      "-c:v",
      "copy",
      "-an",
      "-movflags",
      "+faststart",
      temporaryPath,
    ]);

    const after = probe(temporaryPath);
    const afterVideo = after.streams.find((stream) => stream.codec_type === "video");
    if (after.streams.some((stream) => stream.codec_type === "audio")) {
      throw new Error(`Audio stream remained: ${absolutePath}`);
    }
    for (const key of ["codec_name", "width", "height"]) {
      if (beforeVideo[key] !== afterVideo?.[key]) {
        throw new Error(`Video ${key} changed: ${absolutePath}`);
      }
    }
    if (videoStreamMd5(absolutePath) !== videoStreamMd5(temporaryPath)) {
      throw new Error(`Encoded video stream changed: ${absolutePath}`);
    }

    renameSync(temporaryPath, absolutePath);
    changedCount += 1;
    console.log(`removed audio: ${absolutePath.slice(root.length + 1)}`);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

console.log(`removed audio tracks from ${changedCount} of ${videoFiles.length} public videos`);
