/**
 * Unit derivation (§12.3): everything a unit is comes from imported card
 * fields, scaled /10, with the printed weakness/resistance operators
 * honoured as-is. Pure — no database.
 */
import { describe, expect, it } from 'vitest'
import { deriveUnit, bountyTierFor } from '#shared/utils/battler/unit'
import { unitCostFor } from '#shared/utils/battler/shop'

const hoothoot = {
    category: 'Pokemon',
    name: 'Hoothoot',
    hp: 80,
    type: 'Colorless',
    retreat: 2,
    attacks: [
        { cost: [], name: '[Ability] Insomnia', text: 'no sleep', damage: '', attackId: 1 },
        { cost: ['Colorless', 'Colorless'], name: 'Tackle', text: '', damage: '20', attackId: 2 }
    ],
    weakness: { type: 'Lightning', amount: '2' },
    resistance: { type: 'Fighting', amount: '-30' }
}

describe('deriveUnit', () => {
    it('scales hp /10 and derives damage from charge x tier, never the text', () => {
        // No tier given -> unknown prices as plain Rare (1.5/charge).
        const unit = deriveUnit('card-1', hoothoot)!
        expect(unit.hp).toBe(8)
        expect(unit.attacks).toHaveLength(1)
        expect(unit.attacks[0]).toMatchObject({ name: 'Tackle', damage: 3, charge: 2, attackId: 2 })
        expect(unit.retreat).toBe(2)

        // The printed damage text is ignored entirely: "20+", coin-flip
        // wording and blanks all land on the same charge-derived figure.
        const plus = {
            ...hoothoot,
            attacks: [{ cost: ['Colorless', 'Colorless'], name: 'Rising Lunge', damage: '20+', attackId: 3 }]
        }
        expect(deriveUnit('card-1', plus)!.attacks[0]!.damage).toBe(3)
    })

    it('scales damage with the pricedex tier', () => {
        const chase = { ...hoothoot, pullRate: { tier: 'Hyper Rare' } }
        expect(deriveUnit('card-1', chase)!.attacks[0]!.damage).toBe(6) // 2 charge x 3
        expect(deriveUnit('card-1', hoothoot, 'Common')!.attacks[0]!.damage).toBe(2) // 2 x 1
        // raw.pullRate.tier beats the rarity-column fallback.
        expect(deriveUnit('card-1', chase, 'Common')!.attacks[0]!.damage).toBe(6)
    })

    it('gives ability-only cards a synthetic Struggle so they still fight', () => {
        const abilityOnly = { ...hoothoot, attacks: [hoothoot.attacks[0]] }
        const unit = deriveUnit('card-1', abilityOnly, 'Common')!
        expect(unit.attacks).toHaveLength(1)
        expect(unit.attacks[0]).toMatchObject({ name: 'Struggle', damage: 2, charge: 2, attackId: 0 })
    })

    it('honours multiplicative and additive modifiers, additive scaled /10', () => {
        const unit = deriveUnit('card-1', hoothoot)!
        expect(unit.weaknesses).toEqual([{ type: 'Lightning', operator: 'x', value: 2 }])
        expect(unit.resistances).toEqual([{ type: 'Fighting', operator: 'add', value: -3 }])

        const additiveWeak = { ...hoothoot, weakness: { type: 'Psychic', amount: '+30' } }
        expect(deriveUnit('card-1', additiveWeak)!.weaknesses).toEqual([
            { type: 'Psychic', operator: 'add', value: 3 }
        ])
    })

    it('normalizes weakness arrays for dual-weak cards', () => {
        const dual = {
            ...hoothoot,
            weakness: undefined,
            weaknesses: [
                { type: 'Fire', amount: '2' },
                { type: 'Water', amount: '2' }
            ]
        }
        expect(deriveUnit('card-1', dual)!.weaknesses).toHaveLength(2)
    })

    it('rejects trainers, energy and legacy cards without combat data', () => {
        expect(deriveUnit('t', { ...hoothoot, category: 'Trainer' })).toBeNull()
        expect(deriveUnit('e', { ...hoothoot, category: 'Energy' })).toBeNull()
        expect(deriveUnit('l', { category: 'Pokemon', name: 'Snorlax', hp: null, attacks: [] })).toBeNull()
    })

    it('prices from the pricedex tier vocabulary with a code fallback', () => {
        expect(unitCostFor('Common')).toBe(3)
        expect(unitCostFor('Double Rare')).toBe(6)
        expect(unitCostFor('Special Illustration Rare')).toBe(8)
        expect(unitCostFor('Mega Hyper Rare')).toBe(10)
        expect(unitCostFor('Reverse Common')).toBe(3)
        // Sidecar codes that leak into the rarity column still land right.
        expect(unitCostFor('2R')).toBe(6)
        expect(unitCostFor('C')).toBe(3)
        expect(unitCostFor('TCGLFBE')).toBe(4) // unknown → plain Rare
        // Character-card sidecar codes without a pricedex row.
        expect(unitCostFor('CHV')).toBe(8)
        expect(unitCostFor('CSR')).toBe(8)
        expect(unitCostFor('CHR')).toBe(6)
        expect(unitCostFor('BWR')).toBe(10)
        expect(unitCostFor(null)).toBe(4)
    })

    it('derives bounty tier from the name', () => {
        expect(bountyTierFor('Hoothoot')).toBe(0)
        expect(bountyTierFor('Eevee ex')).toBe(2)
        expect(bountyTierFor('Blaziken V')).toBe(2)
        expect(bountyTierFor('Charizard VMAX')).toBe(3)
        expect(bountyTierFor('Giratina VSTAR')).toBe(3)
        expect(bountyTierFor('Umbreon GX')).toBe(2)
        // Substrings must not trigger: 'Vulpix' contains a V but not as a word.
        expect(bountyTierFor('Vulpix')).toBe(0)
        expect(bountyTierFor('Exeggcute')).toBe(0)
    })
})
