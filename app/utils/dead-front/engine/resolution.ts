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
