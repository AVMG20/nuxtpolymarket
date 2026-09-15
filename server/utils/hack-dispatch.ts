import { eq, and, inArray } from 'drizzle-orm'
import type { db } from '#server/database'
import { hackAgents, hackItems, hackOps } from '#server/database/schema'
import {
    OP_TEMPLATES, agentPower, effectiveDurationMs, opSuccessChance, MIN_DEPLOY_SUCCESS,
    type AgentClass, type ItemMod, type AgentTrait, type HackRarity
} from '#shared/utils/hack-config'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type HackDb = typeof db | Tx

export interface DispatchOptions {
    /** Dev/test shortcut: every op finishes in one second. */
    instant?: boolean
    autoRedeploy?: boolean
}

/**
 * Validate a squad against a template and insert the op. Used by the dispatch
 * endpoint and by collect's auto-redeploy, which runs it inside the collect
 * transaction (pass `tx`) so the just-collected op no longer counts its agents
 * as busy. Throws a 400 for anything that would make the deploy invalid.
 */
export async function dispatchHackOp(
    conn: HackDb,
    userId: string,
    templateId: string,
    agentIds: string[],
    { instant = false, autoRedeploy = false }: DispatchOptions = {}
) {
    const template = OP_TEMPLATES.find(t => t.id === templateId)
    if (!template) throw createError({ statusCode: 400, statusMessage: 'Unknown op' })

    if (!Array.isArray(agentIds) || agentIds.length < template.minAgents || agentIds.length > template.maxAgents)
        throw createError({ statusCode: 400, statusMessage: `This op requires ${template.minAgents}–${template.maxAgents} agents` })
    if (new Set(agentIds).size !== agentIds.length)
        throw createError({ statusCode: 400, statusMessage: 'Duplicate agent in squad' })

    const [agents, activeOps] = await Promise.all([
        conn.query.hackAgents.findMany({ where: and(eq(hackAgents.userId, userId), inArray(hackAgents.id, agentIds)) }),
        conn.query.hackOps.findMany({ where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)) })
    ])

    if (agents.length !== agentIds.length)
        throw createError({ statusCode: 400, statusMessage: 'One or more agents not found' })
    if (agents.some(a => !a.active))
        throw createError({ statusCode: 400, statusMessage: 'Agent is in storage' })

    const busyIds = new Set(activeOps.flatMap(op => op.agentIds as string[]))
    if (agentIds.some(id => busyIds.has(id)))
        throw createError({ statusCode: 400, statusMessage: 'Agent is already on an op' })

    const equippedIds = agents.flatMap(a =>
        ([a.equippedTool, a.equippedSoftware, a.equippedHardware] as Array<string | null>)
            .filter((x): x is string => x !== null)
    )

    const items = equippedIds.length > 0
        ? await conn.query.hackItems.findMany({
            where: and(eq(hackItems.userId, userId), inArray(hackItems.id, equippedIds))
        })
        : []

    // Per-agent loadouts — each agent keeps its own gear so power and op speed are
    // computed per agent (speed compounds across agents rather than stacking).
    const agentLoadouts = agents.map((agent) => {
        const agentItemIds = ([agent.equippedTool, agent.equippedSoftware, agent.equippedHardware] as Array<string | null>)
            .filter((x): x is string => x !== null)
        return {
            class: agent.class as AgentClass,
            traits: (agent.traits ?? []) as AgentTrait[],
            items: items.filter(i => agentItemIds.includes(i.id)).map(i => ({ itemLevel: i.itemLevel, mods: i.mods as ItemMod[] }))
        }
    })
    const totalPower = agents.reduce((sum, agent, i) =>
        sum + agentPower({ level: agent.level, class: agent.class as AgentClass, rarity: agent.rarity as HackRarity }, agentLoadouts[i]!.items, (agent.traits ?? []) as AgentTrait[]), 0)

    const durationMs = instant ? 1000 : effectiveDurationMs(template, agentLoadouts)
    const successChance = opSuccessChance(totalPower, template.minPower)
    if (successChance < MIN_DEPLOY_SUCCESS)
        throw createError({ statusCode: 400, statusMessage: 'Success chance too low — bring more power' })

    const completesAt = new Date(Date.now() + durationMs)

    const [op] = await conn.insert(hackOps).values({ userId, templateId, agentIds, completesAt, autoRedeploy }).returning()

    return { opId: op!.id, completesAt, durationMs, successChance }
}
