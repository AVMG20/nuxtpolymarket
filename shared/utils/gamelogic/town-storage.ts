import { TOWN_PLOT_SIZE } from './town'

/**
 * Storage: buildings a town owns but has taken off the map. A stored building
 * is kept in its own table, so nothing that reads the map can see it: it
 * produces, houses and employs nothing. It costs nothing to keep. A paused
 * construction or upgrade waits there, and needs a free crew to come back.
 */

/** One building in storage. */
export interface TownStoredBuilding {
    id: string
    type: string
    level: number
    upgradingTo: number | null
    /** Build time still owed on a paused construction or upgrade; 0 when idle. */
    remainingMs: number
    /** Epoch ms it went into storage. */
    storedAt: number
}

/** Whether a stored building is a paused job: placing it back needs a crew. */
export function townStoredIsJob(b: Pick<TownStoredBuilding, 'level' | 'upgradingTo' | 'remainingMs'>): boolean {
    return b.remainingMs > 0 && (b.level === 0 || b.upgradingTo !== null)
}

// ─── Redesign drafts ─────────────────────────────────────────────────────────

/** Where a piece was put down in a draft. */
export interface TownDraftSpot { plotId: string, tileX: number, tileY: number, rotation: number }

/**
 * A redesign saved half-way. Ids are building ids (on the map or in storage);
 * new roads are keyed by a client-side id that only has to be unique within
 * the draft. It is a plan, nothing more: reopening it is merged with the
 * town as it then stands, and the final save is checked as any other.
 */
export interface TownRedesignDraft {
    placed: Record<string, TownDraftSpot>
    newRoads: Record<string, TownDraftSpot>
    /** Buildings on the map marked to go into storage on the final save. */
    toStore: string[]
}

/** The most pieces one draft may name: generous, but a bound on what one row can hold. */
export const TOWN_DRAFT_MAX_ITEMS = 4000

function spotOf(raw: unknown): TownDraftSpot | null {
    const s = raw as Record<string, unknown> | null
    if (!s || typeof s !== 'object') return null
    const plotId = typeof s.plotId === 'string' ? s.plotId.slice(0, 64) : ''
    const tileX = Number(s.tileX)
    const tileY = Number(s.tileY)
    const rotation = Number(s.rotation ?? 0)
    if (!plotId) return null
    if (![tileX, tileY].every(n => Number.isInteger(n) && n >= 0 && n < TOWN_PLOT_SIZE)) return null
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) return null
    return { plotId, tileX, tileY, rotation }
}

const ID = /^[\w:-]{1,64}$/

/**
 * Clean a draft that came in from a client: drop anything malformed rather
 * than refuse it all, and refuse only one that is far too large. The result
 * is safe to store; whether it can be applied is decided at the final save.
 */
export function townSanitizeDraft(raw: unknown): TownRedesignDraft | null {
    const d = raw as Record<string, unknown> | null
    if (!d || typeof d !== 'object') return null
    const placed: Record<string, TownDraftSpot> = {}
    const newRoads: Record<string, TownDraftSpot> = {}
    for (const [map, out] of [[d.placed, placed], [d.newRoads, newRoads]] as const) {
        if (!map || typeof map !== 'object') continue
        for (const [id, s] of Object.entries(map as Record<string, unknown>)) {
            const spot = ID.test(id) ? spotOf(s) : null
            if (spot) out[id] = spot
        }
    }
    const toStore = Array.isArray(d.toStore)
        ? [...new Set(d.toStore.filter((id): id is string => typeof id === 'string' && ID.test(id)))]
        : []
    if (Object.keys(placed).length + Object.keys(newRoads).length + toStore.length > TOWN_DRAFT_MAX_ITEMS) return null
    return { placed, newRoads, toStore }
}
