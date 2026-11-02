import { defineConfig } from 'vitest/config'
import { globSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'

// vi.mock only reaches modules imported after it, and in a shared worker an earlier
// file may already have loaded the real one: files that mock run isolated instead.
const mocking = globSync('test/**/*.spec.ts').filter(file => readFileSync(file, 'utf8').includes('vi.mock('))

// Every worker opens its own pool, and the app's default of 30 connections times a
// worker per core blows past Postgres's 100 on any machine with more than three cores
// ("sorry, too many clients already"). Split a budget of 80 across the workers.
const poolMax = process.env.DATABASE_POOL_MAX ?? String(Math.max(4, Math.min(30, Math.floor(80 / availableParallelism()))))

export default defineConfig({
    test: {
        env: { DATABASE_POOL_MAX: poolMax },
        setupFiles: ['test/setup/nitro-globals.ts', 'test/setup/shared-worker.ts'],
        unstubGlobals: true,
        projects: [
            {
                extends: true,
                test: {
                    name: 'shared',
                    include: ['test/**/*.spec.ts'],
                    exclude: mocking,
                    // one module graph per worker instead of per file: most of a run was each of
                    // ~300 files re-importing the server and schema (see test/setup/shared-worker.ts)
                    pool: 'threads',
                    isolate: false
                }
            },
            {
                extends: true,
                test: {
                    name: 'isolated',
                    include: mocking
                }
            }
        ]
    },
    resolve: {
        alias: {
            '#shared': resolve(import.meta.dirname, 'shared'),
            '#server': resolve(import.meta.dirname, 'server')
        }
    }
})
