// Pixel-ratio policy (pure, tested). Standard-density screens never render
// below native resolution and get ~1.5x supersampling when affordable;
// high-density screens may back off toward ~60% of native, which the extra
// density hides. The adaptive step lowers the ratio when frames run long.
// Every change costs a ~100 ms hitch (the post chain is reallocated), so the
// settled ratio is remembered per screen (`dfPrMemoryKey`) and a match starts
// there instead of walking down to it.

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

/** The frame time the governor aims for (60 Hz). */
const TARGET_MS = 16.7

/**
 * Next pixel ratio given the smoothed frame time. Steps down when frames run
 * long (> ~19.5 ms), steps up after `goodTime` seconds of on-budget frames
 * unless the ceiling is locked (it just had to back off from there).
 *
 * A step down goes straight to the ratio that should fit (pixel cost grows
 * with its square), at least one step: every change reallocates the post
 * chain, so one bigger step beats a staircase of hitches.
 */
export function dfAdaptivePixelRatio(pr: number, avgMs: number, b: DfPrBounds, goodTime: number, locked: boolean): number {
    if (avgMs > 19.5 && pr > b.min) {
        const fit = pr * Math.sqrt(TARGET_MS / avgMs)
        const steps = Math.max(1, Math.floor((pr - fit) / STEP + 0.5))
        return Math.max(b.min, pr - steps * STEP)
    }
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
    /** Frames and missed frames (over `MISS_MS`) in the current evaluation. */
    frames: number
    misses: number
    /** Frames and misses of the last `MISS_WINDOW` evaluations (half a second each). */
    winFrames: number[]
    winMisses: number[]
}

/** Longest frame (ms) the average sees: two vsyncs at 60 Hz, so a single hitch doesn't read as load. */
const SAMPLE_CAP = 34
const SETTLE_FRAMES = 8
/**
 * A frame this long missed a 60 Hz vsync. Missing one in five averages ~20 ms, right at the
 * step-down line, yet judders visibly: the share of misses counts as load on its own.
 */
const MISS_MS = 25
/**
 * The target is a p95 (and nearly a p99) at 60 fps: more than 3% of frames missed over the
 * last two seconds is over budget, and a level may only climb when it missed none of them.
 * Two seconds (~120 frames) so a single stray hitch is under 1% and never steps down.
 */
const MISS_BAD = 0.03
const MISS_WINDOW = 4
/** Seconds before climbing again after a step down; a step up taken back doubles it each time. */
const DOWN_HOLD_S = 45
const MAX_LOCK_S = 480
/** Seconds between two step ups. */
const UP_HOLD_S = 10
/** A step down this soon after a step up takes that step up back. */
const BACKOFF_WINDOW_S = 15

export function dfNewPrGovernor(pr: number): DfPrGovernor {
    return { pr, avg: 16.7, evalTimer: 0, goodTime: 0, badEvals: 0, settle: 0, lockUntil: 0, lastUpAt: -100, climbed: false, backoffs: 0, frames: 0, misses: 0, winFrames: [], winMisses: [] }
}

/**
 * Feeds one frame (`dt` seconds, `clock` the running total); returns the pixel ratio to render at.
 * `quiet` says a hitch would go unnoticed (between rounds, paused, nothing to shoot): a step up,
 * which is never urgent, waits for one. Steps down still happen at once.
 */
export function dfStepPrGovernor(g: DfPrGovernor, dt: number, clock: number, b: DfPrBounds, quiet = true): number {
    if (g.settle > 0) {
        g.settle--
        return g.pr
    }
    g.avg += (Math.min(SAMPLE_CAP, dt * 1000) - g.avg) * 0.08
    g.frames++
    if (dt * 1000 > MISS_MS) g.misses++
    g.evalTimer += dt
    if (g.evalTimer < 0.5) return g.pr
    g.evalTimer = 0
    g.winFrames.push(g.frames)
    g.winMisses.push(g.misses)
    if (g.winFrames.length > MISS_WINDOW) {
        g.winFrames.shift()
        g.winMisses.shift()
    }
    g.frames = 0
    g.misses = 0
    let wf = 0
    let wm = 0
    for (let i = 0; i < g.winFrames.length; i++) {
        wf += g.winFrames[i]!
        wm += g.winMisses[i]!
    }
    const missed = wm / Math.max(1, wf)
    if (g.avg <= 17.6 && wm === 0) g.goodTime += 0.5
    else g.goodTime = 0
    const judder = missed > MISS_BAD
    g.badEvals = g.avg > 19.5 || judder ? g.badEvals + 1 : 0
    // judder under a fine-looking average still steps down: read it as the load it costs
    const load = judder ? Math.max(g.avg, 19.6, 16.7 * (1 + missed)) : g.avg
    // a step up that held for a minute was fine: forget the earlier backoffs
    if (g.backoffs > 0 && g.climbed && clock - g.lastUpAt > 60) g.backoffs = 0
    const next = dfAdaptivePixelRatio(g.pr, g.badEvals >= 2 ? load : 0, b, g.goodTime, clock < g.lockUntil)
    if (next === g.pr) return g.pr
    // keep counting good time through the fight: the climb happens at the next lull
    if (next > g.pr && !quiet) return g.pr
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
    g.frames = 0
    g.misses = 0
    // the new level starts its own record (the frames before belong to the old one)
    g.winFrames.length = 0
    g.winMisses.length = 0
    g.settle = SETTLE_FRAMES
    return next
}

/** Storage key for the settled ratio: one per screen density, size bucket and quality tier. */
export function dfPrMemoryKey(dpr: number, width: number, height: number, quality: 'low' | 'high'): string {
    const area = Math.round((width * height) / 250000)
    return `df-pr-v1:${quality}:${Math.round(dpr * 100)}:${area}`
}
