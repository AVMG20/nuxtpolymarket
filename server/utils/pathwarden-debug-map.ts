import type { PathwardenMapPlan } from '#shared/types/pathwarden-save'

export interface PathwardenDebugExpansionMarker {
    number: number
    connectionId: string
    sourceRoomId: string
    sourceRoomDepth: number
    sourcePortId: string
    source: { col: number, row: number }
    destinationRoomId: string
    destinationRoomDepth: number
    destinationPortId: string
    destination: { col: number, row: number }
}

function key(point: { col: number, row: number }) {
    return `${point.col}:${point.row}`
}

export function getPathwardenDebugExpansionMarkers(plan: PathwardenMapPlan) {
    const rooms = new Map(plan.rooms.map(room => [room.id, room]))
    const markers = new Map<string, Omit<PathwardenDebugExpansionMarker, 'number'>>()
    for (const connection of plan.connections.filter(connection => connection.kind === 'expansion')) {
        const sourceRoom = rooms.get(connection.fromRoomId)
        const destinationRoom = rooms.get(connection.toRoomId)
        const sourcePort = sourceRoom?.ports.find(port => port.id === connection.fromPortId)
        const destinationPort = destinationRoom?.ports.find(port => port.id === connection.toPortId)
        if (!sourceRoom || !destinationRoom || !sourcePort || !destinationPort) continue
        markers.set(key(sourcePort.cell), {
            connectionId: connection.id,
            sourceRoomId: sourceRoom.id,
            sourceRoomDepth: sourceRoom.depth,
            sourcePortId: sourcePort.id,
            source: { ...sourcePort.cell },
            destinationRoomId: destinationRoom.id,
            destinationRoomDepth: destinationRoom.depth,
            destinationPortId: destinationPort.id,
            destination: { ...destinationPort.cell }
        })
    }
    return [...markers.values()]
        .sort((left, right) => left.source.row - right.source.row || left.source.col - right.source.col)
        .map((marker, index) => ({ number: index + 1, ...marker }))
}
