import { desc, eq, getTableColumns } from 'drizzle-orm'
import { db } from '#server/database'
import { voidRunHistory } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    // The audit blob stays on the server: the pilot's history only needs the headline numbers.
    const { meta: _meta, ...columns } = getTableColumns(voidRunHistory)
    return db.select(columns).from(voidRunHistory)
        .where(eq(voidRunHistory.userId, userId))
        .orderBy(desc(voidRunHistory.createdAt))
        .limit(20)
})
