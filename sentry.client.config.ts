import * as Sentry from '@sentry/nuxt'

const config = useRuntimeConfig()
const dsn = config.public.sentryDsn

// Error tracking must never be able to take the app down: a missing DSN, an
// unreachable Bugsink instance or a malformed URL all end here, not in a white
// screen. Transport failures after init are swallowed by the SDK itself.
if (dsn) {
    try {
        Sentry.init({
            dsn,
            environment: import.meta.env.MODE,
            tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1
        })
    } catch (error) {
        console.warn('[sentry] client init failed, continuing without error tracking', error)
    }
}
