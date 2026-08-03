/**
 * End-to-end check that error reports actually reach the ingest endpoint.
 *
 * Both SDK inits swallow transport failures on purpose, so from inside the app
 * a silently broken Sentry looks exactly like a healthy one. This posts an
 * envelope itself and prints the HTTP status, then repeats the trip through the
 * real SDK so a misconfigured init shows up too.
 *
 *   bun scripts/sentry-check.ts
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN || process.env.PROJECT_DSN
if (!dsn) {
    console.error('No DSN set. Put PROJECT_DSN (or NUXT_PUBLIC_SENTRY_DSN) in .env.')
    process.exit(1)
}

const url = new URL(dsn)
const segments = url.pathname.split('/').filter(Boolean)
const projectId = segments.pop()
const prefix = segments.length ? `/${segments.join('/')}` : ''
const endpoint = `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`

console.log(`ingest   ${endpoint}`)
console.log(`project  ${projectId}`)
console.log(`key      ${url.username.slice(0, 6)}…\n`)

const eventId = randomUUID().replace(/-/g, '')
const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: process.env.NODE_ENV || 'development',
    server_name: hostname(),
    logger: 'sentry-check',
    tags: { check: 'raw-envelope' },
    exception: {
        values: [{
            type: 'SentryCheck',
            value: `Deliberate test event from ${hostname()} — delivery check, not a real fault`
        }]
    }
}

const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event)
].join('\n')

const started = Date.now()
let rawOk = false
try {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_client=polynux-check/1.0, sentry_key=${url.username}`
        },
        body,
        signal: AbortSignal.timeout(10_000)
    })
    const text = await res.text()
    rawOk = res.ok
    console.log(`raw envelope   ${res.ok ? 'ACCEPTED' : 'REJECTED'}  http ${res.status}  ${Date.now() - started}ms`)
    console.log(`               event ${eventId}`)
    if (text.trim()) console.log(`               ${text.trim().slice(0, 300)}`)
} catch (error) {
    console.log(`raw envelope   UNREACHABLE  ${(error as Error).message}`)
}

// The SDK trip catches what the raw POST cannot: a DSN the SDK refuses to
// parse, or an init that never produced a client.
let sdkOk = false
try {
    const Sentry = await import('@sentry/node')
    Sentry.init({ dsn, environment: process.env.NODE_ENV || 'development', tracesSampleRate: 0 })
    Sentry.captureException(
        new Error(`Deliberate test event from ${hostname()} — SDK delivery check, not a real fault`)
    )
    sdkOk = await Sentry.flush(10_000)
    console.log(`\nsdk transport  ${sdkOk ? 'FLUSHED' : 'FLUSH TIMED OUT'}`)
} catch (error) {
    console.log(`\nsdk transport  FAILED  ${(error as Error).message}`)
}

console.log(`\n${rawOk && sdkOk ? 'Sentry is receiving. Check the issue stream for "SentryCheck".' : 'Sentry is NOT receiving — errors from this app are being dropped.'}`)
process.exit(rawOk && sdkOk ? 0 : 1)
