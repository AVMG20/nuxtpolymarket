import { describe, expect, it } from 'vitest'
import {
    LOADOUT_TARGETS,
    isLoadoutTarget,
    liveLoadoutOf,
    loadoutPreferencesOf,
    loadoutSessionOf,
    openLoadoutSession,
    planLoadoutEngage,
    readLoadoutSnapshot,
    restoredLoadout,
    type LiveLoadoutColumns
} from '#shared/utils/hero-quest/loadout-session'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'

const LIVE: LiveLoadoutColumns = {
    partyChampionIds: ['a', 'b'],
    formation: { hero: 'front', a: 'back' },
    equippedSkillIds: ['s1'],
    equippedArtifactIds: ['x1'],
    equippedGear: { weapon: 'g1' },
    ascendantSkillIds: ['skill_a']
}

describe('hero-quest preferred loadouts', () => {
    it('can point every raid and the Arena at a slot', () => {
        expect(LOADOUT_TARGETS).toEqual([...RAIDS.map(r => r.id), 'arena'])
        expect(isLoadoutTarget('raid_trait')).toBe(true)
        expect(isLoadoutTarget('arena')).toBe(true)
        expect(isLoadoutTarget('raid_nowhere')).toBe(false)
    })

    describe('the engage plan', () => {
        it('opens a session that applies nothing for a raid with no preferred Loadout, so the run holds there too', () => {
            expect(planLoadoutEngage('raid_guild', null, null)).toEqual({ kind: 'open', slotIndex: null })
            expect(openLoadoutSession('raid_guild', null, LIVE)).toEqual({ target: 'raid_guild', slotIndex: null })
        })

        it('snapshots and applies on a fresh engage', () => {
            expect(planLoadoutEngage('raid_guild', 2, null)).toEqual({ kind: 'open', slotIndex: 2 })
        })

        it('keeps a retry in the same session: no second swap', () => {
            expect(planLoadoutEngage('raid_guild', 2, openLoadoutSession('raid_guild', 2, LIVE))).toEqual({ kind: 'keep' })
            expect(planLoadoutEngage('raid_guild', null, openLoadoutSession('raid_guild', null, LIVE))).toEqual({ kind: 'keep' })
        })

        it('opens the next raid\'s session over the snapshot when the player moves on', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_forge', 0, session)).toEqual({ kind: 'open', slotIndex: 0 })
            expect(planLoadoutEngage('raid_forge', null, session)).toEqual({ kind: 'open', slotIndex: null })
        })

        it('follows a picker changed mid-session, or cleared', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_guild', 1, session)).toEqual({ kind: 'open', slotIndex: 1 })
            expect(planLoadoutEngage('raid_guild', null, session)).toEqual({ kind: 'open', slotIndex: null })
            expect(planLoadoutEngage('raid_guild', 0, openLoadoutSession('raid_guild', null, LIVE))).toEqual({ kind: 'open', slotIndex: 0 })
        })
    })

    describe('snapshot and revert', () => {
        it('snapshots a copy, so a later change to the live loadout never reaches it', () => {
            const live = liveLoadoutOf(LIVE)
            const session = openLoadoutSession('raid_trait', 1, live)
            live.partyChampionIds.push('c')
            live.formation.b = 'front'
            live.equippedGear.boots = 'g2'
            expect(restoredLoadout(session)).toEqual(LIVE)
            expect(session).toMatchObject({ target: 'raid_trait', slotIndex: 1 })
        })

        it('reverts to exactly the six components the snapshot took, and nothing else', () => {
            const session = openLoadoutSession('raid_guild', 0, LIVE)
            expect(Object.keys(restoredLoadout(session)!).sort()).toEqual(['ascendantSkillIds', 'equippedArtifactIds', 'equippedGear', 'equippedSkillIds', 'formation', 'partyChampionIds'])
            expect(restoredLoadout(openLoadoutSession('raid_guild', null, LIVE))).toBeNull()
        })

        it('reads a stored session back, and refuses anything that is not one', () => {
            const stored = JSON.parse(JSON.stringify(openLoadoutSession('raid_dig_site', 3, LIVE)))
            expect(loadoutSessionOf(stored)).toEqual({ target: 'raid_dig_site', slotIndex: 3, ...LIVE })
            expect(loadoutSessionOf(null)).toBeNull()
            expect(loadoutSessionOf({ target: 'raid_nowhere', slotIndex: 0, ...LIVE })).toBeNull()
            expect(loadoutSessionOf({ target: 'raid_guild', slotIndex: null })).toEqual({ target: 'raid_guild', slotIndex: null })
        })

        it('reads the loadout of a snapshot whose target no longer reads, and refuses one whose columns don\'t', () => {
            expect(readLoadoutSnapshot(null)).toEqual({ kind: 'none' })
            expect(readLoadoutSnapshot({ target: 'raid_gone', slotIndex: 2, ...LIVE })).toEqual({ kind: 'open', columns: LIVE, target: null, slotIndex: 2 })
            expect(readLoadoutSnapshot({ target: 'raid_guild', slotIndex: 2, ...LIVE, equippedGear: null })).toEqual({ kind: 'unreadable' })
            expect(readLoadoutSnapshot({ ...LIVE, formation: { hero: 'middle' } })).toEqual({ kind: 'unreadable' })
            expect(readLoadoutSnapshot('junk')).toEqual({ kind: 'unreadable' })
        })

        it('reads a session that applied nothing, and treats columns without a slot as another raid\'s', () => {
            expect(readLoadoutSnapshot({ target: 'raid_guild', slotIndex: null })).toEqual({ kind: 'open', columns: null, target: 'raid_guild', slotIndex: null })
            expect(readLoadoutSnapshot({ target: 'raid_guild', slotIndex: null, ...LIVE })).toEqual({ kind: 'open', columns: LIVE, target: null, slotIndex: null })
        })

        it('treats a session with no readable target as another raid\'s: put back, never kept', () => {
            const lost = { target: null, slotIndex: null }
            expect(planLoadoutEngage('raid_guild', 0, lost)).toEqual({ kind: 'open', slotIndex: 0 })
            expect(planLoadoutEngage('raid_guild', null, lost)).toEqual({ kind: 'open', slotIndex: null })
        })

        it('keeps only real targets on whole slot indices in the preference map', () => {
            expect(loadoutPreferencesOf({ raid_guild: 1, arena: 0, raid_nowhere: 2, raid_forge: -1, raid_trait: 1.5, raid_dig_site: '2' }))
                .toEqual({ raid_guild: 1, arena: 0 })
            expect(loadoutPreferencesOf(null)).toEqual({})
        })
    })
})
