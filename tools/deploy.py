import argparse
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("--elf", required=True, type=Path)
parser.add_argument("destinations", nargs="+", type=Path)
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent / "game"
if not args.elf.is_file():
    parser.error("3D runtime ELF is missing")
for destination in args.destinations:
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("main.js", "tuning.js", "rows.js", "player.js", "game.js", "particles.js", "audio.js", "athena.ini"):
        shutil.copy2(source / name, destination / name)
    shutil.copytree(source / "models", destination / "models", dirs_exist_ok=True)
    shutil.copytree(source / "fonts", destination / "fonts", dirs_exist_ok=True)
    shutil.copytree(source / "sfx", destination / "sfx", dirs_exist_ok=True)
    shutil.copytree(source / "music", destination / "music", dirs_exist_ok=True)
    shutil.copy2(args.elf, destination / "athena.elf")
    print(destination)
