import { NC_CANVAS_H, NC_CANVAS_W, NC_NAME_MAX } from '#shared/utils/neighcasso/types'
import type { NcDrawing, NcStroke, NcStrokeKind } from '#shared/utils/neighcasso/types'

export const NC_MAX_STROKES = 400
/** Across every stroke, counting x/y pairs. */
export const NC_MAX_POINTS = 12_000
export const NC_MIN_WIDTH = 1
export const NC_MAX_WIDTH = 60

const KINDS = new Set<NcStrokeKind>(['body', 'leg', 'tail', 'head'])
const COLOR = /^#[0-9a-f]{6}$/i

/**
 * Parse an untrusted drawing into a clean one, or return why it is rejected.
 * Points are rounded and clamped rather than refused, so a stroke dragged a
 * little off the canvas edge still saves.
 */
export function parseDrawing(input: unknown): NcDrawing | string {
    const raw = input as { strokes?: unknown } | null
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.strokes)) return 'Invalid drawing'
    if (!raw.strokes.length) return 'Draw something first'
    if (raw.strokes.length > NC_MAX_STROKES) return `Too many strokes (max ${NC_MAX_STROKES})`

    let points = 0
    const strokes: NcStroke[] = []
    for (const item of raw.strokes as unknown[]) {
        const s = item as Partial<NcStroke> | null
        if (!s || typeof s !== 'object') return 'Invalid stroke'
        const kind = KINDS.has(s.k as NcStrokeKind) ? s.k as NcStrokeKind : 'body'
        if (typeof s.c !== 'string' || !COLOR.test(s.c)) return 'Invalid colour'
        const width = Number(s.w)
        if (!Number.isFinite(width)) return 'Invalid brush size'
        if (!Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2 !== 0) return 'Invalid stroke'

        const p: number[] = []
        for (let i = 0; i < s.p.length; i += 2) {
            const x = Number(s.p[i])
            const y = Number(s.p[i + 1])
            if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Invalid stroke'
            p.push(clamp(Math.round(x), 0, NC_CANVAS_W), clamp(Math.round(y), 0, NC_CANVAS_H))
        }
        points += p.length / 2
        if (points > NC_MAX_POINTS) return 'Drawing is too detailed'
        strokes.push({
            k: kind,
            c: s.c.toLowerCase(),
            w: clamp(Math.round(width), NC_MIN_WIDTH, NC_MAX_WIDTH),
            p
        })
    }
    return { v: 1, strokes }
}

export function parseHorseName(input: unknown): string | null {
    if (typeof input !== 'string') return null
    const name = input.replace(/\s+/g, ' ').trim().slice(0, NC_NAME_MAX)
    return name || null
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}
