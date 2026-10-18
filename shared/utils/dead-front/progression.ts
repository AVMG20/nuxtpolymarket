import type { DfMatchResult } from './types'

// Perk research curve and match XP. Tuned so a researched perk maxes in ~3-4
// matches (round 10-15, 100-200 kills): players play 10-20 matches in total.

/** XP needed to reach research levels 1..6 (cumulative). */
export const DF_PERK_LEVEL_XP = [250, 600, 1000, 1500, 2100, 2800]

export const DF_PERK_MAX_LEVEL = DF_PERK_LEVEL_XP.length

export function dfPerkLevel(xp: number): number {
    let level = 0
    for (const need of DF_PERK_LEVEL_XP) if (xp >= need) level++
    return level
}

/** Progress inside the current research level: xp into it, xp it spans, and 0..1 (1 when maxed). */
export function dfPerkLevelProgress(xp: number): { level: number, into: number, span: number, frac: number } {
    const level = dfPerkLevel(xp)
    if (level >= DF_PERK_MAX_LEVEL) return { level, into: 0, span: 0, frac: 1 }
    const from = level === 0 ? 0 : DF_PERK_LEVEL_XP[level - 1]!
    const to = DF_PERK_LEVEL_XP[level]!
    const into = Math.max(0, xp - from)
    return { level, into, span: to - from, frac: Math.min(1, into / (to - from)) }
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** Research XP one match earns toward the perk being researched. */
export function dfPerkXpFromMatch(result: DfMatchResult): number {
    const rounds = Math.min(200, nonNeg(result.roundsSurvived))
    const kills = Math.min(5000, nonNeg(result.kills))
    return 100 + rounds * 45 + kills * 2 + (result.completedEasterEgg ? 300 : 0)
}
