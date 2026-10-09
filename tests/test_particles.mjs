import assert from 'node:assert/strict';
import {createParticles, emit, updateParticles, drawParticles, clearParticles, WHITE} from '../game/particles.js';

// Contract double: native integration/rendering are exercised in PCSX2.
globalThis.Image = class { lock() { assert.equal(this.pixels.byteLength, 16); } };
globalThis.Color = {new: (...rgba) => rgba};
globalThis.Particles3D = {Emitter: class {
    constructor(image, options) { this.options = options; this.count = 0; this.updates = 0; this.draws = 0; }
    configure(options) { this.options = {...this.options, ...options}; return this; }
    setPosition(...position) { this.position = position; return this; }
    emit(count) { const n = Math.min(count, this.options.capacity - this.count); this.count += n; return n; }
    update(dt) { this.updates++; this.dt = dt; }
    draw(camera) { this.draws++; this.camera = camera; return this.count; }
    clear() { this.count = 0; }
}};
const P = createParticles([4, 2]);
assert.equal(emit(P, WHITE, 10, 1, 2, 3, 1, 2, .5, .1, 9.8, 1), 4);
assert.equal(emit(P, 1, 10, 0, 0, 0, 1, 2, .5, .1, 9.8, 1), 2);
assert.equal(P.alive, 6);
assert.deepEqual(P.emitters[0].position, [1, 2, 3]);
assert.deepEqual(P.emitters[0].options.gravity, [0, -9.8, 0]);
assert.deepEqual(P.emitters[0].options.life, [.375, .625]);
const a = {}, b = {};
updateParticles(P, 1 / 60);
assert.equal(drawParticles(P, a), 6); assert.equal(drawParticles(P, b), 6);
for (const e of P.emitters) {
    assert.equal(e.updates, 1); assert.equal(e.draws, 2); assert.equal(e.camera, b);
}
clearParticles(P);
assert.equal(P.alive, 0); assert.equal(drawParticles(P, a), 0);
console.log('PASS native particle adapter: pools, bursts, gravity, split view, clear');
