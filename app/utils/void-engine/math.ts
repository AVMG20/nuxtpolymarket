export function lerpAngle(from: number, to: number, t: number) {
    let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
    if (diff < -Math.PI) diff += Math.PI * 2
    return from + diff * t
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function stepAngle(from: number, to: number, maxStep: number) {
    let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
    if (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) <= maxStep) return to
    return from + Math.sign(diff) * maxStep
}

export function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1)
}

export function distSq(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1
    const dy = y2 - y1
    return dx * dx + dy * dy
}

export function clamp(value: number, min: number, max: number) {
    return value < min ? min : value > max ? max : value
}

/** Cosmetic only — every gameplay roll goes through #shared/utils/random. */
export function randRange(min: number, max: number) {
    return min + Math.random() * (max - min)
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
