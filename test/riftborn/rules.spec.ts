import { describe, expect, it } from 'vitest'
import {
    RIFTBORN_ACHIEVEMENTS,
    RIFTBORN_BOSS_TIMES,
    RIFTBORN_CLASSES,
    RIFTBORN_RUN_SECONDS,
    RIFTBORN_SKILLS,
    riftbornCleanSkills,
    riftbornLevelForXp,
    riftbornRunXp,
    riftbornSanitiseReport,
    riftbornSkillsError,
    riftbornUnlockedClasses
} from '#shared/utils/gamelogic/riftborn'

const forged = { time: 99999, kills: 1e9, eliteKills: 1e6, bossKills: 50, level: 9999, shards: 1e6, victory: true }

describe('run reports', () => {
    it('caps game time and everything derived from it by the server clock', () => {
        const report = riftbornSanitiseReport(forged, 60_000)
        expect(report.time).toBeLessThanOrEqual(65)
        expect(report.kills).toBeLessThanOrEqual(report.time * 30)
        expect(report.shards).toBeLessThanOrEqual(report.time * 1.5)
        expect(report.bossKills).toBe(0)
        expect(report.victory).toBe(false)
    })

    it('only counts a victory for a full-length run that killed a boss', () => {
        const full = RIFTBORN_RUN_SECONDS * 1000
        expect(riftbornSanitiseReport({ ...forged, bossKills: 0 }, full).victory).toBe(false)
        expect(riftbornSanitiseReport({ ...forged, bossKills: 1 }, full - 60_000).victory).toBe(false)
        expect(riftbornSanitiseReport({ ...forged, bossKills: 1 }, full).victory).toBe(true)
        expect(riftbornSanitiseReport(forged, full).bossKills).toBe(RIFTBORN_BOSS_TIMES.length)
    })

    it('keeps counting kills through a final fight that outlasts the clock', () => {
        const overtime = riftbornSanitiseReport({ ...forged, time: RIFTBORN_RUN_SECONDS + 120 }, (RIFTBORN_RUN_SECONDS + 120) * 1000)
        expect(overtime.time).toBe(RIFTBORN_RUN_SECONDS)
        expect(overtime.kills).toBe((RIFTBORN_RUN_SECONDS + 120) * 30)
    })

    it('turns garbage into a zero report worth no XP', () => {
        const report = riftbornSanitiseReport({ time: 'x', kills: -5, victory: 'yes' }, 1e9)
        expect(report).toEqual({ time: 0, kills: 0, eliteKills: 0, bossKills: 0, level: 0, shards: 0, victory: false })
        expect(riftbornRunXp(report)).toBe(0)
    })
})

describe('progression', () => {
    it('levels up exactly at each threshold', () => {
        expect(riftbornLevelForXp(0).level).toBe(1)
        expect(riftbornLevelForXp(74).level).toBe(1)
        expect(riftbornLevelForXp(75).level).toBe(2)
    })

    it('unlocks every locked class through a real achievement', () => {
        const ids = RIFTBORN_ACHIEVEMENTS.map(a => a.id)
        for (const cls of RIFTBORN_CLASSES) {
            if (cls.unlockedBy) expect(ids).toContain(cls.unlockedBy)
        }
        expect(riftbornUnlockedClasses([])).toEqual(['knight'])
    })

    it('rejects a tree that skips a prerequisite or overspends', () => {
        expect(riftbornSkillsError({ overkill: 1 }, 10)).not.toBeNull()
        expect(riftbornSkillsError({ sharpened: 3 }, 2)).toBe('Not enough skill points')
        expect(riftbornSkillsError({ sharpened: 1, keenEye: 1, overkill: 1 }, 4)).toBeNull()
    })

    it('only points prerequisites at nodes in the tree', () => {
        const ids = RIFTBORN_SKILLS.map(s => s.id)
        for (const def of RIFTBORN_SKILLS) for (const req of def.requires) expect(ids).toContain(req)
        expect(riftbornCleanSkills({ sharpened: 99, bogus: 2 })).toEqual({ sharpened: 3 })
    })
})
