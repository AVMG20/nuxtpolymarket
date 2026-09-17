/**
 * Elo for the async ladder: every fight against a real player's snapshot
 * moves both ratings — the attacker actively, the defender passively, which
 * is the standard shape for snapshot battlers. Wild-trainer fights never
 * touch ratings (they would be farmable).
 */

export const ELO_START = 1000
export const ELO_K = 32

/** Expected score of `a` against `b` — the logistic curve, 400-point scale. */
export function eloExpected(a: number, b: number): number {
    return 1 / (1 + 10 ** ((b - a) / 400))
}

/**
 * Rating change for the attacker; the defender gets the negation, so the
 * pool is conserved. `score` is 1 for a win, 0.5 for a draw, 0 for a loss.
 */
export function eloDelta(attacker: number, defender: number, score: number, k: number = ELO_K): number {
    return Math.round(k * (score - eloExpected(attacker, defender)))
}
