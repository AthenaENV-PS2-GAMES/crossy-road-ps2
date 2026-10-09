// Host tests for particles.js: node tests/test_particles.mjs
import assert from "node:assert/strict";
import {createParticles, emit, updateParticles, particleScale, clearParticles, WHITE, GOLD} from "../game/particles.js";

let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS " + name); }

test("emission is limited to the colour's slots and marks a change", () => {
    const P = createParticles([4, 2]);
    assert.equal(emit(P, WHITE, 10, 0, 0, 0, 1, 2, 1, .1, 9.8, 0), 4);
    assert.equal(emit(P, 1, 10, 0, 0, 0, 1, 2, 1, .1, 9.8, 0), 2);
    assert.equal(P.alive, 6);
    assert.ok(P.changed);
    for (let i = 0; i < 4; i++) assert.ok(P.active[i]);
});

test("particles fall, shrink and expire within their life", () => {
    const P = createParticles([8]);
    emit(P, WHITE, 8, 0, 1, 0, 1, 3, .5, .2, 9.8, 1);
    P.changed = false;
    let minScale = 1;
    for (let f = 0; f < 60 && P.alive > 0; f++) {
        updateParticles(P, 1 / 60);
        for (let i = 0; i < P.total; i++) if (P.active[i]) {
            assert.ok(Number.isFinite(P.x[i] + P.y[i] + P.z[i]));
            minScale = Math.min(minScale, particleScale(P, i));
        }
    }
    assert.equal(P.alive, 0);
    assert.ok(P.changed && minScale < .2 * .5);
});

test("clear removes everything at once", () => {
    const P = createParticles([3, 3]);
    emit(P, GOLD - 1, 3, 0, 0, 0, 1, 1, 5, .1, 0, 0);
    clearParticles(P);
    assert.equal(P.alive, 0);
    assert.ok(P.active.every(a => a === 0));
});

console.log(count + " particle tests passed");
