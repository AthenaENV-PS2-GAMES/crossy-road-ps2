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
    const streams = {};
    for (const name of ["title", "ambience"]) {
        try {
            const s = new Sound.Stream("music/" + name + ".wav");
            s.loop = true;
            streams[name] = s;
        } catch (e) {
            failed = failed || name + ": " + (e.code || e.message);
        }
    }
    if (failed) console.log("audio disabled for some files (" + failed + ")");
    Sound.setSfxVolume(a.volume);
    return { sfx, streams, a, played: 0, track: "" };
}

export function track(audio, name) {
    if (audio.track === name) return;
    const a = audio.a, old = audio.streams[audio.track], next = audio.streams[name];
    audio.track = name;
    if (!next) { if (old) old.pause({ fade: a.fadeMs }); return; }
    Sound.setVolume(a.streamVolume[name]);
    next.play({ fade: a.fadeMs });
}

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

export function falloff(audio, rows) {
    const a = audio.a, d = Math.abs(rows);
    return d <= a.near ? 1 : d >= a.far ? 0 : 1 - (d - a.near) / (a.far - a.near);
}
