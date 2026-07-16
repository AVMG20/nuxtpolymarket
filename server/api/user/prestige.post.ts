import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import {
  bankHistory,
  bankState,
  blackjackSessions,
  colonyBugResearch,
  colonyBugs,
  colonyItems,
  colonyLoot,
  colonyState,
  colonyUpgrades,
  gemPriceHistory,
  hackAgents,
  hackArtifacts,
  hackHistory,
  hackItems,
  hackOps,
  hackState,
  minerState,
  pirateCannons,
  pirateRunHistory,
  pirateState,
  transactions,
  user,
  xenoArtifacts,
  xenoBreederSlots,
  xenoGridSlots,
  xenoPlants,
  xenoPlantsUnlocked
} from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  MAX_PRESTIGE_LEVEL,
  PRESTIGE_COIN_COST,
  PRESTIGE_GEM_COST,
  prestigeBonusPercent
} from '#shared/utils/prestige'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        balance: user.balance,
        gems: user.gems,
        prestigeLevel: user.prestigeLevel
      })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')

    if (!current) throw createError({ statusCode: 404, statusMessage: 'User not found' })
    if (current.prestigeLevel >= MAX_PRESTIGE_LEVEL) {
      throw createError({ statusCode: 400, statusMessage: 'Maximum prestige level reached' })
    }
    if (parseFloat(current.balance) < PRESTIGE_COIN_COST) {
      throw createError({ statusCode: 400, statusMessage: 'You need 100 billion wallet coins to prestige' })
    }
    if (current.gems < PRESTIGE_GEM_COST) {
      throw createError({ statusCode: 400, statusMessage: 'You need 50,000 gems to prestige' })
    }

    await tx.delete(blackjackSessions).where(eq(blackjackSessions.userId, userId))
    await tx.delete(bankHistory).where(eq(bankHistory.userId, userId))
    await tx.delete(bankState).where(eq(bankState.userId, userId))
    await tx.delete(minerState).where(eq(minerState.userId, userId))

    await tx.delete(pirateRunHistory).where(eq(pirateRunHistory.userId, userId))
    await tx.delete(pirateCannons).where(eq(pirateCannons.userId, userId))
    await tx.delete(pirateState).where(eq(pirateState.userId, userId))

    await tx.delete(xenoGridSlots).where(eq(xenoGridSlots.userId, userId))
    await tx.delete(xenoBreederSlots).where(eq(xenoBreederSlots.userId, userId))
    await tx.delete(xenoPlants).where(eq(xenoPlants.userId, userId))
    await tx.delete(xenoPlantsUnlocked).where(eq(xenoPlantsUnlocked.userId, userId))
    await tx.delete(xenoArtifacts).where(eq(xenoArtifacts.userId, userId))

    await tx.delete(colonyLoot).where(eq(colonyLoot.userId, userId))
    await tx.delete(colonyItems).where(eq(colonyItems.userId, userId))
    await tx.delete(colonyUpgrades).where(eq(colonyUpgrades.userId, userId))
    await tx.delete(colonyBugResearch).where(eq(colonyBugResearch.userId, userId))
    await tx.delete(colonyBugs).where(eq(colonyBugs.userId, userId))
    await tx.delete(colonyState).where(eq(colonyState.userId, userId))

    await tx.delete(hackHistory).where(eq(hackHistory.userId, userId))
    await tx.delete(hackOps).where(eq(hackOps.userId, userId))
    await tx.delete(hackItems).where(eq(hackItems.userId, userId))
    await tx.delete(hackArtifacts).where(eq(hackArtifacts.userId, userId))
    await tx.delete(hackAgents).where(eq(hackAgents.userId, userId))
    await tx.delete(hackState).where(eq(hackState.userId, userId))

    await tx.delete(gemPriceHistory).where(eq(gemPriceHistory.userId, userId))
    await tx.delete(transactions).where(eq(transactions.userId, userId))

    const nextLevel = current.prestigeLevel + 1
    await tx.update(user)
      .set({
        balance: '0',
        gems: 0,
        rake: '0',
        rakebackUnlocked: false,
        prestigeLevel: nextLevel
      })
      .where(eq(user.id, userId))

    return nextLevel
  })

  return {
    ok: true,
    prestigeLevel: result,
    bonusPercent: prestigeBonusPercent(result)
  }
})
