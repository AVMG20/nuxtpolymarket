import { and, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { userNavLayout } from '#server/database/schema'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import { normalizeNavLayout, type NavLayout } from '#shared/utils/nav-layout'

export interface StoredNavLayout {
    layout: NavLayout | null
    revision: number
}

/** The player's layout (null = default) and its revision; no row is revision 0. */
export async function readNavLayout(userId: string): Promise<StoredNavLayout> {
    const [row] = await db
        .select({ layout: userNavLayout.layout, revision: userNavLayout.revision })
        .from(userNavLayout)
        .where(eq(userNavLayout.userId, userId))
    // Older rows hold a version 1 layout; normalising converts them on read
    return { layout: row ? normalizeNavLayout(row.layout, NAV_CATALOG) : null, revision: row?.revision ?? 0 }
}

/**
 * Stores a normalised layout when `base` is still the stored revision and
 * returns the new revision, or null when someone saved in between. Integer
 * compare-and-swap: the update itself is the guard, so of two saves from the
 * same revision only one lands.
 */
export async function saveNavLayout(userId: string, layout: NavLayout, base: number): Promise<number | null> {
    const [updated] = await db
        .update(userNavLayout)
        .set({ layout, revision: sql`${userNavLayout.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(userNavLayout.userId, userId), eq(userNavLayout.revision, base)))
        .returning({ revision: userNavLayout.revision })
    if (updated) return updated.revision
    if (base !== 0) return null
    const [inserted] = await db
        .insert(userNavLayout)
        .values({ userId, layout, revision: 1 })
        .onConflictDoNothing({ target: userNavLayout.userId })
        .returning({ revision: userNavLayout.revision })
    return inserted?.revision ?? null
}

/** Back to the default layout. The row stays (holding a JSON null) so the
 *  revision keeps counting up and a stale tab can't save over the reset. */
export async function resetNavLayout(userId: string): Promise<number> {
    const [row] = await db
        .update(userNavLayout)
        .set({ layout: sql`'null'::jsonb`, revision: sql`${userNavLayout.revision} + 1`, updatedAt: new Date() })
        .where(eq(userNavLayout.userId, userId))
        .returning({ revision: userNavLayout.revision })
    return row?.revision ?? 0
}
