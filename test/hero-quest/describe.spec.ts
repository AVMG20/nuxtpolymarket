import { describe, expect, it } from 'vitest'
import { CHAMPIONS, getChampion } from '#shared/utils/hero-quest/content/champions'
import { SKILLS, getSkill, skillActives } from '#shared/utils/hero-quest/content/skills'
import { describeAbility, describeWealth, hqNumber, hqPct, isWealthScaled, modifierLine } from '#shared/utils/hero-quest/describe'
import { wealthFactorFor } from '#shared/utils/hero-quest/combat'
import { GOLD_BURST_MINUTES, WEALTH_FACTOR_MAX, WEALTH_FACTOR_MIN, WEALTH_NEUTRAL_HOURS } from '#shared/utils/hero-quest/constants'
import { rarityIndex } from '#shared/utils/hero-quest/gacha'

/** Every number in a sentence, so a spec can say none carries more than two decimals. */
const numbersIn = (text: string) => text.match(/\d+(\.\d+)?/g) ?? []

describe('describe: numbers', () => {
    it('rounds to at most two decimals and drops trailing zeros', () => {
        expect(hqNumber(1.23456)).toBe('1.23')
        expect(hqNumber(2.5)).toBe('2.5')
        expect(hqNumber(3)).toBe('3')
        expect(hqNumber(-0.001)).toBe('0')
        expect(hqPct(0.123456)).toBe('12.35%')
        expect(hqPct(0.05)).toBe('5%')
    })

    it('prints a modifier line exactly, a reducing kind with a minus', () => {
        expect(modifierLine('stat', 'pwr', 0.123456)).toBe('PWR +12.35%')
        expect(modifierLine('cooldown', undefined, 0.045)).toBe('Cooldowns -4.5%')
        expect(modifierLine('gold', undefined, 0.2)).toBe('Gold +20%')
    })
})

describe('describe: abilities', () => {
    const champion = (name: string) => CHAMPIONS.flatMap(c => c.abilities).find(a => a.name === name)!

    it('says what every Champion ability and Skill Active does, in numbers of two decimals at most', () => {
        const abilities = [
            ...CHAMPIONS.flatMap(c => c.abilities.map(a => describeAbility(a, { caster: 'champion' }))),
            ...SKILLS.filter(s => s.type === 'active').flatMap(s =>
                skillActives([{ contentId: s.id, star: 3, level: 7 }]).map(a => describeAbility(a, { caster: 'hero', wealthFactor: 1.2345 })))
        ]
        expect(abilities.length).toBeGreaterThan(0)
        for (const text of abilities) {
            expect(text).toMatch(/^Every \d+(\.\d+)?s: /)
            expect(text).not.toContain('Does nothing')
            // the stage's pixel font has no brackets
            expect(text).not.toMatch(/[()]/)
            for (const n of numbersIn(text)) expect(n.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
        }
    })

    it('spells out Unraveling Curse', () => {
        const curse = champion('Unraveling Curse')
        const text = describeAbility(curse, { caster: 'champion' })
        expect(text).toContain(`Every ${hqNumber(curse.cooldownSeconds)}s`)
        expect(text).toContain(`extends every debuff, burn, stun and silence on the target by ${hqNumber(curse.effect!.extendDebuffs!)}s`)
        // Sylwen carries it
        expect(getChampion('champ_sylwen').abilities.map(a => a.name)).toContain('Unraveling Curse')
    })

    it('gives a Gold burst in minutes of income at the copy\'s potency', () => {
        const [fresh] = skillActives([{ contentId: getSkill('skill_prospectors_instinct').id, star: 0, level: 1 }])
        expect(describeAbility(fresh!, { caster: 'hero' })).toContain(`grants ${hqNumber(GOLD_BURST_MINUTES[rarityIndex('uncommon')]!)} minutes of your Gold income`)
    })

    it('shows a wealth-scaled hit with the factor banked Gold puts on it', () => {
        const [strike] = skillActives([{ contentId: 'skill_gamblers_strike', star: 0, level: 1 }])
        expect(isWealthScaled(strike!)).toBe(true)
        expect(describeAbility(strike!, { caster: 'hero' })).toContain('scaled by your banked Gold')
        const factor = wealthFactorFor(6)
        const text = describeAbility(strike!, { caster: 'hero', wealthFactor: factor })
        expect(text).toContain(`×${hqNumber(factor)} for your banked Gold: ${hqPct(strike!.abilityMultiplier * factor)}`)
        // a plain hit carries no wealth term
        const [quick] = skillActives([{ contentId: 'skill_quick_strike', star: 0, level: 1 }])
        expect(isWealthScaled(quick!)).toBe(false)
    })

    it('levels a Skill Active: a higher copy hits harder', () => {
        const at = (star: number, level: number) => skillActives([{ contentId: 'skill_quick_strike', star, level }])[0]!
        expect(describeAbility(at(0, 1), { caster: 'hero' })).not.toBe(describeAbility(at(5, 10), { caster: 'hero' }))
    })
})

describe('describe: wealth', () => {
    it('states the hours banked, the factor they give and its range', () => {
        expect(describeWealth(6)).toBe(`You have 6h of income banked in Gold, so the hit is ×${hqNumber(wealthFactorFor(6))}.`
            + ` ×1 at ${WEALTH_NEUTRAL_HOURS}h, from ×${WEALTH_FACTOR_MIN} to ×${WEALTH_FACTOR_MAX}.`)
        expect(describeWealth(0)).toContain(`so the hit is ×${hqNumber(WEALTH_FACTOR_MIN)}`)
    })
})
