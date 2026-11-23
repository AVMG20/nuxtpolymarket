// Live frame-rate readout for the HUD: a fixed ring of frame intervals (no
// per-frame garbage), summarised a couple of times a second into the frame
// rate and the 95th and 99th-percentile frame times over the last two seconds.
// The average hides hitches; the percentiles show them.

export interface DfFrameStats {
    /** Frame intervals (ms), newest at `head - 1`. */
    readonly gaps: Float32Array
    /** Scratch for sorting a window without allocating. */
    readonly scratch: Float32Array
    head: number
    count: number
}

export interface DfFrameSummary {
    fps: number
    /** 95th and 99th-percentile frame times (ms). */
    p95: number
    p99: number
}

export function dfNewFrameStats(capacity = 512): DfFrameStats {
    return { gaps: new Float32Array(capacity), scratch: new Float32Array(capacity), head: 0, count: 0 }
}

export function dfPushFrame(s: DfFrameStats, ms: number): void {
    if (!(ms > 0)) return
    s.gaps[s.head] = ms
    s.head = (s.head + 1) % s.gaps.length
    if (s.count < s.gaps.length) s.count++
}

/** Frame rate, p95 and p99 over the newest `windowMs` of frames (written into `out`). */
export function dfFrameSummary(s: DfFrameStats, out: DfFrameSummary, windowMs = 2000): DfFrameSummary {
    const cap = s.gaps.length
    let n = 0
    let sum = 0
    while (n < s.count && sum < windowMs) {
        const g = s.gaps[(s.head - 1 - n + cap) % cap]!
        s.scratch[n] = g
        sum += g
        n++
    }
    if (n === 0 || sum <= 0) {
        out.fps = 0
        out.p95 = 0
        out.p99 = 0
        return out
    }
    out.fps = Math.round((n * 1000) / sum)
    const w = s.scratch.subarray(0, n)
    w.sort()
    out.p95 = Math.round(w[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]!)
    out.p99 = Math.round(w[Math.min(n - 1, Math.ceil(n * 0.99) - 1)]!)
    return out
}
