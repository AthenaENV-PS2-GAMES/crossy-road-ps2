// Grid hop logic. Pure: no engine globals, no allocations after creation.
// Forward (UP) is -Z. x is fractional only while riding a log; hops onto
// solid rows snap it back to the integer grid.
// world: {isBlocked(x, z), groundY(z), isWater(z), lift?(p, x, z)}; lift is the
// height of another player standing on (x, z), whose head p would land on.
export const UP = 0, DOWN = 1, LEFT = 2, RIGHT = 3;
const DX = [0, 0, -1, 1], DZ = [-1, 1, 0, 0];
const IDLE = 0, HOP = 1, BUMP = 2;

export function createPlayer(t, world) {
    const p = {
        t, world, startX: t.start[0], // startX: set per player in two-player games.
        x: 0, z: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
        mode: IDLE, elapsed: 0, dir: UP, queued: -1,
        hops: 0, bumps: 0, bestZ: 0, landed: false,
        rx: 0, ry: 0, rz: 0, scaleY: 1, yaw: t.yaw.up,
    };
    resetPlayer(p);
    return p;
}

export function resetPlayer(p) {
    p.x = p.startX;
    p.z = p.bestZ = p.t.start[1];
    p.mode = IDLE;
    p.elapsed = 0;
    p.queued = -1;
    p.hops = p.bumps = 0;
    p.landed = false;
    p.yaw = p.t.yaw.up;
    pose(p);
}

export function isBusy(p) { return p.mode !== IDLE; }
export function isHopping(p) { return p.mode === HOP; }

// One buffered input: a press during a hop replaces any earlier queued one.
export function requestMove(p, dir) {
    if (p.mode !== IDLE) p.queued = dir;
    else start(p, dir, 0);
}

export function clearQueue(p) { p.queued = -1; }

// Moves the player sideways with a log while standing on it.
export function carry(p, dx) {
    p.x += dx;
    if (p.mode !== HOP) pose(p);
}

// Places the player at x on its row (used to snap onto a log slot).
export function placeX(p, x) {
    p.x = x;
    pose(p);
}

function start(p, dir, carry) {
    const t = p.t, w = p.world, tz = p.z + DZ[dir];
    const toWater = w.isWater(tz);
    let tx = DX[dir] !== 0 ? p.x + DX[dir] : p.x;
    if (!toWater) tx = Math.round(tx);
    p.dir = dir;
    p.yaw = dir === UP ? t.yaw.up : dir === DOWN ? t.yaw.down : dir === LEFT ? t.yaw.left : t.yaw.right;
    p.elapsed = carry;
    p.fromX = p.toX = p.x;
    p.fromZ = p.toZ = p.z;
    const limit = toWater ? .5 : 0;
    if (tx < t.minX - limit || tx > t.maxX + limit || w.isBlocked(tx, tz)) {
        p.mode = BUMP;
        p.bumps++;
    } else {
        p.mode = HOP;
        p.toX = tx;
        p.toZ = tz;
    }
}

// Advances the hop; p.landed is true on the update where a hop finished.
export function update(p, dt) {
    p.landed = false;
    if (p.mode !== IDLE) {
        p.elapsed += dt;
        const duration = p.mode === HOP ? p.t.hopSeconds : p.t.bumpSeconds;
        if (p.elapsed >= duration) {
            const carry = p.elapsed - duration;
            if (p.mode === HOP) {
                p.x = p.toX;
                p.z = p.toZ;
                p.hops++;
                p.landed = true;
                if (p.z < p.bestZ) p.bestZ = p.z;
            }
            p.mode = IDLE;
            p.elapsed = 0;
            // A landing hands control to game.js first (logs, water), which
            // may clear the queue; the queued hop starts on the next update.
            if (p.queued >= 0 && !p.landed) {
                const dir = p.queued;
                p.queued = -1;
                start(p, dir, Math.min(carry, p.t.hopSeconds * .5));
            }
        }
    } else if (p.queued >= 0) {
        const dir = p.queued;
        p.queued = -1;
        start(p, dir, 0);
    }
    pose(p);
}

function lift(p, x, z) { return p.world.lift ? p.world.lift(p, x, z) : 0; }

function pose(p) {
    const t = p.t, w = p.world;
    if (p.mode === HOP) {
        const u = p.elapsed / t.hopSeconds;
        const fromY = w.groundY(p.fromZ) + lift(p, p.fromX, p.fromZ), toY = w.groundY(p.toZ) + lift(p, p.toX, p.toZ);
        p.rx = p.fromX + (p.toX - p.fromX) * u;
        p.rz = p.fromZ + (p.toZ - p.fromZ) * u;
        p.ry = fromY + (toY - fromY) * u + 4 * t.hopHeight * u * (1 - u);
        p.scaleY = u < .2 ? t.squash + (1 - t.squash) * (u / .2) :
            u > .85 ? 1 - (1 - t.squash) * ((u - .85) / .15) : 1;
    } else {
        p.rx = p.x;
        p.rz = p.z;
        p.ry = w.groundY(p.z) + lift(p, p.x, p.z);
        p.scaleY = p.mode === BUMP ?
            1 - (1 - t.squash) * .6 * Math.sin(Math.PI * p.elapsed / t.bumpSeconds) : 1;
    }
}
