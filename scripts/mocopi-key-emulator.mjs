import dgram from "node:dgram";
import readline from "node:readline";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }
}

const host = args.get("host") ?? "127.0.0.1";
const port = Number(args.get("port") ?? "45150");
const hz = Number(args.get("hz") ?? "50");
const sessionId = args.get("session-id") ?? `mocopi-key-${Date.now().toString(36)}`;
const sensorId = args.get("sensor-id") ?? "mocopi-key-emulator";
const chargeBurstMs = Number(args.get("charge-ms") ?? "700");
const punchBurstMs = Number(args.get("punch-ms") ?? "360");
const chargeDeg = Number(args.get("charge-deg") ?? "80");
const punchDeg = Number(args.get("punch-deg") ?? "230");

if (!Number.isFinite(port) || port <= 0) throw new Error("Invalid --port");
if (!Number.isFinite(hz) || hz <= 0) throw new Error("Invalid --hz");
if (!Number.isFinite(chargeBurstMs) || chargeBurstMs <= 0) throw new Error("Invalid --charge-ms");
if (!Number.isFinite(punchBurstMs) || punchBurstMs <= 0) throw new Error("Invalid --punch-ms");
if (!Number.isFinite(chargeDeg) || chargeDeg <= 0) throw new Error("Invalid --charge-deg");
if (!Number.isFinite(punchDeg) || punchDeg <= 0) throw new Error("Invalid --punch-deg");

const sock = dgram.createSocket("udp4");
const startMs = Date.now();
const chargeBursts = [];
const punchBursts = [];
let seq = 0;
let timer = null;
let closed = false;

function quatFromXDeg(deg) {
  const rad = (deg * Math.PI) / 180;
  return { w: Math.cos(rad / 2), x: Math.sin(rad / 2), y: 0, z: 0 };
}

function pruneBursts(nowMs) {
  while (chargeBursts.length > 0 && nowMs - chargeBursts[0] > chargeBurstMs) {
    chargeBursts.shift();
  }
  while (punchBursts.length > 0 && nowMs - punchBursts[0] > punchBurstMs) {
    punchBursts.shift();
  }
}

function chargeAngle(nowMs) {
  let angle = 0;
  for (const burstStart of chargeBursts) {
    const t = nowMs - burstStart;
    if (t >= 0 && t <= chargeBurstMs) {
      const phase = (t / chargeBurstMs) * Math.PI * 4;
      const fade = Math.sin((t / chargeBurstMs) * Math.PI);
      angle += chargeDeg * Math.sin(phase) * Math.max(0, fade);
    }
  }
  return angle;
}

function punchAngle(nowMs) {
  let angle = 0;
  for (const burstStart of punchBursts) {
    const t = nowMs - burstStart;
    if (t < 0 || t > punchBurstMs) continue;
    const upMs = Math.max(40, punchBurstMs * 0.45);
    if (t <= upMs) {
      angle += (t / upMs) * punchDeg;
    } else {
      angle += (1 - ((t - upMs) / (punchBurstMs - upMs))) * punchDeg;
    }
  }
  return angle;
}

function angleAt(nowMs) {
  const elapsed = nowMs - startMs;
  const idle = 0.04 * Math.sin(elapsed / 180);
  return idle + chargeAngle(nowMs) + punchAngle(nowMs);
}

function sendPacket() {
  if (closed) return;
  const nowMs = Date.now();
  pruneBursts(nowMs);
  seq += 1;
  const pkt = {
    protocolVersion: 1,
    type: "imu",
    source: "mocopi-ble",
    sensorId,
    sessionId,
    seq,
    timestampMs: nowMs,
    sampleRateHz: hz,
    quat: quatFromXDeg(angleAt(nowMs)),
    accelRaw: { x: 0, y: 0, z: 0 },
  };
  sock.send(Buffer.from(JSON.stringify(pkt)), port, host);
}

function close() {
  if (closed) return;
  closed = true;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.off("data", onKey);
  process.stdin.pause();
  sock.close();
  console.log(`\nStopped. seq=${seq}`);
}

function onKey(buffer) {
  const nowMs = Date.now();
  const text = buffer.toString("utf8");
  if (buffer.length === 1 && buffer[0] === 3) {
    close();
    return;
  }
  if (text === "q" || text === "Q") {
    close();
    return;
  }
  if (text === " ") {
    chargeBursts.push(nowMs);
    process.stdout.write("SPACE charge\n");
    return;
  }
  if (text === "\r" || text === "\n") {
    punchBursts.push(nowMs);
    process.stdout.write("ENTER punch\n");
  }
}

console.log("mocopi key emulator");
console.log(`target=${host}:${port} hz=${hz} session=${sessionId}`);
console.log("Open the game, choose mocopi BLE, then use:");
console.log("  Space = arm swing / charge");
console.log("  Enter = punch");
console.log("  Q or Ctrl+C = quit");

timer = setInterval(sendPacket, Math.max(1, Math.round(1000 / hz)));

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onKey);
} else {
  console.log("stdin is not interactive; sending idle packets only.");
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
