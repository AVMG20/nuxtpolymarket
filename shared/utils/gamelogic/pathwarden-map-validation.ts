import type {
    PathwardenGameState,
    PathwardenGridPoint,
    PathwardenMapPlan,
    PathwardenMapRoom,
    PathwardenRoadLink
} from '#shared/types/pathwarden-save'

export interface PathwardenMapValidation {
    valid: boolean
    errors: string[]
}

const TERMINAL_APPROACH_LENGTH = 6

function key(point: PathwardenGridPoint) {
    return `${point.col}:${point.row}`
}

function adjacent(left: PathwardenGridPoint, right: PathwardenGridPoint) {
    return Math.abs(left.col - right.col) + Math.abs(left.row - right.row) === 1
}

export function pathwardenRoomFootprintDimensions(cells: PathwardenGridPoint[]) {
    if (!cells.length) return { width: 0, height: 0, area: 0 }
    let minCol = Infinity
    let maxCol = -Infinity
    let minRow = Infinity
    let maxRow = -Infinity
    for (const cell of cells) {
        minCol = Math.min(minCol, cell.col)
        maxCol = Math.max(maxCol, cell.col)
        minRow = Math.min(minRow, cell.row)
        maxRow = Math.max(maxRow, cell.row)
    }
    return { width: maxCol - minCol + 1, height: maxRow - minRow + 1, area: cells.length }
}

/**
 * Road cells reachable from the keep by walking links, and the degree of every
 * node. The generator emits a tree, so this doubles as the cycle check: a road
 * graph with a cycle has an arm the shortest-path router never walks, which is
 * exactly the dead road this validator exists to catch.
 */
function roadTopology(plan: PathwardenMapPlan) {
    const adjacency = new Map<string, Set<string>>()
    const link = (from: PathwardenGridPoint, to: PathwardenGridPoint) => {
        const fromKey = key(from)
        const toKey = key(to)
        if (fromKey === toKey) return
        if (!adjacency.has(fromKey)) adjacency.set(fromKey, new Set())
        if (!adjacency.has(toKey)) adjacency.set(toKey, new Set())
        adjacency.get(fromKey)!.add(toKey)
        adjacency.get(toKey)!.add(fromKey)
    }
    for (const roadLink of plan.roadLinks) link(roadLink.from, roadLink.to)
    for (const room of plan.rooms) {
        for (const approach of room.terminalApproaches ?? []) {
            const port = room.ports.find(candidate => candidate.id === approach.portId)
            if (!port) continue
            let previous = port.cell
            for (const cell of approach.cells) {
                link(previous, cell)
                previous = cell
            }
        }
    }
    return adjacency
}

function reachableRoad(plan: PathwardenMapPlan, adjacency: Map<string, Set<string>>) {
    const castle = plan.rooms.find(room => room.id === plan.castleRoomId)
    const start = castle?.roadCells[0]
    const reached = new Set<string>()
    if (!start) return reached
    const queue = [key(start)]
    reached.add(key(start))
    for (let head = 0; head < queue.length; head++) {
        for (const next of adjacency.get(queue[head]!) ?? []) {
            if (reached.has(next)) continue
            reached.add(next)
            queue.push(next)
        }
    }
    return reached
}

function countEdges(adjacency: Map<string, Set<string>>) {
    let total = 0
    for (const neighbours of adjacency.values()) total += neighbours.size
    return total / 2
}

function validateRooms(plan: PathwardenMapPlan, errors: string[]) {
    const seenRoadCells = new Map<string, string>()
    for (const room of plan.rooms) {
        if (room.id !== plan.castleRoomId && !room.roadCells.length) {
            errors.push(`room ${room.id} lays no road`)
        }
        for (const cell of [...room.roadCells, ...room.revealCells]) {
            if (cell.col < 0 || cell.row < 0 || cell.col >= plan.size.cols || cell.row >= plan.size.rows) {
                errors.push(`room ${room.id} leaves the map at ${key(cell)}`)
            }
        }
        for (const cell of room.roadCells) {
            const owner = seenRoadCells.get(key(cell))
            if (owner) errors.push(`rooms ${owner} and ${room.id} both lay road at ${key(cell)}`)
            else seenRoadCells.set(key(cell), room.id)
        }
        // Every claimable section has to leave somewhere to put a defense.
        if (room.id !== plan.castleRoomId && !room.buildableCells.length) {
            errors.push(`room ${room.id} has no buildable ground`)
        }
        const revealed = new Set(room.revealCells.map(key))
        for (const cell of room.roadCells) {
            if (!revealed.has(key(cell))) errors.push(`room ${room.id} hides its own road at ${key(cell)}`)
        }
    }
}

function validateConnections(plan: PathwardenMapPlan, roomsById: Map<string, PathwardenMapRoom>, errors: string[]) {
    const linksByRoom = new Map<string, PathwardenRoadLink[]>()
    for (const roadLink of plan.roadLinks) {
        linksByRoom.set(roadLink.roomId, [...(linksByRoom.get(roadLink.roomId) ?? []), roadLink])
    }
    for (const connection of plan.connections) {
        if (connection.kind !== 'expansion') continue
        const parent = roomsById.get(connection.fromRoomId)
        const child = roomsById.get(connection.toRoomId)
        if (!parent) {
            errors.push(`connection ${connection.id} has no source room`)
            continue
        }
        if (!child) {
            errors.push(`connection ${connection.id} has no destination room`)
            continue
        }
        const port = parent.ports.find(candidate => candidate.id === connection.fromPortId)
        if (!port) {
            errors.push(`connection ${connection.id} has no source port`)
            continue
        }
        // The engine anchors a section on the link leaving the parent port, and
        // non-null asserts it exists.
        const owned = linksByRoom.get(child.id) ?? []
        if (!owned.some(candidate => key(candidate.from) === key(port.cell))) {
            errors.push(`connection ${connection.id} lays no road out of ${connection.fromPortId}`)
        }
        if (!child.ports.some(candidate => candidate.id === connection.toPortId)) {
            errors.push(`connection ${connection.id} has no destination port`)
        }
    }
}

function validateTerminalApproaches(plan: PathwardenMapPlan, errors: string[]) {
    const roadCells = new Set(plan.rooms.flatMap(room => room.roadCells.map(key)))
    const connectedPorts = new Set(plan.connections.map(connection => connection.fromPortId))
    for (const room of plan.rooms) {
        for (const approach of room.terminalApproaches ?? []) {
            const port = room.ports.find(candidate => candidate.id === approach.portId)
            if (!port) {
                errors.push(`room ${room.id} approaches a port it does not have`)
                continue
            }
            if (connectedPorts.has(port.id)) {
                errors.push(`port ${port.id} carries both a room and a mist run`)
            }
            if (approach.cells.length !== TERMINAL_APPROACH_LENGTH) {
                errors.push(`terminal approach from ${port.id} has ${approach.cells.length} cells instead of ${TERMINAL_APPROACH_LENGTH}`)
            }
            let previous = port.cell
            const seen = new Set<string>()
            for (const cell of approach.cells) {
                if (!adjacent(previous, cell)) errors.push(`terminal approach from ${port.id} jumps at ${key(cell)}`)
                if (seen.has(key(cell))) errors.push(`terminal approach from ${port.id} revisits ${key(cell)}`)
                if (roadCells.has(key(cell))) errors.push(`terminal approach from ${port.id} runs over road at ${key(cell)}`)
                seen.add(key(cell))
                previous = cell
            }
        }
        // A dangling exit is a road that stops in open ground: nothing to claim
        // and no mist mouth for enemies to walk out of.
        for (const port of room.ports) {
            if (port.kind !== 'exit') continue
            if (connectedPorts.has(port.id)) continue
            if ((room.terminalApproaches ?? []).some(approach => approach.portId === port.id)) continue
            errors.push(`exit ${port.id} leads nowhere`)
        }
    }
}

export function validatePathwardenMapPlan(plan: PathwardenMapPlan): PathwardenMapValidation {
    const errors: string[] = []
    const roomsById = new Map(plan.rooms.map(room => [room.id, room]))

    const castle = roomsById.get(plan.castleRoomId)
    if (!castle) errors.push(`plan names a castle room ${plan.castleRoomId} it does not contain`)
    else if (castle.ports.filter(port => port.kind === 'exit').length !== 3) {
        errors.push('castle does not open three gates')
    }
    if (plan.metrics.roomCount !== plan.rooms.length) errors.push('room metric is stale')
    if (!plan.rooms.some(room => room.depth === plan.metrics.maxDepth)) {
        errors.push(`no room reaches depth ${plan.metrics.maxDepth}`)
    }

    validateRooms(plan, errors)
    validateConnections(plan, roomsById, errors)
    validateTerminalApproaches(plan, errors)

    const adjacency = roadTopology(plan)
    const reached = reachableRoad(plan, adjacency)
    for (const node of adjacency.keys()) {
        if (!reached.has(node)) {
            errors.push(`road at ${node} cannot be reached from the keep`)
            break
        }
    }
    // Tree check. Enemies route by shortest path, so any cycle leaves one arm
    // permanently unwalked while still blocking defense placement.
    if (reached.size && countEdges(adjacency) > adjacency.size - 1) {
        errors.push('road graph contains a loop, which would strand an unwalked arm')
    }

    return { valid: errors.length === 0, errors }
}

interface SavedSection {
    source: PathwardenGridPoint
    links: PathwardenRoadLink[]
}

// The engine rebuilds a restored march by looking its saved room ids up in the
// plan, so a save only hydrates against the plan it was recorded on. Mirrors
// PathwardenEngine.restoreGameState: claimed sections lay road, active ones must
// still be reachable from the keep.
function savedSections(plan: PathwardenMapPlan) {
    const sections = new Map<string, SavedSection>()
    const rooms = new Map(plan.rooms.map(room => [room.id, room]))
    for (const connection of plan.connections) {
        if (connection.kind !== 'expansion') continue
        const parent = rooms.get(connection.fromRoomId)
        const port = parent?.ports.find(candidate => candidate.id === connection.fromPortId)
        if (!port) continue
        sections.set(connection.toRoomId, {
            source: port.cell,
            links: plan.roadLinks.filter(link => link.roomId === connection.toRoomId)
        })
    }
    for (const room of plan.rooms) {
        if (room.depth + 1 >= plan.metrics.maxDepth) continue
        for (const approach of room.terminalApproaches ?? []) {
            const port = room.ports.find(candidate => candidate.id === approach.portId)
            if (!port) continue
            sections.set(`terminal:${room.id}:${approach.portId}`, {
                source: port.cell,
                links: approach.cells.map((cell, index) => ({
                    id: `${room.id}:${approach.portId}:${index}`,
                    from: index === 0 ? port.cell : approach.cells[index - 1]!,
                    to: cell,
                    roomId: room.id
                }))
            })
        }
    }
    return sections
}

export function pathwardenSaveIsHydratable(plan: PathwardenMapPlan, state: PathwardenGameState) {
    const start = state.path[0]
    if (!start) return false
    const sections = savedSections(plan)
    // A save recorded on another map names sections this plan does not have.
    // Treating an unknown id as harmless let foreign saves hydrate onto a map
    // they were never played on.
    if (state.claimedRoomIds.some(id => !sections.has(id))) return false
    if (state.activeRoomIds.some(id => !sections.has(id))) return false
    const roads = [
        ...plan.roadLinks.filter(link => link.roomId === plan.castleRoomId),
        ...state.claimedRoomIds.flatMap(id => sections.get(id)?.links ?? [])
    ].map(link => [key(link.from), key(link.to)] as const)
    for (let index = 1; index < state.path.length; index++) {
        roads.push([key(state.path[index - 1]!), key(state.path[index]!)])
    }
    const adjacency = new Map<string, string[]>()
    for (const [from, to] of roads) {
        adjacency.set(from, [...(adjacency.get(from) ?? []), to])
        adjacency.set(to, [...(adjacency.get(to) ?? []), from])
    }
    const reached = new Set([key(start)])
    const queue = [key(start)]
    for (let head = 0; head < queue.length; head++) {
        for (const next of adjacency.get(queue[head]!) ?? []) {
            if (reached.has(next)) continue
            reached.add(next)
            queue.push(next)
        }
    }
    return state.activeRoomIds.every(id => reached.has(key(sections.get(id)!.source)))
}
