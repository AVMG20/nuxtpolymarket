import { isArena, isFieldSection, lineSection, lineSections, MAX_BRANCHES, MAX_SECTIONS, NO_GRID_ROOM, sectionCount, type CustomTrack, type SectionId, type SectionSpot } from './custom'
import { mouthsFit, type CustomField } from './custom-fields'
import { insertSection, walkForks } from './custom-forks'
import { defaultFieldPlan, edgeAt, edgeLength, edgeSlots, edgeTiles, FIELD_MAX_ITEMS, FIELD_TILE, fieldLineTile, fieldsOverlap, gateAcross, groupWalledOffFault, isBlocking, isFieldLine, isGate, portLocal, portTiles, slotAt, walledOffFault, type FieldDir, type FieldEdge, type FieldLineKind, type FieldPlan, type FieldPort, type FieldTile } from './field'
import { fieldGroup, gridOnFields, walkedFields } from './field-group'
import { MIN_CLEARANCE } from './road-checks'

/** The builder's edits to a field: its size, its items and the roads out of it. Each gives the new course, or why it can't. */

export type FieldTool = 'boost' | 'checkpoint' | FieldLineKind | 'block' | 'pillar' | 'erase'

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
export function planFault(t: CustomTrack, spot: SectionSpot, plan: FieldPlan, ports: readonly FieldPort[], crowded = 'keep road tiles clear'): string | null {
    if (plan.tiles.length > FIELD_MAX_ITEMS) return `a field holds at most ${FIELD_MAX_ITEMS} items`
    const next = withField(t, spot, plan)
    // An arena's road in and out are walled over, so only its items have to be in reach of the start.
    if (isArena(next)) {
        if (arenaWalledOff(next)) return 'that blocks part of the field'
    } else {
        if (!mouthsFit(plan, ports)) return crowded
        if (walledOffFault(plan, ports.flatMap(p => portTiles(plan, p)))) return 'that blocks part of the field'
    }
    if (sectionCount(next) > MAX_SECTIONS) return 'the track is full'
    return null
}

/** Whether an arena's items aren't all in reach of its start, across its joined fields. */
function arenaWalledOff(t: CustomTrack) {
    const fields = walkedFields(t, walkForks(t).walks).filter(f => f.spot.branch === 0)
    const from = fields.findIndex(f => fieldLineTile(f.plan, 'start'))
    return from >= 0 && !!groupWalledOffFault(fields, { field: from, ...fieldLineTile(fields[from]!.plan, 'start')! })
}

/**
 * The field at `spot` with `tool` used on tile (col, row): `turn` turns a pad or gate already there instead of leaving it, and a new one faces `facing` if it fits.
 * A new checkpoint is `required` or not; tapping one that's the other way round switches it over instead of turning it.
 */
export function useFieldTool(t: CustomTrack, spot: SectionSpot, col: number, row: number, tool: FieldTool, turn = true, facing: FieldDir = 0, required = false): FieldEdit {
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
    if (tool === 'boost' || isGate(tool)) {
        if (here?.kind === tool && !turn) return ok(t)
        if (here?.kind === 'checkpoint' && tool === 'checkpoint' && !!here.required !== required) {
            const { required: _, ...plain } = here
            return fitted([...others, required ? { ...plain, required: true } : plain])
        }
        if (isFieldLine(tool) && here && isFieldLine(here.kind) && here.kind !== tool) return no(`the ${here.kind} is on that tile`)
        const fault = isFieldLine(tool) ? lineFault(t, spot, tool) : null
        if (fault) return no(fault)
        // A field holds one of each line, so placing one moves it.
        const rest = isFieldLine(tool) ? others.filter(k => k.kind !== tool) : others
        // A checkpoint or finish counts either way through, so it only stands along or across.
        const ways = tool === 'checkpoint' || tool === 'finish' ? 2 : 4
        // It turns on to the next way that fits, so a gate on a road's tile skips the way across it.
        const from = here?.kind === tool && 'dir' in here ? here.dir + 1 : facing
        let first: FieldEdit | null = null
        for (let k = 0; k < (here?.kind === tool ? ways - 1 : ways); k++) {
            const edit = fitted([...rest, { col, row, kind: tool, dir: (from + k) % ways as FieldDir, ...tool === 'checkpoint' && required ? { required: true as const } : {} }])
            if (edit.error) {
                first ??= edit
                continue
            }
            if (!isFieldLine(tool)) return edit
            const moved = roadLineOff(fieldLinesOff(edit.track!, tool, spot), tool)
            // Facing in off an edge, the grid behind the start would be off the field: try the next way.
            if (tool === 'start' && !gridOnFields(walkedFields(moved, walkForks(moved).walks), spot)) {
                first ??= no(NO_GRID_ROOM)
                continue
            }
            const fault = lineOrderFault(moved, spot)
            return fault ? no(fault) : ok(moved)
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

/** Why a `kind` line can't go on the field at `spot`, or null. */
function lineFault(t: CustomTrack, spot: SectionSpot, kind: FieldLineKind): string | null {
    if (spot.branch !== 0) return `the ${kind} must be on a main-road field`
    if (kind === 'finish' && t.closed) return 'a loop has no finish'
    return null
}

/** Why `t`, with a line just put on the field at `spot`, can't be timed as laid, or null. */
function lineOrderFault(t: CustomTrack, spot: SectionSpot): string | null {
    const finish = lineSection(t, 'finish')
    if (finish < 0) return null
    if (finish < lineSection(t, 'start')) return 'the finish must come after the start'
    if (finish !== spot.at || lineSection(t, 'start') !== spot.at) return null
    // A road that comes back onto a field holding both lines would only ever be run-off.
    const later = fieldGroup(walkedFields(t, walkForks(t).walks), spot).some(f => f.spot.branch === 0 && f.spot.at > spot.at)
    return later ? 'put the finish where the road leaves the field' : null
}

/** `t` with every field's `kind` gate taken off, but the one on the field at `keep`. */
export function fieldLinesOff(t: CustomTrack, kind: FieldLineKind, keep?: SectionSpot): CustomTrack {
    const lose = (f: CustomField) => (!keep || !sameSpot(f.at, keep)) && f.tiles.some(k => k.kind === kind)
    if (!t.fields?.some(lose)) return t
    return { ...t, fields: t.fields.map(f => lose(f) ? { ...f, tiles: f.tiles.filter(k => k.kind !== kind) } : f) }
}

/** `t` with the main road's `kind` block laid as plain road of its length, so nothing after it moves. */
function roadLineOff(t: CustomTrack, kind: FieldLineKind): CustomTrack {
    const plain: SectionId = 'straight-20'
    return t.sections.includes(kind) ? { ...t, sections: t.sections.map(id => id === kind ? plain : id) } : t
}

/** The field at `spot` at a new size: items off it go, and the roads in and out stay on their edges, as near where they were. */
export function resizeField(t: CustomTrack, spot: SectionSpot, width: number, length: number): FieldEdit {
    const plan = fieldPlanAt(t, spot)
    const sized = (centre: boolean) => {
        // A road through the middle of its edge stays in the middle; any other stays put as far as the edge reaches.
        const place = (p: FieldPort): FieldPort => {
            const before = edgeTiles(plan, p.edge)
            const after = edgeTiles({ width, length }, p.edge)
            return { edge: p.edge, tile: centre && p.tile === (before - 1) / 2 ? (after - 1) / 2 : Math.min(p.tile, after - 1) }
        }
        const next: FieldPlan = {
            width,
            length,
            entry: place({ edge: 'entry', tile: plan.entry }).tile,
            exit: place(plan.exit),
            tiles: plan.tiles.filter(k => k.col < width / FIELD_TILE && k.row < length / FIELD_TILE)
        }
        const branches = t.branches?.map(b => b.from.port && sameSpot(b.from, spot) ? { ...b, from: { ...b.from, port: place(b.from.port) } } : b)
        const moved = branches ? { ...t, branches } : t
        return { next, moved, fault: planFault(moved, spot, next, fieldPorts(moved, spot, next), 'its roads don\'t fit at that size') }
    }
    const centred = sized(true)
    const { next, moved, fault } = centred.fault ? sized(false) : centred
    return fault ? no(fault) : ok(withField(moved, spot, next))
}

/** The field at `spot` with the road it's laid on leaving through `port`. */
export function setFieldExit(t: CustomTrack, spot: SectionSpot, port: FieldPort): FieldEdit {
    const plan = { ...fieldPlanAt(t, spot), exit: port }
    if (port.edge === 'entry' && port.tile === plan.entry) return no('that\'s where the road comes in')
    const fault = planFault(t, spot, plan, fieldPorts(t, spot, plan))
    return fault ? no(fault) : ok(withField(t, spot, plan))
}

/** Quarter turns clockwise from the field's heading to the way into it across each edge. */
const INTO: Record<FieldEdge, number> = { entry: 0, left: 1, exit: 2, right: 3 }

/** `plan` turned so the road comes in across `edge`, its tiles and their ways turned with it, and `port` to carry any mouth over. */
export function turnPlan(plan: FieldPlan, edge: FieldEdge) {
    const q = INTO[edge]
    const { width: w, length: l } = plan
    const point = (u: number, v: number): [number, number] => q === 1 ? [l - v, u] : q === 2 ? [w - u, l - v] : q === 3 ? [v, w - u] : [u, v]
    const size = q % 2 ? { width: l, length: w } : { width: w, length: l }
    const tiles = plan.tiles.map((k): FieldTile => {
        const [u, v] = point((k.col + 0.5) * FIELD_TILE, (k.row + 0.5) * FIELD_TILE)
        const at = { col: Math.floor(u / FIELD_TILE), row: Math.floor(v / FIELD_TILE) }
        if (!('dir' in k)) return { ...k, ...at }
        // A checkpoint or finish counts either way, so it's stored along or across.
        const dir = (k.dir - q + 4) % (k.kind === 'checkpoint' || k.kind === 'finish' ? 2 : 4) as FieldDir
        return { ...k, ...at, dir }
    }).sort((a, b) => a.row - b.row || a.col - b.col)
    const port = (p: FieldPort): FieldPort => {
        const { u, v } = portLocal(plan, p)
        const on = edgeAt(size, ...point(u, v))!
        return { edge: on.edge, tile: slotAt(on.at) }
    }
    return { plan: { ...size, entry: plan.entry, exit: port(plan.exit), tiles }, port }
}

/** Why the field at `spot` can't have its way in moved: it's entered flush from the field before it. */
export function entryLocked(t: CustomTrack, spot: SectionSpot): string | null {
    const sections = lineSections(t, spot.branch)
    const before = spot.at > 0 ? sections[spot.at - 1] : spot.branch ? undefined : t.closed ? sections[sections.length - 1] : undefined
    const fromPort = spot.at === 0 && !!t.branches?.[spot.branch - 1]?.from.port
    return before === 'field' || fromPort ? 'the field before it sets its way in' : null
}

/** The field at `spot` with the road it's laid on coming in through `port`: the plan turns when that's on another edge. */
export function setFieldEntry(t: CustomTrack, spot: SectionSpot, port: FieldPort): FieldEdit {
    if (!isFieldSection(t, spot)) return no('that isn\'t a field')
    const locked = entryLocked(t, spot)
    if (locked) return no(locked)
    const plan = fieldPlanAt(t, spot)
    const ports = fieldPorts(t, spot, plan)
    if (port.edge === 'entry' && port.tile === plan.entry) return ok(t)
    if (ports.slice(1).some(p => p.edge === port.edge && p.tile === port.tile)) return no('a road is already there')
    let moved = t
    let next: FieldPlan = { ...plan, entry: port.tile }
    if (port.edge !== 'entry') {
        const turned = turnPlan(plan, port.edge)
        next = { ...turned.plan, entry: turned.port(port).tile }
        const branches = t.branches?.map(b => b.from.port && sameSpot(b.from, spot) ? { ...b, from: { ...b.from, port: turned.port(b.from.port) } } : b)
        if (branches) moved = { ...t, branches }
    }
    const there = portTiles(next, { edge: 'entry', tile: next.entry }).map(({ col, row }) => next.tiles.find(k => k.col === col && k.row === row))
    const crowded = there.some(k => isBlocking(k?.kind) || gateAcross(k, 'entry')) ? 'clear that tile first' : 'leave a tile between roads'
    const fault = planFault(moved, spot, next, fieldPorts(moved, spot, next), crowded)
    return fault ? no(fault) : ok(withField(moved, spot, next))
}

/** A new, empty branch leaving the field at `spot` through `port`, as the last line. */
export function addFieldExit(t: CustomTrack, spot: SectionSpot, port: FieldPort): FieldEdit {
    if (isArena(t)) return no('fields-only loops can\'t have branches yet')
    if ((t.branches?.length ?? 0) >= MAX_BRANCHES) return no('no more branches allowed')
    const plan = fieldPlanAt(t, spot)
    const ports = fieldPorts(t, spot, plan)
    if (ports.some(p => p.edge === port.edge && p.tile === port.tile)) return no('a road is already there')
    if (!mouthsFit(plan, [...ports, port])) {
        const blocked = portTiles(plan, port).some(({ col, row }) => isBlocking(plan.tiles.find(k => k.col === col && k.row === row)?.kind))
        return no(blocked ? 'clear that tile first' : 'leave a tile between roads')
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
    // Every slot, between tiles too, so an even edge is left right through its middle.
    const order = edgeSlots(plan, edge).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b)
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
