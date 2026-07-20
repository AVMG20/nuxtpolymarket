import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoUpgrades } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getXenoUpgradeTrack, xenoUpgradeCost, type XenoUpgradeId } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
    const { upgradeId } = await readBody<{ upgradeId: XenoUpgradeId }>(event)
    const userId = await requireUserId(event)
    const track = getXenoUpgradeTrack(upgradeId)
    if (!track) throw createError({ statusCode: 400, statusMessage: 'Unknown Xeno upgrade' })

    return db.transaction(async (tx) => {
        await tx.insert(xenoUpgrades).values({ userId }).onConflictDoNothing()
        const [current] = await tx.select().from(xenoUpgrades).where(eq(xenoUpgrades.userId, userId)).for('update')
        if (!current) throw createError({ statusCode: 500, statusMessage: 'Could not initialize Xeno upgrades' })

        const currentLevel = upgradeId === 'mutation'
            ? current.mutationLevel
            : upgradeId === 'yield'
                ? current.yieldLevel
                : current.speedLevel
        const cost = xenoUpgradeCost(upgradeId, currentLevel)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: `${track.name} is already maxed` })

        const nextLevel = currentLevel + 1
        const set = upgradeId === 'mutation'
            ? { mutationLevel: nextLevel }
            : upgradeId === 'yield'
                ? { yieldLevel: nextLevel }
                : { speedLevel: nextLevel }
        const [updated] = await tx.update(xenoUpgrades)
            .set(set)
            .where(and(eq(xenoUpgrades.userId, userId), upgradeId === 'mutation'
                ? eq(xenoUpgrades.mutationLevel, currentLevel)
                : upgradeId === 'yield'
                    ? eq(xenoUpgrades.yieldLevel, currentLevel)
                    : eq(xenoUpgrades.speedLevel, currentLevel)))
            .returning()
        if (!updated) throw createError({ statusCode: 409, statusMessage: 'Upgrade already purchased, refresh and try again' })

        await debit(userId, cost.toFixed(4), 'xeno:upgrade', tx)
        return { upgradeId, level: nextLevel, cost }
    })
})
