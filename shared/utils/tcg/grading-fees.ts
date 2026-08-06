import { SERVICES } from './grading-model'
import type { TcgServiceKey } from './grading-model-types'

/**
 * Grading economics (§6.4): fees in Coins, anchored to the gem exchange's
 * guide price — grading tracks what the community actually pays for gems,
 * with a hard floor. The services price close together, not identically:
 * PSI charges the brand premium — the slab everyone recognises — with GAG's
 * full report just behind it, and CCC the budget desk.
 */
export const TCG_GRADING = {
    /** Coins — the floor under the guide-price anchor. */
    minFee: 100_000,
    /** Per-service scaling on the anchored base fee. */
    serviceFeeMultiplier: { PSI: 1.2, CCC: 1, BRK: 1.05, GAG: 1.15 } as Record<TcgServiceKey, number>,
    /** §6.4: long enough to be a commitment, short enough for seven players. */
    turnaroundMs: 24 * 60 * 60 * 1000,
    /** Cracking a slab open risks new damage — the gamble has teeth. */
    crackDamageChance: 0.15
} as const

/** Fee in coins for one submission, given the current gem guide price. */
export function gradingFeeFor(service: TcgServiceKey, gemGuidePrice: number): number {
    const base = Math.max(TCG_GRADING.minFee, gemGuidePrice)
    return Math.round(base * TCG_GRADING.serviceFeeMultiplier[service])
}

export function isTcgService(value: string): value is TcgServiceKey {
    return value in SERVICES
}

/** Grades a player may predict at submission ('1'…'10' in half steps). */
export function isValidGrade(value: string): boolean {
    return /^(10|[1-9](\.5)?)$/.test(value)
}
