import { requireUserId } from '#server/utils/auth'
import { auditOverview, gemLedgerSince, parseWindow } from '#server/utils/audit'
import { parseCurrency } from '#shared/utils/currency'

// Site-wide audit of the `transactions` ledger: what every game emitted and
// absorbed over the window, so games are comparable side by side. One
// currency at a time, since coin and gem amounts never add up.

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const query = getQuery(event)
    const currency = parseCurrency(query.currency)
    const [overview, gemsSince] = await Promise.all([
        auditOverview(parseWindow(query.window), currency),
        gemLedgerSince()
    ])

    return {
        ...overview,
        since: overview.since.toISOString(),
        gemLedgerSince: gemsSince?.toISOString() ?? null
    }
})
