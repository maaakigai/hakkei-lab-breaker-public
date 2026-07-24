#!/usr/bin/env python3
"""録画した mocopi 生データ(ble-raw*.csv)を 50Hz で再生し、mocopi-ble UDP パケットを emit する.

目的: 「一度録って、あとは無限リプレイ」。実機センサー無し・腕を疲れさせずに、
   Main の角速度 metrics / renderer / score / 閾値チューニング / 再接続ロジックを開発・回帰する。
   = 実機 BLE sidecar の代わりの「mock BLE source」。M15-09 の record→replay 方針の BLE 版。

入力: probe の `--raw` で録った CSV（列 t,hex）。
出力: SPEC v2 draft §4 の mocopi-ble packet（quaternion 必須）を localhost UDP へ。

使い方:
  python tools/mocopi_ble_replay.py ble-raw3.csv                 # 実時間で1回再生
  python tools/mocopi_ble_replay.py ble-raw3.csv --loop          # 無限ループ
  python tools/mocopi_ble_replay.py ble-raw3.csv --print         # 送らず角速度を表示(sanity)
  python tools/mocopi_ble_replay.py ble-stress.csv --rate 0 --loop  # 等速最速(timing無視)
"""

import argparse
import csv
import json
import math
import socket
import struct
import sys
import time

QUAT_SCALE = 1.0 / 8192.0


def parse(hexstr: str):
    b = bytes.fromhex(hexstr)
    if len(b) < 36:
        return None
    qw, qx, qy, qz = struct.unpack_from("<4h", b, 8)
    ax, ay, az = struct.unpack_from("<3h", b, 24)
    return (qw * QUAT_SCALE, qx * QUAT_SCALE, qy * QUAT_SCALE, qz * QUAT_SCALE), (ax, ay, az)


def _unit(q):
    n = math.sqrt(sum(x * x for x in q)) or 1.0
    return tuple(x / n for x in q)


def quat_angle(a, b):
    # 角速度計算の前にクォータニオンを正規化（int16/8192 は厳密 unit でないため必須）。
    a, b = _unit(a), _unit(b)
    d = min(1.0, abs(sum(x * y for x, y in zip(a, b))))
    return math.degrees(2 * math.acos(d))


def load(path):
    rows = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            p = parse(row["hex"])
            if p is not None:
                rows.append((float(row["t"]), p[0], p[1]))
    return rows


def main():
    ap = argparse.ArgumentParser(description="mocopi 録画リプレイ → mocopi-ble UDP")
    ap.add_argument("csv", help="probe --raw で録った CSV（t,hex）")
    ap.add_argument("--udp-host", default="127.0.0.1")
    ap.add_argument("--udp-port", type=int, default=45150)
    ap.add_argument("--loop", action="store_true", help="無限ループ再生")
    ap.add_argument("--rate", type=float, default=-1.0,
                    help="送出間隔の固定Hz。-1=録画の実時間, 0=最速")
    ap.add_argument("--print", dest="do_print", action="store_true",
                    help="UDP送出せず、角速度(deg/sample)を表示してデータ確認")
    args = ap.parse_args()

    rows = load(args.csv)
    if not rows:
        print("有効なパケットが無い。", file=sys.stderr)
        sys.exit(1)
    print(f"loaded {len(rows)} packets from {args.csv} (span {rows[-1][0]-rows[0][0]:.1f}s)")

    sock = None
    if not args.do_print:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        print(f"emit mocopi-ble → {args.udp_host}:{args.udp_port}  (Ctrl+C で停止)")

    seq = 0
    session_id = "replay"
    prev_q = None
    loops = 0
    try:
        while True:
            t0 = time.perf_counter()
            base_t = rows[0][0]
            for i, (t, q, accel) in enumerate(rows):
                # timing
                if args.rate < 0:
                    target = t0 + (t - base_t)
                    dt = target - time.perf_counter()
                    if dt > 0:
                        time.sleep(dt)
                elif args.rate > 0:
                    time.sleep(1.0 / args.rate)
                seq += 1
                if args.do_print:
                    ang = quat_angle(prev_q, q) if prev_q else 0.0
                    if i % 10 == 0:
                        print(f"  t={t:6.2f} angVel={ang:6.2f} deg/sample  quat={tuple(round(x,3) for x in q)}")
                    prev_q = q
                    continue
                pkt = {
                    "protocolVersion": 1, "type": "imu", "source": "mocopi-ble",
                    "sensorId": "replay", "sessionId": session_id, "seq": seq,
                    "timestampMs": int(time.perf_counter() * 1000), "sampleRateHz": 50,
                    "quat": {"w": q[0], "x": q[1], "y": q[2], "z": q[3]},
                    "accelRaw": {"x": accel[0], "y": accel[1], "z": accel[2]},
                    "accelMagnitude": math.sqrt(sum(v * v for v in accel)),
                }
                sock.sendto(json.dumps(pkt).encode(), (args.udp_host, args.udp_port))
            loops += 1
            if not args.loop:
                break
            print(f"  loop {loops} 完了、再生し直し…")
    except KeyboardInterrupt:
        print("\n停止")
    finally:
        if sock:
            sock.close()
    print(f"done. emitted {seq} packets.")


if __name__ == "__main__":
    main()
