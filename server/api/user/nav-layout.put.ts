import { auth } from '#server/utils/auth'
import { readNavLayout, saveNavLayout } from '#server/utils/nav-layout'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import { normalizeNavLayout } from '#shared/utils/nav-layout'

const MAX_BODY_BYTES = 32_000

/**
 * Saves the caller's sidebar. The body names the revision the edit started
 * from; when another tab or device saved since, it answers 409 with the
 * stored layout so the client can replay its edits on top of it.
 */
export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const userId = session.user.id

    // Measured on the bytes read, so a chunked or lying content-length can't slip past
    const raw = await readRawBody(event, false)
    if (raw && raw.byteLength > MAX_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'Layout too large' })
    let body: { layout?: unknown, revision?: unknown } | null
    try {
        body = raw ? JSON.parse(raw.toString('utf8')) : null
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid layout' })
    }

    const layout = normalizeNavLayout(body?.layout, NAV_CATALOG)
    const base = body?.revision
    if (!layout || typeof base !== 'number' || !Number.isSafeInteger(base) || base < 0) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid layout' })
    }

    let revision: number | null
    try {
        revision = await saveNavLayout(userId, layout, base)
    } catch (e) {
        // A value Postgres refuses (bad text in jsonb) is the client's fault, not a 500
        const err = e as { code?: string, cause?: { code?: string } }
        if ((err.cause?.code ?? err.code)?.startsWith('22')) throw createError({ statusCode: 400, statusMessage: 'Invalid layout' })
        throw e
    }

    if (revision === null) {
        throw createError({ statusCode: 409, statusMessage: 'Sidebar changed elsewhere', data: await readNavLayout(userId) })
    }
    return { layout, revision }
})
