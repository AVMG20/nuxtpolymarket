// Nitro auto-imports these at runtime; vitest doesn't, so server/ modules under
// test would hit a ReferenceError without them.
import { resolve } from 'node:path'
import { createError } from 'h3'

Object.assign(globalThis, { createError })

// loadEnvFile never overrides vars already in process.env, so CI's own
// DATABASE_URL wins over anything in .env — same contract as the old parser.
try {
    process.loadEnvFile(resolve(import.meta.dirname, '../../.env'))
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}
