import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

// node-postgres defaults to ten connections, which a single page of this site
// can hold on its own: one request may take a settle transaction and two reads
// at the same time. Size the pool for the request concurrency we actually
// expect, and give a stuck connection a deadline rather than the pool.
export const db = drizzle({
    connection: {
        connectionString: process.env.DATABASE_URL!,
        max: Number(process.env.DATABASE_POOL_MAX ?? 30),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000
    },
    schema
})

// Anything that can run a statement: the pool, or an open transaction. Callers
// that already hold a row lock MUST pass their `tx` — issuing the write on a
// second pool connection would deadlock against the lock they're holding.
export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'query' | 'execute'>
