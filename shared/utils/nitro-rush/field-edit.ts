import { isFieldSection, MAX_BRANCHES, MAX_SECTIONS, sectionCount, type CustomTrack, type SectionSpot } from './custom'
import { mouthsFit, type CustomField } from './custom-fields'
import { insertSection, walkForks } from './custom-forks'
import { defaultFieldPlan, edgeLength, edgeTile, edgeTiles, FIELD_MAX_ITEMS, FIELD_TILE, fieldsOverlap, isBlocking, walledOffFault, type FieldDir, type FieldEdge, type FieldPlan, type FieldPort, type FieldTile } from './field'
import { walkedFields } from './field-group'
import { MIN_CLEARANCE } from './road-checks'

/** The builder's edits to a field: its size, its items and the roads out of it. Each gives the new course, or why it can't. */

export type FieldTool = 'boost' | 'checkpoint' | 'block' | 'pillar' | 'erase'

export type FieldEdit = { track: CustomTrack, error: null } | { track: null, error: string }

/** The sizes the builder offers first. */
export const FIELD_PRESETS = [20, 100, 200] as const

const sameSpot = (a: SectionSpot, b: SectionSpot) => a.branch === b.branch && a.at === b.at
const ok = (track: CustomTrack): FieldEdit => ({ track, error: null })
const no = (error: string): FieldEdit => ({ track: null, error })

/** The plan of the field section at `spot`: stored, or the default one a course lays without. */
export function fieldPlanAt(t: CustomTrack, spot: SectionSpot): FieldPlan {
    const f = t.fields?.find(f => sameSpot(f.at, spot))
    if (!f) return defaultFieldPlan()
    const { at: _, ...plan } = f
    return plan
}

/** Every mouth the field at `spot` keeps open: the road it's laid on in and out, and each port a branch leaves through. */
export function fieldPorts(t: CustomTrack, spot: SectionSpot, plan = fieldPlanAt(t, spot)): FieldPort[] {
    const ports = (t.branches ?? []).flatMap(b => b.from.port && sameSpot(b.from, spot) ? [b.from.port] : [])
    return [{ edge: 'entry', tile: plan.entry }, plan.exit, ...ports]
}

/** `t` with the field at `spot` laid to `plan`, fields kept in course order as storage keeps them. */
export function withField(t: CustomTrack, spot: SectionSpot, plan: FieldPlan): CustomTrack {
    const fields: CustomField[] = [...(t.fields ?? []).filter(f => !sameSpot(f.at, spot)), { at: { ...spot }, ...plan }]
    fields.sort((a, b) => a.at.branch - b.at.branch || a.at.at - b.at.at)
    return { ...t, fields }
}

/** Why `plan`, with `ports`, won't do as the field's new plan, or null; `crowded` says why its mouths don't fit. */
function planFault(t: CustomTrack, spot: SectionSpot, plan: FieldPlan, ports: readonly FieldPort[], crowded = 'keep road tiles clear'): string | null {
    if (plan.tiles.length > FIELD_MAX_ITEMS) return `a field holds at most ${FIELD_MAX_ITEMS} items`
    if (!mouthsFit(plan, ports)) return crowded
    if (walledOffFault(plan, ports.map(p => edgeTile(plan, p)))) return 'that walls something off'
    if (sectionCount(withField(t, spot, plan)) > MAX_SECTIONS) return 'the track is full'
    return null
}

/** The field at `spot` with `tool` used on tile (col, row): `turn` turns a pad or gate already there instead of leaving it, and a new one faces `facing` if it fits. */
export function useFieldTool(t: CustomTrack, spot: SectionSpot, col: number, row: number, tool: FieldTool, turn = true, facing: FieldDir = 0): FieldEdit {
    if (!isFieldSection(t, spot)) return no('that isn\'t a field')
    const plan = fieldPlanAt(t, spot)
    if (col < 0 || row < 0 || col >= plan.width / FIELD_TILE || row >= plan.length / FIELD_TILE) return no('that\'s off the field')
    const here = plan.tiles.find(k => k.col === col && k.row === row)
    const others = plan.tiles.filter(k => k !== here)
    const fitted = (tiles: FieldTile[]) => {
        const next = { ...plan, tiles: tiles.sort((a, b) => a.row - b.row || a.col - b.col) }
        const fault = planFault(t, spot, next, fieldPorts(t, spot, next))
        return fault ? no(fault) : ok(withField(t, spot, next))
    }
    let tiles = others
    if (tool === 'boost' || tool === 'checkpoint') {
        if (here?.kind === tool && !turn) return ok(t)
        // A gate counts either way through, so it only stands along or across.
        const ways = tool === 'checkpoint' ? 2 : 4
        // It turns on to the next way that fits, so a gate on a road's tile skips the way across it.
        const from = here?.kind === tool ? here.dir + 1 : facing
        let first: FieldEdit | null = null
        for (let k = 0; k < (here?.kind === tool ? ways - 1 : ways); k++) {
            const edit = fitted([...others, { col, row, kind: tool, dir: (from + k) % ways as FieldDir }])
            if (!edit.error) return edit
            first ??= edit
        }
        return first!
    } else if (tool !== 'erase') {
        if (here?.kind === tool) return ok(t)
        tiles = [...others, { col, row, kind: tool }]
    } else if (!here) {
        return ok(t)
    }
    return fitted(tiles)
}

/** The field at `spot` at a new size: items off it go, and the roads in and out stay on their edges, as near where they were. */
export function resizeField(t: CustomTrack, spot: SectionSpot, width: number, length: number): FieldEdit {
    const plan = fieldPlanAt(t, spot)
    const clampPort = (p: FieldPort): FieldPort => ({ edge: p.edge, tile: Math.min(p.tile, edgeTiles({ width, length }, p.edge) - 1) })
    const next: FieldPlan = {
        width,
        length,
        entry: Math.min(plan.entry, width / FIELD_TILE - 1),
        exit: clampPort(plan.exit),
        tiles: plan.tiles.filter(k => k.col < width / FIELD_TILE && k.row < length / FIELD_TILE)
    }
    const branches = t.branches?.map(b => b.from.port && sameSpot(b.from, spot) ? { ...b, from: { ...b.from, port: clampPort(b.from.port) } } : b)
    const moved = branches ? { ...t, branches } : t
    const fault = planFault(moved, spot, next, fieldPorts(moved, spot, next), 'its roads don\'t fit at that size')
    return fault ? no(fault) : ok(withField(moved, spot, next))
}

/** The field at `spot` with the road it's laid on leaving through `port`. */
export function setFieldExit(t: CustomTrack, spot: SectionSpot, port: FieldPort): FieldEdit {
    const plan = { ...fieldPlanAt(t, spot), exit: port }
    if (port.edge === 'entry' && port.tile === plan.entry) return no('that\'s where the road comes in')
    const fault = planFault(t, spot, plan, fieldPorts(t, spot, plan))
    return fault ? no(fault) : ok(withField(t, spot, plan))
}

/** A new, empty branch leaving the field at `spot` through `port`, as the last line. */
export function addFieldExit(t: CustomTrack, spot: SectionSpot, port: FieldPort): FieldEdit {
    if ((t.branches?.length ?? 0) >= MAX_BRANCHES) return no('no more branches allowed')
    const plan = fieldPlanAt(t, spot)
    const ports = fieldPorts(t, spot, plan)
    if (ports.some(p => p.edge === port.edge && p.tile === port.tile)) return no('a road is already there')
    if (!mouthsFit(plan, [...ports, port])) {
        const { col, row } = edgeTile(plan, port)
        return no(isBlocking(plan.tiles.find(k => k.col === col && k.row === row)?.kind) ? 'clear that tile first' : 'leave a tile between roads on one edge')
    }
    const branches = [...t.branches ?? [], { sections: [], from: { ...spot, port }, to: null }]
    return ok(withField({ ...t, branches }, spot, plan))
}

/** The edges a field can grow from: its entry edge has the road coming in. */
export type GrowEdge = Exclude<FieldEdge, 'entry'>

/** Which tile of the new field's entry edge meets `tile` of edge `edge` when the two sit flush: a side edge turns the new field a quarter. */
const flushEntry = (edge: GrowEdge, tile: number, tiles: number) => edge === 'right' ? tiles - 1 - tile : tile

/**
 * A new field laid flush against `edge` of the field at `spot`, as big as that edge and as deep as the field,
 * so a grid of them drives as one; the road leaves through that edge, as near its middle as fits, and carries on from the new field.
 */
export function growField(t: CustomTrack, spot: SectionSpot, edge: GrowEdge): FieldEdit {
    if (!isFieldSection(t, spot)) return no('that isn\'t a field')
    const plan = fieldPlanAt(t, spot)
    const tiles = edgeTiles(plan, edge)
    const middle = (tiles - 1) / 2
    const order = Array.from({ length: tiles }, (_, i) => i).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b)
    const exit = order.map(tile => ({ edge, tile })).find(port => {
        const next = { ...plan, exit: port }
        return !planFault(t, spot, next, fieldPorts(t, spot, next))
    })
    if (!exit) return no('clear a tile on that edge first')
    const grown = { ...defaultFieldPlan(edgeLength(plan, edge), edge === 'exit' ? plan.length : plan.width), entry: flushEntry(edge, exit.tile, tiles) }
    const at = { branch: spot.branch, at: spot.at + 1 }
    const next = withField(withField(insertSection(t, spot.branch, at.at, 'field'), spot, { ...plan, exit }), at, grown)
    if (sectionCount(next) > MAX_SECTIONS) return no('the track is full')
    const fields = walkedFields(next, walkForks(next).walks)
    const added = fields.find(f => f.spot.branch === at.branch && f.spot.at === at.at)
    if (added && fields.some(f => f !== added && Math.abs(f.y - added.y) < MIN_CLEARANCE && fieldsOverlap(f, added))) return no('there\'s no room for a field there')
    return ok(next)
}
