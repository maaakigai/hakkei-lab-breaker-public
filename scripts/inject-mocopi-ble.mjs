import dgram from "node:dgram";

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
const scenario = args.get("scenario") ?? "play";
const durationMs = Number(args.get("duration-ms") ?? (scenario === "play" ? "24000" : "8000"));
const sessionId = args.get("session-id") ?? `inject-${Date.now().toString(36)}`;
const sensorId = args.get("sensor-id") ?? "synthetic-inject";

if (!Number.isFinite(port) || port <= 0) throw new Error("Invalid --port");
if (!Number.isFinite(hz) || hz <= 0) throw new Error("Invalid --hz");

const sock = dgram.createSocket("udp4");
const start = Date.now();
let seq = 0;

function quatFromXDeg(deg) {
  const rad = (deg * Math.PI) / 180;
  return { w: Math.cos(rad / 2), x: Math.sin(rad / 2), y: 0, z: 0 };
}

function angleAt(t) {
  if (scenario === "idle") return 0.03 * Math.sin(t / 180);
  if (scenario === "jitter") return 8 * Math.sin(t / 45);
  if (scenario === "spike") {
    if (t < 160) return (t / 160) * 220;
    if (t < 360) return 220 - ((t - 160) / 200) * 220;
    return 0;
  }
  if (scenario === "play") {
    if (t < 3500) return 0.04 * Math.sin(t / 180);
    if (t < 7000) return 65 * Math.sin((t - 3500) / 70);
    if (t < 16200) return 80 * Math.sin((t - 7000) / 62);
    if (t < 19200) return 0.04 * Math.sin(t / 180);
    if (t < 19360) return ((t - 19200) / 160) * 220;
    if (t < 19560) return 220 - ((t - 19360) / 200) * 220;
    return 0.03 * Math.sin(t / 180);
  }
  if (scenario === "charge-only") return t < 12000 ? 70 * Math.sin(t / 65) : 0;
  throw new Error(`Unknown --scenario ${scenario}`);
}

function send() {
  const elapsed = Date.now() - start;
  if (elapsed > durationMs) {
    sock.close();
    console.log(`done scenario=${scenario} seq=${seq}`);
    return;
  }
  seq += 1;
  const q = quatFromXDeg(angleAt(elapsed));
  const pkt = {
    protocolVersion: 1,
    type: "imu",
    source: "mocopi-ble",
    sensorId,
    sessionId,
    seq,
    timestampMs: Date.now(),
    sampleRateHz: hz,
    quat: q,
    accelRaw: { x: 0, y: 0, z: 0 },
  };
  sock.send(Buffer.from(JSON.stringify(pkt)), port, host);
  setTimeout(send, Math.max(1, Math.round(1000 / hz)));
}

console.log(`emit scenario=${scenario} session=${sessionId} -> ${host}:${port}`);
send();
