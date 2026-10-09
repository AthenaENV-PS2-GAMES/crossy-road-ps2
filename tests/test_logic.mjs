// Host tests for player.js against a small fake world: node tests/test_logic.mjs
import assert from "node:assert/strict";
import {tuning} from "../game/tuning.js";
import {createPlayer, requestMove, resetPlayer, update, isBusy, carry, UP, DOWN, LEFT, RIGHT}
    from "../game/player.js";

const DT = 1 / 60;
const t = tuning.player;
const blocked = new Set(["3,0"]), water = new Set([-2]);
const world = {
    isBlocked: (x, z) => blocked.has(Math.round(x) + "," + z) || z > 0,
    groundY: z => water.has(z) ? .10 : .065,
    isWater: z => water.has(z),
};
const fresh = () => createPlayer(t, world);
const run = (p, frames) => { for (let i = 0; i < frames; i++) update(p, DT); };
let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS " + name); }

test("one hop moves one cell forward in hopSeconds", () => {
    const p = fresh();
    requestMove(p, UP);
    const frames = Math.round(t.hopSeconds / DT);
    run(p, frames - 1);
    assert.equal(p.z, 0);
    run(p, 2);
    assert.deepEqual([p.z, p.hops, isBusy(p)], [-1, 1, false]);
});

test("arc peaks near hopHeight and lands with landed=true once", () => {
    const p = fresh();
    requestMove(p, UP);
    let peak = 0, landings = 0;
    for (let i = 0; i < 20; i++) { update(p, DT); peak = Math.max(peak, p.ry); if (p.landed) landings++; }
    assert.ok(peak > .065 + t.hopHeight * .9);
    assert.equal(landings, 1);
});

test("blocked cell and wall behind the start bump without moving", () => {
    const p = fresh();
    for (let i = 0; i < 3; i++) { requestMove(p, RIGHT); run(p, 30); }
    assert.deepEqual([p.x, p.z, p.hops, p.bumps], [2, 0, 2, 1]);
    requestMove(p, DOWN); run(p, 30);
    assert.deepEqual([p.z, p.bumps], [0, 2]);
});

test("buffered press runs right after landing (one update later)", () => {
    const p = fresh();
    requestMove(p, UP);
    run(p, 3);
    requestMove(p, LEFT);
    let landedAt = -1, secondAt = -1;
    for (let i = 0; i < 40; i++) {
        update(p, DT);
        if (p.landed && landedAt < 0) landedAt = i;
        else if (p.landed && secondAt < 0) secondAt = i;
    }
    assert.deepEqual([p.x, p.z, p.hops], [-1, -1, 2]);
    assert.ok(secondAt - landedAt <= Math.round(t.hopSeconds / DT) + 1);
});

test("x stays fractional towards water and snaps towards land", () => {
    const p = fresh();
    requestMove(p, UP); run(p, 20);         // z = -1
    carry(p, .4);                            // as if on a log
    requestMove(p, UP); run(p, 20);         // into water row -2: keeps x
    assert.ok(Math.abs(p.x - .4) < 1e-6);
    requestMove(p, RIGHT); run(p, 20);      // sideways along the water row
    assert.ok(Math.abs(p.x - 1.4) < 1e-6);
    requestMove(p, UP); run(p, 20);         // onto land: rounded
    assert.deepEqual([p.x, p.z], [1, -3]);
});

test("random input never leaves bounds or enters a blocked cell", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    const p = fresh();
    for (let i = 0; i < 100000; i++) {
        if (rnd() < .2) requestMove(p, Math.floor(rnd() * 4));
        update(p, DT * (.5 + rnd()));
        if (!world.isWater(p.z)) {
            assert.equal(p.x, Math.round(p.x));
            assert.ok(p.x >= t.minX && p.x <= t.maxX);
        }
        assert.equal(world.isBlocked(p.x, p.z), false);
        assert.ok(Number.isFinite(p.rx + p.ry + p.rz + p.scaleY));
    }
});

test("reset restores start cell, counters and pending input", () => {
    const p = fresh();
    requestMove(p, UP); run(p, 3); requestMove(p, LEFT);
    resetPlayer(p);
    run(p, 60);
    assert.deepEqual([p.x, p.z, p.hops, p.bumps, p.bestZ], [...t.start, 0, 0, t.start[1]]);
});

console.log(count + " player tests passed");
