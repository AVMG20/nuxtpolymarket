import { lineSections, walkedField, type CustomTrack, type SectionSpot } from './custom'
import { fieldLocal, fieldPoint, sharedEdges, type FieldPlacement } from './field'
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

/** Whether world (x, z) lies inside field `f`, not on its edge. */
export function insideField(f: Pick<FieldPlacement, 'x' | 'z' | 'heading' | 'plan'>, x: number, z: number) {
    const { u, v } = fieldLocal(f, x, z)
    return u > 0 && v > 0 && u < f.plan.width && v < f.plan.length
}
