import argparse
import json
import os
from pathlib import Path
import random
import sys

SKILL = Path(os.environ.get("ATHENA_3D_SKILL", Path.home() / ".agents/skills/athena-3d-generator"))
sys.path.insert(0, str(SKILL / "scripts"))
from mesh import Mesh

GRASS = (.72, .93, .35)
GRASS_ALT = (.69, .88, .31)
ASPHALT = (.30, .32, .37)
WATER = (.36, .78, .96)
SHADOW_ON_GRASS = (.49, .63, .24)
SHADOW_ON_ROAD = (.20, .21, .25)
SHADOW_Y = .025
SHADOW_ON_WATER = (.25, .60, .80)
EARTH = (.47, .33, .22)
PLAY_HALF = 4.5
OUTSIDE = .80

def dark(rgb, k=OUTSIDE):
    return tuple(c * k for c in rgb)

def ground(m, name, rgb, height=0, y=0):
    inner = m.material(name, rgb)
    outer = m.material(name + "_out", dark(rgb))
    side = (16 - PLAY_HALF)
    for width, x, mat in ((2 * PLAY_HALF, 0, inner), (side, -PLAY_HALF - side / 2, outer),
                          (side, PLAY_HALF + side / 2, outer)):
        if height > 0:
            m.box((width, height, 1), mat, translate=(x, y + height / 2, 0))
        else:
            m.plane(width, 1, mat, translate=(x, y, 0))

def bank(m, top=0, depth=.13):
    x = 16
    m.part([(-x, -depth, 0), (x, -depth, 0), (x, 0, 0), (-x, 0, 0)], [(0, 1, 2), (0, 2, 3)],
           m.material("earth", EARTH), translate=(0, top, .5))

def chicken(feather=(.98, .96, .96), wing_rgb=(.92, .89, .92)):
    m = Mesh()
    white = m.material("feather", feather)
    wing = m.material("wing", wing_rgb)
    orange = m.material("orange", (1, .35, .13))
    red = m.material("comb", (.98, .22, .27))
    black = m.material("eye", (.12, .06, .07))
    m.box((.43, .49, .42), white, translate=(0, .42, .015))
    m.box((.43, .35, .38), white, translate=(0, .81, -.005))
    for x in (-.247, .247):
        m.box((.115, .18, .31), wing, translate=(x, .40, .045))
    m.box((.19, .15, .18), orange, translate=(0, .76, -.28))
    m.box((.12, .13, .11), red, translate=(0, .635, -.275))
    m.box((.13, .13, .25), red, translate=(0, 1.035, -.015))
    for x in (-.218, .218):
        m.box((.012, .060, .055), black, translate=(x, .835, -.105))
    for x in (-.125, .125):
        m.box((.060, .15, .060), orange, translate=(x, .125, .015))
        m.box((.155, .06, .20), orange, translate=(x, .03, -.03))
        for toe in (-.045, .045):
            m.box((.055, .06, .09), orange, translate=(x + toe, .03, -.175))
    return m

def owl():
    m = Mesh()
    body = m.material("owl_body", (.78, .66, .96))
    face = m.material("owl_face", (.95, .93, 1.0))
    mid = m.material("owl_mid", (.58, .36, .90))
    dark = m.material("owl_dark", (.30, .15, .62))
    eye = m.material("owl_eye", (1.0, .74, .10))
    pupil = m.material("owl_pupil", (.08, .06, .10))
    beak = m.material("owl_beak", (.20, .19, .24))
    foot = m.material("owl_foot", (.14, .13, .16))
    m.box((.50, .56, .46), body, translate=(0, .40, .01))
    m.box((.52, .30, .48), body, translate=(0, .83, 0))
    m.box((.54, .07, .50), mid, translate=(0, 1.01, 0))
    m.box((.34, .32, .02), face, translate=(0, .46, -.225))
    m.box((.42, .26, .02), face, translate=(0, .80, -.245))
    for x in (-1, 1):
        m.box((.13, .05, .03), dark, translate=(x * .11, .94, -.255))
        m.box((.11, .10, .02), eye, translate=(x * .11, .85, -.26))
        m.box((.05, .07, .01), pupil, translate=(x * .085, .845, -.272))
        m.box((.11, .20, .11), mid, translate=(x * .19, 1.13, .02))
        m.box((.06, .08, .06), dark, translate=(x * .21, 1.25, .02))
        m.box((.08, .40, .34), dark, translate=(x * .29, .48, .04))
        m.box((.06, .14, .26), mid, translate=(x * .33, .52, .03))
        m.box((.06, .08, .06), foot, translate=(x * .11, .08, -.02))
        m.box((.12, .05, .18), foot, translate=(x * .11, .025, -.06))
    m.box((.08, .13, .08), beak, translate=(0, .73, -.28))
    m.box((.24, .10, .14), dark, translate=(0, .24, .28))
    m.box((.18, .06, .10), mid, translate=(0, .17, .32))
    return m

def ground_shadow(m, width, depth, rgb, offset=(.23, .05)):
    m.plane(width, depth, m.material("shadow", rgb), translate=(offset[0], SHADOW_Y, offset[1]))

def tree(tall=False):
    m = Mesh()
    trunk = m.material("bark", (.40, .28, .17))
    leaf = m.material("leaf", (.63, .77, .15))
    lower = m.material("leaf_lower", (.56, .68, .12))
    height = 2.1 if tall else 1.28
    ground_shadow(m, .82, .88, SHADOW_ON_GRASS)
    m.box((.28, .40, .28), trunk, translate=(0, .20, 0))
    m.box((.70, height - .54, .70), leaf, translate=(0, (height + .54) / 2, 0))
    m.box((.70, .16, .70), lower, translate=(0, .46, 0))
    return m

def rock():
    m = Mesh()
    color = m.material("stone", (.64, .58, .70))
    ground_shadow(m, .80, .80, SHADOW_ON_GRASS, (.12, .08))
    m.box((.73, .23, .70), color, translate=(0, .115, 0))
    m.box((.55, .16, .52), color, translate=(0, .31, 0))
    m.box((.37, .10, .35), color, translate=(0, .44, 0))
    return m

def wheels(m, xs, half_z, radius=.145):
    tire = m.material("tire", (.07, .075, .09))
    for x in xs:
        for z in (-half_z, half_z):
            m.box((radius * 2, radius * 2, .11), tire, translate=(x, radius, z))

def car(rgb):
    m = Mesh()
    body = m.material("paint", rgb)
    white = m.material("roof", (.97, .96, .98))
    glass = m.material("glass", (.055, .075, .105))
    lamp = m.material("lamp", (1, .93, .68))
    tail = m.material("tail", (.86, .12, .09))
    ground_shadow(m, 2.0, .90, SHADOW_ON_ROAD, (.15, .12))
    m.box((1.82, .34, .76), body, translate=(0, .31, 0))
    m.box((.90, .32, .69), glass, translate=(-.10, .64, 0))
    m.box((1.04, .09, .76), white, translate=(-.10, .825, 0))
    for x in (-.54, .34):
        for z in (-.325, .325):
            m.box((.12, .30, .09), white, translate=(x, .645, z))
    m.box((.065, .30, .76), white, translate=(-.12, .645, 0))
    wheels(m, (-.57, .57), .395)
    for z in (-.245, .245):
        m.box((.018, .11, .15), lamp, translate=(.918, .33, z))
        m.box((.018, .10, .13), tail, translate=(-.918, .33, z))
    return m

def truck():
    m = Mesh()
    cab = m.material("cab", (.86, .15, .17))
    box = m.material("cargo", (.95, .95, .97))
    glass = m.material("glass", (.055, .075, .105))
    trim = m.material("trim", (.75, .76, .80))
    lamp = m.material("lamp", (1, .93, .68))
    ground_shadow(m, 3.1, .95, SHADOW_ON_ROAD, (.15, .12))
    m.box((.78, .62, .84), cab, translate=(1.06, .47, 0))
    m.box((.06, .26, .70), glass, translate=(1.43, .62, 0))
    m.box((.60, .07, .86), cab, translate=(1.02, .81, 0))
    m.box((2.02, 1.02, .88), box, translate=(-.40, .69, 0))
    m.box((2.02, .10, .88), trim, translate=(-.40, .13, 0))
    wheels(m, (-1.05, -.25, 1.05), .43)
    for z in (-.28, .28):
        m.box((.018, .11, .15), lamp, translate=(1.455, .36, z))
    return m

def log(length):
    m = Mesh()
    bark = m.material("log_side", (.50, .24, .21))
    top = m.material("log_top", (.64, .34, .29))
    end = m.material("log_end", (.74, .52, .40))
    m.plane(length - .05, .62, m.material("log_shadow", SHADOW_ON_WATER), translate=(.14, -.112, .14))
    m.box((length - .12, .17, .64), bark, translate=(0, -.055, 0))
    m.box((length - .12, .07, .58), top, translate=(0, .065, 0))
    for x in (-(length - .12) / 2 - .01, (length - .12) / 2 + .01):
        m.box((.02, .15, .50), end, translate=(x, -.04, 0))
    foam = m.material("foam", (.90, .97, 1.0))
    for side in (-1, 1):
        x = side * ((length - .12) / 2 + .07)
        m.plane(.16, .52, foam, translate=(x, -.108, 0))
        m.plane(.10, .16, foam, translate=(x + side * .13, -.108, side * .14))
    return m

def train(locomotive):
    m = Mesh()
    glass = m.material("glass", (.055, .075, .105))
    dark = m.material("chassis", (.16, .16, .20))
    if locomotive:
        paint = m.material("loco", (.98, .80, .22))
        stripe = m.material("stripe", (.86, .18, .16))
        lamp = m.material("lamp", (1, .96, .75))
        m.box((2.5, .95, .86), paint, translate=(0, .70, 0))
        m.box((2.5, .14, .88), stripe, translate=(0, .52, 0))
        m.box((.85, .32, .86), paint, translate=(-.55, 1.33, 0))
        m.box((.05, .26, .60), glass, translate=(1.26, .98, 0))
        m.box((.04, .14, .18), lamp, translate=(1.27, .62, 0))
    else:
        paint = m.material("wagon", (.55, .64, .78))
        roof = m.material("wagon_roof", (.86, .88, .92))
        m.box((2.36, .90, .84), paint, translate=(0, .68, 0))
        m.box((2.40, .08, .88), roof, translate=(0, 1.17, 0))
        for x in (-.6, .0, .6):
            for z in (-.425, .425):
                m.box((.34, .24, .01), glass, translate=(x, .82, z))
    m.box((2.40 if locomotive else 2.30, .22, .70), dark, translate=(0, .14, 0))
    return m

def signal(light_on):
    m = Mesh()
    if light_on:
        red = m.material("signal_on", (1, .18, .12))
        for x in (-.09, .09):
            m.box((.11, .11, .03), red, translate=(x, 1.33, .08))
        return m
    stripe_a = m.material("pole_red", (.86, .16, .16))
    stripe_b = m.material("pole_white", (.96, .95, .95))
    head = m.material("signal_head", (.10, .10, .12))
    lens = m.material("signal_off", (.32, .07, .07))
    for i in range(5):
        m.box((.09, .24, .09), stripe_a if i % 2 == 0 else stripe_b, translate=(0, .12 + i * .24, 0))
    m.box((.36, .22, .12), head, translate=(0, 1.33, 0))
    for x in (-.09, .09):
        m.box((.10, .10, .02), lens, translate=(x, 1.33, .065))
    return m

def eagle():
    m = Mesh()
    body = m.material("eagle_body", (.36, .22, .15))
    wing = m.material("eagle_wing", (.30, .18, .12))
    head = m.material("eagle_head", (.97, .96, .94))
    beak = m.material("eagle_beak", (.99, .78, .15))
    eye = m.material("eagle_eye", (.08, .06, .06))
    m.box((.62, .50, 1.05), body, translate=(0, 0, 0))
    m.box((.46, .44, .40), head, translate=(0, .12, .66))
    m.box((.16, .14, .22), beak, translate=(0, .06, .95))
    for x in (-.235, .235):
        m.box((.012, .07, .07), eye, translate=(x, .2, .74))
    for x in (-.95, .95):
        m.box((1.30, .08, .62), wing, translate=(x, .12, -.05))
    m.box((.40, .08, .40), body, translate=(0, .05, -.70))
    for x in (-.12, .12):
        m.box((.08, .30, .08), beak, translate=(x, -.38, .1))
    return m

def lily():
    m = Mesh()
    pad = m.material("lily", (.30, .70, .38))
    rim = m.material("lily_dark", (.22, .56, .30))
    m.plane(.80, .80, m.material("lily_shadow", SHADOW_ON_WATER), translate=(.10, -.114, .10))
    m.box((.80, .04, .80), rim, translate=(0, -.11, 0))
    m.box((.70, .02, .56), pad, translate=(.0, -.08, -.07))
    m.box((.40, .02, .14), pad, translate=(-.15, -.08, .28))
    return m

def coin():
    m = Mesh()
    rim = m.material("coin_rim", (1.0, .84, .16))
    face = m.material("coin_face", (.96, .64, .08))
    mark = m.material("coin_mark", (1.0, .93, .55))
    m.box((.26, .40, .09), rim, translate=(0, 0, 0))
    m.box((.40, .26, .09), rim, translate=(0, 0, 0))
    for zf in (-.05, .05):
        m.box((.22, .22, .012), face, translate=(0, 0, zf))
        m.box((.06, .16, .014), mark, translate=(0, 0, zf * 1.05))
    return m

def particle(rgb):
    m = Mesh()
    m.box((1, 1, 1), m.material("particle", rgb))
    return m

def grass_details(m, seed):
    rng = random.Random(seed)
    tuft = m.material("tuft", (.50, .74, .20))
    tuft_light = m.material("tuft_light", (.80, .96, .42))
    petals = [m.material("petal_white", (.98, .97, .92)), m.material("petal_yellow", (1, .86, .25)),
              m.material("petal_pink", (.98, .55, .70))]
    used = set()
    while len(used) < 9:
        cell = rng.randint(-10, 10)
        if cell in used:
            continue
        used.add(cell)
        x = cell + rng.choice((-1, 1)) * rng.uniform(.36, .46)
        z = rng.uniform(-.40, .40)
        if rng.random() < .65:
            h = rng.uniform(.11, .17)
            m.box((.15, h, .08), tuft, translate=(x, .065 + h / 2, z))
            m.box((.08, h * .7, .14), tuft_light, translate=(x + .05, .065 + h * .35, z + .02))
        else:
            m.box((.04, .10, .04), tuft, translate=(x, .115, z))
            m.box((.13, .06, .13), rng.choice(petals), translate=(x, .18, z))

def ripple():
    m = Mesh()
    streak = m.material("ripple", (.62, .88, 1.0))
    rng = random.Random(11)
    shapes = [(rng.uniform(0, 4), rng.uniform(-.36, .36), rng.choice((.35, .5, .7))) for _ in range(2)]
    for k in range(-5, 5):
        for x, z, w in shapes:
            m.plane(w, .06, streak, translate=(k * 4 + x, -.114, z))
    return m

def row(kind, alternate=False, variant=0):
    m = Mesh()
    if kind == "grass":
        ground(m, "grass", GRASS_ALT if alternate else GRASS, height=.065)
        bank(m)
        grass_details(m, 40 + 2 * variant + alternate)
    elif kind in ("road", "road_marked"):
        ground(m, "asphalt", ASPHALT)
        bank(m, -.002)
        if kind == "road_marked":
            dash = m.material("lane_dashes", (.52, .55, .60))
            for x in range(-15, 16, 2):
                m.plane(.60, .055, dash, translate=(x, .025, -.47))
    elif kind == "water":
        ground(m, "water", WATER, y=-.12)
        foam = m.material("foam", (.93, .97, 1.0))
        rng = random.Random(7)
        for side in (-1, 1):
            for _ in range(7):
                x = side * rng.uniform(6.2, 10.5)
                m.plane(rng.choice((.25, .35, .5)), rng.choice((.18, .25, .3)), foam,
                        translate=(x, -.105, rng.uniform(-.38, .38)))
    elif kind == "rail":
        ground(m, "gravel", (.40, .38, .43), height=.04)
        bank(m)
        sleeper = m.material("sleeper", (.43, .31, .24))
        for i in range(40):
            m.plane(.24, .78, sleeper, translate=(-15.6 + i * .8, .045, 0))
        steel = m.material("rail", (.66, .68, .74))
        for z in (-.24, .24):
            m.box((32, .05, .07), steel, translate=(0, .07, z))
    return m

def shadow(on_road=False):
    m = Mesh()
    color = m.material("shadow", (.22, .24, .29) if on_road else (.48, .65, .22))
    m.plane(1, 1, color)
    return m

def generate(out):
    out.mkdir(parents=True, exist_ok=True)
    builders = {
        "chicken": chicken, "chicken_p2": lambda: chicken((1.0, .84, .26), (.96, .70, .16)), "owl": owl, "tree": tree, "tree_tall": lambda: tree(True), "rock": rock,
        "car_purple": lambda: car((.57, .34, .94)),
        "car_cyan": lambda: car((.08, .73, .87)),
        "car_orange": lambda: car((.99, .32, .15)),
        "truck": truck,
        "log2": lambda: log(2), "log3": lambda: log(3), "log4": lambda: log(4),
        "train_loco": lambda: train(True), "train_wagon": lambda: train(False),
        "signal": lambda: signal(False), "signal_light": lambda: signal(True),
        "eagle": eagle, "lily": lily, "coin": coin,
        "particle_white": lambda: particle((.98, .97, .97)),
        "particle_splash": lambda: particle((.80, .94, 1.0)),
        "particle_gold": lambda: particle((1.0, .86, .25)),
        "particle_dust": lambda: particle((.80, .86, .62)),
        "particle_red": lambda: particle((.96, .25, .28)),
        "grass": lambda: row("grass"), "grass_alt": lambda: row("grass", True),
        "grass_b": lambda: row("grass", variant=1), "grass_alt_b": lambda: row("grass", True, 1),
        "ripple": ripple,
        "road": lambda: row("road"), "road_marked": lambda: row("road_marked"),
        "water": lambda: row("water"), "rail": lambda: row("rail"),
        "shadow_grass": shadow, "shadow_road": lambda: shadow(True),
    }
    report = {name: build().export(out / (name + ".obj")) for name, build in builders.items()}
    (Path(__file__).resolve().parent / "asset_manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    for name, data in report.items():
        print(f"{name:13s} {data['triangles']:4d} tris  {data['materials']} materials")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "game" / "models")
    generate(parser.parse_args().output)
