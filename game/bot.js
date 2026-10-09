// Autopilot for soak tests (R1 in main.js). Predicts movers a short time
// ahead and only hops onto cells that stay safe. Pure, no allocations.
import {UP, DOWN, LEFT, RIGHT} from "./player.js";
import {GRASS, ROAD, WATER, RAIL, TRAIN_IDLE, slotOf, rowKind, isBlocked} from "./rows.js";

export function createBot(t) {
    return {t, wait: 0};
}

// Danger on row z at x during [t0, t1] seconds from now.
function roadSafe(R, z, x, t0, t1) {
    const s = slotOf(R, z), tr = R.t.traffic, v = R.vel[s];
    for (let i = s * R.M, e = i + R.count[s]; i < e; i++) {
        const reach = R.mHalf[i] + tr.playerHalfWidth + .25;
        for (let tt = t0; tt <= t1; tt += .05) {
            if (Math.abs(x - (R.mx[i] + v * tt)) < reach) return false;
        }
    }
    return true;
}

function logUnder(R, z, x, at) {
    const s = slotOf(R, z), v = R.vel[s];
    for (let i = s * R.M, e = i + R.count[s]; i < e; i++) {
        if (Math.abs(x - (R.mx[i] + v * at)) <= R.mHalf[i] - .25) return true;
    }
    return false;
}

function cellSafe(game, x, z, arrive) {
    const R = game.rows, t = game.t, kind = rowKind(R, z);
    if (kind < 0 || isBlocked(R, x, z)) return false;
    if (kind === GRASS) return true;
    if (kind === ROAD) return roadSafe(R, z, x, Math.max(0, arrive - .1), arrive + .55);
    if (kind === RAIL) {
        const s = slotOf(R, z);
        return R.trainState[s] === TRAIN_IDLE && R.trainTimer[s] > t.rail.warning + arrive + .4;
    }
    const s = slotOf(R, z);
    return logUnder(R, z, x, arrive) &&
        Math.abs(x + R.vel[s] * (arrive + .8)) < t.river.carryLimitX - .4;
}

function target(game, dir) {
    const p = game.player, R = game.rows;
    const tz = p.z + (dir === UP ? -1 : dir === DOWN ? 1 : 0);
    let tx = p.x + (dir === LEFT ? -1 : dir === RIGHT ? 1 : 0);
    if (rowKind(R, tz) !== WATER) tx = Math.round(tx);
    return tx;
}

function canGo(game, dir) {
    const p = game.player, t = game.t.player;
    const tz = p.z + (dir === UP ? -1 : dir === DOWN ? 1 : 0), tx = target(game, dir);
    const water = rowKind(game.rows, tz) === WATER;
    if (tx < t.minX - (water ? .5 : 0) || tx > t.maxX + (water ? .5 : 0)) return false;
    return cellSafe(game, tx, tz, t.hopSeconds);
}

// Returns a direction, or -1 to wait. Call only while the player is idle.
export function botMove(bot, game) {
    const p = game.player, R = game.rows;
    if (canGo(game, UP)) return UP;
    const here = rowKind(R, p.z);
    let stay;
    if (here === WATER) {
        const s = slotOf(R, p.z);
        stay = Math.abs(p.x + R.vel[s] * .7) < game.t.river.carryLimitX - .5;
    } else {
        stay = cellSafe(game, p.x, p.z, 0);
    }
    // Drift back towards the centre while waiting on grass.
    if (stay && here === GRASS && Math.abs(p.x) > 1) {
        const side = p.x > 0 ? LEFT : RIGHT;
        if (canGo(game, side)) return side;
    }
    if (stay) return -1;
    const first = p.x > 0 ? LEFT : RIGHT, second = first === LEFT ? RIGHT : LEFT;
    if (canGo(game, first)) return first;
    if (canGo(game, second)) return second;
    if (canGo(game, DOWN)) return DOWN;
    return -1;
}
