// Copy this file into the deployed game directory and set default_script to it.
// Uses its own save directory; does not alter the player's CHICKENHOP save.
import {createSave, updateSave} from './save.js';
import {createParticles, emit, updateParticles, drawParticles, clearParticles, WHITE} from './particles.js';

const DIR = 'mc0:/CHICKENHOP_TEST';
const result = {checks: [], passed: false};
function check(ok, name) { if (!ok) throw new Error(name); result.checks.push(name); }
function report() {
    const f = std.open('native-smoke.json', 'w');
    f.puts(JSON.stringify(result, null, 2)); f.close();
}
try {
    const mode = Screen.getMode(); mode.zbuffering = true; mode.psmz = Screen.Z16S; Screen.setMode(mode);
    const info = MemoryCard.getInfo(0);
    check(info.connected && info.formatted, 'formatted PS2 memory card');
    const rng = new Random.Generator(20261009);
    result.random = [rng.float(), rng.float(), rng.float()];
    const other = new Random.Generator(20261009);
    check(result.random.every(v => v === other.float()), 'native Random reproducibility');
    const particles = createParticles([8]);
    check(emit(particles, WHITE, 12, 0, 1, 0, 1, 2, .5, .1, 9.8, 1) === 8, 'native particle capacity');
    const cam = new Camera3D.Camera(); cam.setPosition(0, 1, 5).lookAt(0, 1, 0);
    const mesh = Model3D.load('models/chicken.obj');
    const model = mesh.createInstance(); mesh.dispose();
    Tween3D.to(model, {position: [1, 0, 0]}, .25, {ease: 'linear'});
    let g = {top: 17, coins: 23, score: 0, startTop: 0};
    const save = createSave(g, DIR);
    let phase = 0, frames = 0, rendered = 0, reload = null, loadGame = null;
    Loop.run({
        update(dt) {
            if (result.finished) return;
            try {
                frames++;
                updateParticles(particles, dt); Tween3D.advance(dt);
                updateSave(save, g, dt, true, frames === 60);
                if (save.status === 'error') throw new Error(save.message);
                if (phase === 0 && frames > 90 && save.ready && !save.job && save.savedTop === g.top) {
                    check(particles.alive === 0, 'native particles expire');
                    check(rendered > 0, 'native billboard draw'); clearParticles(particles);
                    const m = model.getPosition();
                    check(Math.abs(m[0] - 1) < .001, 'native Tween3D reaches its target');
                    const data = MemoryCard.readJSON(DIR + '/save.json');
                    check(data.top === g.top && data.coins === g.coins, 'record and coins written to real card');
                    check(MemoryCard.stat(DIR + '/chicken.icn').size === 47512, 'chicken icon installed');
                    check(MemoryCard.stat(DIR + '/icon.sys').size === 964, 'icon.sys installed');
                    loadGame = {top: 0, coins: 0, score: 0, startTop: 0}; reload = createSave(loadGame, DIR); phase = 1;
                    result.saved = data;
                }
                if (phase === 1) {
                    updateSave(reload, loadGame, dt, true);
                    if (reload.status === 'error') throw new Error(reload.message);
                    if (reload.ready && !reload.job) {
                        check(loadGame.top === result.saved.top && loadGame.coins === result.saved.coins,
                            'record and coins reloaded through game integration');
                        result.passed = result.finished = true; report();
                    }
                }
                if (frames > 1800) throw new Error('native test timeout');
            } catch (e) { result.error = String(e); result.finished = true; report(); }
        },
        draw() { if (!result.finished) rendered += drawParticles(particles, cam); }
    }, {clearColor: 0x80dcc662});
} catch (e) { result.error = String(e); result.finished = true; report(); }
