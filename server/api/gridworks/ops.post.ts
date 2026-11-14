import { auth } from '#server/utils/auth'
import { broadcastGridworks, withPlot } from '#server/utils/gridworks'
import { applyOp, parseOp, type OpError } from '#shared/utils/gridworks/game'

const MAX_OPS = 400

// One endpoint for every action: a batch of ops applied in order under the plot
// lock, after settling to now. Ops that fail are skipped and reported; the
// client replays its own prediction on top of the state it gets back.
export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ ops?: unknown[] }>(event)
    if (!Array.isArray(body?.ops) || !body.ops.length || body.ops.length > MAX_OPS) {
        throw createError({ statusCode: 400, statusMessage: 'Bad ops' })
    }
    const ops = body.ops.map(parseOp)
    const userId = session.user.id
    const { state, result: errors, events } = await withPlot(userId, (s, now) => {
        return ops.map((op): OpError | null => op ? applyOp(s, op, now) : 'invalid')
    })
    if (errors.some(e => e === null)) broadcastGridworks(userId, state.layout)
    return { state, errors, events, now: Date.now() }
})
