import { serverFetch } from 'nitro/app'
import { createError, getCookie, getHeader } from 'nitro/h3'
import type { H3Event } from 'nitro/h3'
import { AI_GUARD_COOKIE, parseAiGuard } from '#shared/utils/ai-guard'

// Leaf module: shared by executors, casino, and transport so none of them
// have to import each other just to forward a cookie header or an error string.

export function toolHeaders(event: H3Event) {
    return { cookie: getHeader(event, 'cookie') ?? '' }
}

interface ToolFetchInit {
    method?: string
    headers?: Record<string, string>
    body?: unknown
}

// Nitro v3 dropped `event.$fetch`. Routing through the app handler keeps these
// internal calls in-process, and the ofetch-shaped result and thrown `.data`
// keep `getErrorMessage` reporting the route's own message.
export async function toolFetch<T>(path: string, init: ToolFetchInit = {}): Promise<T> {
    const { body, headers, method } = init
    const response = await serverFetch(path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    })

    if (!response.ok) {
        const data = await response.json().catch(() => undefined)
        throw createError({ status: response.status, message: response.statusText, data })
    }

    return await response.json() as T
}

export function getAiGuard(event: H3Event) {
    return parseAiGuard(getCookie(event, AI_GUARD_COOKIE))
}

export function getErrorMessage(error: unknown) {
    if (error && typeof error === 'object') {
        const value = error as {
            statusMessage?: unknown
            message?: unknown
            data?: { statusMessage?: unknown, message?: unknown }
        }
        if (typeof value.data?.statusMessage === 'string') return value.data.statusMessage
        if (typeof value.data?.message === 'string') return value.data.message
        if (typeof value.statusMessage === 'string') return value.statusMessage
        if (typeof value.message === 'string') return value.message
    }
    return 'Unknown tool error'
}
