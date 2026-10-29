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
    shouldAutoEngage,
    type AutoEngageInput
} from '../../app/utils/hero-quest-auto-boss'

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

    it('backs off after a rejection instead of hammering the route', () => {
        expect(decide({ retryInSeconds: 3 })).toBe(false)
        expect(decide({ retryInSeconds: 0 })).toBe(true)
    })
})
