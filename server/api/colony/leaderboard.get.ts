import { inArray } from 'drizzle-orm'
/* eslint-disable @stylistic/indent */
import { db } from '#server/database'
import { auth } from '#server/utils/auth'
import { colonyBugResearch, colonyBugs, colonyItems, colonyState, colonyUpgrades, user } from '#server/database/schema'
import { getBug, getItem } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    const states = await db.select({
        userId: colonyState.userId,
        habitatLevel: colonyState.habitatLevel
    }).from(colonyState)

    if (!states.length) return []

    const userIds = states.map(state => state.userId)
    const [users, bugs, items, upgrades, research] = await Promise.all([
        db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
        db.select({ userId: colonyBugs.userId, typeId: colonyBugs.typeId, inTerrarium: colonyBugs.inTerrarium }).from(colonyBugs).where(inArray(colonyBugs.userId, userIds)),
        db.select({ userId: colonyItems.userId, itemTypeId: colonyItems.itemTypeId, quantity: colonyItems.quantity }).from(colonyItems).where(inArray(colonyItems.userId, userIds)),
        db.select({ userId: colonyUpgrades.userId, level: colonyUpgrades.level }).from(colonyUpgrades).where(inArray(colonyUpgrades.userId, userIds)),
        db.select({ userId: colonyBugResearch.userId, level: colonyBugResearch.level }).from(colonyBugResearch).where(inArray(colonyBugResearch.userId, userIds))
    ])

    const userMap = new Map(users.map(player => [player.id, player]))

    return states
        .map((state) => {
            const player = userMap.get(state.userId)
            if (!player) return null

            const playerBugs = bugs.filter(bug => bug.userId === state.userId)
            const playerItems = items.filter(item => item.userId === state.userId)
            const bugValue = playerBugs.reduce((sum, bug) => sum + (getBug(bug.typeId)?.spawnCost ?? 0), 0)
            const inventoryValue = playerItems.reduce((sum, item) => {
                return sum + Math.max(0, item.quantity) * (getItem(item.itemTypeId)?.sellValue ?? 0)
            }, 0)

            return {
                isCurrentUser: state.userId === session?.user?.id,
                name: player.name,
                habitatLevel: state.habitatLevel,
                bugCount: playerBugs.length,
                placedBugCount: playerBugs.filter(bug => bug.inTerrarium).length,
                speciesOwned: new Set(playerBugs.map(bug => bug.typeId)).size,
                itemCount: playerItems.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
                inventoryValue,
                bugValue,
                colonyValue: inventoryValue + bugValue,
                upgradeLevels: upgrades.filter(upgrade => upgrade.userId === state.userId).reduce((sum, upgrade) => sum + upgrade.level, 0),
                researchLevels: research.filter(entry => entry.userId === state.userId).reduce((sum, entry) => sum + entry.level, 0)
            }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => b.habitatLevel - a.habitatLevel || b.colonyValue - a.colonyValue || b.bugCount - a.bugCount)
})
