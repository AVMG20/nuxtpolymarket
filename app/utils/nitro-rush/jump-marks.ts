import type { Track, TrackLine } from '#shared/utils/nitro-rush/track'

/** Where the paint warning of each jump goes on the road: the arrows up to the lip and the stripe across it. */

/** Painted road reaches this far back from a jump's lip, over the kicker and the road before it. */
export const JUMP_PAINT_REACH = 72
/** One arrow every this far; spans start on its multiples so the paint never starts halfway through an arrow. */
export const ARROW_TILE = 8
export const LIP_STRIPE = 1.5
/** Paint stays this far off a lap line, so it never covers the chequers. */
const LAP_LINE_CLEAR = 4

export interface JumpMarks {
    branch: number
    /** Where the road ends in the air. */
    lip: number
    arrows: [number, number][]
    stripe: [number, number]
}

/** `from`..`to` with every span in `cuts` taken out. */
function subtract(from: number, to: number, cuts: readonly (readonly [number, number])[]) {
    let free: [number, number][] = [[from, to]]
    for (const [a, b] of cuts) free = free.flatMap(([f, t]) => b <= f || a >= t ? [[f, t]] : [...(a > f ? [[f, a]] : []), ...(b < t ? [[b, t]] : [])] as [number, number][])
    return free
}

/** The part of a span on whole arrow tiles, or null if not one fits. */
function snapped([f, t]: readonly [number, number]): [number, number] | null {
    const a = Math.ceil(f / ARROW_TILE) * ARROW_TILE
    const b = Math.floor(t / ARROW_TILE) * ARROW_TILE
    return b > a ? [a, b] : null
}

function marksOn(track: Track, line: TrackLine): JumpMarks[] {
    const laps = track.lapLines.filter(l => l.branch === line.branch).map(l => [l.s - LAP_LINE_CLEAR, l.s + LAP_LINE_CLEAR] as const)
    // Boost pads keep their own paint, and gaps have no road to paint.
    const cuts = [...line.boostPads.map(p => [p.from, p.to] as const), ...line.gaps, ...laps]
    return line.gaps.map(([lip]) => {
        const stripe: [number, number] = [lip - LIP_STRIPE, lip]
        const arrows = subtract(Math.max(0, lip - JUMP_PAINT_REACH), stripe[0], cuts).map(snapped).filter(a => a !== null)
        return { branch: line.branch, lip, arrows, stripe }
    })
}

export const jumpMarks = (track: Track) => track.branches.flatMap(line => marksOn(track, line))
