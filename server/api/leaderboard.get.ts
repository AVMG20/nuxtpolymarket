import { count, countDistinct, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { user, bankState, colonyState, colonyBugResearch, xenoPlantsUnlocked, xenoGridSlots, xenoBreederSlots, aiMessages, hackAgents, hackItems, gemOrders, tcgBattlerRun, tcgBattlerRating, townState, townResearch, voidState } from '#server/database/schema'
import { getGemGuidePrice } from '#server/utils/gem-exchange'
import { bailoutRemaining, debtFloor, growBankBalance, isBailoutActive } from '#shared/utils/gamelogic/bank'
import { PLANT_TYPES } from '#shared/utils/xeno'
import { equippedAgentPower, type EquippableItemRow } from '#server/utils/hack'
import { townScore, voidScore } from '#shared/utils/gamelogic/scoreboard'

export default defineEventHandler(async (event) => {
  const sessionUserId = await getSessionUserId(event)
  const xenoSpeciesIds = [...new Set(PLANT_TYPES.map(plant => plant.id))]
  const [users, gemGuidePrice, gemEscrowRows, hackAgentRows, hackItemRows, colonyHabitatRows, researchTotals, xenoSpeciesCounts, xenoGridCounts, xenoBreederCounts, aiPromptCounts, battlerTotals, battlerRatings, townRows, townResearchRows, voidRows] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        emblem: user.emblem,
        prestige: user.prestige,
        balance: user.balance,
        gems: user.gems,
        bankBalance: bankState.balance,
        bankLastSettledAt: bankState.lastSettledAt,
        bankLoanPrincipal: bankState.loanPrincipal,
        bailoutUntil: bankState.bailoutUntil,
        bailoutDebt: bankState.bailoutDebt,
        bailoutRepaid: bankState.bailoutRepaid,
      })
      .from(user)
      .leftJoin(bankState, eq(bankState.userId, user.id)),
    getGemGuidePrice(),
    // Coins and gems escrowed in open exchange offers still belong to the
    // player — count them so wealth can't be hidden in the order book.
    db
      .select({
        userId: gemOrders.userId,
        escrowCoins: sql<string>`coalesce(sum(case when ${gemOrders.side} = 'buy' then (${gemOrders.quantity} - ${gemOrders.filled}) * ${gemOrders.price} else 0 end), 0)`,
        escrowGems: sql<number>`coalesce(sum(case when ${gemOrders.side} = 'sell' then ${gemOrders.quantity} - ${gemOrders.filled} else 0 end), 0)`.mapWith(Number)
      })
      .from(gemOrders)
      .where(eq(gemOrders.status, 'open'))
      .groupBy(gemOrders.userId),
    db
      .select({
        userId: hackAgents.userId,
        level: hackAgents.level,
        class: hackAgents.class,
        rarity: hackAgents.rarity,
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
      .select({ userId: xenoPlantsUnlocked.userId, n: countDistinct(xenoPlantsUnlocked.typeId) })
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
    db
      .select({
        userId: tcgBattlerRun.userId,
        runsWon: sql<number>`count(*) filter (where ${tcgBattlerRun.state} = 'won')`.mapWith(Number),
        battlesWon: sql<number>`coalesce(sum(${tcgBattlerRun.wins}), 0)`.mapWith(Number),
        battlesLost: sql<number>`coalesce(sum(${tcgBattlerRun.losses}), 0)`.mapWith(Number)
      })
      .from(tcgBattlerRun)
      .groupBy(tcgBattlerRun.userId),
    db.select({ userId: tcgBattlerRating.userId, rating: tcgBattlerRating.rating }).from(tcgBattlerRating),
    db.select({ userId: townState.userId, milestonesClaimed: townState.milestonesClaimed }).from(townState),
    db.select({ userId: townResearch.userId, researchId: townResearch.researchId }).from(townResearch),
    db
      .select({
        userId: voidState.userId,
        runsPlayed: voidState.runsPlayed,
        highestSectorCleared: voidState.highestSectorCleared,
        pilotXp: voidState.pilotXp,
        ownedShipIds: voidState.ownedShipIds,
        upgradeLevels: voidState.upgradeLevels,
        tradeLevel: voidState.tradeLevel,
      })
      .from(voidState),
  ])

  const gemEscrowByUser = new Map(gemEscrowRows.map(row => [row.userId, row]))

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
  const battlerByUser = new Map(battlerTotals.map(row => [row.userId, row]))
  const battlerRatingByUser = new Map(battlerRatings.map(row => [row.userId, row.rating]))
  const townResearchByUser = new Map<string, string[]>()
  for (const row of townResearchRows) {
    const list = townResearchByUser.get(row.userId)
    if (list) list.push(row.researchId)
    else townResearchByUser.set(row.userId, [row.researchId])
  }
  const townByUser = new Map(townRows.map(row => [row.userId, townScore(row.milestonesClaimed ?? [], townResearchByUser.get(row.userId) ?? [])]))
  const voidByUser = new Map(voidRows.map(row => [row.userId, voidScore(row)]))

  return users
    .map(u => {
      const escrow = gemEscrowByUser.get(u.id)
      const balance = parseFloat(u.balance) + parseFloat(escrow?.escrowCoins ?? '0')
      const gems = (u.gems ?? 0) + (escrow?.escrowGems ?? 0)
      const gemValue = gems * gemGuidePrice
      const storedBankBalance = parseFloat(u.bankBalance ?? '0')
      const loanPrincipal = parseFloat(u.bankLoanPrincipal ?? '0')
      const bailout = {
        until: u.bailoutUntil,
        debt: parseFloat(u.bailoutDebt ?? '0'),
        repaid: parseFloat(u.bailoutRepaid ?? '0')
      }
      let bankBalance = u.bankLastSettledAt
        ? growBankBalance(storedBankBalance, u.bankLastSettledAt, new Date(), bailout)
        : storedBankBalance
      if (bankBalance < 0 && loanPrincipal > 0) bankBalance = Math.max(bankBalance, debtFloor(loanPrincipal))
      const bailoutActive = isBailoutActive(bailout)
      const totalWealth = balance + gemValue + bankBalance
      const itemMap = itemsByUser.get(u.id) ?? new Map<string, EquippableItemRow>()
      const hackPower = (agentsByUser.get(u.id) ?? [])
        .reduce((total, agent) => total + equippedAgentPower(agent, itemMap), 0)
      const colonyResearchLevels = researchByUser.get(u.id) ?? 0
      const colonyHabitatLevel = habitatByUser.get(u.id) ?? 0
      const xenoSpeciesUnlocked = xenoSpeciesByUser.get(u.id) ?? 0
      const xenoGridSlotsUnlocked = xenoGridByUser.get(u.id) ?? 0
      const xenoBreederSlotsUnlocked = xenoBreederByUser.get(u.id) ?? 0
      const aiPromptsUsed = aiPromptsByUser.get(u.id) ?? 0
      const battler = battlerByUser.get(u.id)
      const town = townByUser.get(u.id)
      const voidRunner = voidByUser.get(u.id)
      const totalUpgrades = colonyHabitatLevel
        + colonyResearchLevels
        + xenoSpeciesUnlocked
        + xenoGridSlotsUnlocked
        + xenoBreederSlotsUnlocked
        + (town?.total ?? 0)
        + (voidRunner?.total ?? 0)
      return {
        isCurrentUser: u.id === sessionUserId,
        id: u.id,
        name: u.name,
        emblem: u.emblem,
        prestige: u.prestige,
        balance: u.balance,
        bankBalance,
        // A running bail-out is still a debt until it is levied back or bought out.
        inDebt: bankBalance < 0 || bailoutActive,
        bailoutActive,
        bailoutRemaining: bailoutActive ? bailoutRemaining(bailout) : 0,
        gems,
        gemValue,
        hackPower,
        colonyHabitatLevel,
        colonyResearchLevels,
        xenoSpeciesUnlocked,
        xenoGridSlotsUnlocked,
        xenoBreederSlotsUnlocked,
        townScore: town?.total ?? 0,
        townMilestones: town?.milestones ?? 0,
        townResearch: town?.research ?? 0,
        voidScore: voidRunner?.total ?? 0,
        voidSectorsCleared: voidRunner?.sectors ?? 0,
        voidPilotLevel: voidRunner?.pilotLevel ?? 0,
        voidHulls: voidRunner?.hulls ?? 0,
        voidSystemLevels: voidRunner?.systems ?? 0,
        voidTradeLevel: voidRunner?.trade ?? 0,
        aiPromptsUsed,
        battlerRunsWon: battler?.runsWon ?? 0,
        battlerRating: battlerRatingByUser.get(u.id) ?? null,
        battlerBattlesWon: battler?.battlesWon ?? 0,
        battlerBattlesLost: battler?.battlesLost ?? 0,
        totalUpgrades,
        totalWealth,
      }
    })
    // Prestige outranks everything: ascending wipes all progress, so a fresh
    // prestiged account would otherwise sit below the players it just lapped.
    .sort((a, b) =>
      (b.prestige ?? 0) - (a.prestige ?? 0)
      || b.totalUpgrades - a.totalUpgrades
      || b.totalWealth - a.totalWealth)
})
