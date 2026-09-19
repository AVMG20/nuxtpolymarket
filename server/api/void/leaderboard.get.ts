import { desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, voidItems, voidState } from '#server/database/schema'
import { getSessionUserId } from '#server/utils/auth'
import { voidDerivedStats, voidGearTier, voidLoadoutFor, voidPowerRating, voidShip } from '#shared/utils/gamelogic/void'
import { VOID_RARITIES, voidItemName, type VoidItem, type VoidItemKind } from '#shared/utils/gamelogic/void-items'
import { voidPilotLevel } from '#shared/utils/gamelogic/void-skills'

export default defineEventHandler(async (event) => {
    const sessionUserId = await getSessionUserId(event)
    const rows = await db
        .select({ name: user.name, state: voidState })
        .from(voidState)
        .innerJoin(user, eq(user.id, voidState.userId))
        .where(gt(voidState.runsPlayed, 0))
        .orderBy(desc(voidState.highestSectorCleared), desc(voidState.bestHaulValue))
        .limit(25)

    // Every pilot's gear in one query, so power and the fitted hull come from what they actually fly.
    const itemRows = rows.length ? await db.select().from(voidItems).where(inArray(voidItems.userId, rows.map(r => r.state.userId))) : []
    const itemsByUser = new Map<string, VoidItem[]>()
    for (const r of itemRows) {
        const list = itemsByUser.get(r.userId) ?? []
        list.push({ id: r.id, kind: r.kind as VoidItemKind, type: r.type, tier: r.tier, rarity: r.rarity, level: r.level, affixes: r.affixes ?? {}, mod: r.mod })
        itemsByUser.set(r.userId, list)
    }

    return rows.map(({ name, state: s }, i) => {
        const items = itemsByUser.get(s.userId) ?? []
        const byId = new Map(items.map(item => [item.id, item]))
        const loadout = voidLoadoutFor(s, items)
        const stats = voidDerivedStats(loadout.shipId, loadout.levels, loadout.fit, items, loadout.perks, loadout.shipTier)
        const gear = (id: string | null) => {
            const item = id ? byId.get(id) : undefined
            if (!item) return null
            return { name: voidItemName(item), type: item.type, tier: item.tier, level: item.level, rarityColor: VOID_RARITIES[item.rarity]?.color ?? VOID_RARITIES[0]!.color }
        }
        return {
            rank: i + 1,
            name,
            cleared: s.highestSectorCleared,
            bestHaulValue: s.bestHaulValue,
            kills: s.kills,
            wardensKilled: s.wardensKilled,
            runsPlayed: s.runsPlayed,
            pilotLevel: voidPilotLevel(s.pilotXp ?? 0),
            shipId: loadout.shipId,
            shipName: voidShip(loadout.shipId).name,
            shipTier: loadout.shipTier,
            power: voidPowerRating(loadout, stats),
            gearTier: voidGearTier(loadout.shipId, loadout.fit, items),
            hull: stats.hull,
            shield: stats.shield,
            turretTypes: loadout.turrets.map(t => t?.type ?? null),
            gun: gear(loadout.fit.gun),
            turrets: loadout.fit.turrets.map(gear),
            isCurrentUser: s.userId === sessionUserId
        }
    })
})
