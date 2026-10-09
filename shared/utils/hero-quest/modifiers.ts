/**
 * The passive-modifier vocabulary, shared by Gear, Skill passives and Artifact effects.
 *
 * ## Why one type for three systems
 *
 * All three do the same job — a permanent, always-on adjustment to the party's numbers with no
 * cooldown and nothing to fire. `gear-equipment.md` §2 expresses every Gear bonus as "+X% to
 * the target stat"; `skills-gacha.md` §3 confines Passives to "path-agnostic stat" and
 * "external resource" buckets; `artifacts-dig-site-gacha.md` §2 gives Artifacts four stat
 * *domains*. Those are the same vocabulary described three times, so it is written once here
 * and each content module declares against it — the same reasoning that made `hqCollection`
 * one table and `gacha.ts` take a `system` argument.
 *
 * What differs is **scope**, and that is the caller's business, not this module's:
 *
 * | System | Scope | Source |
 * |---|---|---|
 * | Gear | Hero only | `gear-equipment.md` §1 — "Hero-only equipment" |
 * | Skills | Hero only | `skills-gacha.md` §1 — "Hero-only" |
 * | Artifacts | Whole fielded party | `artifacts-dig-site-gacha.md` §1 |
 * | Traits | Whole fielded party, two stats aside | `traits.md` §0 |
 *
 * ## Stacking is additive, and that is doc-mandated
 *
 * `artifacts-dig-site-gacha.md` §4 locks "different Artifacts that share a category stack
 * additively", and `gold-economy.md` §5 resolves Gold% the same way — no hard cap, magnitudes
 * tuned so a maximal dedicated stack lands around ×3. So every magnitude below sums, and the
 * sum is applied once. Multiplying the sources instead would make the same three +50% lines
 * worth ×3.4 rather than ×2.5, which is not what either doc says.
 *
 * Pure, like everything in `shared/`: this module sums declarations. Applying them is
 * `stats.ts` (party numbers) and `settle.ts` (economy).
 */

import type { HqStatKey } from './types'

/**
 * What a passive line adjusts.
 *
 * Deliberately small. Every effect in all three rosters lands on one of these, and where a
 * doc describes machinery the engine does not have — a buff that ramps during a fight, a proc
 * on kill, a once-per-fight death save — the content module renders it as the nearest kind and
 * says so in a comment.
 */
export type ModifierKind =
    /** Multiplies one of the six stats. `stat` is required. */
    | 'stat'
    /** Multiplies max HP on top of whatever VIT already bought. */
    | 'maxHp'
    /** Added to crit chance as a probability, before the [0,1] clamp. */
    | 'critChance'
    /** Added to the crit multiplier as a fraction — +0.5 means +50% crit damage. */
    | 'critDamage'
    /** Fraction of enemy DEF ignored. Softens the pack rather than hardening the party. */
    | 'enemyDefShred'
    /** Fraction of incoming damage removed, on top of normal mitigation. */
    | 'damageTaken'
    /** Fraction added to Gold income. Additive across sources (`gold-economy.md` §5). */
    | 'gold'
    /** Fraction added to XP income. */
    | 'xp'
    /** Fraction added to offline efficiency, on top of the prestige-shop track. */
    | 'offlineEfficiency'
    /** Fraction shaved off every cooldown, on top of what SPD already shortens. */
    | 'cooldown'
    /**
     * Fraction by which hostile statuses a boss special lands on the party are shortened: stuns,
     * silences, burns and debuffs alike (`fight.ts`). Bosses are the only enemies with abilities,
     * so it does nothing in the idle rate.
     */
    | 'controlResist'
    /** Fraction of incoming damage reflected back at the attacker. */
    | 'reflect'
    /**
     * Added to Evasion Rate as a rate (`classes-and-combat.md` §7): +0.1 is ten points of it.
     * Clamped at `MAX_EVASION` once every source is summed. Traits' Vital Reflex is the only source.
     */
    | 'evasion'
    /** Fraction added to the damage of the bearer's own abilities (Traits' Hero Skill DMG). */
    | 'skillDamage'
    /** Fraction added to basic-attack damage (Traits' Back to Basics). */
    | 'basicAttack'
    /** Share of max HP recovered every second (Traits' Divine Blessing). */
    | 'regen'

export interface HqModifier {
    kind: ModifierKind
    /** Required when `kind` is `'stat'`, meaningless otherwise. */
    stat?: HqStatKey
    /** A fraction. `0.25` is +25% for additive kinds and −25% for reducing ones. */
    magnitude: number
}

const STAT_KEYS: readonly HqStatKey[] = ['pwr', 'spd', 'lck', 'imp', 'vit', 'def']

/**
 * The line kinds an **unequipped** Skill or Artifact passes on through the collection passive
 * (`SKILL_COLLECTION_PASSIVE_FRACTION`, `ARTIFACT_COLLECTION_PASSIVE_FRACTION`).
 *
 * Combat stats only — the six stats, max HP and crit. Everything else stays equipped-only:
 * economy lines would let a wide collection stack Gold% nobody slotted, cooldown and damage-taken
 * lines are uptime and mitigation rather than stats, and shred, control resist and reflect are
 * effects that only make sense on something the player chose to field.
 */
export const COLLECTION_PASSIVE_KINDS: ReadonlySet<ModifierKind> = new Set<ModifierKind>([
    'stat', 'maxHp', 'critChance', 'critDamage'
])

/**
 * Every modifier line summed, resolved into the exact shapes the consumers want.
 *
 * Reducing kinds (`enemyDefShred`, `damageTaken`, `cooldown`) arrive here as *factors* rather
 * than fractions, clamped at 0, so a call site never has to remember which direction a
 * magnitude points. Additive kinds stay fractions so they can be summed further.
 */
export interface ModifierTotals {
    /** Per-stat multipliers, 1 when nothing touches that stat. */
    stats: Record<HqStatKey, number>
    maxHpFactor: number
    critChanceBonus: number
    critDamageBonus: number
    /** Multiply enemy DEF by this. Below 1 means shredded. */
    enemyDefFactor: number
    /** Multiply incoming damage by this. Below 1 means mitigated. */
    damageTakenFactor: number
    goldPct: number
    xpPct: number
    offlineEfficiencyPct: number
    /** Multiply every cooldown by this. Below 1 means faster. */
    cooldownFactor: number
    controlResist: number
    reflectFraction: number
    /** Evasion Rate, summed and not yet clamped. */
    evasion: number
    /** Multiply the bearer's ability damage by this. */
    skillDamageFactor: number
    /** Multiply the bearer's basic-attack damage by this. */
    basicAttackFactor: number
    /** Share of max HP recovered every second. */
    regenPerSecond: number
}

export function noModifiers(): ModifierTotals {
    return {
        stats: { pwr: 1, spd: 1, lck: 1, imp: 1, vit: 1, def: 1 },
        maxHpFactor: 1,
        critChanceBonus: 0,
        critDamageBonus: 0,
        enemyDefFactor: 1,
        damageTakenFactor: 1,
        goldPct: 0,
        xpPct: 0,
        offlineEfficiencyPct: 0,
        cooldownFactor: 1,
        controlResist: 0,
        reflectFraction: 0,
        evasion: 0,
        skillDamageFactor: 1,
        basicAttackFactor: 1,
        regenPerSecond: 0
    }
}

/**
 * Sum a flat list of modifier lines.
 *
 * Reducing kinds are summed as fractions first and converted to a factor once, at the end —
 * `1 - (a + b)` rather than `(1-a) × (1-b)`. Additive stacking is the locked rule (§4 there),
 * and the difference is not cosmetic: two 60% shreds compose to *full* penetration additively
 * and only 84% multiplicatively.
 */
export function sumModifiers(modifiers: readonly HqModifier[]): ModifierTotals {
    const totals = noModifiers()
    let shred = 0
    let damageTaken = 0
    let cooldown = 0

    for (const line of modifiers) {
        const magnitude = Number.isFinite(line.magnitude) ? line.magnitude : 0
        switch (line.kind) {
            case 'stat':
                if (line.stat) totals.stats[line.stat] += magnitude
                break
            case 'maxHp':
                totals.maxHpFactor += magnitude
                break
            case 'critChance':
                totals.critChanceBonus += magnitude
                break
            case 'critDamage':
                totals.critDamageBonus += magnitude
                break
            case 'enemyDefShred':
                shred += magnitude
                break
            case 'damageTaken':
                damageTaken += magnitude
                break
            case 'gold':
                totals.goldPct += magnitude
                break
            case 'xp':
                totals.xpPct += magnitude
                break
            case 'offlineEfficiency':
                totals.offlineEfficiencyPct += magnitude
                break
            case 'cooldown':
                cooldown += magnitude
                break
            case 'controlResist':
                totals.controlResist += magnitude
                break
            case 'reflect':
                totals.reflectFraction += magnitude
                break
            case 'evasion':
                totals.evasion += magnitude
                break
            case 'skillDamage':
                totals.skillDamageFactor += magnitude
                break
            case 'basicAttack':
                totals.basicAttackFactor += magnitude
                break
            case 'regen':
                totals.regenPerSecond += magnitude
                break
        }
    }

    totals.enemyDefFactor = Math.max(0, 1 - shred)
    totals.damageTakenFactor = Math.max(0, 1 - damageTaken)
    // A cooldown may be shortened, never inverted. `cooldownFor` still applies its own floor.
    totals.cooldownFactor = Math.max(0, 1 - cooldown)
    return totals
}

/** Merge two already-summed sets — the Hero's own (Gear + Skills) with the party-wide one. */
export function mergeTotals(a: ModifierTotals, b: ModifierTotals): ModifierTotals {
    const merged = noModifiers()
    for (const key of STAT_KEYS) {
        // Each side's per-stat value is `1 + Σfractions`, so the fractions add and the 1 is
        // counted once. Multiplying the two would make Gear and Artifacts compound against
        // each other, which §4's additive rule forbids.
        merged.stats[key] = a.stats[key] + b.stats[key] - 1
    }
    merged.maxHpFactor = a.maxHpFactor + b.maxHpFactor - 1
    merged.critChanceBonus = a.critChanceBonus + b.critChanceBonus
    merged.critDamageBonus = a.critDamageBonus + b.critDamageBonus
    merged.enemyDefFactor = Math.max(0, a.enemyDefFactor + b.enemyDefFactor - 1)
    merged.damageTakenFactor = Math.max(0, a.damageTakenFactor + b.damageTakenFactor - 1)
    merged.goldPct = a.goldPct + b.goldPct
    merged.xpPct = a.xpPct + b.xpPct
    merged.offlineEfficiencyPct = a.offlineEfficiencyPct + b.offlineEfficiencyPct
    merged.cooldownFactor = Math.max(0, a.cooldownFactor + b.cooldownFactor - 1)
    merged.controlResist = a.controlResist + b.controlResist
    merged.reflectFraction = a.reflectFraction + b.reflectFraction
    merged.evasion = a.evasion + b.evasion
    merged.skillDamageFactor = a.skillDamageFactor + b.skillDamageFactor - 1
    merged.basicAttackFactor = a.basicAttackFactor + b.basicAttackFactor - 1
    merged.regenPerSecond = a.regenPerSecond + b.regenPerSecond
    return merged
}
