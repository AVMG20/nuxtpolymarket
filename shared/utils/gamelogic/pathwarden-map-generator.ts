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
    transformPathwardenRoomTemplate,
    type PathwardenLocalPort,
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
    occupied: Set<number>
    roadCells: Set<number>
    reservedExits: Map<number, string>
    roomSequence: number
    connectionSequence: number
    roadSequence: number
    featureSequence: number
}

const ROTATIONS = [0, 90, 180, 270] as const
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

const scratchGraph = new Map<number, number[]>()
const neighbourPool: number[][] = []
const scratchVisited = new Set<number>()
const scratchQueue: number[] = []
const scratchConnectorKeys = new Set<number>()

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

function shuffle<T>(values: readonly T[], random: RandomSource) {
    const copy = [...values]
    for (let index = copy.length - 1; index > 0; index--) {
        const swap = random.integer(0, index)
        const value = copy[index]!
        copy[index] = copy[swap]!
        copy[swap] = value
    }
    return copy
}

function weightedTemplates(
    frontier: OpenFrontier,
    random: RandomSource
) {
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
    const pool = eligible.flatMap((template) => {
        const special = !['straight', 'corner'].includes(template.archetype)
        const pressureWeight = special ? Math.max(1, frontier.specialPressure) : 1
        return Array.from({ length: template.weight * pressureWeight }, () => template)
    })
    // Dedupe the weighted, shuffled pool to first occurrence — a Set preserves
    // that order without the quadratic indexOf scan.
    const seen = new Set<PathwardenRoomTemplate>()
    const ordered: PathwardenRoomTemplate[] = []
    for (const template of shuffle(pool.length ? pool : eligible, random)) {
        if (seen.has(template)) continue
        seen.add(template)
        ordered.push(template)
    }
    return ordered
}

function matchingTransforms(
    template: PathwardenRoomTemplate,
    entranceDirection: PathwardenCardinalDirection,
    random: RandomSource
) {
    return shuffle(
        ROTATIONS.flatMap(rotation => [false, true].map(reflected => ({ rotation, reflected } as const))),
        random
    )
        .map(transform => transformPathwardenRoomTemplate(template, transform))
        .filter(candidate => candidate.entrance.direction === entranceDirection)
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

function roomDistance(left: PathwardenGridPoint[], right: PathwardenGridPoint[]) {
    const leftBounds = boundsOf(left)
    const rightBounds = boundsOf(right)
    const horizontal = Math.max(
        0,
        leftBounds.minCol - rightBounds.maxCol - 1,
        rightBounds.minCol - leftBounds.maxCol - 1
    )
    const vertical = Math.max(
        0,
        leftBounds.minRow - rightBounds.maxRow - 1,
        rightBounds.minRow - leftBounds.maxRow - 1
    )
    return horizontal + vertical
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

function prefersRoomPlacement(
    roomFootprint: PathwardenGridPoint[],
    frontier: OpenFrontier,
    state: PlanState,
    size: number
) {
    const upstream = upstreamRoomIds(frontier, state)
    const hasClearance = state.rooms
        .filter(room => !upstream.has(room.id))
        .every(room => roomDistance(roomFootprint, room.footprint) >= ROOM_CLEARANCE_CELLS)
    if (!hasClearance) return false
    if (frontier.depth > ORIGIN_AVOIDANCE_DEPTH) return true

    const center = { col: Math.floor(size / 2), row: Math.floor(size / 2) }
    const centerOfRoom = roomFootprint.reduce((total, cell) => ({
        col: total.col + cell.col,
        row: total.row + cell.row
    }), { col: 0, row: 0 })
    centerOfRoom.col /= roomFootprint.length
    centerOfRoom.row /= roomFootprint.length
    const outward = {
        col: frontier.cell.col - center.col,
        row: frontier.cell.row - center.row
    }
    const movement = {
        col: centerOfRoom.col - frontier.cell.col,
        row: centerOfRoom.row - frontier.cell.row
    }
    return outward.col * movement.col + outward.row * movement.row >= 0
}

function canPlace(
    candidate: PathwardenTransformedTemplate,
    origin: PathwardenGridPoint,
    connectorCells: PathwardenGridPoint[],
    frontier: OpenFrontier,
    state: PlanState,
    size: number
) {
    // The room footprint is the solid rectangle [origin, origin + size), so its
    // extent, its cells and membership tests are all arithmetic. Most candidates
    // are rejected, and none of this path allocates.
    const minCol = origin.col
    const minRow = origin.row
    const maxCol = origin.col + candidate.width - 1
    const maxRow = origin.row + candidate.height - 1
    if (minCol < 2 || minRow < 2 || maxCol >= size - 2 || maxRow >= size - 2) return false

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

    const inRoom = (col: number, row: number) =>
        col >= minCol && col <= maxCol && row >= minRow && row <= maxRow

    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
            const cellKey = (col + 2) * KEY_STRIDE + (row + 2)
            if (state.occupied.has(cellKey)) return false
            const reservation = state.reservedExits.get(cellKey)
            if (reservation !== undefined && reservation !== frontier.portId) return false
        }
    }

    for (let index = 0; index < connectorCells.length; index++) {
        const cell = connectorCells[index]!
        if (cell.col < 2 || cell.row < 2 || cell.col >= size - 2 || cell.row >= size - 2) return false
        if (index !== connectorCells.length - 1 && inRoom(cell.col, cell.row)) return false
        const cellKey = key(cell)
        if (state.occupied.has(cellKey)) return false
        const reservation = state.reservedExits.get(cellKey)
        if (reservation !== undefined && reservation !== frontier.portId) return false
    }

    let prospectiveReservations: Set<number> | null = null
    for (const exit of candidate.exits) {
        const cell = move(translate(exit.cell, origin), exit.direction)
        const cellKey = key(cell)
        if (cell.col < 2 || cell.row < 2 || cell.col >= size - 2 || cell.row >= size - 2) return false
        if (inRoom(cell.col, cell.row) || state.occupied.has(cellKey)) return false
        if (prospectiveReservations?.has(cellKey)) return false
        const reservation = state.reservedExits.get(cellKey)
        if (reservation && reservation !== frontier.portId) return false
        prospectiveReservations ??= new Set()
        prospectiveReservations.add(cellKey)
    }
    return true
}

function roadShapeIsSafe(
    candidate: PathwardenTransformedTemplate,
    origin: PathwardenGridPoint,
    frontier: OpenFrontier,
    connectorCells: PathwardenGridPoint[],
    state: PlanState
) {
    const entrance = translate(candidate.entrance.cell, origin)
    const exits = candidate.exits.map(port => translate(port.cell, origin))

    // Pure arithmetic over at most three exits, so it is the cheapest way to
    // reject a candidate — run it before building any road graph.
    const directionVector = move({ col: 0, row: 0 }, frontier.direction)
    const nextDirection = (port: PathwardenLocalPort, cell: PathwardenGridPoint) => {
        const next = move(cell, port.direction)
        return (next.col - frontier.cell.col) * directionVector.col
            + (next.row - frontier.cell.row) * directionVector.row
    }
    if (!candidate.exits.every((port, index) => nextDirection(port, exits[index]!) >= -1)) return false

    // The candidate road graph is rebuilt for every placement tried, so its
    // structures are reused across calls. Generation is synchronous and this
    // function never recurses, so a single scratch set is safe.
    const graph = scratchGraph
    for (const neighbours of graph.values()) {
        neighbours.length = 0
        neighbourPool.push(neighbours)
    }
    graph.clear()
    const connect = (fromKey: number, toKey: number) => {
        let fromNeighbours = graph.get(fromKey)
        if (!fromNeighbours) graph.set(fromKey, fromNeighbours = neighbourPool.pop() ?? [])
        if (!fromNeighbours.includes(toKey)) fromNeighbours.push(toKey)
        let toNeighbours = graph.get(toKey)
        if (!toNeighbours) graph.set(toKey, toNeighbours = neighbourPool.pop() ?? [])
        if (!toNeighbours.includes(fromKey)) toNeighbours.push(fromKey)
    }
    let previousKey = key(frontier.cell)
    for (const cell of connectorCells) {
        const cellKey = key(cell)
        connect(previousKey, cellKey)
        previousKey = cellKey
    }
    const originKeyOffset = (origin.col + 2) * KEY_STRIDE + (origin.row + 2)
    for (const [from, to] of candidate.roadEdges) {
        connect(
            originKeyOffset + from.col * KEY_STRIDE + from.row,
            originKeyOffset + to.col * KEY_STRIDE + to.row
        )
    }

    const frontierKey = key(frontier.cell)
    const entranceKey = key(entrance)
    for (const [point, neighbours] of graph) {
        if (neighbours.length !== 1 || point === frontierKey) continue
        let allowed = false
        for (const exit of exits) {
            if (key(exit) === point) { allowed = true; break }
        }
        if (!allowed) return false
    }
    // One traversal from the entrance answers reachability for every exit.
    const visited = scratchVisited
    const queue = scratchQueue
    visited.clear()
    queue.length = 0
    visited.add(entranceKey)
    queue.push(entranceKey)
    for (let head = 0; head < queue.length; head++) {
        const neighbours = graph.get(queue[head]!)
        if (!neighbours) continue
        for (const neighbour of neighbours) {
            if (visited.has(neighbour)) continue
            visited.add(neighbour)
            queue.push(neighbour)
        }
    }
    for (const exit of exits) {
        if (!visited.has(key(exit))) return false
    }

    const existingRoads = state.roadCells
    const connectorKeys = scratchConnectorKeys
    connectorKeys.clear()
    connectorKeys.add(frontierKey)
    for (const cell of connectorCells) connectorKeys.add(key(cell))
    // Neighbour probes are key arithmetic: +/-KEY_STRIDE steps a column, +/-1 a row.
    for (const pointKey of graph.keys()) {
        if (connectorKeys.has(pointKey)) continue
        if (existingRoads.has(pointKey - KEY_STRIDE)
            || existingRoads.has(pointKey + KEY_STRIDE)
            || existingRoads.has(pointKey - 1)
            || existingRoads.has(pointKey + 1)) return false
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
        state.roadCells.add(key(previous))
        state.roadCells.add(key(cell))
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
        state.roadCells.add(key(fromCell))
        state.roadCells.add(key(toCell))
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
    for (const [cell, portId] of state.reservedExits) {
        if (portId === frontier.portId) state.reservedExits.delete(cell)
    }
    for (const port of ports.filter(port => port.kind === 'exit')) {
        let previous = port.cell
        for (let step = 0; step < 1; step++) {
            previous = move(previous, port.direction)
            state.reservedExits.set(key(previous), port.id)
        }
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
    for (const cell of roomFootprint) state.occupied.add(key(cell))
    return room
}

function connectorPath(
    from: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    forwardDistance: number,
    lateralDistance: number
) {
    const cells: PathwardenGridPoint[] = []
    const firstForward = lateralDistance === 0
        ? forwardDistance
        : Math.min(2, forwardDistance)
    let current = { ...from }
    for (let step = 0; step < firstForward; step++) {
        current = move(current, direction)
        cells.push(current)
    }
    if (lateralDistance !== 0) {
        const lateralDirection = direction === 'north' || direction === 'south'
            ? lateralDistance > 0 ? 'east' : 'west'
            : lateralDistance > 0 ? 'south' : 'north'
        for (let step = 0; step < Math.abs(lateralDistance); step++) {
            current = move(current, lateralDirection)
            cells.push(current)
        }
        for (let step = firstForward; step < forwardDistance; step++) {
            current = move(current, direction)
            cells.push(current)
        }
    }
    return cells
}

function placementOptions(frontier: OpenFrontier, random: RandomSource) {
    if (frontier.depth === 1) {
        const initial = [1, 2, 3].flatMap(forward =>
            [0, 1, -1].map(lateral => ({ forward, lateral })))
        return shuffle(initial, random).map(option => ({
            ...option,
            connectorCells: connectorPath(
                frontier.cell,
                frontier.direction,
                option.forward,
                option.lateral
            )
        }))
    }
    const compact = [{ forward: 1, lateral: 0 }]
    const translated = [2, 3].flatMap(forward =>
        [0, 1, -1, 2, -2].map(lateral => ({ forward, lateral })))
    return [...compact, ...shuffle(translated, random)].map(option => ({
        ...option,
        connectorCells: connectorPath(
            frontier.cell,
            frontier.direction,
            option.forward,
            option.lateral
        )
    }))
}

function exitScore(
    cell: PathwardenGridPoint,
    direction: PathwardenCardinalDirection,
    center: number,
    random: RandomSource
) {
    const next = move(cell, direction)
    return Math.abs(next.col - center) + Math.abs(next.row - center) + random.next() * 5
}

function nextFrontiers(
    room: PathwardenMapRoom,
    previous: OpenFrontier,
    maxDepth: number,
    center: number,
    random: RandomSource
) {
    const exits = room.ports.filter(port => port.kind === 'exit')
    if (room.depth >= maxDepth || !exits.length) return []
    const ranked = [...exits].sort((left, right) =>
        exitScore(right.cell, right.direction, center, random)
        - exitScore(left.cell, left.direction, center, random))
    const special = !['straight', 'corner'].includes(room.archetype)
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
            specialPressure: special ? 1 : previous.specialPressure + 1
        }
    })
}

function createState(castle: PathwardenMapRoom, castleLinks: PathwardenRoadLink[]): PlanState {
    return {
        rooms: [castle],
        connections: [],
        roomsById: new Map([[castle.id, castle]]),
        connectionsById: new Map(),
        roadLinks: [...castleLinks],
        features: [],
        occupied: new Set(castle.footprint.map(key)),
        roadCells: new Set(castleLinks.flatMap(link => [key(link.from), key(link.to)])),
        reservedExits: new Map(),
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
    return {
        maxDepth,
        roomCount: state.rooms.length,
        roadCellCount: new Set(state.roadLinks.flatMap(link => [link.from, link.to]).map(key)).size,
        buildableCellCount: new Set(state.rooms.flatMap(room => room.buildableCells).map(key)).size,
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
    roadCells: Set<number>
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
            const reservation = state.reservedExits.get(key(cell))
            if (state.occupied.has(key(cell))
                || roadCells.has(key(cell))
                || cells.some(existing => key(existing) === key(cell))
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
                roadCells.add(key(cell))
                previous = cell
            }
            room.terminalApproaches = [
                ...(room.terminalApproaches ?? []),
                { portId: port.id, cells: approach }
            ]
            for (const [cell, portId] of state.reservedExits) {
                if (portId === port.id) state.reservedExits.delete(cell)
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
    const state = createState(castle, castleLinks)
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
        specialPressure: 1
    }))
    const center = Math.floor(base.size.cols / 2)
    const origin = castle.origin
    const frontierDistance = (frontier: OpenFrontier) =>
        Math.abs(frontier.cell.col - origin.col) + Math.abs(frontier.cell.row - origin.row)
    const prioritizeFrontiers = () => {
        queue.sort((left, right) =>
            frontierDistance(left) - frontierDistance(right)
            || left.depth - right.depth
            || Number(right.main) - Number(left.main))
    }

    while (queue.length) {
        prioritizeFrontiers()
        const frontier = queue.shift()!
        if (frontier.depth > frontier.targetDepth) continue
        let room: PathwardenMapRoom | null = null
        let candidateCount = 0
        let placementCount = 0
        let fallback: {
            candidate: PathwardenTransformedTemplate
            origin: PathwardenGridPoint
            connectorCells: PathwardenGridPoint[]
        } | null = null
        for (const template of weightedTemplates(frontier, random)) {
            for (const candidate of matchingTransforms(template, opposite(frontier.direction), random)) {
                candidateCount++
                for (const placement of placementOptions(frontier, random)) {
                    placementCount++
                    const entranceTarget = placement.connectorCells[placement.connectorCells.length - 1]!
                    const origin = {
                        col: entranceTarget.col - candidate.entrance.cell.col,
                        row: entranceTarget.row - candidate.entrance.cell.row
                    }
                    if (!canPlace(
                        candidate,
                        origin,
                        placement.connectorCells,
                        frontier,
                        state,
                        base.size.cols
                    ) || !roadShapeIsSafe(candidate, origin, frontier, placement.connectorCells, state)) continue
                    const roomFootprint = footprint(candidate, origin)
                    if (!prefersRoomPlacement(roomFootprint, frontier, state, base.size.cols)) {
                        fallback ??= {
                            candidate,
                            origin,
                            connectorCells: placement.connectorCells
                        }
                        continue
                    }
                    room = addRoom(state, candidate, origin, frontier, placement.connectorCells)
                    break
                }
                if (room) break
            }
            if (room) break
        }
        if (!room && fallback) {
            room = addRoom(state, fallback.candidate, fallback.origin, frontier, fallback.connectorCells)
        }
        if (!room) {
            if (frontier.main || frontier.roomId === castle.id) {
                throw new Error(
                    `Pathwarden room solver blocked on main depth ${frontier.depth}`
                    + ` at ${frontier.cell.col}:${frontier.cell.row} facing ${frontier.direction}`
                    + ` after ${candidateCount} transforms and ${placementCount} placements`
                )
            }
            continue
        }
        queue.unshift(...nextFrontiers(room, frontier, maxDepth, center, random))
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
    let lastError: unknown
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
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
            return generatePathwardenMapPlanAttempt(
                base,
                attemptCastle,
                castleLinks.map(link => ({
                    ...link,
                    from: { ...link.from },
                    to: { ...link.to }
                })),
                maxDepth,
                random
            )
        } catch (error) {
            lastError = error
        }
    }
    const reason = lastError instanceof Error ? lastError.message : 'unknown placement failure'
    throw new Error(`Unable to generate a Pathwarden room plan after 120 attempts: ${reason}`)
}
