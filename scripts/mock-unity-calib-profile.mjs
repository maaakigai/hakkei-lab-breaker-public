// scripts/mock-unity-calib-profile.mjs
//
// M11-13 協調 mock 用の決定的な位置プロファイル．
// 時間は app timer と Calibration 契約から組み立て，速度・加速度は生成しない．

const TWO_PI = Math.PI * 2;

export function createCalibProfile({ app, input, score, calibration, hz }) {
  const dtMs = 1000 / hz;
  const timers = app.timers;
  const filter = input.filter;
  const hakkei = score.hakkei;

  // Calibration は app の構え時間の後に discard → neutral → forward を実施する．
  const neutralStartMs = timers.calibrationPrepMs + calibration.discardMs;
  const neutralEndMs = neutralStartMs + calibration.neutralCaptureMs;
  const forwardEndMs = neutralEndMs + calibration.forwardCaptureMs;
  const readyEndMs = forwardEndMs + timers.readyCountdownMs;
  const verticalEndMs = readyEndMs + timers.verticalChargeMs;
  const forwardChargeEndMs = verticalEndMs + timers.forwardChargeMs;

  // raw position の二階差分が config 閾値を上回り，かつ MotionFilter の異常上限を越えない範囲にする．
  const maxPulseAcceleration = filter.maxReasonableAcceleration * 0.75;
  const targetAcceleration = Math.min(
    maxPulseAcceleration,
    // 位置・速度・加速度の EMA を通った後にも閾値を越える余裕を確保する．
    Math.max(hakkei.hakkeiMinForwardAcceleration * 8, hakkei.hakkeiMinForwardAcceleration),
  );
  const windupDurationMs = dtMs * 2;
  const windupDistanceM = hakkei.hakkeiMinForwardDisplacement * 1.5;
  const windupVelocity = windupDistanceM / (windupDurationMs / 1000);
  const acceleratedDistanceM = hakkei.hakkeiMinForwardDisplacement * 3;
  // 後方windupの負速度から一定の正加速度で前進へ反転する．
  // これにより変位条件へ達する時点で，EMA後の前方向加速度も十分に立ち上がる．
  const forwardPulseDurationMs =
    ((windupVelocity + Math.sqrt(windupVelocity ** 2 + 2 * targetAcceleration * (windupDistanceM + acceleratedDistanceM))) /
      targetAcceleration) *
    1000;
  const finalForwardVelocity =
    -windupVelocity + targetAcceleration * (forwardPulseDurationMs / 1000);
  // 加速直後に短いfollow-throughを設け，EMA後の速度が発勁閾値へ到達する時間を確保する．
  const followThroughMs = dtMs * 2;
  const pulseDistanceM =
    acceleratedDistanceM + finalForwardVelocity * (followThroughMs / 1000);
  const pulseDurationMs = windupDurationMs + forwardPulseDurationMs + followThroughMs;
  const pulseSettleMs = hakkei.hakkeiWindowMs;
  const hakkeiPulseStartMs = forwardChargeEndMs + pulseSettleMs;
  const hakkeiPulseEndMs = hakkeiPulseStartMs + pulseDurationMs;
  const cycleMs = hakkeiPulseEndMs + Math.max(timers.hakkeiReadyTimeoutMs - pulseSettleMs - pulseDurationMs, 0);

  // Charge の振幅と周期は入力 filter の position jump 上限より十分小さく保つ．
  const chargeAmplitudeM = Math.min(filter.maxPositionJump * 0.25, 0.25);
  const chargePeriodMs = 1000;
  const base = { x: 0.1, y: 1.2, z: -0.2 };
  const calibrationForwardDistanceM = Math.max(
    calibration.forwardMinDistanceM * 2,
    hakkei.hakkeiMinForwardDisplacement * 2,
  );

  function sampleAt(tMs) {
    const localMs = ((tMs % cycleMs) + cycleMs) % cycleMs;
    if (localMs < neutralStartMs) {
      return { ...base, phase: "calibration-discard" };
    }
    if (localMs < neutralEndMs) {
      return { ...base, phase: "neutral" };
    }
    if (localMs < forwardEndMs) {
      return {
        x: base.x,
        y: base.y,
        z: base.z + calibrationForwardDistanceM,
        phase: "forward-gesture",
      };
    }
    if (localMs < readyEndMs) {
      return { ...base, phase: "ready" };
    }
    if (localMs < verticalEndMs) {
      const phaseMs = localMs - readyEndMs;
      return {
        x: base.x,
        y: base.y + chargeAmplitudeM * Math.sin((TWO_PI * phaseMs) / chargePeriodMs),
        z: base.z,
        phase: "vertical-charge",
      };
    }
    if (localMs < forwardChargeEndMs) {
      const phaseMs = localMs - verticalEndMs;
      return {
        x: base.x,
        y: base.y,
        z: base.z + chargeAmplitudeM * Math.sin((TWO_PI * phaseMs) / chargePeriodMs),
        phase: "forward-charge",
      };
    }
    if (localMs < hakkeiPulseStartMs) {
      return { ...base, phase: "hakkei-settle" };
    }
    if (localMs <= hakkeiPulseEndMs) {
      const elapsedMs = localMs - hakkeiPulseStartMs;
      if (elapsedMs < windupDurationMs) {
        const progress = elapsedMs / windupDurationMs;
        return {
          x: base.x,
          y: base.y,
          z: base.z - windupDistanceM * progress,
          phase: "hakkei-pulse",
        };
      }
      const forwardElapsedMs = elapsedMs - windupDurationMs;
      if (forwardElapsedMs > forwardPulseDurationMs) {
        const followThroughSeconds = (forwardElapsedMs - forwardPulseDurationMs) / 1000;
        return {
          x: base.x,
          y: base.y,
          z: base.z + acceleratedDistanceM + finalForwardVelocity * followThroughSeconds,
          phase: "hakkei-pulse",
        };
      }
      const forwardElapsedSeconds = forwardElapsedMs / 1000;
      return {
        x: base.x,
        y: base.y,
        z:
          base.z -
          windupDistanceM -
          windupVelocity * forwardElapsedSeconds +
          0.5 * targetAcceleration * forwardElapsedSeconds ** 2,
        phase: "hakkei-pulse",
      };
    }
    return {
      x: base.x,
      y: base.y,
      z: base.z + pulseDistanceM,
      phase: "hakkei-hold",
    };
  }

  function mirrorLeftHand(rightHand) {
    return {
      x: -rightHand.x,
      y: rightHand.y,
      z: rightHand.z,
      phase: rightHand.phase,
    };
  }

  function sampleHandsAt(tMs) {
    const rightHand = sampleAt(tMs);
    return {
      rightHand,
      leftHand: mirrorLeftHand(rightHand),
      phase: rightHand.phase,
    };
  }

  return {
    cycleMs,
    pulse: { startMs: hakkeiPulseStartMs, endMs: hakkeiPulseEndMs, durationMs: pulseDurationMs, distanceM: pulseDistanceM },
    phases: { neutralStartMs, neutralEndMs, forwardEndMs, readyEndMs, verticalEndMs, forwardChargeEndMs },
    sampleAt,
    sampleHandsAt,
  };
}
