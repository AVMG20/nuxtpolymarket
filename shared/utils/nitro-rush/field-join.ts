import type { CustomTrack, SectionSpot } from './custom'
import { mouthsFit } from './custom-fields'
import { edgeSlots, edgeTiles, FIELD_EDGES, fieldPoint, portPose, portTiles, slotAt, walledOffFault, type FieldPort } from './field'
import { fieldGroup, insideField, walkedFields } from './field-group'
import { draftFieldDefs, fieldClearanceFault } from './field-layout'
import { GRID, type LayoutWalk } from './layout'
import { MIN_CLEARANCE } from './road-checks'

/** Where a branch can finish into a field: square onto each free slot of its outer edges or those of a field joined to it, and the field edges the road keeps clear of on the way. */

/** How far back from a slot's edge, on the grid, the new road may end and run straight in. */
const SLOT_DEPTHS = [0, GRID, GRID * 2]
/** Metres between the points that stand for a field's edge to the road search. */
const EDGE_SAMPLE = 4
/** A field's edge kept as clear as a road's wall: the edge wall's footprint and a little room. */
const EDGE_WALL = 1.5
/** How far out a slot must open onto open ground, not onto a field flush against it. */
const OUTSIDE = 1

/** A spot the new road heads for, quarter turn `k` into the field, how far it is as the crow flies, and the straight `depth` it then runs on to the edge. */
export interface FieldGoal {
    x: number
    z: number
    k: number
    metres: number
    depth: number
}

type RoadLike = Pick<LayoutWalk, 'pts' | 'ys' | 'lifts' | 'walls'>

/** The field at `to` as a branch's goal: its height and the free slots on the outer edges of it and every field joined to it; null when it isn't laid. */
export function fieldJoin(t: CustomTrack, walks: readonly LayoutWalk[], to: SectionSpot) {
    const fields = walkedFields(t, walks)
    const group = fieldGroup(fields, to)
    const self = group.find(f => f.spot.branch === to.branch && f.spot.at === to.at)
    if (!self) return null
    const { defs, ids } = draftFieldDefs(walks, (l, k) => ({ branch: l, s: k }))
    const slots: { x: number, z: number, heading: number, at: SectionSpot }[] = []
    for (const target of group) {
        const { plan } = target
        const used: FieldPort[] = (defs[ids.get(target.id) ?? -1]?.mouths ?? []).map(m => ({ edge: m.edge, tile: Math.min(edgeTiles(plan, m.edge) - 1, Math.max(0, slotAt(m.at))) }))
        for (const edge of FIELD_EDGES) {
            for (const tile of edgeSlots(plan, edge)) {
                const ports = [...used, { edge, tile }]
                if (!mouthsFit(plan, ports) || walledOffFault(plan, ports.flatMap(p => portTiles(plan, p)))) continue
                const out = portPose(target, { edge, tile })
                const [dx, dz] = [Math.sin(out.heading), -Math.cos(out.heading)]
                const flush = fields.some(f => f !== target && Math.abs(f.y - target.y) < MIN_CLEARANCE && insideField(f, out.x + dx * OUTSIDE, out.z + dz * OUTSIDE))
                if (!flush) slots.push({ ...out, at: target.spot })
            }
        }
    }
    return {
        y: self.y,
        /** Each free slot, square onto its edge heading out, and the field section it's on. */
        slots,
        /** Grid spots square off each free slot, heading in, nearest `from` first. */
        goals(from: { x: number, z: number }): FieldGoal[] {
            const goals: FieldGoal[] = []
            for (const s of slots) {
                const [dx, dz] = [Math.sin(s.heading), -Math.cos(s.heading)]
                const k = ((Math.round((s.heading + Math.PI) * 2 / Math.PI) % 4) + 4) % 4
                for (const d of SLOT_DEPTHS) {
                    const x = Math.round((s.x + dx * d) / GRID) * GRID
                    const z = Math.round((s.z + dz * d) / GRID) * GRID
                    if (Math.abs(x - s.x - dx * d) > 1e-6 || Math.abs(z - s.z - dz * d) > 1e-6) continue
                    goals.push({ x, z, k, metres: Math.hypot(x - from.x, z - from.z) + d, depth: d })
                }
            }
            return goals.sort((a, b) => a.metres - b.metres)
        },
        /** Every field's edge as road to keep clear of, so the new road goes round fields rather than across them. */
        edges: fields.map((f): RoadLike => {
            const corners = [[0, 0], [f.plan.width, 0], [f.plan.width, f.plan.length], [0, f.plan.length]] as const
            const pts: [number, number][] = []
            corners.forEach(([u0, v0], i) => {
                const [u1, v1] = corners[(i + 1) % 4]!
                const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / EDGE_SAMPLE)
                for (let k = 0; k < n; k++) {
                    pts.push(fieldPoint(f, u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n))
                }
            })
            return { pts, ys: pts.map(() => f.y), lifts: pts.map(() => 0), walls: pts.map(() => EDGE_WALL) }
        })
    }
}

/** A walk without its points on fields, which only the field's edges stand for. */
export function offFields(w: LayoutWalk): RoadLike {
    const on = (i: number) => w.fields.some(f => i >= f.from && i < f.to)
    const keep = w.pts.map((_, i) => !on(i))
    const pick = <T>(a: readonly T[]) => a.filter((_, i) => keep[i])
    return { pts: pick(w.pts), ys: pick(w.ys), lifts: pick(w.lifts), walls: pick(w.walls) }
}

/** Whether line `line` keeps off every field it doesn't drive on. */
export function lineClearOfFields(walks: readonly LayoutWalk[], line: number) {
    const { defs } = draftFieldDefs(walks, (l, k) => ({ branch: l, s: k }))
    const lines = walks.map((w, l) => l === line ? { ...w, fielded: w.fields.map(f => [f.from, f.to] as const) } : { pts: [], ys: [], walls: [], fielded: [] })
    return !fieldClearanceFault(defs, lines)
}
