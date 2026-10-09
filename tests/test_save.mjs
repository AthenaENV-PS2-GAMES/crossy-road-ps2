import assert from 'node:assert/strict';
import {createSave, updateSave} from '../game/save.js';

const PATH = 'mc0:/CHICKENHOP/save.json';
let files, connected, formatted, changed, error, delay, writes;
globalThis.Thread = {readFileAsync: () => ({poll: () => ({state: "done", result: new ArrayBuffer(8)})})};
const job = fn => ({fn, remaining: delay});
globalThis.MemoryCard = {
    getInfo() { const c = changed; changed = false; return {connected, formatted, changed: c, type: connected ? 'ps2' : 'none'}; },
    readJSONAsync(path) { return job(() => { if (!(path in files)) throw {code: 'NOT_FOUND'}; return structuredClone(files[path]); }); },
    createIconSys: options => options,
    writeFileAsync(path, data, options) { return job(() => { assert.equal(options.atomic, true); files[path] = data; writes.push(path); }); },
    writeJSONAsync(path, data, options) { const copy = structuredClone(data); return job(() => { assert.equal(options.atomic, true); files[path] = copy; writes.push(path); }); },
    poll(j) {
        if (j.remaining-- > 0) return {state: 'running'};
        if (!connected || error) return {state: 'failed', error: {code: error || 'NO_CARD'}};
        try { return {state: 'done', result: j.fn()}; } catch (e) { return {state: 'failed', error: e}; }
    },
};
function reset(data) {
    files = data ? {[PATH]: data} : {}; connected = formatted = true; changed = true;
    error = null; delay = 0; writes = [];
}
const game = () => ({top: 0, coins: 0, score: 0, startTop: 0});
const advance = (s, g, n = 12, between = true) => { for (let i = 0; i < n; i++) updateSave(s, g, .1, between); };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }

const die = (s, g) => updateSave(s, g, .1, false, true);
await test('startup and title never write; first death creates icons and progress', async () => {
    reset(); const g = game(), s = createSave(g); advance(s, g, 100);
    assert.equal(writes.length, 0); assert.equal(PATH in files, false);
    die(s, g); advance(s, g);
    assert.deepEqual(files[PATH], {version: 1, top: 0, coins: 0});
    assert.deepEqual(writes, ['mc0:/CHICKENHOP/chicken.icn', 'mc0:/CHICKENHOP/icon.sys', PATH]);
    assert.equal(files['mc0:/CHICKENHOP/icon.sys'].icon, 'chicken.icn');
});
await test('load preserves earned progress but writes it only on death', async () => {
    reset({version: 1, top: 40, coins: 12}); delay = 2;
    const g = game(), s = createSave(g); g.top = g.score = 3; g.coins = 2;
    advance(s, g, 40); assert.deepEqual([g.top, g.coins], [40, 14]);
    assert.equal(writes.length, 0); assert.equal(files[PATH].coins, 12);
    die(s, g); advance(s, g, 40); assert.equal(files[PATH].coins, 14);
});
await test('a new run cannot change a pending death snapshot; next death queues another save', async () => {
    reset(); const g = game(), s = createSave(g); advance(s, g);
    delay = 3; g.top = 5; g.coins = 1; die(s, g);
    g.top = 8; g.coins = 3; advance(s, g, 30, false);
    assert.deepEqual(files[PATH], {version: 1, top: 5, coins: 1});
    g.top = 9; g.coins = 4; die(s, g); advance(s, g, 1, false);
    g.top = 12; g.coins = 5; die(s, g); advance(s, g, 30, false);
    assert.deepEqual(files[PATH], {version: 1, top: 12, coins: 5});
});
await test('death during the initial read keeps its snapshot while merging card coins', async () => {
    reset({version: 1, top: 40, coins: 12}); delay = 2;
    const g = game(), s = createSave(g); g.top = 3; g.coins = 2; die(s, g);
    g.top = 50; g.coins = 4; advance(s, g, 40, false);
    assert.deepEqual([g.top, g.coins], [50, 16]);
    assert.deepEqual(files[PATH], {version: 1, top: 40, coins: 14});
});
await test('no card or unformatted card retries the death snapshot without new-run progress', async () => {
    reset(); connected = false; const g = game(), s = createSave(g);
    g.top = 10; g.coins = 3; die(s, g); advance(s, g, 60);
    assert.equal(writes.length, 0); assert.equal(s.message, 'NO MEMORY CARD');
    g.top = 15; g.coins = 5;
    connected = true; formatted = false; advance(s, g, 60); assert.equal(writes.length, 0);
    formatted = true; advance(s, g, 80);
    assert.deepEqual(files[PATH], {version: 1, top: 10, coins: 3});
});
await test('failed atomic write retains the old save and retries without duplicating coins', async () => {
    reset({version: 1, top: 6, coins: 9}); const g = game(), s = createSave(g); advance(s, g);
    g.coins += 2; error = 'FULL'; die(s, g); advance(s, g, 5);
    assert.equal(files[PATH].coins, 9); assert.equal(s.message, 'MEMORY CARD FULL');
    error = null; advance(s, g, 80); assert.equal(files[PATH].coins, 11);
});
await test('a swapped card is read on death before any writes', async () => {
    reset({version: 1, top: 6, coins: 9}); const g = game(), s = createSave(g); advance(s, g);
    g.top = 14; g.coins += 2;
    files = {[PATH]: {version: 1, top: 20, coins: 30}}; changed = true;
    die(s, g); advance(s, g, 18);
    assert.deepEqual(files[PATH], {version: 1, top: 20, coins: 32});
});
await test('malformed or future save is never overwritten', async () => {
    for (const data of [null, {version: 2, top: 5, coins: 7}, {version: 1, top: 2, coins: -1}, {version: 1, top: '4', coins: 7}]) {
        reset(); files[PATH] = data; const g = game(), s = await createSave(g); advance(s, g, 100);
        assert.equal(writes.length, 0); assert.deepEqual(files[PATH], data); assert.equal(s.blocked, true);
    }
});
await test('live progress, title and remaining dead frames never trigger extra saves', async () => {
    reset(); const g = game(), s = createSave(g); advance(s, g);
    g.top = 4; g.coins = 2; advance(s, g, 100, false); advance(s, g, 100, true);
    assert.equal(writes.length, 0);
    die(s, g); advance(s, g);
    const before = writes.length;
    advance(s, g, 300); assert.equal(writes.length, before);
    g.top = 10; g.coins = 6; advance(s, g, 100, false);
    assert.equal(writes.length, before);
    assert.deepEqual(files[PATH], {version: 1, top: 4, coins: 2});
});
console.log(count + ' save tests passed');
