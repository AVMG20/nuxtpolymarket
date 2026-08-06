export default defineNuxtConfig({
    modules: [
        '@nuxt/eslint',
        '@nuxt/ui',
        '@sentry/nuxt/module'
    ],

    devtools: {
        enabled: true
    },

    css: ['~/assets/css/main.css'],

    runtimeConfig: {
        authSecret: process.env.BETTER_AUTH_SECRET,
        databaseUrl: process.env.DATABASE_URL,
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
        betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
        devMode: false,
        // pokemonplaatjes Rust sidecar — checklist data + card textures.
        pokemonApiBase: 'http://127.0.0.1:8080',
        public: {
            // Read by both SDKs — the browser via useRuntimeConfig(), the
            // server straight from process.env in sentry.server.config.ts.
            // PROJECT_DSN is the name Argus issues its DSNs under; either sets it.
            sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN || process.env.PROJECT_DSN || '',
            // The browser fetches card textures straight from the sidecar.
            pokemonApiBase: 'http://127.0.0.1:8080'
        }
    },
    // The casino and pirate raid are canvas-heavy, interactive experiences.
    // Serving their route shells client-only avoids SSR work and keeps their
    // game engines out of the server rendering path. Economy and account
    // pages remain SSR-enabled.
    routeRules: {
        // The auto-scaling gem market became the player-driven exchange
        '/gem-market': { redirect: '/gem-exchange' },
        '/games/**': { ssr: false },
        '/pirates/**': { ssr: false },
        '/shapezz': { ssr: false },
        '/shapezz/**': { ssr: false },
        '/pathwarden': { ssr: false },
        '/pathwarden/**': { ssr: false },
        // WebGL foil renderer + admin-only tooling — no SSR value.
        '/tcg-admin/**': { ssr: false }
    },


    // Sourcemaps are the single largest contributor to build memory here.
    // Disabling them drops the Nitro step's peak by ~0.8 GB, at the cost of
    // minified frames in Sentry stack traces.
    sourcemap: { server: false, client: false },

    compatibilityDate: '2025-01-15',

    nitro: {
        preset: 'bun',
        // Keep production output focused on warnings and errors. Nitro's
        // per-file report is useful for bundle analysis, but needlessly makes
        // routine builds noisy in this app's large server output.
        logLevel: 2,
        experimental: {
            websocket: true
        },
        serverAssets: [
            { baseName: 'changelog', dir: '../content/changelog' },
        ]
    },

    vite: {
        build: {
            // pixi.js is a WebGL engine only loaded on game pages, not the main bundle
            chunkSizeWarningLimit: 900,
            rollupOptions: {
                onwarn(warning, warn) {
                    // Both warnings originate in framework dependencies and
                    // do not affect the generated application bundles.
                    if (warning.code === 'SOURCEMAP_ERROR' && warning.plugin === 'nuxt:module-preload-polyfill') return
                    if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('@vueuse/core/')) return

                    warn(warning)
                }
            }
        },
        // Pre-bundle heavy deps that are only reached via dynamic import() or
        // client-only components. Without this, Vite discovers each one at
        // runtime the first time a page needs it, re-runs its optimizer, and
        // forces a full-page reload that re-downloads the entire dev module
        // graph (thousands of requests per reload). Listing them here bundles
        // them up front so navigation stays a normal SPA transition.
        optimizeDeps: {
            include: [
                'gsap',
                'date-fns',
                'better-auth/client',
                'better-auth/client/plugins',
                '@unovis/vue',
                'pixi.js',
                'pixi-reels'
            ]
        },
        plugins: [
            // Dev-only: some browser setups (link-prefetching extensions or
            // Chrome's "preload pages") request the client JS module graph with
            // `Sec-Fetch-Dest: document`, which Vite's dev server rejects with a
            // 404 — leaving the app unable to hydrate. Strip that header in dev
            // so the modules load normally.
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
    },

    sentry: {
        // The production runtime is Bun, which does not support Node's ESM
        // `--import` customization hooks that the SDK uses by default. A
        // top-level import in the built server entry works on any runtime; the
        // cost is shallower automatic tracing of server-side libraries.
        autoInjectServerSentry: 'top-level-import',
        // Uploading source maps also switches sourcemap generation back on,
        // which is what pushed the Nitro build over the memory limit before.
        // Leave both off — traces are minified, but the build fits.
        sourceMapsUploadOptions: { enabled: false }
    },
})
