import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

export const db = drizzle(process.env.DATABASE_URL!, { schema })

// Anything that can run a statement: the pool, or an open transaction. Callers
// that already hold a row lock MUST pass their `tx` — issuing the write on a
// second pool connection would deadlock against the lock they're holding.
export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'query' | 'execute'>
