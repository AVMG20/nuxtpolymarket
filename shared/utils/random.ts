/**
 * Cryptographically secure RNG. Use these instead of Math.random() for anything
 * that decides a payout, a drop, or a game outcome.
 *
 * Math.random() is xorshift128+ in V8: not a CSPRNG, and its state is shared
 * across every request the process serves.
 */

export const TWO_POW_26 = 67108864
export const TWO_POW_53 = 9007199254740992

/** Uniform in [0, 1) with a full 53-bit mantissa — a drop-in for Math.random(). */
export function randomFloat(): number {
    const buf = new Uint32Array(2)
    crypto.getRandomValues(buf)
    return ((buf[0]! >>> 5) * TWO_POW_26 + (buf[1]! >>> 6)) / TWO_POW_53
}

/** Uniform integer in [min, max], inclusive of both ends. */
export function randomInt(min: number, max: number): number {
    return min + Math.floor(randomFloat() * (max - min + 1))
}

/** Uniform element from a non-empty array. */
export function randomPick<T>(items: readonly T[]): T {
    return items[Math.floor(randomFloat() * items.length)]!
}

/** True with probability `chance` (values <= 0 never hit, >= 1 always do). */
export function randomChance(chance: number): boolean {
    return randomFloat() < chance
}

const TWO_POW_32 = 0x100000000

function checkU32(value: number, what: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${what} must be a u32: ${value}`)
    }
}

/**
 * A seeded generator with the same calls as the functions above, for simulations that must replay
 * identically on every machine (a lockstep game, a save that resumes its sequence). Anyone who
 * knows the seed can predict it, so it never decides a payout, a drop or a coin or gem amount.
 * mulberry32: the whole state is one u32.
 */
export class SeededRandom {
    private s: number

    constructor(seed: number) {
        checkU32(seed, 'seed')
        this.s = seed
    }

    /** The generator state; assigning a saved value resumes the exact sequence. */
    get state(): number {
        return this.s
    }

    set state(value: number) {
        checkU32(value, 'state')
        this.s = value
    }

    /** The next u32. */
    next(): number {
        this.s = (this.s + 0x6d2b79f5) >>> 0
        let t = this.s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return (t ^ (t >>> 14)) >>> 0
    }

    /** Uniform in [0, 1) with a full 53-bit mantissa. */
    randomFloat(): number {
        return ((this.next() >>> 5) * TWO_POW_26 + (this.next() >>> 6)) / TWO_POW_53
    }

    /** Uniform integer in [min, max], inclusive, by rejection sampling so no value is favoured. */
    randomInt(min: number, max: number): number {
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
            throw new RangeError(`bad range ${min}..${max}`)
        }
        const span = max - min + 1
        if (span > TWO_POW_32) throw new RangeError(`range ${min}..${max} wider than 2^32`)
        const limit = TWO_POW_32 - TWO_POW_32 % span
        let draw = this.next()
        while (draw >= limit) draw = this.next()
        return min + draw % span
    }

    /** Uniform element from a non-empty array. */
    randomPick<T>(items: readonly T[]): T {
        return items[this.randomInt(0, items.length - 1)]!
    }

    /** True with probability `chance` (values <= 0 never hit, >= 1 always do). */
    randomChance(chance: number): boolean {
        return this.randomFloat() < chance
    }

    /** True with probability numerator / denominator, in integers only, for odds that must not round. */
    randomRatio(numerator: number, denominator: number): boolean {
        if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
            || denominator < 1 || denominator > TWO_POW_32 || numerator < 0) {
            throw new RangeError(`bad chance ${numerator}/${denominator}`)
        }
        return this.randomInt(0, denominator - 1) < numerator
    }
}

/** A seeded generator (see SeededRandom): the same calls as this module's functions, replayable from the seed. */
export function createSeededRandom(seed: number): SeededRandom {
    return new SeededRandom(seed)
}

/**
 * Pick an item with probability proportional to its weight. rng() must be
 * uniform in [0, 1) — the last item is the fallback for that half-open bound,
 * never reachable in practice but keeps the return type total.
 */
export function randomWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: () => number = randomFloat): T {
    const total = items.reduce((sum, item) => sum + weight(item), 0)
    let roll = rng() * total
    for (const item of items) {
        roll -= weight(item)
        if (roll < 0) return item
    }
    return items[items.length - 1]!
}
