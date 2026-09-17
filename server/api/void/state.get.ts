import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, voidState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { describeVoidState, ensureVoidState, grantVoidStarterKit, listVoidItems } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await ensureVoidState(userId)
    await grantVoidStarterKit(userId)
    const [state, balance, account, items] = await Promise.all([
        db.query.voidState.findFirst({ where: eq(voidState.userId, userId) }),
        getBalance(userId),
        db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
        listVoidItems(db, userId)
    ])
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Void state not initialized' })
    return describeVoidState(state, Number(balance), account?.gems ?? 0, items)
})
