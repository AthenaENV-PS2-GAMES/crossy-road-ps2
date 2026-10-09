export const WHITE = 0, SPLASH = 1, GOLD = 2, DUST = 3, RED = 4;
const RGB = [[250, 245, 245], [155, 225, 255], [255, 214, 40], [180, 153, 100], [250, 56, 69]];

export function createParticles(counts) {
    const image = new Image();
    image.bpp = 32;
    image.texWidth = image.texHeight = 2;
    image.pixels = new Uint8Array(16).fill(255).buffer;
    image.lock();
    const emitters = counts.map((capacity, i) => new Particles3D.Emitter(image, {
        capacity, rate: 0, color: Color.new(...RGB[i], 128), seed: i + 1,
    }));
    return { image, emitters, total: counts.reduce((a, b) => a + b, 0),
        get alive() { return emitters.reduce((n, e) => n + e.count, 0); } };
}

export function emit(P, color, count, x, y, z, spread, up, life, size, gravity, drag) {
    const speed = Math.hypot(spread, up);
    return P.emitters[color].configure({
        life: [life * .75, life * 1.25], speed: [speed * .6, speed],
        direction: [0, 1, 0], spread: Math.atan2(spread, up),
        gravity: [0, -gravity, 0], drag, size: [size * 2, 0],
    }).setPosition(x, y, z).emit(count);
}
export function updateParticles(P, dt) { for (const e of P.emitters) e.update(dt); }
export function drawParticles(P, camera) { return P.emitters.reduce((n, e) => n + e.draw(camera), 0); }
export function clearParticles(P) { for (const e of P.emitters) e.clear(); }
