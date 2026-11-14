import { auth } from '#server/utils/auth'
import { broadcastGridworks, withPlot } from '#server/utils/gridworks'
import { applyOp, parseOp, type OpError } from '#shared/utils/gridworks/game'

const MAX_OPS = 400
/** A full batch of the largest ops is well under 64 KB. */
const MAX_BYTES = 256 * 1024

// One endpoint for every action: a batch of ops applied in order under the plot
// lock, after settling to now. Ops that fail are skipped and reported; the
// client replays its own prediction on top of the state it gets back.
export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const tooLarge = () => createError({ statusCode: 413, statusMessage: 'Too many changes at once' })
    if (Number(getRequestHeader(event, 'content-length') ?? 0) > MAX_BYTES) throw tooLarge()
    const raw = await readRawBody(event, false)
    if (raw && raw.length > MAX_BYTES) throw tooLarge()
    let body: { ops?: unknown[] } | null = null
    try {
        body = raw ? JSON.parse(raw.toString('utf8')) : null
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'Bad ops' })
    }
    if (!Array.isArray(body?.ops) || !body.ops.length || body.ops.length > MAX_OPS) {
        throw createError({ statusCode: 400, statusMessage: 'Bad ops' })
    }
    const ops = body.ops.map(parseOp)
    const userId = session.user.id
    const { state, result: errors, events } = await withPlot(userId, (s, now) => {
        return ops.map((op): OpError | null => op ? applyOp(s, op, now, undefined, userId) : 'invalid')
    })
    if (errors.some(e => e === null)) broadcastGridworks(userId, state.layout)
    return { state, errors, events, now: Date.now() }
})
