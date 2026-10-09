export const WHITE = 0, SPLASH = 1, GOLD = 2, DUST = 3, RED = 4;
export const COLORS = ["particle_white", "particle_splash", "particle_gold", "particle_dust", "particle_red"];

export function createParticles(counts) {
    let total = 0;
    const first = new Int32Array(counts.length + 1);
    for (let c = 0; c < counts.length; c++) { first[c] = total; total += counts[c]; }
    first[counts.length] = total;
    return {
        total, first,
        x: new Float32Array(total), y: new Float32Array(total), z: new Float32Array(total),
        vx: new Float32Array(total), vy: new Float32Array(total), vz: new Float32Array(total),
        life: new Float32Array(total), maxLife: new Float32Array(total),
        size: new Float32Array(total), gravity: new Float32Array(total), drag: new Float32Array(total),
        active: new Uint8Array(total), alive: 0, changed: false, seed: 1,
    };
}

function rnd(P) {
    let x = P.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    P.seed = x;
    return x / 4294967296;
}

export function emit(P, color, count, x, y, z, spread, up, life, size, gravity, drag) {
    let made = 0;
    for (let i = P.first[color]; i < P.first[color + 1] && made < count; i++) {
        if (P.active[i]) continue;
        const a = rnd(P) * Math.PI * 2, r = spread * (.4 + .6 * rnd(P));
        P.x[i] = x; P.y[i] = y; P.z[i] = z;
        P.vx[i] = Math.cos(a) * r;
        P.vz[i] = Math.sin(a) * r;
        P.vy[i] = up * (.6 + .4 * rnd(P));
        P.maxLife[i] = P.life[i] = life * (.75 + .5 * rnd(P));
        P.size[i] = size * (.7 + .6 * rnd(P));
        P.gravity[i] = gravity;
        P.drag[i] = drag;
        P.active[i] = 1;
        made++;
    }
    if (made > 0) { P.alive += made; P.changed = true; }
    return made;
}

export function updateParticles(P, dt) {
    if (P.alive === 0) return;
    for (let i = 0; i < P.total; i++) {
        if (!P.active[i]) continue;
        P.life[i] -= dt;
        if (P.life[i] <= 0) {
            P.active[i] = 0;
            P.alive--;
            P.changed = true;
            continue;
        }
        const k = 1 - P.drag[i] * dt;
        P.vx[i] *= k; P.vz[i] *= k;
        P.vy[i] = P.vy[i] * k - P.gravity[i] * dt;
        P.x[i] += P.vx[i] * dt;
        P.y[i] += P.vy[i] * dt;
        P.z[i] += P.vz[i] * dt;
    }
}

export function particleScale(P, i) {
    const u = P.life[i] / P.maxLife[i];
    return P.size[i] * (u > .4 ? 1 : u / .4);
}

export function clearParticles(P) {
    if (P.alive === 0) return;
    P.active.fill(0);
    P.alive = 0;
    P.changed = true;
}
