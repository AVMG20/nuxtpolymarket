import { eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { caravanState as caravanStateTable } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { advance } from '#shared/utils/caravan/sim'
import { createInitialState, migrateState } from '#shared/utils/caravan/state'
import { generateWorld } from '#shared/utils/caravan/world'
import type { CaravanState, SimEvent, World } from '#shared/utils/caravan/types'

/**
 * Server side of the caravan game.
 *
 * Every endpoint funnels through `withCaravan`: it locks the player's row, fast
 * forwards the simulation from `lastTick` to now, hands the caught-up state to
 * the caller's mutation, then writes the result back and pays out whatever coins
 * the simulation earned. Because the catch-up happens inside the lock, a burst
 * of concurrent requests cannot each advance the same stretch of time.
 */

let cachedWorld: World | null = null

/** The world is deterministic and identical for everyone, so build it once. */
export function getWorld(): World {
    if (!cachedWorld) cachedWorld = generateWorld()
    return cachedWorld
}

export interface CaravanContext {
    state: CaravanState
    world: World
    events: SimEvent[]
    truncated: boolean
}

/**
 * Load, lock, catch up, mutate, save. `mutate` may throw to abort the whole
 * transaction, which leaves the caught-up state unsaved -- harmless, since the
 * next request recomputes it from the same `lastTick`.
 */
export async function withCaravan<T>(
    userId: string,
    mutate: (ctx: CaravanContext, tx: DbExecutor) => Promise<T> | T
): Promise<{ result: T, ctx: CaravanContext }> {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const world = getWorld()

        // FOR UPDATE, so the catch-up and the mutation are one atomic unit.
        const [row] = await tx
            .select()
            .from(caravanStateTable)
            .where(eq(caravanStateTable.userId, userId))
            .for('update')

        let state: CaravanState
        if (!row) {
            state = createInitialState(userId, now)
            await tx.insert(caravanStateTable).values({
                userId,
                data: state,
                lastTick: now,
                revision: 0
            })
        } else {
            state = migrateState(row.data, userId, now)
        }

        const { events, truncated } = advance(state, world, now)
        const ctx: CaravanContext = { state, world, events, truncated }

        const result = await mutate(ctx, tx)

        // Coins the simulation earned -- camp spoils, these days -- are held in
        // the blob until save time, so one payout cannot be credited twice by two
        // racing catch-ups.
        const earned = state.pendingCoins
        if (earned >= 0.01) {
            state.pendingCoins = 0
            await credit(userId, earned.toFixed(4), 'game:caravan', tx)
        } else {
            state.pendingCoins = 0
        }

        // Gem seams pay a fraction of a gem per delivery, so the remainder stays
        // in the blob and only whole gems are ever credited.
        const wholeGems = Math.floor(state.pendingGems ?? 0)
        if (wholeGems > 0) {
            state.pendingGems -= wholeGems
            await creditGems(userId, wholeGems, tx)
        }

        await tx
            .update(caravanStateTable)
            .set({
                data: state,
                lastTick: state.lastTick,
                revision: sql`${caravanStateTable.revision} + 1`,
                updatedAt: new Date()
            })
            .where(eq(caravanStateTable.userId, userId))

        return { result, ctx }
    })
}

/** Read-only view. Still advances and saves -- reading the world moves it. */
export async function readCaravan(userId: string): Promise<CaravanContext> {
    const { ctx } = await withCaravan(userId, () => null)
    return ctx
}

/**
 * What every caravan endpoint returns. The world map itself is never sent -- it
 * is generated from a fixed seed, so the client builds an identical copy on its
 * own and we only ship the ~10 KB of state that actually changes.
 */
export function caravanResponse(ctx: CaravanContext) {
    return {
        state: ctx.state,
        events: ctx.events,
        truncated: ctx.truncated,
        serverTime: Date.now()
    }
}
