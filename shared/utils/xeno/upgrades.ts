export type XenoUpgradeId = 'mutation' | 'yield' | 'speed'

export interface XenoUpgradeLevels {
    mutation: number
    yield: number
    speed: number
}

export interface XenoUpgradeTrack {
    id: XenoUpgradeId
    name: string
    icon: string
    description: string
    maxLevel: number
    costs: number[]
    effectLabel: (level: number) => string
}

export const XENO_UPGRADE_MAX_LEVEL = 10
export const XENO_MUTATION_PER_LEVEL = 0.01
export const XENO_YIELD_PER_LEVEL = 1
export const XENO_SPEED_PER_LEVEL = 0.05
export const XENO_MAX_GLOBAL_SPEED = 0.50

/**
 * Cost ladders are priced in HOURS OF INCOME, not round numbers: every level
 * should cost roughly 10-400 hours of what a player realistically earns at the
 * tier they'd be on when buying it (see scripts/xeno-income.ts for that curve).
 *
 * The yield track used to total 801B — over 13,000 hours even at T9 — because
 * it had been priced against T8/T9 income that almost nobody reached, so in
 * practice it was never bought at all. The speed track's last level was a 12.5x
 * step (20B → 250B) where every other step is ~3x. `test/xeno/balance.spec.ts`
 * guards the hours-of-income ceiling; re-run `bun run balance:compare` after
 * touching any cost here.
 *
 * Because these are priced in hours of income, the plant sell-value cut in
 * plants.ts had to be applied here too or every ladder would have silently
 * doubled in real cost. Each level is scaled by the factor of the tier it is
 * bought at — levels 1-2 ×0.55 (T4), 3-6 ×0.50 (T5/T6), 7-10 ×0.45 (T7/T8) —
 * which leaves hours-of-income exactly where it was.
 */
export const XENO_UPGRADE_TRACKS: XenoUpgradeTrack[] = [
    {
        id: 'mutation',
        name: 'Genetic Instability',
        icon: 'i-lucide-dna',
        description: 'Raises every breeder mutation chance, including mutations into new tiers.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [550_000, 1_650_000, 4_000_000, 10_000_000, 25_000_000, 75_000_000, 225_000_000, 675_000_000, 1_800_000_000, 5_400_000_000],
        effectLabel: level => `+${level}% mutation chance`
    },
    {
        id: 'yield',
        name: 'Xenoflora Abundance',
        icon: 'i-lucide-sprout',
        description: 'Adds the upgrade level as a fixed bonus on top of every grid harvest.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [2_750_000, 11_000_000, 37_500_000, 125_000_000, 400_000_000, 1_250_000_000, 3_600_000_000, 11_250_000_000, 31_500_000_000, 54_000_000_000],
        effectLabel: level => `+${level} plants per grid harvest`
    },
    {
        id: 'speed',
        name: 'Temporal Cultivation',
        icon: 'i-lucide-zap',
        description: 'Reduces both grid grow time and breeder mutation-cycle time.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [1_100_000, 3_300_000, 9_000_000, 27_500_000, 87_500_000, 275_000_000, 787_500_000, 2_700_000_000, 9_000_000_000, 27_000_000_000],
        effectLabel: level => `+${level * 5}% cultivation speed`
    }
]

export function getXenoUpgradeTrack(id: string): XenoUpgradeTrack | undefined {
    return XENO_UPGRADE_TRACKS.find(track => track.id === id)
}

export function xenoUpgradeCost(id: XenoUpgradeId, currentLevel: number): number | null {
    const track = getXenoUpgradeTrack(id)
    if (!track || currentLevel < 0 || currentLevel >= track.maxLevel) return null
    return track.costs[currentLevel] ?? null
}

export function xenoMutationBoost(level: number): number {
    return Math.min(XENO_UPGRADE_MAX_LEVEL, Math.max(0, level)) * XENO_MUTATION_PER_LEVEL
}

export function xenoYieldBonus(level: number): number {
    return Math.min(XENO_UPGRADE_MAX_LEVEL, Math.max(0, level)) * XENO_YIELD_PER_LEVEL
}

export function xenoSpeedBoost(level: number): number {
    return Math.min(XENO_MAX_GLOBAL_SPEED, Math.min(XENO_UPGRADE_MAX_LEVEL, Math.max(0, level)) * XENO_SPEED_PER_LEVEL)
}
