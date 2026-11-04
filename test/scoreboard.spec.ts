import { describe, expect, it } from 'vitest'
import { HERO_QUEST_COLLECTION_SIZE, heroQuestScore, townScore, voidScore } from '#shared/utils/gamelogic/scoreboard'
import { TOWN_MILESTONES } from '#shared/utils/gamelogic/town'
import { TOWN_MONUMENT_STAGES } from '#shared/utils/gamelogic/town-monuments'
import { VOID_MAX_SECTOR, VOID_TRADE_MAX_LEVEL, VOID_UPGRADES } from '#shared/utils/gamelogic/void'

const pilot = { runsPlayed: 3, highestSectorCleared: 2, pilotXp: 0, ownedShipIds: ['sparrow', 'wasp'], upgradeLevels: { cargo: 3, engines: 1 }, tradeLevel: 1 }

describe('scoreboard: Polytown', () => {
    it('counts each known milestone once, and each monument by the stages it stands at', () => {
        const m = TOWN_MILESTONES[0]!.id
        const monuments = [{ type: 'pyramid', level: 3 }, { type: 'pyramid', level: 2 }, { type: 'house', level: 20 }, { type: 'arc', level: 99 }]
        expect(townScore([m, m, 'retired-milestone'], monuments)).toEqual({ milestones: 1, monuments: 3 + TOWN_MONUMENT_STAGES, total: 4 + TOWN_MONUMENT_STAGES })
    })
})

describe('scoreboard: Void Runner', () => {
    it('adds sectors, pilot level, hulls, system levels and trade contracts', () => {
        expect(voidScore(pilot)).toEqual({ sectors: 2, pilotLevel: 1, hulls: 2, systems: 4, trade: 1, total: 10 })
    })

    it('ignores unknown hulls and clamps stored values to the game\'s caps', () => {
        const s = voidScore({ ...pilot, highestSectorCleared: 99, ownedShipIds: ['sparrow', 'sparrow', 'ghost-ship'], upgradeLevels: { cargo: 999, bogus: 5 }, tradeLevel: 99 })
        expect(s.sectors).toBe(VOID_MAX_SECTOR)
        expect(s.hulls).toBe(1)
        expect(s.systems).toBe(VOID_UPGRADES.find(u => u.id === 'cargo')!.maxLevel)
        expect(s.trade).toBe(VOID_TRADE_MAX_LEVEL)
    })
})

describe('scoreboard: Hero Quest', () => {
    it('counts the Worlds cleared in every run', () => {
        expect(heroQuestScore({ prestige: 0, world: 1, runCleared: false, entriesOwned: 0 }).total).toBe(0)
        expect(heroQuestScore({ prestige: 0, world: 4, runCleared: false, entriesOwned: 0 }).worlds).toBe(3)
        // a cleared run counts its tenth World, and every prestige before it ten more
        expect(heroQuestScore({ prestige: 0, world: 10, runCleared: true, entriesOwned: 0 }).worlds).toBe(10)
        expect(heroQuestScore({ prestige: 2, world: 3, runCleared: false, entriesOwned: 0 }).worlds).toBe(22)
    })

    it('scores the collection as a whole percentage of every gacha entry, 0 to 100', () => {
        const score = (entriesOwned: number) => heroQuestScore({ prestige: 0, world: 1, runCleared: false, entriesOwned }).collection
        expect(score(0)).toBe(0)
        expect(score(HERO_QUEST_COLLECTION_SIZE / 2)).toBe(50)
        expect(score(HERO_QUEST_COLLECTION_SIZE - 1)).toBe(99)
        expect(score(HERO_QUEST_COLLECTION_SIZE)).toBe(100)
        // stale rows past the roster never push it over 100
        expect(score(HERO_QUEST_COLLECTION_SIZE + 32)).toBe(100)
        expect(score(-3)).toBe(0)
    })
})
