import type { H3Event } from 'h3'

// Leaf module: shared by executors, casino, and transport so none of them
// have to import each other just to forward a cookie header or an error string.

export function toolHeaders(event: H3Event) {
    return { cookie: getHeader(event, 'cookie') ?? '' }
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
