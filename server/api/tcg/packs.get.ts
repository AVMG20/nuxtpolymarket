import { and, asc, count, desc, eq, isNotNull, isNull, max, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgPack, tcgBundle } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { serializePack } from '#server/utils/tcg/engine'
import type { TcgBundleSummary, TcgOpenedPackSummary } from '#shared/types/tcg'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    // Opened packs only come back as per-set totals: a long-time player has
    // thousands, and the page shows nothing per opened pack.
    const [sealed, opened, bundleCounts, bundles] = await Promise.all([
        db.select().from(tcgPack)
            .where(and(eq(tcgPack.ownerId, userId), eq(tcgPack.state, 'sealed')))
            .orderBy(asc(tcgPack.packIndex)),
        db.select({
            setId: tcgPack.setId,
            count: count(),
            godCount: sql<number>`count(*) filter (where ${tcgPack.isGod})`.mapWith(Number),
            lastOpenedAt: max(tcgPack.openedAt)
        }).from(tcgPack)
            .where(and(eq(tcgPack.ownerId, userId), eq(tcgPack.state, 'opened'), isNull(tcgPack.bundleId)))
            .groupBy(tcgPack.setId),
        db.select({ bundleId: tcgPack.bundleId, state: tcgPack.state, count: count() }).from(tcgPack)
            .where(and(eq(tcgPack.ownerId, userId), isNotNull(tcgPack.bundleId)))
            .groupBy(tcgPack.bundleId, tcgPack.state),
        db.select().from(tcgBundle).where(eq(tcgBundle.ownerId, userId)).orderBy(desc(tcgBundle.createdAt))
    ])

    const sealedByBundle = new Map<string, number>()
    const openedByBundle = new Map<string, number>()
    for (const row of bundleCounts) {
        const counts = row.state === 'sealed' ? sealedByBundle : openedByBundle
        counts.set(row.bundleId!, row.count)
    }

    return {
        // serializePack default: sealed packs never leak isGod.
        packs: sealed.map(pack => serializePack(pack)),
        opened: opened
            .map((row): TcgOpenedPackSummary => ({
                setId: row.setId,
                count: row.count,
                godCount: row.godCount,
                lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null
            }))
            .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')),
        bundles: bundles.map((bundle): TcgBundleSummary => ({
            id: bundle.id,
            setId: bundle.setId,
            weekKey: bundle.weekKey,
            createdAt: bundle.createdAt.toISOString(),
            sealedCount: sealedByBundle.get(bundle.id) ?? 0,
            openedCount: openedByBundle.get(bundle.id) ?? 0
        }))
    }
})
