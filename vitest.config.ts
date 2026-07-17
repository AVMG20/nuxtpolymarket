import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        setupFiles: ['test/setup/nitro-globals.ts']
    },
    resolve: {
        alias: {
            '#shared': resolve(import.meta.dirname, 'shared'),
            '#server': resolve(import.meta.dirname, 'server')
        }
    }
})
