// src/main/bleSidecarManager.ts
//
// BLE sidecar / replay プロセスをElectron Mainがspawn・管理する。
// 目的: プレイヤーが端末でコマンドを打たず、アプリ起動（mocopi-ble モード選択）だけで BLE 入力が動く。
//
// - kind="sidecar": 実機 mocopi に BLE 接続（tools/mocopi_ble_sidecar.py --emit-udp）。
// - kind="replay" : 録画再生（tools/mocopi_ble_replay.py <csv> --loop）。実機なし dev/検証用。
// どちらも UDP <udpPort> へ mocopi-ble packet を流す → Main の MocopiBleUdpReceiver が受ける。
//
// 不変: アプリは絶対に落とさない。Python/exe 未検出・spawn 失敗・異常終了は status=error にして
// InputCheck 表示＋keyboard fallback に委ねる。自動再起動は rate-limit（3回まで即→以後 manual）。

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  BleSidecarKind,
  BleSidecarStatus,
  BleSidecarStatusPayload,
} from "../shared/types.ts";

export type BleSidecarManagerOptions = {
  pythonCmd?: string; // 明示指定（任意）。未指定なら bleak を持つ python を自動検出。
  projectRoot: string; // tools/ の親（絶対パス解決の基準）
  udpPort: number;
  replayCsv: string; // dev replay の録画（絶対パス）
  onStatus: (payload: BleSidecarStatusPayload) => void;
};

const MAX_AUTO_RESTARTS = 3;

// 1 候補について `-c "import bleak"` が通るか非同期で確認する（メインスレッドを塞がない）。
function checkBleak(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const fin = (ok: boolean): void => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    try {
      const cp = execFile(cmd, ["-c", "import bleak"], { timeout: 12000 }, (err) => fin(!err));
      cp.on("error", () => fin(false)); // ENOENT 等
    } catch {
      fin(false);
    }
  });
}

// bleak が import できる python 実体を探す（PATH 任せだと bleak 無し python を引く事故を防ぐ）。
// 候補を順に検証し最初に通ったものを返す。無ければ null。**非同期**（旧 execFileSync は
// 最大 12s×候補ぶんメインスレッドを凍結し、接続直前に UI が固まる原因だった）。
async function resolvePythonWithBleak(explicit?: string): Promise<string | null> {
  const home = homedir();
  const candidates = [
    explicit,
    process.env.PYTHON,
    "python",
    join(home, "anaconda3", "python.exe"),
    join(home, "miniconda3", "python.exe"),
    "python3",
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  for (const c of candidates) {
    if (await checkBleak(c)) {
      return c;
    }
  }
  return null;
}

export class BleSidecarManager {
  private child: ChildProcess | null = null;
  private status: BleSidecarStatus = "not-started";
  private kind: BleSidecarKind | null = null;
  private detail = "";
  private restarts = 0;
  private stopping = false;
  private pythonPromise: Promise<string | null> | null = null; // python 解決（1回だけ・非同期キャッシュ）
  private startGen = 0; // start() 世代。非同期 python 解決中に追い越し/停止を検知する。
  private readonly opts: BleSidecarManagerOptions;

  constructor(opts: BleSidecarManagerOptions) {
    this.opts = opts;
  }

  getStatus(): BleSidecarStatusPayload {
    return { status: this.status, kind: this.kind, detail: this.detail, restarts: this.restarts };
  }

  private setStatus(status: BleSidecarStatus, detail?: string): void {
    this.status = status;
    if (detail !== undefined) {
      this.detail = detail;
    }
    this.opts.onStatus(this.getStatus());
  }

  // python に渡す引数。-u で unbuffered（stdout が即 flush され status 判定が効く）。
  // スクリプトは絶対パス（cwd 非依存）。
  private argsFor(kind: BleSidecarKind): string[] {
    const port = String(this.opts.udpPort);
    const script = (name: string): string => join(this.opts.projectRoot, "tools", name);
    if (kind === "replay") {
      // replay は CSV を 50Hz でループ送出（--loop）。UDP は既定で送る。
      return ["-u", script("mocopi_ble_replay.py"), this.opts.replayCsv, "--loop", "--udp-port", port];
    }
    // sidecar は既定で UDP 送出する（--emit-udp は probe/replay のフラグで sidecar には無い）。
    return ["-u", script("mocopi_ble_sidecar.py"), "--udp-port", port];
  }

  // python を1回だけ非同期解決（キャッシュ）。UI を塞がない。
  private resolvePython(): Promise<string | null> {
    if (!this.pythonPromise) {
      this.pythonPromise = resolvePythonWithBleak(this.opts.pythonCmd);
    }
    return this.pythonPromise;
  }

  // kind の sidecar/replay を起動する（既存があれば止めてから）。restarts は手動 start で 0 リセット。
  // python 解決は非同期。解決完了までに新しい start()/stop() が来たら（startGen で判定）中断する。
  start(kind: BleSidecarKind, isAutoRestart = false): void {
    this.stop();
    if (!isAutoRestart) {
      this.restarts = 0;
    }
    this.kind = kind;
    this.stopping = false;
    const gen = ++this.startGen;
    this.setStatus("starting", `${kind} 準備中…（Python 検出中）`);
    void this.resolvePython().then((python) => {
      // 追い越された（新しい start）／停止済みなら中断。
      if (gen !== this.startGen || this.stopping) {
        return;
      }
      if (python === null) {
        this.setStatus("error", "bleak のある Python が見つかりません（pip install bleak / PYTHON 環境変数で指定）。keyboard へ。");
        return;
      }
      this.spawnChild(kind, python, gen);
    });
  }

  private spawnChild(kind: BleSidecarKind, python: string, gen: number): void {
    this.setStatus("starting", `${kind} 起動中…（${python}）`);
    let child: ChildProcess;
    try {
      child = spawn(python, this.argsFor(kind), {
        cwd: this.opts.projectRoot,
        windowsHide: true,
      });
    } catch (e) {
      this.setStatus("error", `spawn 失敗: ${(e as Error).message}（Python 未検出?）`);
      return;
    }
    this.child = child;

    child.on("error", (e) => {
      // ENOENT 等（python が無い）。
      this.setStatus("error", `起動エラー: ${e.message}（Python/依存を確認、または keyboard へ）`);
    });
    child.stdout?.on("data", (buf: Buffer) => {
      const line = buf.toString("utf8").trim().split("\n").pop() ?? "";
      if (line) {
        this.detail = line.slice(0, 200);
        if (this.status !== "running") {
          this.setStatus("running", this.detail);
        } else {
          this.opts.onStatus(this.getStatus());
        }
      }
    });
    child.stderr?.on("data", (buf: Buffer) => {
      this.detail = buf.toString("utf8").trim().slice(0, 200);
      this.opts.onStatus(this.getStatus());
    });
    child.on("exit", (code, signal) => {
      // このハンドラの子だけ null 化（stop→start レースで新しい子を消さない）。
      if (this.child === child) {
        this.child = null;
      }
      // 停止指示 or 追い越し済みなら再起動しない。
      if (this.stopping || gen !== this.startGen) {
        this.setStatus("stopped", "停止しました");
        return;
      }
      // 意図しない終了 → rate-limit つき自動再起動。
      if (this.restarts < MAX_AUTO_RESTARTS) {
        this.restarts += 1;
        this.setStatus("starting", `異常終了(code=${code ?? signal})。自動再起動 ${this.restarts}/${MAX_AUTO_RESTARTS}…`);
        setTimeout(() => {
          if (this.kind) {
            this.start(this.kind, true);
          }
        }, 800);
      } else {
        this.setStatus("error", `繰り返し終了(code=${code ?? signal})。手動 retry か keyboard へ。`);
      }
    });
  }

  // プレイ開始（InputCheck 到達）時に自動再起動枠をリセットする。タイトル先行接続中の
  // 稀なクラッシュで枠を使い切っても、プレイ時に新しい枠で再接続できるようにする。
  resetRestarts(): void {
    this.restarts = 0;
  }

  // 既に同 kind で起動中/稼働中なら何もしない（生きた BLE 接続を切らずに使い回す）。
  // applyMode は「start」イベントごとに呼ばれるため、start() の stop→再spawn をそのまま使うと
  // 接続済みの sidecar を毎回 kill してしまい、OS 側に接続が残ったまま新プロセスの再接続が
  // タイムアウト待ちで極端に遅くなる（2回目以降ずっと connecting）。それを防ぐ。
  ensureStarted(kind: BleSidecarKind): void {
    if (
      this.child !== null &&
      this.kind === kind &&
      (this.status === "running" || this.status === "starting")
    ) {
      return; // 生きた接続を維持
    }
    this.start(kind);
  }

  restart(): void {
    if (this.kind) {
      this.start(this.kind);
    }
  }

  stop(): void {
    if (this.child) {
      this.stopping = true;
      this.child.kill();
      this.child = null;
    }
    if (this.status !== "not-started") {
      this.setStatus("stopped");
    }
  }
}
