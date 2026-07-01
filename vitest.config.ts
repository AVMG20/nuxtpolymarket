import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts']
    },
    resolve: {
        alias: {
            '#shared': resolve(import.meta.dirname, 'shared')
        }
    }
})
