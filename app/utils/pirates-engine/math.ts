import { randomFloat } from '#shared/utils/random'

export const TAU = Math.PI * 2

/** Signed shortest turn from `from` to `to`, in (-PI, PI]. */
export function angleDiff(from: number, to: number) {
    let diff = (to - from) % TAU
    if (diff > Math.PI) diff -= TAU
    if (diff <= -Math.PI) diff += TAU
    return diff
}

export function lerpAngle(from: number, to: number, t: number) {
    return from + angleDiff(from, to) * t
}

/** Turn `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number) {
    const diff = angleDiff(from, to)
    if (Math.abs(diff) <= maxStep) return to
    return from + Math.sign(diff) * maxStep
}

export function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1)
}

export function dist2(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1
    const dy = y2 - y1
    return dx * dx + dy * dy
}

/** Uniform in [min, max). Backed by the shared CSPRNG, so it is safe for outcomes. */
export function randRange(min: number, max: number) {
    return min + randomFloat() * (max - min)
}

export function clamp(value: number, min: number, max: number) {
    return value < min ? min : value > max ? max : value
}

/** Shortest distance from segment (a→b) to point p. */
export function segPointDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px - ax, py - ay)
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}
