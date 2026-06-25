import { eq, desc, sql, count } from 'drizzle-orm'
import { db } from '#server/database'
import { hackHistory } from '#server/database/schema'
import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const [rows, totals] = await Promise.all([
    db.query.hackHistory.findMany({
      where: eq(hackHistory.userId, userId),
      orderBy: [desc(hackHistory.createdAt)],
      limit: 100,
    }),
    db
      .select({
        ops: count(),
        successes: sql<number>`count(*) filter (where ${hackHistory.success})`.mapWith(Number),
        cash: sql<number>`coalesce(sum(${hackHistory.cash}), 0)`.mapWith(Number),
        gems: sql<number>`coalesce(sum(${hackHistory.gems}), 0)`.mapWith(Number),
        items: sql<number>`count(*) filter (where ${hackHistory.itemName} is not null)`.mapWith(Number),
      })
      .from(hackHistory)
      .where(eq(hackHistory.userId, userId)),
  ])

  return {
    totals: totals[0] ?? { ops: 0, successes: 0, cash: 0, gems: 0, items: 0 },
    history: rows.map(r => ({
      id: r.id,
      templateId: r.templateId,
      success: r.success,
      cash: Number(r.cash),
      gems: r.gems,
      itemName: r.itemName,
      itemRarity: r.itemRarity,
      agentCount: r.agentCount,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    })),
  }
})
