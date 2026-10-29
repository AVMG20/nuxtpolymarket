// Pixel-ratio policy (pure, tested). Standard-density screens never render
// below native resolution and get ~1.5x supersampling when affordable;
// high-density screens may back off toward ~60% of native, which the extra
// density hides. The adaptive step lowers the ratio when frames run long.

export interface DfPrBounds {
    min: number
    max: number
}

/** About a 1440p frame supersampled 1.5x. */
const PIXEL_BUDGET = 2560 * 1440 * 2.25
const STEP = 0.125

export function dfPixelRatioBounds(dpr: number, width: number, height: number, quality: 'low' | 'high'): DfPrBounds {
    const d = Math.max(0.5, dpr)
    const min = d < 1.75 ? d : Math.max(1, d * 0.6)
    let max = d < 1.75 ? (quality === 'high' ? Math.max(d, 1.5) : d) : Math.min(d, 2)
    const area = Math.max(1, width * height)
    max = Math.min(max, Math.sqrt(PIXEL_BUDGET / area))
    max = Math.max(min, max)
    return { min, max }
}

/**
 * Next pixel ratio given the smoothed frame time. Steps down when frames run
 * long (> ~19.5 ms), steps up after `goodTime` seconds of on-budget frames
 * unless the ceiling is locked (it just had to back off from there).
 */
export function dfAdaptivePixelRatio(pr: number, avgMs: number, b: DfPrBounds, goodTime: number, locked: boolean): number {
    if (avgMs > 19.5 && pr > b.min) return Math.max(b.min, pr - STEP)
    if (!locked && goodTime >= 4 && pr < b.max) return Math.min(b.max, pr + STEP)
    return Math.min(b.max, Math.max(b.min, pr))
}

/**
 * Every pixel-ratio change reallocates the whole post chain (the MSAA HDR target,
 * the composer's buffers, the bloom mips): a hitch of its own. The governor keeps
 * changes rare: one long frame (GC, a burst of effects, the resize itself) never
 * counts as load, a step down needs a second of slow frames, and a step up that
 * has to be taken back locks that level out for longer each time.
 */
export interface DfPrGovernor {
    pr: number
    /** Smoothed frame time (ms). */
    avg: number
    evalTimer: number
    /** Seconds of on-budget frames in a row. */
    goodTime: number
    /** Evaluations in a row over budget. */
    badEvals: number
    /** Frames left to ignore after a change (they carry the reallocation). */
    settle: number
    lockUntil: number
    lastUpAt: number
    /** The last step up still stands (it wasn't taken back). */
    climbed: boolean
    /** Step-ups taken back in a row: each doubles the lock. */
    backoffs: number
}

/** Longest frame (ms) the average sees: two vsyncs at 60 Hz, so a single hitch doesn't read as load. */
const SAMPLE_CAP = 34
const SETTLE_FRAMES = 8
/** Seconds before climbing again after a step down; a step up taken back doubles it each time. */
const DOWN_HOLD_S = 45
const MAX_LOCK_S = 480
/** Seconds between two step ups. */
const UP_HOLD_S = 10
/** A step down this soon after a step up takes that step up back. */
const BACKOFF_WINDOW_S = 15

export function dfNewPrGovernor(pr: number): DfPrGovernor {
    return { pr, avg: 16.7, evalTimer: 0, goodTime: 0, badEvals: 0, settle: 0, lockUntil: 0, lastUpAt: -100, climbed: false, backoffs: 0 }
}

/** Feeds one frame (`dt` seconds, `clock` the running total); returns the pixel ratio to render at. */
export function dfStepPrGovernor(g: DfPrGovernor, dt: number, clock: number, b: DfPrBounds): number {
    if (g.settle > 0) {
        g.settle--
        return g.pr
    }
    g.avg += (Math.min(SAMPLE_CAP, dt * 1000) - g.avg) * 0.08
    g.evalTimer += dt
    if (g.evalTimer < 0.5) return g.pr
    g.evalTimer = 0
    if (g.avg <= 17.6) g.goodTime += 0.5
    else g.goodTime = 0
    g.badEvals = g.avg > 19.5 ? g.badEvals + 1 : 0
    // a step up that held for a minute was fine: forget the earlier backoffs
    if (g.backoffs > 0 && g.climbed && clock - g.lastUpAt > 60) g.backoffs = 0
    const next = dfAdaptivePixelRatio(g.pr, g.badEvals >= 2 ? g.avg : 0, b, g.goodTime, clock < g.lockUntil)
    if (next === g.pr) return g.pr
    if (next < g.pr) {
        // load came up: don't climb straight back into it
        let hold = DOWN_HOLD_S
        if (clock - g.lastUpAt < BACKOFF_WINDOW_S) {
            g.backoffs++
            hold = Math.min(MAX_LOCK_S, DOWN_HOLD_S * 2 ** g.backoffs)
            g.climbed = false
        }
        g.lockUntil = Math.max(g.lockUntil, clock + hold)
    }
    if (next > g.pr) {
        // one step at a time: give the new level a while to prove itself
        g.lastUpAt = clock
        g.climbed = true
        g.lockUntil = clock + UP_HOLD_S
    }
    g.pr = next
    g.goodTime = 0
    g.badEvals = 0
    g.settle = SETTLE_FRAMES
    return next
}
