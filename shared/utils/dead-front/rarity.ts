// Weapon rarity, Cold War style: four tiers on top of any weapon (and
// independent of Pack-a-Punch, which keeps it). Each tier adds damage through
// `dfWeaponStats(id, pap, attachments, rarity)`, so the server and the
// client's predictions agree. The mystery box rolls a rarity (better with the
// round) and now and then offers an upgrade kit instead of a weapon; the
// workbench upgrades the held weapon a tier for salvage. Pure and unit tested.

export type DfRarity = 0 | 1 | 2 | 3

export interface DfRarityDef {
    tier: DfRarity
    name: string
    /** HUD colour (CoD's white / green / purple / orange). */
    color: string
    /** Damage multiplier (bullets and splash). */
    damage: number
}

export const DF_RARITIES: readonly DfRarityDef[] = [
    { tier: 0, name: 'Common', color: '#ece6d6', damage: 1 },
    { tier: 1, name: 'Rare', color: '#5fd35a', damage: 1.25 },
    { tier: 2, name: 'Epic', color: '#b46cff', damage: 1.55 },
    { tier: 3, name: 'Legendary', color: '#ff9a26', damage: 2 }
]

export const DF_RARITY_MAX: DfRarity = 3

/** A whole tier 0..3 (anything else is common). */
export function dfClampRarity(r: unknown): DfRarity {
    const n = typeof r === 'number' && Number.isFinite(r) ? Math.floor(r) : 0
    return Math.max(0, Math.min(DF_RARITY_MAX, n)) as DfRarity
}

export function dfRarity(r: unknown): DfRarityDef {
    return DF_RARITIES[dfClampRarity(r)]!
}

/** Does rarity apply to this weapon? (The wunderweapon is one of a kind.) */
export function dfRarityApplies(id: string): boolean {
    return id !== 'wunder'
}

/** Damage multiplier of a tier on a weapon. */
export function dfRarityDamageMult(id: string, r: unknown): number {
    return dfRarityApplies(id) ? dfRarity(r).damage : 1
}

/** Clamps a round into 0..1 along the box's curve (round 3 and before: 0; round 20 and after: 1). */
function boxCurve(round: number): number {
    return Math.max(0, Math.min(1, (Math.floor(round) - 3) / 17))
}

/**
 * Relative odds of each tier from the box on a round: mostly common through
 * round 5; by round 20 commons are gone and a quarter of pulls are legendary.
 */
export function dfBoxRarityWeights(round: number): [number, number, number, number] {
    const t = boxCurve(round)
    return [80 * (1 - t), 16 + 19 * t, 3.5 + 36.5 * t, 0.5 + 24.5 * t]
}

function pickWeighted(weights: readonly number[], roll: number): number {
    const total = weights.reduce((a, b) => a + b, 0)
    let x = Math.max(0, Math.min(0.999999, roll)) * total
    for (let i = 0; i < weights.length; i++) {
        x -= weights[i]!
        if (x < 0) return i
    }
    return weights.length - 1
}

/** The rarity of a box weapon; `roll` is uniform in [0, 1). */
export function dfBoxRarityRoll(round: number, roll: number): DfRarity {
    return pickWeighted(dfBoxRarityWeights(round), roll) as DfRarity
}

// ---------------------------------------------------------------- upgrade kits

export const DF_KIT = {
    /** Seconds a dropped kit lies on the ground. */
    life: 120,
    /** The last seconds it blinks. */
    warn: 15,
    /** Box kit chance on round 1, and its cap (by round 20). */
    chance: [0.04, 0.12] as const,
    /** Reach to take one off the ground. */
    reach: 1.9
} as const

/** Chance a box roll offers an upgrade kit instead of a weapon. */
export function dfBoxKitChance(round: number): number {
    const [a, b] = DF_KIT.chance
    return a + (b - a) * boxCurve(round)
}

/** Relative odds of a kit's tier (Rare, Epic, Legendary) on a round. */
export function dfKitTierWeights(round: number): [number, number, number] {
    const t = boxCurve(round)
    return [75 - 45 * t, 22 + 23 * t, 3 + 22 * t]
}

/** A box roll's kit: its tier 1..3, or null for a weapon. Rolls are uniform in [0, 1). */
export function dfBoxKitRoll(round: number, chanceRoll: number, tierRoll: number): DfRarity | null {
    if (chanceRoll >= dfBoxKitChance(round)) return null
    return (1 + pickWeighted(dfKitTierWeights(round), tierRoll)) as DfRarity
}

/** What a kit does to a weapon of tier `current`: `apply` it (raise to the kit's tier) or `keep` it (already there). */
export function dfKitFits(kit: DfRarity, weaponId: string | null | undefined, current: unknown): 'apply' | 'keep' | 'none' {
    if (!weaponId || !dfRarityApplies(weaponId)) return 'none'
    return dfClampRarity(current) < kit ? 'apply' : 'keep'
}

/** "Epic Upgrade Kit" */
export function dfKitName(tier: unknown): string {
    return `${dfRarity(tier).name} Upgrade Kit`
}

// ---------------------------------------------------------------- the workbench

/** Salvage to raise a weapon from tier `from` to `from + 1` (null at the top). */
export const DF_RARITY_UPGRADE: readonly { scrap: number, parts: number }[] = [
    { scrap: 6, parts: 0 },
    { scrap: 12, parts: 1 },
    { scrap: 20, parts: 2 }
]

export function dfRarityUpgradeCost(from: unknown): { scrap: number, parts: number } | null {
    const r = dfClampRarity(from)
    return r >= DF_RARITY_MAX ? null : DF_RARITY_UPGRADE[r]!
}
