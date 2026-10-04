/**
 * The class token (`open-items.md` #42): a prestige grants it, reaching a class not seen before
 * spends it, and switching back to a class already reached is free at any time. A flag, not a
 * count, so a second prestige while holding one changes nothing.
 */

import { describe, expect, it } from 'vitest'
import { classPickWrites, pickableClasses, prestigeResetValues, type HqStateRow } from '#server/utils/hero-quest'

function state(patch: Partial<HqStateRow>): HqStateRow {
    return { heroNodeId: 'class_beginner', seenNodeIds: ['class_beginner'], classToken: false, prestige: 0, ...patch } as HqStateRow
}

describe('hero-quest class token', () => {
    it('keeps a new Hero on the Beginner until a prestige grants a token', () => {
        expect(pickableClasses(state({}))).toEqual(['class_beginner'])
        expect(classPickWrites(state({}), 'class_warrior')).toBeNull()
    })

    it('opens one tier deeper while the token is held, and spends it on the pick', () => {
        const held = state({ classToken: true })
        expect(pickableClasses(held)).toEqual(['class_beginner', 'class_warrior', 'class_mage', 'class_archer'])
        expect(classPickWrites(held, 'class_mage')).toEqual({
            heroNodeId: 'class_mage',
            seenNodeIds: ['class_beginner', 'class_mage'],
            classToken: false
        })
    })

    it('never opens two tiers at once', () => {
        expect(classPickWrites(state({ classToken: true }), 'class_wizard')).toBeNull()
    })

    it('switches back to a class already reached for free, keeping the token', () => {
        const writes = classPickWrites(state({ heroNodeId: 'class_mage', seenNodeIds: ['class_beginner', 'class_mage'], classToken: true }), 'class_beginner')
        expect(writes).toEqual({ heroNodeId: 'class_beginner', seenNodeIds: ['class_beginner', 'class_mage'] })
        expect(writes).not.toHaveProperty('classToken')
    })

    it('lets a reached class be taken back without a token at all', () => {
        const writes = classPickWrites(state({ heroNodeId: 'class_beginner', seenNodeIds: ['class_beginner', 'class_marksman'] }), 'class_marksman')
        expect(writes?.heroNodeId).toBe('class_marksman')
    })

    it('grants the token on prestige, as a flag that does not stack', () => {
        expect(prestigeResetValues(state({})).classToken).toBe(true)
        expect(prestigeResetValues(state({ classToken: true })).classToken).toBe(true)
    })
})
