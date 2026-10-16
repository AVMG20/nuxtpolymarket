import * as secure from '#shared/utils/random'

/**
 * The Hackerz engine's randomness. In play every roll comes from the secure
 * shared RNG, exactly as before. A Database demo board alone swaps in a
 * seeded generator while it simulates (`withSeed`), so its script plays out
 * the same way every loop: same board, same routes, same rolls.
 *
 * Never seed a board that pays out — the demo board banks nothing.
 */

let seeded: (() => number) | null = null

/** mulberry32: small, fast and plenty for a replayable demo. */
export function seededRng(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Runs `fn` with every engine roll drawn from `rng`, then hands back the secure one. */
export function withSeed<T>(rng: () => number, fn: () => T): T {
    const previous = seeded
    seeded = rng
    try {
        return fn()
    } finally {
        seeded = previous
    }
}

export function randomFloat(): number {
    return seeded ? seeded() : secure.randomFloat()
}

export function randomInt(min: number, max: number): number {
    return min + Math.floor(randomFloat() * (max - min + 1))
}

/** Uniform in [min, max). */
export function randomBetween(min: number, max: number): number {
    return min + randomFloat() * (max - min)
}

export function randomChance(chance: number): boolean {
    return randomFloat() < chance
}
