// scripts/verify-video.cjs
// Electron(Chromium) が dist/renderer/videos/*.mp4 を実際にデコードできるか検証する。
// app.ts と同じ相対パス（videos/<file>）・同じ CSP(media-src 'self')で読む。
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const rendererDir = path.join(root, "dist", "renderer");
const probe = path.join(rendererDir, "__probe.html");

fs.writeFileSync(
  probe,
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; media-src 'self'">` +
    `<video id="v" src="videos/lv3_medium_destruction.mp4" muted></video>`,
);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  try {
    await win.loadFile(probe);
    const result = await win.webContents.executeJavaScript(`new Promise((res) => {
      const v = document.getElementById("v");
      const done = (o) => res(o);
      if (v.readyState >= 2) return done({ ok: true, rs: v.readyState });
      v.addEventListener("loadeddata", () => done({ ok: true, rs: v.readyState }));
      v.addEventListener("error", () => done({ ok: false, code: v.error && v.error.code }));
      setTimeout(() => done({ ok: v.readyState >= 2, rs: v.readyState, timeout: true }), 4000);
      v.load();
    })`);
    console.log("VIDEO_PROBE_RESULT=" + JSON.stringify(result));
    fs.rmSync(probe, { force: true });
    app.exit(result.ok ? 0 : 1);
  } catch (e) {
    console.log("VIDEO_PROBE_ERROR=" + String(e));
    fs.rmSync(probe, { force: true });
    app.exit(2);
  }
});
