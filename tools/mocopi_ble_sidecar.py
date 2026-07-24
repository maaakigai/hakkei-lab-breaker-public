#!/usr/bin/env python3
"""mocopi BLE sidecar（本番入力源）— connect-once-keep-alive + 自動再接続.

展示中の接続安定性検証（2026-06-27）に基づき、SPEC v2 / GATES-v2 F の再接続方針を実装:
  - 状態: DISCONNECTED→SCANNING→CONNECTING→STARTING_STREAM→RECEIVING→(RECONNECTING)→...
  - on disconnect: 即時3回リトライ→指数バックオフ最大5s。アプリ(Main)は落とさない。
  - RECEIVING 中だけ mocopi-ble packet(type:imu) を UDP emit。状態は type:status で別途 emit。
  - keep-alive: 切断しても終了しない（--duration 0 で Ctrl+C まで常駐）。

このツールは F-1 耐久ゲート（30分連続・切断/再接続時間・gap）の計測も兼ねる。
センサーは「接続後は静止でもストリーム継続」なので、耐久テストは**机に置いたまま**でよい（腕不要）。

使い方:
  python tools/mocopi_ble_sidecar.py                       # scan して常駐・UDP45150へemit
  python tools/mocopi_ble_sidecar.py --address <ADDR>      # アドレス指定
  python tools/mocopi_ble_sidecar.py --duration 1800       # 30分でF-1集計を出して終了
  python tools/mocopi_ble_sidecar.py --no-emit             # UDP送らず接続耐久だけ見る

プロトコル事実出典: moslime/mocopi-reverse-engineering（コード非流用・事実のみ）。
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
    print("bleak 未インストール。`pip install bleak`。", file=sys.stderr)
    sys.exit(2)

DEVICE_NAME_PREFIX = "QM-SS1"
CMD_CHAR_UUID = "0000ff01-0000-1000-8000-00805f9b34fb"
DATA_CHAR_UUID = "25047e64-657c-4856-afcf-e315048a965b"
START_STREAM_CMD = bytes([0x7E, 0x03, 0x18, 0xD6, 0x01, 0x00, 0x00])
QUAT_SCALE = 1.0 / 8192.0
PACKET_LEN = 36


def parse_packet(b: bytes):
    if len(b) < PACKET_LEN:
        return None
    qw, qx, qy, qz = struct.unpack_from("<4h", b, 8)
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz) or 1.0
    quat = (qw / n, qx / n, qy / n, qz / n)  # 正規化（角速度計算の前提）
    ax, ay, az = struct.unpack_from("<3h", b, 24)
    return quat, (ax, ay, az)


class Sidecar:
    def __init__(self, args):
        self.args = args
        self.state = "DISCONNECTED"
        self.seq = 0
        self.session_id = f"ble-{int(time.time())}"
        # 統計（セッション全体・F-1 集計用）
        self.packets = 0
        self.first_ts = None
        self.last_pkt_ts = None
        self.gaps_over_200 = 0
        self.gaps_over_500 = 0
        self.max_gap = 0.0
        self.disconnects = 0
        self.reconnect_durations = []  # 各再接続にかかった秒数（disconnect→RECEIVING復帰）
        self._disc_evt = None
        self._reconnect_start = None    # 切断時刻（復帰で確定しクリア）
        self._immediate = 0             # 即時リトライ回数
        self._backoff = 0.0             # バックオフ秒
        self._started = None
        self._deadline = None
        self.sock = None
        if not args.no_emit:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def set_state(self, s):
        if s != self.state:
            self.state = s
            print(f"  [state] {s}")
            self.emit_status()

    def emit_status(self):
        if self.sock is None:
            return
        age = (time.perf_counter() - self.last_pkt_ts) if self.last_pkt_ts else None
        rate = self._rate()
        msg = {
            "protocolVersion": 1, "type": "status", "source": "mocopi-ble",
            "sessionId": self.session_id, "state": self.state,
            "rateHz": round(rate, 1), "lastPacketAgeMs": round(age * 1000) if age else None,
            "disconnects": self.disconnects, "maxGapMs": round(self.max_gap * 1000),
            "gapsOver200": self.gaps_over_200,
        }
        try:
            self.sock.sendto(json.dumps(msg).encode(), (self.args.udp_host, self.args.udp_port))
        except OSError:
            pass

    def _rate(self):
        if self.first_ts is None or self.last_pkt_ts is None:
            return 0.0
        span = self.last_pkt_ts - self.first_ts
        return self.packets / span if span > 1e-6 else 0.0

    def on_notify(self, _char, data: bytes):
        now = time.perf_counter()
        parsed = parse_packet(data)
        if parsed is None:
            return
        if self.first_ts is None:
            self.first_ts = now
        elif self.last_pkt_ts is not None:
            gap = now - self.last_pkt_ts
            self.max_gap = max(self.max_gap, gap)
            if gap > 0.20:
                self.gaps_over_200 += 1
            if gap > 0.50:
                self.gaps_over_500 += 1
        self.last_pkt_ts = now
        self.packets += 1
        if self.state != "RECEIVING":
            self.set_state("RECEIVING")
            # 切断からの復帰なら再接続時間を確定し、リトライ状態をリセット。
            if self._reconnect_start is not None:
                self.reconnect_durations.append(time.perf_counter() - self._reconnect_start)
                print(f"  [reconnect] 復帰 {self.reconnect_durations[-1]:.1f}s")
                self._reconnect_start = None
                self._immediate = 0
                self._backoff = 0.0
        if self.sock is not None:
            quat, accel = parsed
            self.seq += 1
            pkt = {
                "protocolVersion": 1, "type": "imu", "source": "mocopi-ble",
                "sensorId": "mocopi", "sessionId": self.session_id, "seq": self.seq,
                "timestampMs": int(now * 1000), "sampleRateHz": 50,
                "quat": {"w": quat[0], "x": quat[1], "y": quat[2], "z": quat[3]},
                "accelRaw": {"x": accel[0], "y": accel[1], "z": accel[2]},
            }
            try:
                self.sock.sendto(json.dumps(pkt).encode(), (self.args.udp_host, self.args.udp_port))
            except OSError:
                pass

    async def resolve(self):
        if self.args.address:
            return await BleakScanner.find_device_by_address(self.args.address, timeout=self.args.scan_timeout)
        self.set_state("SCANNING")
        devs = await BleakScanner.discover(timeout=self.args.scan_timeout, return_adv=True)
        for addr, (d, _adv) in devs.items():
            if (d.name or "").startswith(DEVICE_NAME_PREFIX):
                return d
        return None

    async def connect_once(self):
        """1回の接続セッション。切断されるか duration 終了で戻る。"""
        target = await self.resolve()
        if target is None:
            return False
        self._disc_evt = asyncio.Event()

        def on_disc(_c):
            print("  !! BLE 切断検出")
            if self._disc_evt and not self._disc_evt.is_set():
                self._disc_evt.set()

        self.set_state("CONNECTING")
        async with BleakClient(target, timeout=25.0, disconnected_callback=on_disc) as client:
            if not any(c.uuid.lower() == DATA_CHAR_UUID for s in client.services for c in s.characteristics):
                print("  data characteristic 無し。", file=sys.stderr)
                return False
            self.set_state("STARTING_STREAM")
            await client.start_notify(DATA_CHAR_UUID, self.on_notify)
            try:
                await client.write_gatt_char(CMD_CHAR_UUID, START_STREAM_CMD, response=True)
            except Exception as e:
                print(f"  start 書き込み失敗: {e}")
            # 接続維持ループ: 切断 or duration まで。定期 status。
            while not self._disc_evt.is_set():
                if self._deadline and time.perf_counter() >= self._deadline:
                    return True
                try:
                    await asyncio.wait_for(self._disc_evt.wait(), timeout=self.args.status_interval)
                except asyncio.TimeoutError:
                    self.emit_status()
                    self._print_live()
            return False  # 切断で抜けた

    def _print_live(self):
        age = (time.perf_counter() - self.last_pkt_ts) * 1000 if self.last_pkt_ts else -1
        up = (time.perf_counter() - self._started) if self._started else 0
        print(f"  [{self.state}] uptime={up:.0f}s rate={self._rate():.1f}Hz "
              f"age={age:.0f}ms pkts={self.packets} disc={self.disconnects} "
              f"maxGap={self.max_gap*1000:.0f}ms >200ms={self.gaps_over_200}")

    async def run(self):
        self._started = time.perf_counter()
        self._deadline = (self._started + self.args.duration) if self.args.duration > 0 else None
        while True:
            if self._deadline and time.perf_counter() >= self._deadline:
                break
            ended_by_duration = False
            try:
                ended_by_duration = await self.connect_once()
            except (BleakDeviceNotFoundError, BleakError, TimeoutError, EOFError) as e:
                print(f"  接続/通信エラー: {type(e).__name__}: {e}")
            if ended_by_duration:
                break
            # ここ＝切断 or 接続失敗。一度でも受信済みなら「切断」を1回だけカウントし復帰計測を開始。
            if self.packets > 0 and self._reconnect_start is None:
                self.disconnects += 1
                self._reconnect_start = time.perf_counter()
            self.set_state("RECONNECTING")
            # 即時3回はノーウェイト、その後 0.5→1→2→4→5(上限)。復帰すると on_notify でリセット。
            if self._immediate < 3:
                self._immediate += 1
                wait = 0.0
            else:
                self._backoff = min(5.0, self._backoff * 2 if self._backoff else 0.5)
                wait = self._backoff
            if wait > 0:
                await asyncio.sleep(wait)
        self.summary()

    def summary(self):
        print("\n===== sidecar F-1 集計 =====")
        span = (self.last_pkt_ts - self.first_ts) if (self.first_ts and self.last_pkt_ts) else 0
        print(f"  受信 {self.packets} packets / 連続 {span:.0f}s / 平均 {self._rate():.1f}Hz")
        print(f"  切断回数: {self.disconnects}")
        rd = [r for r in self.reconnect_durations if r is not None]
        if rd:
            print(f"  再接続時間: {[round(r,1) for r in rd]} s（最大 {max(rd):.1f}s）")
        print(f"  gap: 最大 {self.max_gap*1000:.0f}ms / >200ms {self.gaps_over_200}回 / >500ms {self.gaps_over_500}回")
        # F-1 目安
        ok_rate = 45 <= self._rate() <= 56
        ok_gap = self.gaps_over_500 == 0
        ok_recon = (not rd) or max(rd) <= 3.0
        print("  [F-1 目安] "
              f"rate45-55:{'OK' if ok_rate else 'NG'} / >500msGap0:{'OK' if ok_gap else 'NG'} / "
              f"再接続<=3s:{'OK' if ok_recon else 'NG'} / 切断{self.disconnects}回")
        if self.sock:
            self.sock.close()


def main():
    p = argparse.ArgumentParser(description="mocopi BLE sidecar（auto-reconnect）")
    p.add_argument("--address", default=None)
    p.add_argument("--scan-timeout", type=float, default=8.0)
    p.add_argument("--duration", type=float, default=0.0, help="秒。0=Ctrl+C まで常駐")
    p.add_argument("--status-interval", type=float, default=10.0)
    p.add_argument("--udp-host", default="127.0.0.1")
    p.add_argument("--udp-port", type=int, default=45150)
    p.add_argument("--no-emit", action="store_true", help="UDP送出せず接続耐久だけ計測")
    args = p.parse_args()
    sc = Sidecar(args)
    try:
        asyncio.run(sc.run())
    except KeyboardInterrupt:
        print("\n停止（Ctrl+C）")
        sc.summary()


if __name__ == "__main__":
    main()
