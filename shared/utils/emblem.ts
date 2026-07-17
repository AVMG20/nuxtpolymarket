export const EMBLEM_VERSION = 1
export const EMBLEM_MAX_ELEMENTS = 80
export const EMBLEM_MAX_POINTS_PER_STROKE = 120
export const EMBLEM_MAX_SERIALIZED_LENGTH = 30_000

export const EMBLEM_SHAPES = ['circle', 'square', 'triangle', 'star'] as const

export type EmblemShape = typeof EMBLEM_SHAPES[number]
export type EmblemPoint = [number, number]

export interface EmblemStroke {
    kind: 'stroke'
    color: string
    width: number
    points: EmblemPoint[]
}

export interface EmblemPlacedShape {
    kind: 'shape'
    shape: EmblemShape
    color: string
    x: number
    y: number
    size: number
    rotation: number
}

export type EmblemElement = EmblemStroke | EmblemPlacedShape

export interface EmblemData {
    version: typeof EMBLEM_VERSION
    background: string
    elements: EmblemElement[]
}

const COLOR_RE = /^#[0-9a-f]{6}$/i

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function inRange(value: unknown, min: number, max: number): value is number {
    return isFiniteNumber(value) && value >= min && value <= max
}

function isColor(value: unknown): value is string {
    return typeof value === 'string' && COLOR_RE.test(value)
}

function isPoint(value: unknown): value is EmblemPoint {
    return Array.isArray(value)
        && value.length === 2
        && inRange(value[0], 0, 100)
        && inRange(value[1], 0, 100)
}

function isElement(value: unknown): value is EmblemElement {
    if (!value || typeof value !== 'object') return false
    const element = value as Record<string, unknown>

    if (element.kind === 'stroke') {
        return isColor(element.color)
            && inRange(element.width, 1, 18)
            && Array.isArray(element.points)
            && element.points.length >= 1
            && element.points.length <= EMBLEM_MAX_POINTS_PER_STROKE
            && element.points.every(isPoint)
    }

    if (element.kind === 'shape') {
        return typeof element.shape === 'string'
            && EMBLEM_SHAPES.includes(element.shape as EmblemShape)
            && isColor(element.color)
            && inRange(element.x, 0, 100)
            && inRange(element.y, 0, 100)
            && inRange(element.size, 4, 80)
            && inRange(element.rotation, -180, 180)
    }

    return false
}

export function parseEmblem(value: unknown): EmblemData | null {
    if (typeof value === 'string') {
        if (!value || value.length > EMBLEM_MAX_SERIALIZED_LENGTH) return null
        try {
            return parseEmblem(JSON.parse(value))
        } catch {
            return null
        }
    }

    if (!value || typeof value !== 'object') return null
    const emblem = value as Record<string, unknown>
    if (emblem.version !== EMBLEM_VERSION || !isColor(emblem.background)) return null
    if (!Array.isArray(emblem.elements) || emblem.elements.length > EMBLEM_MAX_ELEMENTS) return null
    if (!emblem.elements.every(isElement)) return null

    const result = emblem as unknown as EmblemData
    return JSON.stringify(result).length <= EMBLEM_MAX_SERIALIZED_LENGTH ? result : null
}

export function serializeEmblem(value: unknown): string | null {
    const emblem = parseEmblem(value)
    return emblem ? JSON.stringify(emblem) : null
}
