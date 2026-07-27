import {
    PATHWARDEN_GENERATOR_VERSION,
    type PathwardenCardinalDirection,
    type PathwardenGridPoint,
    type PathwardenMapMetrics,
    type PathwardenMapPlan,
    type PathwardenMapRoom
} from '#shared/types/pathwarden-save'

const DEFAULT_MAP_SIZE = 59
const DEFAULT_CASTLE_CELL = 29

export interface PathwardenMapPlanOptions {
    seed: number
    realm: number
    maxDepth?: number
    generatorVersion?: number
}

export interface PathwardenSeededRandom {
    readonly state: number
    next: () => number
    integer: (minimum: number, maximum: number) => number
    pick: <T>(values: readonly T[]) => T
}

function normalizeSeed(seed: number) {
    if (!Number.isFinite(seed)) throw new Error('Pathwarden map seed must be finite')
    return Math.floor(seed) >>> 0
}

export function createPathwardenSeededRandom(seed: number): PathwardenSeededRandom {
    let state = normalizeSeed(seed)
    return {
        get state() {
            return state >>> 0
        },
        next() {
            state = state + 0x6D2B79F5 | 0
            let value = Math.imul(state ^ state >>> 15, 1 | state)
            value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
            return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
        },
        integer(minimum, maximum) {
            if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
                throw new Error('Pathwarden random integer bounds are invalid')
            }
            return minimum + Math.floor(this.next() * (maximum - minimum + 1))
        },
        pick<T>(values: readonly T[]) {
            if (!values.length) throw new Error('Cannot pick from an empty Pathwarden collection')
            return values[this.integer(0, values.length - 1)]!
        }
    }
}

const INITIAL_DIRECTIONS: readonly PathwardenCardinalDirection[] = ['north', 'east', 'south', 'west']

function move(point: PathwardenGridPoint, direction: PathwardenCardinalDirection, distance: number) {
    if (direction === 'north') return { col: point.col, row: point.row - distance }
    if (direction === 'east') return { col: point.col + distance, row: point.row }
    if (direction === 'south') return { col: point.col, row: point.row + distance }
    return { col: point.col - distance, row: point.row }
}

function castleRoom(direction: PathwardenCardinalDirection, approachLength: number): PathwardenMapRoom {
    const origin = { col: DEFAULT_CASTLE_CELL, row: DEFAULT_CASTLE_CELL }
    const gate = move(origin, direction, 2)
    const roadCells = Array.from({ length: approachLength }, (_, index) => move(gate, direction, index))
    return {
        id: 'room-castle',
        archetype: 'castle',
        depth: 0,
        origin,
        rotation: direction === 'north' ? 0 : direction === 'east' ? 90 : direction === 'south' ? 180 : 270,
        reflected: false,
        parentConnectionId: null,
        footprint: [
            { col: origin.col - 1, row: origin.row - 1 },
            { col: origin.col, row: origin.row - 1 },
            { col: origin.col + 1, row: origin.row - 1 },
            { col: origin.col - 1, row: origin.row },
            origin,
            { col: origin.col + 1, row: origin.row },
            { col: origin.col - 1, row: origin.row + 1 },
            { col: origin.col, row: origin.row + 1 },
            { col: origin.col + 1, row: origin.row + 1 },
            ...roadCells
        ],
        revealCells: [...roadCells],
        buildableCells: [],
        roadCells,
        roadLinkIds: roadCells.slice(1).map((_, index) => `road-castle-${index}`),
        featureIds: [],
        ports: [{
            id: 'port-castle-exit',
            cell: roadCells[roadCells.length - 1]!,
            direction,
            kind: 'exit'
        }]
    }
}

function initialMetrics(room: PathwardenMapRoom, maxDepth: number): PathwardenMapMetrics {
    return {
        maxDepth,
        roomCount: 1,
        roadCellCount: room.roadCells.length,
        buildableCellCount: 0,
        frontierCountByDepth: [1, ...Array.from({ length: maxDepth }, () => 0)],
        archetypeCounts: { castle: 1 },
        featureCounts: {}
    }
}

export function createPathwardenMapPlan(options: PathwardenMapPlanOptions): PathwardenMapPlan {
    const seed = normalizeSeed(options.seed)
    const realm = Math.max(1, Math.min(5, Math.floor(options.realm)))
    const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 13))
    const generatorVersion = options.generatorVersion ?? PATHWARDEN_GENERATOR_VERSION
    if (generatorVersion !== PATHWARDEN_GENERATOR_VERSION) {
        throw new Error(`Unsupported Pathwarden generator version ${generatorVersion}`)
    }

    const random = createPathwardenSeededRandom(seed)
    const direction = random.pick(INITIAL_DIRECTIONS)
    const approachLength = random.integer(3, 6)
    const castle = castleRoom(direction, approachLength)
    const roadLinks = castle.roadCells.slice(1).map((cell, index) => ({
        id: castle.roadLinkIds[index]!,
        from: castle.roadCells[index]!,
        to: cell,
        roomId: castle.id
    }))

    return {
        generatorVersion,
        seed,
        realm,
        size: { cols: DEFAULT_MAP_SIZE, rows: DEFAULT_MAP_SIZE },
        castleRoomId: castle.id,
        rooms: [castle],
        connections: [],
        roadLinks,
        features: [],
        metrics: initialMetrics(castle, maxDepth)
    }
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalize(child)])
    )
}

export function serializePathwardenMapPlan(plan: PathwardenMapPlan) {
    return JSON.stringify(canonicalize(plan))
}

export function hashPathwardenMapPlan(plan: PathwardenMapPlan) {
    const serialized = serializePathwardenMapPlan(plan)
    let hash = 0x811C9DC5
    for (let index = 0; index < serialized.length; index++) {
        hash ^= serialized.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}
