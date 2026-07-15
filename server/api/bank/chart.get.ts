import { auth } from '#server/utils/auth'
import { getBankHistory } from '#server/utils/bank'

// Bank actions are sparse snapshots; the client fills in realtime compounding
// between them. This limit keeps the chart payload bounded while covering the
// complete 30-day view for normal activity.
const CHART_HISTORY_LIMIT = 500

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const points = await getBankHistory(session.user.id, CHART_HISTORY_LIMIT)
  return { points: points.reverse() }
})
