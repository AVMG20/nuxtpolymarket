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
