/**
 * Banking a won Hackerz run. The server settles from the stored save, so the
 * wave-30 save has to land before the run is settled — settle after a failed
 * one and the server pays out the save before it: no victory, and the last
 * wave's coins lost. What a failed save means decides what happens next.
 */

/** What became of a save, by what to do about it. */
export type HackerzSaveOutcome =
    /** It landed. */
    | 'saved'
    /** Another save got there first (409): the stored save decides. */
    | 'stale'
    /** The run was settled in the meantime (410): there is nothing left to save. */
    | 'ended'
    /** The server refused it (another 4xx): saying it again will not help. */
    | 'rejected'
    /** No answer (the network, a 5xx): worth another try. */
    | 'unreachable'

/** Sorts a failed save request by its status. */
export function hackerzSaveOutcome(error: unknown): HackerzSaveOutcome {
    const status = (error as { statusCode?: number, status?: number } | null)?.statusCode
        ?? (error as { status?: number } | null)?.status
    if (status === 409) return 'stale'
    if (status === 410) return 'ended'
    if (status && status >= 400 && status < 500) return 'rejected'
    return 'unreachable'
}

export interface HackerzVictoryClaim {
    /** Saves the run as it stands, the final wave won. */
    save: () => Promise<HackerzSaveOutcome>
    /** The wave the server holds for this run (and its revision), or null when it holds no run. */
    stored: () => Promise<{ wave: number, revision: number } | null>
    /** Takes the stored revision as the client's own, so the next save carries it. */
    adopt: (revision: number) => void
    /** Settles the run as a victory, from the stored save. */
    settle: () => Promise<void>
    wait: (ms: number) => Promise<void>
}

/** How a claim ended: banked, still to be banked, or not bankable at all. */
export type HackerzVictoryResult = 'settled' | 'pending' | 'ended' | 'conflict' | 'rejected'

/**
 * Saves the won run and only then settles it. A save with no answer is tried
 * again (`attempts` in all, `retryMs` apart and growing); a refusal is not.
 * A save that lost a race is checked against what the server holds: if that
 * already is the final wave — the save landed and only its answer was lost —
 * the run is settled from it. Never settles after a save that did not land.
 */
export async function claimHackerzVictory(
    claim: HackerzVictoryClaim,
    finalWave: number,
    attempts = 3,
    retryMs = 1000
): Promise<HackerzVictoryResult> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt) await claim.wait(retryMs * attempt)
        const outcome = await claim.save()
        if (outcome === 'saved') {
            await claim.settle()
            return 'settled'
        }
        if (outcome === 'ended' || outcome === 'rejected') return outcome
        if (outcome === 'stale') {
            let stored: Awaited<ReturnType<HackerzVictoryClaim['stored']>>
            try {
                stored = await claim.stored()
            } catch {
                continue
            }
            if (!stored) return 'ended'
            if (stored.wave < finalWave) return 'conflict'
            claim.adopt(stored.revision)
            await claim.settle()
            return 'settled'
        }
    }
    return 'pending'
}
