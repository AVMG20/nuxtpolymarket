import { requireUserId } from '#server/utils/auth'
import { ownOrders } from '#server/utils/tcg/book'

/** The caller's open buy orders, for the market page. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const rows = await ownOrders(userId)
    return rows.map(row => ({
        ...row,
        price: parseFloat(row.price),
        createdAt: row.createdAt.toISOString()
    }))
})
