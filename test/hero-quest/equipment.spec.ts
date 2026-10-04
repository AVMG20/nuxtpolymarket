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
    skillModifiers,
    skillPotency
} from '#shared/utils/hero-quest/content/skills'
import { artifactModifiers } from '#shared/utils/hero-quest/content/artifacts'
import { rateAt, wealthHoursFor } from '#shared/utils/hero-quest/settle'
import { wealthFactorFor } from '#shared/utils/hero-quest/combat'
import { scaleEffect } from '#shared/utils/hero-quest/effects'
import type { AbilityEffect } from '#shared/utils/hero-quest/effects'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import {
    SKILL_PASSIVE_MAGNITUDE,
    SKILL_POTENCY_PER_POINT,
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

    it('sums reducing kinds as fractions before turning them into a factor', () => {
        // Two 60% shreds compose to full penetration additively and only 84% multiplicatively.
        const totals = sumModifiers([
            { kind: 'enemyDefShred', magnitude: 0.6 },
            { kind: 'enemyDefShred', magnitude: 0.6 }
        ])
        expect(totals.enemyDefFactor).toBe(0)
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

    it('pays the full equipped bonus on top of the passive, only to the piece actually equipped', () => {
        const equipped = gearModifiers(owned, { weapon: 'gear_weapon_mythic' })
        const benched = gearModifiers(owned, {})
        // equipping adds a line and keeps the passive (additive since 2026-10-04)
        expect(benched).toHaveLength(1)
        expect(equipped).toHaveLength(2)
        expect(equipped[0]).toEqual(benched[0])
        expect(equipped[1]!.magnitude).toBeGreaterThan(benched[0]!.magnitude)
        expect(equipped.every(line => line.stat === 'pwr')).toBe(true)
    })

    it('pays a smaller passive for every owned piece, equipped or not', () => {
        // §3: an owned piece that is not equipped — even one stronger than what is worn — still
        // contributes, and equipping it never takes that away.
        expect(gearModifiers(owned, {})[0]!.magnitude).toBeGreaterThan(0)
    })

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
    it('reads equipped Passives only, and only their modifier lines', () => {
        const passive = skillModifiers([{ contentId: 'skill_iron_discipline', star: 0, level: 1 }])
        expect(passive).toHaveLength(1)
        expect(passive[0]!.stat).toBe('def')

        // An Active contributes nothing here — it fires, it does not modify.
        expect(skillModifiers([{ contentId: 'skill_quick_strike', star: 0, level: 1 }])).toHaveLength(0)
    })

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

    it('rises with every level and every star, and lands above 2x when maxed', () => {
        expect(skillPotency(0, 2)).toBeGreaterThan(skillPotency(0, 1))
        expect(skillPotency(1, 1)).toBeGreaterThan(skillPotency(0, 10))
        expect(skillPotency(5, 10)).toBeGreaterThan(2)
        // Derived from the scalar, not a second table: scalar 60 at +2% a point.
        expect(skillPotency(5, 10)).toBeCloseTo(1 + 59 * SKILL_POTENCY_PER_POINT, 10)
    })

    it('scales a Passive stat line by that copy own potency', () => {
        const fresh = skillModifiers([{ contentId: 'skill_iron_discipline', star: 0, level: 1 }])
        const maxed = skillModifiers([{ contentId: 'skill_iron_discipline', star: 5, level: 10 }])
        expect(fresh[0]!.magnitude).toBe(SKILL_PASSIVE_MAGNITUDE[0]!)
        expect(maxed[0]!.magnitude).toBeCloseTo(SKILL_PASSIVE_MAGNITUDE[0]! * skillPotency(5, 10), 10)
    })

    it('scales economy lines too, without escaping the Gold throttle', () => {
        // A levelled Merchant's Eye is a better Merchant's Eye — but `SKILL_ECONOMY_COEFFICIENT`
        // is a factor on the base, so it still holds the Gold family under the combat lines at
        // every level rather than being outgrown by one.
        const maxedGold = skillModifiers([{ contentId: 'skill_merchants_eye', star: 5, level: 10 }])
        const maxedStat = skillModifiers([{ contentId: 'skill_fortified_resolve', star: 5, level: 10 }])
        expect(maxedGold[0]!.magnitude).toBeGreaterThan(
            skillModifiers([{ contentId: 'skill_merchants_eye', star: 0, level: 1 }])[0]!.magnitude
        )
        expect(maxedGold[0]!.magnitude).toBeLessThan(maxedStat[0]!.magnitude)
    })

    it('raises an Active damage multiplier and its status magnitude together', () => {
        const [fresh] = skillActives([{ contentId: 'skill_twin_strike', star: 0, level: 1 }])
        const [maxed] = skillActives([{ contentId: 'skill_twin_strike', star: 5, level: 10 }])
        const potency = skillPotency(5, 10)

        expect(maxed!.abilityMultiplier).toBeCloseTo(fresh!.abilityMultiplier * potency, 10)
        expect(maxed!.effect!.status!.magnitude!)
            .toBeCloseTo(fresh!.effect!.status!.magnitude! * potency, 10)
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

    it('scales a heal and a Gold burst, the two non-damage payloads', () => {
        const [freshHeal] = skillActives([{ contentId: 'skill_steadying_breath', star: 0, level: 1 }])
        const [maxedHeal] = skillActives([{ contentId: 'skill_steadying_breath', star: 5, level: 10 }])
        expect(maxedHeal!.effect!.heal!).toBeGreaterThan(freshHeal!.effect!.heal!)

        const [freshToss] = skillActives([{ contentId: 'skill_coin_toss', star: 0, level: 1 }])
        const [maxedToss] = skillActives([{ contentId: 'skill_coin_toss', star: 5, level: 10 }])
        expect(maxedToss!.effect!.goldBurstMinutes!)
            .toBeGreaterThan(freshToss!.effect!.goldBurstMinutes!)
    })

    it('moves the idle rate, so levelling is felt in farming and not only at a boss', () => {
        // A Passive and an Active, separately — the two mechanisms reach the rate by different
        // routes (`stats.ts` for one, `projection.ts` for the other).
        const withFreshPassive: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_iron_discipline', star: 0, level: 1 }]
        }
        const withMaxedPassive: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_iron_discipline', star: 5, level: 10 }]
        }
        expect(partyUnitStats(withMaxedPassive)[0]!.def.gt(partyUnitStats(withFreshPassive)[0]!.def))
            .toBe(true)

        const withFreshActive: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_quick_strike', star: 0, level: 1 }]
        }
        const withMaxedActive: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_quick_strike', star: 5, level: 10 }]
        }
        expect(rateAt(withMaxedActive, START).secondsPerKill)
            .toBeLessThan(rateAt(withFreshActive, START).secondsPerKill)
    })

    it('never makes a utility Active deal damage, however levelled', () => {
        // The pure-utility ones are authored at multiplier 0, and 0 x anything stays 0 — which is
        // what keeps a maxed Steadying Breath a heal rather than a heal that also swings.
        for (const contentId of ['skill_steadying_breath', 'skill_coin_toss']) {
            const [maxed] = skillActives([{ contentId, star: 5, level: 10 }])
            expect(maxed!.abilityMultiplier, contentId).toBe(0)
        }
    })
})

describe('scaleEffect', () => {
    it('returns the input untouched at potency 1, identity included', () => {
        // So an unlevelled copy allocates nothing.
        const effect: AbilityEffect = { target: 'enemy_single', heal: 1.5 }
        expect(scaleEffect(effect, 1)).toBe(effect)
    })

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

    it('leaves the target pattern and the boolean flags alone', () => {
        const scaled = scaleEffect({
            target: 'enemy_front_line', cleanse: true, alwaysCrits: true, hits: 4, extendDebuffs: 6
        }, 3)
        expect(scaled.target).toBe('enemy_front_line')
        expect(scaled.cleanse).toBe(true)
        expect(scaled.alwaysCrits).toBe(true)
        expect(scaled.hits).toBe(4)
        expect(scaled.extendDebuffs).toBe(6)
    })
})

describe('artifacts', () => {
    const offense = [{ contentId: 'artifact_offense_10', star: 5, level: 10 }]

    it('produces one modifier line per effect line', () => {
        // A Mythic carries three (`RARITY_EFFECT_LINES`), so three lines land.
        expect(artifactModifiers(offense)).toHaveLength(3)
    })

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

    it('shreds the pack rather than hardening the party, where the effect says so', () => {
        // Shattering Blow and Defense Penetration land on `enemyDefFactor`, which `settle`
        // applies by making the pack softer — the "rewrite the inputs" trick, so pooled
        // mitigation picks the change up without learning that Artifacts exist.
        const shred = [{ contentId: 'artifact_offense_6', star: 5, level: 10 }]
        const hero: HeroSnapshot = { ...BARE, equippedArtifacts: shred }
        expect(rateAt(hero, START).abilities.enemyDefFactor).toBeLessThan(1)
    })

    it('carries Fortune lines into the economy rates', () => {
        const fortune: HeroSnapshot = {
            ...BARE,
            equippedArtifacts: [{ contentId: 'artifact_fortune_0', star: 5, level: 10 }]
        }
        expect(economyBonuses(fortune).goldPct).toBeGreaterThan(0)
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

    it('raises a wealth-scaled ability’s damage and leaves the rest alone', () => {
        const gambler: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_gamblers_strike', star: 0, level: 1 }]
        }
        const poor = rateAt({ ...gambler, wealthHours: 0 }, START).secondsPerKill
        const rich = rateAt({ ...gambler, wealthHours: 1e6 }, START).secondsPerKill
        expect(rich).toBeLessThan(poor)

        // An ordinary Active is untouched by banked Gold.
        const plain: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_quick_strike', star: 0, level: 1 }]
        }
        expect(rateAt({ ...plain, wealthHours: 1e6 }, START).secondsPerKill)
            .toBeCloseTo(rateAt({ ...plain, wealthHours: 0 }, START).secondsPerKill, 10)
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

    it('pays XP too, where the ability says so', () => {
        const ransom: HeroSnapshot = {
            ...BARE,
            equippedSkills: [{ contentId: 'skill_kings_ransom', star: 0, level: 1 }]
        }
        const { abilities } = rateAt(ransom, START)
        expect(abilities.goldFactor).toBeGreaterThan(1)
        expect(abilities.xpFactor).toBeGreaterThan(1)
    })

    it('leaves both rates untouched for a Hero with nothing equipped', () => {
        const { abilities } = rateAt(BARE, START)
        expect(abilities.goldFactor).toBe(1)
        expect(abilities.xpFactor).toBe(1)
    })
})
