import type { Peer } from 'crossws'
import { eq } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { gridworksPlot, user } from '#server/database/schema'
import { randomInt } from '#shared/utils/random'
import { newState, settle, type GridState, type SettleEvent } from '#shared/utils/gridworks/game'

type PlotRow = typeof gridworksPlot.$inferSelect

export function toState(row: PlotRow): GridState {
    return {
        seed: row.seed,
        entities: row.entities,
        chunks: row.chunks,
        stock: row.stock,
        done: row.researchDone,
        queue: row.researchQueue,
        progress: row.researchProgress,
        mine: row.mine,
        settledAt: row.lastSettledAt.getTime(),
        layout: row.layoutVersion,
        goals: row.goals,
        mined: row.mined
    }
}

function toRow(s: GridState) {
    return {
        entities: s.entities,
        chunks: s.chunks,
        stock: s.stock,
        researchDone: s.done,
        researchQueue: s.queue,
        researchProgress: s.progress,
        mine: s.mine,
        layoutVersion: s.layout,
        goals: s.goals,
        mined: s.mined,
        lastSettledAt: new Date(s.settledAt),
        updatedAt: new Date()
    }
}

/** Creates the player's plot on first visit. Safe under parallel calls. */
export async function ensurePlot(userId: string): Promise<void> {
    const now = Date.now()
    const s = newState(randomInt(1, 2 ** 31 - 1), now)
    await db.insert(gridworksPlot).values({
        userId,
        seed: s.seed,
        ...toRow(s)
    }).onConflictDoNothing({ target: gridworksPlot.userId })
}

export async function readPlot(userId: string, exec: DbExecutor = db): Promise<GridState | null> {
    const [row] = await exec.select().from(gridworksPlot).where(eq(gridworksPlot.userId, userId))
    return row ? toState(row) : null
}

/**
 * Lock-then-read: locks the plot row, settles it to now, hands it to `fn` to
 * mutate, then writes it back. Every value-changing action goes through here.
 */
export async function withPlot<T>(userId: string, fn: (s: GridState, now: number, events: SettleEvent[]) => T): Promise<{ state: GridState, result: T, events: SettleEvent[] }> {
    await ensurePlot(userId)
    return db.transaction(async (tx) => {
        const [row] = await tx.select().from(gridworksPlot).where(eq(gridworksPlot.userId, userId)).for('update')
        if (!row) throw createError({ statusCode: 404, statusMessage: 'No plot' })
        const s = toState(row)
        const now = Math.max(Date.now(), s.settledAt)
        const events = settle(userId, s, now)
        const result = fn(s, now, events)
        await tx.update(gridworksPlot).set(toRow(s)).where(eq(gridworksPlot.userId, userId))
        return { state: s, result, events }
    })
}

/** The plot as of now, without writing (reads never need the lock). */
export async function viewPlot(userId: string): Promise<GridState> {
    await ensurePlot(userId)
    const s = await readPlot(userId)
    if (!s) throw createError({ statusCode: 404, statusMessage: 'No plot' })
    settle(userId, s, Math.max(Date.now(), s.settledAt))
    return s
}

export interface WorldPlot {
    userId: string
    name: string
    image: string | null
    seed: number
    entities: GridState['entities']
    chunks: string[]
    done: number
    layout: number
}

/** The world list is the same for everyone, so one query serves every watcher until a plot changes. */
const WORLD_TTL_MS = 5_000
let worldCache: { at: number, plots: Promise<WorldPlot[]> } | null = null

export function worldPlots(): Promise<WorldPlot[]> {
    const hit = worldCache
    if (hit && Date.now() - hit.at < WORLD_TTL_MS) return hit.plots
    const plots = db.select({
        userId: gridworksPlot.userId,
        name: user.name,
        image: user.image,
        seed: gridworksPlot.seed,
        entities: gridworksPlot.entities,
        chunks: gridworksPlot.chunks,
        done: gridworksPlot.researchDone,
        layout: gridworksPlot.layoutVersion
    }).from(gridworksPlot).innerJoin(user, eq(user.id, gridworksPlot.userId)).orderBy(gridworksPlot.createdAt)
        .then(rows => rows.map(r => ({ ...r, done: r.done.length })))
    const entry = { at: Date.now(), plots }
    worldCache = entry
    // A failed query isn't worth remembering.
    plots.catch(() => {
        if (worldCache === entry) worldCache = null
    })
    return plots
}

// ---- live channel -------------------------------------------------------------------
// Pure invalidation: after a plot changes, every watcher hears which one and
// refetches it. Capped in total and per player, refusing new sockets past the
// cap (see town-live.ts).

const peers = new Map<Peer, string>()
const perUser = new Map<string, number>()
export const GRIDWORKS_MAX_PEERS = 2_000
/** A handful of tabs each; one account can't fill the channel. */
export const GRIDWORKS_MAX_PEERS_PER_USER = 6

export function registerGridworksPeer(peer: Peer, userId: string): boolean {
    if (peers.has(peer)) return true
    const mine = perUser.get(userId) ?? 0
    if (peers.size >= GRIDWORKS_MAX_PEERS || mine >= GRIDWORKS_MAX_PEERS_PER_USER) return false
    peers.set(peer, userId)
    perUser.set(userId, mine + 1)
    return true
}

export function unregisterGridworksPeer(peer: Peer) {
    const userId = peers.get(peer)
    if (userId === undefined) return
    peers.delete(peer)
    const left = (perUser.get(userId) ?? 1) - 1
    if (left > 0) perUser.set(userId, left)
    else perUser.delete(userId)
}

const WS_OPEN = 1

export function broadcastGridworks(userId: string, layout: number) {
    worldCache = null
    const payload = JSON.stringify({ type: 'plot', userId, layout, at: Date.now() })
    for (const peer of [...peers.keys()]) {
        // Sending to a socket that already closed doesn't throw, so check its state too.
        const state = peer.websocket.readyState
        if (state !== undefined && state !== WS_OPEN) {
            unregisterGridworksPeer(peer)
            continue
        }
        try {
            peer.send(payload)
        } catch {
            unregisterGridworksPeer(peer)
        }
    }
}
