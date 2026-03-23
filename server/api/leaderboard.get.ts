import {desc} from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'

export default defineEventHandler(async () => {
  return db
    .select({
      id: user.id,
      name: user.name,
      balance: user.balance,
    })
    .from(user)
    .orderBy(desc(user.balance));
})
