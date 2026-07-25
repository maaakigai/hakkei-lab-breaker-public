import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function boxesWithin(buffer, start, end) {
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;

    if (size === 1) {
      assert.ok(offset + 16 <= end, `truncated extended ${type} box`);
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    assert.ok(size >= headerSize, `invalid ${type} box size`);
    assert.ok(offset + size <= end, `truncated ${type} box`);
    boxes.push({
      type,
      dataStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }

  return boxes;
}

function trackHandlerTypes(buffer) {
  const handlers = [];
  const movieBoxes = boxesWithin(buffer, 0, buffer.length).filter((box) => box.type === "moov");

  for (const movie of movieBoxes) {
    const tracks = boxesWithin(buffer, movie.dataStart, movie.end).filter((box) => box.type === "trak");
    for (const track of tracks) {
      const mediaBoxes = boxesWithin(buffer, track.dataStart, track.end).filter(
        (box) => box.type === "mdia",
      );
      for (const media of mediaBoxes) {
        const handler = boxesWithin(buffer, media.dataStart, media.end).find(
          (box) => box.type === "hdlr",
        );
        assert.ok(handler && handler.dataStart + 12 <= handler.end, "missing media handler");
        handlers.push(buffer.subarray(handler.dataStart + 8, handler.dataStart + 12).toString("ascii"));
      }
    }
  }

  return handlers;
}

test("公開版の全MP4は映像トラックを持ち、音声トラックを持たない", () => {
  const videoFiles = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "assets/videos",
      "docs/media",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => resolve(root, path))
    .filter(existsSync)
    .filter((path) => extname(path).toLowerCase() === ".mp4");
  assert.equal(videoFiles.length, 21);

  for (const path of videoFiles) {
    const handlers = trackHandlerTypes(readFileSync(path));
    assert.ok(handlers.includes("vide"), `${relative(root, path)} has no video track`);
    assert.equal(
      handlers.includes("soun"),
      false,
      `${relative(root, path)} contains an audio track`,
    );
  }
});
