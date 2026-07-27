import { appendResponseHeader, createError, getRequestHost } from 'h3'
import { auth } from '#server/utils/auth'

const DEV_EMAIL = 'pathwarden-dev@localhost.test'
const DEV_PASSWORD = 'pathwarden-dev-only-password-2026'
const DEV_NAME = 'Pathwarden Dev'

function copyAuthHeaders(event: Parameters<typeof appendResponseHeader>[0], headers: Headers | undefined) {
    if (!headers) return
    const cookies = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : headers.get('set-cookie')
            ? [headers.get('set-cookie')!]
            : []
    for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie)
}

export default defineEventHandler(async (event) => {
    if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const requestHost = getRequestHost(event) ?? ''
    const host = requestHost === '::1' ? requestHost : requestHost.split(':')[0] ?? ''
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const signInBody = {
        email: DEV_EMAIL,
        password: DEV_PASSWORD,
        callbackURL: '/'
    }
    let result
    try {
        result = await auth.api.signUpEmail({
            body: {
                ...signInBody,
                name: DEV_NAME
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
    return { ok: true, email: DEV_EMAIL }
})
