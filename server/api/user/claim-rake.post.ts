import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const current = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { rake: true, rakebackUnlocked: true },
  })

  if (!current?.rakebackUnlocked) {
    throw createError({ statusCode: 403, statusMessage: 'Unlock rakeback claiming first' })
  }

  const rake = parseFloat(current?.rake ?? '0')
  if (rake <= 0) throw createError({ statusCode: 400, statusMessage: 'No rakeback to claim' })

  await db.update(user).set({ rake: '0' }).where(eq(user.id, userId))
  await credit(userId, rake.toFixed(4), 'rakeback')

  return { credited: rake }
})
