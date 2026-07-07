import { asc } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'

// Lightweight user list for @mention autocomplete.
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(asc(user.name))
    .limit(200)
})
