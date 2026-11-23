import type { DfPlayerSnap, DfSnapshot } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'
import type { DfAudio } from '../context'
import { DF_SND } from './sounds'

// Audio cues the engine derives from the snapshot each frame rather than from
// events: the intermission's closing drum beats, a power-up landing nearby,
// the clock ticking on double points and insta-kill, and the heartbeat when
// you are nearly down.

/** Whole seconds the intermission counts down with a drum beat. */
export const DF_COUNTDOWN_BEATS = 3
/** Power-ups tick for their last this many seconds. */
export const DF_POWERUP_TICKS = 5
/** Below this share of health (standing) the heart pounds. */
export const DF_LOW_HEALTH = 0.3

/** The timed power-ups whose last seconds tick (a constant: the loop runs every frame). */
const TIMED_POWERUPS = ['double', 'insta'] as const

/**
 * The whole-second mark a countdown crossed going from `prev` to `next`
 * seconds left (counting down), if it is one of 1..`top`; else null.
 */
export function dfCrossedSecond(prev: number, next: number, top: number): number | null {
    if (!(prev > next)) return null
    const mark = Math.ceil(next)
    if (mark < 1 || mark > top) return null
    return prev > mark && next <= mark ? mark : null
}

export interface DfCues {
    update(now: number, s: DfSnapshot | null, mine: DfPlayerSnap | null, listener: Vec3): void
    reset(): void
}

export function createDfCues(audio: DfAudio): DfCues {
    let phaseTimer = -1
    let phase: DfSnapshot['phase'] | null = null
    const powerLeft = { double: 0, insta: 0 }
    const seenPowerups = new Set<number>()
    let heartAt = 0
    let primed = false

    return {
        update(now, s, mine, listener) {
            if (!s) return
            // the intermission's last seconds: drum beats into the round
            if (s.phase === 'intermission' && phase === 'intermission' && s.round > 0) {
                const mark = dfCrossedSecond(phaseTimer, s.phaseTimer, DF_COUNTDOWN_BEATS)
                if (mark !== null) audio.play(DF_SND.countdown, { volume: 0.75, rate: mark === 1 ? 1.1 : 1 })
            }
            phase = s.phase
            phaseTimer = s.phaseTimer

            // power-ups: a chime where one drops (not for those already lying there when we joined)
            for (const pu of s.powerups) {
                if (seenPowerups.has(pu.id)) continue
                seenPowerups.add(pu.id)
                if (!primed) continue
                const d = Math.hypot(pu.pos.x - listener.x, pu.pos.y - listener.y, pu.pos.z - listener.z)
                if (d < 40) audio.play(DF_SND.powerupSpawn, { volume: 0.55 + 0.45 * (1 - d / 40) })
            }
            if (seenPowerups.size > 64) {
                const live = new Set(s.powerups.map(pu => pu.id))
                for (const id of seenPowerups) if (!live.has(id)) seenPowerups.delete(id)
            }
            primed = true

            // double points / insta-kill running out: a tick a second, then the end chime
            for (const kind of TIMED_POWERUPS) {
                const left = s.world[kind]
                const prev = powerLeft[kind]
                powerLeft[kind] = left
                if (prev <= 0) continue
                if (left <= 0) {
                    audio.play(DF_SND.powerupEnd, { volume: 0.8 })
                    continue
                }
                const mark = dfCrossedSecond(prev, left, DF_POWERUP_TICKS)
                if (mark !== null) audio.play(DF_SND.powerupTick, { volume: 0.6, rate: 1 + (DF_POWERUP_TICKS - mark) * 0.04 })
            }

            // nearly down: the heart pounds, faster the closer to the edge
            if (mine && mine.life === 'alive' && mine.maxHealth > 0) {
                const h = mine.health / mine.maxHealth
                if (h < DF_LOW_HEALTH && now >= heartAt) {
                    heartAt = now + 0.55 + (h / DF_LOW_HEALTH) * 0.4
                    audio.play(DF_SND.heartbeat, { volume: 0.5 + (1 - h / DF_LOW_HEALTH) * 0.3 })
                }
            }
        },
        reset() {
            phaseTimer = -1
            phase = null
            powerLeft.double = 0
            powerLeft.insta = 0
            seenPowerups.clear()
            primed = false
        }
    }
}
