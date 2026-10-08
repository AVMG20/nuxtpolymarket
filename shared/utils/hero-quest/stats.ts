/**
 * The stat pipeline: (content, playerState) → final party stats.
 *
 * Resolves a class node's qualitative spread into numbers, accumulates specialization
 * deltas down the class path, applies hero level, and hands `combat.ts` a `UnitStats`.
 */

import {
    BASE_THREAT,
    CHAMPION_INVESTMENT_PER_POINT,
    CHAMPION_PASSIVE_PER_POINT,
    LCK_BASE_SCALE,
    MIN_STAT_VALUE,
    TANK_THREAT_MULTIPLIER,
    STAT_PER_LEVEL_FLAT,
    STAT_PER_LEVEL_GROWTH,
    STAT_PER_LEVEL_GROWTH_PACED,
    STAT_PACES_ENEMY_CURVE,
    STAT_SCALES_WITH_LEVEL,
    STAT_TIER_VALUES
} from './constants'
import { classPath, getClass } from './content/classes'
import { getArchetype } from './content/champions'
import { gearModifiers } from './content/gear'
import { skillCollectionModifiers, skillModifiers } from './content/skills'
import { artifactCollectionModifiers, artifactModifiers } from './content/artifacts'
import { shopStatModifiers } from './content/shop'
import { attacksPerSecondFor, critChanceFor, critMultiplierFor, maxHpFor } from './combat'
import { mergeTotals, noModifiers, sumModifiers } from './modifiers'
import type { ModifierTotals } from './modifiers'
import { D, ZERO, decMax, decPow } from './numbers'
import type { Decimal, DecimalSource } from './numbers'
import type {
    ChampionArchetype,
    ChampionSnapshot,
    ClassNode,
    FormationRow,
    HeroSnapshot,
    HqStatBlock,
    HqStatKey,
    StatTier,
    UnitStats
} from './types'

const STAT_KEYS: readonly HqStatKey[] = ['pwr', 'spd', 'lck', 'imp', 'vit', 'def']

export function tierValue(tier: StatTier): number {
    return STAT_TIER_VALUES[tier]
}

/**
 * The per-stat scalar applied to an **accumulated** base spread — tier value plus every
 * specialization delta on the class path, then this.
 *
 * Only LCK carries one. `STAT_TIER_VALUES` is shared by all six stats, so it is not where a
 * single stat's magnitude can be moved; scaling the finished sum is, and it keeps a class's
 * spread shape intact while lowering the number crit chance is read off. See `LCK_BASE_SCALE`
 * for why LCK in particular needs its own dial now that it does not scale with level.
 *
 * Shared with `explain.ts` so the breakdown itemises the same scalar the pipeline applied.
 */
export function baseScaleFor(key: HqStatKey): number {
    return key === 'lck' ? LCK_BASE_SCALE : 1
}

/**
 * Level-1 stat block for a class: its own tier spread, plus every specialization delta
 * along the path from the root. Berserker therefore carries Warrior's and Barbarian's
 * shifts, not just its own.
 */
export function baseSpreadFor(node: ClassNode): HqStatBlock {
    // Accumulated as plain numbers — a level-1 spread is a handful of small integers, and
    // this is the boundary where authored content becomes Decimal.
    const raw = {} as Record<HqStatKey, number>
    for (const key of STAT_KEYS) {
        raw[key] = tierValue(node.spread[key])
    }

    for (const ancestor of classPath(node.id)) {
        for (const key of STAT_KEYS) {
            raw[key] += ancestor.delta[key] ?? 0
        }
    }

    const block = {} as HqStatBlock
    for (const key of STAT_KEYS) {
        block[key] = D(Math.max(MIN_STAT_VALUE, raw[key]! * baseScaleFor(key)))
    }
    return block
}

/**
 * Which per-level growth rate a stat rides.
 *
 * Two curves, not one. `STAT_PER_LEVEL_GROWTH` covers `XP_PACE_SLACK` of the enemy's growth per
 * stage. PWR, DEF and VIT ride `STAT_PER_LEVEL_GROWTH_PACED` instead, which tracks the enemy
 * exactly, because each is read against an enemy stat through a *clamp*: a shortfall there reads
 * as a hundred identical stages followed by a cliff into `MIN_DAMAGE`. See
 * `STAT_PACES_ENEMY_CURVE` and `ENEMY_PACE_RATIO`.
 */
export function statGrowthFor(key: HqStatKey): number {
    return STAT_PACES_ENEMY_CURVE[key] ? STAT_PER_LEVEL_GROWTH_PACED : STAT_PER_LEVEL_GROWTH
}

/**
 * statAtLevel(base, level) = (base + FLAT × (level-1)) × GROWTH^(level-1)
 *
 * `GROWTH` is derived from a pace ratio and sits just above 1.0 — geometric, expressed as a
 * fraction of the enemy curve (`core-progression-and-prestige.md` §1). `FLAT` is 0 by design;
 * additive growth falls behind a geometric enemy curve at any constant.
 *
 * `growth` defaults to `STAT_PER_LEVEL_GROWTH`; go through `statAtLevelFor` whenever the key is
 * known, since PWR, DEF and VIT ride the paced curve.
 */
export function statAtLevel(base: DecimalSource, level: number, growth: number = STAT_PER_LEVEL_GROWTH): Decimal {
    const steps = Math.max(0, level - 1)
    const additive = D(base).add(STAT_PER_LEVEL_FLAT * steps)
    return decMax(MIN_STAT_VALUE, additive.mul(decPow(growth, steps)))
}

/**
 * `statAtLevel`, gated on whether the level curve touches this stat at all and, if it does,
 * on which of the two curves it rides.
 *
 * **LCK is not on either** (`STAT_SCALES_WITH_LEVEL`), so it comes back at its base value
 * however high the Hero climbs. That is the whole of the mechanism: crit chance is
 * `LCK × rate` clamped to 100%, and a stat on a geometric curve feeding a clamped output
 * means the clamp is reached on a schedule rather than earned.
 *
 * The floor still applies on the frozen path — a scaled-down base can land below
 * `MIN_STAT_VALUE` where the unscaled tier value would not have.
 */
export function statAtLevelFor(key: HqStatKey, base: DecimalSource, level: number): Decimal {
    if (STAT_SCALES_WITH_LEVEL[key]) return statAtLevel(base, level, statGrowthFor(key))
    return decMax(MIN_STAT_VALUE, D(base))
}

/**
 * Level-1 stat block for a Champion archetype.
 *
 * The Champion equivalent of `baseSpreadFor`, minus the delta accumulation — Champions never
 * touch the class tree (`champions-guild-gacha.md` §1), so there is no path to walk and no
 * specialization shift to inherit. Same `StatTier` vocabulary as the Hero's spread, which is
 * what keeps the two blocks directly comparable.
 */
export function archetypeSpread(archetype: ChampionArchetype): HqStatBlock {
    const definition = getArchetype(archetype)
    const block = {} as HqStatBlock
    for (const key of STAT_KEYS) {
        block[key] = D(Math.max(MIN_STAT_VALUE, tierValue(definition.spread[key]) * baseScaleFor(key)))
    }
    return block
}

/**
 * The §7 passive collection bonus, as a per-stat multiplier.
 *
 * Reads the **whole collection**, not the fielded party — a maxed Champion sitting in the
 * barracks still strengthens the Hero, which is what makes pulling broadly worth doing
 * alongside fielding well. Two separate reward loops, by design.
 *
 * Every archetype maps to a fixed stat or pair (Tank → DEF+VIT, Damage → PWR, Support →
 * IMP+LCK, Control → SPD), covering the Hero's six stats exactly once with no special case.
 */
export function collectionPassiveMultipliers(
    owned: readonly { archetype: ChampionArchetype; investment: number }[]
): Record<HqStatKey, number> {
    const multipliers = { pwr: 1, spd: 1, lck: 1, imp: 1, vit: 1, def: 1 }
    for (const copy of owned) {
        const bonus = championPassiveBonus(copy.investment)
        for (const key of getArchetype(copy.archetype).passiveStats) {
            multipliers[key] += bonus
        }
    }
    return multipliers
}

/** What one owned Champion adds to each of its archetype's Hero stats, as a fraction. */
export function championPassiveBonus(investment: number): number {
    return Math.max(0, investment) * CHAMPION_PASSIVE_PER_POINT
}

export function heroStatBlock(
    classId: HeroSnapshot['classId'],
    heroLevel: number,
    passive?: Record<HqStatKey, number>,
    /** Gear + Skill passives + Artifacts, already merged. */
    modifiers?: Record<HqStatKey, number>
): HqStatBlock {
    const base = baseSpreadFor(getClass(classId))
    const block = {} as HqStatBlock
    for (const key of STAT_KEYS) {
        block[key] = statAtLevelFor(key, base[key], heroLevel)
            .mul(passive?.[key] ?? 1)
            .mul(Math.max(0, modifiers?.[key] ?? 1))
    }
    return block
}

// ── Passive modifier scopes ────────────────────────────
//
// Three systems produce always-on modifier lines, and they differ only in *who* they reach. That
// distinction is the whole content of the two functions below; the summing itself is
// `modifiers.ts`.

/**
 * Hero-only lines: Gear (`gear-equipment.md` §1), equipped Skill passives (`skills-gacha.md` §1),
 * and the collection passives of every owned Skill and Artifact, equipped or not. None of these
 * touches a Champion, by design — Champions carry their own kits and their own progression, and
 * every collection passive in the game (Champions', Gear's, these two) reaches only the Hero.
 */
export function heroModifierTotals(hero: HeroSnapshot): ModifierTotals {
    const gear = hero.ownedGear ?? []
    const skills = hero.equippedSkills ?? []
    const ownedSkills = hero.ownedSkills ?? []
    const ownedArtifacts = hero.ownedArtifacts ?? []
    if (gear.length === 0 && skills.length === 0 && ownedSkills.length === 0 && ownedArtifacts.length === 0) {
        return noModifiers()
    }
    return sumModifiers([
        ...gearModifiers(gear, hero.equippedGear ?? {}),
        ...skillModifiers(skills),
        ...skillCollectionModifiers(ownedSkills),
        ...artifactCollectionModifiers(ownedArtifacts)
    ])
}

/**
 * Party-wide lines: equipped Artifacts (`artifacts-dig-site-gacha.md` §1) — "every equipped
 * Artifact's effect applies to the whole fielded party (Hero + all active Champions), not just
 * the Hero" — and the prestige shop's stat tracks (`open-items.md` #41).
 */
export function partyModifierTotals(hero: HeroSnapshot): ModifierTotals {
    const lines = [...artifactModifiers(hero.equippedArtifacts ?? []), ...shopStatModifiers(hero.shopStatLevels ?? {})]
    if (lines.length === 0) return noModifiers()
    return sumModifiers(lines)
}

/**
 * The economy rates every source feeds, as additive fractions.
 *
 * Additive rather than multiplicative across sources, per `gold-economy.md` §5 — no hard cap, with
 * magnitudes tuned so a maximal dedicated stack lands around ×3. Skills' Gold lines, Artifacts'
 * Fortune category and `hero.goldBonusPct` all land in the same sum.
 *
 * `offlineEfficiencyPct` is handed to `settle.offlineEfficiency` as an extra source, so it stacks
 * with the prestige-shop track *and* respects that track's 100% ceiling — Tycoon's Vault cannot
 * push a maxed player past 100%, which would be free income out of nothing.
 */
export function economyBonuses(hero: HeroSnapshot): {
    goldPct: number
    xpPct: number
    offlineEfficiencyPct: number
} {
    const totals = mergeTotals(heroModifierTotals(hero), partyModifierTotals(hero))
    return {
        goldPct: totals.goldPct + hero.goldBonusPct,
        xpPct: totals.xpPct,
        offlineEfficiencyPct: totals.offlineEfficiencyPct
    }
}

/**
 * Stat block for a fielded Champion.
 *
 * Two axes, deliberately: the **Hero's level** supplies unbounded growth through the same
 * `statAtLevel` curve the Hero rides, and the Champion's own rarity × investment supplies a
 * bounded multiplier it earns through the gacha. Without the first, a Champion's PWR falls
 * behind an exponential curve until mitigation clamps it to `MIN_DAMAGE`. Without the second,
 * pulling and starring Champions would not matter.
 */
export function championStatBlock(
    base: HqStatBlock,
    champion: ChampionSnapshot,
    heroLevel: number,
    /** Party-wide Artifact lines only. Gear and Skills are Hero-only and never reach here. */
    modifiers?: Record<HqStatKey, number>
): HqStatBlock {
    const scale = champion.rarityMultiplier * championInvestmentMultiplier(champion.investment)
    const block = {} as HqStatBlock
    for (const key of STAT_KEYS) {
        block[key] = decMax(
            MIN_STAT_VALUE,
            statAtLevelFor(key, base[key], heroLevel).mul(scale).mul(Math.max(0, modifiers?.[key] ?? 1))
        )
    }
    return block
}

/**
 * `(star × 10 + level)` runs 1 → 60. Identity at minimum, so an un-invested Champion is never a
 * penalty. The rate is `CHAMPION_INVESTMENT_PER_POINT`.
 */
export function championInvestmentMultiplier(investment: number): number {
    return 1 + Math.max(0, investment - 1) * CHAMPION_INVESTMENT_PER_POINT
}

/**
 * Resolve a stat block into combat-ready values.
 *
 * Takes the kit rather than the class node — `strikesPerAttack` was the only field it ever
 * read off `ClassNode`, and Champions carry the same property without being on the class
 * tree at all (`classes-and-combat.md` §5: "Champions never touch the 16-node class tree").
 *
 * `eva` defaults to 0: base EVA is 0 for every unit in the game and no class node grants
 * it. The parameter exists so Traits (Phase 4) don't reshape this signature.
 */
export function deriveUnitStats(
    block: HqStatBlock,
    kit: { strikesPerAttack: number; row: FormationRow; threat?: number },
    eva = 0,
    /**
     * Modifier lines that do **not** go through the stat block — crit, max HP, cooldowns,
     * reflect. Passed separately because each lands on a derived value rather than a stat: a
     * crit-chance bonus is not a LCK bonus, and a max-HP bonus is not a VIT bonus.
     */
    mods: ModifierTotals = noModifiers(),
    /** SPD for skill cooldowns: the same unit's SPD at level 1. Defaults to `block.spd`. */
    cooldownSpd: Decimal = block.spd
): UnitStats {
    const crit = critChanceFor(block.lck)
    return {
        pwr: block.pwr,
        def: block.def,
        maxHp: maxHpFor(block.vit).mul(Math.max(0, mods.maxHpFactor)),
        attacksPerSecond: attacksPerSecondFor(block.spd),
        spd: block.spd,
        cooldownSpd,
        strikesPerAttack: kit.strikesPerAttack,
        row: kit.row,
        threat: kit.threat ?? BASE_THREAT,
        // Still clamped to a probability: a stacked Precision Edge can reach 100% but not past it,
        // and LCK's own overflow-to-crit-damage valve is unaffected.
        critChance: Math.min(1, Math.max(0, crit.critChance + mods.critChanceBonus)),
        critMultiplier: critMultiplierFor(block.lck, block.imp).add(mods.critDamageBonus),
        eva,
        cooldownFactor: mods.cooldownFactor,
        reflectFraction: mods.reflectFraction,
        controlResist: mods.controlResist
    }
}

/**
 * The fielded party, Hero first.
 *
 * Three modifier scopes meet here, and the split is what the docs actually say rather than a
 * convenience: **Artifacts reach everyone** (party-wide, §1 there), **Gear and Skills reach only
 * the Hero** (both Hero-only by their own §1s), and the **Champion collection passive reaches only
 * the Hero** too (`champions-guild-gacha.md` §7). So the Hero receives the merge of both scopes
 * and each Champion receives the party-wide one.
 */
export function partyUnitStats(hero: HeroSnapshot): UnitStats[] {
    const node = getClass(hero.classId)
    // The passive reads the whole collection; only the Hero receives it (§7).
    const passive = collectionPassiveMultipliers(hero.ownedChampions ?? [])
    const partyWide = partyModifierTotals(hero)
    const heroTotals = mergeTotals(heroModifierTotals(hero), partyWide)

    const units = [deriveUnitStats(
        heroStatBlock(hero.classId, hero.heroLevel, passive, heroTotals.stats),
        {
            strikesPerAttack: node.strikesPerAttack,
            // The player's saved placement wins; the class node's suggestion is the fallback.
            row: hero.heroRow ?? node.defaultRow,
            threat: threatFor(hero.classId)
        },
        0,
        heroTotals,
        heroStatBlock(hero.classId, 1, passive, heroTotals.stats).spd
    )]

    for (const champion of hero.champions ?? []) {
        const spread = archetypeSpread(champion.archetype)
        units.push(deriveUnitStats(
            championStatBlock(spread, champion, hero.heroLevel, partyWide.stats),
            { ...champion, threat: archetypeThreat(champion.archetype) },
            0,
            partyWide,
            championStatBlock(spread, champion, 1, partyWide.stats).spd
        ))
    }
    return units
}

/**
 * The Warrior path's threat modifier (`classes-and-combat.md` §7), applied to every node on
 * it — Warrior, Barbarian, Berserker, Knight, Paladin — since the doc attributes it to the
 * path rather than to any single node's skill.
 */
export function threatFor(classId: HeroSnapshot['classId']): number {
    const onWarriorPath = classPath(classId).some(node => node.id === 'class_warrior')
    return onWarriorPath ? BASE_THREAT * TANK_THREAT_MULTIPLIER : BASE_THREAT
}

/** Tank is the party's aggro anchor (`champions-guild-gacha.md` §8.2); nobody else pulls. */
export function archetypeThreat(archetype: ChampionArchetype): number {
    return archetype === 'tank' ? BASE_THREAT * TANK_THREAT_MULTIPLIER : BASE_THREAT
}

export function sumStatBlocks(...blocks: HqStatBlock[]): HqStatBlock {
    const total = {} as HqStatBlock
    for (const key of STAT_KEYS) total[key] = ZERO
    for (const block of blocks) {
        for (const key of STAT_KEYS) {
            total[key] = total[key].add(block[key])
        }
    }
    return total
}
