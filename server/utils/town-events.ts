import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { townEvents } from '#server/database/schema'
import { TOWN_EVENTS_KEEP_MS, TOWN_EVENTS_MAX_PAGE, TOWN_EVENTS_PAGE, type TownEvent, type TownEventData } from '#shared/utils/gamelogic/town-events'

/**
 * Write one notification. `at` is when the thing happened — a settle that
 * banks a build finished hours ago passes the completion time, so the list
 * reads in the order events occurred rather than the order we noticed them.
 */
export async function recordTownEvent(tx: DbExecutor, userId: string, data: TownEventData, at = Date.now()) {
    await tx.insert(townEvents).values({ userId, kind: data.kind, data, createdAt: new Date(at) })
}

/** Drop what nobody will scroll back to. Cheap on the (user, created_at) index. */
export async function pruneTownEvents(tx: DbExecutor, userId: string, now = Date.now()) {
    await tx.delete(townEvents).where(and(eq(townEvents.userId, userId), lt(townEvents.createdAt, new Date(now - TOWN_EVENTS_KEEP_MS))))
}

/**
 * One page, newest first. `before` is the id of the last event the caller
 * has; the page continues past it. `limit` is capped: an open list reloads
 * everything it shows in one request rather than page by page.
 *
 * The cursor compares (created_at, id) as a row in SQL rather than a Date
 * from JS, because a JS Date only carries milliseconds and would skip or
 * repeat rows written in the same one.
 */
export async function listTownEvents(userId: string, before: string | null, limit = TOWN_EVENTS_PAGE): Promise<{ events: TownEvent[], more: boolean }> {
    limit = Math.min(TOWN_EVENTS_MAX_PAGE, Math.max(1, Math.floor(limit)))
    const rows = await db.select({ id: townEvents.id, data: townEvents.data, createdAt: townEvents.createdAt })
        .from(townEvents)
        .where(and(
            eq(townEvents.userId, userId),
            before
                ? sql`(${townEvents.createdAt}, ${townEvents.id}) < (select ${townEvents.createdAt}, ${townEvents.id} from ${townEvents} where ${townEvents.id} = ${before} and ${townEvents.userId} = ${userId})`
                : undefined
        ))
        .orderBy(desc(townEvents.createdAt), desc(townEvents.id))
        .limit(limit + 1)
    const page = rows.slice(0, limit)
    return {
        events: page.map(r => ({ id: r.id, data: r.data, at: r.createdAt.getTime() })),
        more: rows.length > limit
    }
}
