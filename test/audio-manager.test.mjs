// test/audio-manager.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { safeAudioPath } from "../src/renderer/audioManager.ts";

test("safeAudioPath は assets/Sound 配下の相対 wav/mp3 だけを許可する", () => {
  assert.equal(safeAudioPath("BGM/placeholder-main-loop.wav"), "BGM/placeholder-main-loop.wav");
  assert.equal(safeAudioPath("SFX/placeholder-charge-loop.wav"), "SFX/placeholder-charge-loop.wav");
  assert.equal(safeAudioPath("SFX/placeholder-overcharge-loop.wav"), "SFX/placeholder-overcharge-loop.wav");
  assert.equal(safeAudioPath("SFX/placeholder-crack-01.wav"), "SFX/placeholder-crack-01.wav");
  assert.equal(safeAudioPath("SFX/placeholder-crack-02.wav"), "SFX/placeholder-crack-02.wav");
  assert.equal(safeAudioPath("effects/hakkei.mp3"), "effects/hakkei.mp3");
  assert.equal(safeAudioPath("../placeholder-main-loop.wav"), null);
  assert.equal(safeAudioPath("/BGM/placeholder-main-loop.wav"), null);
  assert.equal(safeAudioPath("BGM\\placeholder-main-loop.wav"), null);
  assert.equal(safeAudioPath("BGM/placeholder-main-loop.ogg"), null);
});
