/**
 * The Forge — Gear roster and effect formulas (`gear-equipment.md`).
 *
 * **The simplest system in the project, and the roster proves it.** 6 slots × 6 rarities = 36
 * pieces, one per cell, every one doing the identical thing at a different magnitude. There is
 * no ability pool, no effect-line table and nothing to author: `gear-equipment.md` §1 names all
 * 36 with one template — `<Rarity Epithet> <Slot Name>` — so the roster below is *generated from
 * two axes* rather than transcribed, and the doc's own name table is reproduced exactly.
 *
 * Three ways Gear is the deliberate exception among the four gachas:
 *
 * 1. **Hero-only** (§1), unlike Artifacts, which are party-wide.
 * 2. **All 6 slots available from account start** (§1) — no 2→5 prestige-shop track, because
 *    slots map onto Hero stats that exist from day one rather than a party size that grows.
 * 3. **Single-stat, magnitude-only, always** (§1) — rarity scales the number and never adds a
 *    second stat, so `RARITY_EFFECT_LINES` does not apply here at all.
 *
 * ## Equipped and unequipped both matter
 *
 * §3 locks **manual** equip with an upgrade indicator, revised from an earlier auto-equip
 * proposal. Every owned piece contributes the small `passiveBonus`, mirroring the Champion
 * collection passive (`champions-guild-gacha.md` §7), and the one chosen piece per slot adds
 * `equippedBonus` on top. The passive is additive with equipping (decided 2026-10-04): equipping
 * a piece never takes away what owning it gave. The consequence §3 names explicitly: a
 * player who ignores the indicator has lower stats than they have already earned, which is why
 * `upgradeAvailable` below exists — the gap is never hidden, only left for them to close.
 */

import { GEAR_PASSIVE_COEFFICIENT, SLOT_BASE_BONUS } from '../constants'
import { RARITIES, RARITY_EPITHET, RARITY_STAT_MULTIPLIER, investmentScalar } from '../gacha'
import type { HqModifier } from '../modifiers'
import type { HqStatKey, Rarity } from '../types'

/** The six fixed slots, one per Hero stat exactly (§1). */
export type GearSlot = 'weapon' | 'boots' | 'gauntlets' | 'charm' | 'armor' | 'helmet'

export const GEAR_SLOTS: readonly GearSlot[] = [
    'weapon', 'boots', 'gauntlets', 'charm', 'armor', 'helmet'
]

/**
/** Slot → stat, one-to-one and onto (§1). */
export const GEAR_SLOT_STAT: Readonly<Record<GearSlot, HqStatKey>> = {
    weapon: 'pwr',
    boots: 'spd',
    gauntlets: 'imp',
    charm: 'lck',
    armor: 'vit',
    helmet: 'def'
}

export const GEAR_SLOT_NAME: Readonly<Record<GearSlot, string>> = {
    weapon: 'Weapon',
    boots: 'Boots',
    gauntlets: 'Gauntlets',
    charm: 'Charm',
    armor: 'Armor',
    helmet: 'Helmet'
}

export function isGearSlot(value: string): value is GearSlot {
    return (GEAR_SLOTS as readonly string[]).includes(value)
}

export interface GearDefinition {
    /** Stable string ID. Save data references this, never an index. */
    id: string
    /** `<Rarity Epithet> <Slot Name>` — the §1 table, assembled. */
    name: string
    slot: GearSlot
    rarity: Rarity
    /** Which stat this piece moves. Denormalized from `GEAR_SLOT_STAT` for the UI's benefit. */
    stat: HqStatKey
}

/** `weapon` + `mythic` → `gear_weapon_mythic`. Stable, and the only thing a save row holds. */
export function gearIdFor(slot: GearSlot, rarity: Rarity): string {
    return `gear_${slot}_${rarity}`
}

/**
 * **All 36.** Six slots × six rarities, fully populated.
 *
 * Generated from the two axes rather than written out. There is nothing a hand-written table
 * would add here: the name is a template, the stat is fixed by the slot, and the magnitude is a
 * formula. A 36-row literal would just be 36 more chances to typo one.
 */
export const GEAR: readonly GearDefinition[] = GEAR_SLOTS.flatMap(slot =>
    RARITIES.map(rarity => ({
        id: gearIdFor(slot, rarity),
        name: `${RARITY_EPITHET[rarity]} ${GEAR_SLOT_NAME[slot]}`,
        slot,
        rarity,
        stat: GEAR_SLOT_STAT[slot]
    }))
)

export const GEAR_BY_ID: Readonly<Record<string, GearDefinition>> = Object.fromEntries(
    GEAR.map(entry => [entry.id, entry])
)

export function getGear(id: string): GearDefinition {
    const entry = GEAR_BY_ID[id]
    if (!entry) throw new Error(`Unknown gear id: ${id}`)
    return entry
}

export function isGearId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(GEAR_BY_ID, id)
}

export function gearOfRarity(rarity: Rarity): GearDefinition[] {
    return GEAR.filter(entry => entry.rarity === rarity)
}

/** All six rarities are populated, always — the roster is a complete cross product. */
export function gearRarityHasContent(rarity: Rarity): boolean {
    return GEAR.some(entry => entry.rarity === rarity)
}

/**
 * Resolve a rolled rarity to a piece. Uniform within the rarity, six candidates every time.
 *
 * `roll` is supplied by the caller: `shared/` stays pure and the entropy is the server's
 * CSPRNG, never `Math.random()`.
 */
export function gearFromRoll(rarity: Rarity, roll: number): GearDefinition {
    const pool = gearOfRarity(rarity)
    if (pool.length === 0) throw new Error(`No Gear authored at rarity: ${rarity}`)
    const index = Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, roll)) * pool.length))
    return pool[index]!
}

// ── Effect formulas ────────────────────────────────────  §2, §3

/**
 * equippedBonus = SLOT_BASE_BONUS[slot] × RARITY_STAT_MULTIPLIER[rarity] × (star×10+level)
 *
 * A fraction of the target stat, so `0.5` means +50%. The scalar runs 1 at 0★/Lv1 to 60 at
 * 5★/Lv10 — the same `(star × 10 + level)` number that drives the Champion passive and Artifact
 * magnitudes, rather than a third curve.
 */
export function equippedBonus(slot: GearSlot, rarity: Rarity, star: number, level: number): number {
    return (SLOT_BASE_BONUS[slot] ?? 0)
        * RARITY_STAT_MULTIPLIER[rarity]
        * investmentScalar(star, level)
}

/**
 * passiveBonus = GEAR_PASSIVE_COEFFICIENT × RARITY_STAT_MULTIPLIER[rarity] × (star×10+level)
 *
 * What every owned piece contributes, equipped or not — **including one that is actually stronger
 * than what is equipped** (§3). Owning is worth something; equipping well is worth more.
 */
export function passiveBonus(rarity: Rarity, star: number, level: number): number {
    return GEAR_PASSIVE_COEFFICIENT
        * RARITY_STAT_MULTIPLIER[rarity]
        * investmentScalar(star, level)
}

/** One owned copy, as the modifier pipeline needs to see it. */
export interface OwnedGear {
    contentId: string
    star: number
    level: number
}

/**
 * Every owned piece's contribution, as modifier lines.
 *
 * `equipped` maps slot → contentId, which is exactly `hqState.equippedGear`'s shape (§3, and the
 * schema column it forced). Every owned piece contributes `passiveBonus`, and a piece named there
 * contributes `equippedBonus` as well. An `equipped` entry naming a piece the player does not own
 * is ignored rather than trusted — the same posture `championSnapshotsFor` takes.
 */
export function gearModifiers(
    owned: readonly OwnedGear[],
    equipped: Readonly<Record<string, string | undefined>>
): HqModifier[] {
    const ownedIds = new Set(owned.map(copy => copy.contentId))
    const activeIds = new Set(
        Object.values(equipped).filter((id): id is string => typeof id === 'string' && ownedIds.has(id))
    )

    return owned.flatMap((copy) => {
        if (!isGearId(copy.contentId)) return []
        const definition = getGear(copy.contentId)
        const lines = [{ kind: 'stat' as const, stat: definition.stat, magnitude: passiveBonus(definition.rarity, copy.star, copy.level) }]
        if (activeIds.has(copy.contentId)) {
            lines.push({ kind: 'stat' as const, stat: definition.stat, magnitude: equippedBonus(definition.slot, definition.rarity, copy.star, copy.level) })
        }
        return lines
    })
}

/**
 * The first piece ever owned for a slot auto-equips (§3) — "no reason to leave a brand-new slot
 * empty when there's only one option to begin with".
 *
 * Returns the map to persist, or `null` when nothing changed. Never *replaces* a choice the
 * player has made, however weak: past the first piece, swapping is always a manual tap.
 */
export function autoEquipFirstPieces(
    owned: readonly OwnedGear[],
    equipped: Readonly<Record<string, string | undefined>>
): Record<string, string> | null {
    const next: Record<string, string> = {}
    for (const slot of GEAR_SLOTS) {
        const current = equipped[slot]
        if (typeof current === 'string' && isGearId(current)) next[slot] = current
    }

    let changed = false
    for (const copy of owned) {
        if (!isGearId(copy.contentId)) continue
        const { slot } = getGear(copy.contentId)
        if (next[slot] === undefined) {
            next[slot] = copy.contentId
            changed = true
        }
    }
    return changed ? next : null
}

/**
 * The §3 upgrade indicator: is an owned-but-unequipped piece in this slot stronger than what is
 * equipped?
 *
 * Compares `equippedBonus` for both sides — i.e. what each *would* contribute if equipped — not
 * the equipped-vs-passive numbers, which would say yes for almost everything. Informational
 * only; the swap itself stays manual, deliberately (§3).
 */
export function upgradeAvailable(
    slot: GearSlot,
    owned: readonly OwnedGear[],
    equippedId: string | undefined
): boolean {
    const inSlot = owned.filter(copy => isGearId(copy.contentId) && getGear(copy.contentId).slot === slot)
    if (inSlot.length === 0) return false

    const scoreOf = (copy: OwnedGear) =>
        equippedBonus(slot, getGear(copy.contentId).rarity, copy.star, copy.level)
    const current = inSlot.find(copy => copy.contentId === equippedId)
    // Nothing equipped but something owned is itself an upgrade worth prompting.
    const currentScore = current ? scoreOf(current) : -1
    return inSlot.some(copy => scoreOf(copy) > currentScore)
}
