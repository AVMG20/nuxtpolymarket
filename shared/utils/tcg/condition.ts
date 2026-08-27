import { randomFloat } from '#shared/utils/random'
import { rollCondition } from './grading-model'
import type { TcgCondition } from './grading-model-types'

/**
 * Sample from Gamma(shape, scale). The locked condition model only ever asks
 * for shape 2.0, where the sum-of-two-exponentials form is exact:
 * Gamma(2, scale) = -scale * (ln u1 + ln u2). Any other shape is a misuse of
 * this helper, so it throws rather than silently returning a wrong draw.
 */
export function gammaSample(shape: number, scale: number, rng: () => number = randomFloat): number {
    if (shape !== 2) {
        throw new Error(`gammaSample only supports shape 2.0, got ${shape}`)
    }
    // 1 - rng() maps [0, 1) to (0, 1], keeping log() away from -Infinity
    return -scale * (Math.log(1 - rng()) + Math.log(1 - rng()))
}

/**
 * Standard normal draw (Box–Muller), CSPRNG-backed. The grading model's
 * measurement noise (§6.4) — injectable rng for tests.
 */
export function gaussSample(rng: () => number = randomFloat): number {
    // 1 - rng() maps [0, 1) to (0, 1], keeping log() away from -Infinity
    const u1 = 1 - rng()
    const u2 = rng()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Centering render constants, shared so the admin wear harness can mirror
 * exactly what the server derives for real copies (§6.2): magnitude =
 * severity^curve * maxOffset, as a fraction of card size. maxOffset is
 * roughly a 60/40 cut against the ~6% border; beyond it is misprint
 * territory, reserved for a future misprint feature.
 */
export const TCG_CENTERING = {
    maxOffset: 0.012,
    curve: 0.7
} as const

/** Roll a copy's immutable condition at mint time. */
export function mintCondition(rng: () => number = randomFloat): TcgCondition {
    // The vendored module is @ts-nocheck, so its inferred shapes are loose —
    // the hand-written TcgCondition contract in grading-model-types.ts is the
    // real one.
    return rollCondition(rng, (shape: number, scale: number) => gammaSample(shape, scale, rng)) as TcgCondition
}
