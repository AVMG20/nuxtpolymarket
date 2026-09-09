import { requireUserId } from '#server/utils/auth'
import { parseMetric, parseWindow, topPlayersForLabel } from '#server/utils/audit'

const TOP_LIMIT = 5

// The per-game drilldown behind a row on the audit page: who moved the most
// money through this one game over the window, ranked by the metric the page
// is currently measuring.

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const query = getQuery(event)
    const label = typeof query.label === 'string' ? query.label.trim() : ''
    if (!label) throw createError({ statusCode: 400, statusMessage: 'label is required' })

    const window = parseWindow(query.window)
    const metric = parseMetric(query.metric)

    return {
        label,
        window,
        metric,
        players: await topPlayersForLabel(label, window, metric, TOP_LIMIT)
    }
})
