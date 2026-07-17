export function lerpAngle(from: number, to: number, t: number) {
    let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
    if (diff < -Math.PI) diff += Math.PI * 2
    return from + diff * t
}

export function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1)
}

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
