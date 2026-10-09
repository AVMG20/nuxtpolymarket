import { describe, expect, it } from 'vitest'
import {
    LOADOUT_TARGETS,
    isLoadoutTarget,
    liveLoadoutOf,
    loadoutPreferencesOf,
    loadoutSessionOf,
    loadoutSessionStale,
    openLoadoutSession,
    planLoadoutEngage,
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
        it('does nothing without a preferred Loadout or a session', () => {
            expect(planLoadoutEngage('raid_guild', null, null)).toEqual({ kind: 'none' })
        })

        it('snapshots and applies on a fresh engage', () => {
            expect(planLoadoutEngage('raid_guild', 2, null)).toEqual({ kind: 'apply', slotIndex: 2, restoreFirst: false })
        })

        it('keeps a retry in the same session: no second swap', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_guild', 2, session)).toEqual({ kind: 'keep' })
        })

        it('puts the snapshot back before another raid applies its own', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_forge', 0, session)).toEqual({ kind: 'apply', slotIndex: 0, restoreFirst: true })
        })

        it('puts the snapshot back for a raid with no preferred Loadout', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_forge', null, session)).toEqual({ kind: 'restore' })
        })

        it('follows a picker changed mid-session, or cleared', () => {
            const session = openLoadoutSession('raid_guild', 2, LIVE)
            expect(planLoadoutEngage('raid_guild', 1, session)).toEqual({ kind: 'apply', slotIndex: 1, restoreFirst: true })
            expect(planLoadoutEngage('raid_guild', null, session)).toEqual({ kind: 'restore' })
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
            expect(Object.keys(restoredLoadout(session)).sort()).toEqual(['ascendantSkillIds', 'equippedArtifactIds', 'equippedGear', 'equippedSkillIds', 'formation', 'partyChampionIds'])
        })

        it('reads a stored session back, and refuses anything that is not one', () => {
            const stored = JSON.parse(JSON.stringify(openLoadoutSession('raid_dig_site', 3, LIVE)))
            expect(loadoutSessionOf(stored)).toEqual({ target: 'raid_dig_site', slotIndex: 3, ...LIVE })
            expect(loadoutSessionOf(null)).toBeNull()
            expect(loadoutSessionOf({ target: 'raid_nowhere', slotIndex: 0, ...LIVE })).toBeNull()
            expect(loadoutSessionOf({ target: 'raid_guild', slotIndex: 0 })).toBeNull()
        })

        it('keeps only real targets on whole slot indices in the preference map', () => {
            expect(loadoutPreferencesOf({ raid_guild: 1, arena: 0, raid_nowhere: 2, raid_forge: -1, raid_trait: 1.5, raid_dig_site: '2' }))
                .toEqual({ raid_guild: 1, arena: 0 })
            expect(loadoutPreferencesOf(null)).toEqual({})
        })
    })

    it('calls a session stale only once the gap since the last settle outlasts a game session', () => {
        const hour = 3_600_000
        expect(loadoutSessionStale(0, hour, hour)).toBe(false)
        expect(loadoutSessionStale(0, hour + 1, hour)).toBe(true)
    })
})
