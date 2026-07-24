// src/renderer/sampleRecorder.ts
//
// M15-09 記録（Recorder）の純粋ロジック（docs/M15-09-experiment.md）。
// 連続 MotionSample を buffer し、trial 境界マーカーを付ける。DOM/ファイル I/O は app.ts 側。
// 「連続ストリーム＋trial境界」を守る。

import type {
  CalibrationSnapshotForRecord,
  OperatorVerdict,
  RecordedConfigSnapshot,
  RecordingFile,
  TrialLabel,
  TrialMarker,
} from "../shared/recordingTypes.ts";
import type { DominantHand, MotionSample } from "../shared/types.ts";

type OpenTrial = {
  trialId: string;
  label: TrialLabel;
  operatorVerdict: OperatorVerdict;
  dominantHand: DominantHand;
  chargeRaw: number;
  startTimestampMs: number | null; // 最初の sample が来たら確定
};

export type RecorderStatus = {
  armed: boolean;
  frameCount: number;
  trialCount: number;
  openTrialLabel: TrialLabel | null;
};

export class SampleRecorder {
  private frames: MotionSample[] = [];
  private trials: TrialMarker[] = [];
  private open: OpenTrial | null = null;
  private armed = false;
  private seq = 0;

  arm(): void {
    this.armed = true;
  }
  disarm(): void {
    this.armed = false;
  }
  reset(): void {
    this.frames = [];
    this.trials = [];
    this.open = null;
    this.armed = false;
    this.seq = 0;
  }

  // armed の間だけ連続ストリームへ積む。open trial があれば開始 timestamp を確定。
  push(sample: MotionSample): void {
    if (!this.armed) {
      return;
    }
    this.frames.push(sample);
    if (this.open !== null && this.open.startTimestampMs === null) {
      this.open.startTimestampMs = sample.timestampMs;
    }
  }

  // trial を開始。armed でなければ自動で arm する（記録忘れ防止）。
  beginTrial(
    label: TrialLabel,
    dominantHand: DominantHand,
    operatorVerdict: OperatorVerdict = "valid",
    chargeRaw = 0,
  ): void {
    this.armed = true;
    this.seq += 1;
    this.open = {
      trialId: `${label}-${this.seq}`,
      label,
      operatorVerdict,
      dominantHand,
      chargeRaw,
      startTimestampMs: null,
    };
  }

  // open trial を閉じる。1 sample も来ていなければ破棄（空 trial を作らない）。
  endTrial(verdictOverride?: OperatorVerdict): TrialMarker | null {
    const o = this.open;
    this.open = null;
    if (o === null || o.startTimestampMs === null) {
      return null;
    }
    const lastTs = this.frames[this.frames.length - 1]?.timestampMs ?? o.startTimestampMs;
    const marker: TrialMarker = {
      trialId: o.trialId,
      label: o.label,
      operatorVerdict: verdictOverride ?? o.operatorVerdict,
      dominantHand: o.dominantHand,
      startTimestampMs: o.startTimestampMs,
      endTimestampMs: lastTs,
      chargeRaw: o.chargeRaw,
    };
    this.trials.push(marker);
    return marker;
  }

  status(): RecorderStatus {
    return {
      armed: this.armed,
      frameCount: this.frames.length,
      trialCount: this.trials.length,
      openTrialLabel: this.open?.label ?? null,
    };
  }

  build(meta: {
    recordedAtIso: string;
    commitSha: string;
    note: string;
    dominantHand: DominantHand;
    calibration: CalibrationSnapshotForRecord;
    config: RecordedConfigSnapshot;
  }): RecordingFile {
    // open trial が残っていれば閉じてから書き出す。
    if (this.open !== null) {
      this.endTrial();
    }
    return {
      schemaVersion: 1,
      recordedAtIso: meta.recordedAtIso,
      commitSha: meta.commitSha,
      note: meta.note,
      dominantHand: meta.dominantHand,
      calibration: meta.calibration,
      config: meta.config,
      frames: [...this.frames],
      trials: [...this.trials],
    };
  }
}
