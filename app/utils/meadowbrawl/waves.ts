import type { EnemyTypeId, SpawnGroup } from './types'
import { TOTAL_WAVES } from './types'
import { UNLOCK_WAVE } from './enemies'

const COST: Record<EnemyTypeId, number> = {
    grunt: 3,
    charger: 5,
    swarmer: 1.6,
    shield: 6,
    ranged: 5,
    ogre: 0,
    warlord: 0
}

const SIDES: SpawnGroup['side'][] = ['north', 'east', 'south', 'west']

export function waveBudget(wave: number): number {
    return 9 + wave * 4 + wave * wave * 0.22
}

/** Rough seconds the trickle of spawns is spread across. */
export function waveSpawnSpan(wave: number): number {
    return Math.min(24, 9 + wave * 0.9)
}

export function eliteFor(wave: number): EnemyTypeId[] {
    if (wave === TOTAL_WAVES) return ['ogre', 'warlord', 'ogre']
    if (wave % 4 !== 0) return []
    const first: EnemyTypeId = (wave / 4) % 2 === 1 ? 'ogre' : 'warlord'
    // From wave 16 the elites come in pairs.
    if (wave >= 16) return [first, first === 'ogre' ? 'warlord' : 'ogre']
    return [first]
}

/**
 * Build the spawn schedule for a wave. `rng` only shuffles composition and
 * sides — the archetype unlocks and the elite cadence are fixed so the
 * player learns the rhythm.
 */
export function buildWave(wave: number, rng: () => number = Math.random): SpawnGroup[] {
    const groups: SpawnGroup[] = []
    const elites = eliteFor(wave)
    let budget = waveBudget(wave) * (elites.length ? 0.7 : 1)
    const span = waveSpawnSpan(wave)
    const side = () => SIDES[Math.floor(rng() * SIDES.length)]!

    const available = (Object.keys(UNLOCK_WAVE) as EnemyTypeId[])
        .filter(t => COST[t] > 0 && UNLOCK_WAVE[t] <= wave)

    // Guarantee the newly unlocked archetype shows up on its debut wave.
    const debut = available.filter(t => UNLOCK_WAVE[t] === wave)
    const forced: EnemyTypeId[] = [...debut]
    if (wave === 1) forced.push('charger')

    const push = (type: EnemyTypeId, count: number, time: number) => {
        groups.push({ time, type, count, side: side() })
        budget -= COST[type] * count
    }

    // Wave 1 opens with a small readable pack before anything else arrives.
    push('grunt', wave === 1 ? 3 : 2 + Math.min(4, Math.floor(wave / 3)), 0)

    let t = 1.5
    for (const type of forced) {
        const count = type === 'swarmer' ? 6 : type === 'charger' && wave === 1 ? 1 : 2
        push(type, count, t)
        t += 2
    }

    let guard = 0
    while (budget > 0 && guard++ < 60) {
        // Newer archetypes are weighted up so the roster keeps shifting.
        const weights = available.map(type => {
            const age = wave - UNLOCK_WAVE[type]
            return { type, w: type === 'grunt' ? 1.2 : age <= 2 ? 2.2 : 1 }
        })
        const total = weights.reduce((s, e) => s + e.w, 0)
        let roll = rng() * total
        let type: EnemyTypeId = 'grunt'
        for (const e of weights) {
            roll -= e.w
            if (roll < 0) {
                type = e.type
                break
            }
        }
        const count = type === 'swarmer' ? 4 + Math.floor(rng() * 4) : type === 'grunt' ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2)
        push(type, count, Math.min(span, t))
        t += 1.2 + rng() * 2.2
    }

    let et = 3
    for (const elite of elites) {
        groups.push({ time: et, type: elite, count: 1, side: side() })
        et += 5
    }

    groups.sort((a, b) => a.time - b.time)
    return groups
}

export function countEnemies(groups: SpawnGroup[]): number {
    return groups.reduce((s, g) => s + g.count, 0)
}
