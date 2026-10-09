// Host tests for the M4 game rules: node tests/test_game.mjs
import assert from "node:assert/strict";
import {tuning} from "../game/tuning.js";
import {UP, DOWN} from "../game/player.js";
import {slotOf, rowKind, resetRows, GRASS, ROAD, WATER, RAIL, LOG, LILY, CAR, TRAIN_PASS} from "../game/rows.js";
import {createGame, updateGame, resetGame, canRestart, runSeed, showTitle, newTop, PLAYING, DEAD, TITLE,
    CAR_HIT, TRAIN_HIT, DROWNED, SWEPT, EAGLE} from "../game/game.js";

const DT = 1 / 60;
let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS " + name); }
const step = (g, frames, dir = -1, restart = false) => {
    for (let i = 0; i < frames; i++) updateGame(g, DT, i === 0 ? dir : -1, i === 0 && restart);
};
const hop = (g, dir) => step(g, 12, dir);

// Overwrite row z for a scenario (pool accounting is irrelevant here).
function force(g, z, kind, vel = 0, movers = []) {
    const R = g.rows, s = slotOf(R, z);
    R.kind[s] = kind; R.tree[s] = R.rock[s] = R.tall[s] = 0;
    R.vel[s] = vel; R.count[s] = movers.length;
    movers.forEach(([type, x, half], j) => {
        R.mType[s * R.M + j] = type; R.mx[s * R.M + j] = x; R.mHalf[s * R.M + j] = half;
    });
    return s;
}

test("title screen waits without the eagle, then a hop starts the run", () => {
    const g = createGame(tuning);
    showTitle(g);
    step(g, 60 * 30);
    assert.equal(g.state, TITLE);
    assert.equal(g.deaths, 0);
    assert.equal(g.scrollZ, tuning.player.start[1]);
    hop(g, UP);
    assert.equal(g.state, PLAYING);
    assert.equal(g.player.z, tuning.player.start[1] - 1);
});

test("title screen: X starts without hopping; new top is per run", () => {
    const g = createGame(tuning);
    showTitle(g);
    step(g, 1, -1, true);
    assert.equal(g.state, PLAYING);
    assert.equal(g.player.hops, 0);
    assert.equal(newTop(g), false);
    hop(g, UP);
    assert.equal(newTop(g), g.score > 0);
});

test("landing in open water drowns", () => {
    const g = createGame(tuning);
    force(g, -1, WATER, 1, []);
    hop(g, UP);
    assert.deepEqual([g.state, g.cause], [DEAD, DROWNED]);
});

test("landing on a log snaps to a log cell and rides with it", () => {
    const g = createGame(tuning);
    const s = force(g, -1, WATER, 1, [[LOG, .3, 1.5]]);
    hop(g, UP);
    assert.equal(g.state, PLAYING);
    assert.equal(g.riding, s * g.rows.M);
    const log = g.rows.mx[s * g.rows.M];
    const offset = g.player.x - (log - 1.5 + .5);
    assert.ok(Math.abs(offset - Math.round(offset)) < 1e-4, "on a cell centre, offset " + offset);
    const x0 = g.player.x;
    step(g, 60);
    assert.ok(Math.abs(g.player.x - x0 - 1) < .02, "moved " + (g.player.x - x0));
});

test("riding past the edge sweeps the player away", () => {
    const g = createGame(tuning);
    force(g, -1, WATER, 3, [[LOG, 0, 2]]);
    hop(g, UP);
    step(g, 60 * 3);
    assert.deepEqual([g.state, g.cause], [DEAD, SWEPT]);
    assert.ok(Math.abs(g.deathX) > tuning.river.carryLimitX);
});

test("hopping from a log onto land snaps x to the grid", () => {
    const g = createGame(tuning);
    force(g, -1, WATER, .9, [[LOG, 0, 2]]);
    force(g, -2, GRASS);
    hop(g, UP);
    step(g, 20);
    assert.ok(g.player.x % 1 !== 0);
    hop(g, UP);
    assert.equal(g.state, PLAYING);
    assert.equal(g.player.x, Math.round(g.player.x));
    assert.equal(g.player.z, -2);
});

test("a car on the landing cell kills", () => {
    const g = createGame(tuning);
    force(g, -1, ROAD, 0, [[CAR, 0, tuning.traffic.carHalfLength]]);
    hop(g, UP);
    assert.deepEqual([g.state, g.cause], [DEAD, CAR_HIT]);
});

test("a passing train kills; an idle rail is safe", () => {
    const g = createGame(tuning);
    const s = force(g, -1, RAIL);
    g.rows.trainState[s] = 0; g.rows.trainTimer[s] = 30;
    hop(g, UP);
    assert.equal(g.state, PLAYING);
    const h = createGame(tuning);
    const t = force(h, -1, RAIL);
    h.rows.trainState[t] = TRAIN_PASS; h.rows.trainDir[t] = 1; h.rows.trainX[t] = 3;
    hop(h, UP);
    assert.deepEqual([h.state, h.cause], [DEAD, TRAIN_HIT]);
});

test("idling brings the eagle after margin / scroll speed", () => {
    const g = createGame(tuning);
    let frames = 0;
    while (g.state === PLAYING && frames < 60 * 60) { step(g, 1); frames++; }
    const expected = tuning.eagle.margin / tuning.eagle.scrollSpeed[0];
    assert.equal(g.cause, EAGLE);
    assert.ok(Math.abs(frames / 60 - expected) < .1, frames / 60 + " vs " + expected);
});

test("going backLimit rows behind the best row brings the eagle", () => {
    const g = createGame(tuning);
    for (let z = -1; z >= -5; z--) force(g, z, GRASS);
    for (let i = 0; i < 5; i++) hop(g, UP);
    for (let i = 0; i < tuning.eagle.backLimit - 1; i++) hop(g, DOWN);
    assert.equal(g.state, PLAYING);
    hop(g, DOWN);
    assert.deepEqual([g.state, g.cause], [DEAD, EAGLE]);
});

test("score counts rows; restart starts a new seeded run and keeps TOP", () => {
    const g = createGame(tuning);
    for (let z = -1; z >= -3; z--) force(g, z, GRASS);
    for (let i = 0; i < 3; i++) hop(g, UP);
    assert.equal(g.score, 3);
    force(g, -4, WATER, 1, []);
    hop(g, UP);
    assert.equal(g.state, DEAD);
    step(g, 1, -1, true);
    assert.equal(g.state, DEAD, "restart waits for the delay");
    step(g, Math.ceil(tuning.death.restartDelay * 60));
    assert.ok(canRestart(g));
    step(g, 1, -1, true);
    assert.deepEqual([g.state, g.score, g.top, g.run, g.restarts], [PLAYING, 0, 3, 1, 1]);
    assert.notEqual(runSeed(tuning, 1), runSeed(tuning, 0));
});

test("eagle death waits for the swoop before restart is allowed", () => {
    const g = createGame(tuning);
    while (g.state === PLAYING) step(g, 1);
    step(g, Math.ceil(tuning.death.restartDelay * 60) + 1);
    assert.equal(canRestart(g), false);
    step(g, Math.ceil((tuning.eagle.swoopSeconds + tuning.eagle.carrySeconds) * 60));
    assert.ok(canRestart(g));
});

test("debug reset regenerates run 0 exactly", () => {
    const a = createGame(tuning), b = createGame(tuning);
    for (let i = 0; i < 4; i++) hop(b, UP);
    resetGame(b);
    const kinds = g => { let k = ""; for (let z = 0; z > -16; z--) k += rowKind(g.rows, z); return k; };
    assert.equal(kinds(b), kinds(a));
    assert.deepEqual([b.run, b.top, b.deaths], [0, 0, 0]);
});

test("lily pad: safe landing, no drift; next to it is open water", () => {
    const g = createGame(tuning);
    const s = force(g, -1, WATER, 0, [[LILY, 0, .5]]);
    g.rows.lily[s] = 1;
    hop(g, UP);
    step(g, 120);
    assert.deepEqual([g.state, g.player.x, g.player.z], [PLAYING, 0, -1]);
    assert.equal(g.player.ry, tuning.ground.lilyTop);
    hop(g, 3); // RIGHT: no pad there
    assert.deepEqual([g.state, g.cause], [DEAD, DROWNED]);
});

test("landing on a coin collects it once and keeps the session total", () => {
    const g = createGame(tuning);
    const s = force(g, -1, GRASS);
    g.rows.hasCoin[s] = 1; g.rows.coinX[s] = 0;
    let flagged = 0;
    for (let i = 0; i < 12; i++) { updateGame(g, DT, i === 0 ? UP : -1, false); if (g.coinTaken) flagged++; }
    assert.deepEqual([g.coins, flagged, g.rows.hasCoin[s]], [1, 1, 0]);
    hop(g, DOWN); hop(g, UP);
    assert.equal(g.coins, 1);
});

test("next run is prepared during the death screen and swapped in on restart", () => {
    const g = createGame(tuning), first = g.rows;
    force(g, -1, WATER, 1, []);
    hop(g, UP);
    assert.equal(g.state, DEAD);
    step(g, Math.ceil(tuning.death.restartDelay * 60) + 2);
    assert.ok(g.nextReady, "prepared within the restart delay");
    const prepared = g.nextRows;
    step(g, 1, -1, true);
    assert.equal(g.rows, prepared);
    assert.equal(g.nextRows, first);
    // The swapped-in window equals a direct generation of run 1.
    const kinds = R => { let k = ""; for (let z = 0; z > -16; z--) k += rowKind(R, z); return k; };
    const R1 = createGame(tuning).rows;
    resetRows(R1, runSeed(tuning, 1));
    assert.equal(kinds(g.rows), kinds(R1));
});

console.log(count + " game tests passed");
