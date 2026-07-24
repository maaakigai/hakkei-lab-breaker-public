#!/usr/bin/env python3
"""mocopi 単体センサー BLE 可否スパイク（runtime 経路の外・検証専用）.

目的（SPEC §0.24候補 / BLE直読方式の実機検証）:
  「mocopi app / Unity を使わず、mocopi センサー1個に Windows から BLE 直結して
   50Hz で加速度 notify が取れ、静止とパンチが |accel| で明確に分離するか」だけを潰す。

このスクリプトは公開されたプロトコル「事実」（characteristic UUID・start コマンド列・
int16/float16 スケール）だけを使って独自実装している（license 無し repo のコードは流用しない）。
プロトコル事実の出典: moslime/mocopi-reverse-engineering。

前提:
  pip install bleak
  Windows の Bluetooth ON。mocopi センサーは「ペアリングせず」電源 ON で青点滅(advertising)。
  接続が確立するまで（最初の数秒）はセンサーを軽く振り続けて起こしておく（静止でスリープするため）。

フェーズ測定（推奨プロトコル・時間ベース）:
  [0..settle)            接続+起こし: センサーを振り続ける（解析から除外）
  [settle..settle+1)     baseline: 静止（重力ベクトル推定）
  [settle+1..+still)     静止域: そのまま静止（誤発火チェック）
  [settle+1+still..end)  パンチ域: 強いパンチを数回（分離チェック）

使い方:
  python tools/mocopi_ble_probe.py --scan
  python tools/mocopi_ble_probe.py --address <ADDR> --settle 5 --still 6 --duration 20 --csv out.csv
"""

import argparse
import asyncio
import json
import math
import socket
import struct
import sys
import time

try:
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError, BleakDeviceNotFoundError
except ImportError:
    print("bleak が未インストールです。`pip install bleak` を実行してください。", file=sys.stderr)
    sys.exit(2)

# --- プロトコル事実（出典: moslime/mocopi-reverse-engineering）-----------------
DEVICE_NAME_PREFIX = "QM-SS1"
CMD_CHAR_UUID = "0000ff01-0000-1000-8000-00805f9b34fb"   # handle 0x0020（コマンド書き込み）
DATA_CHAR_UUID = "25047e64-657c-4856-afcf-e315048a965b"  # handle 0x0049（notify）
START_STREAM_CMD = bytes([0x7E, 0x03, 0x18, 0xD6, 0x01, 0x00, 0x00])
QUAT_SCALE = 1.0 / 8192.0
PACKET_LEN = 36
# -----------------------------------------------------------------------------


def parse_packet(data: bytes):
    """36byte packet → (quat(w,x,y,z), accel(x,y,z) float16)。counter は信頼できないので使わない。"""
    if len(data) < PACKET_LEN:
        return None
    qw, qx, qy, qz = struct.unpack_from("<4h", data, 8)
    quat = (qw * QUAT_SCALE, qx * QUAT_SCALE, qy * QUAT_SCALE, qz * QUAT_SCALE)
    ax, ay, az = struct.unpack_from("<3e", data, 24)  # float16 LE（軸対応は未同定だが norm は不変）
    return quat, (ax, ay, az)


def vlen(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


async def scan(timeout: float):
    print(f"BLE スキャン中（{timeout:.0f}s）… mocopi は青点滅(advertising)・mocopi app は閉じる")
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    found = []
    for addr, (d, adv) in devices.items():
        name = d.name or ""
        mark = " <-- mocopi" if name.startswith(DEVICE_NAME_PREFIX) else ""
        if name:
            print(f"  {addr}  {name}  rssi={adv.rssi}{mark}")
        if name.startswith(DEVICE_NAME_PREFIX):
            found.append(d)
    return found


class Capture:
    def __init__(self):
        self.first_ts = None
        self.last_ts = None
        self.count = 0
        self.bad_len = 0
        self.samples = []  # (t, ax, ay, az, norm_raw)
        self.gaps = []     # 連続パケット間隔(秒) ← 安定性/ドロップ検出
        self.disconnect_t = None  # 切断された相対時刻（None=切断なし）

    def on_notify(self, _char, data: bytes):
        now = time.perf_counter()
        if len(data) != PACKET_LEN:
            self.bad_len += 1
        parsed = parse_packet(data)
        if parsed is None:
            return
        _quat, accel = parsed
        if self.first_ts is None:
            self.first_ts = now
        else:
            self.gaps.append(now - self.last_ts)
        self.last_ts = now
        self.count += 1
        t = now - self.first_ts
        self.samples.append((t, accel[0], accel[1], accel[2], vlen(accel)))


def analyze(cap: Capture, settle: float, still: float):
    print("\n===== スパイク集計（GO/No-Go 判定材料）=====")
    if cap.count == 0 or cap.first_ts is None:
        print("  受信 0。No-Go: notify が取れていない。")
        return
    span = max(1e-6, cap.last_ts - cap.first_ts)
    rate = cap.count / span
    print(f"  受信 {cap.count} packets / {span:.1f}s → {rate:.1f} Hz")
    print(f"  payload!=36byte の回数: {cap.bad_len}")

    # --- 接続安定性（ドロップ検出）---
    if cap.gaps:
        max_gap = max(cap.gaps)
        n100 = sum(1 for g in cap.gaps if g > 0.10)
        n200 = sum(1 for g in cap.gaps if g > 0.20)
        n500 = sum(1 for g in cap.gaps if g > 0.50)
        print("  [安定性] パケット間隔:"
              f" 最大 {max_gap * 1000:.0f}ms / >100ms {n100}回 / >200ms {n200}回 / >500ms {n500}回")
    if cap.disconnect_t is not None:
        print(f"  [安定性] !! 計測中に切断 @ {cap.disconnect_t:.1f}s（duration 未満で落ちた）")
    else:
        print(f"  [安定性] 計測中の切断なし（{span:.0f}s 連続接続を維持）")

    # baseline（重力ベクトル）= [settle, settle+1) の平均。
    base = [s for s in cap.samples if settle <= s[0] < settle + 1.0]
    if not base:
        print(f"  baseline 窓 [{settle:.0f},{settle + 1:.0f})s にサンプルが無い。--settle/--duration を調整。")
        return
    bx = sum(s[1] for s in base) / len(base)
    by = sum(s[2] for s in base) / len(base)
    bz = sum(s[3] for s in base) / len(base)
    print(f"  baseline(重力推定)= ({bx:+.2f},{by:+.2f},{bz:+.2f}) |g|={vlen((bx, by, bz)):.2f}")

    def energy(s):
        return vlen((s[1] - bx, s[2] - by, s[3] - bz))

    still_lo, still_hi = settle + 1.0, settle + 1.0 + still
    still_samples = [energy(s) for s in cap.samples if still_lo <= s[0] < still_hi]
    punch_samples = [energy(s) for s in cap.samples if s[0] >= still_hi]

    still_max = max(still_samples) if still_samples else 0.0
    punch_peak = max(punch_samples) if punch_samples else 0.0
    ratio = punch_peak / still_max if still_max > 1e-6 else float("inf")
    print(f"  静止域 [{still_lo:.0f},{still_hi:.0f})s accelEnergy 最大: {still_max:.2f}（n={len(still_samples)}）")
    print(f"  パンチ域 [{still_hi:.0f}..]s accelEnergy ピーク: {punch_peak:.2f}（n={len(punch_samples)}）")
    print(f"  分離比 punchPeak/stillMax = {ratio:.1f}x（5x 以上で GO）")

    go_rate = rate >= 45
    go_len = cap.bad_len == 0
    go_sep = ratio >= 5.0
    print("\n  判定の目安:")
    print(f"   rate >=45Hz: {'OK' if go_rate else 'NG'}（{rate:.1f}Hz）")
    print(f"   payload 36byte 安定: {'OK' if go_len else 'NG'}")
    print(f"   静止/パンチ分離 >=5x: {'OK' if go_sep else 'NG'}（{ratio:.1f}x）")
    print(f"   → {'GO 候補' if (go_rate and go_len and go_sep) else '要再測定/調整'}（再接続は複数回起動で別途確認）")


async def run(target, args):
    address = getattr(target, "address", target)
    cap = Capture()
    csv_file = open(args.csv, "w", encoding="utf-8") if args.csv else None
    if csv_file:
        csv_file.write("t,ax,ay,az,norm_raw\n")
    raw_file = open(args.raw, "w", encoding="utf-8") if args.raw else None
    if raw_file:
        raw_file.write("t,hex\n")
    udp_sock = None
    session_id = f"ble-{int(time.time())}"
    if args.emit_udp:
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def on_disconnect(_client):
        if cap.first_ts is not None and cap.disconnect_t is None:
            cap.disconnect_t = time.perf_counter() - cap.first_ts
        print(f"  !! BLE 切断検出 @ {cap.disconnect_t}")

    print(f"接続中: {address}（timeout 25s）")
    async with BleakClient(target, timeout=25.0, disconnected_callback=on_disconnect) as client:
        print(f"  connected={client.is_connected}")
        svcs = client.services
        has_cmd = any(c.uuid.lower() == CMD_CHAR_UUID for s in svcs for c in s.characteristics)
        has_data = any(c.uuid.lower() == DATA_CHAR_UUID for s in svcs for c in s.characteristics)
        print(f"  cmd char present={has_cmd} / data char present={has_data}")
        if not has_data:
            print("  !! data characteristic が無い。services 一覧:")
            for s in svcs:
                for c in s.characteristics:
                    print(f"     {c.uuid} {c.properties}")
            return

        def cb(ch, data):
            cap.on_notify(ch, data)
            if raw_file and cap.first_ts is not None:
                raw_file.write(f"{time.perf_counter() - cap.first_ts:.4f},{bytes(data).hex()}\n")
            if csv_file and cap.samples:
                s = cap.samples[-1]
                csv_file.write(f"{s[0]:.4f},{s[1]:.4f},{s[2]:.4f},{s[3]:.4f},{s[4]:.4f}\n")
            if udp_sock is not None:
                p = parse_packet(data)
                if p is not None:
                    q, a = p
                    pkt = {
                        "protocolVersion": 1, "type": "imu", "source": "mocopi-ble",
                        "sensorId": address, "sessionId": session_id, "seq": cap.count,
                        "timestampMs": int(time.perf_counter() * 1000), "sampleRateHz": 50,
                        "quat": {"w": q[0], "x": q[1], "y": q[2], "z": q[3]},
                        "accelRaw": {"x": a[0], "y": a[1], "z": a[2]}, "accelMagnitude": vlen(a),
                    }
                    try:
                        udp_sock.sendto(json.dumps(pkt).encode(), (args.udp_host, args.udp_port))
                    except OSError:
                        pass

        await client.start_notify(DATA_CHAR_UUID, cb)
        try:
            await client.write_gatt_char(CMD_CHAR_UUID, START_STREAM_CMD, response=True)
            print("  start コマンド送信。")
        except Exception as e:
            print(f"  !! start 書き込み失敗: {e}（notify のみで継続）")

        print(
            f"計測 {args.duration:.0f}s: [0..{args.settle:.0f})振る→"
            f"[{args.settle:.0f}..{args.settle + 1 + args.still:.0f})静止→"
            f"[{args.settle + 1 + args.still:.0f}..]強パンチ数回"
        )
        await asyncio.sleep(args.duration)
        try:
            await client.stop_notify(DATA_CHAR_UUID)
        except Exception:
            pass

    if csv_file:
        csv_file.close()
    if raw_file:
        raw_file.close()
    if udp_sock is not None:
        udp_sock.close()
    analyze(cap, args.settle, args.still)


async def resolve_target(args):
    if args.address is not None:
        return await BleakScanner.find_device_by_address(args.address, timeout=args.scan_timeout)
    found = await scan(args.scan_timeout)
    return found[0] if found else None


async def main_async(args):
    if args.scan:
        await scan(args.scan_timeout)
        return
    attempts = args.attempts
    for i in range(attempts):
        target = await resolve_target(args)
        if target is None:
            print(f"  advertising に出ない（{i + 1}/{attempts}）。センサーを振って起こして再試行…")
            await asyncio.sleep(1.0)
            continue
        try:
            await run(target, args)
            return
        except (BleakDeviceNotFoundError, BleakError, TimeoutError, EOFError) as e:
            print(f"  接続失敗（{i + 1}/{attempts}）: {type(e).__name__}: {e}")
            print("  → センサーを軽く振り続けて advertising を維持。再試行…")
            await asyncio.sleep(1.5)
    print("接続に繰り返し失敗。センサーを動かしながら再実行してください。", file=sys.stderr)
    sys.exit(1)


def main():
    p = argparse.ArgumentParser(description="mocopi 単体センサー BLE 可否スパイク")
    p.add_argument("--scan", action="store_true", help="スキャンのみ")
    p.add_argument("--scan-timeout", type=float, default=8.0)
    p.add_argument("--address", default=None)
    p.add_argument("--duration", type=float, default=20.0)
    p.add_argument("--attempts", type=int, default=4, help="接続リトライ回数（ストレステストは1で単発）")
    p.add_argument("--settle", type=float, default=5.0, help="接続+起こし（解析除外）秒")
    p.add_argument("--still", type=float, default=6.0, help="静止域（誤発火チェック）秒")
    p.add_argument("--csv", default=None)
    p.add_argument("--raw", default=None, help="生36byteのhexをCSVに記録（accelフォーマット診断用）")
    p.add_argument("--emit-udp", action="store_true")
    p.add_argument("--udp-host", default="127.0.0.1")
    p.add_argument("--udp-port", type=int, default=45150)
    args = p.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n中断")


if __name__ == "__main__":
    main()
