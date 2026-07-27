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
    roadLinks: PathwardenRoadLink[]
    features: PathwardenMapFeature[]
    occupied: Set<string>
    roomSequence: number
    connectionSequence: number
    roadSequence: number
    featureSequence: number
}

const ROTATIONS = [0, 90, 180, 270] as const
const MAIN_ARCHETYPES: ReadonlyArray<PathwardenRoomArchetype | null> = [
    null,
    'straight',
    'corner',
    't-junction',
    'bridge-river',
    'road-island',
    'mountain-pass',
    null,
    'lake-shore',
    'forest-road',
    'switchback',
    'u-bend',
    'crossroads',
    'straight'
]

function key(point: PathwardenGridPoint) {
    return `${point.col}:${point.row}`
}

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
    const forced = frontier.main ? MAIN_ARCHETYPES[frontier.depth] : null
    const eligible = PATHWARDEN_ROOM_TEMPLATES.filter(template =>
        template.minimumDepth <= frontier.depth
        && (!forced || template.archetype === forced)
        && (frontier.main || !['crossroads', 't-junction'].includes(template.archetype)))
    const pool = eligible.flatMap((template) => {
        const special = !['straight', 'corner'].includes(template.archetype)
        const pressureWeight = special ? Math.max(1, frontier.specialPressure) : 1
        return Array.from({ length: template.weight * pressureWeight }, () => template)
    })
    return shuffle(pool.length ? pool : eligible, random)
        .filter((template, index, values) => values.indexOf(template) === index)
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

function canPlace(
    candidate: PathwardenTransformedTemplate,
    origin: PathwardenGridPoint,
    connectorCells: PathwardenGridPoint[],
    state: PlanState,
    size: number
) {
    const roomFootprint = footprint(candidate, origin)
    const roomKeys = new Set(roomFootprint.map(key))
    const freeRoom = roomFootprint.every(cell =>
        cell.col >= 2
        && cell.row >= 2
        && cell.col < size - 2
        && cell.row < size - 2
        && !state.occupied.has(key(cell)))
    if (!freeRoom) return false
    return connectorCells.every((cell, index) =>
        cell.col >= 2
        && cell.row >= 2
        && cell.col < size - 2
        && cell.row < size - 2
        && (index === connectorCells.length - 1 || !roomKeys.has(key(cell)))
        && !state.occupied.has(key(cell)))
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
        roadLinkIds.push(id)
        connectionRoadLinkIds.push(id)
        previous = cell
    }
    for (const [from, to] of candidate.roadEdges) {
        const id = `road-${state.roadSequence++}`
        state.roadLinks.push({
            id,
            from: translate(from, origin),
            to: translate(to, origin),
            roomId
        })
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
        roadLinkIds,
        featureIds,
        ports
    }
    state.rooms.push(room)
    state.connections.push({
        id: connectionId,
        fromRoomId: frontier.roomId,
        fromPortId: frontier.portId,
        toRoomId: roomId,
        toPortId: ports[0]!.id,
        kind: 'expansion',
        depth: frontier.depth,
        roadLinkIds: connectionRoadLinkIds
    })
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
    const compact = [{ forward: 1, lateral: 0 }]
    const translated = [4, 6, 8, 10, 14, 20, 28, 40].flatMap(forward =>
        [0, 4, -4, 7, -7, 12, -12, 20, -20].map(lateral => ({ forward, lateral })))
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
        return {
            roomId: room.id,
            portId: port.id,
            cell: port.cell,
            direction: port.direction,
            depth: room.depth + 1,
            targetDepth: main
                ? maxDepth
                : Math.min(maxDepth, room.depth + random.integer(2, 4)),
            main,
            specialPressure: special ? 1 : previous.specialPressure + 1
        }
    })
}

function createState(castle: PathwardenMapRoom, castleLinks: PathwardenRoadLink[]): PlanState {
    return {
        rooms: [castle],
        connections: [],
        roadLinks: [...castleLinks],
        features: [],
        occupied: new Set(castle.footprint.map(key)),
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
        roadCellCount: new Set(state.rooms.flatMap(room => room.roadCells).map(key)).size,
        buildableCellCount: new Set(state.rooms.flatMap(room => room.buildableCells).map(key)).size,
        frontierCountByDepth,
        archetypeCounts,
        featureCounts
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
    const castleExit = castle.ports.find(port => port.kind === 'exit')!
    const queue: OpenFrontier[] = [{
        roomId: castle.id,
        portId: castleExit.id,
        cell: castleExit.cell,
        direction: castleExit.direction,
        depth: 1,
        targetDepth: maxDepth,
        main: true,
        specialPressure: 1
    }]
    const center = Math.floor(base.size.cols / 2)

    while (queue.length) {
        const frontier = queue.shift()!
        if (frontier.depth > frontier.targetDepth) continue
        let room: PathwardenMapRoom | null = null
        let candidateCount = 0
        let placementCount = 0
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
                        state,
                        base.size.cols
                    )) continue
                    room = addRoom(state, candidate, origin, frontier, placement.connectorCells)
                    break
                }
                if (room) break
            }
            if (room) break
        }
        if (!room) {
            if (frontier.main) {
                throw new Error(
                    `Pathwarden room solver blocked on main depth ${frontier.depth}`
                    + ` at ${frontier.cell.col}:${frontier.cell.row} facing ${frontier.direction}`
                    + ` after ${candidateCount} transforms and ${placementCount} placements`
                )
            }
            continue
        }
        queue.unshift(...nextFrontiers(room, frontier, maxDepth, center, random))
        if (state.rooms.length > 64) throw new Error('Pathwarden room solver exceeded its room budget')
    }

    if (!state.rooms.some(room => room.depth === maxDepth)) {
        throw new Error(`Pathwarden room solver did not reach depth ${maxDepth}`)
    }
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
            return generatePathwardenMapPlanAttempt(base, castle, castleLinks, maxDepth, random)
        } catch (error) {
            lastError = error
        }
    }
    const reason = lastError instanceof Error ? lastError.message : 'unknown placement failure'
    throw new Error(`Unable to generate a Pathwarden room plan after 120 attempts: ${reason}`)
}
