import { auth } from '#server/utils/auth'
import { NR_FAKE_DEFAULT, NR_FAKE_MAX, useNrFakeCrew } from '#server/utils/nitro-rush-fakes'

// Dev only: fake drivers in the live hub, to see the racing-now counts and live ghosts alone.
// `{ count }` starts that many (default 12, at most 40); 0 takes them all off.
export default defineEventHandler(async (event) => {
    if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ count?: unknown } | null>(event).catch(() => null)
    const count = body?.count ?? NR_FAKE_DEFAULT
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        throw createError({ statusCode: 400, statusMessage: 'count must be a number of 0 or more' })
    }
    const crew = useNrFakeCrew()
    crew.start(Math.min(NR_FAKE_MAX, count))
    return { drivers: crew.size, tracks: crew.counts }
})
