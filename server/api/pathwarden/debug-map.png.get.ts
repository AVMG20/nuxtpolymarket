import { deflateSync } from 'node:zlib'
import { getQuery, setHeader } from 'h3'
import { getPathwardenDebugExpansionMarkers } from '#server/utils/pathwarden-debug-map'
import {
    getPathwardenDebugMapPlan,
    type PathwardenDebugMapGeneration
} from '#server/utils/pathwarden-debug-map-plan'

const IMAGE_SIZE = 1600
const PADDING = 24
const DIGITS: Record<string, string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '001', '001', '001'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111']
}

function key(point: { col: number, row: number }) {
    return `${point.col}:${point.row}`
}

function pngChunk(type: string, data: Buffer) {
    const typeBuffer = Buffer.from(type)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
    return Buffer.concat([length, typeBuffer, data, checksum])
}

function crc32(data: Buffer) {
    let crc = 0xFFFFFFFF
    for (const byte of data) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

function renderMap(plan: ReturnType<typeof getPathwardenDebugMapPlan>['plan']) {
    const road = new Set(plan.roadLinks.flatMap(link => [key(link.from), key(link.to)]))
    for (const room of plan.rooms) {
        for (const cell of room.roadCells) road.add(key(cell))
        for (const approach of room.terminalApproaches ?? []) {
            for (const cell of approach.cells) road.add(key(cell))
        }
    }

    const markers = getPathwardenDebugExpansionMarkers(plan)

    const points = [
        ...plan.rooms.flatMap(room => room.footprint),
        ...[...road].map(point => {
            const [col, row] = point.split(':').map(Number)
            return { col: col!, row: row! }
        }),
        ...markers.map(marker => marker.source),
        plan.rooms.find(room => room.id === plan.castleRoomId)!.origin
    ]
    const minCol = Math.min(...points.map(point => point.col))
    const maxCol = Math.max(...points.map(point => point.col))
    const minRow = Math.min(...points.map(point => point.row))
    const maxRow = Math.max(...points.map(point => point.row))
    const mapWidth = maxCol - minCol + 1
    const mapHeight = maxRow - minRow + 1
    const scale = (IMAGE_SIZE - PADDING * 2) / Math.max(mapWidth, mapHeight)
    const offsetX = (IMAGE_SIZE - mapWidth * scale) / 2
    const offsetY = (IMAGE_SIZE - mapHeight * scale) / 2
    const width = IMAGE_SIZE
    const height = IMAGE_SIZE
    const pixels = Buffer.alloc(width * height * 3)

    const screen = (point: { col: number, row: number }) => ({
        x: offsetX + (point.col - minCol) * scale,
        y: offsetY + (point.row - minRow) * scale
    })
    const put = (x: number, y: number, color: [number, number, number]) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return
        const offset = (y * width + x) * 3
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
    }
    const fillCell = (col: number, row: number, color: [number, number, number]) => {
        const point = screen({ col, row })
        const fromX = Math.floor(point.x)
        const toX = Math.ceil(point.x + scale)
        const fromY = Math.floor(point.y)
        const toY = Math.ceil(point.y + scale)
        for (let y = fromY; y < toY; y++) {
            for (let x = fromX; x < toX; x++) put(x, y, color)
        }
    }
    const drawRoomOutline = (room: typeof plan.rooms[number], color: [number, number, number]) => {
        const roomCells = new Set(room.footprint.map(key))
        for (const cell of room.footprint) {
            const point = screen(cell)
            const x = Math.floor(point.x)
            const y = Math.floor(point.y)
            const endX = Math.ceil(point.x + scale) - 1
            const endY = Math.ceil(point.y + scale) - 1
            if (!roomCells.has(key({ col: cell.col, row: cell.row - 1 }))) {
                for (let offset = x; offset <= endX; offset++) put(offset, y, color)
            }
            if (!roomCells.has(key({ col: cell.col, row: cell.row + 1 }))) {
                for (let offset = x; offset <= endX; offset++) put(offset, endY, color)
            }
            if (!roomCells.has(key({ col: cell.col - 1, row: cell.row }))) {
                for (let offset = y; offset <= endY; offset++) put(x, offset, color)
            }
            if (!roomCells.has(key({ col: cell.col + 1, row: cell.row }))) {
                for (let offset = y; offset <= endY; offset++) put(endX, offset, color)
            }
        }
    }

    for (const [index, room] of plan.rooms.entries()) {
        const shade = index % 2 === 0 ? [42, 42, 42] as [number, number, number] : [78, 78, 78] as [number, number, number]
        for (const cell of room.footprint) fillCell(cell.col, cell.row, shade)
    }

    for (const point of road) {
        const [col, row] = point.split(':').map(Number)
        fillCell(col!, row!, [255, 255, 255])
    }

    for (const room of plan.rooms) {
        const color = room.depth === plan.metrics.maxDepth
            ? [185, 80, 255] as [number, number, number]
            : [0, 190, 70] as [number, number, number]
        drawRoomOutline(room, color)
    }

    for (const room of plan.rooms) {
        for (const approach of room.terminalApproaches ?? []) {
            for (const cell of approach.cells) {
                const point = screen(cell)
                const radius = Math.max(2, Math.floor(scale * 0.06))
                for (let y = -radius; y <= radius; y++) {
                    for (let x = -radius; x <= radius; x++) {
                        if (x * x + y * y <= radius * radius) {
                            put(Math.round(point.x + scale / 2 + x), Math.round(point.y + scale / 2 + y), [185, 80, 255])
                        }
                    }
                }
            }
        }
    }

    const castle = plan.rooms.find(room => room.id === plan.castleRoomId)!
    const castlePoint = screen(castle.origin)
    const castleCenter = {
        x: castlePoint.x + scale / 2,
        y: castlePoint.y + scale / 2
    }
    const dotRadius = Math.max(5, Math.round(scale * 0.22))
    for (let y = -dotRadius; y <= dotRadius; y++) {
        for (let x = -dotRadius; x <= dotRadius; x++) {
            if (x * x + y * y <= dotRadius * dotRadius) put(Math.round(castleCenter.x + x), Math.round(castleCenter.y + y), [255, 210, 0])
        }
    }

    for (const marker of markers) {
        const text = String(marker.number)
        const digitPixel = Math.max(1, Math.floor(scale / 6))
        const glyphWidth = text.length * (3 * digitPixel + digitPixel) - digitPixel
        const markerPoint = screen(marker.source)
        const startX = Math.floor(markerPoint.x + (scale - glyphWidth) / 2)
        const startY = Math.floor(markerPoint.y + (scale - 5 * digitPixel) / 2)
        for (const [digitIndex, digit] of [...text].entries()) {
            const glyph = DIGITS[digit]!
            for (const [row, line] of glyph.entries()) {
                for (const [col, value] of [...line].entries()) {
                    if (value !== '1') continue
                    for (let yOffset = 0; yOffset < digitPixel; yOffset++) {
                        for (let xOffset = 0; xOffset < digitPixel; xOffset++) {
                            put(
                                startX + digitIndex * (3 * digitPixel + digitPixel) + col * digitPixel + xOffset,
                                startY + row * digitPixel + yOffset,
                                [220, 0, 0]
                            )
                        }
                    }
                }
            }
        }
    }

    const scanlines = Buffer.alloc((width * 3 + 1) * height)
    for (let row = 0; row < height; row++) {
        scanlines[row * (width * 3 + 1)] = 0
        pixels.copy(scanlines, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3)
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 2
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(scanlines)),
        pngChunk('IEND', Buffer.alloc(0))
    ])
}

export default defineEventHandler((event) => {
    const query = getQuery(event)
    const seed = Number(query.seed ?? 1)
    const realm = Number(query.realm ?? 1)
    const generated = query.generated === 'cache' || query.generated === 'fresh'
        ? query.generated as PathwardenDebugMapGeneration
        : 'fresh'
    if (query.generated !== undefined && query.generated !== 'cache' && query.generated !== 'fresh') {
        throw createError({ statusCode: 400, statusMessage: 'generated must be cache or fresh' })
    }
    if (!Number.isFinite(seed) || !Number.isFinite(realm)) {
        throw createError({ statusCode: 400, statusMessage: 'seed and realm must be numeric' })
    }
    setHeader(event, 'content-type', 'image/png')
    setHeader(event, 'cache-control', 'no-store')
    const result = getPathwardenDebugMapPlan(Math.floor(seed), Math.floor(realm), generated)
    return renderMap(result.plan)
})
