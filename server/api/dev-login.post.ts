import { createHash } from 'node:crypto'
import { appendResponseHeader, createError, getRequestHost } from 'h3'
import type { H3Event } from 'h3'
import { auth } from '#server/utils/auth'

const DEV_PASSWORD = 'pathwarden-dev-only-password-2026'

function copyAuthHeaders(event: Parameters<typeof appendResponseHeader>[0], headers: Headers | undefined) {
    if (!headers) return
    const cookies = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : headers.get('set-cookie')
            ? [headers.get('set-cookie')!]
            : []
    for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie)
}

function isDevelopmentHost(host: string) {
    if (['localhost', '127.0.0.1', '::1'].includes(host)) return true
    const octets = host.split('.').map(Number)
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
    return octets[0] === 10
        || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
        || (octets[0] === 192 && octets[1] === 168)
}

function developmentHost(event: H3Event) {
    const requestHost = (getRequestHost(event) ?? '').trim().toLowerCase()

    // Node formats an IPv6 host with a port as `[::1]:3000`, while some
    // adapters pass the bare address through. Normalize both forms before
    // applying the development-only host check.
    if (requestHost.startsWith('[')) {
        const closingBracket = requestHost.indexOf(']')
        return closingBracket === -1 ? requestHost : requestHost.slice(1, closingBracket)
    }
    if (requestHost === '::1') return requestHost

    const lastColon = requestHost.lastIndexOf(':')
    if (lastColon !== -1 && /^\d+$/.test(requestHost.slice(lastColon + 1))) {
        return requestHost.slice(0, lastColon)
    }
    return requestHost
}

function requestIp(event: H3Event) {
    const address = event.node.req.socket.remoteAddress ?? 'unknown'
    const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
    // localhost, 127.0.0.1, and ::1 must share one development account. A
    // browser can switch between these names during redirects or prefetches.
    if (normalized === '127.0.0.1' || normalized === '::1') return 'loopback'
    return normalized
}

function devIdentity(ip: string) {
    const suffix = createHash('sha256').update(ip).digest('hex').slice(0, 16)
    return {
        email: `pathwarden-dev-${suffix}@localhost.test`,
        name: `Dev ${suffix}`
    }
}

export default defineEventHandler(async (event) => {
    if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const host = developmentHost(event)
    if (!isDevelopmentHost(host)) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const identity = devIdentity(requestIp(event))
    const signInBody = {
        email: identity.email,
        password: DEV_PASSWORD,
        callbackURL: '/'
    }
    let result
    try {
        result = await auth.api.signUpEmail({
            body: {
                ...signInBody,
                name: identity.name
            },
            headers: event.headers,
            returnHeaders: true,
            returnStatus: true
        })
    } catch {
        result = undefined
    }
    if (!result || (result.status !== undefined && result.status >= 400)) {
        result = await auth.api.signInEmail({
            body: signInBody,
            headers: event.headers,
            returnHeaders: true,
            returnStatus: true
        })
    }
    if (result.status !== undefined && result.status >= 400) {
        throw createError({ statusCode: result.status, statusMessage: 'Development login failed' })
    }
    copyAuthHeaders(event, result.headers)
    return { ok: true, email: identity.email }
})
