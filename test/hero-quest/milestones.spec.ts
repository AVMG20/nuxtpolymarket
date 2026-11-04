import { describe, expect, it } from 'vitest'
import {
    MILESTONE_TRACKS,
    getMilestoneTrack,
    milestoneReached,
    milestoneRewardTotal,
    milestoneSteps,
    milestoneTarget,
    worldsClearedOf
} from '#shared/utils/hero-quest/milestones'
import {
    MILESTONE_ARENA_MEDALS_BASE,
    MILESTONE_ARENA_MEDALS_CAP,
    MILESTONE_COLLECTION_EVERY,
    MILESTONE_RAID_LEVEL_EVERY,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS } from '#shared/utils/hero-quest/gacha'
import { GACHA_CONTENT } from '#shared/utils/hero-quest/content/registry'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'

const track = (id: string) => getMilestoneTrack(id)!

describe('hero-quest milestones', () => {
    it('gives every track a unique id', () => {
        expect(new Set(MILESTONE_TRACKS.map(t => t.id)).size).toBe(MILESTONE_TRACKS.length)
    })

    it('grows the Arena step\'s Medals until the cap, then pays the cap', () => {
        const medals = (k: number) => track('milestone_arena').reward(k)[0]!.amount
        expect(medals(1)).toBe(MILESTONE_ARENA_MEDALS_BASE)
        expect(medals(11)).toBe(MILESTONE_ARENA_MEDALS_CAP)
        expect(medals(100)).toBe(MILESTONE_ARENA_MEDALS_CAP)
    })

    it('counts Worlds cleared across every run, never going back at a prestige', () => {
        expect(worldsClearedOf(0, 1, false)).toBe(0)
        expect(worldsClearedOf(0, 4, false)).toBe(3)
        // the super boss beaten: the whole run, and the prestige after it lands on the same count
        expect(worldsClearedOf(0, WORLD_COUNT, true)).toBe(WORLD_COUNT)
        expect(worldsClearedOf(1, 1, false)).toBe(WORLD_COUNT)
        expect(worldsClearedOf(2, 3, false)).toBe(2 * WORLD_COUNT + 2)
    })

    it('runs Worlds and prestige forever, a raid every few levels, and ends a collection at its roster', () => {
        expect(milestoneSteps(track('milestone_worlds'))).toBeNull()
        expect(milestoneSteps(track('milestone_prestige'))).toBeNull()
        const raid = track(`milestone_${RAIDS[0]!.id}`)
        expect(milestoneSteps(raid)).toBeNull()
        expect([1, 2, 3].map(k => milestoneTarget(raid, k))).toEqual([1, 2, 3].map(k => k * MILESTONE_RAID_LEVEL_EVERY))
        expect(milestoneTarget(track('milestone_worlds'), 137)).toBe(137)

        for (const system of GACHA_SYSTEMS) {
            const t = track(`milestone_collection_${system}`)
            const roster = GACHA_CONTENT[system].entries.length
            const steps = milestoneSteps(t)!
            expect(steps).toBe(Math.ceil(roster / MILESTONE_COLLECTION_EVERY))
            // the last step is the whole roster, and every target before it is a multiple of the step
            expect(milestoneTarget(t, steps)).toBe(roster)
            expect(milestoneTarget(t, 1)).toBe(Math.min(roster, MILESTONE_COLLECTION_EVERY))
        }
    })

    it('reaches a step exactly at its target, and never past a collection\'s last', () => {
        const raid = track(`milestone_${RAIDS[0]!.id}`)
        expect(milestoneReached(raid, MILESTONE_RAID_LEVEL_EVERY - 1)).toBe(0)
        expect(milestoneReached(raid, MILESTONE_RAID_LEVEL_EVERY)).toBe(1)
        expect(milestoneReached(raid, 3 * MILESTONE_RAID_LEVEL_EVERY + 2)).toBe(3)

        const champions = track('milestone_collection_champion')
        const roster = GACHA_CONTENT.champion.entries.length
        expect(milestoneReached(champions, roster)).toBe(milestoneSteps(champions))
        expect(milestoneReached(champions, roster + 50)).toBe(milestoneSteps(champions))
    })

    it('sums every step a claim takes into one line per currency', () => {
        const prestige = track('milestone_prestige')
        const total = milestoneRewardTotal(prestige, 0, 3)
        const expected = [1, 2, 3].map(k => prestige.reward(k))
        expect(total).toEqual([
            { kind: 'all_seals', amount: expected.reduce((n, r) => n + r[0]!.amount, 0) },
            { kind: 'gems', amount: expected.reduce((n, r) => n + r[1]!.amount, 0) }
        ])
    })
})
