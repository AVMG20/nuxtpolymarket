/**
 * Deterministic PRNG for battler runs (§12.5): every draw derives from the
 * run's server-held secret, so a run replays identically from its inputs.
 * mulberry32 — same algorithm the Pathwarden map generator uses.
 */

export interface BattlerRandom {
    readonly state: number
    next: () => number
    integer: (minimum: number, maximum: number) => number
    pick: <T>(values: readonly T[]) => T
    shuffle: <T>(values: readonly T[]) => T[]
}

function normalizeSeed(seed: number) {
    if (!Number.isFinite(seed)) throw new Error('Battler seed must be finite')
    return Math.floor(seed) >>> 0
}

export function createBattlerRandom(seed: number): BattlerRandom {
    let state = normalizeSeed(seed)
    return {
        get state() {
            return state >>> 0
        },
        next() {
            state = state + 0x6D2B79F5 | 0
            let value = Math.imul(state ^ state >>> 15, 1 | state)
            value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
            return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
        },
        integer(minimum, maximum) {
            if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
                throw new Error('Battler random integer bounds are invalid')
            }
            return minimum + Math.floor(this.next() * (maximum - minimum + 1))
        },
        pick<T>(values: readonly T[]) {
            if (!values.length) throw new Error('Cannot pick from an empty collection')
            return values[this.integer(0, values.length - 1)]!
        },
        shuffle<T>(values: readonly T[]) {
            const result = [...values]
            for (let i = result.length - 1; i > 0; i--) {
                const j = this.integer(0, i)
                ;[result[i], result[j]] = [result[j]!, result[i]!]
            }
            return result
        }
    }
}
