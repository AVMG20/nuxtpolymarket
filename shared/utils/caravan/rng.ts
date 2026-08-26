/**
 * Deterministic PRNG for the caravan simulation.
 *
 * The whole point: server and client run the exact same simulation code over the
 * exact same state, so any roll made during a catch-up tick has to land on the
 * same number on both sides. A stateful counter stored in the save blob gives us
 * that -- `rngCursor` advances with every draw and is persisted alongside the seed.
 */

/** splitmix32 -- fast, well-distributed, and trivial to reproduce. */
export function hash32(x: number): number {
    let z = (x + 0x9e3779b9) | 0
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return (z ^ (z >>> 15)) >>> 0
}

/** Hash a string into a 32-bit seed. Used to derive a stable seed from an id. */
export function hashString(s: string): number {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

export interface Rng {
    /** [0, 1) */
    next(): number
    int(min: number, max: number): number
    pick<T>(items: readonly T[]): T
    chance(p: number): boolean
    /** Current cursor, to write back into the save blob. */
    cursor(): number
}

/**
 * Counter-based generator. Stateless per draw -- the entire generator is
 * described by (seed, cursor), so it survives a round trip through the database.
 */
export function createRng(seed: number, cursor = 0): Rng {
    let c = cursor
    const draw = () => hash32(Math.imul(seed ^ 0x2545f491, 0x85ebca6b) + c++)
    return {
        next: () => draw() / 4294967296,
        int(min, max) {
            return min + Math.floor((draw() / 4294967296) * (max - min + 1))
        },
        pick(items) {
            return items[Math.floor((draw() / 4294967296) * items.length)]!
        },
        chance(p) {
            return draw() / 4294967296 < p
        },
        cursor: () => c
    }
}

/**
 * A throwaway generator seeded from a fixed key. Used for world generation and
 * anything else that must be reproducible without consuming the save cursor.
 */
export function seededRng(...keys: (string | number)[]): Rng {
    let h = 0x811c9dc5
    for (const k of keys) h = Math.imul(h ^ (typeof k === 'string' ? hashString(k) : k >>> 0), 16777619) >>> 0
    return createRng(h)
}
