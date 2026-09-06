import { inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { townState, townBuildings, townPlots, user } from '#server/database/schema'
import { toSim } from '#server/utils/town'
import { townFloorIncomePerDay, deriveTown, getTownBuilding } from '#shared/utils/gamelogic/town'

const LIMIT = 25

/**
 * Ranked by floor income per day from the current layout at the stored
 * happiness — a read of what each town is built to earn, without settling
 * every player. Cheap enough for the player counts this site sees.
 */
export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)
    const now = Date.now()

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

    const rows = states.map((s) => {
        const player = userMap.get(s.userId)
        if (!player) return null
        const mine = buildings.filter(b => b.userId === s.userId)
        const sim = mine.map(b => toSim(b, plotMap.get(b.plotId)))
        const derived = deriveTown(sim, s.happiness, now)
        let maxTier = 0
        for (const b of mine) {
            if (b.level === 0) continue
            const tier = getTownBuilding(b.type)?.tier ?? 0
            if (tier > maxTier) maxTier = tier
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
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1, me: r.userId === sessionUserId }))
    const me = ranked.find(r => r.me) ?? null
    return { rows: ranked.slice(0, LIMIT), me }
})
