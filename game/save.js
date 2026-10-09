const DIR = "mc0:/CHICKENHOP";
const ICON = "chicken.icn";
const VALID = n => Number.isSafeInteger(n) && n >= 0;

// Only one card job at a time. Polling never waits for IOP transfers.
export function createSave(game, directory = DIR) {
    const s = { directory, path: directory + "/save.json", status: "loading", message: "LOADING", job: null, phase: "",
        baseCoins: 0, savedTop: -1, savedCoins: -1, snapshot: null,
        ready: false, retry: 0, pending: null, checked: false, iconsInstalled: false, blocked: false, icon: null };
    try {
        s.job = Thread.readFileAsync("save/" + ICON);
        s.phase = "asset";
    } catch (e) {
        fail(s, e);
        s.blocked = true;
        return s;
    }
    return s;
}

function fail(s, e) {
    s.job = null;
    s.ready = false;
    s.status = "error";
    const code = e && e.code;
    s.message = code === "NO_CARD" ? "NO MEMORY CARD" :
        code === "FULL" ? "MEMORY CARD FULL" :
        code === "UNFORMATTED" ? "CARD NOT FORMATTED" : "SAVE ERROR";
    s.retry = 5;
    console.log("Memory card: " + (code || (e && e.message) || "unavailable"));
}

function connect(s) {
    try {
        const info = MemoryCard.getInfo(0);
        if (!info.connected || !info.formatted || info.type !== "ps2") {
            fail(s, { code: !info.connected ? "NO_CARD" : "UNFORMATTED" });
            return;
        }
        s.job = MemoryCard.readJSONAsync(s.path);
        s.phase = "load";
        s.status = "loading";
    } catch (e) { fail(s, e); }
}

function install(s) {
    s.job = MemoryCard.writeFileAsync(s.directory + "/" + ICON, s.icon, { atomic: true });
    s.phase = "icon";
    s.status = "saving";
}

function loaded(s, game, data, missing = false) {
    if (!missing && (!data || data.version !== 1 || !VALID(data.top) || !VALID(data.coins))) {
        // Never replace a save whose format/content we could not read.
        fail(s, new Error("Invalid save data"));
        s.blocked = true;
        s.message = "SAVE DATA ERROR";
        return;
    }
    const top = missing ? 0 : data.top, coins = missing ? 0 : data.coins;
    const earned = Math.max(0, game.coins - s.baseCoins);
    game.top = Math.max(game.top, top);
    game.coins = coins + earned;
    game.startTop = Math.max(game.startTop, top);
    if (s.pending) s.pending = {
        version: 1, top: Math.max(s.pending.top, top),
        coins: coins + Math.max(0, s.pending.coins - s.baseCoins),
    };
    s.baseCoins = coins;
    s.savedTop = top;
    s.savedCoins = coins;
    s.ready = true;
    s.checked = true;
    s.iconsInstalled = false;
    s.status = "ready";
}

export function updateSave(s, game, dt, between, died = false) {
    // Capture the end of the run immediately, even while loading or writing. Later
    // progress in a restarted run must not enter this save.
    if (died) {
        s.pending = { version: 1, top: game.top, coins: game.coins };
        s.checked = false;
    }
    if (s.job) {
        try {
            const result = s.phase === "asset" ? s.job.poll() : MemoryCard.poll(s.job);
            if (result.state === "running") return;
            s.job = null;
            if (result.state !== "done") {
                if (s.phase === "load" && result.error && result.error.code === "NOT_FOUND") loaded(s, game, null, true);
                else {
                    fail(s, result.error);
                    if (s.phase === "asset" || (s.phase === "load" && result.error instanceof SyntaxError)) {
                        s.blocked = true;
                        s.message = "SAVE DATA ERROR";
                    }
                }
                return;
            }
            if (s.phase === "asset") {
                s.icon = result.result;
                connect(s);
            } else if (s.phase === "load") loaded(s, game, result.result);
            else if (s.phase === "icon") {
                s.job = MemoryCard.writeFileAsync(s.directory + "/icon.sys", MemoryCard.createIconSys({
                    title: "CHICKEN HOP\nRECORD AND COINS", icon: ICON,
                    background: [[98, 198, 220], [98, 198, 220], [180, 230, 100], [180, 230, 100]],
                }), { atomic: true });
                s.phase = "sys";
            } else if (s.phase === "sys") {
                s.iconsInstalled = true;
                s.status = "ready";
            } else {
                s.savedTop = s.snapshot.top;
                s.savedCoins = s.snapshot.coins;
                s.baseCoins = s.snapshot.coins;
                if (s.pending === s.snapshot) s.pending = null;
                s.status = "ready";
            }
        } catch (e) { fail(s, e); }
        return;
    }
    if (!s.ready) {
        s.retry -= dt;
        if (!s.blocked && between && s.retry <= 0) connect(s);
        return;
    }
    if (!s.pending) return;
    if (!s.checked) {
        try {
            const info = MemoryCard.getInfo(0);
            if (info.changed || !info.connected || !info.formatted) {
                s.ready = false;
                connect(s);
                return;
            }
            s.checked = true;
        } catch (e) { fail(s, e); return; }
    }
    try {
        if (!s.iconsInstalled) { install(s); return; }
        s.snapshot = s.pending;
        s.job = MemoryCard.writeJSONAsync(s.path, s.snapshot, { atomic: true });
        s.phase = "save";
        s.status = "saving";
    } catch (e) { fail(s, e); }
}
