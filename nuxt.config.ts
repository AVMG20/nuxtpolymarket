export default defineNuxtConfig({
    modules: [
        '@nuxt/eslint',
        '@nuxt/ui'
    ],

    devtools: {
        enabled: true
    },

    css: ['~/assets/css/main.css'],

    runtimeConfig: {
        authSecret: process.env.BETTER_AUTH_SECRET,
        databaseUrl: process.env.DATABASE_URL,
        devMode: false,
    },

    compatibilityDate: '2025-01-15',

    vite: {
        build: {
            // pixi.js is a WebGL engine only loaded on game pages, not the main bundle
            chunkSizeWarningLimit: 900
        }
    },

    nitro: {
        preset: 'bun',
        serverAssets: [
            { baseName: 'changelog', dir: '../content/changelog' }
        ]
    },

    eslint: {
        config: {
            stylistic: {
                commaDangle: 'never',
                braceStyle: '1tbs'
            }
        }
    }
})