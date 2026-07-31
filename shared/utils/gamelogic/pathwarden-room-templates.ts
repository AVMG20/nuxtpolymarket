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

const straight = line(point(0, 2), point(6, 2))
const corner = [
    ...line(point(0, 1), point(4, 1)),
    ...line(point(4, 2), point(4, 5))
]
const uBend = [
    ...line(point(0, 1), point(5, 1)),
    ...line(point(5, 2), point(5, 4)),
    ...line(point(4, 4), point(0, 4))
]
const switchback = [
    ...line(point(0, 0), point(5, 0)),
    ...line(point(5, 1), point(5, 2)),
    ...line(point(4, 2), point(1, 2)),
    ...line(point(1, 3), point(1, 4)),
    ...line(point(2, 4), point(5, 4))
]
const yStem = line(point(0, 2), point(2, 2))
const yNorth = [
    point(2, 2),
    point(3, 2),
    ...line(point(3, 1), point(3, 0))
]
const ySouth = [
    point(2, 2),
    point(1, 2),
    ...line(point(1, 3), point(1, 4))
]
const junctionStem = line(point(0, 2), point(2, 2))
const junctionNorth = [point(2, 2), ...line(point(2, 1), point(2, 0))]
const junctionSouth = [point(2, 2), ...line(point(2, 3), point(2, 4))]
const junctionEast = [point(2, 2), ...line(point(3, 2), point(4, 2))]
const islandStem = line(point(0, 2), point(2, 2))
const islandTop = [
    point(2, 2),
    ...line(point(2, 1), point(2, 0)),
    ...line(point(3, 0), point(5, 0)),
    ...line(point(5, 1), point(5, 2))
]
const islandBottom = [
    point(2, 2),
    point(2, 3),
    ...line(point(3, 3), point(5, 3)),
    point(5, 2)
]
const islandExit = line(point(5, 2), point(6, 2))

export const PATHWARDEN_ROOM_TEMPLATES: readonly PathwardenRoomTemplate[] = [
    template({
        id: 'straight-long',
        archetype: 'straight',
        width: 7,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(6, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [straight],
        buildableCells: [...rectangle(2, 4, 0, 0), ...rectangle(2, 4, 4, 4)],
        features: [],
        weight: 12,
        minimumDepth: 1
    }),
    template({
        id: 'corner-long',
        archetype: 'corner',
        width: 6,
        height: 6,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(4, 5), direction: 'south', kind: 'exit' }],
        roadCells: [],
        routes: [corner],
        buildableCells: rectangle(1, 2, 3, 4),
        features: [],
        weight: 10,
        minimumDepth: 1
    }),
    template({
        id: 'u-bend-courtyard',
        archetype: 'u-bend',
        width: 6,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(0, 4), direction: 'west', kind: 'exit' }],
        roadCells: [],
        routes: [uBend],
        buildableCells: rectangle(2, 3, 2, 3),
        features: [],
        weight: 5,
        minimumDepth: 3
    }),
    template({
        id: 'switchback-wide',
        archetype: 'switchback',
        width: 6,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 0), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(5, 4), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [switchback],
        buildableCells: [...rectangle(1, 4, 1, 1), ...rectangle(2, 4, 3, 3)],
        features: [],
        weight: 4,
        minimumDepth: 5
    }),
    template({
        id: 'y-junction-compact',
        archetype: 'y-junction',
        width: 5,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [
            { id: 'exit-north', cell: point(3, 0), direction: 'north', kind: 'exit' },
            { id: 'exit-south', cell: point(1, 4), direction: 'south', kind: 'exit' }
        ],
        roadCells: [],
        routes: [yStem, yNorth, ySouth],
        buildableCells: [point(0, 0), point(0, 4)],
        features: [],
        weight: 5,
        minimumDepth: 2
    }),
    template({
        id: 't-junction-wide',
        archetype: 't-junction',
        width: 5,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [
            { id: 'exit-north', cell: point(2, 0), direction: 'north', kind: 'exit' },
            { id: 'exit-south', cell: point(2, 4), direction: 'south', kind: 'exit' }
        ],
        roadCells: [],
        routes: [junctionStem, junctionNorth, junctionSouth],
        buildableCells: [point(0, 0), point(0, 4)],
        features: [],
        weight: 4,
        minimumDepth: 2
    }),
    template({
        id: 'crossroads-wide',
        archetype: 'crossroads',
        width: 5,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [
            { id: 'exit-north', cell: point(2, 0), direction: 'north', kind: 'exit' },
            { id: 'exit-east', cell: point(4, 2), direction: 'east', kind: 'exit' },
            { id: 'exit-south', cell: point(2, 4), direction: 'south', kind: 'exit' }
        ],
        roadCells: [],
        routes: [junctionStem, junctionNorth, junctionEast, junctionSouth],
        buildableCells: [
            point(0, 0),
            point(4, 0),
            point(0, 4),
            point(4, 4)
        ],
        features: [],
        weight: 2,
        minimumDepth: 1
    }),
    template({
        id: 'road-island-wide',
        archetype: 'road-island',
        width: 7,
        height: 4,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(6, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [islandStem, islandTop, islandBottom, islandExit],
        buildableCells: [point(0, 0), ...rectangle(3, 4, 1, 1)],
        features: [],
        weight: 3,
        minimumDepth: 4
    }),
    template({
        id: 'river-bridge',
        archetype: 'bridge-river',
        width: 7,
        height: 4,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(6, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 2), point(6, 2))],
        buildableCells: [...rectangle(1, 2, 0, 0), ...rectangle(5, 6, 3, 3)],
        features: [
            { kind: 'river', cells: rectangle(3, 4, 0, 3) },
            { kind: 'bridge', cells: line(point(3, 2), point(4, 2)) }
        ],
        weight: 3,
        minimumDepth: 2
    }),
    template({
        id: 'mountain-pass',
        archetype: 'mountain-pass',
        width: 7,
        height: 4,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(6, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 2), point(6, 2))],
        buildableCells: [point(1, 1), point(6, 3)],
        features: [
            { kind: 'mountain', cells: rectangle(2, 5, 0, 1) },
            { kind: 'mountain', cells: rectangle(2, 5, 3, 3) }
        ],
        weight: 3,
        minimumDepth: 3
    }),
    template({
        id: 'lake-shore',
        archetype: 'lake-shore',
        width: 5,
        height: 5,
        entrance: { id: 'entrance', cell: point(0, 1), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(4, 3), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [[
            ...line(point(0, 1), point(1, 1)),
            ...line(point(1, 2), point(1, 3)),
            ...line(point(2, 3), point(4, 3))
        ]],
        buildableCells: [point(0, 4), point(1, 4)],
        features: [{ kind: 'lake', cells: rectangle(2, 3, 0, 2) }],
        weight: 2,
        minimumDepth: 4
    }),
    template({
        id: 'forest-road',
        archetype: 'forest-road',
        width: 7,
        height: 4,
        entrance: { id: 'entrance', cell: point(0, 2), direction: 'west', kind: 'entrance' },
        exits: [{ id: 'exit', cell: point(6, 2), direction: 'east', kind: 'exit' }],
        roadCells: [],
        routes: [line(point(0, 2), point(6, 2))],
        buildableCells: [point(1, 3), point(5, 3)],
        features: [{
            kind: 'forest',
            cells: [
                ...rectangle(1, 3, 0, 1),
                ...rectangle(4, 5, 0, 1),
                point(3, 3),
                point(4, 3)
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

// A template has only eight orientations and the generator re-derives the same
// ones thousands of times per plan, so each is built once and shared. Callers
// treat transformed templates as read-only.
const transformCache = new WeakMap<PathwardenRoomTemplate, Map<number, PathwardenTransformedTemplate>>()

// Canonical orientation order: rotations ascending, unreflected before
// reflected. The generator's shuffle relies on this exact order to keep its
// random stream unchanged.
const CANONICAL_TRANSFORMS: readonly PathwardenTemplateTransform[] = ([0, 90, 180, 270] as const)
    .flatMap(rotation => [false, true].map(reflected => ({ rotation, reflected })))

const templateTransformsCache = new WeakMap<PathwardenRoomTemplate, readonly PathwardenTransformedTemplate[]>()

export function pathwardenTemplateTransforms(
    template: PathwardenRoomTemplate
): readonly PathwardenTransformedTemplate[] {
    let transforms = templateTransformsCache.get(template)
    if (!transforms) {
        transforms = CANONICAL_TRANSFORMS.map(transform => transformPathwardenRoomTemplate(template, transform))
        templateTransformsCache.set(template, transforms)
    }
    return transforms
}

export function transformPathwardenRoomTemplate(
    template: PathwardenRoomTemplate,
    transform: PathwardenTemplateTransform
): PathwardenTransformedTemplate {
    let cached = transformCache.get(template)
    if (!cached) {
        cached = new Map()
        transformCache.set(template, cached)
    }
    const cacheKey = transform.rotation + (transform.reflected ? 1 : 0)
    const hit = cached.get(cacheKey)
    if (hit) return hit
    const built = buildTransformedTemplate(template, transform)
    cached.set(cacheKey, built)
    return built
}

function buildTransformedTemplate(
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
