import type {
    PathwardenGridPoint,
    PathwardenMapPlan
} from '#shared/types/pathwarden-save'

export interface PathwardenMapValidation {
    valid: boolean
    errors: string[]
}

// Set and Map probes dominate validation, so cells pack into small integers
// the same way the generator packs them; strings are only built on the error
// paths. The stride caps coordinates at 1022 per axis — far beyond any plan
// that passes the bounds checks, which report absurd coordinates loudly.
const KEY_STRIDE = 1024

function cellKey(point: PathwardenGridPoint) {
    return (point.col + 2) * KEY_STRIDE + (point.row + 2)
}

function pairKey(left: number, right: number) {
    return left < right
        ? left * KEY_STRIDE * KEY_STRIDE + right
        : right * KEY_STRIDE * KEY_STRIDE + left
}

function formatCellKey(packed: number) {
    const colPart = Math.floor(packed / KEY_STRIDE)
    return `${colPart - 2}:${packed - colPart * KEY_STRIDE - 2}`
}

function key(point: PathwardenGridPoint) {
    return `${point.col}:${point.row}`
}

function move(point: PathwardenGridPoint, direction: 'north' | 'east' | 'south' | 'west') {
    if (direction === 'north') return { col: point.col, row: point.row - 1 }
    if (direction === 'east') return { col: point.col + 1, row: point.row }
    if (direction === 'south') return { col: point.col, row: point.row + 1 }
    return { col: point.col - 1, row: point.row }
}

function duplicateIds(ids: string[]) {
    const seen = new Set<string>()
    return ids.filter((id) => {
        if (seen.has(id)) return true
        seen.add(id)
        return false
    })
}

function connectedCells(cells: PathwardenGridPoint[]) {
    if (!cells.length) return true
    const remaining = new Set<number>()
    for (const cell of cells) remaining.add(cellKey(cell))
    const queue = [cellKey(cells[0]!)]
    remaining.delete(queue[0]!)
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head]!
        if (remaining.delete(current - KEY_STRIDE)) queue.push(current - KEY_STRIDE)
        if (remaining.delete(current + KEY_STRIDE)) queue.push(current + KEY_STRIDE)
        if (remaining.delete(current - 1)) queue.push(current - 1)
        if (remaining.delete(current + 1)) queue.push(current + 1)
    }
    return remaining.size === 0
}

export function pathwardenRoomFootprintDimensions(cells: PathwardenGridPoint[]) {
    if (!cells.length) return { width: 0, height: 0, area: 0 }
    let minCol = Infinity
    let maxCol = -Infinity
    let minRow = Infinity
    let maxRow = -Infinity
    for (const cell of cells) {
        if (cell.col < minCol) minCol = cell.col
        if (cell.col > maxCol) maxCol = cell.col
        if (cell.row < minRow) minRow = cell.row
        if (cell.row > maxRow) maxRow = cell.row
    }
    const width = maxCol - minCol + 1
    const height = maxRow - minRow + 1
    return { width, height, area: width * height }
}

export function isCompactPathwardenRoomFootprint(cells: PathwardenGridPoint[]) {
    const { width, height, area } = pathwardenRoomFootprintDimensions(cells)
    return width <= 8 && height <= 8 && area <= 36
}

const JUNCTION_ARCHETYPES = new Set(['y-junction', 't-junction', 'crossroads'])
const CONNECTED_FEATURE_KINDS = new Set(['river', 'lake', 'mountain'])

export function validatePathwardenMapPlan(plan: PathwardenMapPlan): PathwardenMapValidation {
    const errors: string[] = []
    const rooms = new Map(plan.rooms.map(room => [room.id, room]))
    const links = new Map(plan.roadLinks.map(link => [link.id, link]))
    const connections = new Map(plan.connections.map(connection => [connection.id, connection]))
    const features = new Map(plan.features.map(feature => [feature.id, feature]))

    for (const duplicate of duplicateIds(plan.rooms.map(room => room.id))) {
        errors.push(`duplicate room id ${duplicate}`)
    }
    for (const duplicate of duplicateIds(plan.roadLinks.map(link => link.id))) {
        errors.push(`duplicate road link id ${duplicate}`)
    }
    for (const duplicate of duplicateIds(plan.connections.map(connection => connection.id))) {
        errors.push(`duplicate connection id ${duplicate}`)
    }
    for (const duplicate of duplicateIds(plan.features.map(feature => feature.id))) {
        errors.push(`duplicate feature id ${duplicate}`)
    }
    if (!rooms.has(plan.castleRoomId)) errors.push('castle room is missing')
    if (!plan.rooms.some(room => room.depth === plan.metrics.maxDepth)) {
        errors.push(`no room reaches depth ${plan.metrics.maxDepth}`)
    }

    const occupied = new Map<number, string>()
    for (const room of plan.rooms) {
        if (room.id !== plan.castleRoomId && room.depth === 1 && room.archetype !== 'crossroads') {
            errors.push(`depth-1 room ${room.id} is ${room.archetype}, expected crossroads`)
        }
        if (room.id !== plan.castleRoomId && room.depth >= 3 && room.depth % 2 === 1
            && !JUNCTION_ARCHETYPES.has(room.archetype)) {
            errors.push(`odd-depth room ${room.id} is ${room.archetype}, expected a junction`)
        }
        if (room.id !== plan.castleRoomId) {
            if (!room.parentConnectionId || !connections.has(room.parentConnectionId)) {
                errors.push(`room ${room.id} has no valid parent connection`)
            }
            if (!isCompactPathwardenRoomFootprint(room.footprint)) {
                const { width, height, area } = pathwardenRoomFootprintDimensions(room.footprint)
                errors.push(`room ${room.id} footprint ${width}x${height} (${area}) is too large`)
            }
        }
        const footprint = new Set<number>()
        for (const cell of room.footprint) {
            if (cell.col < 0 || cell.row < 0 || cell.col >= plan.size.cols || cell.row >= plan.size.rows) {
                errors.push(`room ${room.id} leaves map bounds at ${key(cell)}`)
            }
            const packed = cellKey(cell)
            const owner = occupied.get(packed)
            if (owner && owner !== room.id) errors.push(`rooms ${owner} and ${room.id} overlap at ${key(cell)}`)
            occupied.set(packed, room.id)
            footprint.add(packed)
        }
        const roads = new Set<number>()
        for (const cell of room.roadCells) {
            if (!footprint.has(cellKey(cell))) errors.push(`room ${room.id} owns a cell outside its footprint`)
            roads.add(cellKey(cell))
        }
        const buildable = new Set<number>()
        for (const cell of room.buildableCells) {
            if (!footprint.has(cellKey(cell))) errors.push(`room ${room.id} owns a cell outside its footprint`)
            buildable.add(cellKey(cell))
        }
        for (const cell of room.buildableCells) {
            if (roads.has(cellKey(cell))) errors.push(`room ${room.id} marks road ${key(cell)} buildable`)
        }
        for (const linkId of room.roadLinkIds) {
            if (!links.has(linkId)) errors.push(`room ${room.id} references missing road link ${linkId}`)
        }
        const roomLinks = room.roadLinkIds
            .map(linkId => links.get(linkId))
            .filter(link => link !== undefined)
        const roomRoadKeys = new Set<number>()
        const roomDegrees = new Map<number, number>()
        for (const link of roomLinks) {
            const fromKey = cellKey(link.from)
            const toKey = cellKey(link.to)
            roomRoadKeys.add(fromKey)
            roomRoadKeys.add(toKey)
            roomDegrees.set(fromKey, (roomDegrees.get(fromKey) ?? 0) + 1)
            roomDegrees.set(toKey, (roomDegrees.get(toKey) ?? 0) + 1)
        }
        for (const cell of room.roadCells) {
            if (!roomRoadKeys.has(cellKey(cell))) errors.push(`room ${room.id} has unlinked road cell ${key(cell)}`)
        }
        const roomExitKeys = new Set<number>()
        const roomEntranceKeys = new Set<number>()
        for (const port of room.ports) {
            if (port.kind === 'exit') roomExitKeys.add(cellKey(port.cell))
            if (port.kind === 'entrance') roomEntranceKeys.add(cellKey(port.cell))
        }
        const parentConnection = room.parentConnectionId ? connections.get(room.parentConnectionId) : undefined
        const parentRoom = parentConnection ? rooms.get(parentConnection.fromRoomId) : undefined
        const parentPort = parentConnection
            ? parentRoom?.ports.find(port => port.id === parentConnection.fromPortId)
            : undefined
        const parentSourceKey = parentPort ? cellKey(parentPort.cell) : null
        const terminalEndKeys = new Set<number>()
        for (const approach of room.terminalApproaches ?? []) {
            const end = approach.cells.at(-1)
            if (end !== undefined) terminalEndKeys.add(cellKey(end))
        }
        for (const [cell, degree] of roomDegrees) {
            if (degree === 1 && !roomExitKeys.has(cell) && !roomEntranceKeys.has(cell)
                && cell !== parentSourceKey && !terminalEndKeys.has(cell)
                && room.id !== plan.castleRoomId) {
                errors.push(`room ${room.id} has an interior road endpoint at ${formatCellKey(cell)}`)
            }
        }
        for (const featureId of room.featureIds) {
            if (!features.has(featureId)) errors.push(`room ${room.id} references missing feature ${featureId}`)
        }
        const roomFeatures = room.featureIds
            .map(featureId => features.get(featureId))
            .filter(feature => feature !== undefined)
        for (const feature of roomFeatures) {
            for (const cell of feature.cells) {
                const packed = cellKey(cell)
                if (!footprint.has(packed)) errors.push(`feature ${feature.id} leaves room ${room.id}`)
                if (buildable.has(packed)) errors.push(`feature ${feature.id} occupies buildable cell ${key(cell)}`)
            }
            if (CONNECTED_FEATURE_KINDS.has(feature.kind) && !connectedCells(feature.cells)) {
                errors.push(`feature ${feature.id} is disconnected`)
            }
        }
        if (room.archetype === 'road-island') {
            let splits = 0
            for (const degree of roomDegrees.values()) {
                if (degree >= 3) splits++
            }
            if (splits < 2) {
                errors.push(`road island ${room.id} does not split and reconnect`)
            }
        }
        if (room.archetype === 'bridge-river') {
            const river = new Set<number>()
            const bridge = new Set<number>()
            for (const feature of roomFeatures) {
                if (feature.kind !== 'river' && feature.kind !== 'bridge') continue
                const target = feature.kind === 'river' ? river : bridge
                for (const cell of feature.cells) target.add(cellKey(cell))
            }
            if (!river.size || !bridge.size) errors.push(`river room ${room.id} lacks river or bridge geometry`)
            for (const cell of room.roadCells) {
                const packed = cellKey(cell)
                if (river.has(packed) && !bridge.has(packed)) {
                    errors.push(`river room ${room.id} has an unbridged road crossing`)
                }
            }
        }
        if (room.id !== plan.castleRoomId && room.buildableCells.length < 2) {
            errors.push(`room ${room.id} has insufficient defense space`)
        }
    }

    const connectedExitPortIds = new Set(plan.connections.map(connection => connection.fromPortId))
    const legalTerminalEnds = new Set<number>()
    for (const room of plan.rooms) {
        const terminalPorts = room.ports.filter(port =>
            port.kind === 'exit' && !connectedExitPortIds.has(port.id))
        const approaches = room.terminalApproaches ?? []
        for (const approach of approaches) {
            if (!terminalPorts.some(port => port.id === approach.portId)) {
                errors.push(`room ${room.id} has unexpected terminal approach ${approach.portId}`)
            }
        }
        if (!terminalPorts.length) continue
        const linkPairs = new Set<number>()
        for (const linkId of room.roadLinkIds) {
            const link = links.get(linkId)
            if (link) linkPairs.add(pairKey(cellKey(link.from), cellKey(link.to)))
        }
        for (const port of terminalPorts) {
            const approach = approaches.find(candidate => candidate.portId === port.id)
            if (!approach) {
                errors.push(`room ${room.id} omits terminal approach for ${port.id}`)
                continue
            }
            if (approach.cells.length !== 6) {
                errors.push(`terminal approach from ${port.id} has ${approach.cells.length} cells instead of 6`)
            }
            const uniqueApproachCells = new Set<number>()
            for (const cell of approach.cells) uniqueApproachCells.add(cellKey(cell))
            if (uniqueApproachCells.size !== approach.cells.length) {
                errors.push(`terminal approach from ${port.id} revisits a road cell`)
            }
            const expectedFirstKey = cellKey(move(port.cell, port.direction))
            let previous = cellKey(port.cell)
            for (let index = 0; index < approach.cells.length; index++) {
                const cell = approach.cells[index]!
                const packed = cellKey(cell)
                if (index === 0 && packed !== expectedFirstKey) {
                    errors.push(`terminal approach from ${port.id} does not leave through its port`)
                }
                if (occupied.has(packed)) {
                    errors.push(`terminal approach from ${port.id} enters room terrain at ${key(cell)}`)
                }
                if (!linkPairs.has(pairKey(previous, packed))) {
                    errors.push(`terminal approach from ${port.id} lacks link to ${key(cell)}`)
                }
                previous = packed
            }
            legalTerminalEnds.add(previous)
        }
    }

    const roadDegrees = new Map<number, number>()
    for (const link of plan.roadLinks) {
        const fromKey = cellKey(link.from)
        const toKey = cellKey(link.to)
        roadDegrees.set(fromKey, (roadDegrees.get(fromKey) ?? 0) + 1)
        roadDegrees.set(toKey, (roadDegrees.get(toKey) ?? 0) + 1)
    }
    const castleRoadEnds = new Set<number>()
    for (const link of plan.roadLinks) {
        if (link.roomId !== plan.castleRoomId) continue
        castleRoadEnds.add(cellKey(link.from))
        castleRoadEnds.add(cellKey(link.to))
    }
    for (const [cell, degree] of roadDegrees) {
        if (degree !== 1 || castleRoadEnds.has(cell) || legalTerminalEnds.has(cell)) continue
        errors.push(`road has an illegal hard endpoint at ${formatCellKey(cell)}`)
    }

    for (const link of plan.roadLinks) {
        const distance = Math.abs(link.from.col - link.to.col) + Math.abs(link.from.row - link.to.row)
        if (distance !== 1) errors.push(`road link ${link.id} is not cardinal`)
        if (!rooms.has(link.roomId)) errors.push(`road link ${link.id} has no owning room`)
    }
    for (const connection of plan.connections) {
        const from = rooms.get(connection.fromRoomId)
        const to = rooms.get(connection.toRoomId)
        if (!from || !to) {
            errors.push(`connection ${connection.id} references a missing room`)
            continue
        }
        if (!from.ports.some(port => port.id === connection.fromPortId)) {
            errors.push(`connection ${connection.id} references a missing source port`)
        }
        if (!to.ports.some(port => port.id === connection.toPortId)) {
            errors.push(`connection ${connection.id} references a missing destination port`)
        }
        if (connection.depth !== to.depth) errors.push(`connection ${connection.id} has the wrong depth`)
        for (const linkId of connection.roadLinkIds) {
            if (!links.has(linkId)) errors.push(`connection ${connection.id} references missing road link ${linkId}`)
        }
        const connectionLinks = connection.roadLinkIds
            .map(linkId => links.get(linkId))
            .filter(link => link !== undefined)
        const sourcePort = from.ports.find(port => port.id === connection.fromPortId)
        const destinationPort = to.ports.find(port => port.id === connection.toPortId)
        if (connection.kind === 'expansion' && sourcePort && destinationPort) {
            const first = connectionLinks[0]
            const last = connectionLinks[connectionLinks.length - 1]
            if (!first || first.from.col !== sourcePort.cell.col || first.from.row !== sourcePort.cell.row) {
                errors.push(`connection ${connection.id} does not leave its source port`)
            }
            if (!last || last.to.col !== destinationPort.cell.col || last.to.row !== destinationPort.cell.row) {
                errors.push(`connection ${connection.id} does not reach its destination port`)
            }
        }
    }
    for (const feature of plan.features) {
        for (const roomId of feature.roomIds) {
            if (!rooms.has(roomId)) errors.push(`feature ${feature.id} references missing room ${roomId}`)
        }
    }

    if (plan.metrics.roomCount !== plan.rooms.length) errors.push('room metric is stale')
    if (plan.metrics.maxDepth < 1) errors.push('maximum depth is invalid')
    return { valid: errors.length === 0, errors }
}
