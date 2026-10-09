// Host reference of AthenaEnv's splitmix64/xoshiro128** implementation.
// Used only by Node tests; the game always uses the native Random module.
const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
class Generator {
    constructor(seed) { this.seed(seed); }
    seed(seed) {
        let x = BigInt(seed);
        const next = () => {
            x = (x + 0x9e3779b97f4a7c15n) & MASK;
            let z = x;
            z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
            z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
            return z ^ (z >> 31n);
        };
        const a = next(), b = next();
        this.s = [Number(a & 0xffffffffn), Number(a >> 32n), Number(b & 0xffffffffn), Number(b >> 32n)];
    }
    u32() {
        const s = this.s, result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0, t = s[1] << 9;
        s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t;
        s[3] = rotl(s[3], 11);
        return result;
    }
    float(min, max) {
        const value = (this.u32() >>> 8) / 16777216;
        if (min === undefined) return value;
        if (max === undefined) { max = min; min = 0; }
        min = Math.fround(min); max = Math.fround(max);
        return Math.fround(min + Math.fround(Math.fround(max - min) * value));
    }
    int(min, max) {
        const bound = max - min + 1;
        const threshold = (4294967296 - bound) % bound;
        let m;
        do { m = BigInt(this.u32()) * BigInt(bound); } while (Number(m & 0xffffffffn) < threshold);
        return min + Number(m >> 32n);
    }
}
globalThis.Random = { Generator };
