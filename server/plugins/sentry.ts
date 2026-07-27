import * as Sentry from '@sentry/nuxt'

// In a production build the SDK is initialised by a top-level import injected
// into the server entry, long before this plugin runs. `nuxt dev` has no such
// entry — the SDK expects a `--import` preload there, which Bun does not do —
// so server-side errors went unreported in development. Initialising here as a
// fallback covers dev; the guard keeps production on the earlier, deeper
// instrumentation instead of initialising twice.
export default defineNitroPlugin(async () => {
    if (Sentry.getClient()) return

    try {
        await import('../../sentry.server.config')
    } catch (error) {
        console.warn('[sentry] server init failed, continuing without error tracking', error)
    }
})
