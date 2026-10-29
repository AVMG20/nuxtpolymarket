/**
 * Formation, targeting order, and the survivability model it drives.
 *
 * These specs pin the resolution of `open-items.md` #11.2: the enemy is **one attack stream**
 * that chews through the front row before the back row is targetable at all. Summing incoming
 * damage across the whole party instead would make time-to-die party-size-invariant and leave
 * the Tank archetype with no mechanical function.
 */

import { describe, expect, it } from 'vitest'
import { targetingOrder } from '#shared/utils/hero-quest/combat'
import { enemyStatsAt, incomingDps } from '#shared/utils/hero-quest/settle'
import {
    archetypeSpread,
    deriveUnitStats,
    partyUnitStats
} from '#shared/utils/hero-quest/stats'
import { getArchetype } from '#shared/utils/hero-quest/content/champions'
import { runFight } from '#shared/utils/hero-quest/fight'
import { BASE_THREAT, TANK_THREAT_MULTIPLIER } from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { ChampionSnapshot, FormationRow, HeroSnapshot } from '#shared/utils/hero-quest/types'

function champion(row: FormationRow, overrides: Partial<ChampionSnapshot> = {}): ChampionSnapshot {
    return {
        championId: 'champ_test',
        archetype: 'damage',
        rarityMultiplier: 1,
        investment: 1,
        strikesPerAttack: 1,
        row,
        // These specs are about who gets hit, not about what fires. Kits are covered in
        // `fight.spec.ts`.
        abilities: [],
        ...overrides
    }
}

function hero(heroLevel: number, champions: ChampionSnapshot[] = [], heroRow?: FormationRow): HeroSnapshot {
    return {
        classId: 'class_beginner',
        heroLevel,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0,
        heroRow,
        champions
    }
}

const AT_START = { prestige: 0, world: 1, stage: 1, killsInStage: 0 }

function unit(archetype: 'damage' | 'tank', row: FormationRow, level: number) {
    const definition = getArchetype(archetype)
    const block = archetypeSpread(archetype)
    // Level the block the same way a fielded Champion would be.
    const scaled = Object.fromEntries(
        Object.entries(block).map(([key, value]) => [key, value * level])
    ) as typeof block
    return deriveUnitStats(scaled, { strikesPerAttack: 1, row: row ?? definition.defaultRow })
}

describe('targeting order', () => {
    it('puts every front-row unit ahead of every back-row unit', () => {
        const units = partyUnitStats(hero(10, [
            champion('back', { championId: 'champ_back' }),
            champion('front', { championId: 'champ_front' })
        ]))
        const order = targetingOrder(units)

        expect(order.map(u => u.row)).toEqual(['front', 'front', 'back'])
    })

    it('targets the back row immediately when the front row is empty — a legal formation', () => {
        const units = partyUnitStats(hero(10, [champion('back')], 'back'))
        expect(units.every(u => u.row === 'back')).toBe(true)
        expect(targetingOrder(units)).toHaveLength(2)
        expect(incomingDps(units, { members: [enemyStatsAt(AT_START)] }).gt(0)).toBe(true)
    })
})

describe('survivability', () => {
    // A pack of one: these specs are about *who* takes the hit, not how many attackers there
    // are, and a solo pack keeps every assertion comparing like with like.
    const enemy = { members: [enemyStatsAt(AT_START)] }

    it('bills incoming damage against one defender, not the whole party at once', () => {
        const solo = partyUnitStats(hero(10))
        const party = partyUnitStats(hero(10, [champion('front'), champion('front')]))

        // Adding bodies must not raise the rate the party is taking damage at.
        expect(incomingDps(party, enemy).eq(incomingDps(solo, enemy))).toBe(true)
    })
})

describe('fight-time targeting', () => {
    const AT_BOSS = { prestige: 0, world: 1, stage: 5, killsInStage: 0 }

    it('sends every enemy attack at the front row while it still stands', () => {
        // Hero deliberately in back, one Tank in front — so the front-most unit is index 1,
        // not the Hero. If the order were party-array order this would target index 0.
        const party = hero(8, [champion('front', { championId: 'champ_tank', archetype: 'tank' })], 'back')
        const fight = runFight({ hero: party, position: AT_BOSS, seed: 12345 })

        const hits = fight.events.filter(event => event.kind === 'enemy_attack')
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.every(event => event.unitIndex === 1)).toBe(true)
    })
})

describe('threat', () => {
    it('sorts a Tank ahead of its own row-mates', () => {
        const damage = unit('damage', 'front', 2)
        const tank = { ...unit('tank', 'front', 2), threat: BASE_THREAT * TANK_THREAT_MULTIPLIER }
        expect(targetingOrder([damage, tank])[0]).toBe(tank)
    })

    it('never lifts a back-lined Tank over the front row — §8.4, exactly', () => {
        const damage = unit('damage', 'front', 2)
        const tank = { ...unit('tank', 'back', 2), threat: BASE_THREAT * TANK_THREAT_MULTIPLIER }
        // Row is eligibility, threat only re-weights inside it. A back-lined Tank's pull is
        // inert while the front row stands, which is what makes back-lining it a real mistake.
        expect(targetingOrder([damage, tank])[0]).toBe(damage)
    })
})

describe('the Hero row', () => {
    it('lets a saved Hero row override the class default', () => {
        expect(partyUnitStats(hero(10))[0]!.row).toBe('front')
        expect(partyUnitStats(hero(10, [], 'back'))[0]!.row).toBe('back')
    })
})
