import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import {
    AGENT_PULL_TIERS, rollRarity, generateAgentDef,
    RARITY_LABEL, MAX_AGENTS
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const { tierId } = await readBody(event) as { tierId: string }
    const tier = AGENT_PULL_TIERS.find(t => t.id === tierId)
    if (!tier) throw createError({ statusCode: 400, statusMessage: 'Unknown recruit tier' })

    // The hack_state row is locked before the roster is counted, so parallel
    // recruits queue up and can never fill storage past MAX_AGENTS.
    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hackState).where(eq(hackState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })

        const currentAgents = await tx.select().from(hackAgents).where(eq(hackAgents.userId, userId))
        if (currentAgents.length >= MAX_AGENTS) {
            throw createError({ statusCode: 400, statusMessage: `Storage full (${MAX_AGENTS} agents). Fire someone first.` })
        }

        // New agents join the active roster if there's a free active slot, otherwise
        // they land in storage (inactive) and can be activated later.
        const activeCount = currentAgents.filter(a => a.active).length
        const active = activeCount < state.rosterSlots

        if (tier.currency === 'cash') {
            await debit(userId, tier.cost.toFixed(4), 'HackOps', tx)
        } else {
            await debitGems(userId, tier.cost, 'HackOps', tx)
        }

        const rarity = rollRarity(tier.weights)
        const def = generateAgentDef(rarity, currentAgents.map(a => a.name))

        await tx.update(hackState)
            .set({ totalRecruits: sql`${hackState.totalRecruits} + 1` })
            .where(eq(hackState.userId, userId))

        const [agent] = await tx.insert(hackAgents).values({ userId, ...def, active }).returning()
        return { agent, rarity, rarityLabel: RARITY_LABEL[rarity], active }
    })
})
