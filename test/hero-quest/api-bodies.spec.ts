/**
 * The request bodies (`hero-quest-api.ts`, issue #27): each route reads its body through a schema,
 * and a schema has to read exactly what the route's own checks used to, 400s included.
 */
import { describe, expect, it } from 'vitest'
import {
    ARENA_ATTACK_BODY,
    ARENA_SHOP_BUY_BODY,
    BUY_SEALS_BODY,
    CALENDAR_CLAIM_BODY,
    LOADOUT_APPLY_BODY,
    LOADOUT_PREFERENCE_BODY,
    LOADOUT_SAVE_BODY,
    LOADOUT_SET_BODY,
    PULL_BODY,
    QUICK_CLEAR_BODY,
    TRAIT_LOCK_BODY,
    validateHqBody,
    validateSettingBody,
    type BodySchema
} from '#server/utils/hero-quest-api'

function refusal<T>(body: unknown, schema: BodySchema<T>): string | null {
    try {
        validateHqBody(body, schema)
        return null
    } catch (error) {
        return (error as { statusMessage?: string }).statusMessage ?? 'threw'
    }
}

describe('hero-quest request bodies', () => {
    it('reads a missing body as an empty one, and hands back only the declared fields', () => {
        expect(validateHqBody(undefined, CALENDAR_CLAIM_BODY)).toEqual({ makeup: false })
        expect(validateSettingBody({ key: 'tutorials', value: false, extra: 1 })).toEqual({ key: 'tutorials', value: false })
    })

    it('answers the first broken field with its route\'s own 400', () => {
        expect(refusal({}, ARENA_ATTACK_BODY)).toBe('Pick an opponent from the list')
        expect(refusal({ slot: 0 }, ARENA_ATTACK_BODY)).toBe('Pick an opponent from the list')
        expect(refusal({ system: 'nope' }, PULL_BODY)).toBe('Unknown gacha')
        expect(refusal({ slotIndex: 9, locked: true }, TRAIT_LOCK_BODY)).toBe('Pick a Trait slot')
        expect(refusal({ slotIndex: 0, locked: 'yes' }, TRAIT_LOCK_BODY)).toBe('Say whether to lock it')
    })

    it('takes an index sent as text, and rounds a fractional loadout slot down, as the routes always did', () => {
        expect(validateHqBody({ slot: '2', opponent: 'x' }, ARENA_ATTACK_BODY)).toEqual({ slot: 2, opponent: 'x' })
        expect(refusal({ slot: 1.5, opponent: 'x' }, ARENA_ATTACK_BODY)).toBe('Pick an opponent from the list')
        expect(validateHqBody({ slotIndex: 2.7 }, LOADOUT_APPLY_BODY)).toEqual({ slotIndex: 2 })
        expect(validateHqBody({ slotIndex: '1', locked: false }, TRAIT_LOCK_BODY)).toEqual({ slotIndex: 1, locked: false })
        expect(refusal({ slotIndex: -1 }, LOADOUT_APPLY_BODY)).toBe('Pick a loadout slot')
    })

    it('fills a count left out or null with the route\'s default, and still bounds one that is sent', () => {
        expect(validateHqBody({ system: 'gear' }, BUY_SEALS_BODY)).toEqual({ system: 'gear' })
        expect(validateHqBody({ system: 'gear', count: null }, BUY_SEALS_BODY)).toEqual({ system: 'gear' })
        expect(validateHqBody({ system: 'gear', count: 3.9 }, BUY_SEALS_BODY)).toEqual({ system: 'gear', count: 3 })
        expect(refusal({ system: 'gear', count: 11 }, BUY_SEALS_BODY)).toBe('Buy between 1 and 10 Seals at a time')
        expect(validateHqBody({ itemId: 'x', quantity: null }, ARENA_SHOP_BUY_BODY)).toEqual({ itemId: 'x' })
        expect(refusal({ itemId: 'x', quantity: 0 }, ARENA_SHOP_BUY_BODY)).toMatch(/^Buy between 1 and/)
    })

    it('reads a flag as on only when it is true, and a pull as ten or a hundred only when it asks for that', () => {
        expect(validateHqBody({ makeup: 'yes' }, CALENDAR_CLAIM_BODY)).toEqual({ makeup: false })
        expect(validateHqBody({ makeup: true }, CALENDAR_CLAIM_BODY)).toEqual({ makeup: true })
        expect(validateHqBody({ system: 'champion', count: 5, free: 1 }, PULL_BODY)).toEqual({ system: 'champion', count: 1, free: false })
        expect(validateHqBody({ system: 'champion', count: 10 }, PULL_BODY)).toEqual({ system: 'champion', count: 10, free: false })
        expect(validateHqBody({ system: 'champion', count: 100 }, PULL_BODY)).toEqual({ system: 'champion', count: 100, free: false })
    })

    it('takes a quick-clear as 1, 5 or 10 at a time, 1 when left out, and nothing else', () => {
        expect(validateHqBody({ raidId: 'raid_guild' }, QUICK_CLEAR_BODY)).toEqual({ raidId: 'raid_guild' })
        for (const count of [1, 5, 10]) expect(validateHqBody({ raidId: 'raid_guild', count }, QUICK_CLEAR_BODY)).toEqual({ raidId: 'raid_guild', count })
        for (const count of [0, 2, 3, 11, 5.5, '5', null, -1]) expect(refusal({ raidId: 'raid_guild', count }, QUICK_CLEAR_BODY)).toBe('Quick-clear 1 / 5 / 10 at a time')
        expect(refusal({ raidId: 'nope', count: 5 }, QUICK_CLEAR_BODY)).toBe('Unknown raid')
    })

    it('needs an auto-buy\'s price, as a number or as text', () => {
        expect(validateHqBody({ system: 'skill', autoBuy: { maxGold: '250' } }, PULL_BODY).autoBuy).toEqual({ maxGold: 250 })
        expect(refusal({ system: 'skill', autoBuy: {} }, PULL_BODY)).toBe('An auto-buy needs the price it was shown')
        expect(refusal({ system: 'skill', autoBuy: null }, PULL_BODY)).toBe('An auto-buy needs the price it was shown')
        expect(refusal({ system: 'skill', autoBuy: { maxGold: -1 } }, PULL_BODY)).toBe('An auto-buy needs the price it was shown')
    })

    it('names a loadout by default when the name is missing or not text, and points a raid at none with null', () => {
        expect(validateHqBody({ slotIndex: 0, name: 42 }, LOADOUT_SAVE_BODY)).toEqual({ slotIndex: 0 })
        expect(validateHqBody({ target: 'arena' }, LOADOUT_PREFERENCE_BODY)).toEqual({ target: 'arena', slotIndex: null })
        expect(validateHqBody({ target: 'arena', slotIndex: '1' }, LOADOUT_PREFERENCE_BODY)).toEqual({ target: 'arena', slotIndex: 1 })
        expect(refusal({ target: 'nope' }, LOADOUT_PREFERENCE_BODY)).toBe('Unknown raid')
    })

    it('lets a Gear slot be cleared with null, and leaves which pieces are legal to the loadout check', () => {
        expect(validateHqBody({ gear: { weapon: null } }, LOADOUT_SET_BODY)).toEqual({ gear: { weapon: null } })
        expect(validateHqBody({ formation: null }, LOADOUT_SET_BODY)).toEqual({ formation: null })
        expect(refusal({ gear: [] }, LOADOUT_SET_BODY)).toBe('gear must be a slot → item map')
        expect(refusal({ skillIds: [1] }, LOADOUT_SET_BODY)).toBe('skillIds must be an array of ids')
    })

    describe('a setting', () => {
        function settingRefusal(body: unknown): string | null {
            try {
                validateSettingBody(body)
                return null
            } catch (error) {
                return (error as { statusMessage?: string }).statusMessage ?? 'threw'
            }
        }

        it('takes a switch as a boolean and the notation as one of its three names', () => {
            expect(validateSettingBody({ key: 'reduceMotion', value: true })).toEqual({ key: 'reduceMotion', value: true })
            for (const value of ['scientific', 'standard', 'alphabetical']) {
                expect(validateSettingBody({ key: 'numberNotation', value })).toEqual({ key: 'numberNotation', value })
            }
        })

        it('refuses an unknown key, a switch sent text, and a notation sent a boolean or an unknown name', () => {
            expect(settingRefusal({ key: 'nope', value: true })).toBe('Unknown setting')
            expect(settingRefusal({ key: 'tutorials', value: 'scientific' })).toBe('Unknown setting')
            expect(settingRefusal({ key: 'tutorials', value: 1 })).toBe('Unknown setting')
            expect(settingRefusal({ key: 'numberNotation', value: true })).toBe('Unknown setting')
            expect(settingRefusal({ key: 'numberNotation', value: 'engineering' })).toBe('Unknown setting')
            expect(settingRefusal({ key: 'numberNotation' })).toBe('Unknown setting')
        })
    })
})
