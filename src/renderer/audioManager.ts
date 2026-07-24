// src/renderer/audioManager.ts
//
// Renderer-local audio playback. Missing audio is treated as a warning-level
// condition so game progress continues.

export type BgmConfig = {
  file: string;
  loop: boolean;
  volume: number;
  autoplay: boolean;
  maxVolume?: number;
};

export type BgmHandle = {
  play(): Promise<void>;
  stop(): void;
};

export type BgmCallbacks = {
  onMissing: (file: string) => void;
  onBlocked: (file: string, reason: string) => void;
};

export type OneShotAudioOptions = {
  file: string;
  volume: number;
  maxVolume?: number;
  // 自然に再生終了したときに1回だけ呼ばれる（error/blocked では呼ばれない）。
  onEnded?: () => void;
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (audioContext === null) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function safeAudioPath(file: string): string | null {
  if (file.length === 0 || file.includes("\\") || file.startsWith("/")) {
    return null;
  }
  const segments = file.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  const lower = file.toLowerCase();
  if (!lower.endsWith(".wav") && !lower.endsWith(".mp3")) {
    return null;
  }
  return file;
}

export function createBgm(config: BgmConfig, cb: BgmCallbacks): BgmHandle {
  const safe = safeAudioPath(config.file);
  if (safe === null) {
    cb.onMissing(config.file);
    return { play: () => Promise.resolve(), stop: () => {} };
  }

  const audio = document.createElement("audio");
  audio.src = `sounds/${safe}`;
  audio.loop = config.loop;
  audio.volume = 1;
  audio.preload = "auto";

  let source: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;
  try {
    const ctx = getAudioContext();
    source = ctx.createMediaElementSource(audio);
    gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(config.maxVolume ?? 3, config.volume));
    source.connect(gain);
    gain.connect(ctx.destination);
  } catch {
    audio.volume = Math.max(0, Math.min(1, config.volume));
  }

  const handleError = (): void => cb.onMissing(safe);
  audio.addEventListener("error", handleError);
  document.body.appendChild(audio);
  audio.load();

  return {
    play: async () => {
      try {
        if (audioContext?.state === "suspended") {
          await audioContext.resume();
        }
        await audio.play();
      } catch (e) {
        cb.onBlocked(safe, e instanceof Error ? e.message : String(e));
      }
    },
    stop: () => {
      audio.removeEventListener("error", handleError);
      source?.disconnect();
      gain?.disconnect();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    },
  };
}

export function playOneShotAudio(config: OneShotAudioOptions, cb: BgmCallbacks): void {
  const safe = safeAudioPath(config.file);
  if (safe === null) {
    cb.onMissing(config.file);
    return;
  }
  const safeFile = safe;

  const audio = document.createElement("audio");
  audio.src = `sounds/${safeFile}`;
  audio.loop = false;
  audio.volume = 1;
  audio.preload = "auto";

  let source: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;

  function handleError(): void {
    cb.onMissing(safeFile);
    cleanup();
  }

  const cleanup = (): void => {
    audio.removeEventListener("ended", cleanup);
    audio.removeEventListener("error", handleError);
    source?.disconnect();
    gain?.disconnect();
    audio.removeAttribute("src");
    audio.load();
    audio.remove();
  };

  try {
    const ctx = getAudioContext();
    source = ctx.createMediaElementSource(audio);
    gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(config.maxVolume ?? 3, config.volume));
    source.connect(gain);
    gain.connect(ctx.destination);
  } catch {
    audio.volume = Math.max(0, Math.min(1, config.volume));
  }

  if (config.onEnded) {
    audio.addEventListener("ended", config.onEnded);
  }
  audio.addEventListener("ended", cleanup);
  audio.addEventListener("error", handleError);
  document.body.appendChild(audio);
  audio.load();

  void (async () => {
    try {
      if (audioContext?.state === "suspended") {
        await audioContext.resume();
      }
      await audio.play();
    } catch (e) {
      cb.onBlocked(safeFile, e instanceof Error ? e.message : String(e));
      cleanup();
    }
  })();
}
