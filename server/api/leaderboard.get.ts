import { count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { user, minerState, bankState, colonyState, colonyBugResearch, xenoPlantsUnlocked, xenoGridSlots, xenoBreederSlots, aiMessages, hackAgents, hackItems } from '#server/database/schema'
import { gemComputeLivePrice, gemSellGems, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'
import { overclockMultiplier, catalystMultiplier } from '#shared/utils/miner-config'
import { debtFloor, growBankBalance } from '#shared/utils/gamelogic/bank'
import { PLANT_TYPES } from '#shared/utils/xeno'
import { equippedAgentPower, type EquippableItemRow } from '#server/utils/hack'

export default defineEventHandler(async (event) => {
  const sessionUserId = await getSessionUserId(event)
  const xenoSpeciesIds = [...new Set(PLANT_TYPES.map(plant => plant.id))]
  const [users, market, hackAgentRows, hackItemRows, colonyHabitatRows, researchTotals, xenoSpeciesCounts, xenoGridCounts, xenoBreederCounts, aiPromptCounts] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        balance: user.balance,
        gems: user.gems,
        rigLevel: minerState.rigLevel,
        vaultLevel: minerState.vaultLevel,
        factoryLevel: minerState.factoryLevel,
        overclockLevel: minerState.overclockLevel,
        catalystLevel: minerState.catalystLevel,
        bankBalance: bankState.balance,
        bankLastSettledAt: bankState.lastSettledAt,
        bankLoanPrincipal: bankState.loanPrincipal,
      })
      .from(user)
      .leftJoin(minerState, eq(minerState.userId, user.id))
      .leftJoin(bankState, eq(bankState.userId, user.id)),
    db.query.gemMarketState.findFirst(),
    db
      .select({
        userId: hackAgents.userId,
        level: hackAgents.level,
        class: hackAgents.class,
        equippedTool: hackAgents.equippedTool,
        equippedSoftware: hackAgents.equippedSoftware,
        equippedHardware: hackAgents.equippedHardware,
        traits: hackAgents.traits,
      })
      .from(hackAgents)
      .where(eq(hackAgents.active, true)),
    db
      .select({ id: hackItems.id, userId: hackItems.userId, itemLevel: hackItems.itemLevel, mods: hackItems.mods })
      .from(hackItems),
    db.select({ userId: colonyState.userId, habitatLevel: colonyState.habitatLevel }).from(colonyState),
    db
      .select({ userId: colonyBugResearch.userId, total: sql<number>`coalesce(sum(${colonyBugResearch.level}), 0)`.mapWith(Number) })
      .from(colonyBugResearch)
      .groupBy(colonyBugResearch.userId),
    db
      .select({ userId: xenoPlantsUnlocked.userId, n: count() })
      .from(xenoPlantsUnlocked)
      .where(inArray(xenoPlantsUnlocked.typeId, xenoSpeciesIds))
      .groupBy(xenoPlantsUnlocked.userId),
    db.select({ userId: xenoGridSlots.userId, n: count() }).from(xenoGridSlots).groupBy(xenoGridSlots.userId),
    db.select({ userId: xenoBreederSlots.userId, n: count() }).from(xenoBreederSlots).groupBy(xenoBreederSlots.userId),
    db
      .select({ userId: aiMessages.userId, n: count() })
      .from(aiMessages)
      .where(eq(aiMessages.role, 'user'))
      .groupBy(aiMessages.userId),
  ])

  const livePrice = market
    ? gemComputeLivePrice(parseFloat(market.price), market.lastUpdatedAt)
    : GEM_INITIAL_PRICE

  const itemsByUser = new Map<string, Map<string, EquippableItemRow>>()
  for (const item of hackItemRows) {
    let itemMap = itemsByUser.get(item.userId)
    if (!itemMap) itemsByUser.set(item.userId, itemMap = new Map())
    itemMap.set(item.id, item)
  }
  const agentsByUser = new Map<string, typeof hackAgentRows>()
  for (const agent of hackAgentRows) {
    let agentList = agentsByUser.get(agent.userId)
    if (!agentList) agentsByUser.set(agent.userId, agentList = [])
    agentList.push(agent)
  }
  const habitatByUser = new Map(colonyHabitatRows.map(row => [row.userId, row.habitatLevel]))
  const researchByUser = new Map(researchTotals.map(row => [row.userId, row.total]))
  const xenoSpeciesByUser = new Map(xenoSpeciesCounts.map(row => [row.userId, row.n]))
  const xenoGridByUser = new Map(xenoGridCounts.map(row => [row.userId, row.n]))
  const xenoBreederByUser = new Map(xenoBreederCounts.map(row => [row.userId, row.n]))
  const aiPromptsByUser = new Map(aiPromptCounts.map(row => [row.userId, row.n]))

  return users
    .map(u => {
      const balance = parseFloat(u.balance)
      const gems = u.gems ?? 0
      const gemValue = gems > 0 ? gemSellGems(livePrice, gems).revenue : 0
      const storedBankBalance = parseFloat(u.bankBalance ?? '0')
      const loanPrincipal = parseFloat(u.bankLoanPrincipal ?? '0')
      let bankBalance = u.bankLastSettledAt
        ? growBankBalance(storedBankBalance, u.bankLastSettledAt)
        : storedBankBalance
      if (bankBalance < 0 && loanPrincipal > 0) bankBalance = Math.max(bankBalance, debtFloor(loanPrincipal))
      const totalWealth = balance + gemValue + bankBalance
      const totalLevels = (u.rigLevel ?? 1) + (u.vaultLevel ?? 1) + (u.factoryLevel ?? 1)
      const itemMap = itemsByUser.get(u.id) ?? new Map<string, EquippableItemRow>()
      const hackPower = (agentsByUser.get(u.id) ?? [])
        .reduce((total, agent) => total + equippedAgentPower(agent, itemMap), 0)
      const colonyResearchLevels = researchByUser.get(u.id) ?? 0
      const colonyHabitatLevel = habitatByUser.get(u.id) ?? 0
      const xenoSpeciesUnlocked = xenoSpeciesByUser.get(u.id) ?? 0
      const xenoGridSlotsUnlocked = xenoGridByUser.get(u.id) ?? 0
      const xenoBreederSlotsUnlocked = xenoBreederByUser.get(u.id) ?? 0
      const aiPromptsUsed = aiPromptsByUser.get(u.id) ?? 0
      return {
        isCurrentUser: u.id === sessionUserId,
        name: u.name,
        balance: u.balance,
        bankBalance,
        gems,
        gemValue,
        rigLevel: u.rigLevel ?? 1,
        vaultLevel: u.vaultLevel ?? 1,
        factoryLevel: u.factoryLevel ?? 1,
        overclockPct: Math.round((overclockMultiplier(u.overclockLevel ?? 0) - 1) * 100),
        catalystPct: Math.round((catalystMultiplier(u.catalystLevel ?? 0) - 1) * 100),
        hackPower,
        colonyHabitatLevel,
        colonyResearchLevels,
        xenoSpeciesUnlocked,
        xenoGridSlotsUnlocked,
        xenoBreederSlotsUnlocked,
        aiPromptsUsed,
        totalLevels,
        totalWealth,
      }
    })
    .sort((a, b) => b.totalWealth - a.totalWealth || b.totalLevels - a.totalLevels)
})
