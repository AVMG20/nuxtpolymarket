import type { DfMapDef, DfSpot } from '#shared/utils/dead-front/map'
import type { DfEggState } from '#shared/utils/dead-front/protocol'
import { DF_EGG_STEPS } from '#shared/utils/dead-front/types'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Easter-egg objective guide (pure, tested): which step text to show and
// where the waypoint points.

export interface DfObjectiveTarget {
    pos: Vec3
    label: string
}

/** The map's lightning-rod switches (the egg step before the claim). */
export function dfEggRodSpots(map: DfMapDef): DfSpot[] {
    return map.egg.rods ?? []
}

/** Nearest of `spots` not in `done` (height weighs more: a floor up is far), or null. */
function nearestOpen(spots: readonly DfSpot[], done: readonly string[], from: Vec3): DfSpot | null {
    let best: DfSpot | null = null
    let bestD = Infinity
    for (const f of spots) {
        if (done.includes(f.id)) continue
        const dx = f.pos.x - from.x
        const dy = f.pos.y - from.y
        const dz = f.pos.z - from.z
        const d = dx * dx + dy * dy * 4 + dz * dz
        if (d < bestD) {
            bestD = d
            best = f
        }
    }
    return best
}

export function dfObjectiveText(step: DfEggState['step']): string {
    return DF_EGG_STEPS.find(s => s.id === step)?.text ?? ''
}

/**
 * The next target: power switch -> nearest unfound fuse -> generator
 * (install) -> generator (charge) -> nearest unthrown lightning rod ->
 * pedestal. Null when done.
 */
export function dfObjectiveTarget(egg: DfEggState, power: boolean, map: DfMapDef, from: Vec3): DfObjectiveTarget | null {
    switch (egg.step) {
        case 'power':
            return power ? null : { pos: map.power.pos, label: 'Power' }
        case 'fuses': {
            const best = nearestOpen(map.egg.fuses, egg.fusesFound, from)
            return best ? { pos: best.pos, label: 'Tesla fuse' } : { pos: map.egg.generator.pos, label: 'Arc Generator' }
        }
        case 'rods': {
            const best = nearestOpen(dfEggRodSpots(map), egg.rodsOn ?? [], from)
            return best ? { pos: best.pos, label: 'Lightning rod' } : { pos: map.egg.pedestal.pos, label: 'Pedestal' }
        }
        case 'install':
        case 'charge':
            return { pos: map.egg.generator.pos, label: 'Arc Generator' }
        case 'claim':
            return { pos: map.egg.pedestal.pos, label: 'Pedestal' }
        default:
            return null
    }
}

export interface DfScreenPoint {
    x: number // css px
    y: number
    onScreen: boolean
    /** Angle (radians, screen space, 0 = right) toward the target when clamped to the edge. */
    angle: number
}

/**
 * Projects a view-space point (camera looks down -z) to the screen and clamps
 * it inside a margin when it is off-screen or behind the camera.
 * `projX/projY` are projectionMatrix elements [0] and [5].
 */
export function dfClampToScreen(vx: number, vy: number, vz: number, projX: number, projY: number, w: number, h: number, margin: number, out: DfScreenPoint): DfScreenPoint {
    const behind = vz > -0.05
    let nx: number
    let ny: number
    if (!behind) {
        nx = (vx * projX) / -vz
        ny = (vy * projY) / -vz
    } else {
        // behind: push the direction out to the edge, mirrored
        const l = Math.sqrt(vx * vx + vy * vy) || 1
        nx = (vx / l) * 10
        ny = (vy / l) * 10
        if (Math.abs(vx) < 1e-3 && Math.abs(vy) < 1e-3) ny = -10
    }
    const mx = 1 - (margin * 2) / w
    const my = 1 - (margin * 2) / h
    const inside = !behind && Math.abs(nx) <= mx && Math.abs(ny) <= my
    if (!inside) {
        const s = Math.max(Math.abs(nx) / mx, Math.abs(ny) / my, 1e-6)
        nx /= s
        ny /= s
    }
    out.x = (nx * 0.5 + 0.5) * w
    out.y = (-ny * 0.5 + 0.5) * h
    out.onScreen = inside
    out.angle = Math.atan2(-ny, nx)
    return out
}
