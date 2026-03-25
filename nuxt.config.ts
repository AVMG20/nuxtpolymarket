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
        databaseUrl: process.env.DATABASE_URL
    },

    compatibilityDate: '2025-01-15',

    nitro: {
        preset: 'bun',
        // Force these modules into the server bundle so they're
        // available at runtime in production
        externals: {
            inline: [/^@emotion/, /^@unovis/]
        }
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