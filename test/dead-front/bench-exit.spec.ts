import { describe, expect, it } from 'vitest'
import { DF_BENCH_ESCAPE_WINDOW_MS, DF_BENCH_TAP, dfBenchExit, dfEscapePauses, dfLockLossPlaysOn } from '../../app/utils/dead-front/engine/bench-exit'
import type { DfBenchExitInput } from '../../app/utils/dead-front/engine/bench-exit'

const frame = (over: Partial<DfBenchExitInput> & { keys?: string[] } = {}): DfBenchExitInput => ({
    pressed: c => (over.keys ?? []).includes(c),
    interactReleased: false, interactAt: null, now: 10, crafted: false, health: 100, lastHealth: 100,
    ...over
})

describe('workbench: what closes the shop', () => {
    it('stays open while nothing happens, and while browsing or holding to craft', () => {
        expect(dfBenchExit(frame())).toBeNull()
        expect(dfBenchExit(frame({ keys: ['ArrowRight', 'ArrowDown', 'Mouse0', 'KeyF'] }))).toBeNull()
        // health coming back is no hit
        expect(dfBenchExit(frame({ health: 100, lastHealth: 60 }))).toBeNull()
    })

    it('Escape, the right button and a step away close it', () => {
        expect(dfBenchExit(frame({ keys: ['Escape'] }))).toBe('escape')
        expect(dfBenchExit(frame({ keys: ['Mouse2'] }))).toBe('back')
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) expect(dfBenchExit(frame({ keys: [k] }))).toBe('move')
    })

    it('a hit closes it', () => {
        expect(dfBenchExit(frame({ health: 50, lastHealth: 100 }))).toBe('hurt')
    })

    it('a tap of F closes it; the press that opened it, a hold and a craft do not', () => {
        expect(dfBenchExit(frame({ interactReleased: true, interactAt: 10 - DF_BENCH_TAP / 2 }))).toBe('interact')
        // the F that opened the shop is still down: letting it go is nothing
        expect(dfBenchExit(frame({ interactReleased: true, interactAt: null }))).toBeNull()
        // a hold given up half way only cancels the craft
        expect(dfBenchExit(frame({ interactReleased: true, interactAt: 10 - DF_BENCH_TAP * 2 }))).toBeNull()
        expect(dfBenchExit(frame({ interactReleased: true, interactAt: 10 - DF_BENCH_TAP / 2, crafted: true }))).toBeNull()
    })
})

describe('workbench: Escape closes it without pausing', () => {
    const loss = { focused: true, shopOpen: false, sinceShopEscape: Infinity, playingOn: false, typedJustNow: false }

    it('a lost pointer lock pauses, unless Escape closed the shop', () => {
        expect(dfLockLossPlaysOn(loss)).toBe(false)
        // the lock change came first: the shop is still open
        expect(dfLockLossPlaysOn({ ...loss, shopOpen: true })).toBe(true)
        // the key came first: the shop closed a moment ago
        expect(dfLockLossPlaysOn({ ...loss, sinceShopEscape: 30 })).toBe(true)
        expect(dfLockLossPlaysOn({ ...loss, sinceShopEscape: DF_BENCH_ESCAPE_WINDOW_MS + 1 })).toBe(false)
        // a refused relock keeps playing on
        expect(dfLockLossPlaysOn({ ...loss, playingOn: true })).toBe(true)
    })

    it('leaving the window always pauses', () => {
        expect(dfLockLossPlaysOn({ ...loss, shopOpen: true, playingOn: true, sinceShopEscape: 0, focused: false })).toBe(false)
    })

    it('the Escape that closed the shop is not the pause; the next one is', () => {
        expect(dfEscapePauses({ sincePlayingOn: 5, shopOpen: false })).toBe(false)
        expect(dfEscapePauses({ sincePlayingOn: 2000, shopOpen: false })).toBe(true)
        // the shop was opened again without the lock: Escape closes it first
        expect(dfEscapePauses({ sincePlayingOn: 2000, shopOpen: true })).toBe(false)
    })
})
