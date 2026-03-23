import {desc} from 'drizzle-orm'
import {db} from '../database'
import {user} from '../database/schema'

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
