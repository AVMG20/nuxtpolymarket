import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        // one module graph per worker instead of per file: most of a run was each of
        // ~300 files re-importing the server and schema (see test/setup/shared-worker.ts)
        pool: 'threads',
        isolate: false,
        unstubGlobals: true,
        setupFiles: ['test/setup/nitro-globals.ts', 'test/setup/shared-worker.ts']
    },
    resolve: {
        alias: {
            '#shared': resolve(import.meta.dirname, 'shared'),
            '#server': resolve(import.meta.dirname, 'server')
        }
    }
})
