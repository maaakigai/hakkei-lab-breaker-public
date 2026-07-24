// scripts/mock-unity.mjs
//
// Mock Unity Bridge（M5-02）．`npm run mock:unity` で 127.0.0.1:45100 へ
// 両手 v2 motion / heartbeat JSON を送る（両手v2 必須化に伴い既定 v2）．
// Unity なしで validator / IPC / InputCheck を確認する．
// Gate B2/D1 の実 Unity 入力 PASS の代替にはしない（source は mock-unity-bridge）．
//
// 引数:
//   --port 45100   送信先ポート
//   --hz 30        motion 送信 Hz
//   --bad          時々不正 datagram を混ぜる（validator 確認用）
//   --v1           旧 v1 で送る（v2 必須化での UNSUPPORTED_PROTOCOL_VERSION 拒否確認用）
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CALIB } from "../src/renderer/calibrationManager.ts";
import { createCalibProfile } from "./mock-unity-calib-profile.mjs";

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(getArg("--port", "45100"));
const HOST = "127.0.0.1";
const HZ = Number(getArg("--hz", "30"));
// 両手v2 必須化により既定は v2。`--v1` のときだけ旧 v1（拒否される）を送る。
const PROTOCOL_VERSION = args.includes("--v1") ? 1 : 2;
const SEND_BAD = args.includes("--bad");
const CALIB_MODE = args.includes("--calib");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, "config", name), "utf8"));
const config = CALIB_MODE
  ? {
      app: readJson("app.config.json"),
      input: readJson("input.config.json"),
      score: readJson("score.config.json"),
    }
  : null;
const calibProfile = CALIB_MODE
  ? createCalibProfile({ ...config, calibration: CALIB, hz: HZ })
  : null;

const sock = createSocket("udp4");
const sessionId = `mock-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const startMs = Date.now();
let seq = 0;
let badCounter = 0;

function send(obj) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  sock.send(buf, PORT, HOST);
}

function mirrorLeftHand(rightHand) {
  return { x: -rightHand.x, y: rightHand.y, z: rightHand.z };
}

function createMotionPacket(tMs, rightHand, leftHand = mirrorLeftHand(rightHand)) {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    type: "motion",
    sessionId,
    seq: seq++,
    timestampMs: tMs,
    source: "mock-unity-bridge",
    isTracked: true,
    rightHand: { x: rightHand.x, y: rightHand.y, z: rightHand.z },
  };
  if (PROTOCOL_VERSION === 2) {
    return {
      ...base,
      leftHand: { x: leftHand.x, y: leftHand.y, z: leftHand.z },
      avatar: {
        isHuman: true,
        hasRightHand: true,
        hasLeftHand: true,
        forward: { x: 0, y: 0, z: 1 },
      },
    };
  }
  return {
    ...base,
    avatar: { isHuman: true, hasRightHand: true, forward: { x: 0, y: 0, z: 1 } },
  };
}

function motion(tMs) {
  if (calibProfile) {
    const hands = calibProfile.sampleHandsAt(tMs);
    return createMotionPacket(tMs, hands.rightHand, hands.leftHand);
  }
  // 右手を上下(y)+前後(z)に動かす．
  const y = 1.2 + 0.25 * Math.sin((2 * Math.PI * tMs) / 1000);
  const z = -0.2 + 0.15 * Math.sin((2 * Math.PI * tMs) / 1700);
  return createMotionPacket(tMs, { x: 0.1, y, z });
}

function heartbeat(tMs) {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    type: "heartbeat",
    sessionId,
    timestampMs: tMs,
    source: "mock-unity-bridge",
    receiverReady: true,
    receiverStatus: "receiving",
    avatarReady: true,
    rightHandReady: true,
    frameRate: 60.0,
    sendRateHz: HZ,
  };
  return PROTOCOL_VERSION === 2 ? { ...base, leftHandReady: true } : base;
}

console.log(
  `[mock-unity] -> ${HOST}:${PORT}  v${PROTOCOL_VERSION} motion ${HZ}Hz  session=${sessionId}  bad=${SEND_BAD}  calib=${CALIB_MODE}`,
);
if (calibProfile) {
  console.log(
    `[mock-unity] calib cycle=${Math.round(calibProfile.cycleMs)}ms pulse=${Math.round(calibProfile.pulse.durationMs)}ms/${calibProfile.pulse.distanceM.toFixed(3)}m`,
  );
}

const motionTimer = setInterval(() => {
  const tMs = Date.now() - startMs;
  if (SEND_BAD && ++badCounter % 50 === 0) {
    sock.send(Buffer.from("{ broken json", "utf8"), PORT, HOST); // INVALID_JSON 確認
    return;
  }
  send(motion(tMs));
}, 1000 / HZ);

const heartbeatTimer = setInterval(() => {
  send(heartbeat(Date.now() - startMs));
}, 1000); // 1Hz

function shutdown() {
  clearInterval(motionTimer);
  clearInterval(heartbeatTimer);
  sock.close();
  console.log("[mock-unity] stopped");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
