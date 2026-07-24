// src/renderer/diagnosticPanel.ts
//
// 入力診断の最小表示（M2-03 / M2-09）。押下キーと直近 MotionSample を出す。

import type {
  InputMode,
  KeyboardKey,
  MotionDiagnosticsPayload,
  MotionHeartbeatPayload,
  MotionSample,
  MotionSource,
  MotionStatusPayload,
} from "../shared/types.ts";

const ALL_KEYS: KeyboardKey[] = ["Space", "KeyA", "KeyD", "KeyL", "Enter", "KeyR", "Escape"];

export function diagnosticsHtml(
  pressed: ReadonlySet<KeyboardKey>,
  sample: MotionSample | null,
): string {
  const keys = ALL_KEYS.map(
    (k) => `<span class="key ${pressed.has(k) ? "on" : ""}">${k}</span>`,
  ).join("");

  if (!sample) {
    return `
      <div class="diag-keys">${keys}</div>
      <div class="diag-sample">sample: （未受信）</div>`;
  }

  const f = (n: number): string => n.toFixed(3);
  return `
    <div class="diag-keys">${keys}</div>
    <div class="diag-sample">
      <span>src=${sample.source}</span>
      <span>seq=${sample.seq}</span>
      <span>Hz=${sample.quality.sampleRateHz.toFixed(0)}</span>
      <span>pos y=${f(sample.handPosition.y)} z=${f(sample.handPosition.z)}</span>
      <span>vel z=${f(sample.velocity.z)}</span>
      <span>valid=${sample.validForScore ? "1" : "0"}</span>
    </div>`;
}

// --- M6: Unity / Mock 入力の受信診断パネル ------------------------------

function activeSourceForMode(mode: InputMode): MotionSource | null {
  if (mode === "unity-bridge") return "unity-bridge";
  if (mode === "mock-unity-bridge") return "mock-unity-bridge";
  if (mode === "keyboard") return "keyboard";
  return null;
}

function okNg(ok: boolean): string {
  return `<span class="okng ${ok ? "ok" : "ng"}">${ok ? "OK" : "NG"}</span>`;
}

export function statusPanelHtml(
  mode: InputMode,
  status: MotionStatusPayload | null,
  heartbeat: MotionHeartbeatPayload | null,
  sample: MotionSample | null,
  nowMs: number,
  diagnostics: MotionDiagnosticsPayload | null = null,
): string {
  const source = activeSourceForMode(mode);
  const snap = source && status ? status.sourceStatuses[source] : null;

  const receiving = snap?.isReceiving ?? false; // M6-02
  const ageMs = snap?.lastMotionAtMs != null ? Math.max(0, nowMs - snap.lastMotionAtMs) : null; // M6-03
  const motionHz = snap?.motionHz ?? 0; // M6-04
  const hbHz = snap?.heartbeatHz ?? 0;
  const hbAlive = hbHz > 0 || (heartbeat?.isAlive ?? false); // M6-05
  const rightHandReady = heartbeat?.rightHandReady ?? snap?.rightHandReady ?? null; // M6-06
  const receiverStatus = heartbeat?.receiverStatus ?? snap?.receiverStatus ?? "—";
  const invalidCount = snap?.invalidPacketCount ?? 0; // M6-08

  const coordSample = sample && sample.source === source ? sample : null; // M6-07
  const c = (n: number | undefined): string => (n === undefined ? "—" : n.toFixed(3));
  const j = (n: number | null | undefined): string =>
    n == null ? "—" : `${(n * 1000).toFixed(0)}mm`;

  // M7-10: quality flags（欠落・外れ値・dt異常）
  const flags = coordSample?.quality.flags ?? [];
  const flagsHtml =
    flags.length === 0 ? `<span class="flag none">なし</span>` : flags.map((f) => `<span class="flag">${f}</span>`).join("");
  const ratio = diagnostics?.validSampleRatio;

  const rows = [
    `<tr><th>入力モード</th><td>${mode}</td></tr>`,
    `<tr><th>motion受信</th><td>${okNg(receiving)} ${receiving ? "" : "（NG）"}</td></tr>`,
    `<tr><th>最終受信</th><td>${ageMs == null ? "—" : `${ageMs} ms 前`}</td></tr>`,
    `<tr><th>受信Hz</th><td>${motionHz.toFixed(1)} Hz</td></tr>`,
    `<tr><th>heartbeat</th><td>${okNg(hbAlive)} ${hbHz.toFixed(1)}Hz / ${receiverStatus}</td></tr>`,
    `<tr><th>rightHandReady</th><td>${rightHandReady == null ? "—" : okNg(rightHandReady)}</td></tr>`,
    `<tr><th>現在座標</th><td>x=${c(coordSample?.handPosition.x)} y=${c(coordSample?.handPosition.y)} z=${c(coordSample?.handPosition.z)}</td></tr>`,
    `<tr><th>invalidPacket</th><td>${invalidCount}${status ? ` / global ${status.globalInvalidPacketCount}` : ""}</td></tr>`,
    `<tr><th>jitter(raw/filt)</th><td>rms ${j(diagnostics?.rawJitterRms2s)} / ${j(diagnostics?.filteredJitterRms2s)} &nbsp; drift ${j(diagnostics?.rawDrift2s)} / ${j(diagnostics?.filteredDrift2s)}</td></tr>`,
    `<tr><th>validSampleRatio</th><td>${ratio == null ? "—" : `${(ratio * 100).toFixed(0)}%`}</td></tr>`,
    `<tr><th>quality flags</th><td class="flags">${flagsHtml}</td></tr>`,
  ].join("");

  const hint = receiving
    ? ""
    : `<p class="diag-hint">受信できていません。確認: ① Unity Bridge / mock が起動しているか ② 送信先が 127.0.0.1:45100 か ③ 別アプリがポートを使っていないか。動かないときは下の「Keyboardに切替」で進めます。</p>`;

  return `<table class="status-table">${rows}</table>${hint}`;
}
