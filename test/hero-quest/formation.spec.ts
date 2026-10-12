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
import { enemyStatsAt, incomingDps, secondsToDie } from '#shared/utils/hero-quest/settle'
import {
    archetypeSpread,
    archetypeThreat,
    deriveUnitStats,
    partyUnitStats,
    threatFor
} from '#shared/utils/hero-quest/stats'
import { getClass } from '#shared/utils/hero-quest/content/classes'
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

    it('preserves relative order within a row, so the Hero stays the first front-row target', () => {
        const units = partyUnitStats(hero(10, [champion('front'), champion('front')]))
        expect(targetingOrder(units)[0]).toBe(units[0])
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

    it('makes party size a real survivability lever — the point of the whole change', () => {
        const solo = secondsToDie(partyUnitStats(hero(10)), enemy)
        const party = secondsToDie(partyUnitStats(hero(10, [champion('front'), champion('front')])), enemy)

        expect(party).toBeGreaterThan(solo)
    })

    it('buys far more time from a Tank body than a Damage body, on DEF and VIT together', () => {
        const solo = partyUnitStats(hero(10))
        const withDamage = secondsToDie([...solo, unit('damage', 'back', 2)], enemy)
        const withTank = secondsToDie([...solo, unit('tank', 'back', 2)], enemy)

        expect(withTank).toBeGreaterThan(withDamage)
    })

    /**
     * Documents a real limit of the wave projection rather than asserting a property it does
     * not have: `secondsToDie` is a **sum** over the targeting order, so the order itself
     * cannot change the total. Position pays off where a death actually costs something —
     * `fight.ts`, where a dead unit stops attacking (see `fight.spec.ts`). In the wave model a
     * Tank earns its keep through its own DEF and VIT, per the spec above, not through
     * standing anywhere in particular.
     */
    it('is order-independent in the wave projection — position pays off in fights, not here', () => {
        const damage = unit('damage', 'front', 2)
        const tankFront = unit('tank', 'front', 2)
        const tankBack = unit('tank', 'back', 2)

        expect(secondsToDie([damage, tankFront], enemy))
            .toBeCloseTo(secondsToDie([damage, tankBack], enemy), 6)
    })

    it('never reaches the back row when the front-most defender is immune', () => {
        const wall = { members: enemy.members.map(member => ({ ...member, pwr: ZERO })) }
        expect(secondsToDie(partyUnitStats(hero(10, [champion('back')])), wall))
            .toBe(Number.POSITIVE_INFINITY)
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

    it('falls through to the back row once the front row is down', () => {
        // A level-1 Hero in front of a deep boss dies quickly, exposing the back row.
        const deep = { prestige: 0, world: 6, stage: 5, killsInStage: 0 }
        const party = hero(1, [champion('back', { championId: 'champ_back' })], 'front')
        const fight = runFight({ hero: party, position: deep, seed: 999 })

        const struck = new Set(
            fight.events.filter(e => e.kind === 'enemy_attack').map(e => e.unitIndex)
        )
        expect(fight.outcome).toBe('wipe')
        expect(struck.has(0)).toBe(true)
        expect(struck.has(1)).toBe(true)
    })
})

describe('threat', () => {
    it('gives the Tank archetype and the Warrior path an aggro weight, nobody else', () => {
        expect(archetypeThreat('tank')).toBe(BASE_THREAT * TANK_THREAT_MULTIPLIER)
        for (const archetype of ['damage', 'support', 'control'] as const) {
            expect(archetypeThreat(archetype), archetype).toBe(BASE_THREAT)
        }
        // The doc attributes it to the *path*, so every Warrior node carries it.
        for (const classId of ['class_warrior', 'class_berserker', 'class_paladin'] as const) {
            expect(threatFor(classId), classId).toBe(BASE_THREAT * TANK_THREAT_MULTIPLIER)
        }
        for (const classId of ['class_beginner', 'class_mage', 'class_archer'] as const) {
            expect(threatFor(classId), classId).toBe(BASE_THREAT)
        }
    })

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

    it('is a stable no-op when nobody carries an aggro weight', () => {
        // With no aggro anchor fielded, the order is the plain row split in party order.
        const units = partyUnitStats(hero(10, [champion('front'), champion('front')]))
        expect(targetingOrder(units)).toEqual(units)
    })
})

describe('default rows', () => {
    it('puts the Beginner root and the whole Warrior line in front, everything else back', () => {
        const front = ['class_beginner', 'class_warrior', 'class_barbarian', 'class_berserker', 'class_knight', 'class_paladin']
        for (const id of front) {
            expect(getClass(id as never).defaultRow, id).toBe('front')
        }
        for (const id of ['class_mage', 'class_sorcerer', 'class_archer', 'class_hunter', 'class_beast_master']) {
            expect(getClass(id as never).defaultRow, id).toBe('back')
        }
    })

    it('defaults only the Tank archetype to the front row', () => {
        expect(getArchetype('tank').defaultRow).toBe('front')
        for (const id of ['damage', 'support', 'control'] as const) {
            expect(getArchetype(id).defaultRow, id).toBe('back')
        }
    })

    it('lets a saved Hero row override the class default', () => {
        expect(partyUnitStats(hero(10))[0]!.row).toBe('front')
        expect(partyUnitStats(hero(10, [], 'back'))[0]!.row).toBe('back')
    })
})
