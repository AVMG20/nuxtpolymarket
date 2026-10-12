/**
 * When a boss fires on its own.
 *
 * The rule is one line — engage automatically while `document.visibilityState` reads `visible` —
 * and every spec here is one of the ways that line is not the whole rule. Each corresponds to a
 * failure someone would otherwise find by watching a screen for a long time, which is exactly the
 * kind of bug a pure decision function exists to make cheap to catch.
 */

import { describe, expect, it } from 'vitest'
import {
    autoEngageDelaySeconds,
    shouldAutoEngage,
    type AutoEngageInput
} from '../../app/utils/hero-quest-auto-boss'
import {
    AUTO_ENGAGE_MAX_DELAY_SECONDS,
    AUTO_ENGAGE_MIN_DELAY_SECONDS
} from '#shared/utils/hero-quest/constants'

/** At a gate, visible, nothing in the way, and well past the grace. */
const ready: AutoEngageInput = {
    atBossGate: true,
    documentVisible: true,
    runCleared: false,
    engaging: false,
    replayOpen: false,
    secondsAtGate: 60,
    secondsPerKill: 2,
    retryInSeconds: 0,
    lostHere: false
}
const decide = (over: Partial<AutoEngageInput> = {}) => shouldAutoEngage({ ...ready, ...over })

describe('the rule', () => {
    it('engages a boss the player is sitting in front of', () => {
        expect(decide()).toBe(true)
    })

    it('never engages while the tab is hidden — that is the whole permission', () => {
        // The design invariant this feature had to keep: a boss requires the player to be
        // present, which is why Void Shards can never come from idle time alone. Visibility is
        // the presence check, so a backgrounded tab is exactly as inert as a closed one.
        expect(decide({ documentVisible: false })).toBe(false)
    })

    it('does nothing away from a gate', () => {
        expect(decide({ atBossGate: false })).toBe(false)
    })
})

describe('the things that would go wrong without it', () => {
    it('will not re-fight a super boss the run has already beaten', () => {
        // `nextStage` is a fixed point at World 10 Stage 10, so a won final boss leaves the run
        // parked on the same gate with `runCleared` set. Without this the screen would re-fight it
        // forever, and every win pays Milestone Seals.
        expect(decide({ runCleared: true })).toBe(false)
    })

    it('sends one engage at a time', () => {
        expect(decide({ engaging: true })).toBe(false)
    })

    it('waits for a replay to finish before starting another fight', () => {
        expect(decide({ replayOpen: true })).toBe(false)
    })

    it('holds off until the server can have banked the kill that reached the gate', () => {
        // The client counts kills fractionally so its bars move smoothly; `settle()` floors. The
        // screen therefore arrives at a gate up to one kill early, and an engage sent inside that
        // window is rejected under the route's lock.
        expect(decide({ secondsAtGate: 0 })).toBe(false)
        expect(decide({ secondsAtGate: 1.9, secondsPerKill: 2 })).toBe(false)
        expect(decide({ secondsAtGate: 2, secondsPerKill: 2 })).toBe(true)
    })

    it('leaves a boss that just beat the party for the player to challenge', () => {
        // A timeout or a wipe falls the run back a stage; arriving at the gate again is not the
        // player choosing to try again, so the stage's challenge button is the way back in.
        expect(decide({ lostHere: true })).toBe(false)
        expect(decide({ lostHere: true, secondsAtGate: 600 })).toBe(false)
    })

    it('backs off after a rejection instead of hammering the route', () => {
        expect(decide({ retryInSeconds: 3 })).toBe(false)
        expect(decide({ retryInSeconds: 0 })).toBe(true)
    })
})

describe('how long one kill of grace is worth', () => {
    it('is the served seconds-per-kill, because that is the lead being covered', () => {
        expect(autoEngageDelaySeconds(4)).toBe(4)
    })

    it('never drops below the floor, so latency alone cannot beat the server', () => {
        expect(autoEngageDelaySeconds(0.01)).toBe(AUTO_ENGAGE_MIN_DELAY_SECONDS)
    })

    it('never exceeds the ceiling, so a deep stage does not read as a broken gate', () => {
        expect(autoEngageDelaySeconds(600)).toBe(AUTO_ENGAGE_MAX_DELAY_SECONDS)
    })

    it('falls back to the floor when the server reports no rate at all', () => {
        // A party that cannot kill anything cannot have reached a gate by killing either, so
        // `atBossGate` is what actually decides this case — this only keeps the arithmetic sane.
        expect(autoEngageDelaySeconds(null)).toBe(AUTO_ENGAGE_MIN_DELAY_SECONDS)
        expect(autoEngageDelaySeconds(0)).toBe(AUTO_ENGAGE_MIN_DELAY_SECONDS)
        expect(autoEngageDelaySeconds(Number.POSITIVE_INFINITY)).toBe(AUTO_ENGAGE_MIN_DELAY_SECONDS)
    })
})
