/**
 * The five raids (`raid-system.md` §1): four paired with a gacha, paying its Seals, and the Trait
 * Raid on its own, paying Trait Gems. Each has its own Keys and one fight type (§7).
 *
 * IDs are stable and are what saves will reference; reordering this list must never change one.
 * Nothing numeric lives here: the ladders, Key grants and reward curves are `constants.ts`'s, once
 * the raids are built.
 */

import type { GachaSystem } from '../gacha'

export type RaidFightType = 'solo_boss' | 'reinforced_boss' | 'boss_gauntlet' | 'rampaging_boss' | 'training_dummy'

export type RaidId = 'raid_guild' | 'raid_training_grounds' | 'raid_dig_site' | 'raid_forge' | 'raid_trait'

export interface RaidDef {
    id: RaidId
    name: string
    fightType: RaidFightType
    /** The gacha whose Seals it pays; null for a standalone raid. */
    pairedSystem: GachaSystem | null
    /** What a reward pays, and what an entry costs, by name. */
    reward: string
    key: string
}

export const RAIDS: readonly RaidDef[] = [
    { id: 'raid_guild', name: 'Gilded Knight', fightType: 'solo_boss', pairedSystem: 'champion', reward: 'Guild Seals', key: 'Guild Keys' },
    { id: 'raid_training_grounds', name: 'Training Grounds', fightType: 'training_dummy', pairedSystem: 'skill', reward: 'Skill Seals', key: 'Skill Keys' },
    { id: 'raid_dig_site', name: 'Dig Site', fightType: 'reinforced_boss', pairedSystem: 'artifact', reward: 'Excavation Seals', key: 'Excavation Keys' },
    { id: 'raid_forge', name: "God's Forge", fightType: 'boss_gauntlet', pairedSystem: 'gear', reward: 'Forge Seals', key: 'Forge Keys' },
    { id: 'raid_trait', name: 'Shardcaller Beast', fightType: 'rampaging_boss', pairedSystem: null, reward: 'Trait Gems', key: 'Trait Keys' }
]

/** The raids that can be entered: each joins as its fight is built. */
export const RAIDS_OPEN: ReadonlySet<RaidId> = new Set<RaidId>(['raid_guild', 'raid_training_grounds', 'raid_dig_site', 'raid_forge'])

export function isRaidId(value: unknown): value is RaidId {
    return RAIDS.some(raid => raid.id === value)
}

export function getRaid(id: RaidId): RaidDef {
    return RAIDS.find(raid => raid.id === id)!
}

/**
 * Whether every run of this fight type pays, and so spends its Key on entry. A Key is spent exactly
 * when a reward is paid (`raid-system.md` §3): a boss that can be beaten pays on the win, while the
 * two that cannot be won pay every run, each starting at level 1.
 */
export function paysEveryRun(fightType: RaidFightType): boolean {
    return fightType === 'rampaging_boss' || fightType === 'training_dummy'
}
