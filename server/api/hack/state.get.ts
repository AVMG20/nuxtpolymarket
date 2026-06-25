import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackState, hackAgents, hackItems, hackOps } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  OP_TEMPLATES, AGENT_PULL_TIERS, ITEM_PULL_TIERS, ROSTER_EXPAND_COSTS, MAX_ROSTER_SLOTS,
  MAX_INVENTORY_SLOTS, MAX_AGENTS, agentPower, generateAgentDef,
  xpToNextLevel, AGENT_MAX_LEVEL,
  opSuccessChance,
  type AgentClass, type HackRarity, type ItemMod, type ItemSlot, type AgentTrait,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  // Auto-create state + seed first agent
  let state = await db.query.hackState.findFirst({ where: eq(hackState.userId, userId) })
  if (!state) {
    const [newState] = await db.insert(hackState).values({ userId, shopItems: [], shopRefreshAt: new Date() }).returning()
    state = newState!
    const def = generateAgentDef('ghost', [])
    await db.insert(hackAgents).values({ userId, ...def })
  }

  const [agents, items, activeOps] = await Promise.all([
    db.query.hackAgents.findMany({ where: eq(hackAgents.userId, userId) }),
    db.query.hackItems.findMany({ where: eq(hackItems.userId, userId) }),
    db.query.hackOps.findMany({ where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)) }),
  ])

  const busyAgentIds = new Set(activeOps.flatMap(op => op.agentIds as string[]))
  const itemMap = new Map(items.map(i => [i.id, i]))

  function toItemOut(i: typeof items[0] | undefined) {
    if (!i) return null
    return { id: i.id, name: i.name, slot: i.slot as ItemSlot, itemLevel: i.itemLevel, rarity: i.rarity as HackRarity, mods: i.mods as ItemMod[], equippedBy: i.equippedBy }
  }

  const agentsOut = agents.map(a => {
    const equippedItems = [a.equippedTool, a.equippedSoftware, a.equippedHardware]
      .filter(Boolean).map(id => itemMap.get(id!)).filter(Boolean) as typeof items
    const traits = (a.traits ?? []) as AgentTrait[]
    const power = agentPower(
      { level: a.level, class: a.class as AgentClass },
      equippedItems.map(i => ({ itemLevel: i.itemLevel, mods: i.mods as ItemMod[] })),
      traits,
    )
    return {
      id: a.id, name: a.name, class: a.class, rarity: a.rarity,
      level: a.level, xp: a.xp, active: a.active,
      xpToNext: a.level < AGENT_MAX_LEVEL ? xpToNextLevel(a.level) : null,
      power, traits,
      // Full item objects embedded — equipped items do NOT appear in the inventory list
      gear: {
        tool: toItemOut(itemMap.get(a.equippedTool ?? '')),
        software: toItemOut(itemMap.get(a.equippedSoftware ?? '')),
        hardware: toItemOut(itemMap.get(a.equippedHardware ?? '')),
      },
      // Keep IDs for equip API calls
      equippedTool: a.equippedTool, equippedSoftware: a.equippedSoftware, equippedHardware: a.equippedHardware,
      onOp: busyAgentIds.has(a.id),
    }
  })

  // Only active agents count toward power and can be deployed. Inactive agents
  // sit in storage until activated.
  const activeAgents = agentsOut.filter(a => a.active)
  const storedAgents = agentsOut.filter(a => !a.active)

  // Per-op accessibility + effective reward preview
  const agentsByPower = [...activeAgents].sort((a, b) => b.power - a.power)
  const freeAgents = agentsByPower.filter(a => !a.onOp)

  // Total power = sum of ACTIVE agents (user's combined power level displayed in UI)
  const totalUserPower = activeAgents.reduce((s, a) => s + a.power, 0)

  const opTemplatesOut = OP_TEMPLATES.map(template => {
    const bestTeam = agentsByPower.filter(a => !a.onOp).slice(0, template.maxAgents)
    const bestPower = bestTeam.reduce((s, a) => s + a.power, 0)
    const hasEnough = freeAgents.length >= template.minAgents
    const powerOk = bestPower >= template.minPower
    // Every op is shown and openable. Whether you can actually deploy is decided
    // in the dispatch modal by success chance (must be ≥ MIN_DEPLOY_SUCCESS).
    let status: 'available' | 'close' | 'locked' | 'no_agents'
    if (!hasEnough) status = 'no_agents'
    else if (powerOk) status = 'available'
    else if (bestPower >= template.minPower * 0.6) status = 'close'
    else status = 'locked'

    // The card shows the op's BASE spec (team-independent). Agent/gear bonuses are
    // applied per-selection in the dispatch modal, so picking agents visibly raises
    // these numbers there.
    return {
      ...template, status, bestPower,
      effectiveSuccessChance: opSuccessChance(bestPower, template.minPower),
    }
  })

  const opsOut = activeOps.map(op => ({
    id: op.id, templateId: op.templateId, agentIds: op.agentIds as string[],
    startedAt: op.startedAt, completesAt: op.completesAt, done: new Date() >= op.completesAt,
  }))

  const rosterExpandCost = state.rosterSlots < MAX_ROSTER_SLOTS
    ? ROSTER_EXPAND_COSTS[state.rosterSlots - 2] ?? null
    : null

  // Only unequipped items count toward inventory — equipped items live on the agent
  const unequippedItems = items.filter(i => !i.equippedBy)

  return {
    agents: activeAgents,
    storedAgents,
    totalAgents: agentsOut.length,
    maxAgents: MAX_AGENTS,
    items: unequippedItems.map(i => ({
      id: i.id, name: i.name, slot: i.slot as ItemSlot, itemLevel: i.itemLevel,
      rarity: i.rarity as HackRarity, mods: i.mods as ItemMod[], equippedBy: i.equippedBy,
    })),
    activeOps: opsOut,
    rosterSlots: state.rosterSlots, maxRosterSlots: MAX_ROSTER_SLOTS, rosterExpandCost,
    inventoryCount: unequippedItems.length, maxInventorySlots: MAX_INVENTORY_SLOTS,
    totalPower: totalUserPower,
    opTemplates: opTemplatesOut,
    agentPullTiers: AGENT_PULL_TIERS,
    itemPullTiers: ITEM_PULL_TIERS,
  }
})
