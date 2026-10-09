import "./native_random.mjs";
import assert from "node:assert/strict";
import {tuning} from "../game/tuning.js";
import {createRows, resetRows, advanceRows, updateRows, slotOf, rowKind, isBlocked, logAt,
    hazardAt, trainLength, takeCoin, POOLS, GRASS, ROAD, WATER, RAIL, LILY, TRAIN_IDLE, TRAIN_WARN,
    TRAIN_PASS}
    from "../game/rows.js";

const summaryIndex = process.argv.indexOf("--summary");
if (summaryIndex > 0) {
    const R = createRows(tuning);
    resetRows(R, Number(process.argv[summaryIndex + 1]));
    let kinds = "";
    const masks = [];
    for (let z = R.frontZ; z < R.frontZ + R.n; z++) {
        const s = slotOf(R, z);
        kinds += "GRWT"[R.kind[s]];
        masks.push(R.tree[s] | R.rock[s]);
    }
    console.log(JSON.stringify({frontZ: R.frontZ, kinds, masks}));
    process.exit(0);
}

let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS " + name); }
const fresh = (seed = tuning.seed) => { const R = createRows(tuning); resetRows(R, seed); return R; };
const snapshot = R => {
    const out = [];
    for (let z = R.frontZ; z < R.frontZ + R.n; z++) {
        const s = slotOf(R, z);
        out.push([R.kind[s], R.tree[s], R.rock[s], R.count[s], R.vel[s]].join(":"));
    }
    return out.join("|");
};

test("same seed gives the same rows; another seed differs", () => {
    assert.equal(snapshot(fresh(5)), snapshot(fresh(5)));
    assert.notEqual(snapshot(fresh(5)), snapshot(fresh(6)));
    const R = fresh(5);
    advanceRows(R, -40);
    const S = fresh(5);
    for (let z = -1; z >= -40; z--) advanceRows(S, z);
    assert.equal(snapshot(R), snapshot(S));
});

test("window holds n contiguous rows around the player", () => {
    const R = fresh();
    for (let best = 0; best >= -500; best--) {
        advanceRows(R, best);
        assert.equal(R.frontZ, best - tuning.rows.ahead);
        for (let z = R.frontZ; z < R.frontZ + R.n; z++) assert.equal(R.z[slotOf(R, z)], z);
    }
});

test("start area: grass, free playable start rows, wall behind", () => {
    const R = fresh(), p = tuning.player;
    for (let z = 0; z >= -tuning.rows.startSafe; z--) {
        assert.equal(rowKind(R, z), GRASS);
        for (let x = p.minX; x <= p.maxX; x++) assert.equal(isBlocked(R, x, z), false);
    }
    for (let x = p.minX; x <= p.maxX; x++) assert.equal(isBlocked(R, x, 1), true);
});

test("a free path always crosses every grass row (5 seeds x 1500 rows)", () => {
    const p = tuning.player;
    for (let seed = 1; seed <= 5; seed++) {
        const R = fresh(seed);
        let reach = new Set([0]);
        for (let z = -1; z >= -1500; z--) {
            advanceRows(R, z + tuning.rows.ahead - 1);
            const sz = slotOf(R, z);
            if (rowKind(R, z) === WATER && R.lily[sz]) {
                const pads = new Set();
                for (let i = sz * R.M; i < sz * R.M + R.count[sz]; i++) pads.add(R.mx[i]);
                const next = new Set([...reach].filter(x => pads.has(x)));
                for (let changed = true; changed;) {
                    changed = false;
                    for (const x of Array.from(next)) for (const nx of [x - 1, x + 1]) {
                        if (pads.has(nx) && !next.has(nx)) { next.add(nx); changed = true; }
                    }
                }
                assert.ok(next.size > 0, "seed " + seed + " no reachable pad at row " + z);
                reach = next;
                continue;
            }
            if (rowKind(R, z) !== GRASS) {
                reach = new Set(Array.from({length: p.maxX - p.minX + 1}, (_, i) => p.minX + i));
                continue;
            }
            const next = new Set();
            for (const x of reach) if (!isBlocked(R, x, z)) next.add(x);
            for (let changed = true; changed;) {
                changed = false;
                for (const x of Array.from(next)) for (const nx of [x - 1, x + 1]) {
                    if (nx >= p.minX && nx <= p.maxX && !next.has(nx) && !isBlocked(R, nx, z)) {
                        next.add(nx); changed = true;
                    }
                }
            }
            assert.ok(next.size > 0, "seed " + seed + " blocked at row " + z);
            reach = next;
        }
    }
});

test("pool usage never exceeds capacity and matches row contents", () => {
    const R = fresh(77);
    let kinds = [0, 0, 0, 0];
    for (let best = 0; best >= -3000; best--) {
        advanceRows(R, best);
        for (let i = 0; i < POOLS.length; i++) assert.ok(R.usage[i] <= R.capacity[i], POOLS[i]);
    }
    const pop = v => { let c = 0; for (; v; v &= v - 1) c++; return c; };
    let trees = 0;
    for (let s = 0; s < R.n; s++) {
        kinds[R.kind[s]]++;
        trees += pop(R.tree[s] & ~R.tall[s]);
    }
    assert.equal(trees, R.usage[POOLS.indexOf("tree")]);
});

test("row mix: every kind appears often over 400 rows", () => {
    const R = fresh(3), seen = [0, 0, 0, 0];
    for (let best = 0; best >= -400; best--) {
        advanceRows(R, best);
        seen[rowKind(R, R.frontZ)]++;
    }
    assert.ok(seen.every(c => c > 10), seen.join(","));
});

test("movers wrap and keep their spacing", () => {
    const R = fresh(11);
    for (let i = 0; i < 60 * 30; i++) updateRows(R, 1 / 60);
    for (let s = 0; s < R.n; s++) {
        if (R.kind[s] !== ROAD && R.kind[s] !== WATER) continue;
        for (let i = s * R.M; i < s * R.M + R.count[s]; i++) {
            assert.ok(Math.abs(R.mx[i]) <= tuning.traffic.wrapHalfWidth);
        }
    }
});

test("logs: logAt finds the log under x and nothing in open water", () => {
    let R, z;
    for (let seed = 1; ; seed++) {
        R = fresh(seed);
        for (z = 0; z > R.frontZ && rowKind(R, z) !== WATER; z--);
        if (z > R.frontZ) break;
    }
    const s = slotOf(R, z), i = s * R.M;
    assert.equal(logAt(R, z, R.mx[i]), i);
    assert.equal(logAt(R, z, R.mx[i] + R.mHalf[i] + .05), -1);
});

test("train cycles idle, warning, passing and is deadly only while passing", () => {
    let R, z;
    for (let seed = 1; ; seed++) {
        R = fresh(seed);
        for (z = 0; z > R.frontZ && rowKind(R, z) !== RAIL; z--);
        if (z > R.frontZ) break;
    }
    const s = slotOf(R, z), states = new Set();
    let hit = false;
    for (let i = 0; i < 60 * 20; i++) {
        updateRows(R, 1 / 60);
        states.add(R.trainState[s]);
        const danger = hazardAt(R, 0, z);
        if (R.trainState[s] !== TRAIN_PASS) assert.equal(danger === 2, false);
        if (danger === 2) hit = true;
    }
    assert.ok(states.has(TRAIN_IDLE) && states.has(TRAIN_WARN) && states.has(TRAIN_PASS));
    assert.ok(hit, "train crossed x=0");
    assert.equal(trainLength(R), tuning.rail.carLength * (tuning.rail.wagons + 1));
});

test("lily rows: still, integer pads inside the playable columns, path pad present", () => {
    const R = fresh(21), p = tuning.player;
    let lilyRows = 0;
    for (let best = 0; best >= -1500; best--) {
        advanceRows(R, best);
        const s = slotOf(R, R.frontZ);
        if (R.kind[s] !== WATER || !R.lily[s]) continue;
        lilyRows++;
        assert.equal(R.vel[s], 0);
        assert.ok(R.count[s] >= 1);
        for (let i = s * R.M; i < s * R.M + R.count[s]; i++) {
            assert.equal(R.mType[i], LILY);
            assert.equal(R.mx[i], Math.round(R.mx[i]));
            assert.ok(R.mx[i] >= p.minX && R.mx[i] <= p.maxX);
        }
    }
    assert.ok(lilyRows > 20, "lily rows " + lilyRows);
});

test("coins sit on free playable grass/road cells and are taken once", () => {
    const R = fresh(31), p = tuning.player;
    let coins = 0;
    for (let best = 0; best >= -1500; best--) {
        advanceRows(R, best);
        const z = R.frontZ, s = slotOf(R, z);
        if (!R.hasCoin[s]) continue;
        coins++;
        assert.ok(R.kind[s] === GRASS || R.kind[s] === ROAD);
        assert.ok(R.coinX[s] >= p.minX && R.coinX[s] <= p.maxX);
        assert.equal(isBlocked(R, R.coinX[s], z), false);
        assert.equal(takeCoin(R, R.coinX[s] + 1, z), false);
        assert.equal(takeCoin(R, R.coinX[s], z), true);
        assert.equal(takeCoin(R, R.coinX[s], z), false);
    }
    assert.ok(coins > 60, "coins " + coins);
});

console.log(count + " row tests passed");
