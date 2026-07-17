import { asc } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Lightweight user list for @mention autocomplete.
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(asc(user.name))
    .limit(200)
})
