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

    nitro: {
        preset: 'bun',
        experimental: {
            websocket: true
        },
        serverAssets: [
            { baseName: 'changelog', dir: '../content/changelog' }
        ]
    },

    // Dev-only: some browser setups (link-prefetching extensions or Chrome's
    // "preload pages") request the client JS module graph with
    // `Sec-Fetch-Dest: document`, which Vite's dev server rejects with a 404 —
    // leaving the app unable to hydrate. Strip that header in dev so the modules
    // load normally.
    vite: {
        build: {
            // pixi.js is a WebGL engine only loaded on game pages, not the main bundle
            chunkSizeWarningLimit: 900
        },
        plugins: [
            {
                name: 'dev-strip-sec-fetch-dest',
                apply: 'serve',
                configureServer(server) {
                    server.middlewares.use((req, _res, next) => {
                        if (req.headers['sec-fetch-dest'] === 'document') {
                            delete req.headers['sec-fetch-dest']
                        }
                        next()
                    })
                }
            }
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