import { useRuntimeConfig } from '#imports'
import * as Sentry from '@sentry/nuxt'

Sentry.init({
    dsn: useRuntimeConfig().public.sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0
})
