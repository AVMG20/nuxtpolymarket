import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyState, user, transactions } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import { UPGRADE_TRACKS, habitatTrackRequirement, habitatLevelUpCost, habitatLevelUpGemCost, MAX_TIER } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const state = await settleColony(userId)
  if (state.habitatLevel >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Habitat is already at max level' })

  const levels = await getUpgradeLevels(userId)
  const short = UPGRADE_TRACKS.filter(t => (levels[t.id] ?? 0) < habitatTrackRequirement(t.id, state.habitatLevel))
  if (short.length > 0) {
    const detail = short.map(t => `${t.name} (needs Lv ${habitatTrackRequirement(t.id, state.habitatLevel)})`).join(', ')
    throw createError({ statusCode: 400, statusMessage: `Every upgrade track needs to reach its required level first: ${detail}` })
  }

  // Habitat level-ups spend both coins and gems — debited together in one
  // transaction so a shortfall in either currency fails the whole thing
  // instead of silently spending one and then erroring on the other.
  const coinCost = habitatLevelUpCost(state.habitatLevel)
  const gemCost = habitatLevelUpGemCost(state.habitatLevel)

  await db.transaction(async (tx) => {
    const [currentUser] = await tx.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, userId)).for('update')
    if (!currentUser) throw createError({ statusCode: 404, statusMessage: 'User not found' })
    if (parseFloat(currentUser.balance) < coinCost) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
    if (currentUser.gems < gemCost) throw createError({ statusCode: 400, statusMessage: `Not enough gems (need ${gemCost})` })

    await tx.insert(transactions).values({ userId, amount: coinCost.toFixed(4), type: 'debit', category: 'colony:habitat-level' })
    await tx.update(user)
      .set({
        balance: sql`${user.balance} - ${coinCost.toFixed(4)}::numeric`,
        gems: sql`${user.gems} - ${gemCost}`
      })
      .where(eq(user.id, userId))
    await tx.update(colonyState).set({ habitatLevel: state.habitatLevel + 1 }).where(eq(colonyState.userId, userId))
  })

  return { ok: true }
})
