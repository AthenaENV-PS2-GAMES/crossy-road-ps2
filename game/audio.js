// Sound effects: SPU2 ADPCM samples from sfx/ (tools/make_sfx.py), played
// with a pan from the source's screen position. Audio is optional: if a
// sample cannot be loaded the game runs silently instead of stopping.
const NAMES = ["hop", "bump", "land_log", "land_lily", "coin", "squash", "splash", "bell", "train",
    "eagle", "restart"];

export function createAudio(t) {
    const sfx = {}, a = t.audio;
    let failed = null;
    for (const name of NAMES) {
        try {
            sfx[name] = new Sound.Sfx("sfx/" + name + ".adp");
        } catch (e) {
            failed = failed || name + ": " + (e.code || e.message);
        }
    }
    if (failed) console.log("audio disabled for some samples (" + failed + ")");
    Sound.setSfxVolume(a.volume);
    return { sfx, a, played: 0 };
}

// x: world X of the source relative to the camera target; volume 0..1.
export function play(audio, name, x, volume) {
    const s = audio.sfx[name];
    if (!s) return;
    const a = audio.a;
    const pan = Math.max(-1, Math.min(1, x / a.panWidth)) * a.panMax;
    s.pan = Math.round(pan);
    const v = (volume === undefined ? 1 : volume) * (a.gain[name] || 1);
    s.volume = Math.round(100 * Math.max(0, Math.min(1, v)));
    if (s.volume > 0 && s.play() >= 0) audio.played++;
}

// Volume for a source `rows` rows away from the player: full nearby, silent at `far`.
export function falloff(audio, rows) {
    const a = audio.a, d = Math.abs(rows);
    return d <= a.near ? 1 : d >= a.far ? 0 : 1 - (d - a.near) / (a.far - a.near);
}
