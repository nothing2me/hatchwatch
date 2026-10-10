#!/usr/bin/env python3
"""NestTrace ESP32-S3 camera helper: restart, log, flash, status and secrets setup.

Run from anywhere:  firmware/esp32s3-cam/tools/board.py <command> [options]
Needs pyserial for restart/log (see firmware README, "Quick setup with the board helper").
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

SKETCH = Path(__file__).resolve().parent.parent
REPO = SKETCH.parent.parent
SECRETS = SKETCH / 'secrets.h'
EXAMPLE = SKETCH / 'secrets.example.h'
DASHBOARD = REPO / 'dashboard'
FQBN = 'esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc'
ARDUINO_CLI_PATHS = [
    '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli',
    str(Path.home() / 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe'),
]
BOOT_NOISE = re.compile(r'^(ESP-ROM|Build:|SPIWP|mode:|load:|entry )')


def fail(message: str) -> None:
    print(f'error: {message}', file=sys.stderr)
    sys.exit(1)


def find_port(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        from serial.tools import list_ports
    except ImportError:
        fail("pyserial is missing; see the firmware README, \"Quick setup with the board helper\"")
    for port in list_ports.comports():
        # Espressif's native USB (USB-Serial/JTAG) is VID 0x303A.
        if port.vid == 0x303A or 'usbmodem' in port.device:
            return port.device
    fail('no ESP32 board found on USB; plug it in or pass --port')


def free_port(port: str) -> None:
    """Close the Arduino IDE Serial Monitor if it holds the port (it blocks resets and uploads)."""
    if not shutil.which('lsof'):
        return
    result = subprocess.run(['lsof', '-t', port], capture_output=True, text=True)
    for pid in result.stdout.split():
        name = subprocess.run(['ps', '-o', 'comm=', '-p', pid], capture_output=True, text=True).stdout.strip()
        if 'serial-monitor' in name:
            os.kill(int(pid), signal.SIGTERM)
            print('closed the Arduino IDE Serial Monitor (it held the port)')
            time.sleep(1)
        elif name:
            fail(f'{port} is in use by {name} (pid {pid}); close it and try again')


def open_serial(port: str):
    import serial
    link = serial.Serial()
    link.port = port
    link.baudrate = 115200
    link.timeout = 0.3
    # Keep DTR low: on the native USB port DTR high during a reset selects download mode.
    link.dtr = False
    link.rts = False
    link.open()
    return link


def follow(port: str, seconds: float | None, show_boot: bool) -> None:
    """Print the board's log, reopening the port if USB re-enumerates after a reset."""
    end = None if seconds is None else time.time() + seconds
    pending = ''
    while end is None or time.time() < end:
        try:
            link = open_serial(port)
        except Exception:
            time.sleep(0.2)
            continue
        try:
            while end is None or time.time() < end:
                pending += link.read(4096).decode('utf-8', 'replace')
                *lines, pending = pending.split('\n')
                for line in lines:
                    line = line.rstrip('\r')
                    if show_boot or not BOOT_NOISE.match(line):
                        print(line, flush=True)
        except Exception:
            time.sleep(0.2)
        finally:
            link.close()


def reset(port: str) -> None:
    link = open_serial(port)
    link.rts = True       # hold the chip in reset
    time.sleep(0.2)
    link.rts = False      # release with DTR low: normal boot from flash
    link.close()


def board_status(ip: str) -> dict:
    with urllib.request.urlopen(f'http://{ip}/status', timeout=5) as response:
        return json.load(response)


def board_ip() -> str | None:
    return os.environ.get('BOARD_IP')


# ---------------------------------------------------------------- commands

def cmd_restart(args) -> None:
    port = find_port(args.port)
    free_port(port)
    reset(port)
    print(f'restarted the board on {port}; boot log for {args.seconds:g} s:')
    follow(port, args.seconds, args.boot)


def cmd_log(args) -> None:
    port = find_port(args.port)
    free_port(port)
    print(f'board log on {port} (Ctrl+C to stop):')
    try:
        follow(port, None, args.boot)
    except KeyboardInterrupt:
        pass


def cmd_flash(args) -> None:
    cli = shutil.which('arduino-cli') or next((p for p in ARDUINO_CLI_PATHS if Path(p).exists()), None)
    if not cli:
        fail('arduino-cli not found; install it or the Arduino IDE 2')
    if not SECRETS.exists():
        fail(f'{SECRETS} is missing; run: board.py init')
    port = find_port(args.port)
    free_port(port)
    build = Path(os.environ.get('TMPDIR', '/tmp')) / 'nesttrace-esp32-build'
    subprocess.run([cli, 'compile', '-b', FQBN, '--build-path', str(build), str(SKETCH)], check=True)
    subprocess.run([cli, 'upload', '-b', FQBN, '-p', port, '--input-dir', str(build), str(SKETCH)], check=True)
    print('flashed; boot log:')
    follow(port, args.seconds, args.boot)


def cmd_status(args) -> None:
    ip = args.ip or board_ip()
    if not ip:
        fail('pass --ip or set BOARD_IP (the IP printed in the boot log)')
    status = board_status(ip)
    uplink = status.get('uplink', {})
    motion = status.get('motion', {})
    print(f"sensor   {status['sensor']} · {status['mode']} · {status['width']}x{status['height']}")
    print(f"wifi     {status['rssi']} dBm · up {status['uptime']} s · free heap {status['freeHeap']} B")
    print(f"motion   {motion.get('percent', 0)}% · {'moving' if motion.get('active') else 'still'}")
    if uplink:
        print(f"upload   {uplink.get('state')} · {uplink.get('sent')} frames sent"
              + (f" · last error: {uplink['lastError']}" if uplink.get('lastError') else ''))
    print(f'page     http://{ip}/')


def cmd_ports(args) -> None:
    from serial.tools import list_ports
    for port in list_ports.comports():
        tag = '  <- ESP32 native USB' if port.vid == 0x303A else ''
        print(f'{port.device}  {port.description}{tag}')


def set_define(text: str, name: str, value: str) -> str:
    pattern = re.compile(rf'^#define {name} ".*"$', re.M)
    if not pattern.search(text):
        fail(f'{name} line not found in secrets.h; copy secrets.example.h again')
    return pattern.sub(f'#define {name} "{value}"', text)


def cmd_init(args) -> None:
    if SECRETS.exists() and not args.force:
        fail('secrets.h already exists (use --force to start again from secrets.example.h)')
    text = EXAMPLE.read_text()
    ssid = input('Wi-Fi name (2.4 GHz): ').strip()
    password = getpass.getpass('Wi-Fi password: ')
    text = set_define(text, 'WIFI_SSID', ssid)
    text = set_define(text, 'WIFI_PASSWORD', password)
    SECRETS.write_text(text)
    print(f'wrote {SECRETS} (git-ignored). Standalone mode; run "board.py dashboard" to add the dashboard upload.')


def cmd_dashboard(args) -> None:
    """Fill DASHBOARD_URL, DEVICE_ID, DEVICE_TOKEN and the Caddy root certificate into secrets.h."""
    if not SECRETS.exists():
        fail('secrets.h is missing; run: board.py init')
    text = SECRETS.read_text()
    url = args.url or input('Dashboard URL (https://<LAN_HOST>:3443): ').strip()
    if not url.startswith('https://'):
        fail('the dashboard URL must start with https://')
    device_id = args.device_id or input('DEVICE_ID (from Add board camera / Rotate token): ').strip()
    token = getpass.getpass('DEVICE_TOKEN (input hidden): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        fail('that does not look like a NestTrace device token (43 characters)')
    ca = subprocess.run(['docker', 'compose', 'exec', '-T', 'caddy', 'cat', '/data/caddy/pki/authorities/local/root.crt'],
                        cwd=DASHBOARD, capture_output=True, text=True)
    if ca.returncode != 0 or 'BEGIN CERTIFICATE' not in ca.stdout:
        fail('could not read Caddy\'s root certificate; is the dashboard running (docker compose up -d)?')
    text = set_define(text, 'DASHBOARD_URL', url.rstrip('/'))
    text = set_define(text, 'DEVICE_ID', device_id)
    text = set_define(text, 'DEVICE_TOKEN', token)
    text, count = re.subn(r'(static const char DASHBOARD_CA\[\] = R"PEM\().*?(\)PEM";)',
                          lambda m: m.group(1) + '\n' + ca.stdout.strip() + '\n' + m.group(2), text, flags=re.S)
    if count != 1:
        fail('DASHBOARD_CA block not found in secrets.h; copy secrets.example.h again')
    SECRETS.write_text(text)
    print('secrets.h updated (token not shown). Next: board.py flash')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', help='serial port (default: auto-detect the ESP32 native USB port)')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('restart', help='reset the board and show its boot log')
    p.add_argument('--seconds', type=float, default=25)
    p.add_argument('--boot', action='store_true', help='also show ROM boot lines')
    p.set_defaults(run=cmd_restart)

    p = sub.add_parser('log', help='follow the board log without resetting')
    p.add_argument('--boot', action='store_true')
    p.set_defaults(run=cmd_log)

    p = sub.add_parser('flash', help='compile and upload the firmware, then show the boot log')
    p.add_argument('--seconds', type=float, default=25)
    p.add_argument('--boot', action='store_true')
    p.set_defaults(run=cmd_flash)

    p = sub.add_parser('status', help='show the board status over Wi-Fi')
    p.add_argument('--ip', help='board IP (or set BOARD_IP)')
    p.set_defaults(run=cmd_status)

    p = sub.add_parser('ports', help='list serial ports')
    p.set_defaults(run=cmd_ports)

    p = sub.add_parser('init', help='create secrets.h with your Wi-Fi')
    p.add_argument('--force', action='store_true')
    p.set_defaults(run=cmd_init)

    p = sub.add_parser('dashboard', help='add the dashboard upload settings and certificate to secrets.h')
    p.add_argument('--url')
    p.add_argument('--device-id')
    p.set_defaults(run=cmd_dashboard)

    args = parser.parse_args()
    if getattr(args, 'port', None) is None:
        args.port = None
    args.run(args)


if __name__ == '__main__':
    main()
