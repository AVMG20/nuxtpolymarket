/**
 * Where every number on a unit comes from.
 *
 * `stats.ts` computes the party's stats; this re-walks the same pipeline and *records* each
 * step instead of collapsing it. Both surfaces that show a breakdown — the `--report=stats` sim
 * report and the in-game stat panel — render this one structure, so the two can never describe
 * the pipeline differently.
 *
 * ## The one thing that makes this worth having
 *
 * Every source is reported in **stages of enemy curve** as well as in its own units. That is the
 * only common denominator the game has: enemies grow `ENEMY_STEP_BASE^n` over one index `n`, and
 * a stat multiplier is worth however many steps of that it cancels. It converts the question
 * "is ×1.36 on this stat a lot?" — unanswerable — into "it is worth 4 stages", which is directly
 * comparable to the 100 stages a prestige loop costs.
 *
 * See `stagesOfCurve`. The conversion runs through `DPS_STAT_EXPONENT`, because damage rides the
 * stat curve more than once and a source that lifts every stat by 36% is worth more than 36%.
 *
 * ## Additive within a stage, multiplicative between stages
 *
 * ⚠ **This is the trap, and it is why per-source factors are not reported as multipliers.**
 * `sumModifiers` sums Gear, Skill and Artifact lines as *fractions* and converts once, and
 * `mergeTotals` composes two already-summed sets as `a + b - 1`. Gear +50% and a Skill +50% are
 * therefore ×2.00 together, not ×2.25. Reporting each source as its own multiplier and inviting
 * the reader to multiply them would overstate every stacked build. So a stage carries one factor
 * and itemises its sources as the additive percentages they actually are.
 *
 * Pure, like everything in `shared/`. It reads a `HeroSnapshot` and returns a description.
 */

import {
    CHAMPION_PASSIVE_PER_POINT,
    DPS_STAT_EXPONENT,
    ENEMY_STEP_BASE,
    HP_PER_VIT,
    BASE_HP,
    BASE_ATTACK_INTERVAL_SECONDS,
    CRIT_CHANCE_PER_POINT,
    CRIT_DAMAGE_PER_POINT,
    MIN_ATTACK_INTERVAL_SECONDS,
    MIN_STAT_VALUE,
    SPD_ATTACK_RATE_PER_POINT,
    STAT_PER_LEVEL_FLAT,
    STAT_PER_LEVEL_GROWTH,
    STAT_PER_LEVEL_GROWTH_PACED,
    STAT_SCALES_WITH_LEVEL
} from './constants'
import { classPath, getClass } from './content/classes'
import { getArchetype } from './content/champions'
import { gearModifiers } from './content/gear'
import { skillCollectionModifiers, skillModifiers } from './content/skills'
import { artifactCollectionModifiers, artifactModifiers } from './content/artifacts'
import { shopStatModifiers } from './content/shop'
import {
    baseScaleFor,
    championInvestmentMultiplier,
    collectionPassiveMultipliers,
    heroModifierTotals,
    partyModifierTotals,
    partyUnitStats,
    statGrowthFor,
    tierValue
} from './stats'
import { mergeTotals, sumModifiers } from './modifiers'
import { D, ONE, decPow, formatHq } from './numbers'
import type { Decimal } from './numbers'
import type { ChampionSnapshot, HeroSnapshot, HqStatKey, StatTier, UnitStats } from './types'

const STAT_KEYS: readonly HqStatKey[] = ['pwr', 'spd', 'lck', 'imp', 'vit', 'def']

export const STAT_LABELS: Readonly<Record<HqStatKey, string>> = {
    pwr: 'Power',
    def: 'Defence',
    vit: 'Vitality',
    spd: 'Speed',
    lck: 'Luck',
    imp: 'Impact'
}

/**
 * What one multiplier is worth in stages of the enemy curve.
 *
 *     enemyMultiplier(n) = ENEMY_STEP_BASE^n          (settle.ts)
 *     DPS                ∝ statFactor^DPS_STAT_EXPONENT
 *     ⇒ stages = ln(factor^exponent) / ln(ENEMY_STEP_BASE)
 *
 * `exponent` defaults to `DPS_STAT_EXPONENT` because that is what a source lifting *every* stat
 * is worth. Pass 1 for a source that lifts a single stat, which buys proportionally less.
 *
 * ⚠ `DPS_STAT_EXPONENT` is the *asymptotic* 2, true once attack rate has hit its ceiling;
 * below it SPD scales too and the real exponent is nearer 3. So this **understates** early-game
 * sources.
 */
export function stagesOfCurve(factor: Decimal | number, exponent = DPS_STAT_EXPONENT): number {
    const value = D(factor)
    if (!value.isFinite() || value.lte(0)) return 0
    return value.ln().toNumber() * exponent / Math.log(ENEMY_STEP_BASE)
}

/** One additive component inside a stage. `amount` is a fraction (+0.3 = +30%). */
export interface StatPart {
    label: string
    amount: number
}

export type StageId = 'base' | 'level' | 'collection' | 'investment' | 'passives'

export interface StatStage {
    id: StageId
    label: string
    /** For `base`, the absolute starting value. For every other stage, a multiplier. */
    factor: Decimal
    /** The stat's value after this stage. */
    running: Decimal
    /**
     * No ceiling. At most one stage per stat is unbounded — the level curve — and naming which
     * is the whole point of the breakdown: everything else is a fixed multiplier on a moving
     * number, so no amount of it changes the *shape* of the run.
     *
     * **LCK has none at all.** `STAT_SCALES_WITH_LEVEL` holds it at its base value, so every one
     * of its stages is bounded and the stat has no compounding source whatsoever — which is
     * itself the most important thing this breakdown can say about crit chance.
     */
    unbounded: boolean
    /** The additive sources that produced `factor`, when more than one can. */
    parts: StatPart[]
    /** Rendered with this unit's actual numbers substituted. */
    formula: string
    /**
     * The pipeline's `MIN_STAT_VALUE` floor bound here, so `running` is the floor rather than
     * `previous × factor`. Only a Champion's chain can floor — `championStatBlock` clamps its
     * result and `heroStatBlock` does not.
     */
    floored?: true
}

export interface StatBreakdown {
    key: HqStatKey
    label: string
    /** The authored tier this class or archetype declares for the stat. */
    tier: StatTier
    stages: StatStage[]
    final: Decimal
    /** What this stat's total multiplier over its base is worth against the enemy curve. */
    stagesOfCurve: number
}

export interface DerivedBreakdown {
    key: string
    label: string
    value: string
    /** The formula with real numbers in it, not symbols. */
    formula: string
    /**
     * Why this value is not simply what the formula says — sitting on a cap, or dominated by a
     * flat term. Both are scaling answers by themselves, which is why they are surfaced rather
     * than left for the reader to spot in the arithmetic.
     */
    note?: string
}

export interface UnitBreakdown {
    label: string
    /** `null` for the Hero, the archetype for a Champion. */
    role: string | null
    heroLevel: number
    stats: StatBreakdown[]
    derived: DerivedBreakdown[]
}

export interface StatsExplanation {
    heroLevel: number
    units: UnitBreakdown[]
    /** Cross-cutting pacing facts, the same for every unit. */
    pacing: {
        statGrowthPerLevel: number
        /** PWR, DEF and VIT — the curve that paces the enemy exactly (`STAT_PACES_ENEMY_CURVE`). */
        defenceGrowthPerLevel: number
        enemyStepBase: number
        dpsStatExponent: number
        /** Stages of enemy curve one hero level buys. `STAT_PACE_RATIO` by construction. */
        stagesPerLevel: number
        /** Levels needed to cover one stage. The reciprocal, which is the readable direction. */
        levelsPerStage: number
    }
}

// ── The stat stages ────────────────────────────────────────────────────────────────────

/**
 * The level-1 number, itemised.
 *
 * `baseSpreadFor` folds the tier value and every specialization delta on the class path into one
 * integer. Re-derived here with the parts kept, because "Berserker has PWR 22" is much less
 * useful than "mid 10, +4 Warrior, +8 Berserker" when the question is whether a spread is doing
 * what its author meant.
 */
function baseStage(key: HqStatKey, tier: StatTier, deltaSources: readonly { name: string; delta: number }[]): StatStage {
    const tierPoints = tierValue(tier)
    const parts: StatPart[] = [{ label: `${tier} spread`, amount: tierPoints }]
    let raw = tierPoints
    for (const source of deltaSources) {
        if (source.delta === 0) continue
        parts.push({ label: `${source.name} specialization`, amount: source.delta })
        raw += source.delta
    }

    // The per-stat scalar (`LCK_BASE_SCALE`, and nothing else today) is multiplicative, but every
    // other part of this stage is in points. Carrying it as the *points it removed* keeps the
    // "parts sum to the value" invariant true for all six stats; the formula below is where the
    // multiplication is actually shown, so nobody has to reverse-engineer -4 back into ×0.75.
    const scale = baseScaleFor(key)
    const scaled = raw * scale
    if (scale !== 1) parts.push({ label: `base scale ×${scale}`, amount: scaled - raw })

    const total = Math.max(MIN_STAT_VALUE, scaled)
    const points = parts.slice(0, scale === 1 ? undefined : -1)
        .map(part => (part.amount < 0 ? `- ${-part.amount}` : `+ ${part.amount}`))
        .join(' ').replace(/^\+ /, '')
    return {
        id: 'base',
        label: 'Base spread',
        factor: D(total),
        running: D(total),
        unbounded: false,
        parts,
        formula: (scale === 1 ? points : `(${points}) × ${scale}`)
            + (total !== scaled ? ` → floored to ${MIN_STAT_VALUE}` : '')
    }
}

/**
 * The only unbounded stage there is — for the five stats that have one.
 *
 * LCK does not: `STAT_SCALES_WITH_LEVEL` excludes it, so this reports an explicit ×1 rather than
 * omitting the stage. Keeping the stage list the same shape for every stat is what lets the
 * report be read as a table, and "Level 200 · ×1.0000" states the fact that levelling buys this
 * stat nothing far more plainly than a missing column would.
 *
 * PWR, DEF and VIT ride `STAT_PER_LEVEL_GROWTH_PACED` (`statGrowthFor`) and SPD and IMP the
 * ordinary curve, so the formula's base can differ between them (they coincide while
 * `XP_PACE_SLACK` is 1.0).
 */
function levelStage(key: HqStatKey, base: Decimal, heroLevel: number): StatStage {
    if (!STAT_SCALES_WITH_LEVEL[key]) {
        return {
            id: 'level',
            label: `Level ${heroLevel}`,
            factor: ONE,
            running: base,
            unbounded: false,
            parts: [],
            formula: 'off the level curve — only the collection passive, Gear, Skills and Artifacts raise this'
        }
    }

    const growth = statGrowthFor(key)
    const steps = Math.max(0, heroLevel - 1)
    const additive = base.add(STAT_PER_LEVEL_FLAT * steps)
    const factor = decPow(growth, steps)
    return {
        id: 'level',
        label: `Level ${heroLevel}`,
        factor,
        running: additive.mul(factor),
        unbounded: true,
        parts: STAT_PER_LEVEL_FLAT === 0
            ? []
            : [{ label: `flat +${STAT_PER_LEVEL_FLAT}/level`, amount: STAT_PER_LEVEL_FLAT * steps }],
        formula: `${growth.toFixed(6)}^${steps}`
    }
}

/**
 * The §7 collection passive — owned Champions, not fielded ones.
 *
 * Grouped by archetype rather than listed per copy, because the archetype is what decides which
 * stat a copy feeds and a 48-line list answers nothing.
 */
function collectionStage(running: Decimal, hero: HeroSnapshot, key: HqStatKey): StatStage {
    const byArchetype = new Map<string, { copies: number; points: number }>()
    for (const copy of hero.ownedChampions ?? []) {
        if (!getArchetype(copy.archetype).passiveStats.includes(key)) continue
        const entry = byArchetype.get(copy.archetype) ?? { copies: 0, points: 0 }
        entry.copies++
        entry.points += Math.max(0, copy.investment)
        byArchetype.set(copy.archetype, entry)
    }

    const parts: StatPart[] = [...byArchetype].map(([archetype, entry]) => ({
        label: `${entry.copies} ${archetype} ${entry.copies === 1 ? 'copy' : 'copies'}`,
        amount: entry.points * CHAMPION_PASSIVE_PER_POINT
    }))

    /**
     * ⚠ The factor comes from `collectionPassiveMultipliers`, not from summing `parts`.
     *
     * That function accumulates one copy at a time and this groups by archetype, so
     * `(i₁ + i₂) × rate` and `i₁ × rate + i₂ × rate` disagree in the last float bit. Re-deriving
     * would make the breakdown's final stat differ from the game's in the last digit, which is
     * exactly the class of "close enough" that makes a diagnostic untrustworthy. `parts` is for
     * reading; the factor is the real one.
     */
    const factor = D(collectionPassiveMultipliers(hero.ownedChampions ?? [])[key])
    return {
        id: 'collection',
        label: 'Champion collection',
        factor,
        running: running.mul(factor),
        unbounded: false,
        parts,
        formula: `1 + ${factor.sub(1).toNumber().toFixed(4)}`
    }
}

/** A Champion's own rarity × investment. The Hero has no equivalent. */
function investmentStage(running: Decimal, champion: ChampionSnapshot): StatStage {
    const invest = championInvestmentMultiplier(champion.investment)
    const factor = D(champion.rarityMultiplier * invest)
    return {
        id: 'investment',
        label: 'Rarity × investment',
        factor,
        running: running.mul(factor),
        unbounded: false,
        parts: [
            { label: 'rarity', amount: champion.rarityMultiplier - 1 },
            { label: `investment ${champion.investment}`, amount: invest - 1 }
        ],
        formula: `${champion.rarityMultiplier} × ${invest.toFixed(4)}`
    }
}

/**
 * Gear, Skill passives and Artifacts, as the one additive sum they actually are.
 *
 * The three are separated in `parts` only — the *factor* is `1 + Σ`, never a product. See this
 * module's header for why that distinction is not presentational.
 */
function passiveStage(
    running: Decimal,
    key: HqStatKey,
    factor: Decimal,
    sources: readonly { label: string; pct: number }[]
): StatStage {
    // Same rule as `collectionStage`: `sources` itemises, `factor` is the number the game used.
    return {
        id: 'passives',
        label: 'Gear / Skills / Artifacts',
        factor,
        running: running.mul(factor),
        unbounded: false,
        parts: sources.map(source => ({ label: source.label, amount: source.pct })),
        formula: `1 ${sources.map(s => `${s.pct < 0 ? '-' : '+'} ${Math.abs(s.pct).toFixed(4)}`).join(' ')}`.trim()
    }
}

// ── Assembling a unit ──────────────────────────────────────────────────────────────────

function derivedFor(unit: UnitStats, block: Record<HqStatKey, Decimal>): DerivedBreakdown[] {
    const interval = 1 / unit.attacksPerSecond
    const flatShare = BASE_HP / (BASE_HP + block.vit.mul(HP_PER_VIT).toNumber())
    return [
        {
            key: 'maxHp',
            label: 'Max HP',
            value: formatHq(unit.maxHp),
            formula: `(BASE_HP ${BASE_HP} + vit ${block.vit.toFixed(2)} × ${HP_PER_VIT}) × maxHpFactor`,
            // The one place a *flat* constant meets the compounding curve, so it is worth saying
            // out loud which of the two is currently carrying the pool.
            note: flatShare >= 0.5
                ? `flat BASE_HP is ${(flatShare * 100).toFixed(0)}% of this pool — VIT is not carrying it yet`
                : undefined
        },
        {
            key: 'attacksPerSecond',
            label: 'Attacks / second',
            value: unit.attacksPerSecond.toFixed(3),
            formula: `1 / clamp(${BASE_ATTACK_INTERVAL_SECONDS} / (1 + spd ${block.spd.toFixed(2)} × ${SPD_ATTACK_RATE_PER_POINT}))`,
            note: interval <= MIN_ATTACK_INTERVAL_SECONDS + 1e-9
                ? 'at the MIN_ATTACK_INTERVAL_SECONDS ceiling — more SPD buys nothing here'
                : undefined
        },
        {
            key: 'critChance',
            label: 'Crit chance',
            value: `${(unit.critChance * 100).toFixed(1)}%`,
            formula: `lck ${block.lck.toFixed(2)} × ${CRIT_CHANCE_PER_POINT} + modifiers`,
            // Two different "this number is not what the formula suggests" cases, and the second
            // is the one people will actually hit: a Hero who levels for an hour and sees crit
            // chance sit exactly still is looking at design, not at a bug.
            note: unit.critChance >= 1
                ? 'at 100% — further LCK converts at OVERFLOW_CONVERSION_RATE instead'
                : STAT_SCALES_WITH_LEVEL.lck
                    ? undefined
                    : 'LCK is off the level curve — levelling will not move this, only the collection passive and LCK lines will'
        },
        {
            key: 'critMultiplier',
            label: 'Crit multiplier',
            value: `×${unit.critMultiplier.toFixed(2)}`,
            formula: `1 + imp ${block.imp.toFixed(2)} × ${CRIT_DAMAGE_PER_POINT} + LCK overflow`
        },
        {
            key: 'strikesPerAttack',
            label: 'Strikes / attack',
            value: String(unit.strikesPerAttack),
            formula: 'baked into the kit, not a stat'
        },
        {
            key: 'cooldownFactor',
            label: 'Cooldown factor',
            value: `×${unit.cooldownFactor.toFixed(3)}`,
            formula: '1 - Σ cooldown lines, before SPD shortens each cooldown further'
        }
    ]
}

function statBreakdowns(
    tiers: Record<HqStatKey, StatTier>,
    deltasFor: (key: HqStatKey) => { name: string; delta: number }[],
    heroLevel: number,
    extraStages: (key: HqStatKey, running: Decimal) => StatStage[],
    /** `championStatBlock` clamps its result to `MIN_STAT_VALUE`; `heroStatBlock` does not. */
    floorsResult: boolean
): StatBreakdown[] {
    return STAT_KEYS.map((key) => {
        const stages: StatStage[] = [baseStage(key, tiers[key], deltasFor(key))]
        stages.push(levelStage(key, stages[0]!.running, heroLevel))
        for (const stage of extraStages(key, stages.at(-1)!.running)) stages.push(stage)

        const last = stages.at(-1)!
        if (floorsResult && last.running.lt(MIN_STAT_VALUE)) {
            last.running = D(MIN_STAT_VALUE)
            last.floored = true
        }

        const final = last.running
        const growth = final.div(stages[0]!.running)
        return {
            key,
            label: STAT_LABELS[key],
            tier: tiers[key],
            stages,
            final,
            stagesOfCurve: stagesOfCurve(growth, 1)
        }
    })
}

/**
 * Gear / Skills / Artifacts split into the three sums the panel itemises.
 *
 * On the Hero, the Skills and Artifacts rows each include that system's collection passive — the
 * every owned copy's share — so every source the Hero's stat actually received is itemised.
 * A Champion row shows equipped Artifacts only, because collection passives never reach one.
 */
function passiveSources(hero: HeroSnapshot, key: HqStatKey, partyWideOnly: boolean) {
    const equippedArtifacts = hero.equippedArtifacts ?? []
    const shop = { label: 'Prestige shop', pct: sumModifiers(shopStatModifiers(hero.shopStatLevels ?? {})).stats[key] - 1 }
    if (partyWideOnly) {
        return [{ label: 'Artifacts', pct: sumModifiers(artifactModifiers(equippedArtifacts)).stats[key] - 1 }, shop]
    }

    const equippedSkills = hero.equippedSkills ?? []
    const gear = sumModifiers(gearModifiers(hero.ownedGear ?? [], hero.equippedGear ?? {}))
    const skills = sumModifiers([
        ...skillModifiers(equippedSkills),
        ...skillCollectionModifiers(hero.ownedSkills ?? [])
    ])
    const artifacts = sumModifiers([
        ...artifactModifiers(equippedArtifacts),
        ...artifactCollectionModifiers(hero.ownedArtifacts ?? [])
    ])
    return [
        { label: 'Gear', pct: gear.stats[key] - 1 },
        { label: 'Skills', pct: skills.stats[key] - 1 },
        { label: 'Artifacts', pct: artifacts.stats[key] - 1 },
        shop
    ]
}

/**
 * The whole fielded party, Hero first — the same order and the same three modifier scopes
 * `partyUnitStats` uses, and the derived values are read straight off its output rather than
 * recomputed, so a breakdown can never disagree with the stats the game actually fights with.
 */
export function explainStats(hero: HeroSnapshot): StatsExplanation {
    const node = getClass(hero.classId)
    const units = partyUnitStats(hero)
    const path = classPath(hero.classId)
    const partyWide = partyModifierTotals(hero)

    const heroTotals = mergeTotals(heroModifierTotals(hero), partyModifierTotals(hero))
    const heroStats = statBreakdowns(
        node.spread,
        key => path.map(ancestor => ({ name: ancestor.name, delta: ancestor.delta[key] ?? 0 })),
        hero.heroLevel,
        (key, running) => {
            const collection = collectionStage(running, hero, key)
            return [collection, passiveStage(
                collection.running, key, D(heroTotals.stats[key]), passiveSources(hero, key, false)
            )]
        },
        false
    )

    const out: UnitBreakdown[] = [{
        label: node.name,
        role: null,
        heroLevel: hero.heroLevel,
        stats: heroStats,
        derived: derivedFor(units[0]!, blockOf(heroStats))
    }]

    ;(hero.champions ?? []).forEach((champion, index) => {
        const spread = getArchetype(champion.archetype).spread
        const stats = statBreakdowns(
            spread,
            // Champions never touch the class tree, so there is no path and no delta to inherit.
            () => [],
            hero.heroLevel,
            (key, running) => {
                const investment = investmentStage(running, champion)
                return [investment, passiveStage(
                    investment.running, key, D(partyWide.stats[key]), passiveSources(hero, key, true)
                )]
            },
            true
        )
        const unit = units[index + 1]
        if (!unit) return
        out.push({
            label: champion.championId,
            role: champion.archetype,
            heroLevel: hero.heroLevel,
            stats,
            derived: derivedFor(unit, blockOf(stats))
        })
    })

    const stagesPerLevel = stagesOfCurve(STAT_PER_LEVEL_GROWTH)
    return {
        heroLevel: hero.heroLevel,
        units: out,
        pacing: {
            statGrowthPerLevel: STAT_PER_LEVEL_GROWTH,
            defenceGrowthPerLevel: STAT_PER_LEVEL_GROWTH_PACED,
            enemyStepBase: ENEMY_STEP_BASE,
            dpsStatExponent: DPS_STAT_EXPONENT,
            stagesPerLevel,
            levelsPerStage: stagesPerLevel > 0 ? 1 / stagesPerLevel : Number.POSITIVE_INFINITY
        }
    }
}

function blockOf(stats: readonly StatBreakdown[]): Record<HqStatKey, Decimal> {
    const block = {} as Record<HqStatKey, Decimal>
    for (const key of STAT_KEYS) block[key] = ONE
    for (const stat of stats) block[stat.key] = stat.final
    return block
}

/**
 * How many hero levels it takes to cover `stages` of enemy curve — the inverse of
 * `pacing.stagesPerLevel`, and what answers "how far behind am I".
 */
export function levelsToCover(stages: number): number {
    const perLevel = stagesOfCurve(STAT_PER_LEVEL_GROWTH)
    return perLevel > 0 ? stages / perLevel : Number.POSITIVE_INFINITY
}
