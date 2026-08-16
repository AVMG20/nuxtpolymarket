import type {
    PathwardenCardinalDirection,
    PathwardenFeatureKind,
    PathwardenGridPoint,
    PathwardenMapConnection,
    PathwardenMapFeature,
    PathwardenMapMetrics,
    PathwardenMapPlan,
    PathwardenMapRoom,
    PathwardenRoadLink,
    PathwardenRoomArchetype
} from '#shared/types/pathwarden-save'
import { createPathwardenHeightMap, sampleFractalNoise, type PathwardenHeightMap } from '#shared/utils/gamelogic/pathwarden-terrain'

interface RandomSource {
    next: () => number
    integer: (minimum: number, maximum: number) => number
}

interface GeneratorBase {
    generatorVersion: number
    seed: number
    realm: number
    size: { cols: number, rows: number }
    castleRoomId: string
}

interface Frontier {
    roomId: string
    portId: string
    cell: PathwardenGridPoint
    direction: PathwardenCardinalDirection
    depth: number
    // Branches carry their own budget. Without it the tree grows geometrically
    // and a depth-13 plan reserves several thousand road cells the player will
    // never claim in a twelve-wave run.
    targetDepth: number
    main: boolean
}

const DIRECTIONS: readonly PathwardenCardinalDirection[] = ['north', 'east', 'south', 'west']
// Every unconnected exit runs this far into the mist before enemies appear, and
// the validator asserts the exact length.
const TERMINAL_APPROACH_LENGTH = 6
const SEGMENT_MIN = 4
const SEGMENT_MAX = 9
const EDGE_MARGIN = 4
const REVEAL_RADIUS = 2

function move(point: PathwardenGridPoint, direction: PathwardenCardinalDirection, distance: number): PathwardenGridPoint {
    if (direction === 'north') return { col: point.col, row: point.row - distance }
    if (direction === 'east') return { col: point.col + distance, row: point.row }
    if (direction === 'south') return { col: point.col, row: point.row + distance }
    return { col: point.col - distance, row: point.row }
}

function turnLeft(direction: PathwardenCardinalDirection): PathwardenCardinalDirection {
    return DIRECTIONS[(DIRECTIONS.indexOf(direction) + 3) % 4]!
}

function turnRight(direction: PathwardenCardinalDirection): PathwardenCardinalDirection {
    return DIRECTIONS[(DIRECTIONS.indexOf(direction) + 1) % 4]!
}

function opposite(direction: PathwardenCardinalDirection): PathwardenCardinalDirection {
    return DIRECTIONS[(DIRECTIONS.indexOf(direction) + 2) % 4]!
}

class Grid {
    private readonly bytes: Uint8Array
    constructor(readonly cols: number, readonly rows: number) {
        this.bytes = new Uint8Array(cols * rows)
    }

    inside(point: PathwardenGridPoint) {
        return point.col >= EDGE_MARGIN
            && point.row >= EDGE_MARGIN
            && point.col < this.cols - EDGE_MARGIN
            && point.row < this.rows - EDGE_MARGIN
    }

    get(point: PathwardenGridPoint) {
        if (point.col < 0 || point.row < 0 || point.col >= this.cols || point.row >= this.rows) return 0
        return this.bytes[point.row * this.cols + point.col]!
    }

    set(point: PathwardenGridPoint, value: number) {
        if (point.col < 0 || point.row < 0 || point.col >= this.cols || point.row >= this.rows) return
        this.bytes[point.row * this.cols + point.col] = value
    }
}

interface PlanState {
    rooms: PathwardenMapRoom[]
    connections: PathwardenMapConnection[]
    roadLinks: PathwardenRoadLink[]
    features: PathwardenMapFeature[]
    // Exact road cells. Growth refuses to touch these except at the port it
    // grew from, which is what keeps two branches from silently merging.
    road: Grid
    // Corridors held for terminal approaches that have not been drawn yet.
    reserved: Grid
    river: Grid
    height: PathwardenHeightMap
    roomSequence: number
    connectionSequence: number
    roadSequence: number
    featureSequence: number
}

function neighbours(point: PathwardenGridPoint) {
    return DIRECTIONS.map(direction => move(point, direction, 1))
}

/**
 * A cell can carry road when it is inside the playable margin, is not already
 * road or reserved corridor, and does not brush an existing road. `allowed`
 * carries the cells the caller is permitted to touch — the port it grew from,
 * and its own trail's last step.
 */
function canCarryRoad(state: PlanState, point: PathwardenGridPoint, allowed: Set<string>) {
    if (!state.road.inside(point)) return false
    if (state.road.get(point) || state.reserved.get(point)) return false
    return neighbours(point).every(neighbour =>
        !state.road.get(neighbour) || allowed.has(cellKey(neighbour)))
}

function cellKey(point: PathwardenGridPoint) {
    return `${point.col}:${point.row}`
}

function markRoad(state: PlanState, cells: readonly PathwardenGridPoint[]) {
    for (const cell of cells) state.road.set(cell, 1)
}

function reserveCorridor(state: PlanState, cells: readonly PathwardenGridPoint[]) {
    for (const cell of cells) state.reserved.set(cell, 1)
}

function releaseCorridor(state: PlanState, cells: readonly PathwardenGridPoint[]) {
    for (const cell of cells) state.reserved.set(cell, 0)
}

function straightRun(from: PathwardenGridPoint, direction: PathwardenCardinalDirection, length: number) {
    return Array.from({ length }, (_, index) => move(from, direction, index + 1))
}

function runIsFree(state: PlanState, from: PathwardenGridPoint, direction: PathwardenCardinalDirection, length: number) {
    const allowed = new Set([cellKey(from)])
    const cells = straightRun(from, direction, length)
    for (const cell of cells) {
        if (!canCarryRoad(state, cell, allowed)) return null
        allowed.add(cellKey(cell))
    }
    return cells
}

/**
 * Walk a road segment out of a port. The walk prefers to stay level — a road
 * that climbs every step reads as a staircase once the isometric renderer adds
 * the height offset — and takes at most two turns so segments stay legible.
 */
function growSegment(
    state: PlanState,
    from: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    random: RandomSource,
    minLength = SEGMENT_MIN
) {
    const length = random.integer(minLength, SEGMENT_MAX)
    const allowed = new Set([cellKey(from)])
    const cells: PathwardenGridPoint[] = []
    let cursor = from
    let heading = direction
    let turnsLeft = random.integer(0, 2)

    const step = (candidateHeading: PathwardenCardinalDirection) => {
        const candidate = move(cursor, candidateHeading, 1)
        if (!canCarryRoad(state, candidate, allowed)) return null
        // Never let the walk curl back onto its own body.
        if (cells.some(cell => cell !== cells[cells.length - 1]
            && Math.abs(cell.col - candidate.col) + Math.abs(cell.row - candidate.row) <= 1)) return null
        return candidate
    }

    while (cells.length < length) {
        const options: PathwardenCardinalDirection[] = [heading]
        if (turnsLeft > 0) options.push(turnLeft(heading), turnRight(heading))
        // Prefer carrying straight on, then whichever turn keeps the road most
        // level against the height field.
        const scored = options
            .map(option => ({ option, cell: step(option) }))
            .filter((entry): entry is { option: PathwardenCardinalDirection, cell: PathwardenGridPoint } => Boolean(entry.cell))
            .map(entry => ({
                ...entry,
                cost: Math.abs(state.height.at(entry.cell.col, entry.cell.row) - state.height.at(cursor.col, cursor.row))
                    + (entry.option === heading ? 0 : 0.75)
            }))
            .sort((left, right) => left.cost - right.cost)
        const chosen = scored[0]
        if (!chosen) break
        if (chosen.option !== heading) {
            heading = chosen.option
            turnsLeft--
        }
        cells.push(chosen.cell)
        allowed.add(cellKey(chosen.cell))
        cursor = chosen.cell
    }

    if (cells.length < minLength) return null
    return { cells, heading }
}

// Growth is a random walk into terrain other branches have already taken, so a
// single roll failing says little. The main line retries hardest: if it stalls
// the plan never reaches its final depth and the whole map is regenerated.
function growWithRetries(
    state: PlanState,
    from: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    random: RandomSource,
    main: boolean
) {
    for (let attempt = 0; attempt < (main ? 4 : 2); attempt++) {
        const grown = growSegment(state, from, direction, random)
        if (grown) return grown
    }
    if (!main) return null
    return growSegment(state, from, direction, random, 2)
}

function segmentArchetype(state: PlanState, cells: readonly PathwardenGridPoint[], exits: number, turns: number): PathwardenRoomArchetype {
    if (cells.some(cell => state.river.get(cell))) return 'bridge-river'
    if (exits >= 3) return 'crossroads'
    if (exits === 2) return turns > 0 ? 'y-junction' : 't-junction'
    if (turns >= 2) return 'switchback'
    if (turns === 1) return 'corner'
    return 'straight'
}

function dilate(cells: readonly PathwardenGridPoint[], radius: number, cols: number, rows: number) {
    const seen = new Map<string, PathwardenGridPoint>()
    for (const cell of cells) {
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
            for (let colOffset = -radius; colOffset <= radius; colOffset++) {
                const point = { col: cell.col + colOffset, row: cell.row + rowOffset }
                if (point.col < 0 || point.row < 0 || point.col >= cols || point.row >= rows) continue
                seen.set(cellKey(point), point)
            }
        }
    }
    return [...seen.values()]
}

function countTurns(cells: readonly PathwardenGridPoint[], entryDirection: PathwardenCardinalDirection) {
    let turns = 0
    let heading = entryDirection
    let previous = cells[0]!
    for (const cell of cells.slice(1)) {
        const next: PathwardenCardinalDirection = cell.col > previous.col
            ? 'east'
            : cell.col < previous.col ? 'west' : cell.row > previous.row ? 'south' : 'north'
        if (next !== heading) turns++
        heading = next
        previous = cell
    }
    return turns
}

/**
 * Pick the onward exits for a freshly grown segment. An exit is only created
 * when a full terminal approach still fits behind it, and that corridor is
 * reserved immediately — otherwise a later branch grows through the space and
 * strands the exit with nowhere to run.
 */
function openExits(
    state: PlanState,
    room: PathwardenMapRoom,
    tip: PathwardenGridPoint,
    heading: PathwardenCardinalDirection,
    random: RandomSource,
    depth: number,
    maxDepth: number
) {
    const branchRoll = random.next()
    // Hold the plan to a workable size. A twelve-wave run claims twelve
    // sections, and every planned section reserves ground defenses cannot use.
    const crowded = state.rooms.length > 70
    const desired = depth >= maxDepth - 1 || crowded ? 1 : branchRoll < 0.06 ? 3 : branchRoll < 0.34 ? 2 : 1
    const candidates = [heading, turnLeft(heading), turnRight(heading)]
    const opened: Array<{ portId: string, direction: PathwardenCardinalDirection, corridor: PathwardenGridPoint[] }> = []
    for (const direction of candidates) {
        if (opened.length >= desired) break
        const corridor = runIsFree(state, tip, direction, TERMINAL_APPROACH_LENGTH)
        if (!corridor) continue
        reserveCorridor(state, corridor)
        const portId = `${room.id}-exit-${opened.length}`
        room.ports.push({ id: portId, cell: { ...tip }, direction, kind: 'exit' })
        opened.push({ portId, direction, corridor })
    }
    return opened
}

function addRoadLinks(state: PlanState, room: PathwardenMapRoom, from: PathwardenGridPoint, cells: readonly PathwardenGridPoint[]) {
    let previous = from
    const ids: string[] = []
    for (const cell of cells) {
        const id = `road-${state.roadSequence++}`
        state.roadLinks.push({ id, from: { ...previous }, to: { ...cell }, roomId: room.id })
        room.roadLinkIds.push(id)
        ids.push(id)
        previous = cell
    }
    return ids
}

// A river runs from high ground down to the map edge. Roads are allowed to
// cross it, and every crossing becomes a bridge feature so the renderer has
// something to draw over the water.
function traceRiver(
    state: PlanState,
    start: PathwardenGridPoint,
    keep: PathwardenGridPoint,
    random: RandomSource,
    cols: number,
    rows: number
) {
    const cells: PathwardenGridPoint[] = []
    const seen = new Set<string>()
    let cursor = start
    let heading = random.integer(0, 3)
    for (let step = 0; step < cols + rows; step++) {
        seen.add(cellKey(cursor))
        cells.push(cursor)
        if (cursor.col <= 1 || cursor.row <= 1 || cursor.col >= cols - 2 || cursor.row >= rows - 2) break
        // Flow downhill; on flat ground keep the current bearing so the river
        // reads as a channel rather than a random walk. The keep sits on the
        // one plateau the water has to route around.
        const options = DIRECTIONS.map((direction, index) => {
            const candidate = move(cursor, direction, 1)
            return {
                candidate,
                index,
                cost: state.height.at(candidate.col, candidate.row) * 4
                    + (index === heading ? 0 : 1)
                    + random.next() * 0.8
                    + (Math.hypot(candidate.col - keep.col, candidate.row - keep.row) < 14 ? 60 : 0)
            }
        }).filter(option =>
            !seen.has(cellKey(option.candidate))
            // Never run alongside the channel we just cut, or the river widens
            // into a lake as the walk doubles back on itself.
            && neighbours(option.candidate).filter(neighbour => seen.has(cellKey(neighbour))).length <= 1)
            .sort((left, right) => left.cost - right.cost)
        const next = options[0]
        if (!next) break
        heading = next.index
        cursor = next.candidate
    }
    return cells
}

function routeRiver(state: PlanState, keep: PathwardenGridPoint, random: RandomSource, cols: number, rows: number) {
    let best: PathwardenGridPoint[] = []
    for (let attempt = 0; attempt < 8 && best.length < 40; attempt++) {
        const start = {
            col: random.integer(EDGE_MARGIN + 6, cols - EDGE_MARGIN - 7),
            row: random.integer(EDGE_MARGIN + 6, rows - EDGE_MARGIN - 7)
        }
        if (Math.hypot(start.col - keep.col, start.row - keep.row) < 24) continue
        const cells = traceRiver(state, start, keep, random, cols, rows)
        if (cells.length > best.length) best = cells
    }

    if (best.length < 15) return
    for (const cell of best) state.river.set(cell, 1)
    state.features.push({
        id: `feature-${state.featureSequence++}`,
        kind: 'river',
        roomIds: [],
        cells: best.map(cell => ({ ...cell })),
        ports: []
    })
}

function addCrossingFeatures(state: PlanState) {
    for (const room of state.rooms) {
        const crossing = room.roadCells.filter(cell => state.river.get(cell))
        if (!crossing.length) continue
        const id = `feature-${state.featureSequence++}`
        state.features.push({
            id,
            kind: 'bridge',
            roomIds: [room.id],
            cells: crossing.map(cell => ({ ...cell })),
            ports: []
        })
        room.featureIds.push(id)
    }
}

// Trees and rock scatter over whatever the road and river did not claim. The
// mask is what keeps them off the road, its shoulders, and the keep.
function scatterFeatures(state: PlanState, keep: PathwardenGridPoint, seed: number, cols: number, rows: number) {
    const forest: PathwardenGridPoint[] = []
    const mountain: PathwardenGridPoint[] = []
    const cliff: PathwardenGridPoint[] = []
    const heightMap = state.height
    for (let row = EDGE_MARGIN; row < rows - EDGE_MARGIN; row++) {
        for (let col = EDGE_MARGIN; col < cols - EDGE_MARGIN; col++) {
            const point = { col, row }
            if (state.river.get(point) || state.reserved.get(point)) continue
            if (neighbours(point).some(neighbour => state.road.get(neighbour)) || state.road.get(point)) continue
            if (Math.hypot(col - keep.col, row - keep.row) < 8) continue
            const height = heightMap.at(col, row)
            const density = sampleFractalNoise(seed ^ 0x7F4A7C15, col, row)
            // Rock wants high ground, woodland wants low. Both stay sparse:
            // these cells refuse defenses, so a dense field strangles the board.
            if (height >= 3 && density > 0.70) mountain.push(point)
            else if (height >= 3 && density > 0.63) cliff.push(point)
            else if (height <= 2 && density > 0.72) forest.push(point)
        }
    }
    const push = (kind: PathwardenFeatureKind, cells: PathwardenGridPoint[]) => {
        if (!cells.length) return
        state.features.push({
            id: `feature-${state.featureSequence++}`,
            kind,
            roomIds: [],
            cells,
            ports: []
        })
    }
    push('forest', forest)
    push('mountain', mountain)
    push('cliff', cliff)
}

function buildMetrics(state: PlanState, maxDepth: number): PathwardenMapMetrics {
    const archetypeCounts: PathwardenMapMetrics['archetypeCounts'] = {}
    const featureCounts: PathwardenMapMetrics['featureCounts'] = {}
    const frontierCountByDepth = Array.from({ length: maxDepth + 1 }, () => 0)
    let roadCellCount = 0
    let buildableCellCount = 0
    for (const room of state.rooms) {
        archetypeCounts[room.archetype] = (archetypeCounts[room.archetype] ?? 0) + 1
        roadCellCount += room.roadCells.length
        buildableCellCount += room.buildableCells.length
        if (room.depth <= maxDepth) frontierCountByDepth[room.depth]!++
    }
    for (const feature of state.features) {
        featureCounts[feature.kind] = (featureCounts[feature.kind] ?? 0) + 1
    }
    return {
        maxDepth,
        roomCount: state.rooms.length,
        roadCellCount,
        buildableCellCount,
        frontierCountByDepth,
        archetypeCounts,
        featureCounts
    }
}

export function generatePathwardenMapPlan(
    base: GeneratorBase,
    castle: PathwardenMapRoom,
    castleRoadLinks: PathwardenRoadLink[],
    maxDepth: number,
    random: RandomSource
): PathwardenMapPlan {
    const { cols, rows } = base.size
    const keep = castle.origin
    const state: PlanState = {
        rooms: [castle],
        connections: [],
        roadLinks: [...castleRoadLinks],
        features: [],
        road: new Grid(cols, rows),
        reserved: new Grid(cols, rows),
        river: new Grid(cols, rows),
        height: createPathwardenHeightMap(base.seed, cols, rows, keep),
        roomSequence: 1,
        connectionSequence: 1,
        roadSequence: castleRoadLinks.length,
        featureSequence: 1
    }

    routeRiver(state, keep, random, cols, rows)
    markRoad(state, castle.roadCells)

    // Only the main gate road is guaranteed to reach the final depth; the two
    // side gates open shorter alternatives so each wave still offers a choice.
    const queue: Frontier[] = castle.ports.map((port, index) => ({
        roomId: castle.id,
        portId: port.id,
        cell: port.cell,
        direction: port.direction,
        depth: 1,
        targetDepth: index === 0 ? maxDepth : random.integer(4, 8),
        main: index === 0
    }))
    // Every castle exit needs its mist run held from the start, or the first
    // branch to grow can seal in its siblings.
    const pending = new Map<string, PathwardenGridPoint[]>()
    for (const frontier of queue) {
        const corridor = runIsFree(state, frontier.cell, frontier.direction, TERMINAL_APPROACH_LENGTH)
        if (corridor) {
            reserveCorridor(state, corridor)
            pending.set(frontier.portId, corridor)
        }
    }

    let deepest = 0
    while (queue.length) {
        // Drive one chain to the final depth before spending ground on breadth.
        // Draining breadth-first let side branches fence the trunk in, and a
        // plan whose trunk stops short is thrown away and regenerated.
        const chasingDepth = deepest < maxDepth
        const nextIndex = chasingDepth
            ? queue.reduce((best, candidate, index) => candidate.depth > queue[best]!.depth ? index : best, 0)
            : 0
        const frontier = queue.splice(nextIndex, 1)[0]!
        const budget = chasingDepth ? maxDepth : Math.min(maxDepth, frontier.targetDepth)
        if (frontier.depth > budget) continue
        const heldCorridor = pending.get(frontier.portId)
        if (heldCorridor) releaseCorridor(state, heldCorridor)

        const grown = growWithRetries(state, frontier.cell, frontier.direction, random, chasingDepth)
        if (!grown) {
            // Nothing fits: leave the port to become a mist run instead.
            if (heldCorridor) reserveCorridor(state, heldCorridor)
            continue
        }
        pending.delete(frontier.portId)

        // Ids carry their own geometry so a save recorded on one map cannot
        // resolve its sections against another map that happens to have grown
        // the same number of rooms.
        const head = grown.cells[0]!
        const roomId = `room-${head.col}-${head.row}`
        state.roomSequence++
        const turns = countTurns([frontier.cell, ...grown.cells], frontier.direction)
        const revealCells = dilate(grown.cells, REVEAL_RADIUS, cols, rows)
        const roadKeys = new Set(grown.cells.map(cellKey))
        const room: PathwardenMapRoom = {
            id: roomId,
            archetype: 'straight',
            depth: frontier.depth,
            origin: { ...grown.cells[0]! },
            rotation: 0,
            reflected: false,
            parentConnectionId: null,
            footprint: revealCells.map(cell => ({ ...cell })),
            revealCells: revealCells.map(cell => ({ ...cell })),
            buildableCells: revealCells.filter(cell => !roadKeys.has(cellKey(cell)) && !state.river.get(cell)),
            roadCells: grown.cells.map(cell => ({ ...cell })),
            roadLinkIds: [],
            featureIds: [],
            ports: [{
                id: `${roomId}-entrance`,
                cell: { ...head },
                direction: opposite(frontier.direction),
                kind: 'entrance'
            }]
        }
        markRoad(state, grown.cells)
        const linkIds = addRoadLinks(state, room, frontier.cell, grown.cells)

        const connectionId = `connect-${roomId}`
        state.connectionSequence++
        room.parentConnectionId = connectionId
        state.connections.push({
            id: connectionId,
            fromRoomId: frontier.roomId,
            fromPortId: frontier.portId,
            toRoomId: roomId,
            toPortId: `${roomId}-entrance`,
            kind: 'expansion',
            depth: frontier.depth,
            // The connection owns only the step out of the parent gate; the
            // rest of the segment belongs to the room itself.
            roadLinkIds: linkIds.slice(0, 1)
        })

        const tip = grown.cells[grown.cells.length - 1]!
        const opened = openExits(state, room, tip, grown.heading, random, frontier.depth, maxDepth)
        room.archetype = segmentArchetype(state, grown.cells, opened.length, turns)
        state.rooms.push(room)
        deepest = Math.max(deepest, room.depth)
        for (const [index, exit] of opened.entries()) {
            pending.set(exit.portId, exit.corridor)
            // The first exit carries the branch on; the others are side roads
            // with their own short budget.
            const carriesLine = index === 0
            queue.push({
                roomId,
                portId: exit.portId,
                cell: { ...tip },
                direction: exit.direction,
                depth: frontier.depth + 1,
                targetDepth: carriesLine
                    ? frontier.targetDepth
                    : Math.min(maxDepth, frontier.depth + random.integer(2, 4)),
                main: frontier.main && carriesLine
            })
        }
    }

    // Whatever is still held becomes the visible mist run for that exit.
    const connectedPorts = new Set(state.connections.map(connection => connection.fromPortId))
    for (const room of state.rooms) {
        for (const port of room.ports) {
            if (port.kind !== 'exit' || connectedPorts.has(port.id)) continue
            const corridor = pending.get(port.id) ?? runIsFree(state, port.cell, port.direction, TERMINAL_APPROACH_LENGTH)
            if (!corridor) continue
            room.terminalApproaches = [
                ...(room.terminalApproaches ?? []),
                { portId: port.id, cells: corridor.map(cell => ({ ...cell })) }
            ]
            markRoad(state, corridor)
        }
        // An exit with no room and no mist run would strand a dead road end.
        room.ports = room.ports.filter(port =>
            port.kind !== 'exit'
            || connectedPorts.has(port.id)
            || (room.terminalApproaches ?? []).some(approach => approach.portId === port.id))
    }

    addCrossingFeatures(state)
    scatterFeatures(state, keep, base.seed, cols, rows)

    return {
        generatorVersion: base.generatorVersion,
        seed: base.seed,
        realm: base.realm,
        size: base.size,
        castleRoomId: base.castleRoomId,
        rooms: state.rooms,
        connections: state.connections,
        roadLinks: state.roadLinks,
        features: state.features,
        metrics: buildMetrics(state, maxDepth)
    }
}
