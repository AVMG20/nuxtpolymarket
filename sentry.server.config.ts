import * as Sentry from '@sentry/nuxt'

// Same variable as the browser SDK: a DSN is a public credential, so there is
// no reason to carry a second copy under a server-only name.
const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN

// This file is imported at the very top of the built server entry, so a throw
// here would stop the server from booting at all. Guard it accordingly.
if (dsn) {
    try {
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV,
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1
        })
    } catch (error) {
        console.warn('[sentry] server init failed, continuing without error tracking', error)
    }
}
