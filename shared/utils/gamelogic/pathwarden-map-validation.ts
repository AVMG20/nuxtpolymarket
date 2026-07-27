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

    const occupied = new Map<string, string>()
    for (const room of plan.rooms) {
        if (room.id !== plan.castleRoomId) {
            if (!room.parentConnectionId || !connections.has(room.parentConnectionId)) {
                errors.push(`room ${room.id} has no valid parent connection`)
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
