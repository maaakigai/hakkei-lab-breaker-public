// src/renderer/videoManager.ts
//
// HTML video による動画再生（SPEC.md 15章）。
//   - Power から選ばれた level の mp4 を再生する。
//   - 再生終了で onEnded、ファイル欠落/再生不可で onMissing（VIDEO_MISSING 相当）。
// 動画は dist/renderer/videos/<file> に配置（build がコピー）。'self' で参照する。

export type VideoCallbacks = {
  onEnded: () => void;
  onMissing: (file: string) => void;
  // 再生進行が stallTimeoutMs 停止した（開始できない/途中で止まった）。呼び出し側はスキップ等で前へ進める。
  onStalled?: (file: string) => void;
};

export type PlayVideoOptions = {
  // この時間(ms)再生が進行しなければ onStalled を発火する（0/未指定で無効）。
  stallTimeoutMs?: number;
};

export type PreparedVideo = {
  file: string;
  video: HTMLVideoElement | null;
  ready: Promise<void>;
  dispose(): void;
};

export type VideoHandle = {
  stop(): void;
  detachForResult(): HTMLVideoElement | null;
};

// path traversal 防止: assets/videos 配下の安全な相対パスだけ許可する。
function safeVideoPath(file: string): string | null {
  if (file.length === 0 || file.includes("\\") || file.startsWith("/")) {
    return null;
  }
  const segments = file.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return file;
}

function createVideoElement(safe: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.className = "video-el video-loading";
  video.src = `videos/${safe}`;
  video.preload = "auto";
  video.autoplay = false;
  video.muted = false;
  video.playsInline = true;
  video.controls = false;
  return video;
}

function preloadHost(): HTMLElement {
  const existing = document.getElementById("video-preload-cache");
  if (existing !== null) {
    return existing;
  }
  const host = document.createElement("div");
  host.id = "video-preload-cache";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-1px;top:-1px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
  document.body.appendChild(host);
  return host;
}

function waitForReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = (): void => {
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    };
    const finish = (fn: () => void): void => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      fn();
    };
    const handleReady = (): void => finish(resolve);
    const handleError = (): void => finish(() => reject(new Error("video load failed")));

    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

export function preloadVideo(file: string): PreparedVideo {
  const safe = safeVideoPath(file);
  if (safe === null) {
    return {
      file,
      video: null,
      ready: Promise.resolve(),
      dispose: () => {},
    };
  }

  const video = createVideoElement(safe);
  const ready = waitForReady(video);
  ready.catch(() => {});
  preloadHost().appendChild(video);
  video.load();

  return {
    file,
    video,
    ready,
    dispose: () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}

export function playVideo(
  host: HTMLElement,
  file: string,
  cb: VideoCallbacks,
  prepared?: PreparedVideo,
  opts?: PlayVideoOptions,
): VideoHandle {
  const safe = safeVideoPath(file);
  if (safe === null) {
    cb.onMissing(file);
    return { stop: () => {}, detachForResult: () => null };
  }

  const video = prepared?.file === file && prepared.video !== null ? prepared.video : createVideoElement(safe);

  // 凍結バグ根本対策（2026-07-07 state log で確定）:
  // 旧実装は preload の ready(loadeddata) を待ってから play() していたが、Chromium は多数の
  // 画面外 video を一斉 preload すると一部のデータロードを保留する（readyState=1 のまま
  // loadeddata/error とも発火しない）。その要素に当たると play も ended も来ず無音凍結した。
  // 対策: ロード完了を待たず即 play() する（play はロード保留を強制再開させる）。さらに
  // timeupdate ベースの stall 監視で、進行が stallTimeoutMs 止まったら onStalled で前へ進める。
  let settled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const clearStallTimer = (): void => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStallTimer = (): void => {
    const timeoutMs = opts?.stallTimeoutMs ?? 0;
    if (timeoutMs <= 0 || cb.onStalled === undefined) {
      return;
    }
    clearStallTimer();
    stallTimer = setTimeout(() => finishOnce(() => cb.onStalled?.(safe)), timeoutMs);
  };
  const cleanup = (): void => {
    video.removeEventListener("ended", handleEnded);
    video.removeEventListener("error", handleError);
    video.removeEventListener("timeupdate", handleProgress);
    video.removeEventListener("playing", handleProgress);
    clearStallTimer();
  };
  const finishOnce = (fn: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    fn();
  };
  const handleEnded = (): void => finishOnce(cb.onEnded);
  const handleError = (): void => finishOnce(() => cb.onMissing(safe));
  // 進行がある限り stall タイマーを先送りする（開始できないケースと途中停止の両方を検出）。
  const handleProgress = (): void => {
    if (video.classList.contains("video-loading")) {
      video.classList.remove("video-loading");
      video.classList.add("video-ready");
    }
    armStallTimer();
  };

  video.addEventListener("ended", handleEnded);
  video.addEventListener("error", handleError);
  video.addEventListener("timeupdate", handleProgress);
  video.addEventListener("playing", handleProgress);

  host.appendChild(video);
  video.autoplay = true;
  try {
    video.currentTime = 0;
  } catch {
    // メタデータ未取得（readyState=0）では失敗することがある。再生自体は継続する。
  }
  armStallTimer();
  // 再生開始に失敗した場合（コーデック等・ソース不正）は missing 扱いにする。
  // stop()/detachForResult() による中断は settled=true 後なので finishOnce が握り潰す。
  video.play().catch(() => finishOnce(() => cb.onMissing(safe)));

  return {
    stop: () => {
      settled = true;
      cleanup();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
    detachForResult: () => {
      settled = true;
      cleanup();
      video.pause();
      video.classList.remove("video-loading");
      video.classList.add("video-ready", "video-result-el");
      return video;
    },
  };
}
