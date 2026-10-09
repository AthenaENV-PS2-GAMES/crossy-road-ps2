"""Drive the M4 game in the PCSX2 Flatpak.

Keys go to the athena window started here with `xdotool --window` (no focus
change): 2 = L3 debug reset, 4 = R3 test lock, E = R1 autopilot, Q = L1 particle showcase, Backspace = SELECT report.
Leave the PCSX2 window unfocused; if it has focus the keyboard reaches the pad.

1. Reset: the PS2 row window must equal the host generator for the seed.
2. Idle: the eagle must come after margin / scroll speed (about 14 s).
3. Autopilot soak: play and auto-restart for --soak seconds, capturing
   screenshots; check frame time, memory stability and pool health.
"""
import argparse
import json
from pathlib import Path
import shutil
import signal
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("--stage", required=True, type=Path)
parser.add_argument("--output", type=Path, default=Path(__file__).parent / "evidence")
parser.add_argument("--soak", type=float, default=90)
args = parser.parse_args()
stage, output = args.stage.resolve(), args.output.resolve()
root = Path(__file__).resolve().parent.parent
output.mkdir(parents=True, exist_ok=True)
metrics = stage / "metrics.json"


def run(*command):
    return subprocess.run(command, text=True, capture_output=True, check=True).stdout


def windows():
    return {line.split()[0] for line in run("wmctrl", "-l").splitlines() if "athena" in line.lower()}


def shot(name):
    xwd = output / (name + ".xwd")
    run("xwd", "-id", window, "-out", str(xwd))
    run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(xwd), "-frames:v", "1",
        str(output / (name + ".png")))
    xwd.unlink()


def press(key, hold=.06):
    run("xdotool", "keydown", "--window", window, key)
    time.sleep(hold)
    run("xdotool", "keyup", "--window", window, key)


def report():
    # Two SELECT presses in quick succession were seen to drop the second one,
    # so the press is repeated if no new report appears within 4 s.
    previous = reports[-1]["report"] if reports else 0
    for attempt in range(3):
        press("BackSpace")
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            try:
                data = json.loads(metrics.read_text())
                if data["report"] > previous:
                    data["selectAttempts"] = attempt + 1
                    reports.append(data)
                    return data
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(.2)
    raise RuntimeError("SELECT did not produce a new metrics.json (script error or pool exhausted?)")


tuning_seed = json.loads(run("node", "--input-type=module", "-e",
    "import {tuning} from '" + str(root / "game" / "tuning.js") + "'; console.log(JSON.stringify(tuning))"))
expected_rows = json.loads(run("node", str(root / "tests" / "test_rows.mjs"), "--summary", str(tuning_seed["seed"])))
eagle = tuning_seed["eagle"]
eagle_seconds = eagle["margin"] / eagle["scrollSpeed"][0]

if metrics.exists():
    metrics.unlink()
before = windows()
command = ["flatpak", "run", "--socket=x11", "--nosocket=wayland", "--env=QT_QPA_PLATFORM=xcb",
           "net.pcsx2.PCSX2", "-batch", "-elf", str(stage / "athena.elf"),
           "-logfile", str(stage / "pcsx2.log")]
log = (output / "m4_console.log").open("w")
process = subprocess.Popen(command, cwd=stage, stdout=log, stderr=subprocess.STDOUT)
reports = []
soak_reports = []
try:
    window = None
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline and window is None:
        if process.poll() is not None:
            raise RuntimeError("PCSX2 exited during boot")
        new = windows() - before
        if len(new) == 1:
            window = new.pop()
        time.sleep(.5)
    if window is None:
        raise RuntimeError("Cannot identify this run's athena window")
    time.sleep(14)  # Boot, ~600 instances, fonts, pad assignment.
    press("2")  # L3 reset: run 0, seed from tuning.js.
    press("4")  # R3 test lock: pad directions/X/START ignored from here on.
    reset_at = time.monotonic()
    time.sleep(.3)
    shot("m4_start")
    first = report()
    press("q")  # L1: particle showcase around the chicken.
    time.sleep(.12)
    shot("m4_particles")
    # Idle until the eagle; screenshots during the swoop and the carry.
    time.sleep(max(0, reset_at + eagle_seconds + .25 - time.monotonic()))
    shot("m4_eagle_swoop")
    time.sleep(.6)
    shot("m4_eagle_carry")
    time.sleep(.8)
    idle = report()
    press("e")  # R1 autopilot: plays and restarts by itself.
    soak_start = time.monotonic()
    k = 0
    while time.monotonic() - soak_start < args.soak:
        time.sleep(min(10, args.soak - (time.monotonic() - soak_start)))
        shot("m4_soak_%02d" % k)
        k += 1
        if k % 3 == 0:
            soak_reports.append(report())
    soak_reports.append(report())
    press("e")
finally:
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
    log.close()
    shutil.copy2(stage / "pcsx2.log", output / "m4_pcsx2.log")
    (output / "m4_reports.json").write_text(json.dumps(reports, indent=1))

last = soak_reports[-1]
mid = soak_reports[0]
eagle_event = next((e for e in idle["events"] if e[1] == 1), None)
causes = {}
for e in last["events"]:
    if e[1] == 1:
        causes[e[3]] = causes.get(e[3], 0) + 1
growth = last["memoryAfter"]["used"] - mid["memoryAfter"]["used"]
checks = {
    "test lock held (pad input ignored, counted)": idle["inputLocked"] and last["inputLocked"],
    "PS2 rows equal host generator (seed %d)" % tuning_seed["seed"]: first["rows"] == expected_rows,
    "idle eagle death": idle["game"]["deaths"] == 1 and idle["game"]["cause"] == 5,
    "eagle timing (+-0.5 s)": eagle_event is not None and
        abs((eagle_event[0] - first["resetFrame"]) / 59.94 - eagle_seconds) < .5,
    "soak advanced rows (rebuilt > 100)": last["rebuilt"] - idle["rebuilt"] > 100,
    "soak reached score 15+": last["game"]["top"] >= 15,
    "soak restarted runs": last["game"]["restarts"] >= 1 or last["game"]["run"] >= 1,
    "soak collected coins": last["coins"] >= 1,
    "particle bursts emitted (landing dust, deaths, coins)": last["bursts"] >= 20,
    # Run restarts rebuild at most 8 slots per update, so no frame is excluded.
    "no slow frame, restarts included (reports excluded)": all(
        r["slowFrames"] == 0 for r in soak_reports),
    "CPU p95 within budget": all(r["p95CpuMs"] <= r["budgets"]["cpuP95Ms"] for r in soak_reports),
    "triangles within provisional ceiling": last["maxTriangles"] <= last["budgets"]["sourceTriangles"],
    "EE RAM stable during soak (< 256 KiB growth)": growth < 256 * 1024,
    "no allocation failures": last["memoryAfter"]["allocationFailures"] == 0,
    "NTSC cadence": 59 <= last["loop"]["fps"] <= 61,
}
print("eagle event", eagle_event, "reset frame", first["resetFrame"], "expected s", round(eagle_seconds, 2))
print("soak: run", last["game"]["run"], "top", last["game"]["top"], "deaths", last["game"]["deaths"],
      "causes", causes, "rebuilt", last["rebuilt"])
for r in soak_reports:
    print("  cpu mean/p95/max %.2f/%.2f/%.2f  maxExclReports %.2f  slow %d  tris %d (max %d) drawn %d  ram %d" % (
        r["meanCpuMs"], r["p95CpuMs"], r["maxCpuMs"], r["maxCpuMsExcludingReports"], r["slowFrames"],
        r["render"]["triangles"], r["maxTriangles"], r["render"]["drawPasses"], r["memoryAfter"]["used"]))
print("vram", last["vramUsedBytes"], "pools", last["poolUsed"])
print("SELECT attempts per report:", [r["selectAttempts"] for r in reports])
print("profile ms [restart logic, release, build | advance logic, release, build]:", last["profile"])
print("coins", last["coins"], "particle peak", last["particlePeak"], "bursts", last["bursts"])
print("ignored pad presses during the run:", last["ignoredPresses"], "slow frames:",
      [r["slowList"] for r in soak_reports])
for name, passed in checks.items():
    print(("PASS " if passed else "FAIL ") + name)
raise SystemExit(0 if all(checks.values()) else 1)
