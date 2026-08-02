export function clamp(value: number, min: number, max: number) {
    return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
}

export function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1)
}

/** Cosmetic only — anything that decides an outcome goes through #shared/utils/random. */
export function randRange(min: number, max: number) {
    return min + Math.random() * (max - min)
}

/** Shortest distance from segment (a→b) to point p — used for swept bullet hits. */
export function segPointDist(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px - ax, py - ay)
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = clamp(t, 0, 1)
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** Mixes two packed RGB colours. */
export function mixHex(a: number, b: number, t: number) {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
    return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) & 0xffffff
}

export function shadeHex(color: number, amount: number) {
    return amount < 0 ? mixHex(color, 0x000000, -amount) : mixHex(color, 0xffffff, amount)
}
