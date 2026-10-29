/**
 * An Arena fight as the stage plays it (`demo.ts`): every body the log brings down plays its death
 * (issue #25), and the stage ends with the same bodies down as the log.
 *
 * Two ways a death used to go missing: the Hero's cinematic skill held its logged blow until the
 * Hero's next swing, so a skill that ended the fight never felled anyone; and a heal-over-time tick
 * logged just before the killing blow, landing a frame after it on the stage, stood the body back up.
 */

import { describe, expect, it } from 'vitest'
import { BattleDemo, type RunParty, type StageArena } from '../../app/utils/hero-quest-art/demo'
import type { RunFeed } from '../../app/utils/hero-quest-art/run-director'
import { runDuel, type DuelResult } from '#shared/utils/hero-quest/duel'
import type { FightEvent } from '#shared/utils/hero-quest/fight'
import { CHAMPIONS, RARITY_STAT_MULTIPLIER } from '#shared/utils/hero-quest/content/champions'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { ChampionSnapshot, ClassId, HeroSnapshot } from '#shared/utils/hero-quest/types'

/** `demo.ts`'s unit states that mean a body is down: dying, or gone. */
const DEATH = 4
const GONE = 6
const FRAME = 1 / 60

const FEED: RunFeed = {
    prestige: 0, world: 1, stage: 3, archetype: 'wave', killsFloat: 0, killsRequired: 30, packSize: 6,
    atBossGate: false, farming: false, walled: false, recoverySeconds: 0, enemyHp: '1840', secondsPerKill: 2,
    critChance: 0.25, critMultiplier: '2.5', heroHpPct: 100, heroLevel: 12, xpShare: 0, gpn: '1000'
}

/** What the stage keeps private, read for the checks. */
interface StageInside {
    units: { state: number }[]
    replay: { done: boolean, party: (number | null)[], foes: (number | null)[] } | null
}

function champion(i: number, row: 'front' | 'back'): ChampionSnapshot {
    const def = CHAMPIONS[i % CHAMPIONS.length]!
    return { championId: def.id, archetype: def.archetype, rarityMultiplier: RARITY_STAT_MULTIPLIER[def.rarity], investment: 1, strikesPerAttack: def.strikesPerAttack, row, abilities: def.abilities }
}

function hero(heroLevel: number, classId: ClassId, champions: ChampionSnapshot[]): HeroSnapshot {
    return { classId, heroLevel, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0, champions, heroRow: 'front' }
}

/**
 * Play `round` on a fresh stage to the end, past every death strip: which stage bodies ever played
 * a death, and the stage as it ends.
 */
function play(party: RunParty, round: StageArena): { died: Set<number>, stage: StageInside } {
    const demo = new BattleDemo()
    demo.setupRun(party, FEED)
    for (let i = 0; i < 60; i++) demo.update(FRAME)
    demo.playArena(round)
    const stage = demo as unknown as StageInside
    const died = new Set<number>()
    const step = () => {
        demo.update(FRAME)
        stage.units.forEach((u, k) => { if (u.state === DEATH) died.add(k) })
    }
    for (let i = 0; i < 60 * 60 && !stage.replay?.done; i++) step()
    // the last blows' swings and the death strips play out
    for (let i = 0; i < 60 * 4; i++) step()
    return { died, stage }
}

/** Each body's state at the end of the log: down, or standing. */
function downAtEnd(events: readonly FightEvent[]): Map<string, boolean> {
    const down = new Map<string, boolean>()
    for (const e of events) {
        if (e.kind === 'unit_down') down.set(`p${e.unitIndex}`, true)
        if (e.kind === 'enemy_down') down.set(`e${e.enemyIndex}`, true)
        if (e.kind === 'heal' && Number(e.remainingHp) > 0) down.set(`${e.onEnemy ? 'e' : 'p'}${e.onEnemy ? e.enemyIndex : e.unitIndex}`, false)
    }
    return down
}

function roundOf(fight: Pick<DuelResult, 'outcome' | 'secondsElapsed' | 'events' | 'partyMaxHps' | 'enemyMaxHps'>, partyIds: string[], enemy: StageArena['enemy']): StageArena {
    return { outcome: fight.outcome, secondsElapsed: fight.secondsElapsed, events: fight.events, partyIds, partyMaxHps: fight.partyMaxHps, enemyMaxHps: fight.enemyMaxHps, opponent: 'Rival', enemy, timer: 30 }
}

describe('the Arena on the stage', () => {
    it('fells the defender the Hero\'s cinematic skill ends the fight on', { timeout: 30_000 }, () => {
        const events: FightEvent[] = [
            { at: 2, kind: 'skill', unitIndex: 0, enemyIndex: 0, skillId: 'unknown', damage: '100', remainingHp: '0' },
            { at: 2, kind: 'enemy_down', enemyIndex: 0, remainingHp: '0' }
        ]
        const { died, stage } = play(
            { classId: 'class_beginner', heroRow: 'front', champions: [] },
            roundOf({ outcome: 'win', secondsElapsed: 2, events, partyMaxHps: ['100'], enemyMaxHps: ['100'] }, ['class_beginner'], { classId: 'class_beginner', heroRow: 'front', champions: [] })
        )
        const k = stage.replay!.foes[0]!
        expect(died.has(k)).toBe(true)
        expect([DEATH, GONE]).toContain(stage.units[k]!.state)
    })

    it('keeps a body down that a heal reached just before the killing blow', { timeout: 30_000 }, () => {
        const events: FightEvent[] = [
            { at: 1.5, kind: 'heal', enemyIndex: 0, onEnemy: true, damage: '1', remainingHp: '2' },
            { at: 1.5, kind: 'attack', unitIndex: 0, enemyIndex: 0, damage: '2', remainingHp: '0' },
            { at: 1.5, kind: 'enemy_down', enemyIndex: 0, remainingHp: '0' }
        ]
        const { died, stage } = play(
            { classId: 'class_warrior', heroRow: 'front', champions: [] },
            roundOf({ outcome: 'win', secondsElapsed: 1.5, events, partyMaxHps: ['100'], enemyMaxHps: ['100'] }, ['class_warrior'], { classId: 'class_mage', heroRow: 'front', champions: [] })
        )
        const k = stage.replay!.foes[0]!
        expect(died.has(k)).toBe(true)
        expect([DEATH, GONE]).toContain(stage.units[k]!.state)
    })

    it('plays every death a real duel logs, and ends with the log\'s fallen down and its revived standing', { timeout: 120_000 }, () => {
        const classes: ClassId[] = ['class_beginner', 'class_warrior', 'class_mage', 'class_archer', 'class_paladin', 'class_hunter', 'class_witch_doctor', 'class_marksman']
        let falls = 0
        for (const seed of [2, 18, 31]) {
            const attackerClass = classes[seed % classes.length]!
            const defenderClass = classes[(seed * 3) % classes.length]!
            const attacking = [champion(seed, 'front'), champion(seed + 5, 'back'), champion(seed + 9, 'back')]
            const defending = [champion(seed + 2, 'front'), champion(seed + 7, 'back')]
            const fight = runDuel({ attacker: hero(60 + (seed % 3) * 10, attackerClass, attacking), defender: hero(60, defenderClass, defending), seed })
            const { died, stage } = play(
                { classId: attackerClass, heroRow: 'front', champions: attacking.map(c => ({ id: c.championId, row: c.row, level: 1 })) },
                roundOf(fight, [attackerClass, ...attacking.map(c => c.championId)], { classId: defenderClass, heroRow: 'front', champions: defending.map(c => ({ id: c.championId, row: c.row })) })
            )
            for (const [body, down] of downAtEnd(fight.events)) {
                const index = Number(body.slice(1))
                const k = body[0] === 'p' ? stage.replay!.party[index]! : stage.replay!.foes[index]!
                const state = stage.units[k]!.state
                if (down) {
                    falls++
                    expect({ seed, body, died: died.has(k) }).toEqual({ seed, body, died: true })
                    expect([DEATH, GONE], `seed ${seed} ${body}`).toContain(state)
                } else {
                    expect([DEATH, GONE], `seed ${seed} ${body}`).not.toContain(state)
                }
            }
        }
        expect(falls).toBeGreaterThan(4)
    })
})
