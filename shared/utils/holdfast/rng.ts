// Seeded PRNG (mulberry32) so a run replays identically from its seed: the
// map, the waves and the balance script all derive from it. Holdfast pays
// nothing, so the server-issued seed is enough — nothing here decides value.

export type Rng = () => number

export function createRng(seed: number): Rng {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function rngRange(rng: Rng, min: number, max: number): number {
    return min + rng() * (max - min)
}

export function rngInt(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1))
}
