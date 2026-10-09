import {createPlayer, requestMove, resetPlayer, update as updatePlayer, carry, placeX,
    clearQueue, isHopping} from "./player.js";
import {createRows, resetRows, beginRows, stepRows, advanceRows, updateRows, rowKind, isBlocked,
    groundY, logAt, hazardAt, difficulty, slotOf, takeCoin, WATER} from "./rows.js";

export const PLAYING = 0, DEAD = 1, TITLE = 2;
export const CAR_HIT = 1, TRAIN_HIT = 2, DROWNED = 3, SWEPT = 4, EAGLE = 5;
export const MAX_RUNNERS = 2;

export function createGame(t) {
    const game = {
        t, rows: createRows(t), nextRows: createRows(t), nextReady: false, world: null, player: null,
        state: PLAYING, cause: 0, deadTime: 0, deathX: 0, deathZ: 0,
        score: 0, top: 0, startTop: 0, deaths: 0, restarts: 0, run: 0,
        coins: 0, coinTaken: false,
        runners: [], count: 1,
    };
    game.world = {
        isBlocked: (x, z) => isBlocked(game.rows, x, z),
        groundY: z => groundY(game.rows, z),
        isWater: z => rowKind(game.rows, z) === WATER,
        lift: (p, x, z) => headLift(game, p, x, z),
    };
    for (let i = 0; i < MAX_RUNNERS; i++) {
        game.runners.push({
            index: i, player: createPlayer(t.player, game.world), joined: i === 0, alive: true,
            cause: 0, deadTime: 0, deathX: 0, deathZ: 0, riding: -1, scrollZ: 0, score: 0, coinTaken: false,
            mount: -1,
        });
    }
    game.player = game.runners[0].player;
    resetRows(game.rows, runSeed(t, 0));
    newRun(game, 0);
    return game;
}

export function runSeed(t, run) { return (t.seed + Math.imul(run, 7919)) >>> 0; }

function newRun(game, run) {
    game.run = run;
    game.nextReady = false;
    game.state = PLAYING;
    game.cause = 0;
    game.deadTime = 0;
    game.score = 0;
    game.startTop = game.top;
    for (const r of game.runners) {
        resetPlayer(r.player);
        r.alive = r.joined;
        r.cause = 0;
        r.deadTime = 0;
        r.riding = -1;
        r.scrollZ = game.t.player.start[1];
        r.score = 0;
        r.coinTaken = false;
        r.mount = -1;
    }
}

export function resetGame(game) {
    resetRows(game.rows, runSeed(game.t, 0));
    newRun(game, 0);
    game.top = game.deaths = game.restarts = game.coins = 0;
}

export function setPlayers(game, count) {
    const t = game.t.player, gap = game.t.multi.startGap;
    game.count = count;
    for (const r of game.runners) {
        r.joined = r.index < count;
        r.player.startX = count === 1 ? t.start[0] : t.start[0] + (r.index === 0 ? -gap : gap);
        if (game.state === DEAD) continue;
        resetPlayer(r.player);
        r.alive = r.joined;
    }
}

export function showTitle(game) {
    game.state = TITLE;
}

export function newTop(game) {
    return game.score > game.startTop;
}

export function canRestart(game) {
    const t = game.t;
    const delay = game.cause === EAGLE ? t.eagle.swoopSeconds + t.eagle.carrySeconds : t.death.restartDelay;
    return game.state === DEAD && game.deadTime >= delay;
}

export function aliveCount(game) {
    let k = 0;
    for (let i = 0; i < MAX_RUNNERS; i++) if (game.runners[i].alive) k++;
    return k;
}

function headLift(game, p, x, z) {
    if (game.count < 2) return 0;
    for (let i = 0; i < MAX_RUNNERS; i++) {
        const r = game.runners[i], q = r.player;
        if (q === p || !r.alive || isHopping(q) || (r.mount >= 0 && game.runners[r.mount].player === p)) continue;
        if (q.z === z && Math.abs(q.x - x) < .5) return game.t.multi.headHeight;
    }
    return 0;
}

function die(game, r, cause) {
    const p = r.player;
    r.alive = false;
    r.mount = -1;
    r.cause = cause;
    r.deadTime = 0;
    r.deathX = p.rx;
    r.deathZ = p.rz;
    r.riding = -1;
    clearQueue(p);
    game.deaths++;
    game.cause = cause;
    game.deathX = r.deathX;
    game.deathZ = r.deathZ;
    for (let i = 0; i < MAX_RUNNERS; i++) {
        const o = game.runners[i];
        if (o.alive && o.mount === r.index) die(game, o, cause);
    }
    if (game.state === DEAD || aliveCount(game) > 0) return;
    game.state = DEAD;
    game.deadTime = 0;
    beginRows(game.nextRows, runSeed(game.t, game.run + 1));
}

function ride(game, r, dir) {
    const b = game.runners[r.mount], p = r.player, q = b.player;
    p.landed = false;
    if (dir >= 0 && !isHopping(q)) {
        p.x = q.x;
        p.z = q.z;
        r.mount = -1;
        requestMove(p, dir);
        if (isHopping(p)) return;
        r.mount = b.index;
    }
    p.x = q.x; p.z = q.z;
    p.rx = q.rx; p.rz = q.rz; p.ry = q.ry + game.t.multi.headHeight;
    p.scaleY = 1;
}

function sameCell(p, q) { return p.z === q.z && Math.abs(p.x - q.x) < .5; }

function move(game, r, dt, dir) {
    const t = game.t, p = r.player, rows = game.rows;
    if (r.mount >= 0) { ride(game, r, dir); return true; }
    if (r.riding >= 0 && !isHopping(p)) {
        carry(p, rows.vel[slotOf(rows, p.z)] * dt);
        if (Math.abs(p.x) > t.river.carryLimitX) { die(game, r, SWEPT); return false; }
    }
    if (dir >= 0) requestMove(p, dir);
    updatePlayer(p, dt);
    if (isHopping(p)) r.riding = -1;
    if (p.landed) {
        r.riding = -1;
        const o = game.count > 1 ? game.runners[1 - r.index] : null;
        if (o !== null && o.alive && !isHopping(o.player) && o.mount !== r.index && sameCell(p, o.player)) {
            r.mount = o.index;
            ride(game, r, -1);
            return true;
        }
        if (takeCoin(rows, p.x, p.z)) { game.coins++; game.coinTaken = r.coinTaken = true; }
        if (rowKind(rows, p.z) === WATER) {
            const i = logAt(rows, p.z, p.x);
            if (i < 0) { die(game, r, DROWNED); return false; }
            const first = rows.mx[i] - rows.mHalf[i] + .5, last = rows.mx[i] + rows.mHalf[i] - .5;
            const k = Math.round(p.x - first);
            placeX(p, Math.max(first, Math.min(last, first + k)));
            r.riding = i;
        }
    }
    return true;
}

function hazards(game, r, other, dt) {
    const t = game.t, p = r.player, rows = game.rows;
    const hazard = hazardAt(rows, p.rx, p.rz);
    if (hazard !== 0) { die(game, r, hazard === 2 ? TRAIN_HIT : CAR_HIT); return; }
    const e = t.eagle, d = difficulty(rows, p.bestZ);
    r.scrollZ -= (e.scrollSpeed[0] + (e.scrollSpeed[1] - e.scrollSpeed[0]) * d) * dt;
    if (p.rz < r.scrollZ) r.scrollZ = p.rz;
    const trailing = other !== null && other.alive && p.z - other.player.z > t.multi.maxGap;
    if (p.rz - r.scrollZ > e.margin || p.z - p.bestZ >= e.backLimit || trailing) die(game, r, EAGLE);
}

export function updateGame(game, dt, dir, restart, dir2 = -1) {
    const t = game.t, rows = game.rows, runners = game.runners;
    game.coinTaken = false;
    for (let i = 0; i < MAX_RUNNERS; i++) {
        const r = runners[i];
        r.coinTaken = false;
        if (!r.alive && r.joined) r.deadTime += dt;
    }
    updateRows(rows, dt);
    if (game.state === TITLE) {
        if (!restart && dir < 0 && dir2 < 0) return;
        game.state = PLAYING;
    }
    if (game.state === DEAD) {
        game.deadTime += dt;
        if (!game.nextReady) game.nextReady = stepRows(game.nextRows, t.rows.prepareRows);
        if ((restart || dir >= 0 || dir2 >= 0) && canRestart(game)) {
            if (!game.nextReady) stepRows(game.nextRows, game.nextRows.n);
            const used = game.rows;
            game.rows = game.nextRows;
            game.nextRows = used;
            newRun(game, game.run + 1);
            game.restarts++;
        }
        return;
    }
    let moved = false;
    const first = runners[0].mount >= 0 ? 1 : 0;
    for (let k = 0; k < MAX_RUNNERS; k++) {
        const i = k === 0 ? first : 1 - first;
        if (runners[i].alive && move(game, runners[i], dt, i === 0 ? dir : dir2)) moved = true;
    }
    if (!moved) return;
    let best = t.player.start[1];
    for (let i = 0; i < MAX_RUNNERS; i++) {
        const r = runners[i];
        if (!r.joined) continue;
        if (r.player.bestZ < best) best = r.player.bestZ;
        r.score = t.player.start[1] - r.player.bestZ;
        if (r.score > game.score) game.score = r.score;
    }
    advanceRows(rows, best);
    if (game.score > game.top) game.top = game.score;
    for (let i = 0; i < MAX_RUNNERS; i++) {
        if (runners[i].alive) hazards(game, runners[i], game.count > 1 ? runners[1 - i] : null, dt);
    }
}
