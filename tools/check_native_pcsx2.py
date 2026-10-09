"""Run the deterministic native integration check in an existing deployment."""
import argparse
import json
from pathlib import Path
import signal
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--stage', required=True, type=Path)
args = parser.parse_args()
stage = args.stage.resolve()
root = Path(__file__).resolve().parent.parent
script = stage / 'native_check.js'
script.write_bytes((root / 'tests/ps2_native_smoke.js').read_bytes())
ini = stage / 'athena.ini'
previous = ini.read_bytes()
output = stage / 'native-smoke.json'
if output.exists():
    output.unlink()
ini.write_text('default_script=native_check.js\n')
log = (stage / 'native-smoke-console.log').open('w')
process = None
try:
    process = subprocess.Popen(['flatpak', 'run', '--filesystem=' + str(stage), '--socket=x11',
        '--nosocket=wayland', '--env=QT_QPA_PLATFORM=xcb', 'net.pcsx2.PCSX2', '-batch',
        '-elf', str(stage / 'athena.elf')], cwd=stage, stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if output.exists():
            try:
                data = json.loads(output.read_text())
            except json.JSONDecodeError:
                time.sleep(.1)
                continue
            print(json.dumps(data, indent=2))
            raise SystemExit(0 if data.get('passed') else 1)
        if process.poll() is not None:
            raise RuntimeError('PCSX2 exited; see native-smoke-console.log')
        time.sleep(.25)
    raise RuntimeError('Native check timed out; see native-smoke-console.log')
finally:
    if process is not None and process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
    ini.write_bytes(previous)
    log.close()
