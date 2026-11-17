import { lineSections, walkedField, type CustomTrack, type SectionSpot } from './custom'
import { edgeWalls, fieldLocal, fieldPoint, sharedEdges, type FieldPlacement, type LevelField } from './field'
import type { LayoutWalk } from './layout'

/** Fields laid edge to edge at one height drive as one field, so the builder shows and edits them together. */

/** A field section as walked: its spot in the course, where it lies and how high. */
export interface WalkedFieldSection extends FieldPlacement {
    /** The walk's id for it, which roads driving into it carry too. */
    id: number
    spot: SectionSpot
    y: number
}

/** Every field section the course lays, in course order. */
export function walkedFields(t: CustomTrack, walks: readonly LayoutWalk[]): WalkedFieldSection[] {
    return walks.flatMap((w, branch) => lineSections(t, branch).flatMap((id, at) => {
        if (id !== 'field') return []
        const spot = { branch, at }
        const f = walkedField(walks, spot)
        return f?.placement ? [{ ...f.placement, id: f.id, spot, y: w.ys[f.hub] ?? w.end.y }] : []
    }))
}

/** The fields joined edge to edge with the one at `spot`, however far, it among them, in course order; empty when it isn't walked. */
export function fieldGroup(fields: readonly WalkedFieldSection[], spot: SectionSpot): WalkedFieldSection[] {
    const start = fields.find(f => f.spot.branch === spot.branch && f.spot.at === spot.at)
    if (!start) return []
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) {
        const a = queue.pop()!
        for (const b of fields) {
            if (seen.has(b) || !sharedEdges(a, [a, b]).length) continue
            seen.add(b)
            queue.push(b)
        }
    }
    return fields.filter(f => seen.has(f))
}

/** Quarter turns, clockwise from above, from `base`'s heading to `f`'s; fields only ever turn in quarters. */
export const quarterTurns = (base: Pick<FieldPlacement, 'heading'>, f: Pick<FieldPlacement, 'heading'>) => ((Math.round((f.heading - base.heading) / (Math.PI / 2)) % 4) + 4) % 4

/** (u, v) on field `f` in `base`'s frame. */
export function inFrame(base: Pick<FieldPlacement, 'x' | 'z' | 'heading'>, f: Pick<FieldPlacement, 'x' | 'z' | 'heading'>, u: number, v: number) {
    const [x, z] = fieldPoint(f, u, v)
    return fieldLocal(base, x, z)
}

/** A field from above in the world: its corners, and only the stretches of edge no level neighbour shares, so joined fields read as one. */
export interface FieldOutline {
    y: number
    corners: [number, number][]
    rim: [[number, number], [number, number]][]
}

export function fieldOutlines(fields: readonly LevelField[]): FieldOutline[] {
    return fields.map((f) => {
        const { width, length } = f.plan
        const at = (u: number, v: number) => fieldPoint(f, u, v)
        return {
            y: f.y,
            corners: [at(0, 0), at(width, 0), at(width, length), at(0, length)],
            rim: edgeWalls(f.plan, [], sharedEdges(f, fields)).map(s => [at(s.x0, s.z0), at(s.x1, s.z1)])
        }
    })
}

/** Whether world (x, z) lies inside field `f`, not on its edge. */
export function insideField(f: Pick<FieldPlacement, 'x' | 'z' | 'heading' | 'plan'>, x: number, z: number) {
    const { u, v } = fieldLocal(f, x, z)
    return u > 0 && v > 0 && u < f.plan.width && v < f.plan.length
}

/** Whether world (x, z) lies inside a field no more than `rise` metres from height `y`. */
export const onAnyField = (fields: readonly LevelField[], x: number, y: number, z: number, rise = 2) =>
    fields.some(f => Math.abs(f.y - y) <= rise && insideField(f, x, z))
