export const GRASS = 0, ROAD = 1, WATER = 2, RAIL = 3;
export const CAR = 0, TRUCK = 1, LOG = 2, LILY = 3;
export const TRAIN_IDLE = 0, TRAIN_WARN = 1, TRAIN_PASS = 2;
export const MAX_MOVERS = 6;
export const POOLS = ["tree", "tree_tall", "rock", "car_purple", "car_cyan", "car_orange",
    "truck", "log2", "log3", "log4", "train_loco", "train_wagon", "signal", "signal_light",
    "lily", "coin"];
const P_TREE = 0, P_TALL = 1, P_ROCK = 2, P_CAR = 3, P_TRUCK = 6, P_LOG = 7, P_LOCO = 10,
    P_WAGON = 11, P_SIGNAL = 12, P_LIGHT = 13, P_LILY = 14, P_COIN = 15;
const BIT0 = 12;

export function createRows(t) {
    const n = t.rows.slots, M = MAX_MOVERS, P = POOLS.length;
    const R = {
        t, n, M,
        z: new Int32Array(n), kind: new Uint8Array(n), alt: new Uint8Array(n),
        marked: new Uint8Array(n), dirty: new Uint8Array(n), lily: new Uint8Array(n),
        hasCoin: new Uint8Array(n), coinX: new Int8Array(n),
        tree: new Uint32Array(n), tall: new Uint32Array(n), rock: new Uint32Array(n),
        vel: new Float32Array(n), count: new Uint8Array(n),
        mType: new Uint8Array(n * M), mx: new Float32Array(n * M), mHalf: new Float32Array(n * M),
        mPool: new Uint8Array(n * M),
        trainState: new Uint8Array(n), trainTimer: new Float32Array(n), trainX: new Float32Array(n),
        trainDir: new Int8Array(n), trainPasses: new Int32Array(n),
        slotUse: new Int16Array(n * P), usage: new Int32Array(P), capacity: new Int32Array(P),
        frontZ: 0, rng: new Random.Generator(t.seed), segKind: GRASS, segLeft: 0, pathX: 0, generated: 0,
    };
    for (let i = 0; i < P; i++) R.capacity[i] = t.pools[POOLS[i]];
    resetRows(R, t.seed);
    return R;
}

export function slotOf(R, z) { return ((z % R.n) + R.n) % R.n; }

export function resetRows(R, seed) {
    beginRows(R, seed);
    stepRows(R, R.n);
}

export function beginRows(R, seed) {
    R.rng.seed(seed >>> 0);
    R.segKind = GRASS;
    R.segLeft = 0;
    R.pathX = R.t.player.start[0];
    R.usage.fill(0);
    R.slotUse.fill(0);
    R.generated = 0;
    const start = R.t.player.start[1], behind = R.n - R.t.rows.ahead - 1;
    R.frontZ = start + behind + 1;
}

export function stepRows(R, count) {
    const last = R.t.player.start[1] - R.t.rows.ahead;
    for (let k = 0; k < count && R.frontZ > last; k++) generateRow(R, --R.frontZ);
    return R.frontZ <= last;
}

export function advanceRows(R, bestZ) {
    let made = 0;
    while (R.frontZ > bestZ - R.t.rows.ahead) {
        generateRow(R, --R.frontZ);
        made++;
    }
    return made;
}

export function difficulty(R, z) {
    const d = (R.t.player.start[1] - z) / R.t.rows.difficultyRows;
    return d < 0 ? 0 : d > 1 ? 1 : d;
}

function rnd(R) { return R.rng.float(); }
function range(R, a) { return R.rng.float(a[0], a[1]); }
function intRange(R, a, b) { return R.rng.int(a, b); }
function hash(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}

function release(R, s) {
    const P = POOLS.length;
    for (let i = 0; i < P; i++) {
        R.usage[i] -= R.slotUse[s * P + i];
        R.slotUse[s * P + i] = 0;
    }
}
function take(R, s, pool) {
    if (R.usage[pool] >= R.capacity[pool]) return false;
    R.usage[pool]++;
    R.slotUse[s * POOLS.length + pool]++;
    return true;
}
function addMover(R, s, type, pool, x, half) {
    const c = R.count[s];
    if (c >= R.M || !take(R, s, pool)) return false;
    const i = s * R.M + c;
    R.mType[i] = type; R.mPool[i] = pool; R.mx[i] = x; R.mHalf[i] = half;
    R.count[s] = c + 1;
    return true;
}

function pickKind(R, d, previous) {
    const w0 = R.t.rows.weights0, w1 = R.t.rows.weights1;
    let total = 0;
    for (let k = 0; k < 4; k++) if (k !== previous) total += w0[k] + (w1[k] - w0[k]) * d;
    let r = rnd(R) * total;
    for (let k = 0; k < 4; k++) {
        if (k === previous) continue;
        r -= w0[k] + (w1[k] - w0[k]) * d;
        if (r <= 0) return k;
    }
    return previous === GRASS ? ROAD : GRASS;
}

function generateRow(R, z) {
    const t = R.t, s = slotOf(R, z);
    release(R, s);
    R.z[s] = z;
    R.dirty[s] = 1;
    R.tree[s] = R.tall[s] = R.rock[s] = 0;
    R.count[s] = 0;
    R.vel[s] = 0;
    R.marked[s] = 0;
    R.lily[s] = 0;
    R.hasCoin[s] = 0;
    R.alt[s] = z & 1;
    R.trainState[s] = TRAIN_IDLE;
    R.generated++;
    const start = t.player.start[1], d = difficulty(R, z);
    let kind;
    if (z > start - 1 - t.rows.startSafe) {
        kind = GRASS;
    } else {
        if (R.segLeft <= 0) {
            R.segKind = pickKind(R, d, R.segKind);
            const len = t.rows.maxLength[R.segKind];
            R.segLeft = intRange(R, len[0], len[1]);
        }
        R.segLeft--;
        kind = R.segKind;
        if (kind === RAIL && !(R.usage[P_LOCO] < R.capacity[P_LOCO] &&
            R.usage[P_WAGON] + t.rail.wagons <= R.capacity[P_WAGON] &&
            R.usage[P_SIGNAL] < R.capacity[P_SIGNAL])) kind = GRASS;
    }
    R.kind[s] = kind;
    if (kind === GRASS) buildGrass(R, s, z, d);
    else if (kind === ROAD) buildRoad(R, s, z, d);
    else if (kind === WATER) buildWater(R, s, z, d);
    else buildRail(R, s, z);
    if ((kind === GRASS || kind === ROAD) && z < start - t.rows.startSafe) placeCoin(R, s);
}

function placeCoin(R, s) {
    const p = R.t.player;
    if (rnd(R) >= R.t.rows.coinChance) return;
    const x = intRange(R, p.minX, p.maxX);
    if (((R.tree[s] | R.rock[s]) & (1 << (x + BIT0))) !== 0) return;
    if (!take(R, s, P_COIN)) return;
    R.hasCoin[s] = 1;
    R.coinX[s] = x;
}

function setObstacle(R, s, x, tall, rock) {
    const bit = 1 << (x + BIT0);
    if (rock) {
        if (!take(R, s, P_ROCK)) return false;
        R.rock[s] |= bit;
    } else {
        if (!take(R, s, tall ? P_TALL : P_TREE)) return false;
        R.tree[s] |= bit;
        if (tall) R.tall[s] |= bit;
    }
    return true;
}

function buildGrass(R, s, z, d) {
    const t = R.t, p = t.player, rows = t.rows, start = p.start[1];
    const wall = z > start;
    if (wall) {
        for (let x = p.minX; x <= p.maxX; x++) setObstacle(R, s, x, rnd(R) < rows.tallChance, false);
    } else if (z < start - rows.startSafe) {
        const next = Math.max(p.minX, Math.min(p.maxX, R.pathX + intRange(R, -1, 1)));
        const lo = Math.min(R.pathX, next), hi = Math.max(R.pathX, next);
        const chance = rows.playableTree[0] + (rows.playableTree[1] - rows.playableTree[0]) * d;
        for (let x = p.minX; x <= p.maxX; x++) {
            if (x >= lo && x <= hi) continue;
            if (rnd(R) < chance) {
                const rock = rnd(R) < rows.rockChance;
                if (!setObstacle(R, s, x, !rock && rnd(R) < rows.tallChance, rock)) break;
            }
        }
        R.pathX = next;
    }
    for (let k = 1; k <= rows.decorX; k++) {
        if (rnd(R) < rows.decorTree) setObstacle(R, s, p.minX - k, rnd(R) < rows.tallChance, false);
        if (rnd(R) < rows.decorTree) setObstacle(R, s, p.maxX + k, rnd(R) < rows.tallChance, false);
    }
}

function buildRoad(R, s, z, d) {
    const t = R.t.traffic, W = t.wrapHalfWidth * 2;
    const truck = rnd(R) < t.truckChance;
    const dir = rnd(R) < .5 ? -1 : 1;
    const half = truck ? t.truckHalfLength : t.carHalfLength;
    R.vel[s] = dir * range(R, truck ? t.truckSpeed : t.carSpeed) * (1 + t.speedBonus * d);
    const count = intRange(R, t.perLane[0], t.perLane[1]);
    const spacing = W / count, jitter = Math.max(0, spacing - 2 * half - 1.6) * .5;
    const offset = rnd(R) * W;
    for (let i = 0; i < count; i++) {
        let x = offset + i * spacing + (rnd(R) * 2 - 1) * jitter;
        x = ((x % W) + W) % W - t.wrapHalfWidth;
        let pool = P_TRUCK;
        if (!truck) {
            pool = P_CAR + intRange(R, 0, 2);
            if (R.usage[pool] >= R.capacity[pool]) pool = P_CAR + (pool - P_CAR + 1) % 3;
        }
        addMover(R, s, truck ? TRUCK : CAR, pool, x, half);
    }
    const ahead = slotOf(R, z + 1);
    if (R.kind[ahead] === ROAD && R.z[ahead] === z + 1) {
        R.marked[ahead] = 1;
        R.dirty[ahead] = 1;
    }
}

function buildWater(R, s, z, d) {
    const t = R.t, rv = t.river, W = t.traffic.wrapHalfWidth * 2;
    if (rnd(R) < rv.lilyChance) {
        R.lily[s] = 1;
        addMover(R, s, LILY, P_LILY, R.pathX, .5);
        const pads = intRange(R, rv.lilyPads[0], rv.lilyPads[1]);
        for (let k = 1; k < pads; k++) {
            const x = intRange(R, t.player.minX, t.player.maxX);
            let free = true;
            for (let i = s * R.M, e = i + R.count[s]; i < e; i++) if (R.mx[i] === x) free = false;
            if (free) addMover(R, s, LILY, P_LILY, x, .5);
        }
        return;
    }
    const behind = slotOf(R, z + 1);
    const previous = R.kind[behind] === WATER && R.z[behind] === z + 1 ? Math.sign(R.vel[behind]) : 0;
    const dir = previous !== 0 ? -previous : (rnd(R) < .5 ? -1 : 1);
    R.vel[s] = dir * range(R, rv.logSpeed) * (1 + .3 * d);
    let cursor = -t.traffic.wrapHalfWidth + rnd(R) * rv.gap[1];
    const end = -t.traffic.wrapHalfWidth + W;
    while (R.count[s] < R.M) {
        const li = intRange(R, 0, rv.logLengths.length - 1), len = rv.logLengths[li];
        if (cursor + len + rv.gap[0] > end) break;
        if (!addMover(R, s, LOG, P_LOG + li, cursor + len / 2, len / 2)) break;
        cursor += len + range(R, rv.gap);
    }
}

function buildRail(R, s, z) {
    const t = R.t;
    take(R, s, P_LOCO);
    for (let i = 0; i < t.rail.wagons; i++) take(R, s, P_WAGON);
    take(R, s, P_SIGNAL);
    take(R, s, P_LIGHT);
    R.trainDir[s] = rnd(R) < .5 ? -1 : 1;
    R.trainPasses[s] = 0;
    R.trainTimer[s] = trainIdle(R, z, 0);
    R.trainX[s] = 0;
}

function trainIdle(R, z, pass) {
    const idle = R.t.rail.idle;
    return idle[0] + (idle[1] - idle[0]) * hash(z, pass);
}

export function trainLength(R) { return R.t.rail.carLength * (R.t.rail.wagons + 1); }

export function updateRows(R, dt) {
    const W = R.t.traffic.wrapHalfWidth * 2, wrap = R.t.traffic.wrapHalfWidth, M = R.M;
    const rail = R.t.rail, length = trainLength(R);
    for (let s = 0; s < R.n; s++) {
        const kind = R.kind[s];
        if (kind === ROAD || kind === WATER) {
            const v = R.vel[s] * dt;
            for (let i = s * M, e = i + R.count[s]; i < e; i++) {
                let x = R.mx[i] + v;
                if (x > wrap) x -= W; else if (x < -wrap) x += W;
                R.mx[i] = x;
            }
        } else if (kind === RAIL) {
            const dir = R.trainDir[s];
            if (R.trainState[s] === TRAIN_PASS) {
                R.trainX[s] += dir * rail.trainSpeed * dt;
                if (R.trainX[s] * dir > wrap + length) {
                    R.trainState[s] = TRAIN_IDLE;
                    R.trainTimer[s] = trainIdle(R, R.z[s], ++R.trainPasses[s]);
                }
            } else {
                R.trainTimer[s] -= dt;
                if (R.trainTimer[s] <= 0) {
                    R.trainState[s] = TRAIN_PASS;
                    R.trainX[s] = -dir * (wrap + length);
                } else if (R.trainTimer[s] <= rail.warning) {
                    R.trainState[s] = TRAIN_WARN;
                }
            }
        }
    }
}

export function rowKind(R, z) {
    const s = slotOf(R, z);
    return R.z[s] === z ? R.kind[s] : -1;
}

export function isBlocked(R, x, z) {
    const s = slotOf(R, z);
    if (R.z[s] !== z) return true;
    if (R.kind[s] !== GRASS) return false;
    const xi = Math.round(x);
    if (xi < -BIT0 || xi > BIT0) return true;
    return ((R.tree[s] | R.rock[s]) & (1 << (xi + BIT0))) !== 0;
}

export function groundY(R, z) {
    const g = R.t.ground, kind = rowKind(R, z);
    if (kind === WATER) return R.lily[slotOf(R, z)] ? g.lilyTop : g.logTop;
    return kind === ROAD ? g.roadY : kind === RAIL ? g.railY : g.grassY;
}

export function takeCoin(R, x, z) {
    const s = slotOf(R, z);
    if (R.z[s] !== z || !R.hasCoin[s] || R.coinX[s] !== Math.round(x)) return false;
    R.hasCoin[s] = 0;
    return true;
}

export function logAt(R, z, x) {
    const s = slotOf(R, z);
    if (R.z[s] !== z || R.kind[s] !== WATER) return -1;
    for (let i = s * R.M, e = i + R.count[s]; i < e; i++) {
        if (Math.abs(x - R.mx[i]) <= R.mHalf[i]) return i;
    }
    return -1;
}

export function hazardAt(R, px, pz) {
    const tr = R.t.traffic, hw = tr.playerHalfWidth;
    const lo = Math.floor(pz), hi = Math.ceil(pz);
    for (let z = lo; z <= hi; z++) {
        const s = slotOf(R, z);
        if (R.z[s] !== z) continue;
        const dz = Math.abs(pz - z);
        if (R.kind[s] === ROAD && dz < tr.halfDepth + tr.playerHalfDepth) {
            for (let i = s * R.M, e = i + R.count[s]; i < e; i++) {
                if (Math.abs(px - R.mx[i]) < R.mHalf[i] + hw) return 1;
            }
        } else if (R.kind[s] === RAIL && R.trainState[s] === TRAIN_PASS &&
            dz < R.t.rail.halfDepth + tr.playerHalfDepth) {
            const front = R.trainX[s], back = front - R.trainDir[s] * trainLength(R);
            if (px + hw > Math.min(front, back) && px - hw < Math.max(front, back)) return 2;
        }
    }
    return 0;
}
