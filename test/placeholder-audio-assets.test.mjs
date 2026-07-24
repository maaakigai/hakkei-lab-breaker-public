import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const soundRoot = join(root, "assets", "Sound");
const appConfig = JSON.parse(readFileSync(join(root, "config", "app.config.json"), "utf8"));

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("公開版の音声は小容量の生成済みWAVプレースホルダーだけを収録する", () => {
  const audioFiles = filesBelow(soundRoot).filter((path) => [".wav", ".mp3"].includes(extname(path).toLowerCase()));
  assert.equal(audioFiles.length, 22);
  assert.equal(audioFiles.some((path) => extname(path).toLowerCase() === ".mp3"), false);

  const totalBytes = audioFiles.reduce((sum, path) => sum + statSync(path).size, 0);
  assert.ok(totalBytes < 2 * 1024 * 1024, `placeholder audio total is ${totalBytes} bytes`);

  for (const path of audioFiles) {
    const header = readFileSync(path).subarray(0, 12);
    assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF", relative(soundRoot, path));
    assert.equal(header.subarray(8, 12).toString("ascii"), "WAVE", relative(soundRoot, path));
  }
});

test("BGM・SFXを含む全プレースホルダーのPCMサンプルは無音である", () => {
  const audioFiles = filesBelow(soundRoot).filter((path) => extname(path).toLowerCase() === ".wav");
  assert.equal(audioFiles.length, 22);

  for (const path of audioFiles) {
    const wav = readFileSync(path);
    assert.equal(wav.subarray(36, 40).toString("ascii"), "data", relative(soundRoot, path));
    assert.equal(
      wav.subarray(44).every((byte) => byte === 0),
      true,
      `${relative(soundRoot, path)} contains a non-zero PCM sample`,
    );
  }
});

test("audio config が参照する全プレースホルダーが存在する", () => {
  const audio = appConfig.audio;
  const configuredFiles = [
    audio.bgm.file,
    audio.chargeSound.file,
    audio.overchargeSound.file,
    audio.phaseCues.chargeStart.file,
    audio.phaseCues.stance.file,
    audio.phaseCues.stanceOvercharge.file,
    audio.phaseCues.punch.file,
    audio.phaseCues.punchOvercharge.file,
  ];

  for (const relativePath of configuredFiles) {
    assert.match(relativePath, /^.+placeholder.+\.wav$/);
    assert.equal(existsSync(join(soundRoot, relativePath)), true, relativePath);
  }
});
