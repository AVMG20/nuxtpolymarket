import * as Sentry from '@sentry/bun'

export default defineNitroPlugin((nitroApp) => {
    Sentry.init({
        dsn: process.env.SENTRY_DSN || 'https://76a14877f7ab4fed933e5c2034fd1750@bugsink.avmg.nl/1',
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0
    })

    nitroApp.hooks.hook('error', (error) => {
        Sentry.captureException(error)
    })
})
