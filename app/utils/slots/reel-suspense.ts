// Sequential reel suspense for pixi-reels slots.
//
// pixi-reels runs the anticipation phase of every flagged reel in parallel:
// all reels leave their spin phase together, each teased reel waits
// `anticipationDelay`, then stops after `index * stopDelay`. With two or more
// teased reels they land almost together, and in turbo (stopDelay 0) exactly
// together, so the tease "starts" on one reel and the rest just drop.
//
// Instead, skip the library's anticipation and hand it explicit stop delays
// (`reelSet.setStopDelays`) that land reels one by one: plain reels `step` ms
// apart, every teased reel `tease` ms after the reel before it. Slow the teased
// reel down yourself on the previous reel's `spin:reelLanded` with
// `teaseReelSpeed`.

export interface SuspenseTiming {
    /** Gap between plain reels, ms. */
    step: number
    /** Time each teased reel keeps spinning after the reel before it lands, ms. */
    tease: number
}

/** Stop delay (ms) per reel so teased reels land one after another. */
export function suspenseStopDelays(reels: number, teased: readonly number[], timing: SuspenseTiming): number[] {
    const out: number[] = []
    let at = 0
    for (let i = 0; i < reels; i++) {
        if (i > 0) at += teased.includes(i) ? timing.tease : timing.step
        out.push(at)
    }
    return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gsap = { to: (target: object, vars: Record<string, unknown>) => any }

/**
 * Ease a spinning reel down to a crawl for the tease. The reel's stop phase
 * sets its speed back when it lands, so nothing needs undoing.
 */
export function teaseReelSpeed(gsap: Gsap, reel: { speed: number } | undefined, spinSpeed: number, teaseMs: number, factor = 0.35) {
    if (!reel) return
    gsap.to(reel, { speed: spinSpeed * factor, duration: (teaseMs / 1000) * 0.4, ease: 'power2.out', overwrite: true })
}
