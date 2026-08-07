import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy, tcgPrinting } from '#server/database/schema'
import { credit } from '#server/utils/balance'
import { lockCopyForUpdate, hasActiveListing } from '#server/utils/tcg/market'
import { vendorPrice, TCG_VENDOR } from '#shared/utils/tcg/vendor'

/*
 * The vendor buyback (§7.4). Sells are destructive and priced from the real
 * world; see shared/utils/tcg/vendor.ts for the price rule. The lifecycle
 * flip to 'destroyed' is a soft delete on purpose — submissions, listings
 * and transfer rows cascade on a hard DELETE, and history must survive the
 * card.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

interface SidecarPrice {
    price: { usd?: number | null, eur?: number | null } | null
}

/**
 * What the vendor will pay for this card, in Coins. Unreachable sidecar or
 * unpriced card both collapse to the 1-coin floor — the vendor always buys,
 * it just never pays more than the real world would.
 */
export async function fetchVendorQuote(plaatjesCardId: string, apiBase: string): Promise<number> {
    try {
        const res = await $fetch<SidecarPrice>(
            `${apiBase}/cards/${encodeURIComponent(plaatjesCardId)}/price`,
            { timeout: 5000 }
        )
        return vendorPrice(res.price?.usd, res.price?.eur)
    } catch {
        return TCG_VENDOR.fallbackPrice
    }
}

/** The copy joined with its printing's sidecar id, for pricing a quote. */
export async function copyForVendor(copyId: string) {
    const [row] = await db.select({ copy: tcgCopy, plaatjesCardId: tcgPrinting.plaatjesCardId })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .where(eq(tcgCopy.id, copyId))
    return row ?? null
}

/**
 * Sell a raw copy to the vendor: destroy it, pay `amount` Coins.
 *
 * `amount` is priced by the caller BEFORE this runs — the quote is an HTTP
 * round-trip, and the copy row lock must never be held across one. The
 * lifecycle claim raw→destroyed is the guard: a second concurrent sell, a
 * slab, a copy at the grader or in a sealed pack all find no raw row and
 * throw.
 */
export async function vendorCopy(userId: string, copyId: string, amount: number): Promise<{ amount: number }> {
    if (!Number.isFinite(amount) || amount < 1) badRequest('Bad vendor price')
    return await db.transaction(async (tx) => {
        const copy = await lockCopyForUpdate(tx, copyId)
        if (!copy || copy.ownerId !== userId) badRequest('Copy is not yours to sell')
        if (await hasActiveListing(tx, copyId)) badRequest('Copy is listed on the market')

        const [claimed] = await tx.update(tcgCopy)
            .set({ lifecycle: 'destroyed' })
            .where(and(eq(tcgCopy.id, copyId), eq(tcgCopy.lifecycle, 'raw')))
            .returning()
        if (!claimed) badRequest('The vendor only buys raw cards')

        await credit(userId, amount.toFixed(4), 'tcg:vendor', tx)
        return { amount }
    })
}
