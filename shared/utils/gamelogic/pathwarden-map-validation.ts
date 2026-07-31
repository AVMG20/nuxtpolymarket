import type {
    PathwardenGridPoint,
    PathwardenMapPlan
} from '#shared/types/pathwarden-save'

export interface PathwardenMapValidation {
    valid: boolean
    errors: string[]
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
    const remaining = new Set(cells.map(key))
    const queue = [cells[0]!]
    remaining.delete(key(cells[0]!))
    while (queue.length) {
        const cell = queue.shift()!
        const neighbours = [
            { col: cell.col + 1, row: cell.row },
            { col: cell.col - 1, row: cell.row },
            { col: cell.col, row: cell.row + 1 },
            { col: cell.col, row: cell.row - 1 }
        ]
        for (const neighbour of neighbours) {
            if (!remaining.delete(key(neighbour))) continue
            queue.push(neighbour)
        }
    }
    return remaining.size === 0
}

export function pathwardenRoomFootprintDimensions(cells: PathwardenGridPoint[]) {
    if (!cells.length) return { width: 0, height: 0, area: 0 }
    const columns = cells.map(cell => cell.col)
    const rows = cells.map(cell => cell.row)
    const width = Math.max(...columns) - Math.min(...columns) + 1
    const height = Math.max(...rows) - Math.min(...rows) + 1
    return { width, height, area: width * height }
}

export function isCompactPathwardenRoomFootprint(cells: PathwardenGridPoint[]) {
    const { width, height, area } = pathwardenRoomFootprintDimensions(cells)
    return width <= 8 && height <= 8 && area <= 36
}

export function validatePathwardenMapPlan(plan: PathwardenMapPlan): PathwardenMapValidation {
    const errors: string[] = []
    const junctionArchetypes = new Set(['y-junction', 't-junction', 'crossroads'])
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

    const occupied = new Map<string, string>()
    for (const room of plan.rooms) {
        if (room.id !== plan.castleRoomId && room.depth === 1 && room.archetype !== 'crossroads') {
            errors.push(`depth-1 room ${room.id} is ${room.archetype}, expected crossroads`)
        }
        if (room.id !== plan.castleRoomId && room.depth >= 3 && room.depth % 2 === 1
            && !junctionArchetypes.has(room.archetype)) {
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
        for (const cell of room.footprint) {
            if (cell.col < 0 || cell.row < 0 || cell.col >= plan.size.cols || cell.row >= plan.size.rows) {
                errors.push(`room ${room.id} leaves map bounds at ${key(cell)}`)
            }
            const owner = occupied.get(key(cell))
            if (owner && owner !== room.id) errors.push(`rooms ${owner} and ${room.id} overlap at ${key(cell)}`)
            occupied.set(key(cell), room.id)
        }
        const footprint = new Set(room.footprint.map(key))
        for (const cell of [...room.roadCells, ...room.buildableCells]) {
            if (!footprint.has(key(cell))) errors.push(`room ${room.id} owns a cell outside its footprint`)
        }
        const roads = new Set(room.roadCells.map(key))
        const buildable = new Set(room.buildableCells.map(key))
        for (const cell of room.buildableCells) {
            if (roads.has(key(cell))) errors.push(`room ${room.id} marks road ${key(cell)} buildable`)
        }
        for (const linkId of room.roadLinkIds) {
            if (!links.has(linkId)) errors.push(`room ${room.id} references missing road link ${linkId}`)
        }
        const roomLinks = room.roadLinkIds
            .map(linkId => links.get(linkId))
            .filter(link => link !== undefined)
        const roomRoadKeys = new Set(roomLinks.flatMap(link => [key(link.from), key(link.to)]))
        for (const cell of room.roadCells) {
            if (!roomRoadKeys.has(key(cell))) errors.push(`room ${room.id} has unlinked road cell ${key(cell)}`)
        }
        const roomDegrees = new Map<string, number>()
        for (const link of roomLinks) {
            roomDegrees.set(key(link.from), (roomDegrees.get(key(link.from)) ?? 0) + 1)
            roomDegrees.set(key(link.to), (roomDegrees.get(key(link.to)) ?? 0) + 1)
        }
        const roomExitKeys = new Set(room.ports.filter(port => port.kind === 'exit').map(port => key(port.cell)))
        const roomEntranceKeys = new Set(room.ports.filter(port => port.kind === 'entrance').map(port => key(port.cell)))
        const parentConnection = room.parentConnectionId ? connections.get(room.parentConnectionId) : undefined
        const parentRoom = parentConnection ? rooms.get(parentConnection.fromRoomId) : undefined
        const parentPort = parentConnection
            ? parentRoom?.ports.find(port => port.id === parentConnection.fromPortId)
            : undefined
        const parentSourceKeys = parentPort ? new Set([key(parentPort.cell)]) : new Set<string>()
        const terminalEndKeys = new Set((room.terminalApproaches ?? [])
            .map(approach => approach.cells.at(-1))
            .filter(cell => cell !== undefined)
            .map(key))
        for (const [cell, degree] of roomDegrees) {
            if (degree === 1 && !roomExitKeys.has(cell) && !roomEntranceKeys.has(cell)
                && !parentSourceKeys.has(cell) && !terminalEndKeys.has(cell)
                && room.id !== plan.castleRoomId) {
                errors.push(`room ${room.id} has an interior road endpoint at ${cell}`)
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
                if (!footprint.has(key(cell))) errors.push(`feature ${feature.id} leaves room ${room.id}`)
                if (buildable.has(key(cell))) errors.push(`feature ${feature.id} occupies buildable cell ${key(cell)}`)
            }
            if (['river', 'lake', 'mountain'].includes(feature.kind) && !connectedCells(feature.cells)) {
                errors.push(`feature ${feature.id} is disconnected`)
            }
        }
        if (room.archetype === 'road-island') {
            const degree = new Map<string, number>()
            for (const linkId of room.roadLinkIds) {
                const link = links.get(linkId)
                if (!link) continue
                degree.set(key(link.from), (degree.get(key(link.from)) ?? 0) + 1)
                degree.set(key(link.to), (degree.get(key(link.to)) ?? 0) + 1)
            }
            if ([...degree.values()].filter(value => value >= 3).length < 2) {
                errors.push(`road island ${room.id} does not split and reconnect`)
            }
        }
        if (room.archetype === 'bridge-river') {
            const river = new Set(roomFeatures
                .filter(feature => feature.kind === 'river')
                .flatMap(feature => feature.cells)
                .map(key))
            const bridge = new Set(roomFeatures
                .filter(feature => feature.kind === 'bridge')
                .flatMap(feature => feature.cells)
                .map(key))
            if (!river.size || !bridge.size) errors.push(`river room ${room.id} lacks river or bridge geometry`)
            for (const cell of room.roadCells) {
                if (river.has(key(cell)) && !bridge.has(key(cell))) {
                    errors.push(`river room ${room.id} has an unbridged road crossing`)
                }
            }
        }
        if (room.id !== plan.castleRoomId && room.buildableCells.length < 2) {
            errors.push(`room ${room.id} has insufficient defense space`)
        }
    }

    const connectedExitPortIds = new Set(plan.connections.map(connection => connection.fromPortId))
    const legalTerminalEnds = new Set<string>()
    for (const room of plan.rooms) {
        const terminalPorts = room.ports.filter(port =>
            port.kind === 'exit' && !connectedExitPortIds.has(port.id))
        const approaches = room.terminalApproaches ?? []
        for (const approach of approaches) {
            if (!terminalPorts.some(port => port.id === approach.portId)) {
                errors.push(`room ${room.id} has unexpected terminal approach ${approach.portId}`)
            }
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
            const uniqueApproachCells = new Set(approach.cells.map(key))
            if (uniqueApproachCells.size !== approach.cells.length) {
                errors.push(`terminal approach from ${port.id} revisits a road cell`)
            }
            let previous = port.cell
            for (const [index, cell] of approach.cells.entries()) {
                if (index === 0 && key(cell) !== key(move(port.cell, port.direction))) {
                    errors.push(`terminal approach from ${port.id} does not leave through its port`)
                }
                if (occupied.has(key(cell))) {
                    errors.push(`terminal approach from ${port.id} enters room terrain at ${key(cell)}`)
                }
                const ownsLink = room.roadLinkIds
                    .map(linkId => links.get(linkId))
                    .some(link => link
                        && [key(link.from), key(link.to)].sort().join('|')
                        === [key(previous), key(cell)].sort().join('|'))
                if (!ownsLink) {
                    errors.push(`terminal approach from ${port.id} lacks link to ${key(cell)}`)
                }
                previous = cell
            }
            legalTerminalEnds.add(key(previous))
        }
    }

    const roadDegrees = new Map<string, number>()
    for (const link of plan.roadLinks) {
        roadDegrees.set(key(link.from), (roadDegrees.get(key(link.from)) ?? 0) + 1)
        roadDegrees.set(key(link.to), (roadDegrees.get(key(link.to)) ?? 0) + 1)
    }
    const castleRoadEnds = new Set(plan.roadLinks
        .filter(link => link.roomId === plan.castleRoomId)
        .flatMap(link => [key(link.from), key(link.to)]))
    for (const [cell, degree] of roadDegrees) {
        if (degree !== 1 || castleRoadEnds.has(cell) || legalTerminalEnds.has(cell)) continue
        errors.push(`road has an illegal hard endpoint at ${cell}`)
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
            if (!first || key(first.from) !== key(sourcePort.cell)) {
                errors.push(`connection ${connection.id} does not leave its source port`)
            }
            if (!last || key(last.to) !== key(destinationPort.cell)) {
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
