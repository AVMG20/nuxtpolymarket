import { D } from './numbers'
import type { OfflineWindow, RunPosition, SettleResult } from './types'

/**
 * The welcome-back card: what the settles banked away since the player last put it away.
 *
 * Kept on `hq_state` rather than read off one response, so whichever request settles a gap, and
 * whichever tab reads it, the card still shows (a dropped read once lost a whole night's card).
 */
export interface HqAwayReport {
    /** New on every write, so putting away an older copy never clears a window added since. */
    id: string
    kills: number
    goldEarned: number
    xpEarned: string
    levelsGained: number
    /** The Hero's level the last window ended on. */
    heroLevel: number
    awaySeconds: number
    effectiveSeconds: number
    /** Time away past each window's offline cap, summed. */
    lostToCapSeconds: number
    blockedAtBoss: boolean
    wipedOnWave: boolean
    /** The last window's offline rules; its Battle Speed seconds summed over every window. */
    offline: OfflineWindow
    from: RunPosition
    to: RunPosition
}

/** One offline window's report, or null when it was online or banked nothing worth a card. */
export function awayReportOf(
    id: string,
    result: SettleResult,
    awaySeconds: number,
    previousLevel: number,
    from: RunPosition
): HqAwayReport | null {
    const offline = result.offline
    if (!offline || (result.kills <= 0 && !result.wipedOnWave)) return null
    return {
        id,
        kills: result.kills,
        goldEarned: result.goldEarned,
        xpEarned: result.xpEarned.toString(),
        levelsGained: result.heroLevel - previousLevel,
        heroLevel: result.heroLevel,
        awaySeconds,
        effectiveSeconds: result.effectiveSeconds,
        lostToCapSeconds: Math.max(0, awaySeconds - offline.capSeconds),
        blockedAtBoss: result.blockedAtBoss,
        wipedOnWave: result.wipedOnWave,
        offline,
        from,
        to: result.position
    }
}

/** A new window added to the report still waiting to be seen: totals summed, the run's state as of the new one. */
export function mergeAwayReports(pending: HqAwayReport | null, next: HqAwayReport): HqAwayReport {
    if (!pending) return next
    return {
        ...next,
        kills: pending.kills + next.kills,
        goldEarned: pending.goldEarned + next.goldEarned,
        xpEarned: D(pending.xpEarned).add(D(next.xpEarned)).toString(),
        levelsGained: pending.levelsGained + next.levelsGained,
        awaySeconds: pending.awaySeconds + next.awaySeconds,
        effectiveSeconds: pending.effectiveSeconds + next.effectiveSeconds,
        lostToCapSeconds: pending.lostToCapSeconds + next.lostToCapSeconds,
        offline: {
            ...next.offline,
            cappedSeconds: pending.offline.cappedSeconds + next.offline.cappedSeconds,
            boostedSeconds: pending.offline.boostedSeconds + next.offline.boostedSeconds
        },
        from: pending.from
    }
}
