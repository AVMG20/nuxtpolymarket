import * as Sentry from '@sentry/vue'

export default defineNuxtPlugin((nuxtApp) => {
    Sentry.init({
        app: nuxtApp.vueApp,
        dsn: useRuntimeConfig().public.sentryDsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0
    })
})
