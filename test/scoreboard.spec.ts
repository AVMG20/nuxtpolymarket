import { describe, expect, it } from 'vitest'
import { townScore, voidScore } from '#shared/utils/gamelogic/scoreboard'
import { TOWN_MILESTONES } from '#shared/utils/gamelogic/town'
import { TOWN_RESEARCH } from '#shared/utils/gamelogic/town-research'
import { VOID_MAX_SECTOR, VOID_SHIP_IDS, VOID_TRADE_MAX_LEVEL, VOID_UPGRADES } from '#shared/utils/gamelogic/void'
import { VOID_MAX_PILOT_LEVEL, voidXpForLevel } from '#shared/utils/gamelogic/void-skills'

const pilot = { runsPlayed: 3, highestSectorCleared: 2, pilotXp: 0, ownedShipIds: ['sparrow', 'wasp'], upgradeLevels: { cargo: 3, engines: 1 }, tradeLevel: 1 }

describe('scoreboard: Polytown', () => {
    it('counts each known milestone and research project once', () => {
        const m = TOWN_MILESTONES[0]!.id
        const r = TOWN_RESEARCH[0]!.id
        expect(townScore([m, m, 'retired-milestone'], [r, 'retired-project'])).toEqual({ milestones: 1, research: 1, total: 2 })
    })

    it('tops out at every milestone plus every project', () => {
        const full = townScore(TOWN_MILESTONES.map(m => m.id), TOWN_RESEARCH.map(r => r.id))
        expect(full.total).toBe(TOWN_MILESTONES.length + TOWN_RESEARCH.length)
    })
})

describe('scoreboard: Void Runner', () => {
    it('adds sectors, pilot level, hulls, system levels and trade contracts', () => {
        expect(voidScore(pilot)).toEqual({ sectors: 2, pilotLevel: 1, hulls: 2, systems: 4, trade: 1, total: 10 })
    })

    it('scores nothing before the first launch', () => {
        expect(voidScore({ ...pilot, runsPlayed: 0 }).total).toBe(0)
    })

    it('ignores unknown hulls and clamps stored values to the game\'s caps', () => {
        const s = voidScore({ ...pilot, highestSectorCleared: 99, ownedShipIds: ['sparrow', 'sparrow', 'ghost-ship'], upgradeLevels: { cargo: 999, bogus: 5 }, tradeLevel: 99 })
        expect(s.sectors).toBe(VOID_MAX_SECTOR)
        expect(s.hulls).toBe(1)
        expect(s.systems).toBe(VOID_UPGRADES.find(u => u.id === 'cargo')!.maxLevel)
        expect(s.trade).toBe(VOID_TRADE_MAX_LEVEL)
    })

    it('stays in the same range as the other games on the board', () => {
        const max = voidScore({ runsPlayed: 1, highestSectorCleared: VOID_MAX_SECTOR, pilotXp: voidXpForLevel(VOID_MAX_PILOT_LEVEL), ownedShipIds: VOID_SHIP_IDS, upgradeLevels: Object.fromEntries(VOID_UPGRADES.map(u => [u.id, u.maxLevel])), tradeLevel: VOID_TRADE_MAX_LEVEL })
        expect(max.pilotLevel).toBe(VOID_MAX_PILOT_LEVEL)
        expect(max.total).toBeGreaterThan(60)
        expect(max.total).toBeLessThan(120)
    })
})
