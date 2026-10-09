// Core loop over procedural rows: playing, the five deaths, restart, score.
// Pure: no engine globals; no allocation per update.
import {createPlayer, requestMove, resetPlayer, update as updatePlayer, carry, placeX,
    clearQueue, isHopping} from "./player.js";
import {createRows, resetRows, beginRows, stepRows, advanceRows, updateRows, rowKind, isBlocked,
    groundY, logAt, hazardAt, difficulty, slotOf, takeCoin, WATER} from "./rows.js";

export const PLAYING = 0, DEAD = 1, TITLE = 2;
export const CAR_HIT = 1, TRAIN_HIT = 2, DROWNED = 3, SWEPT = 4, EAGLE = 5;

export function createGame(t) {
    // Two row buffers: the next run's window is generated while the death
    // screen shows, then swapped in on restart (no generation spike).
    const game = {
        t, rows: createRows(t), nextRows: createRows(t), nextReady: false, world: null, player: null,
        state: PLAYING, cause: 0, deadTime: 0, deathX: 0, deathZ: 0,
        score: 0, top: 0, startTop: 0, deaths: 0, restarts: 0, run: 0,
        riding: -1, scrollZ: 0,
        coins: 0, coinTaken: false, // Session total; coinTaken is true on the collecting update.
    };
    game.world = {
        isBlocked: (x, z) => isBlocked(game.rows, x, z),
        groundY: z => groundY(game.rows, z),
        isWater: z => rowKind(game.rows, z) === WATER,
    };
    game.player = createPlayer(t.player, game.world);
    resetRows(game.rows, runSeed(t, 0));
    newRun(game, 0);
    return game;
}

export function runSeed(t, run) { return (t.seed + Math.imul(run, 7919)) >>> 0; }

// Starts run `run` on game.rows, which must already hold that run's window.
function newRun(game, run) {
    game.run = run;
    game.nextReady = false;
    resetPlayer(game.player);
    game.state = PLAYING;
    game.cause = 0;
    game.deadTime = 0;
    game.score = 0;
    game.startTop = game.top; // Best before this run, for the game-over "NEW TOP".
    game.riding = -1;
    game.scrollZ = game.t.player.start[1];
}

// Debug/test reset: first run's seed again; clears the session best.
export function resetGame(game) {
    resetRows(game.rows, runSeed(game.t, 0));
    newRun(game, 0);
    game.top = game.deaths = game.restarts = game.coins = 0;
}

// Title screen over the first run's rows: traffic moves, the eagle waits;
// any direction or restart button starts the run (a direction also hops).
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

function die(game, cause) {
    const p = game.player;
    game.state = DEAD;
    game.cause = cause;
    game.deadTime = 0;
    game.deathX = p.rx;
    game.deathZ = p.rz;
    game.deaths++;
    game.riding = -1;
    clearQueue(p);
    beginRows(game.nextRows, runSeed(game.t, game.run + 1));
}

// dir: -1 for none, otherwise a player.js direction. restart: any restart button.
export function updateGame(game, dt, dir, restart) {
    const t = game.t, p = game.player;
    const rows = game.rows;
    game.coinTaken = false;
    updateRows(rows, dt);
    if (game.state === TITLE) {
        if (!restart && dir < 0) return;
        game.state = PLAYING;
    }
    if (game.state === DEAD) {
        game.deadTime += dt;
        if (!game.nextReady) game.nextReady = stepRows(game.nextRows, t.rows.prepareRows);
        if ((restart || dir >= 0) && canRestart(game)) {
            if (!game.nextReady) stepRows(game.nextRows, game.nextRows.n);
            const used = game.rows;
            game.rows = game.nextRows;
            game.nextRows = used;
            newRun(game, game.run + 1);
            game.restarts++;
        }
        return;
    }
    if (game.riding >= 0 && !isHopping(p)) {
        carry(p, rows.vel[slotOf(rows, p.z)] * dt);
        if (Math.abs(p.x) > t.river.carryLimitX) { die(game, SWEPT); return; }
    }
    if (dir >= 0) requestMove(p, dir);
    updatePlayer(p, dt);
    if (isHopping(p)) game.riding = -1;
    if (p.landed) {
        game.riding = -1;
        if (takeCoin(rows, p.x, p.z)) { game.coins++; game.coinTaken = true; }
        if (rowKind(rows, p.z) === WATER) {
            const i = logAt(rows, p.z, p.x);
            if (i < 0) { die(game, DROWNED); return; }
            // Snap to the centre of the log cell under the landing point.
            const first = rows.mx[i] - rows.mHalf[i] + .5, last = rows.mx[i] + rows.mHalf[i] - .5;
            const k = Math.round(p.x - first);
            placeX(p, Math.max(first, Math.min(last, first + k)));
            game.riding = i;
        }
    }
    advanceRows(rows, p.bestZ);
    game.score = t.player.start[1] - p.bestZ;
    if (game.score > game.top) game.top = game.score;

    const hazard = hazardAt(rows, p.rx, p.rz);
    if (hazard !== 0) { die(game, hazard === 2 ? TRAIN_HIT : CAR_HIT); return; }

    // Camera pressure: the scroll line advances on its own and is pushed by
    // the player; falling too far behind it, or too far behind the best row,
    // brings the eagle.
    const e = t.eagle, d = difficulty(rows, p.bestZ);
    game.scrollZ -= (e.scrollSpeed[0] + (e.scrollSpeed[1] - e.scrollSpeed[0]) * d) * dt;
    if (p.rz < game.scrollZ) game.scrollZ = p.rz;
    if (p.rz - game.scrollZ > e.margin || p.z - p.bestZ >= e.backLimit) die(game, EAGLE);
}
