import type { NitroAudio } from './audio'
import type { ChaseCamera } from './camera'
import type { CarEffects } from './car-fx'
import { PHYSICS_HZ } from './config'
import type { CarState, StepEvents } from './physics'
import type { RaceGrade } from './race-grade'
import type { EngineEvents } from './types'
import { formatLapTime } from '#shared/utils/nitro-rush/timing'

/** Falling this fast onto the road shakes the camera. */
const HARD_LANDING = 8
/** Physics steps between the sparks and sound of a rub along a wall. */
const SCRAPE_EVERY = Math.round(PHYSICS_HZ * 0.4)

interface FeedbackDeps {
    audio: NitroAudio
    events: EngineEvents
    grade: RaceGrade
    cam: ChaseCamera
    fx: CarEffects
}

/** What the player sees and hears when something happens in the race; the rules that decide it stay in the engine. */
export class RaceFeedback {
    private readonly deps: FeedbackDeps
    /** Physics steps until a rub along a wall may spark and sound again. */
    private scrapeSteps = 0

    constructor(deps: FeedbackDeps) {
        this.deps = deps
    }

    countdown(n: number) {
        this.deps.events.popup({ text: String(n), tone: 'count', big: true })
        this.deps.audio.countdown(false)
    }

    go() {
        const { audio, events, grade } = this.deps
        audio.countdown(true)
        grade.pulse(1)
        grade.flash(0.3, 0.3, 0.35)
        events.popup({ text: 'GO!', tone: 'count', big: true })
    }

    nitroFired(s: CarState) {
        const { audio, events, grade, fx } = this.deps
        audio.nitroStart()
        grade.pulse(1)
        grade.flash(0.1, 0.2, 0.45)
        fx.nitroFired(s)
        events.popup({ text: 'NITRO!', tone: 'nitro' })
    }

    nitroReady() {
        this.deps.audio.nitroReady()
        this.deps.events.popup({ text: 'NITRO READY', sub: 'SHIFT TO BOOST', tone: 'nitro' })
    }

    step(ev: StepEvents, s: CarState) {
        const { audio, events, grade, cam, fx } = this.deps
        if (ev.landed > HARD_LANDING) {
            cam.shake(Math.min(0.8, ev.landed / 30))
            audio.bump()
        }
        if (ev.wallImpact > 1.5) {
            const k = Math.min(1, ev.wallImpact / 14)
            const hard = ev.wallImpact > 6
            // The steps after a hit still read as rubbing; the hit has already made its noise.
            this.scrapeSteps = SCRAPE_EVERY
            cam.shake(0.15 + k * 0.45)
            fx.wallHit(s, k, hard)
            if (hard) {
                audio.bump()
                grade.pulse(0.5)
            } else {
                audio.scrape()
            }
        } else if (ev.scraping && this.scrapeSteps <= 0) {
            // A long rub never reaches the hit above, but it costs speed, so it has to show.
            this.scrapeSteps = SCRAPE_EVERY
            fx.wallHit(s, 0.1, false)
            audio.scrape()
        }
        this.scrapeSteps--
        if (ev.driftEnded > 0.6 && ev.nitroEarned > 0) {
            events.popup({ text: 'DRIFT', sub: `${ev.driftEnded.toFixed(1)}s · +NITRO`, tone: 'drift' })
        }
    }

    split(delta: number, sector: number) {
        this.deps.audio.split(delta < 0)
        this.deps.events.popup({ text: formatLapTime(delta, true), sub: `SECTOR ${sector + 1}`, tone: delta < 0 ? 'good' : 'bad' })
    }

    /** `previousBest` is the record before this lap, for the gap the popup shows. */
    lap(label: string, time: number, previousBest: number | null, isBest: boolean) {
        const { audio, events, grade } = this.deps
        const sub = previousBest === null ? label : `${label} · ${formatLapTime(time - previousBest, true)}`
        if (isBest) grade.flash(0.25, 0.2, 0.05)
        audio.lap(isBest)
        events.popup({ text: formatLapTime(time), sub: isBest ? `${sub} · BEST LAP` : sub, tone: isBest ? 'best' : 'lap', big: true })
    }

    finish() {
        this.deps.grade.pulse(1)
    }
}
