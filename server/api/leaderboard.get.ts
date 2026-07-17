import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, minerState, bankState, colonyState, colonyBugResearch, xenoPlantsUnlocked, xenoGridSlots, xenoBreederSlots, aiMessages } from '#server/database/schema'
import { gemComputeLivePrice, gemSellGems, GEM_INITIAL_PRICE } from '#shared/utils/gamelogic/gem-market'
import { overclockMultiplier, catalystMultiplier } from '#shared/utils/miner-config'
import { debtFloor, growBankBalance } from '#shared/utils/gamelogic/bank'
import { agentPower, type AgentClass, type AgentTrait, type ItemMod } from '#shared/utils/hack-config'
import { PLANT_TYPES } from '#shared/utils/xeno'

export default defineEventHandler(async () => {
  const [users, market, hackAgentRows, hackItemRows, colonyStates, researchRows, unlockedPlantRows, xenoGridSlotRows, xenoBreederSlotRows, aiMessageRows] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        emblem: user.emblem,
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
    db.query.hackAgents.findMany(),
    db.query.hackItems.findMany(),
    db.select({ userId: colonyState.userId, habitatLevel: colonyState.habitatLevel }).from(colonyState),
    db.select({ userId: colonyBugResearch.userId, level: colonyBugResearch.level }).from(colonyBugResearch),
    db.select({ userId: xenoPlantsUnlocked.userId, typeId: xenoPlantsUnlocked.typeId }).from(xenoPlantsUnlocked),
    db.select({ userId: xenoGridSlots.userId }).from(xenoGridSlots),
    db.select({ userId: xenoBreederSlots.userId }).from(xenoBreederSlots),
    db.select({ userId: aiMessages.userId, role: aiMessages.role }).from(aiMessages),
  ])

  const livePrice = market
    ? gemComputeLivePrice(parseFloat(market.price), market.lastUpdatedAt)
    : GEM_INITIAL_PRICE
  const xenoSpeciesIds = new Set(PLANT_TYPES.map(plant => plant.id))

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
      const userItems = hackItemRows.filter(item => item.userId === u.id)
      const itemMap = new Map(userItems.map(item => [item.id, item]))
      const hackPower = hackAgentRows
        .filter(agent => agent.userId === u.id && agent.active)
        .reduce((total, agent) => {
          const equippedItems = [agent.equippedTool, agent.equippedSoftware, agent.equippedHardware]
            .filter(Boolean)
            .map(id => itemMap.get(id!))
            .filter((item): item is NonNullable<typeof item> => !!item)
          const traits = (agent.traits ?? []) as AgentTrait[]
          return total + agentPower(
            { level: agent.level, class: agent.class as AgentClass },
            equippedItems.map(item => ({ itemLevel: item.itemLevel, mods: item.mods as ItemMod[] })),
            traits,
          )
        }, 0)
      const colonyResearchLevels = researchRows
        .filter(research => research.userId === u.id)
        .reduce((total, research) => total + research.level, 0)
      const colonyHabitatLevel = colonyStates.find(state => state.userId === u.id)?.habitatLevel ?? 0
      const xenoSpeciesUnlocked = new Set(
        unlockedPlantRows
          .filter(plant => plant.userId === u.id && xenoSpeciesIds.has(plant.typeId))
          .map(plant => plant.typeId)
      ).size
      const xenoGridSlotsUnlocked = xenoGridSlotRows.filter(slot => slot.userId === u.id).length
      const xenoBreederSlotsUnlocked = xenoBreederSlotRows.filter(slot => slot.userId === u.id).length
      const aiPromptsUsed = aiMessageRows.filter(message => message.userId === u.id && message.role === 'user').length
      return {
        id: u.id,
        name: u.name,
        emblem: u.emblem,
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
