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

export const XENO_UPGRADE_TRACKS: XenoUpgradeTrack[] = [
    {
        id: 'mutation',
        name: 'Genetic Instability',
        icon: 'i-lucide-dna',
        description: 'Raises every breeder mutation chance, including mutations into new tiers.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [1_000_000, 3_000_000, 8_000_000, 20_000_000, 50_000_000, 150_000_000, 500_000_000, 2_000_000_000, 8_000_000_000, 25_000_000_000],
        effectLabel: level => `+${level}% mutation chance`
    },
    {
        id: 'yield',
        name: 'Xenoflora Abundance',
        icon: 'i-lucide-sprout',
        description: 'Adds the upgrade level as a fixed bonus on top of every grid harvest.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [5_000_000, 20_000_000, 75_000_000, 250_000_000, 1_000_000_000, 5_000_000_000, 20_000_000_000, 75_000_000_000, 200_000_000_000, 500_000_000_000],
        effectLabel: level => `+${level} plants per grid harvest`
    },
    {
        id: 'speed',
        name: 'Temporal Cultivation',
        icon: 'i-lucide-zap',
        description: 'Reduces both grid grow time and breeder mutation-cycle time.',
        maxLevel: XENO_UPGRADE_MAX_LEVEL,
        costs: [2_000_000, 6_000_000, 18_000_000, 55_000_000, 175_000_000, 550_000_000, 1_750_000_000, 6_000_000_000, 20_000_000_000, 250_000_000_000],
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
