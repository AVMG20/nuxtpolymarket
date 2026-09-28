import { inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { townState, townBuildings, townPlots, user } from '#server/database/schema'
import { toSim } from '#server/utils/town'
import { townFloorIncomePerDay, deriveTown, getTownBuilding } from '#shared/utils/gamelogic/town'

const LIMIT = 25
/**
 * How long a computed board is served to everybody.
 *
 * The board reads every town in the realm and derives each one, which is far
 * too much work to repeat per request on a route that needs no session. It
 * changes slowly by nature — nobody's rank moves in thirty seconds — so one
 * computation is shared until it goes stale.
 */
const CACHE_MS = 30_000

interface Row {
    userId: string
    name: string
    emblem: string | null
    prestige: number
    incomePerDay: number
    buildings: number
    plots: number
    popCap: number
    happiness: number
    maxTier: number
    coinsEarned: number
}

let cached: { at: number, rows: Row[] } | null = null

/**
 * Ranked by floor income per day from the current layout at the stored
 * happiness — a read of what each town is built to earn, without settling
 * every player. Cheap enough for the player counts this site sees.
 */
export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)
    const now = Date.now()

    if (cached && now - cached.at < CACHE_MS) return board(cached.rows, sessionUserId)

    const states = await db.select({
        userId: townState.userId,
        happiness: townState.happiness,
        plotsBought: townState.plotsBought,
        coinsEarned: townState.coinsEarned
    }).from(townState)
    if (!states.length) return { rows: [], me: null }

    const userIds = states.map(s => s.userId)
    const [users, buildings, plots] = await Promise.all([
        db.select({ id: user.id, name: user.name, emblem: user.emblem, prestige: user.prestige }).from(user).where(inArray(user.id, userIds)),
        db.select().from(townBuildings).where(inArray(townBuildings.userId, userIds)),
        db.select().from(townPlots).where(inArray(townPlots.userId, userIds))
    ])
    const userMap = new Map(users.map(u => [u.id, u]))
    const plotMap = new Map(plots.map(p => [p.id, p]))
    // Group once. Filtering these arrays per town is quadratic, and at a few
    // thousand towns it blocked the event loop for seconds on a public route.
    const buildingsByUser = new Map<string, typeof buildings>()
    for (const b of buildings) {
        const list = buildingsByUser.get(b.userId)
        if (list) list.push(b)
        else buildingsByUser.set(b.userId, [b])
    }

    const rows = states.map((s) => {
        const player = userMap.get(s.userId)
        if (!player) return null
        const mine = buildingsByUser.get(s.userId) ?? []
        const sim = mine.map(b => toSim(b, plotMap.get(b.plotId)))
        // Monuments are buildings, so the derive already counts what they give.
        const derived = deriveTown(sim, s.happiness, now)
        let maxTier = 0
        for (const b of mine) {
            if (b.level === 0) continue
            const def = getTownBuilding(b.type)
            if (def && def.kind !== 'monument' && def.tier > maxTier) maxTier = def.tier
        }
        return {
            userId: s.userId,
            name: player.name,
            emblem: player.emblem,
            prestige: player.prestige,
            incomePerDay: townFloorIncomePerDay(sim, s.happiness, now),
            buildings: mine.filter(b => b.level > 0).length,
            plots: s.plotsBought,
            popCap: derived.popCap,
            happiness: s.happiness,
            maxTier,
            coinsEarned: parseFloat(s.coinsEarned)
        }
    }).filter((r): r is NonNullable<typeof r> => r !== null)

    rows.sort((a, b) => b.incomePerDay - a.incomePerDay || b.coinsEarned - a.coinsEarned)
    cached = { at: now, rows }
    return board(rows, sessionUserId)
})

/**
 * Rank the shared board and mark the caller's own row. Ranking is per-caller
 * and costs nothing; deriving the towns is what the cache is protecting.
 */
function board(rows: Row[], sessionUserId: string | null) {
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1, me: r.userId === sessionUserId }))
    const me = ranked.find(r => r.me) ?? null
    return { rows: ranked.slice(0, LIMIT), me }
}
