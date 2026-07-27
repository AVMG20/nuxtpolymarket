import type {
    PathwardenCardinalDirection,
    PathwardenFeatureKind,
    PathwardenGridPoint,
    PathwardenRoomArchetype
} from '#shared/types/pathwarden-save'

export interface PathwardenLocalPort {
    id: string
    cell: PathwardenGridPoint
    direction: PathwardenCardinalDirection
    kind: 'entrance' | 'exit' | 'reconnection'
}

export interface PathwardenLocalFeature {
    kind: PathwardenFeatureKind
    cells: PathwardenGridPoint[]
}

export interface PathwardenRoomTemplate {
    id: string
    archetype: Exclude<PathwardenRoomArchetype, 'castle' | 'connector'>
    width: number
    height: number
    entrance: PathwardenLocalPort
    exits: PathwardenLocalPort[]
    roadCells: PathwardenGridPoint[]
    roadEdges: Array<[PathwardenGridPoint, PathwardenGridPoint]>
    buildableCells: PathwardenGridPoint[]
    features: PathwardenLocalFeature[]
    weight: number
    minimumDepth: number
}

export interface PathwardenTemplateTransform {
    rotation: 0 | 90 | 180 | 270
    reflected: boolean
}

export interface PathwardenTransformedTemplate extends Omit<PathwardenRoomTemplate, 'entrance' | 'exits' | 'roadCells' | 'roadEdges' | 'buildableCells' | 'features'> {
    entrance: PathwardenLocalPort
    exits: PathwardenLocalPort[]
    roadCells: PathwardenGridPoint[]
    roadEdges: Array<[PathwardenGridPoint, PathwardenGridPoint]>
    buildableCells: PathwardenGridPoint[]
    features: PathwardenLocalFeature[]
    transform: PathwardenTemplateTransform
}

function point(col: number, row: number): PathwardenGridPoint {
    return { col, row }
}

function line(from: PathwardenGridPoint, to: PathwardenGridPoint) {
    const cells: PathwardenGridPoint[] = []
    const colStep = Math.sign(to.col - from.col)
    const rowStep = Math.sign(to.row - from.row)
    let current = { ...from }
    cells.push(current)
    while (current.col !== to.col || current.row !== to.row) {
        current = {
            col: current.col + colStep,
            row: current.row + rowStep
        }
        cells.push(current)
    }
    return cells
}

function edges(cells: PathwardenGridPoint[]) {
    return cells.slice(1).map((cell, index): [PathwardenGridPoint, PathwardenGridPoint] => [
        cells[index]!,
        cell
    ])
}

function mergeCells(...groups: PathwardenGridPoint[][]) {
    const cells = new Map<string, PathwardenGridPoint>()
    for (const cell of groups.flat()) cells.set(`${cell.col}:${cell.row}`, cell)
    return [...cells.values()]
}

function rectangle(fromCol: number, toCol: number, fromRow: number, toRow: number) {
    const cells: PathwardenGridPoint[] = []
    for (let row = fromRow; row <= toRow; row++) {
        for (let col = fromCol; col <= toCol; col++) cells.push(point(col, row))
    }
    return cells
}

function template(
    definition: Omit<PathwardenRoomTemplate, 'roadEdges'> & {
        routes: PathwardenGridPoint[][]
    }
): PathwardenRoomTemplate {
    return {
        ...definition,
        roadCells: mergeCells(...definition.routes),
        roadEdges: definition.routes.flatMap(edges)
    }
}

const straight = line(point(0, 2), point(8, 2))
const corner = [
    ...line(point(0, 1), point(5, 1)),
    ...line(point(5, 2), point(5, 6))
]
const uBend = [
    ...line(point(0, 1), point(6, 1)),
    ...line(point(6, 2), point(6, 6)),
    ...line(point(5, 6), point(1, 6))
]
const switchback = [
    ...line(point(0, 1), point(7, 1)),
    ...line(point(7, 2), point(7, 4)),
    ...line(point(6, 4), point(2, 4)),
    ...line(point(2, 5), point(2, 8)),
    ...line(point(3, 8), point(8, 8))
]
const junctionStem = line(point(0, 4), point(4, 4))
const junctionNorth = line(point(4, 3), point(4, 0))
const junctionSouth = line(point(4, 5), point(4, 8))
const junctionEast = line(point(5, 4), point(8, 4))
const islandStem = line(point(0, 4), point(3, 4))
const islandTop = [
    point(3, 4),
    ...line(point(3, 3), point(3, 2)),
    ...line(point(4, 2), point(9, 2)),
    ...line(point(9, 3), point(9, 4))
]
const islandBottom = [
    point(3, 4),
    ...line(point(3, 5), point(3, 6)),
    ...line(point(4, 6), point(9, 6)),
    ...line(point(9, 5), point(9, 4))
]
const islandExit = line(point(9, 4), point(12, 4))

export const PATHWARDEN_ROOM_TEMPLATES: readonly PathwardenRoomTemplate[] = [
    template({
        id: 'straight-long',
        archetype: 'straight',
        width: 9,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(8, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [straight],
        buildableCells: [...rectangle(2, 6, 0, 0), ...rectangle(2, 6, 4, 4)],
        features: [],
        weight: 12,
        minimumDepth: 1
    }),
    template({
        id: 'corner-long',
        archetype: 'corner',
        width: 7,
        height: 7,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(5, 6), direction: 'south', kind: 'exit' }],
        roadCells: [],
        routes: [corner],
        buildableCells: rectangle(1, 3, 3, 5),
        features: [],
        weight: 10,
        minimumDepth: 1
    }),
    template({
        id: 'u-bend-courtyard',
        archetype: 'u-bend',
        width: 8,
        height: 8,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(1, 6), direction: 'west', kind: 'exit' }],
        roadCells: [],
        routes: [uBend],
        buildableCells: rectangle(2, 4, 3, 4),
        features: [],
        weight: 5,
        minimumDepth: 3
    }),
    template({
        id: 'switchback-wide',
        archetype: 'switchback',
        width: 9,
        height: 10,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(8, 8), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [switchback],
        buildableCells: [...rectangle(3, 5, 2, 3), ...rectangle(4, 6, 5, 7)],
        features: [],
        weight: 4,
        minimumDepth: 5
    }),
    template({
        id: 't-junction-wide',
        archetype: 't-junction',
        width: 9,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [
            { id: 'exit-north', cell: point(4, 0), direction: 'north', kind: 'exit' },
            { id: 'exit-south', cell: point(4, 8), direction: 'south', kind: 'exit' }
        ],
        roadCells: [],
        routes: [junctionStem, junctionNorth, junctionSouth],
        buildableCells: [...rectangle(1, 2, 1, 2), ...rectangle(1, 2, 6, 7)],
        features: [],
        weight: 4,
        minimumDepth: 2
    }),
    template({
        id: 'crossroads-wide',
        archetype: 'crossroads',
        width: 9,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [
            { id: 'exit-north', cell: point(4, 0), direction: 'north', kind: 'exit' },
            { id: 'exit-east', cell: point(8, 4), direction: 'east', kind: 'exit' },
            { id: 'exit-south', cell: point(4, 8), direction: 'south', kind: 'exit' }
        ],
        roadCells: [],
        routes: [junctionStem, junctionNorth, junctionEast, junctionSouth],
        buildableCells: [
            ...rectangle(1, 2, 1, 2),
            ...rectangle(6, 7, 1, 2),
            ...rectangle(1, 2, 6, 7),
            ...rectangle(6, 7, 6, 7)
        ],
        features: [],
        weight: 2,
        minimumDepth: 4
    }),
    template({
        id: 'road-island-wide',
        archetype: 'road-island',
        width: 13,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(12, 4), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [islandStem, islandTop, islandBottom, islandExit],
        buildableCells: rectangle(5, 7, 4, 4),
        features: [],
        weight: 3,
        minimumDepth: 4
    }),
    template({
        id: 'river-bridge',
        archetype: 'bridge-river',
        width: 11,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(10, 4), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 4), point(10, 4))],
        buildableCells: [...rectangle(1, 3, 1, 2), ...rectangle(7, 9, 6, 7)],
        features: [
            { kind: 'river', cells: rectangle(4, 6, 0, 8) },
            { kind: 'bridge', cells: line(point(4, 4), point(6, 4)) }
        ],
        weight: 3,
        minimumDepth: 3
    }),
    template({
        id: 'mountain-pass',
        archetype: 'mountain-pass',
        width: 11,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(10, 4), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 4), point(10, 4))],
        buildableCells: [...rectangle(1, 3, 2, 2), ...rectangle(7, 9, 6, 6)],
        features: [
            { kind: 'mountain', cells: [...rectangle(2, 8, 0, 1), ...rectangle(2, 8, 7, 8)] }
        ],
        weight: 3,
        minimumDepth: 3
    }),
    template({
        id: 'lake-shore',
        archetype: 'lake-shore',
        width: 11,
        height: 10,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(10, 7), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [[
            ...line(point(0, 2), point(3, 2)),
            ...line(point(3, 3), point(3, 7)),
            ...line(point(4, 7), point(10, 7))
        ]],
        buildableCells: [...rectangle(1, 2, 5, 6), ...rectangle(7, 9, 8, 9)],
        features: [{ kind: 'lake', cells: rectangle(5, 9, 1, 5) }],
        weight: 2,
        minimumDepth: 4
    }),
    template({
        id: 'forest-road',
        archetype: 'forest-road',
        width: 11,
        height: 9,
        entrance: { id: 'entrance', cell: point(0, 4), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(10, 4), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 4), point(10, 4))],
        buildableCells: [...rectangle(2, 3, 2, 2), ...rectangle(7, 8, 6, 6)],
        features: [{
            kind: 'forest',
            cells: [
                ...rectangle(1, 4, 0, 1),
                ...rectangle(6, 9, 0, 2),
                ...rectangle(1, 3, 6, 8),
                ...rectangle(6, 9, 7, 8)
            ]
        }],
        weight: 4,
        minimumDepth: 2
    })
]

function rotateDirection(direction: PathwardenCardinalDirection, rotation: PathwardenTemplateTransform['rotation']) {
    const directions: PathwardenCardinalDirection[] = ['north', 'east', 'south', 'west']
    const index = directions.indexOf(direction)
    return directions[(index + rotation / 90) % directions.length]!
}

function reflectDirection(direction: PathwardenCardinalDirection) {
    if (direction === 'east') return 'west'
    if (direction === 'west') return 'east'
    return direction
}

function transformedSize(template: PathwardenRoomTemplate, rotation: PathwardenTemplateTransform['rotation']) {
    return rotation === 90 || rotation === 270
        ? { width: template.height, height: template.width }
        : { width: template.width, height: template.height }
}

function transformPoint(
    template: PathwardenRoomTemplate,
    source: PathwardenGridPoint,
    transform: PathwardenTemplateTransform
) {
    const reflected = transform.reflected
        ? { col: template.width - 1 - source.col, row: source.row }
        : source
    if (transform.rotation === 0) return { ...reflected }
    if (transform.rotation === 90) return { col: template.height - 1 - reflected.row, row: reflected.col }
    if (transform.rotation === 180) {
        return {
            col: template.width - 1 - reflected.col,
            row: template.height - 1 - reflected.row
        }
    }
    return { col: reflected.row, row: template.width - 1 - reflected.col }
}

function transformPort(
    template: PathwardenRoomTemplate,
    port: PathwardenLocalPort,
    transform: PathwardenTemplateTransform
): PathwardenLocalPort {
    const reflectedDirection = transform.reflected ? reflectDirection(port.direction) : port.direction
    return {
        ...port,
        cell: transformPoint(template, port.cell, transform),
        direction: rotateDirection(reflectedDirection, transform.rotation)
    }
}

export function transformPathwardenRoomTemplate(
    template: PathwardenRoomTemplate,
    transform: PathwardenTemplateTransform
): PathwardenTransformedTemplate {
    const size = transformedSize(template, transform.rotation)
    return {
        ...template,
        ...size,
        entrance: transformPort(template, template.entrance, transform),
        exits: template.exits.map(port => transformPort(template, port, transform)),
        roadCells: template.roadCells.map(cell => transformPoint(template, cell, transform)),
        roadEdges: template.roadEdges.map(([from, to]) => [
            transformPoint(template, from, transform),
            transformPoint(template, to, transform)
        ]),
        buildableCells: template.buildableCells.map(cell => transformPoint(template, cell, transform)),
        features: template.features.map(feature => ({
            ...feature,
            cells: feature.cells.map(cell => transformPoint(template, cell, transform))
        })),
        transform
    }
}
