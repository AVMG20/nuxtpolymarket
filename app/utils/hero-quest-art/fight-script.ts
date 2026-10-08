// A resolved boss fight, cut into what the stage acts out.
//
// The server's event log says what happened and when; the stage needs to know who swings, so it
// can start the swing early enough that the blow lands on the logged moment. Each swing is a
// beat: one actor, one moment, the hits it deals (a multi-strike or a cleave is several) and the
// deaths those hits cause. Everything else in the log (heals, shields, damage over time, reflects,
// statuses) happens on its moment with nobody swinging for it.
//
// Pure: it reorganises the log and never changes a number in it.

import type { FightEvent } from '../../../shared/utils/hero-quest/fight'

export interface Beat {
    /** Sim-seconds: when the hits land. */
    at: number
    /** 0, the party, by `unitIndex`; 1, the enemies, by `enemyIndex`. */
    side: 0 | 1
    actor: number
    /** An ability rather than a basic attack: the cast clip, not the swing. */
    cast: boolean
    /** The ability a cast is, for its effect; absent on a basic attack. */
    skillId?: string
    hits: FightEvent[]
    /** The `unit_down` / `enemy_down` events these hits caused, shown as the blow lands. */
    downs: FightEvent[]
}

export interface FightScript {
    beats: Beat[]
    /** Everything nobody swings for, in log order. */
    instants: FightEvent[]
}

function actorOf(e: FightEvent): { side: 0 | 1, actor: number, cast: boolean } | null {
    if (e.kind === 'attack' && e.unitIndex !== undefined) return { side: 0, actor: e.unitIndex, cast: false }
    if (e.kind === 'skill' && e.unitIndex !== undefined) return { side: 0, actor: e.unitIndex, cast: true }
    if (e.kind === 'enemy_attack' && e.enemyIndex !== undefined) return { side: 1, actor: e.enemyIndex, cast: false }
    // a boss's special is its cast: the stage plays the special for it
    if (e.kind === 'enemy_special' && e.enemyIndex !== undefined) return { side: 1, actor: e.enemyIndex, cast: true }
    return null
}

/** Whether a logged hit lands on the party rather than on an enemy. */
export function hitsParty(e: FightEvent): boolean {
    return e.kind === 'enemy_attack' || e.kind === 'enemy_special'
}

export function scriptFight(events: readonly FightEvent[]): FightScript {
    const beats: Beat[] = []
    const instants: FightEvent[] = []
    // the beat each actor opened at the moment being read, so its further hits join it
    const open = new Map<string, Beat>()
    let moment = Number.NaN
    for (const e of events) {
        if (e.at !== moment) {
            moment = e.at
            open.clear()
        }
        const who = actorOf(e)
        if (who) {
            const key = `${who.side}:${who.actor}:${who.cast ? 1 : 0}`
            let beat = open.get(key)
            if (!beat) {
                beat = { at: e.at, side: who.side, actor: who.actor, cast: who.cast, hits: [], downs: [] }
                if (e.skillId !== undefined) beat.skillId = e.skillId
                open.set(key, beat)
                beats.push(beat)
            }
            // a utility cast logs a zero-damage `skill` with no target: a cast with nothing to land
            if (!(e.kind === 'skill' && e.enemyIndex === undefined)) beat.hits.push(e)
            continue
        }
        if (e.kind === 'enemy_down' || e.kind === 'unit_down') {
            // the death rides on the blow that dealt it: the last beat this moment to hit that body
            const enemy = e.kind === 'enemy_down'
            let owner: Beat | undefined
            for (const beat of open.values()) {
                if (beat.hits.some(h => enemy
                    ? !hitsParty(h) && h.enemyIndex === e.enemyIndex
                    : hitsParty(h) && h.unitIndex === e.unitIndex)) owner = beat
            }
            if (owner) owner.downs.push(e)
            else instants.push(e)
            continue
        }
        instants.push(e)
    }
    return { beats, instants }
}
