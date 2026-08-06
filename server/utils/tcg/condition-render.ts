/**
 * Lossy condition → render-spec derivation (§6.2 / §6.3).
 *
 * The client never sees a copy's raw condition. It sees only the TcgWearSpec
 * derived here: a deliberately lossy channel where marginal flaws vanish or
 * blur together while large ones always survive. Everything is deterministic
 * per copy — hash-based, computed at request time, no stored randomness — so
 * the same card always looks identical, on every client, forever (§6.2).
 */
import type { TcgCondition } from '#shared/utils/tcg/grading-model-types'
import type { TcgWearSpec } from '#shared/types/tcg'
import { TCG_CENTERING } from '#shared/utils/tcg/condition'

/**
 * §6.3: the lossiness is a playtest parameter, not a designed constant.
 * Every tunable of the lossy channel lives here — move these, nothing else.
 */
export const LOSSINESS = {
    /** Base visibility threshold on severityRaw — flaws below this never render. */
    baseThreshold: 0.06,
    /** Per-site random extra threshold, so the cutoff differs per copy+site. */
    thresholdJitter: 0.08,
    /** Severity quantization step — distinct raw values collapse into bands. */
    quantum: 0.12,
    /** Floor for any severity that does render (never emit an invisible flaw). */
    minVisible: 0.05,
    /** severityRaw above this always renders — the render must never contradict the grade (§6.3). */
    alwaysVisibleAbove: 0.35,
    /** Centering ceiling + curve live in shared TCG_CENTERING so the admin
     *  wear harness can mirror the real range exactly. */
    maxCenterOffset: TCG_CENTERING.maxOffset,
    centerCurve: TCG_CENTERING.curve
}

/** Map a site value (6.3..10) onto raw severity 0..1. */
const SEVERITY_SPAN = 3.7

const clamp = (x: number, lo: number, hi: number): number => x < lo ? lo : x > hi ? hi : x

/** FNV-1a over NUL-separated parts, finished with a murmur3-style mixer. */
export function hash32(...parts: string[]): number {
    let h = 0x811c9dc5
    for (const part of parts) {
        for (let i = 0; i < part.length; i++) {
            h ^= part.charCodeAt(i)
            h = Math.imul(h, 0x01000193)
        }
        h ^= 0x1f // separator byte so ('ab', 'c') ≠ ('a', 'bc')
        h = Math.imul(h, 0x01000193)
    }
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
}

/** Deterministic [0, 1) from the same hash. */
function hash01(...parts: string[]): number {
    return hash32(...parts) / 0x100000000
}

/**
 * The lossy severity channel (§6.3). Returns null when the flaw does not
 * render at all. Visibility threshold + quantization together mean a 9 and a
 * 10 mostly vanish or render identically, a 4 and an 8 are unmistakable, and
 * anything above `alwaysVisibleAbove` bypasses the threshold entirely so the
 * render never contradicts the grade.
 */
function lossySeverity(copyId: string, siteId: string, value: number): number | null {
    const severityRaw = clamp((10 - value) / SEVERITY_SPAN, 0, 1)
    if (severityRaw <= 0) return null
    if (severityRaw <= LOSSINESS.alwaysVisibleAbove) {
        const threshold = LOSSINESS.baseThreshold
            + hash01(copyId, siteId, 'thresh') * LOSSINESS.thresholdJitter
        if (severityRaw <= threshold) return null
    }
    const q = LOSSINESS.quantum
    const jitter = (hash01(copyId, siteId, 'quant') * 2 - 1) * q * 0.4
    return clamp(Math.round(severityRaw / q) * q + jitter, LOSSINESS.minVisible, 1)
}

const CORNERS = new Set(['tl', 'tr', 'bl', 'br'])
const EDGES = new Set(['top', 'right', 'bottom', 'left'])
const SURFACE_TYPES = new Set(['scratch', 'print_line', 'dimple', 'gloss_loss'])

/**
 * Derive the client-facing wear spec from a copy's raw condition.
 *
 * Front face only this slice: corner/edge sites ending `_f`, surface entries
 * with `surface_f_` ids. Pure and deterministic — same inputs, identical
 * spec, forever. Only flaws that survive the lossy filter appear; an absent
 * entry means nothing to render.
 */
export function deriveWearSpec(copyId: string, condition: TcgCondition): TcgWearSpec {
    // Centering is EXACT — the one objectively measurable thing (§6.2). Only
    // the direction is procedural; the magnitude carries subs[0] undistorted.
    // The magnitude carries subs[0] undistorted through a fixed monotonic
    // curve — still exact (invertible), but supralinear so realistic rolls
    // land in a visible range instead of a couple of pixels.
    const centerSev = clamp((10 - condition.subs[0]!) / SEVERITY_SPAN, 0, 1)
    const magnitude = Math.pow(centerSev, LOSSINESS.centerCurve) * LOSSINESS.maxCenterOffset
    const direction = hash01(copyId, 'centdir') * 2 * Math.PI

    const corners: TcgWearSpec['corners'] = []
    const edges: TcgWearSpec['edges'] = []
    for (const site of condition.sites) {
        const [kind, part, face] = site.id.split('_')
        if (face !== 'f') continue
        const severity = lossySeverity(copyId, site.id, site.value)
        if (severity === null) continue
        const seed = hash32(copyId, site.id)
        if (kind === 'corner' && CORNERS.has(part!)) {
            corners.push({ corner: part as 'tl' | 'tr' | 'bl' | 'br', severity, seed })
        } else if (kind === 'edge' && EDGES.has(part!)) {
            edges.push({ edge: part as 'top' | 'right' | 'bottom' | 'left', severity, seed })
        }
    }

    const surface: TcgWearSpec['surface'] = []
    for (const defect of condition.surface) {
        if (!defect.id.startsWith('surface_f_')) continue
        if (!SURFACE_TYPES.has(defect.type)) continue
        const severity = lossySeverity(copyId, defect.id, defect.value)
        if (severity === null) continue
        surface.push({
            x: defect.x,
            y: defect.y,
            angle: defect.angle,
            type: defect.type as 'scratch' | 'print_line' | 'dimple' | 'gloss_loss',
            severity,
            seed: hash32(copyId, defect.id)
        })
    }

    return {
        centering: { dx: magnitude * Math.cos(direction), dy: magnitude * Math.sin(direction) },
        corners,
        edges,
        surface
    }
}
