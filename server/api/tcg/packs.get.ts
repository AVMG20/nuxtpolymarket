import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgPack, tcgBundle } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { serializePack } from '#server/utils/tcg/engine'
import type { TcgBundleSummary } from '#shared/types/tcg'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const [packs, bundles] = await Promise.all([
        db.select().from(tcgPack).where(eq(tcgPack.ownerId, userId)).orderBy(desc(tcgPack.createdAt)),
        db.select().from(tcgBundle).where(eq(tcgBundle.ownerId, userId)).orderBy(desc(tcgBundle.createdAt))
    ])

    const sealedByBundle = new Map<string, number>()
    const openedByBundle = new Map<string, number>()
    for (const pack of packs) {
        if (!pack.bundleId) continue
        const counts = pack.state === 'sealed' ? sealedByBundle : openedByBundle
        counts.set(pack.bundleId, (counts.get(pack.bundleId) ?? 0) + 1)
    }

    return {
        // serializePack default: sealed packs never leak isGod.
        packs: packs.map(pack => serializePack(pack)),
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
