/**
 * How Gear, Skills and Artifacts actually reach the party.
 *
 * The content specs check that the rosters are *shaped* right; these check that owning and
 * equipping something changes a number. The three systems differ in exactly one way that matters
 * here — **scope** — and getting that wrong is silent: a Hero-only bonus leaking onto Champions
 * looks like a party that is simply stronger than it should be, with nothing to point at.
 *
 * | System | Reaches | Source |
 * |---|---|---|
 * | Gear | Hero only | `gear-equipment.md` §1 |
 * | Skill passives | Hero only | `skills-gacha.md` §1 |
 * | Artifacts | Hero **and** every fielded Champion | `artifacts-dig-site-gacha.md` §1 |
 */

import { describe, expect, it } from 'vitest'
import {
    economyBonuses,
    heroModifierTotals,
    partyModifierTotals,
    partyUnitStats
} from '#shared/utils/hero-quest/stats'
import { mergeTotals, noModifiers, sumModifiers } from '#shared/utils/hero-quest/modifiers'
import { gearModifiers } from '#shared/utils/hero-quest/content/gear'
import {
    skillActives,
    skillPotency
} from '#shared/utils/hero-quest/content/skills'
import { rateAt, wealthHoursFor } from '#shared/utils/hero-quest/settle'
import { wealthFactorFor } from '#shared/utils/hero-quest/combat'
import { scaleEffect } from '#shared/utils/hero-quest/effects'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import {
    WEALTH_FACTOR_MAX,
    WEALTH_FACTOR_MIN,
    WEALTH_NEUTRAL_HOURS
} from '#shared/utils/hero-quest/constants'
import type { ChampionSnapshot, HeroSnapshot, RunPosition } from '#shared/utils/hero-quest/types'

const BARE: HeroSnapshot = {
    classId: 'class_beginner',
    heroLevel: 10,
    heroXp: ZERO,
    goldBonusPct: 0,
    offlineEfficiencyLevel: 0,
    offlineCapLevel: 0
}

/** A Common Damage Champion with one ability, so the party is genuinely two units. */
const CHAMPION: ChampionSnapshot = {
    championId: 'champ_rask',
    archetype: 'damage',
    rarityMultiplier: 1,
    investment: 1,
    strikesPerAttack: 1,
    row: 'back',
    abilities: []
}

const START: RunPosition = { prestige: 0, world: 1, stage: 1, killsInStage: 0 }
/** Mature, so the Gold tenure ceiling never sets the rate these specs denominate against. */
const WEALTH_TENURE_DAYS = 3650

describe('modifier summing', () => {
    it('stacks same-kind lines additively, not multiplicatively', () => {
        // `artifacts-dig-site-gacha.md` §4 locks additive stacking, and the difference is not
        // cosmetic: two +50% PWR lines are ×2.0 additively and ×2.25 multiplicatively.
        const totals = sumModifiers([
            { kind: 'stat', stat: 'pwr', magnitude: 0.5 },
            { kind: 'stat', stat: 'pwr', magnitude: 0.5 }
        ])
        expect(totals.stats.pwr).toBeCloseTo(2, 10)
    })

    it('never lets a reducing kind invert past zero', () => {
        const totals = sumModifiers([{ kind: 'damageTaken', magnitude: 3 }])
        expect(totals.damageTakenFactor).toBe(0)
    })

    it('merges two scopes without double-counting the identity', () => {
        // Each side carries `1 + Σfractions`, so the fractions add and the 1 is counted once.
        // Multiplying instead would make Gear and Artifacts compound against each other.
        const a = sumModifiers([{ kind: 'stat', stat: 'pwr', magnitude: 0.5 }])
        const b = sumModifiers([{ kind: 'stat', stat: 'pwr', magnitude: 0.5 }])
        expect(mergeTotals(a, b).stats.pwr).toBeCloseTo(2, 10)
    })

    it('is the identity when nothing is owned or equipped', () => {
        expect(sumModifiers([])).toEqual(noModifiers())
        expect(heroModifierTotals(BARE)).toEqual(noModifiers())
        expect(partyModifierTotals(BARE)).toEqual(noModifiers())
    })
})

describe('gear', () => {
    const owned = [{ contentId: 'gear_weapon_mythic', star: 5, level: 10 }]

    it('ignores an equipped id the player does not own', () => {
        // The equipped map is client-writable state; a piece named there but never pulled must
        // not pay out. `loadout/set` validates ownership, and this is the second line.
        const forged = gearModifiers(owned, { helmet: 'gear_helmet_mythic' })
        expect(forged).toHaveLength(1)
        expect(forged[0]!.stat).toBe('pwr')
    })

    it('reaches the Hero and never a Champion', () => {
        const hero: HeroSnapshot = {
            ...BARE,
            champions: [CHAMPION],
            ownedGear: owned,
            equippedGear: { weapon: 'gear_weapon_mythic' }
        }
        const [heroUnit, championUnit] = partyUnitStats(hero)
        const [bareHero, bareChampion] = partyUnitStats({ ...BARE, champions: [CHAMPION] })

        expect(heroUnit!.pwr.gt(bareHero!.pwr)).toBe(true)
        expect(championUnit!.pwr.eq(bareChampion!.pwr)).toBe(true)
    })
})

describe('skills', () => {
    it('reaches the Hero and never a Champion', () => {
        // `skills-gacha.md` §1: "Hero-only. Champions already have their own separate, fixed
        // ability kits — this system never touches Champions."
        const hero: HeroSnapshot = {
            ...BARE,
            champions: [CHAMPION],
            equippedSkills: [{ contentId: 'skill_iron_discipline', star: 0, level: 1 }]
        }
        const [heroUnit, championUnit] = partyUnitStats(hero)
        const [bareHero, bareChampion] = partyUnitStats({ ...BARE, champions: [CHAMPION] })

        expect(heroUnit!.def.gt(bareHero!.def)).toBe(true)
        expect(championUnit!.def.eq(bareChampion!.def)).toBe(true)
    })

    it('routes economy passives into the run rates rather than into stats', () => {
        const hero: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_emperors_treasury', star: 0, level: 1 }]
        }
        const economy = economyBonuses(hero)
        expect(economy.goldPct).toBeGreaterThan(0)
        expect(economy.xpPct).toBeGreaterThan(0)
        expect(economy.offlineEfficiencyPct).toBeGreaterThan(0)

        // …and left the stat block alone.
        expect(partyUnitStats(hero)[0]!.pwr.eq(partyUnitStats(BARE)[0]!.pwr)).toBe(true)
    })

    it('adds an equipped Active to the idle rate, not only to boss fights', () => {
        // The gap `projection.ts` was built to close: an ability that only fires in `fight.ts`
        // does nothing during the ~97% of playtime that is idle wave farming.
        const withActive: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_quick_strike', star: 0, level: 1 }]
        }
        expect(rateAt(withActive, START).secondsPerKill)
            .toBeLessThan(rateAt(BARE, START).secondsPerKill)
    })
})

/**
 * A levelled Skill copy is stronger than a freshly-pulled one.
 *
 * `gacha-shared-system.md` §6 makes `(star × 10 + level)` the universal per-copy power scalar;
 * without potency, the dupes spent maxing a Skill would buy nothing.
 *
 * The shape is **identity at minimum**, which is the load-bearing choice: a 0★/Lv1 copy is exactly
 * §4's authored magnitude, so the doc's qualitative ladder stays the reference point. Artifacts'
 * *proportional* curve would instead have made a freshly-pulled Mythic 1/60th of its own described
 * strength.
 */
describe('skill potency', () => {
    it('is exactly 1.0 for a freshly-pulled copy', () => {
        // So §4's authored bands remain the reference.
        expect(skillPotency(0, 1)).toBe(1)
    })

    it('leaves cooldown, duration and stack counts alone', () => {
        // Levelling makes a skill stronger, not faster or longer. Cadence is SPD's job and
        // Tempo's; scaling duration as well would double-count levelling, because the idle
        // projection already prices a status at `duration / cooldown` uptime.
        const [fresh] = skillActives([{ contentId: 'skill_twin_strike', star: 0, level: 1 }])
        const [maxed] = skillActives([{ contentId: 'skill_twin_strike', star: 5, level: 10 }])

        expect(maxed!.cooldownSeconds).toBe(fresh!.cooldownSeconds)
        expect(maxed!.effect!.status!.duration).toBe(fresh!.effect!.status!.duration)
        expect(maxed!.effect!.status!.stacks).toBe(fresh!.effect!.status!.stacks)
    })

    it('keeps the id stable across levels, so a re-applied status refreshes rather than stacking', () => {
        // `fight.ts` keys status instances off the skill id. A per-level id would make a levelled
        // burn stack against itself.
        const [fresh] = skillActives([{ contentId: 'skill_twin_strike', star: 0, level: 1 }])
        const [maxed] = skillActives([{ contentId: 'skill_twin_strike', star: 5, level: 10 }])
        expect(maxed!.id).toBe(fresh!.id)
    })
})

describe('scaleEffect', () => {
    it('clamps a scaled revive at full HP', () => {
        // A revive above max HP is not a stronger revive.
        const revive = scaleEffect({ target: 'ally_all', revive: 0.8 }, 5)
        expect(revive.revive).toBe(1)
    })

    it('scales an escalation payload but never its stack threshold', () => {
        // Scaling the threshold would make a levelled Frostbind *slower* to freeze.
        const scaled = scaleEffect({
            target: 'enemy_single',
            status: { kind: 'debuff', stat: 'spd', duration: 6, magnitude: 0.2, stacks: 1 },
            escalation: { atStacks: 3, status: { kind: 'dot', duration: 2, magnitude: 0.4 } }
        }, 2)
        expect(scaled.escalation!.atStacks).toBe(3)
        expect(scaled.escalation!.status.magnitude).toBeCloseTo(0.8, 10)
        expect(scaled.status!.stacks).toBe(1)
    })
})

describe('artifacts', () => {
    const offense = [{ contentId: 'artifact_offense_10', star: 5, level: 10 }]

    it('reaches the Hero and every fielded Champion — the one party-wide system', () => {
        const hero: HeroSnapshot = {
            ...BARE,
            champions: [CHAMPION],
            equippedArtifacts: offense
        }
        const [heroUnit, championUnit] = partyUnitStats(hero)
        const [bareHero, bareChampion] = partyUnitStats({ ...BARE, champions: [CHAMPION] })

        expect(heroUnit!.pwr.gt(bareHero!.pwr)).toBe(true)
        expect(championUnit!.pwr.gt(bareChampion!.pwr)).toBe(true)
    })

    it('shortens cooldowns through its own factor rather than through SPD', () => {
        // Tempo's cooldown lines must not speed up autoattacks, which SPD also drives. Keeping
        // them on a separate multiplicand is what preserves that distinction.
        const tempo: HeroSnapshot = {
            ...BARE,
            equippedArtifacts: [{ contentId: 'artifact_tempo_1', star: 5, level: 10 }]
        }
        const [unit] = partyUnitStats(tempo)
        const [bare] = partyUnitStats(BARE)
        expect(unit!.cooldownFactor).toBeLessThan(1)
        expect(unit!.attacksPerSecond).toBeCloseTo(bare!.attacksPerSecond, 10)
    })
})

describe('the wealth factor', () => {
    it('passes through 1.0 at the neutral point and clamps at both ends', () => {
        expect(wealthFactorFor(WEALTH_NEUTRAL_HOURS)).toBeCloseTo(1, 10)
        expect(wealthFactorFor(0)).toBe(WEALTH_FACTOR_MIN)
        expect(wealthFactorFor(1e9)).toBe(WEALTH_FACTOR_MAX)
    })

    it('is exactly neutral for a caller that supplies nothing', () => {
        // A caller that knows nothing about banked Gold gets the neutral factor.
        expect(wealthFactorFor(undefined)).toBe(1)
    })

    it('reads banked hours against a wealth-neutral rate, so it never depends on itself', () => {
        // One fixed-point iteration, stated rather than hidden — see `wealthHoursFor`. What this
        // pins is that the *input* is stable: the same banked Gold gives the same hours whether
        // or not the Hero happens to carry a wealth-scaled skill. Read at a mature tenure, so the
        // Gold rate it denominates against is progression's and not the tenure ceiling's.
        const gambler: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_gamblers_strike', star: 0, level: 1 }]
        }
        const hours = wealthHoursFor(gambler, START, 1_000_000, WEALTH_TENURE_DAYS)
        expect(hours).toBeGreaterThan(0)
        expect(wealthHoursFor({ ...gambler, wealthHours: 999 }, START, 1_000_000, WEALTH_TENURE_DAYS)).toBeCloseTo(hours, 10)
    })

    it('reads zero hours for an empty balance rather than dividing by nothing', () => {
        expect(wealthHoursFor(BARE, START, 0, WEALTH_TENURE_DAYS)).toBe(0)
        expect(wealthHoursFor(BARE, START, Number.NaN, WEALTH_TENURE_DAYS)).toBe(0)
    })
})

describe('gold and xp bursts', () => {
    it('turn a per-cast lump into a rate, denominated in minutes of income', () => {
        // `gold-economy.md` §6: a burst is a duration of current income, never a flat amount, so
        // it is correctly sized at every point on the curve with no per-stage retuning.
        const coinToss: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_coin_toss', star: 0, level: 1 }]
        }
        expect(rateAt(coinToss, START).abilities.goldFactor).toBeGreaterThan(1)
        expect(rateAt(coinToss, START).abilities.xpFactor).toBe(1)
    })

    it('leaves both rates untouched for a Hero with nothing equipped', () => {
        const { abilities } = rateAt(BARE, START)
        expect(abilities.goldFactor).toBe(1)
        expect(abilities.xpFactor).toBe(1)
    })
})
