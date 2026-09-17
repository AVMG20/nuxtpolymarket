import type { HitShape, Vec } from './types'

export function normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
}

export function dist(a: Vec, b: Vec): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

export function angleTo(from: Vec, to: Vec): number {
    return Math.atan2(to.y - from.y, to.x - from.x)
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

/** Circle `target` (radius `r`) overlaps a sector centred on `origin` facing `angle`. */
export function inArc(origin: Vec, angle: number, halfAngle: number, reach: number, target: Vec, r: number): boolean {
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const d = Math.hypot(dx, dy)
    if (d - r > reach) return false
    if (d <= r + 2) return true
    const diff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle))
    const tolerance = Math.asin(Math.min(1, r / d))
    return diff <= halfAngle + tolerance
}

/** Circle overlaps a rectangle of length `reach` and width `width` extending from `origin` along `angle`. */
export function inThrust(origin: Vec, angle: number, reach: number, width: number, target: Vec, r: number): boolean {
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const along = dx * c + dy * s
    const perp = Math.abs(-dx * s + dy * c)
    return along >= -r && along <= reach + r && perp <= width / 2 + r
}

export function inCircle(origin: Vec, radius: number, target: Vec, r: number): boolean {
    return Math.hypot(target.x - origin.x, target.y - origin.y) <= radius + r
}

export function shapeHits(shape: HitShape, origin: Vec, angle: number, reachMult: number, target: Vec, r: number): boolean {
    switch (shape.kind) {
        case 'arc': return inArc(origin, angle, shape.halfAngle, shape.reach * reachMult, target, r)
        case 'thrust': return inThrust(origin, angle, shape.reach * reachMult, shape.width * reachMult, target, r)
        case 'circle': return inCircle(origin, shape.radius * reachMult, target, r)
    }
}

/** Circle overlaps a swept segment from `a` to `b` with half-width `halfWidth`. */
export function inSegment(a: Vec, b: Vec, halfWidth: number, target: Vec, r: number): boolean {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    let t = 0
    if (len2 > 0) t = clamp(((target.x - a.x) * abx + (target.y - a.y) * aby) / len2, 0, 1)
    const px = a.x + abx * t
    const py = a.y + aby * t
    return Math.hypot(target.x - px, target.y - py) <= halfWidth + r
}
