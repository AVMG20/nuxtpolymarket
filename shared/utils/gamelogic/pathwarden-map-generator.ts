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
import {
    PATHWARDEN_ROOM_TEMPLATES,
    pathwardenTemplateTransforms,
    type PathwardenRoomTemplate,
    type PathwardenTransformedTemplate
} from '#shared/utils/gamelogic/pathwarden-room-templates'

interface RandomSource {
    next: () => number
    integer: (minimum: number, maximum: number) => number
}

interface OpenFrontier {
    roomId: string
    portId: string
    cell: PathwardenGridPoint
    direction: PathwardenCardinalDirection
    depth: number
    targetDepth: number
    main: boolean
    specialPressure: number
    distance: number
}

interface PlanState {
    rooms: PathwardenMapRoom[]
    connections: PathwardenMapConnection[]
    // Id-indexed views of rooms/connections, kept in step with the arrays above,
    // so ancestor walks are O(depth) lookups instead of O(rooms) scans per
    // placement attempt.
    roomsById: Map<string, PathwardenMapRoom>
    connectionsById: Map<string, PathwardenMapConnection>
    roadLinks: PathwardenRoadLink[]
    features: PathwardenMapFeature[]
    // Cell-key-indexed byte grids: one probe is a plain array read, and the
    // backing buffers are module scratch reused across attempts.
    occupied: Uint8Array
    roadCells: Uint8Array
    // reservedGrid mirrors reservedExits' keys, minus the active frontier's
    // own reservation, so canPlace probes bytes instead of the map.
    reservedGrid: Uint8Array
    reservedExits: Map<number, string>
    reservedExitCellByPort: Map<string, number>
    roomSequence: number
    connectionSequence: number
    roadSequence: number
    featureSequence: number
}

const MAIN_ARCHETYPES: ReadonlyArray<PathwardenRoomArchetype | null> = [
    null,
    'straight',
    'bridge-river',
    't-junction',
    'road-island',
    'crossroads',
    'mountain-pass',
    'y-junction',
    'straight',
    't-junction',
    'lake-shore',
    'crossroads',
    'forest-road'
]

const JUNCTION_ARCHETYPES: readonly PathwardenRoomArchetype[] = [
    'y-junction',
    't-junction',
    'crossroads'
]

const ROOM_CLEARANCE_CELLS = 12
const ORIGIN_AVOIDANCE_DEPTH = 5

// Cell keys are hashed millions of times per plan, so they pack into a small
// integer instead of a string. The +2 bias keeps single-cell probes off the
// grid edge non-negative; the stride bounds the map at 1022 cells per side.
const KEY_STRIDE = 1024

function key(point: PathwardenGridPoint) {
    return (point.col + 2) * KEY_STRIDE + (point.row + 2)
}

const DIRECTION_VECTORS = {
    north: { col: 0, row: -1 },
    east: { col: 1, row: 0 },
    south: { col: 0, row: 1 },
    west: { col: -1, row: 0 }
} as const

const COMMON_ARCHETYPES: ReadonlySet<PathwardenRoomArchetype> = new Set(['straight', 'corner'])

// Generation is synchronous and attempts run one at a time, so the cell grids
// are module scratch buffers zeroed per attempt instead of fresh allocations.
let scratchOccupied = new Uint8Array(0)
let scratchRoads = new Uint8Array(0)
let scratchReserved = new Uint8Array(0)

function move(point: PathwardenGridPoint, direction: PathwardenCardinalDirection) {
    if (direction === 'north') return { col: point.col, row: point.row - 1 }
    if (direction === 'east') return { col: point.col + 1, row: point.row }
    if (direction === 'south') return { col: point.col, row: point.row + 1 }
    return { col: point.col - 1, row: point.row }
}

function opposite(direction: PathwardenCardinalDirection): PathwardenCardinalDirection {
    if (direction === 'north') return 'south'
    if (direction === 'east') return 'west'
    if (direction === 'south') return 'north'
    return 'east'
}

function translate(point: PathwardenGridPoint, origin: PathwardenGridPoint) {
    return {
        col: point.col + origin.col,
        row: point.row + origin.row
    }
}

// Shuffles values[start..] as if it were its own array, consuming the same
// random stream a whole-array shuffle of that suffix would.
function shuffleSuffix<T>(values: T[], start: number, random: RandomSource) {
    for (let index = values.length - 1 - start; index > 0; index--) {
        const swap = random.integer(0, index)
        const value = values[start + index]!
        values[start + index] = values[start + swap]!
        values[start + swap] = value
    }
    return values
}

function shuffleInPlace<T>(values: T[], random: RandomSource) {
    return shuffleSuffix(values, 0, random)
}

// Depth and mainness fully determine the eligible template list, so the filter
// runs once per combination instead of once per frontier.
const eligibleCache = new Map<number, readonly PathwardenRoomTemplate[]>()

function eligibleTemplates(frontier: OpenFrontier) {
    const cacheKey = frontier.depth * 2 + (frontier.main ? 1 : 0)
    const cached = eligibleCache.get(cacheKey)
    if (cached) return cached
    const forced = frontier.depth === 1
        ? ['crossroads']
        : frontier.depth % 2 === 1
            ? JUNCTION_ARCHETYPES
            : frontier.main && MAIN_ARCHETYPES[frontier.depth]
                ? [MAIN_ARCHETYPES[frontier.depth]!]
                : null
    const eligible = PATHWARDEN_ROOM_TEMPLATES.filter(template =>
        template.minimumDepth <= frontier.depth
        && (!forced || forced.includes(template.archetype)))
    eligibleCache.set(cacheKey, eligible)
    return eligible
}

// Per-frontier scratch: weightedTemplates runs once per frontier and its
// result is fully consumed before the next frontier, so the arrays persist
// across calls instead of reallocating. Generation never runs reentrantly.
const scratchPool: PathwardenRoomTemplate[] = []
const scratchOrdered: PathwardenRoomTemplate[] = []
const scratchSeen = new Set<PathwardenRoomTemplate>()

function weightedTemplates(
    frontier: OpenFrontier,
    random: RandomSource
) {
    const eligible = eligibleTemplates(frontier)
    const pressure = Math.max(1, frontier.specialPressure)
    const pool = scratchPool
    pool.length = 0
    for (const template of eligible) {
        const count = COMMON_ARCHETYPES.has(template.archetype)
            ? template.weight
            : template.weight * pressure
        for (let copy = 0; copy < count; copy++) pool.push(template)
    }
    if (!pool.length) for (const template of eligible) pool.push(template)
    shuffleInPlace(pool, random)
    // Dedupe the weighted, shuffled pool to first occurrence — a Set preserves
    // that order without the quadratic indexOf scan.
    const seen = scratchSeen
    const ordered = scratchOrdered
    seen.clear()
    ordered.length = 0
    for (const template of pool) {
        if (seen.has(template)) continue
        seen.add(template)
        ordered.push(template)
    }
    return ordered
}

// Mirrors the canonical orientation order in pathwardenTemplateTransforms;
// shuffling indices consumes the same random stream as shuffling the
// transforms themselves. Scratch arrays are safe for the same reason as the
// template pool: each result is consumed before the next call.
const scratchTransformOrder = [0, 1, 2, 3, 4, 5, 6, 7]
const scratchMatches: PathwardenTransformedTemplate[] = []

function matchingTransforms(
    template: PathwardenRoomTemplate,
    entranceDirection: PathwardenCardinalDirection,
    random: RandomSource
) {
    const transforms = pathwardenTemplateTransforms(template)
    const order = scratchTransformOrder
    for (let index = 0; index < 8; index++) order[index] = index
    shuffleInPlace(order, random)
    const matches = scratchMatches
    matches.length = 0
    for (let position = 0; position < 8; position++) {
        const candidate = transforms[order[position]!]!
        if (candidate.entrance.direction === entranceDirection) matches.push(candidate)
    }
    return matches
}

function footprint(candidate: PathwardenTransformedTemplate, origin: PathwardenGridPoint) {
    const cells: PathwardenGridPoint[] = []
    for (let row = 0; row < candidate.height; row++) {
        for (let col = 0; col < candidate.width; col++) {
            cells.push({ col: origin.col + col, row: origin.row + row })
        }
    }
    return cells
}

interface FootprintBounds {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
}

// Footprint arrays are created once per room and never mutated, so their
// bounding box can be memoised instead of recomputed for every pair test.
const footprintBounds = new WeakMap<PathwardenGridPoint[], FootprintBounds>()

function boundsOf(cells: PathwardenGridPoint[]): FootprintBounds {
    const cached = footprintBounds.get(cells)
    if (cached) return cached
    let minCol = Number.POSITIVE_INFINITY
    let maxCol = Number.NEGATIVE_INFINITY
    let minRow = Number.POSITIVE_INFINITY
    let maxRow = Number.NEGATIVE_INFINITY
    for (const cell of cells) {
        if (cell.col < minCol) minCol = cell.col
        if (cell.col > maxCol) maxCol = cell.col
        if (cell.row < minRow) minRow = cell.row
        if (cell.row > maxRow) maxRow = cell.row
    }
    const bounds = { minCol, maxCol, minRow, maxRow }
    footprintBounds.set(cells, bounds)
    return bounds
}

function upstreamRoomIds(frontier: OpenFrontier, state: PlanState) {
    const ids = new Set([frontier.roomId])
    let room = state.roomsById.get(frontier.roomId)
    while (room?.parentConnectionId) {
        const connection = state.connectionsById.get(room.parentConnectionId)
        if (!connection) break
        ids.add(connection.fromRoomId)
        room = state.roomsById.get(connection.fromRoomId)
    }
    return ids
}

// Bounds of every non-upstream room, flattened once per frontier so each
// candidate's clearance test is arithmetic over a plain array.
function clearanceBounds(upstream: Set<string>, state: PlanState) {
    const bounds: FootprintBounds[] = []
    for (const room of state.rooms) {
        if (!upstream.has(room.id)) bounds.push(boundsOf(room.footprint))
    }
    return bounds
}

// The candidate footprint is the solid rectangle [origin, origin + size), so
// its bounds and centroid are arithmetic — no cell array is ever materialised
// on this path.
function prefersRoomPlacement(
    candidate: PathwardenTransformedTemplate,
    originCol: number,
    originRow: number,
    frontier: OpenFrontier,
    others: FootprintBounds[],
    size: number
) {
    const minCol = originCol
    const maxCol = originCol + candidate.width - 1
    const minRow = originRow
    const maxRow = originRow + candidate.height - 1
    for (const bounds of others) {
        const horizontal = Math.max(
            0,
            minCol - bounds.maxCol - 1,
            bounds.minCol - maxCol - 1
        )
        const vertical = Math.max(
            0,
            minRow - bounds.maxRow - 1,
            bounds.minRow - maxRow - 1
        )
        if (horizontal + vertical < ROOM_CLEARANCE_CELLS) return false
    }
    if (frontier.depth > ORIGIN_AVOIDANCE_DEPTH) return true

    const center = Math.floor(size / 2)
    const outwardCol = frontier.cell.col - center
    const outwardRow = frontier.cell.row - center
    const movementCol = originCol + (candidate.width - 1) / 2 - frontier.cell.col
    const movementRow = originRow + (candidate.height - 1) / 2 - frontier.cell.row
    return outwardCol * movementCol + outwardRow * movementRow >= 0
}

// Connector paths are probed for every placement but only survive when a
// placement is accepted, so the path is written into pooled cells and copied
// by the caller on acceptance. Maximum length is forward (3) + lateral (2).
const connectorCellPool: PathwardenGridPoint[] = [
    { col: 0, row: 0 },
    { col: 0, row: 0 },
    { col: 0, row: 0 },
    { col: 0, row: 0 },
    { col: 0, row: 0 }
]
const scratchConnector: PathwardenGridPoint[] = []

function connectorPath(
    from: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    forwardDistance: number,
    lateralDistance: number
) {
    const cells = scratchConnector
    cells.length = 0
    const forward = DIRECTION_VECTORS[direction]
    const firstForward = lateralDistance === 0
        ? forwardDistance
        : Math.min(2, forwardDistance)
    let col = from.col
    let row = from.row
    for (let step = 0; step < firstForward; step++) {
        col += forward.col
        row += forward.row
        const cell = connectorCellPool[cells.length]!
        cell.col = col
        cell.row = row
        cells.push(cell)
    }
    if (lateralDistance !== 0) {
        const lateralDirection = direction === 'north' || direction === 'south'
            ? lateralDistance > 0 ? 'east' : 'west'
            : lateralDistance > 0 ? 'south' : 'north'
        const lateral = DIRECTION_VECTORS[lateralDirection]
        for (let step = 0, count = Math.abs(lateralDistance); step < count; step++) {
            col += lateral.col
            row += lateral.row
            const cell = connectorCellPool[cells.length]!
            cell.col = col
            cell.row = row
            cells.push(cell)
        }
        for (let step = firstForward; step < forwardDistance; step++) {
            col += forward.col
            row += forward.row
            const cell = connectorCellPool[cells.length]!
            cell.col = col
            cell.row = row
            cells.push(cell)
        }
    }
    return cells
}

// Successful probes leave their results here; the values are consumed by the
// caller before the next probe runs.
const placementProbe = {
    originCol: 0,
    originRow: 0,
    connectorCells: scratchConnector
}

function probePlacement(
    candidate: PathwardenTransformedTemplate,
    frontier: OpenFrontier,
    forwardDistance: number,
    lateralDistance: number,
    state: PlanState,
    size: number
) {
    // The connector's total displacement is direction arithmetic, so the room
    // rectangle is known — and usually rejected — before the connector path is
    // ever materialised. The room footprint is the solid rectangle
    // [origin, origin + size), so its extent, its cells and membership tests
    // are all arithmetic. None of this path allocates.
    const forward = DIRECTION_VECTORS[frontier.direction]
    let targetCol = frontier.cell.col + forward.col * forwardDistance
    let targetRow = frontier.cell.row + forward.row * forwardDistance
    if (lateralDistance !== 0) {
        const lateralDirection = frontier.direction === 'north' || frontier.direction === 'south'
            ? lateralDistance > 0 ? 'east' : 'west'
            : lateralDistance > 0 ? 'south' : 'north'
        const lateral = DIRECTION_VECTORS[lateralDirection]
        const lateralSteps = Math.abs(lateralDistance)
        targetCol += lateral.col * lateralSteps
        targetRow += lateral.row * lateralSteps
    }
    const originCol = targetCol - candidate.entrance.cell.col
    const originRow = targetRow - candidate.entrance.cell.row
    const minCol = originCol
    const minRow = originRow
    const maxCol = originCol + candidate.width - 1
    const maxRow = originRow + candidate.height - 1
    if (minCol < 2 || minRow < 2 || maxCol >= size - 2 || maxRow >= size - 2) return false

    // The reserved grid has the active frontier's own reservation masked out,
    // so a set byte always means a foreign reservation.
    const occupied = state.occupied
    const reserved = state.reservedGrid
    for (let col = minCol; col <= maxCol; col++) {
        const colKey = (col + 2) * KEY_STRIDE + 2
        for (let row = minRow; row <= maxRow; row++) {
            if (occupied[colKey + row] !== 0 || reserved[colKey + row] !== 0) return false
        }
    }

    const connectorCells = connectorPath(
        frontier.cell,
        frontier.direction,
        forwardDistance,
        lateralDistance
    )
    let boundsMinCol = minCol
    let boundsMaxCol = maxCol
    let boundsMinRow = minRow
    let boundsMaxRow = maxRow
    for (let index = 0; index < connectorCells.length - 1; index++) {
        const cell = connectorCells[index]!
        if (cell.col < boundsMinCol) boundsMinCol = cell.col
        if (cell.col > boundsMaxCol) boundsMaxCol = cell.col
        if (cell.row < boundsMinRow) boundsMinRow = cell.row
        if (cell.row > boundsMaxRow) boundsMaxRow = cell.row
    }
    const width = boundsMaxCol - boundsMinCol + 1
    const height = boundsMaxRow - boundsMinRow + 1
    if (width > 8 || height > 8 || width * height > 36) return false

    const lastIndex = connectorCells.length - 1
    for (let index = 0; index < connectorCells.length; index++) {
        const cell = connectorCells[index]!
        if (cell.col < 2 || cell.row < 2 || cell.col >= size - 2 || cell.row >= size - 2) return false
        if (index !== lastIndex
            && cell.col >= minCol && cell.col <= maxCol
            && cell.row >= minRow && cell.row <= maxRow) return false
        const cellKey = (cell.col + 2) * KEY_STRIDE + (cell.row + 2)
        if (occupied[cellKey] !== 0 || reserved[cellKey] !== 0) return false
    }

    const exits = candidate.exits
    for (let index = 0; index < exits.length; index++) {
        const exit = exits[index]!
        const step = DIRECTION_VECTORS[exit.direction]
        const col = originCol + exit.cell.col + step.col
        const row = originRow + exit.cell.row + step.row
        if (col < 2 || row < 2 || col >= size - 2 || row >= size - 2) return false
        if (col >= minCol && col <= maxCol && row >= minRow && row <= maxRow) return false
        const cellKey = (col + 2) * KEY_STRIDE + (row + 2)
        if (occupied[cellKey] !== 0 || reserved[cellKey] !== 0) return false
        for (let prior = 0; prior < index; prior++) {
            const priorExit = exits[prior]!
            const priorStep = DIRECTION_VECTORS[priorExit.direction]
            if (cellKey === (originCol + priorExit.cell.col + priorStep.col + 2) * KEY_STRIDE
                + (originRow + priorExit.cell.row + priorStep.row + 2)) return false
        }
    }
    placementProbe.originCol = originCol
    placementProbe.originRow = originRow
    return true
}

interface TemplateTopology {
    valid: boolean
    probeCells: PathwardenGridPoint[]
}

// The road graph a placement builds is the template's own road edges plus a
// straight connector chain frontier -> entrance. The chain cannot change
// entrance->exit reachability (every chain path re-enters through the
// entrance) and its interior cells always have degree 2, so leaf-validity and
// reachability collapse to template-local facts computed once per orientation.
// Local coordinates fit 4 bits per axis (templates are at most 8 wide).
const templateTopologyCache = new WeakMap<PathwardenTransformedTemplate, TemplateTopology>()

function templateTopology(candidate: PathwardenTransformedTemplate): TemplateTopology {
    const cached = templateTopologyCache.get(candidate)
    if (cached) return cached

    const localKey = (cell: PathwardenGridPoint) => cell.col * 16 + cell.row
    const adjacency = new Map<number, number[]>()
    const connect = (fromKey: number, toKey: number) => {
        let fromNeighbours = adjacency.get(fromKey)
        if (!fromNeighbours) adjacency.set(fromKey, fromNeighbours = [])
        if (!fromNeighbours.includes(toKey)) fromNeighbours.push(toKey)
        let toNeighbours = adjacency.get(toKey)
        if (!toNeighbours) adjacency.set(toKey, toNeighbours = [])
        if (!toNeighbours.includes(fromKey)) toNeighbours.push(fromKey)
    }
    const probeCells: PathwardenGridPoint[] = []
    const seen = new Set<number>()
    const entranceKey = localKey(candidate.entrance.cell)
    for (const [from, to] of candidate.roadEdges) {
        connect(localKey(from), localKey(to))
        for (const cell of [from, to]) {
            const cellKey = localKey(cell)
            if (cellKey === entranceKey || seen.has(cellKey)) continue
            seen.add(cellKey)
            probeCells.push(cell)
        }
    }

    const exitKeys = candidate.exits.map(exit => localKey(exit.cell))
    let valid = true
    for (const [point, neighbours] of adjacency) {
        const degree = neighbours.length + (point === entranceKey ? 1 : 0)
        if (degree === 1 && !exitKeys.includes(point)) {
            valid = false
            break
        }
    }
    if (valid) {
        const visited = new Set([entranceKey])
        const queue = [entranceKey]
        for (let head = 0; head < queue.length; head++) {
            const neighbours = adjacency.get(queue[head]!)
            if (!neighbours) continue
            for (const neighbour of neighbours) {
                if (visited.has(neighbour)) continue
                visited.add(neighbour)
                queue.push(neighbour)
            }
        }
        valid = exitKeys.every(exitKey => visited.has(exitKey))
    }
    const topology = { valid, probeCells }
    templateTopologyCache.set(candidate, topology)
    return topology
}

function roadShapeIsSafe(
    candidate: PathwardenTransformedTemplate,
    originCol: number,
    originRow: number,
    frontier: OpenFrontier,
    state: PlanState
) {
    // Pure arithmetic over at most three exits, so it is the cheapest way to
    // reject a candidate — run it before anything else.
    const forward = DIRECTION_VECTORS[frontier.direction]
    const frontierCol = frontier.cell.col
    const frontierRow = frontier.cell.row
    for (const port of candidate.exits) {
        const step = DIRECTION_VECTORS[port.direction]
        const nextCol = originCol + port.cell.col + step.col
        const nextRow = originRow + port.cell.row + step.row
        if ((nextCol - frontierCol) * forward.col + (nextRow - frontierRow) * forward.row < -1) return false
    }

    const topology = templateTopology(candidate)
    if (!topology.valid) return false

    // Connector cells are exempt from the adjacency test (they extend the
    // existing road), and canPlace already guarantees they stay outside the
    // room, so only the template's own road cells need probing.
    // Neighbour probes are key arithmetic: +/-KEY_STRIDE steps a column, +/-1 a row.
    const existingRoads = state.roadCells
    const originKeyOffset = (originCol + 2) * KEY_STRIDE + (originRow + 2)
    for (const cell of topology.probeCells) {
        const cellKey = originKeyOffset + cell.col * KEY_STRIDE + cell.row
        if (existingRoads[cellKey - KEY_STRIDE] !== 0
            || existingRoads[cellKey + KEY_STRIDE] !== 0
            || existingRoads[cellKey - 1] !== 0
            || existingRoads[cellKey + 1] !== 0) return false
    }

    return true
}

function addRoom(
    state: PlanState,
    candidate: PathwardenTransformedTemplate,
    origin: PathwardenGridPoint,
    frontier: OpenFrontier,
    connectorCells: PathwardenGridPoint[]
) {
    const roomId = `room-${state.roomSequence++}`
    const connectionId = `connection-${state.connectionSequence++}`
    const roomFootprint = [
        ...connectorCells.slice(0, -1),
        ...footprint(candidate, origin)
    ]
    const roadCells = [
        ...connectorCells,
        ...candidate.roadCells.map(cell => translate(cell, origin))
    ]
    const roadLinkIds: string[] = []
    const entranceCell = translate(candidate.entrance.cell, origin)
    const connectionRoadLinkIds: string[] = []
    let previous = frontier.cell
    for (const cell of connectorCells) {
        const id = `road-${state.roadSequence++}`
        state.roadLinks.push({
            id,
            from: { ...previous },
            to: { ...cell },
            roomId
        })
        state.roadCells[key(previous)] = 1
        state.roadCells[key(cell)] = 1
        roadLinkIds.push(id)
        connectionRoadLinkIds.push(id)
        previous = cell
    }
    for (const [from, to] of candidate.roadEdges) {
        const id = `road-${state.roadSequence++}`
        const fromCell = translate(from, origin)
        const toCell = translate(to, origin)
        state.roadLinks.push({
            id,
            from: fromCell,
            to: toCell,
            roomId
        })
        state.roadCells[key(fromCell)] = 1
        state.roadCells[key(toCell)] = 1
        roadLinkIds.push(id)
    }

    const featureIds = candidate.features.map((feature) => {
        const id = `feature-${state.featureSequence++}`
        state.features.push({
            id,
            kind: feature.kind,
            roomIds: [roomId],
            cells: feature.cells.map(cell => translate(cell, origin)),
            ports: []
        })
        return id
    })
    const ports = [
        {
            ...candidate.entrance,
            id: `${roomId}:${candidate.entrance.id}`,
            cell: entranceCell
        },
        ...candidate.exits.map(exit => ({
            ...exit,
            id: `${roomId}:${exit.id}`,
            cell: translate(exit.cell, origin)
        }))
    ]
    const reservedCell = state.reservedExitCellByPort.get(frontier.portId)
    if (reservedCell !== undefined) {
        state.reservedExits.delete(reservedCell)
        state.reservedExitCellByPort.delete(frontier.portId)
    }
    for (const port of ports) {
        if (port.kind !== 'exit') continue
        const cellKey = key(move(port.cell, port.direction))
        state.reservedExits.set(cellKey, port.id)
        state.reservedExitCellByPort.set(port.id, cellKey)
        state.reservedGrid[cellKey] = 1
    }
    const room: PathwardenMapRoom = {
        id: roomId,
        archetype: candidate.archetype,
        depth: frontier.depth,
        origin,
        rotation: candidate.transform.rotation,
        reflected: candidate.transform.reflected,
        parentConnectionId: connectionId,
        footprint: roomFootprint,
        revealCells: roomFootprint,
        buildableCells: candidate.buildableCells.map(cell => translate(cell, origin)),
        roadCells,
        terminalApproaches: [],
        roadLinkIds,
        featureIds,
        ports
    }
    state.rooms.push(room)
    state.roomsById.set(roomId, room)
    const connection: PathwardenMapConnection = {
        id: connectionId,
        fromRoomId: frontier.roomId,
        fromPortId: frontier.portId,
        toRoomId: roomId,
        toPortId: ports[0]!.id,
        kind: 'expansion',
        depth: frontier.depth,
        roadLinkIds: connectionRoadLinkIds
    }
    state.connections.push(connection)
    state.connectionsById.set(connectionId, connection)
    for (const cell of roomFootprint) state.occupied[key(cell)] = 1
    return room
}

interface PlacementOption {
    forward: number
    lateral: number
}

// Shared, read-only option descriptors; the connector path is derived lazily
// by the placement loop so rejected candidates never pay for it.
const DEPTH_ONE_PLACEMENTS: readonly PlacementOption[] = [1, 2, 3].flatMap(forward =>
    [0, 1, -1].map(lateral => ({ forward, lateral })))
const COMPACT_PLACEMENT: PlacementOption = { forward: 1, lateral: 0 }
const TRANSLATED_PLACEMENTS: readonly PlacementOption[] = [2, 3].flatMap(forward =>
    [0, 1, -1, 2, -2].map(lateral => ({ forward, lateral })))

const scratchOptions: PlacementOption[] = []

function placementOptions(frontier: OpenFrontier, random: RandomSource) {
    const options = scratchOptions
    options.length = 0
    if (frontier.depth === 1) {
        for (const option of DEPTH_ONE_PLACEMENTS) options.push(option)
        return shuffleInPlace(options, random)
    }
    options.push(COMPACT_PLACEMENT)
    for (const option of TRANSLATED_PLACEMENTS) options.push(option)
    return shuffleSuffix(options, 1, random)
}

function exitScore(
    cell: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    center: number,
    random: RandomSource
) {
    const step = DIRECTION_VECTORS[direction]
    return Math.abs(cell.col + step.col - center)
        + Math.abs(cell.row + step.row - center)
        + random.next() * 5
}

function nextFrontiers(
    room: PathwardenMapRoom,
    previous: OpenFrontier,
    maxDepth: number,
    center: number,
    castleOrigin: PathwardenGridPoint,
    random: RandomSource
) {
    const exits = room.ports.filter(port => port.kind === 'exit')
    if (room.depth >= maxDepth || !exits.length) return []
    const ranked = exits.sort((left, right) =>
        exitScore(right.cell, right.direction, center, random)
        - exitScore(left.cell, left.direction, center, random))
    const special = !COMMON_ARCHETYPES.has(room.archetype)
    return ranked.map((port, index): OpenFrontier => {
        const main = previous.main && index === 0
        const branchTargetDepth = previous.main
            ? Math.min(maxDepth, room.depth + random.integer(2, 3))
            : previous.targetDepth
        return {
            roomId: room.id,
            portId: port.id,
            cell: port.cell,
            direction: port.direction,
            depth: room.depth + 1,
            targetDepth: main ? maxDepth : branchTargetDepth,
            main,
            specialPressure: special ? 1 : previous.specialPressure + 1,
            distance: Math.abs(port.cell.col - castleOrigin.col)
                + Math.abs(port.cell.row - castleOrigin.row)
        }
    })
}

function compareFrontiers(left: OpenFrontier, right: OpenFrontier) {
    return left.distance - right.distance
        || left.depth - right.depth
        || Number(right.main) - Number(left.main)
}

function createState(castle: PathwardenMapRoom, castleLinks: PathwardenRoadLink[], size: number): PlanState {
    const gridLength = (size + 4) * KEY_STRIDE
    if (scratchOccupied.length < gridLength) {
        scratchOccupied = new Uint8Array(gridLength)
        scratchRoads = new Uint8Array(gridLength)
        scratchReserved = new Uint8Array(gridLength)
    } else {
        scratchOccupied.fill(0)
        scratchRoads.fill(0)
        scratchReserved.fill(0)
    }
    const occupied = scratchOccupied
    const roadCells = scratchRoads
    for (const cell of castle.footprint) occupied[key(cell)] = 1
    for (const link of castleLinks) {
        roadCells[key(link.from)] = 1
        roadCells[key(link.to)] = 1
    }
    return {
        rooms: [castle],
        connections: [],
        roomsById: new Map([[castle.id, castle]]),
        connectionsById: new Map(),
        roadLinks: [...castleLinks],
        features: [],
        occupied,
        roadCells,
        reservedGrid: scratchReserved,
        reservedExits: new Map(),
        reservedExitCellByPort: new Map(),
        roomSequence: 1,
        connectionSequence: 0,
        roadSequence: castleLinks.length,
        featureSequence: 0
    }
}

function buildMetrics(state: PlanState, maxDepth: number): PathwardenMapMetrics {
    const archetypeCounts: Partial<Record<PathwardenRoomArchetype, number>> = {}
    const featureCounts: Partial<Record<PathwardenFeatureKind, number>> = {}
    const frontierCountByDepth = Array.from({ length: maxDepth + 1 }, () => 0)
    for (const room of state.rooms) {
        archetypeCounts[room.archetype] = (archetypeCounts[room.archetype] ?? 0) + 1
        frontierCountByDepth[room.depth] = (frontierCountByDepth[room.depth] ?? 0) + 1
    }
    for (const feature of state.features) {
        featureCounts[feature.kind] = (featureCounts[feature.kind] ?? 0) + 1
    }
    const roadCellKeys = new Set<number>()
    for (const link of state.roadLinks) {
        roadCellKeys.add(key(link.from))
        roadCellKeys.add(key(link.to))
    }
    const buildableCellKeys = new Set<number>()
    for (const room of state.rooms) {
        for (const cell of room.buildableCells) buildableCellKeys.add(key(cell))
    }
    return {
        maxDepth,
        roomCount: state.rooms.length,
        roadCellCount: roadCellKeys.size,
        buildableCellCount: buildableCellKeys.size,
        frontierCountByDepth,
        archetypeCounts,
        featureCounts
    }
}

function sideDirections(direction: PathwardenCardinalDirection): PathwardenCardinalDirection[] {
    if (direction === 'north' || direction === 'south') return ['east', 'west']
    return ['north', 'south']
}

function terminalApproachPath(
    port: PathwardenMapRoom['ports'][number],
    state: PlanState,
    size: number,
    roadCells: Uint8Array
) {
    const search = (
        previous: PathwardenGridPoint,
        direction: PathwardenCardinalDirection,
        cells: PathwardenGridPoint[]
    ): PathwardenGridPoint[] | null => {
        if (cells.length === 6) return cells
        const directions = cells.length === 0
            ? [port.direction]
            : [direction, ...sideDirections(direction)]
        for (const nextDirection of directions) {
            const cell = move(previous, nextDirection)
            if (cell.col < 2 || cell.row < 2 || cell.col >= size - 2 || cell.row >= size - 2) continue
            const cellKey = key(cell)
            const reservation = state.reservedExits.get(cellKey)
            if (state.occupied[cellKey] !== 0
                || roadCells[cellKey] !== 0
                || cells.some(existing => key(existing) === cellKey)
                || (reservation && reservation !== port.id)) continue
            const result = search(cell, nextDirection, [...cells, cell])
            if (result) return result
        }
        return null
    }
    return search(port.cell, port.direction, [])
}

function addTerminalApproaches(state: PlanState, size: number) {
    const connectedPortIds = new Set(state.connections.map(connection => connection.fromPortId))
    const roadCells = state.roadCells
    for (const room of state.rooms) {
        for (const port of room.ports.filter(port =>
            port.kind === 'exit' && !connectedPortIds.has(port.id))) {
            const approach = terminalApproachPath(port, state, size, roadCells)
            if (!approach) throw new Error(`terminal approach from ${port.id} cannot reach mist`)
            let previous = port.cell
            for (const cell of approach) {
                const id = `road-${state.roadSequence++}`
                state.roadLinks.push({ id, from: { ...previous }, to: cell, roomId: room.id })
                room.roadLinkIds.push(id)
                roadCells[key(cell)] = 1
                previous = cell
            }
            room.terminalApproaches = [
                ...(room.terminalApproaches ?? []),
                { portId: port.id, cells: approach }
            ]
            const reservedCell = state.reservedExitCellByPort.get(port.id)
            if (reservedCell !== undefined) {
                state.reservedExits.delete(reservedCell)
                state.reservedExitCellByPort.delete(port.id)
            }
        }
    }
}

function generatePathwardenMapPlanAttempt(
    base: Omit<PathwardenMapPlan, 'rooms' | 'connections' | 'roadLinks' | 'features' | 'metrics'>,
    castle: PathwardenMapRoom,
    castleLinks: PathwardenRoadLink[],
    maxDepth: number,
    random: RandomSource
): PathwardenMapPlan {
    const state = createState(castle, castleLinks, base.size.cols)
    const origin = castle.origin
    const castleExits = castle.ports.filter(port => port.kind === 'exit')
    const queue: OpenFrontier[] = castleExits.map((port, index) => ({
        roomId: castle.id,
        portId: port.id,
        cell: port.cell,
        direction: port.direction,
        depth: 1,
        targetDepth: index === 0
            ? maxDepth
            : Math.min(maxDepth, 1 + random.integer(2, 3)),
        main: index === 0,
        specialPressure: 1,
        distance: Math.abs(port.cell.col - origin.col) + Math.abs(port.cell.row - origin.row)
    }))
    const center = Math.floor(base.size.cols / 2)

    const size = base.size.cols
    while (queue.length) {
        queue.sort(compareFrontiers)
        const frontier = queue.shift()!
        if (frontier.depth > frontier.targetDepth) continue
        // Mask the frontier's own reservation so canPlace grid probes treat it
        // as free; restored below if no room consumes it.
        const ownReservedKey = state.reservedExitCellByPort.get(frontier.portId)
        if (ownReservedKey !== undefined) state.reservedGrid[ownReservedKey] = 0
        let room: PathwardenMapRoom | null = null
        let candidateCount = 0
        let placementCount = 0
        let others: FootprintBounds[] | null = null
        let fallback: {
            candidate: PathwardenTransformedTemplate
            origin: PathwardenGridPoint
            connectorCells: PathwardenGridPoint[]
        } | null = null
        const entranceDirection = opposite(frontier.direction)
        const templates = weightedTemplates(frontier, random)
        for (let templateIndex = 0; templateIndex < templates.length && !room; templateIndex++) {
            const matches = matchingTransforms(templates[templateIndex]!, entranceDirection, random)
            for (let matchIndex = 0; matchIndex < matches.length && !room; matchIndex++) {
                const candidate = matches[matchIndex]!
                candidateCount++
                const options = placementOptions(frontier, random)
                for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
                    const placement = options[optionIndex]!
                    placementCount++
                    if (!probePlacement(candidate, frontier, placement.forward, placement.lateral, state, size)) continue
                    const originCol = placementProbe.originCol
                    const originRow = placementProbe.originRow
                    const connectorCells = placementProbe.connectorCells
                    if (!roadShapeIsSafe(candidate, originCol, originRow, frontier, state)) continue
                    others ??= clearanceBounds(upstreamRoomIds(frontier, state), state)
                    if (!prefersRoomPlacement(candidate, originCol, originRow, frontier, others, size)) {
                        fallback ??= {
                            candidate,
                            origin: { col: originCol, row: originRow },
                            connectorCells: connectorCells.map(cell => ({ ...cell }))
                        }
                        continue
                    }
                    room = addRoom(
                        state,
                        candidate,
                        { col: originCol, row: originRow },
                        frontier,
                        connectorCells.map(cell => ({ ...cell }))
                    )
                    break
                }
            }
        }
        if (!room && fallback) {
            room = addRoom(state, fallback.candidate, fallback.origin, frontier, fallback.connectorCells)
        }
        if (!room) {
            if (ownReservedKey !== undefined) state.reservedGrid[ownReservedKey] = 1
            if (frontier.main || frontier.roomId === castle.id) {
                throw new Error(
                    `Pathwarden room solver blocked on main depth ${frontier.depth}`
                    + ` at ${frontier.cell.col}:${frontier.cell.row} facing ${frontier.direction}`
                    + ` after ${candidateCount} transforms and ${placementCount} placements`
                )
            }
            continue
        }
        queue.unshift(...nextFrontiers(room, frontier, maxDepth, center, origin, random))
        if (state.rooms.length > 256) throw new Error('Pathwarden room solver exceeded its room budget')
    }

    if (!state.rooms.some(room => room.depth === maxDepth)) {
        throw new Error(`Pathwarden room solver did not reach depth ${maxDepth}`)
    }
    addTerminalApproaches(state, base.size.cols)
    return {
        ...base,
        rooms: state.rooms,
        connections: state.connections,
        roadLinks: state.roadLinks,
        features: state.features,
        metrics: buildMetrics(state, maxDepth)
    }
}

export function generatePathwardenMapPlan(
    base: Omit<PathwardenMapPlan, 'rooms' | 'connections' | 'roadLinks' | 'features' | 'metrics'>,
    castle: PathwardenMapRoom,
    castleLinks: PathwardenRoadLink[],
    maxDepth: number,
    random: RandomSource
): PathwardenMapPlan {
    // Attempts never mutate the castle or its links (terminal approaches only
    // touch per-attempt rooms), so one defensive copy serves every retry.
    const attemptCastle: PathwardenMapRoom = {
        ...castle,
        origin: { ...castle.origin },
        footprint: castle.footprint.map(cell => ({ ...cell })),
        revealCells: castle.revealCells.map(cell => ({ ...cell })),
        buildableCells: castle.buildableCells.map(cell => ({ ...cell })),
        roadCells: castle.roadCells.map(cell => ({ ...cell })),
        terminalApproaches: [],
        roadLinkIds: [...castle.roadLinkIds],
        featureIds: [...castle.featureIds],
        ports: castle.ports.map(port => ({ ...port, cell: { ...port.cell } }))
    }
    const attemptLinks = castleLinks.map(link => ({
        ...link,
        from: { ...link.from },
        to: { ...link.to }
    }))
    let lastError: unknown
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            return generatePathwardenMapPlanAttempt(base, attemptCastle, attemptLinks, maxDepth, random)
        } catch (error) {
            lastError = error
        }
    }
    const reason = lastError instanceof Error ? lastError.message : 'unknown placement failure'
    throw new Error(`Unable to generate a Pathwarden room plan after 120 attempts: ${reason}`)
}
