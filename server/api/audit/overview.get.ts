import { requireUserId } from '#server/utils/auth'
import { auditOverview, parseWindow } from '#server/utils/audit'

// Site-wide audit of the `transactions` ledger: what every game emitted and
// absorbed over the window, so games are comparable side by side.

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const overview = await auditOverview(parseWindow(getQuery(event).window))

    return { ...overview, since: overview.since.toISOString() }
})
