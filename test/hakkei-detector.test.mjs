import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigBundle } from "../src/main/appConfig.ts";
import {
  DualHakkeiDetector,
  HakkeiDetector,
  rightHandKinematics,
} from "../src/renderer/hakkeiDetector.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaded = loadConfigBundle(join(root, "config"), 0);
if (!loaded.ok) throw new Error("config load failed");
const HAKKEI = loaded.value.score.hakkei;
const FORWARD = loaded.value.input.coordinates.defaultForwardVector;

function hand({ t = 0, px = 0, pz = 0, vx = 0, vz = 0, ax = 0, az = 0, validForScore = true }) {
  return {
    timestampMs: t,
    position: { x: px, y: 0, z: pz },
    velocity: { x: vx, y: 0, z: vz },
    acceleration: { x: ax, y: 0, z: az },
    validForScore,
  };
}

function handMotion({ px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0, ax = 0, ay = 0, az = 0, validForScore = true }) {
  return {
    rawHandPosition: { x: px, y: py, z: pz },
    handPosition: { x: px, y: py, z: pz },
    velocity: { x: vx, y: vy, z: vz },
    acceleration: { x: ax, y: ay, z: az },
    isAvailable: validForScore,
    validForScore,
    validForCalibration: validForScore,
    quality: { dtMs: 33, sampleRateHz: 30, isFiltered: true, droppedFrameCount: 0, invalidPacketCount: 0, flags: [] },
  };
}

function sample({ t = 0, right = {}, left = {}, leftMissing = false }) {
  const r = handMotion(right);
  return {
    protocolVersion: 1,
    source: "unity-bridge",
    sessionId: "hakkei-test",
    seq: t,
    timestampMs: t,
    receivedAtMs: t,
    rawHandPosition: r.rawHandPosition,
    handPosition: r.handPosition,
    velocity: r.velocity,
    acceleration: r.acceleration,
    isAvailable: r.isAvailable,
    validForScore: r.validForScore,
    validForCalibration: false,
    leftHand: leftMissing ? null : handMotion(left),
    quality: r.quality,
  };
}

function detectWith({ vz = HAKKEI.hakkeiMinForwardVelocity + 0.1, az = HAKKEI.hakkeiMinForwardAcceleration + 0.1, pz = HAKKEI.hakkeiMinForwardDisplacement + 0.01 }) {
  const detector = new HakkeiDetector(HAKKEI);
  detector.observe(hand({ t: 0 }), FORWARD);
  return detector.observe(hand({ t: 100, vz, az, pz }), FORWARD);
}

test("single hand returns window peaks and displacement", () => {
  const detector = new HakkeiDetector(HAKKEI);
  detector.observe(hand({ t: 0 }), FORWARD);
  detector.observe(hand({ t: 50, pz: 0.03, vz: 1.5, az: 9 }), FORWARD);
  const observed = detector.observe(hand({ t: 100, pz: 0.15, vz: 2.0, az: 12 }), FORWARD);

  assert.equal(observed.detected, true);
  assert.equal(observed.forwardVelocityPeak, 2.0); // peak |velocity|
  assert.equal(observed.forwardAccelerationPeak, 12); // peak |acceleration|
  assert.ok(Math.abs(observed.forwardDisplacement - 0.15) < 1e-9); // net直線距離（端-端）
});

test("single hand stationary and sideways movement do not detect", () => {
  const stationary = new HakkeiDetector(HAKKEI);
  for (let i = 0; i < 10; i++) {
    assert.equal(stationary.observe(hand({ t: i * 33, pz: 0.01 * (i % 2) }), FORWARD).detected, false);
  }

  const sideways = new HakkeiDetector(HAKKEI);
  sideways.observe(hand({ t: 0 }), FORWARD);
  assert.equal(sideways.observe(hand({ t: 100, px: 0.5, vx: 4, ax: 20 }), FORWARD).detected, false);
});

test("single hand requires velocity acceleration and displacement", () => {
  assert.equal(detectWith({ vz: HAKKEI.hakkeiMinForwardVelocity }).detected, false);
  assert.equal(detectWith({ az: HAKKEI.hakkeiMinForwardAcceleration }).detected, false);
  assert.equal(detectWith({ pz: HAKKEI.hakkeiMinForwardDisplacement }).detected, false);
});

test("single hand window includes boundary and excludes outside-window displacement", () => {
  const atBoundary = new HakkeiDetector(HAKKEI);
  atBoundary.observe(hand({ t: 0 }), FORWARD);
  assert.equal(
    atBoundary.observe(hand({
      t: HAKKEI.hakkeiWindowMs,
      pz: HAKKEI.hakkeiMinForwardDisplacement + 0.01,
      vz: HAKKEI.hakkeiMinForwardVelocity + 0.1,
      az: HAKKEI.hakkeiMinForwardAcceleration + 0.1,
    }), FORWARD).detected,
    true,
  );

  const outsideWindow = new HakkeiDetector(HAKKEI);
  outsideWindow.observe(hand({ t: 0 }), FORWARD);
  assert.equal(
    outsideWindow.observe(hand({
      t: HAKKEI.hakkeiWindowMs + 1,
      pz: HAKKEI.hakkeiMinForwardDisplacement + 0.01,
      vz: HAKKEI.hakkeiMinForwardVelocity + 0.1,
      az: HAKKEI.hakkeiMinForwardAcceleration + 0.1,
    }), FORWARD).detected,
    false,
  );
});

test("single hand ignores invalid sample and suppresses cooldown re-detect", () => {
  const detector = new HakkeiDetector(HAKKEI);
  detector.observe(hand({ t: 0 }), FORWARD);
  assert.equal(
    detector.observe(hand({
      t: 100,
      pz: HAKKEI.hakkeiMinForwardDisplacement + 0.01,
      vz: HAKKEI.hakkeiMinForwardVelocity + 0.1,
      az: HAKKEI.hakkeiMinForwardAcceleration + 0.1,
    }), FORWARD).detected,
    true,
  );
  assert.equal(detector.observe(hand({ t: 150, pz: 10, vz: 10, az: 10, validForScore: false }), FORWARD).detected, false);
  assert.equal(
    detector.observe(hand({
      t: 200,
      pz: HAKKEI.hakkeiMinForwardDisplacement * 2 + 0.01,
      vz: HAKKEI.hakkeiMinForwardVelocity + 0.1,
      az: HAKKEI.hakkeiMinForwardAcceleration + 0.1,
    }), FORWARD).detected,
    false,
  );
});

test("rightHandKinematics decouples MotionSample to hand input", () => {
  const detector = new HakkeiDetector(HAKKEI);
  detector.observe(rightHandKinematics(sample({ t: 0 })), FORWARD);
  const observed = detector.observe(
    rightHandKinematics(sample({
      t: 100,
      right: {
        pz: HAKKEI.hakkeiMinForwardDisplacement + 0.01,
        vz: HAKKEI.hakkeiMinForwardVelocity + 0.1,
        az: HAKKEI.hakkeiMinForwardAcceleration + 0.1,
      },
    })),
    FORWARD,
  );
  assert.equal(observed.detected, true);
});

test("dual hand detects only synced right and left punches and averages score raw values", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  const observed = detector.observe(
    sample({
      t: 100,
      right: { pz: 0.12, vz: 2.0, az: 10 },
      left: { pz: 0.22, vz: 3.0, az: 14 },
    }),
    FORWARD,
  );
  assert.equal(observed.detected, true);
  assert.equal(observed.forwardVelocityPeak, 2.5);
  assert.equal(observed.forwardAccelerationPeak, 12);
  assert.ok(Math.abs(observed.forwardDisplacement - 0.17) < 1e-9);
});

test("dual hand does not detect with one hand only or missing left hand", () => {
  const rightOnly = new DualHakkeiDetector(HAKKEI);
  rightOnly.observe(sample({ t: 0 }), FORWARD);
  assert.equal(
    rightOnly.observe(sample({ t: 100, right: { pz: 0.12, vz: 2.0, az: 10 }, left: { pz: 0.01 } }), FORWARD).detected,
    false,
  );

  const missingLeft = new DualHakkeiDetector(HAKKEI);
  missingLeft.observe(sample({ t: 0, leftMissing: true }), FORWARD);
  assert.equal(
    missingLeft.observe(sample({ t: 100, right: { pz: 0.12, vz: 2.0, az: 10 }, leftMissing: true }), FORWARD).detected,
    false,
  );
});

test("dual hand does not detect outside sync window", () => {
  const detector = new DualHakkeiDetector({ ...HAKKEI, dualHakkeiSyncWindowMs: 50 });
  detector.observe(sample({ t: 0 }), FORWARD);
  detector.observe(sample({ t: 100, right: { pz: 0.12, vz: 2.0, az: 10 }, left: { pz: 0.01 } }), FORWARD);
  const observed = detector.observe(sample({ t: 200, right: { pz: 0.12 }, left: { pz: 0.2, vz: 2.5, az: 11 } }), FORWARD);
  assert.equal(observed.detected, false);
});

test("dual hand stationary samples never detect", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  for (let i = 0; i < 30; i++) {
    assert.equal(
      detector.observe(sample({ t: i * 33, right: { pz: 0.01 * (i % 2) }, left: { pz: 0.01 * (i % 2) } }), FORWARD).detected,
      false,
    );
  }
});

// --- D案の保証テスト群（magnitude主判定＋前方gate＋net変位） ---

test("D: magnitude judges strength symmetrically (forward 射影で弱い左手も magnitude で発火)", () => {
  // 左手が forward(=+Z) からやや外れた斜め前方へ突く。forward 射影だけなら弱いが、magnitude は十分。
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  const observed = detector.observe(
    sample({
      t: 100,
      // 右手はまっすぐ前方。
      right: { pz: 0.2, vz: 2.0, az: 10 },
      // 左手は斜め前方（x にもぶれる）。forward成分は十分残しつつ magnitude は大きい。
      left: { px: 0.12, pz: 0.18, vx: 1.2, vz: 1.6, ax: 6, az: 9 },
    }),
    FORWARD,
  );
  assert.equal(observed.detected, true);
});

test("D: 両手の横払い（前方成分なし）は前方gateで非検出", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  // 両手とも x 方向（横）へ速く大きく動く。magnitude は閾値超だが forward 成分=0。
  const observed = detector.observe(
    sample({
      t: 100,
      right: { px: 0.5, vx: 4, ax: 20 },
      left: { px: -0.5, vx: 4, ax: 20 },
    }),
    FORWARD,
  );
  assert.equal(observed.detected, false);
});

test("D: 両手の上方向は前方gateで非検出", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  const observed = detector.observe(
    sample({
      t: 100,
      right: { py: 0.5, vy: 4, ay: 20 },
      left: { py: 0.5, vy: 4, ay: 20 },
    }),
    FORWARD,
  );
  assert.equal(observed.detected, false);
});

test("D: 速い往復（小振幅で net 不足）は非検出（path長でなく端-端距離で判定）", () => {
  // 瞬間速度・加速度は常に閾値超だが、位置は ±4cm で前後に細かく往復。
  // Σ|Δp|（path length）なら稼げるが、window端-端の net 距離は <10cm に留まり発火しない。
  const detector = new DualHakkeiDetector(HAKKEI);
  let fires = 0;
  for (let i = 0; i < 60; i++) {
    const pz = i % 2 === 0 ? 0.0 : 0.04; // 0↔4cm を往復
    const o = detector.observe(
      sample({ t: i * 33, right: { pz, vz: 3, az: 14 }, left: { pz, vz: 3, az: 14 } }),
      FORWARD,
    );
    if (o.detected) fires += 1;
  }
  assert.equal(fires, 0, `往復で誤検出 ${fires}`);
});

test("D: dual 静止 jitter（±2cm/±5cm, 30Hz, 10s）は誤検出0（緩い揺れ＝低エネルギー）", () => {
  for (const amp of [0.02, 0.05]) {
    const detector = new DualHakkeiDetector(HAKKEI);
    let fires = 0;
    for (let i = 0; i < 300; i++) {
      // 位置 jitter から速度・加速度も非ゼロで動かす（accel=0 で素通りさせない）。
      const jr = amp * Math.sin(i * 1.7);
      const jl = amp * Math.sin(i * 2.3);
      const vr = amp * 1.7 * Math.cos(i * 1.7);
      const vl = amp * 2.3 * Math.cos(i * 2.3);
      const o = detector.observe(
        sample({
          t: i * 33,
          right: { px: jr, pz: jr, vx: vr, vz: vr, ax: -jr, az: -jr },
          left: { px: jl, pz: jl, vx: vl, vz: vl, ax: -jl, az: -jl },
        }),
        FORWARD,
      );
      if (o.detected) fires += 1;
    }
    assert.equal(fires, 0, `amp=${amp} で誤検出 ${fires}`);
  }
});

test("D: 高 v/a でも net 変位が小さい noisy motion は非検出（net距離gate）", () => {
  // 速度・加速度は常に閾値超だが、位置は ±4cm の細かい揺れに収まり net<10cm。net距離 gate で発火しない。
  const detector = new DualHakkeiDetector(HAKKEI);
  let fires = 0;
  for (let i = 0; i < 120; i++) {
    const pz = 0.04 * Math.sin(i * 1.3);
    const o = detector.observe(
      sample({ t: i * 33, right: { pz, vz: 3, az: 14 }, left: { pz, vz: 3, az: 14 } }),
      FORWARD,
    );
    if (o.detected) fires += 1;
  }
  assert.equal(fires, 0, `high-energy noise で誤検出 ${fires}`);
});

test("D: 速度ピークと加速度ピークが別sampleでも検出（peakベース回帰）", () => {
  // 加速度は t50 でピーク（速度低）、速度は t100 でピーク（加速度低）。
  // 旧 current-sample 同時条件なら取りこぼすが、window peak ベースなら検出できる。
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  detector.observe(
    sample({ t: 50, right: { pz: 0.05, vz: 0.5, az: 12 }, left: { pz: 0.05, vz: 0.5, az: 12 } }),
    FORWARD,
  );
  const observed = detector.observe(
    sample({ t: 100, right: { pz: 0.16, vz: 2.5, az: 1 }, left: { pz: 0.16, vz: 2.5, az: 1 } }),
    FORWARD,
  );
  assert.equal(observed.detected, true);
});

test("D: 片手だけ強い impulse は非検出（両手必須）", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  const observed = detector.observe(
    sample({ t: 100, right: { pz: 0.3, vz: 4, az: 20 }, left: { pz: 0.005 } }),
    FORWARD,
  );
  assert.equal(observed.detected, false);
});

test("D: netDelta ベクトルを観測に残す（将来の方向別隠しイベント seam）", () => {
  const detector = new HakkeiDetector(HAKKEI);
  detector.observe(rightHandKinematics(sample({ t: 0 })), FORWARD);
  const o = detector.observe(rightHandKinematics(sample({ t: 100, right: { pz: 0.2, vz: 2.0, az: 10 } })), FORWARD);
  assert.equal(o.detected, true);
  assert.ok(Math.abs(o.netDelta.z - 0.2) < 1e-9);
  assert.equal(o.netDelta.x, 0);
  assert.equal(o.netDelta.y, 0);
});

test("diagnostics reports per-hand peaks, fired flags and sync gap (実機チューニング用)", () => {
  const detector = new DualHakkeiDetector(HAKKEI);
  detector.observe(sample({ t: 0 }), FORWARD);
  // 右手だけ複合条件クリア・左手は閾値未満。
  detector.observe(sample({ t: 100, right: { pz: 0.12, vz: 2.0, az: 10 }, left: { pz: 0.01, vz: 0.1, az: 1 } }), FORWARD);
  const d = detector.diagnostics();
  assert.equal(d.rightFired, true);
  assert.equal(d.leftFired, false);
  assert.equal(d.syncGapMs, null); // 片手のみ発火
  assert.ok(d.right.forwardVelocityPeak >= 2.0);
  assert.ok(d.left.forwardVelocityPeak < HAKKEI.hakkeiMinForwardVelocity);

  // 同期 window を小さくして「両手発火したが同期外」→ 検出されず両手 pending のまま syncGap が見える。
  const tight = new DualHakkeiDetector({ ...HAKKEI, dualHakkeiSyncWindowMs: 20 });
  tight.observe(sample({ t: 0 }), FORWARD);
  tight.observe(sample({ t: 100, right: { pz: 0.12, vz: 2.0, az: 10 }, left: { pz: 0.01 } }), FORWARD); // 右発火
  const detected = tight.observe(sample({ t: 150, right: { pz: 0.12 }, left: { pz: 0.2, vz: 2.5, az: 12 } }), FORWARD); // 左発火・差50>20
  assert.equal(detected.detected, false);
  const d2 = tight.diagnostics();
  assert.equal(d2.rightFired, true);
  assert.equal(d2.leftFired, true);
  assert.equal(d2.syncGapMs, 50);

  // leftMissing のときは left=null。
  const noLeft = new DualHakkeiDetector(HAKKEI);
  noLeft.observe(sample({ t: 0, leftMissing: true }), FORWARD);
  assert.equal(noLeft.diagnostics().left, null);
});
