import { tuning } from "./tuning.js";
import { UP, DOWN, LEFT, RIGHT, isBusy, isHopping } from "./player.js";
import { POOLS, GRASS, ROAD, WATER, RAIL, LILY, TRAIN_IDLE, TRAIN_WARN, TRAIN_PASS, slotOf, rowKind, trainLength }
    from "./rows.js";
import {
    createGame, updateGame, resetGame, canRestart, runSeed, showTitle, newTop, setPlayers, DEAD, TITLE,
    CAR_HIT, TRAIN_HIT, DROWNED, SWEPT, EAGLE
} from "./game.js";
import {
    createParticles, emit, updateParticles, particleScale, clearParticles, COLORS,
    WHITE, SPLASH, GOLD, DUST, RED
} from "./particles.js";
import { createAudio, play, falloff, track } from "./audio.js";

const mode = Screen.getMode();
const height = mode.height * (mode.interlace === Screen.INTERLACED && mode.field === Screen.FRAME ? 2 : 1);
mode.height = height;
mode.zbuffering = true;
mode.psmz = Screen.Z16S;
Screen.setMode(mode);

const memoryBefore = System.getMemoryStats();
const c = tuning.camera, rad = Math.PI / 180, g0 = tuning.ground;
// Two views: one full-screen camera, or (two players far apart) the leader's
// in the top half and the other's in the bottom half. Both are full-screen
// projections clipped by the GS scissor; each is aimed so its player sits at
// the centre of its half.
const cameras = [0, 1].map(() => new Camera3D.Camera({
    aspect: mode.width / height,
    fovYDegrees: c.fovYDegrees, near: c.near, far: c.far
}));
const horizontal = c.distance * Math.cos(c.elevationDegrees * rad);
const camOffX = horizontal * Math.sin(c.azimuthDegrees * rad);
const camOffY = c.distance * Math.sin(c.elevationDegrees * rad);
const camOffZ = horizontal * Math.cos(c.azimuthDegrees * rad);
const lights = new Lights.Set().setAmbient(.62, .62, .65)
    .setDirectional(0, -.35, .85, .40, .49, .49, .44);
const shadowBatch = new Render3D.Batch(); // Chicken blob shadows (unlit), drawn first.
const dynamicBatch = new Render3D.Batch(); // Chicken, eagle and particles.
const HIDDEN = -50; // Instances parked below the view (trains between passes, lights off).

// --- Instance pools ----------------------------------------------------------
// Every instance is created here once. Rows take and return them through
// typed-array free lists, so recycling a row allocates nothing. Pooled
// instances are in no batch until a row slot takes them: each slot has its
// own Render3D.Batch, rebuilt only when the slot is regenerated, so parked
// instances cost nothing per frame (no culling, no transform).
const GROUND = ["grass", "grass_alt", "grass_b", "grass_alt_b", "road", "road_marked", "water", "rail", "ripple"];
const poolNames = GROUND.concat(POOLS);
const poolItems = [], poolFree = [], poolTop = new Int32Array(poolNames.length);
let instanceCount = 0;
function loadMesh(name, unlit) {
    return Model3D.load("models/" + name + ".obj", { shading: unlit ? Model3D.UNLIT : Model3D.DIFFUSE });
}
for (let p = 0; p < poolNames.length; p++) {
    const name = poolNames[p], size = tuning.pools[name];
    const mesh = loadMesh(name, name === "signal_light");
    const items = [], free = new Int16Array(size);
    for (let i = 0; i < size; i++) {
        items.push(mesh.createInstance());
        free[i] = size - 1 - i;
    }
    mesh.dispose();
    poolItems.push(items);
    poolFree.push(free);
    poolTop[p] = size;
    instanceCount += size;
}
const ROW_POOL = GROUND.length; // POOLS index i is poolNames index ROW_POOL + i.
const P = {};
for (let p = 0; p < poolNames.length; p++) P[poolNames[p]] = p;
const ENC = 4096; // Encoded handle: pool * ENC + index.
function takeItem(pool) {
    if (poolTop[pool] === 0) throw new Error("Pool exhausted: " + poolNames[pool]);
    return pool * ENC + poolFree[pool][--poolTop[pool]];
}
function item(handle) { return poolItems[(handle / ENC) | 0][handle % ENC]; }
function giveItem(handle) {
    const pool = (handle / ENC) | 0;
    poolFree[pool][poolTop[pool]++] = handle % ENC;
}

function single(name, unlit, target) {
    const mesh = loadMesh(name, unlit);
    const it = mesh.createInstance().setPosition(0, HIDDEN, 0);
    mesh.dispose();
    target.add(it);
    instanceCount++;
    return it;
}
// Per runner: chicken (player 2 is yellow), its blob shadows and its eagle.
const chickens = [], eagles = [], shadowsGrass = [], shadowsRoad = [];
for (const name of ["chicken", "chicken_p2"]) {
    shadowsGrass.push(single("shadow_grass", true, shadowBatch).setScale(.52, 1, .55));
    shadowsRoad.push(single("shadow_road", true, shadowBatch).setScale(.52, 1, .55));
    chickens.push(single(name, false, dynamicBatch));
    eagles.push(single("eagle", false, dynamicBatch));
}

// --- Particles: one cube instance per particle slot, batch rebuilt on change --
const particleBatch = new Render3D.Batch();
const particles = createParticles(tuning.particles.counts);
const particleItems = [];
for (let c = 0; c < COLORS.length; c++) {
    const mesh = loadMesh(COLORS[c], true);
    for (let i = particles.first[c]; i < particles.first[c + 1]; i++) particleItems.push(mesh.createInstance());
    mesh.dispose();
}
instanceCount += particles.total;
let particlePeak = 0, bursts = 0;
function drawParticles() {
    if (particles.changed) {
        particleBatch.clear();
        for (let i = 0; i < particles.total; i++) if (particles.active[i]) particleBatch.add(particleItems[i]);
        particles.changed = false;
        if (particles.alive > particlePeak) particlePeak = particles.alive;
    }
    if (particles.alive === 0) return;
    for (let i = 0; i < particles.total; i++) {
        if (!particles.active[i]) continue;
        const k = particleScale(particles, i);
        particleItems[i].setPosition(particles.x[i], particles.y[i], particles.z[i]).setScale(k, k, k);
    }
}
// Bursts: (colour, count, spread, up speed, life, size, gravity, drag).
function burst(color, count, x, y, z, spread, up, life, size, gravity, drag) {
    if (emit(particles, color, count, x, y, z, spread, up, life, size, gravity, drag) > 0) bursts++;
}
function deathBurst(r) {
    const x = r.deathX, z = r.deathZ, cause = r.cause;
    const sx = x - camX;
    if (cause === CAR_HIT || cause === TRAIN_HIT) {
        play(audio, "squash", sx);
        shakeTime = juice.shakeSeconds * (cause === TRAIN_HIT ? 1.4 : 1);
        burst(WHITE, 16, x, .5, z, 2.6, 3.6, .9, .12, 5, 2.2);
        burst(RED, 3, x, .7, z, 1.6, 3.0, .7, .10, 6, 1.5);
    } else if (cause === DROWNED || cause === SWEPT) {
        play(audio, "splash", sx);
        burst(SPLASH, 18, x, -.05, z, 1.7, 4.2, .6, .12, 12, .5);
    } else {
        play(audio, "eagle", sx);
    }
}

// --- Game and row visuals ------------------------------------------------------
const game = createGame(tuning);
let rows = game.rows; // Swapped with the prepared buffer on each restart.
const player = game.player, runners = game.runners, n = rows.n, M = rows.M;
const slotBatch = [];
for (let s = 0; s < n; s++) slotBatch.push(new Render3D.Batch());
const STATIC_MAX = 40;
const slotStatic = new Int32Array(n * STATIC_MAX), slotStaticCount = new Int16Array(n);
const slotMover = new Int32Array(n * M), slotGround = new Int32Array(n).fill(-1);
const builtMovers = new Uint8Array(n);
// Kind each slot was last built as (-1 while released). With rebuilds spread
// over frames, row data can be newer than a slot's visuals, so per-frame
// visual code reads builtKind, never rows.kind.
const builtKind = new Int8Array(n).fill(-1);
const TRAIN_PARTS = tuning.rail.wagons + 1;
const slotTrain = new Int32Array(n * TRAIN_PARTS), slotLight = new Int32Array(n).fill(-1);
const moverY = new Float32Array(4); // CAR, TRUCK, LOG, LILY (logs and pads float at row y)
moverY[0] = moverY[1] = g0.roadY;
const slotCoin = new Int32Array(n).fill(-1), coinShown = new Uint8Array(n);
const slotRipple = new Int32Array(n).fill(-1); // Water streaks, scrolled with the current.
const REBUILD_BUDGET = 8; // Slots rebuilt per update; a new run needs 3 updates instead of one long one.

// Moving instances (vehicles, logs, trains) are positioned with one
// Model3D.setPositions call per frame, only on rows a view shows (visLo/visHi,
// per view); rows out of view are not drawn either. The list is rebuilt when
// rows or the visible range change (about once per hop), not every frame:
// rebuilding costs ~2 ms. moving[] is a persistent array whose length is set,
// not reallocated.
const MOVING_MAX = n * (M + TRAIN_PARTS);
const moving = [], movingRef = new Int32Array(MOVING_MAX), movingPos = new Float32Array(MOVING_MAX * 3);
let movingCount = 0, movingDirty = true;
const visLo = new Int32Array(2), visHi = new Int32Array(2), builtLo = new Int32Array(2), builtHi = new Int32Array(2);
function shown(z) { return (z >= visLo[0] && z <= visHi[0]) || (z >= visLo[1] && z <= visHi[1]); }

function releaseSlot(s) {
    if (slotGround[s] >= 0) { giveItem(slotGround[s]); slotGround[s] = -1; }
    for (let j = 0; j < slotStaticCount[s]; j++) giveItem(slotStatic[s * STATIC_MAX + j]);
    slotStaticCount[s] = 0;
    if (slotLight[s] >= 0) {
        giveItem(slotLight[s]);
        slotLight[s] = -1;
        for (let j = 0; j < TRAIN_PARTS; j++) giveItem(slotTrain[s * TRAIN_PARTS + j]);
    }
    for (let j = 0; j < builtMovers[s]; j++) giveItem(slotMover[s * M + j]);
    builtMovers[s] = 0;
    if (slotCoin[s] >= 0) { giveItem(slotCoin[s]); slotCoin[s] = -1; }
    if (slotRipple[s] >= 0) { giveItem(slotRipple[s]); slotRipple[s] = -1; }
    slotBatch[s].clear();
    builtKind[s] = -1;
    movingDirty = true;
}
function addStatic(s, pool, x, y, z) {
    const h = takeItem(pool), it = item(h);
    it.setPosition(x, y, z);
    slotBatch[s].add(it);
    slotStatic[s * STATIC_MAX + slotStaticCount[s]++] = h;
}

function buildSlot(s) {
    releaseSlot(s);
    const z = rows.z[s], kind = rows.kind[s], b = slotBatch[s];
    // Two grass detail layouts, picked per row so tufts and flowers do not line up.
    const b2 = (Math.imul(z, 0x9E3779B1) >>> 0) & 0x10000;
    const ground = kind === GRASS ? (rows.alt[s] ? (b2 ? P.grass_alt_b : P.grass_alt) : (b2 ? P.grass_b : P.grass)) :
        kind === ROAD ? (rows.marked[s] ? P.road_marked : P.road) : kind === WATER ? P.water : P.rail;
    slotGround[s] = takeItem(ground);
    b.add(item(slotGround[s]).setPosition(0, 0, z));
    if (kind === GRASS) {
        const solid = rows.tree[s] | rows.rock[s];
        for (let bit = 0; bit < 25; bit++) {
            if (!(solid & (1 << bit))) continue;
            const pool = rows.rock[s] & (1 << bit) ? P.rock : rows.tall[s] & (1 << bit) ? P.tree_tall : P.tree;
            addStatic(s, pool, bit - 12, g0.grassY, z);
        }
    } else if (kind === ROAD || kind === WATER) {
        const yaw = rows.vel[s] >= 0 ? 0 : Math.PI;
        for (let j = 0; j < rows.count[s]; j++) {
            const i = s * M + j, h = takeItem(ROW_POOL + rows.mPool[i]);
            b.add(item(h).setRotationEuler(0, yaw, 0).setPosition(rows.mx[i], moverY[rows.mType[i]], z));
            slotMover[i] = h;
        }
        builtMovers[s] = rows.count[s];
        if (kind === WATER) {
            slotRipple[s] = takeItem(P.ripple);
            b.add(item(slotRipple[s]).setPosition(0, 0, z));
        }
    } else {
        const yaw = rows.trainDir[s] > 0 ? 0 : Math.PI;
        for (let j = 0; j < TRAIN_PARTS; j++) {
            const h = takeItem(j === 0 ? P.train_loco : P.train_wagon);
            b.add(item(h).setRotationEuler(0, yaw, 0).setPosition(0, HIDDEN, z));
            slotTrain[s * TRAIN_PARTS + j] = h;
        }
        addStatic(s, P.signal, tuning.player.minX - 1, g0.railY, z + .40);
        slotLight[s] = takeItem(P.signal_light);
        b.add(item(slotLight[s]).setPosition(0, HIDDEN, z));
    }
    if (rows.hasCoin[s]) {
        slotCoin[s] = takeItem(P.coin);
        b.add(item(slotCoin[s]).setPosition(rows.coinX[s], HIDDEN, z));
        coinShown[s] = 1;
    }
    rows.dirty[s] = 0;
    builtKind[s] = kind;
    movingDirty = true;
}

function collectMoving() {
    moving.length = 0;
    movingCount = 0;
    for (let s = 0; s < n; s++) {
        const kind = builtKind[s];
        if (!shown(rows.z[s])) continue;
        if (kind === ROAD || kind === WATER) {
            for (let j = 0; j < builtMovers[s]; j++) {
                movingRef[movingCount++] = s * M + j;
                moving.push(item(slotMover[s * M + j]));
            }
        } else if (kind === RAIL) {
            for (let j = 0; j < TRAIN_PARTS; j++) {
                movingRef[movingCount++] = -1 - (s * TRAIN_PARTS + j);
                moving.push(item(slotTrain[s * TRAIN_PARTS + j]));
            }
        }
    }
    for (let i = 0; i < 2; i++) { builtLo[i] = visLo[i]; builtHi[i] = visHi[i]; }
    movingDirty = false;
}

function placeMovers() {
    if (movingDirty || visLo[0] !== builtLo[0] || visHi[0] !== builtHi[0] ||
        visLo[1] !== builtLo[1] || visHi[1] !== builtHi[1]) collectMoving();
    const car = tuning.rail.carLength;
    for (let k = 0; k < movingCount; k++) {
        const ref = movingRef[k], o = k * 3;
        if (ref >= 0) {
            movingPos[o] = rows.mx[ref];
            movingPos[o + 1] = moverY[rows.mType[ref]] - (ref === dipRef ? dipNow : 0) +
                (rows.mType[ref] === LILY ? Math.sin(frame * .05 + ref * 1.7) * juice.lilyBob : 0);
            movingPos[o + 2] = rows.z[(ref / M) | 0];
        } else {
            const part = -1 - ref, s = (part / TRAIN_PARTS) | 0, j = part - s * TRAIN_PARTS;
            movingPos[o] = rows.trainX[s] - rows.trainDir[s] * car * (j + .5);
            movingPos[o + 1] = rows.trainState[s] === TRAIN_PASS ? g0.railY : HIDDEN;
            movingPos[o + 2] = rows.z[s];
        }
    }
    if (movingCount > 0) Model3D.setPositions(moving, movingPos);
    // Coins spin and bob; a taken coin is parked once.
    const cn = tuning.coin, angle = frame * cn.spin / 60, bob = Math.sin(frame * .08) * cn.bob;
    for (let s = 0; s < n; s++) {
        if (slotCoin[s] < 0 || !coinShown[s] || !shown(rows.z[s])) continue;
        const it = item(slotCoin[s]);
        if (!rows.hasCoin[s]) { it.setPosition(0, HIDDEN, 0); coinShown[s] = 0; continue; }
        const base = builtKind[s] === ROAD ? g0.roadY : g0.grassY;
        it.setPosition(rows.coinX[s], base + cn.height + bob, rows.z[s]).setRotationEuler(0, angle, 0);
    }
    // Water streaks drift with the current (or slowly on still rows) and wrap
    // every 4 cells, the ripple model's period.
    const seconds = frame / 60;
    for (let s = 0; s < n; s++) {
        if (slotRipple[s] < 0 || !shown(rows.z[s])) continue;
        const v = rows.vel[s], drift = v !== 0 ? v * juice.rippleDrift : juice.rippleStill;
        let x = (seconds * drift + rows.z[s] * 1.37) % 4;
        if (x < 0) x += 4;
        item(slotRipple[s]).setPosition(x - 2, 0, rows.z[s]);
    }
    for (let s = 0; s < n; s++) {
        if (builtKind[s] !== RAIL) continue;
        // Lights blink while warning and stay on while the train passes.
        const state = rows.trainState[s];
        const on = state !== TRAIN_IDLE && (state === TRAIN_PASS || (frame & 16) !== 0);
        // Sounds: a bell on each blink while warning, the horn when the train enters.
        const near = falloff(audio, nearestRunner(rows.z[s]));
        if (on && !lightOn[s] && state === TRAIN_WARN && near > 0)
            play(audio, "bell", tuning.player.minX - 1 - camX, near);
        if (state === TRAIN_PASS && trainHeard[s] !== TRAIN_PASS && near > 0)
            play(audio, "train", -rows.trainDir[s] * 4, near);
        lightOn[s] = on ? 1 : 0;
        trainHeard[s] = state;
        if (shown(rows.z[s]))
            item(slotLight[s]).setPosition(tuning.player.minX - 1, on ? g0.railY : HIDDEN, rows.z[s] + .40);
    }
}

// --- HUD (project font, digits/A-Z only) --------------------------------------
const hud = tuning.hud;
const scoreFont = new Font(hud.font, { size: hud.fontSize });
const smallFont = new Font(hud.font, { size: hud.topSize });
for (const f of [scoreFont, smallFont]) {
    f.color = Color.new(255, 255, 255);
    f.outline = 2;
    f.outlineColor = Color.new(20, 20, 30);
    f.preload("0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ", { budgetMs: 0 });
}
let shownScore = -1, shownTop = -1, scoreText = "", topText = "", topW = 0;
const coinFont = new Font(hud.font, { size: hud.coinSize });
coinFont.color = Color.new(255, 214, 40);
coinFont.outline = 2;
coinFont.outlineColor = Color.new(60, 30, 0);
coinFont.preload("0123456789 NEWTOP", { budgetMs: 0 });
let shownCoins = -1, coinText = "", coinX = 0;
// Player 2's score, in its chicken's yellow.
const p2Font = new Font(hud.font, { size: hud.fontSize });
p2Font.color = Color.new(255, 214, 66);
p2Font.outline = 2;
p2Font.outlineColor = Color.new(60, 30, 0);
p2Font.preload("0123456789", { budgetMs: 0 });
let shownP = [-1, -1], pText = ["", ""], pW = [0, 0], p2X = 0;
const titleFont = new Font(hud.font, { size: hud.titleSize });
titleFont.color = Color.new(255, 255, 255);
titleFont.outline = 3;
titleFont.outlineColor = Color.new(20, 20, 30);
titleFont.preload(hud.title.join(""), { budgetMs: 0 });
const titleX = hud.title.map(line => (mode.width - titleFont.getTextSize(line).width) / 2);
const retryText = "PRESS X";
const joinText = "P2 PRESS X", joinedText = "2 PLAYERS";
const joinX = (mode.width - smallFont.getTextSize(joinText).width) / 2;
const joinedX = (mode.width - smallFont.getTextSize(joinedText).width) / 2;
const retryX = (mode.width - smallFont.getTextSize(retryText).width) / 2;

const audio = createAudio(tuning);
const wasHopping = new Uint8Array(2), lastBumps = new Int32Array(2), wasAlive = new Uint8Array(2);
const eagleGrab = new Uint8Array(2), wasMounted = new Uint8Array(2);
let panelTime = 0;

// Juice: the log/pad landed on dips (dipRef = its mover index), the camera
// shakes on hits.
const juice = tuning.juice, multi = tuning.multi;
let dipRef = -1, dipTime = 0, dipNow = 0;
const idleTime = new Float32Array(2);
const lightOn = new Uint8Array(n), trainHeard = new Uint8Array(n);

// --- Views: merge and split ----------------------------------------------------
// Rows from a camera's target to the ground point a quarter of the screen
// above (qUp) or below (qDown) the centre, i.e. the centres of the two halves.
const tanHalf = Math.tan(c.fovYDegrees * rad / 2), ce = Math.cos(c.elevationDegrees * rad);
const se = Math.sin(c.elevationDegrees * rad), ca = Math.cos(c.azimuthDegrees * rad);
const qUp = .5 * tanHalf * c.distance / (ca * (se - .5 * tanHalf * ce));
const qDown = .5 * tanHalf * c.distance / (ca * (se + .5 * tanHalf * ce));
// Two players whose focus points are up to qUp + qDown rows apart fit one
// view; beyond that each half follows its own player. At exactly that gap the
// split cameras equal the merged one, so the split opens without a jump.
const viewX = new Float32Array(2), viewZ = new Float32Array(2), wantX = new Float32Array(2),
    wantZ = new Float32Array(2);
let split = false, splitFrames = 0, camX = 0;
const fullScissor = Screen.getParam(Screen.SCISSOR_BOUNDS);
const topScissor = { x0: fullScissor.x0, y0: fullScissor.y0, x1: fullScissor.x1, y1: (height >> 1) - 1 };
const bottomScissor = { x0: fullScissor.x0, y0: height >> 1, x1: fullScissor.x1, y1: fullScissor.y1 };
function clampX(x) { return Math.max(-c.maxTargetX, Math.min(c.maxTargetX, x)) + c.targetOffset[0]; }

// Runners the camera follows: the living ones; at game over, the last to die.
function followed(r) {
    if (!r.joined) return false;
    if (game.state !== DEAD) return r.alive;
    const o = runners[1 - r.index];
    return !o.joined || r.deadTime <= o.deadTime;
}
function nearestRunner(z) {
    let d = 1e9;
    for (let i = 0; i < 2; i++) if (runners[i].joined) d = Math.min(d, Math.abs(z - runners[i].player.rz));
    return d;
}
function aimViews() {
    const a = runners[0], b = runners[1], fa = followed(a), fb = followed(b);
    if (fa !== fb || !fa) {
        // One view, as in a solo game.
        const r = fa || !fb ? a : b, p = r.player;
        wantX[0] = wantX[1] = clampX(p.rx);
        wantZ[0] = wantZ[1] = Math.min(p.rz, r.scrollZ) + c.targetOffset[2];
        return;
    }
    // The scroll line pulls each focus ahead of an idle player (the eagle's
    // warning), but only so far: a half screen is short.
    const za = Math.max(Math.min(a.player.rz, a.scrollZ), a.player.rz - multi.maxDrift) + multi.focusOffset;
    const zb = Math.max(Math.min(b.player.rz, b.scrollZ), b.player.rz - multi.maxDrift) + multi.focusOffset;
    const lead = za <= zb ? a : b, trail = lead === a ? b : a;
    const zl = Math.min(za, zb), zt = Math.max(za, zb), gap = zt - zl, D = qUp + qDown;
    const xl = clampX(lead.player.rx), xt = clampX(trail.player.rx);
    if (gap <= D) {
        wantX[0] = wantX[1] = (xl + xt) / 2;
        wantZ[0] = wantZ[1] = zl + gap * qUp / D;
    } else {
        wantX[0] = xl; wantZ[0] = zl + qUp; // Top half: the leader.
        wantX[1] = xt; wantZ[1] = zt - qDown; // Bottom half.
    }
}
function snapCamera() {
    aimViews();
    for (let i = 0; i < 2; i++) { viewX[i] = wantX[i]; viewZ[i] = wantZ[i]; }
}
function followViews(dt) {
    aimViews();
    const kx = 1 - Math.exp(-c.followRateX * dt), kz = 1 - Math.exp(-c.followRateZ * dt);
    for (let i = 0; i < 2; i++) {
        viewX[i] += (wantX[i] - viewX[i]) * kx;
        viewZ[i] += (wantZ[i] - viewZ[i]) * kz;
    }
    split = Math.abs(viewX[0] - viewX[1]) > multi.mergeEpsilon || Math.abs(viewZ[0] - viewZ[1]) > multi.mergeEpsilon;
    camX = viewX[0];
}
let shakeTime = 0;
function placeCamera() {
    let sx = 0, sz = 0;
    if (shakeTime > 0) {
        const k = juice.shakeAmount * shakeTime / juice.shakeSeconds;
        sx = Math.sin(frame * 2.3) * k;
        sz = Math.cos(frame * 3.1) * k * .6;
    }
    for (let i = 0; i < (split ? 2 : 1); i++) {
        cameras[i].setPosition(viewX[i] + sx + camOffX, c.targetOffset[1] + camOffY, viewZ[i] + sz + camOffZ)
            .lookAt(viewX[i] + sx, c.targetOffset[1], viewZ[i] + sz);
    }
}

function drawPlayer(r) {
    const t = tuning, i = r.index, player = r.player, kind = rowKind(rows, Math.round(player.rz));
    const chicken = chickens[i], eagleItem = eagles[i];
    shadowsGrass[i].setPosition(0, HIDDEN, 0);
    shadowsRoad[i].setPosition(0, HIDDEN, 0);
    eagleItem.setPosition(0, HIDDEN, 0);
    if (!r.joined) { chicken.setPosition(0, HIDDEN, 0); return; }
    if (!r.alive) {
        const dt = r.deadTime, cause = r.cause;
        if (cause === CAR_HIT || cause === TRAIN_HIT) {
            chicken.setPosition(r.deathX, kind === RAIL ? g0.railY : g0.roadY, r.deathZ)
                .setScale(t.death.flatXZ, t.death.flatY, t.death.flatXZ);
        } else if (cause === DROWNED || cause === SWEPT) {
            const u = Math.min(1, dt / t.death.sinkSeconds);
            chicken.setPosition(r.deathX, u >= 1 ? HIDDEN : g0.logTop - u * .9, r.deathZ)
                .setScale(1, 1, 1);
        } else {
            // Eagle: swoop from ahead onto the chicken, then carry it off behind.
            const e = t.eagle, swoop = Math.min(1, dt / e.swoopSeconds);
            const carryU = Math.max(0, Math.min(1, (dt - e.swoopSeconds) / e.carrySeconds));
            const ex = r.deathX, ez = r.deathZ - 9 * (1 - swoop) + 12 * carryU;
            const ey = 4.5 - 3.6 * swoop + 4 * carryU;
            eagleItem.setPosition(ex, ey, ez);
            chicken.setPosition(ex, carryU > 0 ? ey - 1.05 : player.ry, carryU > 0 ? ez : r.deathZ)
                .setScale(1, 1, 1);
        }
        return;
    }
    // Idle: the chicken breathes; on the title screen it also looks around.
    let scaleY = player.scaleY, yaw = player.yaw;
    if (!isBusy(player)) {
        const it = idleTime[i] += 1 / 60;
        scaleY *= 1 + juice.breathe * Math.sin(it * juice.breatheRate + i * 1.3);
        if (game.state === TITLE) yaw += juice.lookYaw * Math.sin(it * juice.lookRate + i * 2.1);
    } else idleTime[i] = 0;
    chicken.setPosition(player.rx, player.ry - (r.riding >= 0 && r.riding === dipRef ? dipNow : 0), player.rz)
        .setScale(1, scaleY, 1).setRotationEuler(0, yaw, 0);
    const base = game.world.groundY(Math.round(player.rz));
    const lift = 1 - .35 * Math.min(1, Math.max(0, player.ry - base) / tuning.player.hopHeight);
    if (r.mount >= 0) return; // Riding on the other chicken: its shadow covers both.
    const shadow = kind === GRASS ? shadowsGrass[i] : shadowsRoad[i];
    shadow.setPosition(player.rx + .12, base + .025, player.rz + .10).setScale(.52 * lift, 1, .55 * lift);
}

// --- Title screen and game-over panel ------------------------------------------
const panelW = 260, panelH = 128, panelX = (mode.width - panelW) / 2, panelY = height * .30;
const panelLabels = ["SCORE", "TOP"].map(t => [t, smallFont.getTextSize(t).width]);
const newTopText = "NEW TOP", newTopX = panelX + (panelW - coinFont.getTextSize(newTopText).width) / 2;
let panelScore = -1, panelText = "", panelTextW = 0;
function drawTitle() {
    const lineH = hud.titleSize + 6, y0 = height * .16 + Math.sin(frame * .05) * 4;
    for (let i = 0; i < hud.title.length; i++) titleFont.print(titleX[i], y0 + i * lineH, hud.title[i]);
    if (game.top > 0) smallFont.print((mode.width - topW) / 2, y0 + hud.title.length * lineH + 8, topText);
    drawJoin();
}
function drawJoin() {
    if (game.count > 1) p2Font.print(joinedX - 8, height * .92, joinedText);
    else if (frame & 32) smallFont.print(joinX, height * .93, joinText);
}
function drawPanel() {
    // Fades in; a dark translucent card with the run's score and the best.
    const u = Math.min(1, panelTime / juice.panelFade);
    const y = panelY + (1 - u) * 24;
    Draw.rect(panelX, y, panelW, panelH, Color.new(20, 24, 40, Math.round(80 * u)));
    Draw.rect(panelX, y, panelW, 4, Color.new(255, 214, 40, Math.round(128 * u)));
    if (u < 1) return;
    if (panelScore !== game.score) {
        panelScore = game.score;
        panelText = "" + panelScore;
        panelTextW = scoreFont.getTextSize(panelText).width;
    }
    smallFont.print(panelX + (panelW - panelLabels[0][1]) / 2, y + 14, panelLabels[0][0]);
    if (game.count > 1) {
        // One score per player, each in its chicken's colour.
        scoreFont.print(panelX + panelW * .27 - pW[0] / 2, y + 34, pText[0]);
        p2Font.print(panelX + panelW * .73 - pW[1] / 2, y + 34, pText[1]);
    } else scoreFont.print(panelX + (panelW - panelTextW) / 2, y + 34, panelText);
    if (newTop(game)) {
        if (frame & 16) coinFont.print(newTopX, y + 86, newTopText);
    } else smallFont.print(panelX + (panelW - topW) / 2, y + 92, topText);
}

// Rows a view can show: where the rays through the corners of its part of the
// screen (NDC y from y0 to y1) meet the ground, widened for props that stand
// up into view from the rows in front and for the depth of props behind.
// Slot batches outside are not submitted at all, so a long row window costs
// nothing where it is not seen.
function visibleRows(i, y0, y1) {
    const ex = viewX[i] + camOffX, ey = c.targetOffset[1] + camOffY, ez = viewZ[i] + camOffZ;
    let fx = -camOffX, fy = -camOffY, fz = -camOffZ;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; // f x (0, 1, 0)
    const rl = Math.hypot(rx, rz);
    rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // right x f
    const sy = tanHalf, sx = tanHalf * mode.width / height;
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 4; k++) {
        const x = k & 1 ? sx : -sx, y = (k & 2 ? y1 : y0) * sy;
        const dx = fx + y * ux + x * rx, dy = fy + y * uy, dz = fz + y * uz + x * rz;
        const z = dy < -1e-4 ? ez + (ey - c.targetOffset[1]) / -dy * dz : ez - 1e9 * Math.sign(dz || 1);
        if (z < lo) lo = z;
        if (z > hi) hi = z;
    }
    visLo[i] = Math.floor(lo) - 1;
    visHi[i] = Math.ceil(hi) + 2;
}
function findVisibleRows() {
    if (split) { visibleRows(0, 0, 1); visibleRows(1, -1, 0); }
    else { visibleRows(0, -1, 1); visLo[1] = visLo[0]; visHi[1] = visHi[0]; }
}
function drawScene(cam, rowMin, rowMax) {
    shadowBatch.draw(cam, Render3D.CULL_BACK, lights, shadowStats);
    addStats(shadowStats);
    for (let s = 0; s < n; s++) {
        const z = rows.z[s];
        if (z < rowMin || z > rowMax) continue;
        slotBatch[s].draw(cam, Render3D.CULL_BACK, lights, stats);
        addStats(stats);
    }
    dynamicBatch.draw(cam, Render3D.CULL_BACK, lights, stats);
    addStats(stats);
    if (particleBatch.size > 0) {
        particleBatch.draw(cam, Render3D.CULL_BACK, lights, stats);
        addStats(stats);
    }
}
function addStats(st) {
    frameStats.triangles += st.triangles; frameStats.drawPasses += st.drawPasses;
    frameStats.culledObjects += st.culledObjects; frameStats.submittedObjects += st.submittedObjects;
}

// --- Instrumentation -------------------------------------------------------------
const pad = Gamepad.player(0), pad2 = Gamepad.player(1);
const stats = {}, shadowStats = {};
// Per-frame totals over every batch and view.
const frameStats = { triangles: 0, drawPasses: 0, culledObjects: 0, submittedObjects: 0 };
const m = tuning.measurement;
const cpu = new Float32Array(m.cpuFrames), cpuFrame = new Int32Array(m.cpuFrames);
const events = new Int32Array(m.maxEvents * 4); // frame, kind (1 death, 2 restart), score, cause
let frame = 0, cpuCount = 0, cpuNext = 0, presses = 0, logged = 0, reports = 0, rebuilt = 0;
let lastRestarts = 0, maxTriangles = 0, maxDrawn = 0, resetFrame = 0;
// Max ms: [restart logic, restart release, restart build, row logic, row release, row build].
const profile = new Float32Array(6);
const frameWork = new Uint8Array(m.cpuFrames + 8); // slots rebuilt per update, by frame
const reportFrames = [];
const memoryLoaded = System.getMemoryStats();

function logEvent(kind) {
    if (logged >= m.maxEvents) return;
    events[logged * 4] = frame;
    events[logged * 4 + 1] = kind;
    events[logged * 4 + 2] = game.score;
    events[logged * 4 + 3] = game.cause;
    logged++;
}

function rowSummary() {
    // Kind letters and blocked-cell masks for the run's first rows, compared
    // with the host generator for the same seed.
    let kinds = "";
    const masks = [];
    for (let z = rows.frontZ; z < rows.frontZ + n; z++) {
        const s = slotOf(rows, z);
        kinds += "GRWT"[rows.kind[s]];
        masks.push(rows.tree[s] | rows.rock[s]);
    }
    return { frontZ: rows.frontZ, kinds, masks };
}

function writeReport() {
    reportFrames.push(frame);
    const k = Math.min(cpuCount, cpu.length);
    const sorted = Array.from(cpu.subarray(0, k)).sort((a, b) => a - b);
    let sum = 0, gameMax = 0, slow = 0;
    const slowList = []; // [frame, cpu ms, rows rebuilt in that frame's update]
    for (let i = 0; i < k; i++) {
        sum += sorted[i];
        // Loop.getStats() reports a frame's CPU time two frames later.
        if (reportFrames.indexOf(cpuFrame[i] - 2) >= 0) continue;
        if (cpu[i] > 16.67) {
            slow++;
            const f = cpuFrame[i] - 2, L = frameWork.length;
            slowList.push([f, Math.round(cpu[i] * 10) / 10, frameWork[((f % L) + L) % L]]);
        }
        if (cpu[i] > gameMax) gameMax = cpu[i];
    }
    const render = frameStats;
    const eventList = [];
    for (let i = 0; i < logged; i++) eventList.push(Array.from(events.subarray(i * 4, i * 4 + 4)));
    const used = {};
    for (let p = 0; p < poolNames.length; p++) used[poolNames[p]] = tuning.pools[poolNames[p]] - poolTop[p];
    const report = {
        milestone: 4, report: ++reports, frame, presses,
        game: {
            state: game.state, cause: game.cause, run: game.run, seed: runSeed(tuning, game.run),
            score: game.score, top: game.top, deaths: game.deaths, restarts: game.restarts,
            scrollZ: runners[0].scrollZ
        },
        player: { x: player.x, z: player.z, bestZ: player.bestZ, hops: player.hops, bumps: player.bumps },
        multi: { count: game.count, split, splitFrames, alive: runners.map(r => r.alive), scores: runners.map(r => r.score) },
        rows: rowSummary(), generated: rows.generated, rebuilt, poolUsed: used,
        coins: game.coins, particlePeak, bursts, profile: Array.from(profile, v => Math.round(v * 100) / 100),
        events: eventList, instances: instanceCount, render, maxTriangles, maxDrawn,
        memoryBefore, memoryLoaded, memoryAfter: System.getMemoryStats(),
        vramUsedBytes: Screen.getMemoryStats(Screen.VRAM_USED_TOTAL), vramFreeBytes: Screen.getFreeVRAM(),
        cpuFrames: k, meanCpuMs: sum / k, p95CpuMs: sorted[Math.ceil(k * .95) - 1], maxCpuMs: sorted[k - 1],
        maxCpuMsExcludingReports: gameMax, slowFrames: slow, slowList, resetFrame,
        loop: Loop.getStats(), budgets: tuning.budgets
    };
    const file = std.open("metrics.json", "w");
    if (!file) throw new Error("Cannot write metrics.json to the launch directory");
    file.puts(JSON.stringify(report, null, 2));
    file.close();
}

for (let s = 0; s < n; s++) buildSlot(s);
showTitle(game);
snapCamera();
placeCamera();
findVisibleRows();

Loop.run({
    update(dt) {
        if (dt > .05) dt = .05; // Avoid teleport-like hops after a stall.
        Gamepad.update();
        let dir = pad.justPressed(Gamepad.UP) ? UP : pad.justPressed(Gamepad.DOWN) ? DOWN :
            pad.justPressed(Gamepad.LEFT) ? LEFT : pad.justPressed(Gamepad.RIGHT) ? RIGHT : -1;
        let restart = pad.justPressed(Gamepad.CROSS) || pad.justPressed(Gamepad.START);
        if (dir >= 0) presses++;
        // Player 2: joins with X/START on the title or game-over screen, leaves
        // with O there; plays with its D-pad.
        let dir2 = pad2.justPressed(Gamepad.UP) ? UP : pad2.justPressed(Gamepad.DOWN) ? DOWN :
            pad2.justPressed(Gamepad.LEFT) ? LEFT : pad2.justPressed(Gamepad.RIGHT) ? RIGHT : -1;
        const between = game.state === TITLE || canRestart(game);
        if (pad2.justPressed(Gamepad.CROSS) || pad2.justPressed(Gamepad.START)) {
            if (game.count === 1 && between) { setPlayers(game, 2); play(audio, "coin", 4); snapCamera(); }
            else if (game.count > 1) restart = true;
        }
        if (pad2.justPressed(Gamepad.CIRCLE) && game.count > 1 && between) { setPlayers(game, 1); snapCamera(); }
        if (game.count === 1) dir2 = -1;
        const wasDead = game.state === DEAD, wasTitle = game.state === TITLE;
        const t0 = System.getMilliseconds();
        updateGame(game, dt, dir, restart, dir2);
        rows = game.rows;
        const t1 = System.getMilliseconds();
        for (let i = 0; i < 2; i++) {
            const r = runners[i];
            if (wasAlive[i] && !r.alive) { logEvent(1); deathBurst(r); eagleGrab[i] = 0; }
            wasAlive[i] = r.alive ? 1 : 0;
        }
        if (game.restarts !== lastRestarts) {
            lastRestarts = game.restarts;
            logEvent(2);
            clearParticles(particles);
            play(audio, "restart", 0);
            dipRef = -1;
        }
        if (wasTitle && game.state !== TITLE) play(audio, "restart", 0);
        for (let i = 0; i < 2; i++) {
            const r = runners[i];
            if (!r.joined) continue;
            const p = r.player, px = p.x - camX;
            const hopping = isHopping(p);
            if (hopping && !wasHopping[i] && r.alive) play(audio, "hop", px);
            wasHopping[i] = hopping ? 1 : 0;
            if (p.bumps !== lastBumps[i]) {
                if (p.bumps > lastBumps[i]) play(audio, "bump", px);
                lastBumps[i] = p.bumps;
            }
            if (!r.alive && r.cause === EAGLE && !eagleGrab[i] && r.deadTime >= tuning.eagle.swoopSeconds) {
                eagleGrab[i] = 1;
                burst(WHITE, 8, r.deathX, .6, r.deathZ, 2.0, 2.5, .8, .11, 4, 2.5);
            }
            if (r.alive && r.mount >= 0 && !wasMounted[i]) play(audio, "bump", px); // Landed on a head.
            wasMounted[i] = r.mount >= 0 ? 1 : 0;
            if (r.alive && p.landed) {
                const kind = rowKind(rows, p.z);
                if (kind === WATER) {
                    burst(SPLASH, 4, p.x, -.08, p.z, 1.0, 1.6, .3, .07, 9, 1);
                    dipRef = r.riding;
                    dipTime = juice.dipSeconds;
                    play(audio, rows.mType[r.riding] === LILY ? "land_lily" : "land_log", px);
                }
                else burst(DUST, 4, p.x, p.ry + .03, p.z + .15, 1.1, 1.1, .32, .08, 6, 3);
            }
            if (r.coinTaken) {
                burst(GOLD, 10, p.x, p.ry + .5, p.z, 1.8, 3.2, .5, .09, 7, 1);
                play(audio, "coin", px);
            }
        }
        if (dipTime > 0) {
            dipTime = Math.max(0, dipTime - dt);
            dipNow = juice.logDip * Math.sin(Math.PI * (1 - dipTime / juice.dipSeconds));
        } else dipNow = 0;
        if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
        // Music on the title and game-over screens, ambience while playing.
        track(audio, game.state === TITLE || canRestart(game) ? "title" : "ambience");
        if (canRestart(game)) panelTime += dt; else panelTime = 0;
        updateParticles(particles, dt);
        let rebuiltNow = 0, dirty = 0;
        for (let s = 0; s < n; s++) dirty += rows.dirty[s];
        if (dirty > REBUILD_BUDGET) {
            // A new run: hide every stale slot now, then build nearest rows first.
            for (let s = 0; s < n; s++) if (rows.dirty[s]) releaseSlot(s);
        }
        const t2 = System.getMilliseconds();
        for (let z = rows.frontZ + n - 1; z >= rows.frontZ && rebuiltNow < REBUILD_BUDGET; z--) {
            const s = slotOf(rows, z);
            if (rows.dirty[s]) { buildSlot(s); rebuiltNow++; }
        }
        const t3 = System.getMilliseconds();
        if (dirty > REBUILD_BUDGET || rebuiltNow > 0) {
            // Worst update seen for: game logic (incl. row generation), slot release, slot builds.
            const k = dirty > REBUILD_BUDGET ? 0 : 3;
            if (t1 - t0 > profile[k]) profile[k] = t1 - t0;
            if (t2 - t1 > profile[k + 1]) profile[k + 1] = t2 - t1;
            if (t3 - t2 > profile[k + 2]) profile[k + 2] = t3 - t2;
        }
        rebuilt += rebuiltNow;
        frameWork[frame % frameWork.length] = rebuiltNow;
        if (wasDead && game.state !== DEAD) snapCamera();
        followViews(dt);
        placeCamera();
        findVisibleRows();
        placeMovers();
        drawPlayer(runners[0]);
        drawPlayer(runners[1]);
        drawParticles();

        if (pad.justPressed(Gamepad.L1)) {
            // Debug showcase: every burst type around the chicken, for screenshots.
            const x = player.rx, z = player.rz;
            burst(WHITE, 16, x - 1.3, .5, z, 2.6, 3.6, .9, .12, 5, 2.2);
            burst(RED, 3, x - 1.3, .7, z, 1.6, 3.0, .7, .10, 6, 1.5);
            burst(SPLASH, 18, x + 1.3, .1, z, 1.7, 4.2, .6, .12, 12, .5);
            burst(GOLD, 10, x, .6, z - 1, 1.8, 3.2, .5, .09, 7, 1);
            burst(DUST, 4, x, .1, z + .15, 1.1, 1.1, .32, .08, 6, 3);
        }
        if (pad.justPressed(Gamepad.R2)) writeReport();
        if (pad.justPressed(Gamepad.L2)) {
            // Debug: toggle a second player and start over, for tests.
            setPlayers(game, game.count === 1 ? 2 : 1);
            resetGame(game);
            rows = game.rows;
            clearParticles(particles);
            for (let s = 0; s < n; s++) if (rows.dirty[s]) buildSlot(s);
            snapCamera();
        }
        if (pad.justPressed(Gamepad.L3)) {
            // Debug reset: the input test uses it to discard any earlier input.
            resetGame(game);
            rows = game.rows;
            clearParticles(particles);
            presses = logged = lastRestarts = 0;
            resetFrame = frame;
            for (let s = 0; s < n; s++) if (rows.dirty[s]) buildSlot(s);
            snapCamera();
        }
    },
    draw() {
        frameStats.triangles = frameStats.drawPasses = frameStats.culledObjects = frameStats.submittedObjects = 0;
        if (split) {
            splitFrames++;
            Screen.setParam(Screen.SCISSOR_BOUNDS, topScissor);
            drawScene(cameras[0], visLo[0], visHi[0]);
            Screen.setParam(Screen.SCISSOR_BOUNDS, bottomScissor);
            drawScene(cameras[1], visLo[1], visHi[1]);
            Screen.setParam(Screen.SCISSOR_BOUNDS, fullScissor);
            Draw.rect(0, (height - multi.divider) >> 1, mode.width, multi.divider, Color.new(20, 20, 30));
        } else drawScene(cameras[0], visLo[0], visHi[0]);
        if (frameStats.triangles > maxTriangles) maxTriangles = frameStats.triangles;
        if (frameStats.drawPasses > maxDrawn) maxDrawn = frameStats.drawPasses;
        if (game.score !== shownScore) { shownScore = game.score; scoreText = "" + shownScore; }
        for (let i = 0; i < 2; i++) {
            if (runners[i].score === shownP[i]) continue;
            shownP[i] = runners[i].score;
            pText[i] = "" + shownP[i];
            pW[i] = (i === 0 ? scoreFont : p2Font).getTextSize(pText[i]).width;
            if (i === 1) p2X = mode.width - hud.x - pW[1];
        }
        if (game.top !== shownTop) {
            shownTop = game.top;
            topText = "TOP " + shownTop;
            topW = smallFont.getTextSize(topText).width;
        }
        if (game.coins !== shownCoins) {
            shownCoins = game.coins;
            coinText = "" + shownCoins;
            coinX = mode.width - hud.x - coinFont.getTextSize(coinText).width;
        }
        if (game.state === TITLE) drawTitle();
        else {
            if (game.count > 1) {
                // Two players: scores in the top corners, coins between them.
                coinFont.print((coinX + hud.x) / 2, hud.y, coinText);
                scoreFont.print(hud.x, hud.y, pText[0]);
                p2Font.print(p2X, hud.y, pText[1]);
            } else {
                coinFont.print(coinX, hud.y, coinText);
                scoreFont.print(hud.x, hud.y, scoreText);
            }
            smallFont.print(hud.x, hud.y + hud.fontSize + 4, topText);
            if (panelTime > 0) { drawPanel(); if (canRestart(game)) drawJoin(); }
        }
        if ((canRestart(game) || game.state === TITLE) && (frame & 32))
            smallFont.print(retryX, height * .86, retryText);
        frame++;
        const time = Loop.getStats(); // Instrumentation allocates one small stats object.
        cpu[cpuNext] = time.cpuMs;
        cpuFrame[cpuNext] = frame;
        cpuNext = (cpuNext + 1) % cpu.length;
        cpuCount++;
    }
}, { clearColor: 0x80dcc662 }); // GS packed RGBA: 98, 198, 220, 128.
