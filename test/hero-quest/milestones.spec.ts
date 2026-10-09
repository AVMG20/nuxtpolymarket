import { describe, expect, it } from 'vitest'
import {
    MILESTONE_TRACKS,
    getMilestoneTrack,
    milestoneReached,
    milestoneRewardTotal,
    milestoneRows,
    milestoneSteps,
    milestoneTarget,
    worldsClearedOf,
    type MilestoneSnapshot
} from '#shared/utils/hero-quest/milestones'
import {
    MILESTONE_COLLECTION_EVERY,
    MILESTONE_RAID_LEVEL_EVERY,
    MILESTONE_WORLD_SEALS_BASE,
    MILESTONE_WORLD_SEALS_PER_RUN,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS } from '#shared/utils/hero-quest/gacha'
import { GACHA_CONTENT } from '#shared/utils/hero-quest/content/registry'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'

const EMPTY: MilestoneSnapshot = { worldsCleared: 0, prestiges: 0, raidLevels: {}, owned: {} }

const track = (id: string) => getMilestoneTrack(id)!

describe('hero-quest milestones', () => {
    it('has one track for Worlds, one for prestige, one per raid and one per gacha, each with a unique id', () => {
        expect(MILESTONE_TRACKS).toHaveLength(2 + RAIDS.length + GACHA_SYSTEMS.length)
        expect(new Set(MILESTONE_TRACKS.map(t => t.id)).size).toBe(MILESTONE_TRACKS.length)
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

    it('never pays less for a later step', () => {
        for (const t of MILESTONE_TRACKS) {
            const steps = Math.min(milestoneSteps(t) ?? 40, 40)
            for (let k = 2; k <= steps; k++) {
                const before = t.reward(k - 1)
                const now = t.reward(k)
                expect(now.map(r => r.kind)).toEqual(before.map(r => r.kind))
                now.forEach((r, i) => expect(r.amount).toBeGreaterThanOrEqual(before[i]!.amount))
                now.forEach(r => expect(Number.isInteger(r.amount) && r.amount > 0).toBe(true))
            }
        }
    })

    it('pays every World of a run alike, and more for each run before it', () => {
        const worlds = track('milestone_worlds')
        expect(worlds.reward(1)).toEqual([{ kind: 'all_seals', amount: MILESTONE_WORLD_SEALS_BASE }])
        expect(worlds.reward(WORLD_COUNT)).toEqual(worlds.reward(1))
        expect(worlds.reward(WORLD_COUNT + 1)).toEqual([{ kind: 'all_seals', amount: MILESTONE_WORLD_SEALS_BASE + MILESTONE_WORLD_SEALS_PER_RUN }])
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

    it('shows the next step and what is waiting, and nothing past the last', () => {
        const owned = { champion: GACHA_CONTENT.champion.entries.length, gear: MILESTONE_COLLECTION_EVERY + 1 }
        const rows = milestoneRows({ ...EMPTY, worldsCleared: 5, owned }, { milestone_worlds: 2, milestone_collection_champion: 99 })
        const byId = new Map(rows.map(r => [r.id, r]))

        const worlds = byId.get('milestone_worlds')!
        expect(worlds.claimed).toBe(2)
        expect(worlds.reached).toBe(5)
        expect(worlds.next).toMatchObject({ step: 3, target: 3 })
        expect(worlds.claimable).toEqual(milestoneRewardTotal(track('milestone_worlds'), 2, 5))

        // every step claimed: no next, nothing waiting, whatever the stored count says
        const champions = byId.get('milestone_collection_champion')!
        expect(champions.next).toBeNull()
        expect(champions.claimable).toEqual([])
        expect(champions.claimed).toBe(champions.steps)

        const gear = byId.get('milestone_collection_gear')!
        expect(gear.reached).toBe(1)
        expect(gear.next).toMatchObject({ step: 1, target: MILESTONE_COLLECTION_EVERY })

        expect(byId.get('milestone_prestige')!.claimable).toEqual([])
    })
})
