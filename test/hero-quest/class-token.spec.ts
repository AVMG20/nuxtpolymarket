/**
 * The class token (`open-items.md` #42): a prestige grants it, reaching a class not seen before
 * spends it, and switching back to a class already reached is free at any time. A flag, not a
 * count, so a second prestige while holding one changes nothing.
 */

import { describe, expect, it } from 'vitest'
import { classPickWrites, mastersPrestiged, pickableClasses, prestigeResetValues, type HqStateRow } from '#server/utils/hero-quest'
import { ASCENDANT_ID, CLASS_IDS, MASTER_IDS } from '#shared/utils/hero-quest/content/classes'

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

describe('hero-quest Ascendant unlock', () => {
    const everyClass = CLASS_IDS.filter(id => id !== ASCENDANT_ID)
    /** Every class reached, standing on a master, with the token from the prestige just made. */
    const veteran = (prestigedClassIds: string[]) => state({
        heroNodeId: 'class_beast_master', seenNodeIds: everyClass, classToken: true, prestigedClassIds
    })

    it('stays shut while any master is missing from the prestiges, even with every class reached', () => {
        const five = MASTER_IDS.slice(0, 5) as string[]
        expect(mastersPrestiged(veteran(five))).toEqual(five)
        expect(pickableClasses(veteran(five))).not.toContain(ASCENDANT_ID)
        // other prestiges, as the elites, don't count toward it
        expect(pickableClasses(veteran([...five, 'class_hunter', 'class_beginner']))).not.toContain(ASCENDANT_ID)
    })

    it('opens with the token once a prestige has been made as each master, from any class, and spends it', () => {
        const done = veteran([...MASTER_IDS, 'class_warrior'])
        expect(pickableClasses(done)).toContain(ASCENDANT_ID)
        expect(classPickWrites({ ...done, heroNodeId: 'class_mage' }, ASCENDANT_ID)).toMatchObject({ heroNodeId: ASCENDANT_ID, classToken: false })
    })

    it('needs the token to take it the first time, and none to switch back', () => {
        expect(pickableClasses({ ...veteran([...MASTER_IDS]), classToken: false })).not.toContain(ASCENDANT_ID)
        const reached = state({ seenNodeIds: [...everyClass, ASCENDANT_ID], prestigedClassIds: [...MASTER_IDS] })
        expect(classPickWrites(reached, ASCENDANT_ID)).toEqual({ heroNodeId: ASCENDANT_ID, seenNodeIds: [...everyClass, ASCENDANT_ID] })
    })
})
