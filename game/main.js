import { tuning } from "./tuning.js";
import { UP, DOWN, LEFT, RIGHT, isBusy, isHopping } from "./player.js";
import { POOLS, GRASS, ROAD, WATER, RAIL, LILY, TRAIN_IDLE, TRAIN_WARN, TRAIN_PASS, slotOf, rowKind, trainLength }
    from "./rows.js";
import {
    createGame, updateGame, resetGame, canRestart, runSeed, DEAD, CAR_HIT, TRAIN_HIT,
    DROWNED, SWEPT, EAGLE
} from "./game.js";
import { createBot, botMove } from "./bot.js";
import {
    createParticles, emit, updateParticles, particleScale, clearParticles, COLORS,
    WHITE, SPLASH, GOLD, DUST, RED
} from "./particles.js";
import { createAudio, play, falloff } from "./audio.js";

const mode = Screen.getMode();
const height = mode.height * (mode.interlace === Screen.INTERLACED && mode.field === Screen.FRAME ? 2 : 1);
mode.height = height;
mode.zbuffering = true;
mode.psmz = Screen.Z16S;
Screen.setMode(mode);

const memoryBefore = System.getMemoryStats();
const c = tuning.camera, rad = Math.PI / 180, g0 = tuning.ground;
const camera = new Camera3D.Camera({
    aspect: mode.width / height,
    fovYDegrees: c.fovYDegrees, near: c.near, far: c.far
});
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
const GROUND = ["grass", "grass_alt", "road", "road_marked", "water", "rail"];
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
const chickenShadowGrass = single("shadow_grass", true, shadowBatch).setScale(.52, 1, .55);
const chickenShadowRoad = single("shadow_road", true, shadowBatch).setScale(.52, 1, .55);
const chicken = single("chicken", false, dynamicBatch);
const eagleItem = single("eagle", false, dynamicBatch);

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
function deathBurst() {
    const x = game.deathX, z = game.deathZ;
    const sx = x - camX;
    if (game.cause === CAR_HIT || game.cause === TRAIN_HIT) {
        play(audio, "squash", sx);
        shakeTime = juice.shakeSeconds * (game.cause === TRAIN_HIT ? 1.4 : 1);
        burst(WHITE, 16, x, .5, z, 2.6, 3.6, .9, .12, 5, 2.2);
        burst(RED, 3, x, .7, z, 1.6, 3.0, .7, .10, 6, 1.5);
    } else if (game.cause === DROWNED || game.cause === SWEPT) {
        play(audio, "splash", sx);
        burst(SPLASH, 18, x, -.05, z, 1.7, 4.2, .6, .12, 12, .5);
    } else {
        play(audio, "eagle", sx);
    }
}

// --- Game and row visuals ------------------------------------------------------
const game = createGame(tuning);
let rows = game.rows; // Swapped with the prepared buffer on each restart.
const player = game.player, n = rows.n, M = rows.M;
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
const REBUILD_BUDGET = 8; // Slots rebuilt per update; a new run needs 3 updates instead of one long one.

// Moving instances (vehicles, logs, trains) are positioned with one
// Model3D.setPositions call per frame. The list is rebuilt when rows change;
// moving[] is a persistent array whose length is set, not reallocated.
const MOVING_MAX = n * (M + TRAIN_PARTS);
const moving = [], movingRef = new Int32Array(MOVING_MAX), movingPos = new Float32Array(MOVING_MAX * 3);
let movingCount = 0, movingDirty = true;

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
    const ground = kind === GRASS ? (rows.alt[s] ? P.grass_alt : P.grass) :
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
    movingDirty = false;
}

function placeMovers() {
    if (movingDirty) collectMoving();
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
        if (slotCoin[s] < 0 || !coinShown[s]) continue;
        const it = item(slotCoin[s]);
        if (!rows.hasCoin[s]) { it.setPosition(0, HIDDEN, 0); coinShown[s] = 0; continue; }
        const base = builtKind[s] === ROAD ? g0.roadY : g0.grassY;
        it.setPosition(rows.coinX[s], base + cn.height + bob, rows.z[s]).setRotationEuler(0, angle, 0);
    }
    for (let s = 0; s < n; s++) {
        if (builtKind[s] !== RAIL) continue;
        // Lights blink while warning and stay on while the train passes.
        const state = rows.trainState[s];
        const on = state !== TRAIN_IDLE && (state === TRAIN_PASS || (frame & 16) !== 0);
        // Sounds: a bell on each blink while warning, the horn when the train enters.
        const near = falloff(audio, rows.z[s] - player.rz);
        if (on && !lightOn[s] && state === TRAIN_WARN && near > 0)
            play(audio, "bell", tuning.player.minX - 1 - camX, near);
        if (state === TRAIN_PASS && trainHeard[s] !== TRAIN_PASS && near > 0)
            play(audio, "train", -rows.trainDir[s] * 4, near);
        lightOn[s] = on ? 1 : 0;
        trainHeard[s] = state;
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
    f.preload("0123456789 TOPRESXAU", { budgetMs: 0 }); // Covers all HUD texts.
}
let shownScore = -1, shownTop = -1, scoreText = "", topText = "";
const coinFont = new Font(hud.font, { size: hud.coinSize });
coinFont.color = Color.new(255, 214, 40);
coinFont.outline = 2;
coinFont.outlineColor = Color.new(60, 30, 0);
coinFont.preload("0123456789", { budgetMs: 0 });
let shownCoins = -1, coinText = "", coinX = 0;
const retryText = "PRESS X", autoText = "AUTO", testText = "TEST";
const retryX = (mode.width - smallFont.getTextSize(retryText).width) / 2;
const autoX = mode.width - 18 - smallFont.getTextSize(autoText).width;

const audio = createAudio(tuning);
let wasHopping = false, lastBumps = 0;

let camX = 0, camZ = 0;
// Juice: the log/pad landed on dips (dipRef = its mover index), the camera
// shakes on hits.
const juice = tuning.juice;
let dipRef = -1, dipTime = 0, dipNow = 0;
const lightOn = new Uint8Array(n), trainHeard = new Uint8Array(n);
function cameraTarget() {
    const focusZ = Math.min(player.rz, game.scrollZ);
    return focusZ + c.targetOffset[2];
}
function snapCamera() {
    camX = Math.max(-c.maxTargetX, Math.min(c.maxTargetX, player.rx)) + c.targetOffset[0];
    camZ = cameraTarget();
}
let shakeTime = 0;
function placeCamera() {
    let sx = 0, sz = 0;
    if (shakeTime > 0) {
        const k = juice.shakeAmount * shakeTime / juice.shakeSeconds;
        sx = Math.sin(frame * 2.3) * k;
        sz = Math.cos(frame * 3.1) * k * .6;
    }
    camera.setPosition(camX + sx + camOffX, c.targetOffset[1] + camOffY, camZ + sz + camOffZ)
        .lookAt(camX + sx, c.targetOffset[1], camZ + sz);
}

function drawPlayer() {
    const t = tuning, kind = rowKind(rows, Math.round(player.rz));
    chickenShadowGrass.setPosition(0, HIDDEN, 0);
    chickenShadowRoad.setPosition(0, HIDDEN, 0);
    eagleItem.setPosition(0, HIDDEN, 0);
    if (game.state === DEAD) {
        const dt = game.deadTime, cause = game.cause;
        if (cause === CAR_HIT || cause === TRAIN_HIT) {
            chicken.setPosition(game.deathX, kind === RAIL ? g0.railY : g0.roadY, game.deathZ)
                .setScale(t.death.flatXZ, t.death.flatY, t.death.flatXZ);
        } else if (cause === DROWNED || cause === SWEPT) {
            const u = Math.min(1, dt / t.death.sinkSeconds);
            chicken.setPosition(game.deathX, u >= 1 ? HIDDEN : g0.logTop - u * .9, game.deathZ)
                .setScale(1, 1, 1);
        } else {
            // Eagle: swoop from ahead onto the chicken, then carry it off behind.
            const e = t.eagle, swoop = Math.min(1, dt / e.swoopSeconds);
            const carryU = Math.max(0, Math.min(1, (dt - e.swoopSeconds) / e.carrySeconds));
            const ex = game.deathX, ez = game.deathZ - 9 * (1 - swoop) + 12 * carryU;
            const ey = 4.5 - 3.6 * swoop + 4 * carryU;
            eagleItem.setPosition(ex, ey, ez);
            chicken.setPosition(ex, carryU > 0 ? ey - 1.05 : player.ry, carryU > 0 ? ez : game.deathZ)
                .setScale(1, 1, 1);
        }
        return;
    }
    chicken.setPosition(player.rx, player.ry - (game.riding >= 0 && game.riding === dipRef ? dipNow : 0), player.rz)
        .setScale(1, player.scaleY, 1).setRotationEuler(0, player.yaw, 0);
    const base = game.world.groundY(Math.round(player.rz));
    const lift = 1 - .35 * Math.min(1, Math.max(0, player.ry - base) / tuning.player.hopHeight);
    const shadow = kind === GRASS ? chickenShadowGrass : chickenShadowRoad;
    shadow.setPosition(player.rx + .12, base + .025, player.rz + .10).setScale(.52 * lift, 1, .55 * lift);
}

// --- Instrumentation -------------------------------------------------------------
const pad = Gamepad.player(0);
const bot = createBot(tuning);
let autopilot = false;
// Test lock (R3): ignores D-pad and X/START from the pad so a scripted run
// cannot be disturbed by someone playing; the autopilot still drives.
let inputLocked = false;
const stats = {}, shadowStats = {};
// Per-frame totals over the shadow, 24 slot and dynamic batches.
const frameStats = { triangles: 0, drawPasses: 0, culledObjects: 0, submittedObjects: 0 };
const m = tuning.measurement;
const cpu = new Float32Array(m.cpuFrames), cpuFrame = new Int32Array(m.cpuFrames);
const events = new Int32Array(m.maxEvents * 4); // frame, kind (1 death, 2 restart), score, cause
let frame = 0, cpuCount = 0, cpuNext = 0, presses = 0, logged = 0, reports = 0, rebuilt = 0;
let lastDeaths = 0, lastRestarts = 0, maxTriangles = 0, maxDrawn = 0, ignoredPresses = 0, resetFrame = 0;
let eagleGrab = false;
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
        milestone: 4, report: ++reports, frame, presses, autopilot,
        game: {
            state: game.state, cause: game.cause, run: game.run, seed: runSeed(tuning, game.run),
            score: game.score, top: game.top, deaths: game.deaths, restarts: game.restarts,
            scrollZ: game.scrollZ
        },
        player: { x: player.x, z: player.z, bestZ: player.bestZ, hops: player.hops, bumps: player.bumps },
        rows: rowSummary(), generated: rows.generated, rebuilt, poolUsed: used,
        coins: game.coins, particlePeak, bursts, profile: Array.from(profile, v => Math.round(v * 100) / 100),
        events: eventList, instances: instanceCount, render, maxTriangles, maxDrawn,
        memoryBefore, memoryLoaded, memoryAfter: System.getMemoryStats(),
        vramUsedBytes: Screen.getMemoryStats(Screen.VRAM_USED_TOTAL), vramFreeBytes: Screen.getFreeVRAM(),
        cpuFrames: k, meanCpuMs: sum / k, p95CpuMs: sorted[Math.ceil(k * .95) - 1], maxCpuMs: sorted[k - 1],
        maxCpuMsExcludingReports: gameMax, slowFrames: slow, slowList, inputLocked, ignoredPresses, resetFrame,
        loop: Loop.getStats(), budgets: tuning.budgets
    };
    const file = std.open("metrics.json", "w");
    if (!file) throw new Error("Cannot write metrics.json to the launch directory");
    file.puts(JSON.stringify(report, null, 2));
    file.close();
}

for (let s = 0; s < n; s++) buildSlot(s);
snapCamera();
placeCamera();

Loop.run({
    update(dt) {
        if (dt > .05) dt = .05; // Avoid teleport-like hops after a stall.
        Gamepad.update();
        let dir = pad.justPressed(Gamepad.UP) ? UP : pad.justPressed(Gamepad.DOWN) ? DOWN :
            pad.justPressed(Gamepad.LEFT) ? LEFT : pad.justPressed(Gamepad.RIGHT) ? RIGHT : -1;
        let restart = pad.justPressed(Gamepad.CROSS) || pad.justPressed(Gamepad.START);
        if (dir >= 0) presses++;
        if (pad.justPressed(Gamepad.R3)) inputLocked = !inputLocked;
        if (inputLocked) {
            if (dir >= 0) ignoredPresses++;
            dir = -1;
            restart = false;
        }
        if (pad.justPressed(Gamepad.R1)) autopilot = !autopilot;
        if (autopilot) {
            if (game.state === DEAD) restart = canRestart(game);
            else if (dir < 0 && !isBusy(player)) dir = botMove(bot, game);
        }
        const wasDead = game.state === DEAD;
        const t0 = System.getMilliseconds();
        updateGame(game, dt, dir, restart);
        rows = game.rows;
        const t1 = System.getMilliseconds();
        if (game.deaths !== lastDeaths) { lastDeaths = game.deaths; logEvent(1); deathBurst(); eagleGrab = false; }
        if (game.restarts !== lastRestarts) {
            lastRestarts = game.restarts;
            logEvent(2);
            clearParticles(particles);
            play(audio, "restart", 0);
            dipRef = -1;
        }
        const hopping = isHopping(player);
        if (hopping && !wasHopping && game.state !== DEAD) play(audio, "hop", player.x - camX);
        wasHopping = hopping;
        if (player.bumps !== lastBumps) {
            if (player.bumps > lastBumps) play(audio, "bump", player.x - camX);
            lastBumps = player.bumps;
        }
        if (game.state === DEAD && game.cause === EAGLE && !eagleGrab &&
            game.deadTime >= tuning.eagle.swoopSeconds) {
            eagleGrab = true;
            burst(WHITE, 8, game.deathX, .6, game.deathZ, 2.0, 2.5, .8, .11, 4, 2.5);
        }
        if (game.state !== DEAD && player.landed) {
            const kind = rowKind(rows, player.z);
            if (kind === WATER) {
                burst(SPLASH, 4, player.x, -.08, player.z, 1.0, 1.6, .3, .07, 9, 1);
                dipRef = game.riding;
                dipTime = juice.dipSeconds;
                play(audio, rows.mType[game.riding] === LILY ? "land_lily" : "land_log", player.x - camX);
            }
            else burst(DUST, 4, player.x, player.ry + .03, player.z + .15, 1.1, 1.1, .32, .08, 6, 3);
        }
        if (game.coinTaken) {
            burst(GOLD, 10, player.x, player.ry + .5, player.z, 1.8, 3.2, .5, .09, 7, 1);
            play(audio, "coin", player.x - camX);
        }
        if (dipTime > 0) {
            dipTime = Math.max(0, dipTime - dt);
            dipNow = juice.logDip * Math.sin(Math.PI * (1 - dipTime / juice.dipSeconds));
        } else dipNow = 0;
        if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
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
        placeMovers();
        drawPlayer();
        drawParticles();

        const tx = Math.max(-c.maxTargetX, Math.min(c.maxTargetX, player.rx)) + c.targetOffset[0];
        camX += (tx - camX) * (1 - Math.exp(-c.followRateX * dt));
        camZ += (cameraTarget() - camZ) * (1 - Math.exp(-c.followRateZ * dt));
        placeCamera();

        if (pad.justPressed(Gamepad.L1)) {
            // Debug showcase: every burst type around the chicken, for screenshots.
            const x = player.rx, z = player.rz;
            burst(WHITE, 16, x - 1.3, .5, z, 2.6, 3.6, .9, .12, 5, 2.2);
            burst(RED, 3, x - 1.3, .7, z, 1.6, 3.0, .7, .10, 6, 1.5);
            burst(SPLASH, 18, x + 1.3, .1, z, 1.7, 4.2, .6, .12, 12, .5);
            burst(GOLD, 10, x, .6, z - 1, 1.8, 3.2, .5, .09, 7, 1);
            burst(DUST, 4, x, .1, z + .15, 1.1, 1.1, .32, .08, 6, 3);
        }
        if (pad.justPressed(Gamepad.SELECT)) writeReport();
        if (pad.justPressed(Gamepad.L3)) {
            // Debug reset: the input test uses it to discard any earlier input.
            resetGame(game);
            rows = game.rows;
            clearParticles(particles);
            presses = logged = lastDeaths = lastRestarts = ignoredPresses = 0;
            resetFrame = frame;
            for (let s = 0; s < n; s++) if (rows.dirty[s]) buildSlot(s);
            snapCamera();
        }
    },
    draw() {
        shadowBatch.draw(camera, Render3D.CULL_BACK, lights, shadowStats);
        let tris = shadowStats.triangles, passes = shadowStats.drawPasses;
        let culled = shadowStats.culledObjects, submitted = shadowStats.submittedObjects;
        for (let s = 0; s < n; s++) {
            slotBatch[s].draw(camera, Render3D.CULL_BACK, lights, stats);
            tris += stats.triangles; passes += stats.drawPasses;
            culled += stats.culledObjects; submitted += stats.submittedObjects;
        }
        dynamicBatch.draw(camera, Render3D.CULL_BACK, lights, stats);
        tris += stats.triangles; passes += stats.drawPasses;
        culled += stats.culledObjects; submitted += stats.submittedObjects;
        if (particleBatch.size > 0) {
            particleBatch.draw(camera, Render3D.CULL_BACK, lights, stats);
            tris += stats.triangles; passes += stats.drawPasses;
            culled += stats.culledObjects; submitted += stats.submittedObjects;
        }
        frameStats.triangles = tris;
        frameStats.drawPasses = passes;
        frameStats.culledObjects = culled;
        frameStats.submittedObjects = submitted;
        if (frameStats.triangles > maxTriangles) maxTriangles = frameStats.triangles;
        if (frameStats.drawPasses > maxDrawn) maxDrawn = frameStats.drawPasses;
        if (game.score !== shownScore) { shownScore = game.score; scoreText = "" + shownScore; }
        if (game.top !== shownTop) { shownTop = game.top; topText = "TOP " + shownTop; }
        if (game.coins !== shownCoins) {
            shownCoins = game.coins;
            coinText = "" + shownCoins;
            coinX = mode.width - hud.x - coinFont.getTextSize(coinText).width;
        }
        coinFont.print(coinX, hud.y, coinText);
        scoreFont.print(hud.x, hud.y, scoreText);
        smallFont.print(hud.x, hud.y + hud.fontSize + 4, topText);
        if (autopilot) smallFont.print(autoX, hud.y + hud.coinSize + 8, autoText);
        if (inputLocked) smallFont.print(autoX, hud.y + hud.coinSize + hud.topSize + 14, testText);
        if (canRestart(game) && !autopilot && (frame & 32)) smallFont.print(retryX, height * .86, retryText);
        frame++;
        const time = Loop.getStats(); // Instrumentation allocates one small stats object.
        cpu[cpuNext] = time.cpuMs;
        cpuFrame[cpuNext] = frame;
        cpuNext = (cpuNext + 1) % cpu.length;
        cpuCount++;
    }
}, { clearColor: 0x80dcc662 }); // GS packed RGBA: 98, 198, 220, 128.
