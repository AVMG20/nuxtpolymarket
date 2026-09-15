/**
 * Auto-redeploy re-dispatches a collected op inside the collect transaction. The
 * busy-agent check has to see the just-claimed op as finished, otherwise every
 * auto-deploy would be refused for "Agent is already on an op". Needs the local
 * Postgres from .env.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackOps } from '#server/database/schema'
import { dispatchHackOp } from '#server/utils/hack-dispatch'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-hack-auto-redeploy'

async function seedAgent(active = true) {
    const [agent] = await db.insert(hackAgents)
        .values({ userId: USER, name: 'Test', class: 'bruteforce', rarity: 'ghost', level: 10, active })
        .returning()
    return agent!
}

describe.skipIf(SKIP)('dispatchHackOp', () => {
    beforeEach(async () => {
        await cleanupUser(USER)
        await seedUser(USER)
    })
    afterEach(async () => { await cleanupUser(USER) })
    afterAll(async () => { await db.$client.end() })

    it('stores the auto-redeploy flag on the op', async () => {
        const agent = await seedAgent()
        const { opId } = await dispatchHackOp(db, USER, 'port_scan', [agent.id], { instant: true, autoRedeploy: true })
        const op = await db.query.hackOps.findFirst({ where: eq(hackOps.id, opId) })
        expect(op?.autoRedeploy).toBe(true)
        expect(op?.agentIds).toEqual([agent.id])
    })

    it('refuses an agent that is still on an uncollected op', async () => {
        const agent = await seedAgent()
        await dispatchHackOp(db, USER, 'port_scan', [agent.id], { instant: true })
        await expect(dispatchHackOp(db, USER, 'port_scan', [agent.id], { instant: true }))
            .rejects.toThrow('Agent is already on an op')
    })

    it('refuses agents in storage, duplicates and unknown agents', async () => {
        const stored = await seedAgent(false)
        await expect(dispatchHackOp(db, USER, 'port_scan', [stored.id], { instant: true }))
            .rejects.toThrow('Agent is in storage')
        await expect(dispatchHackOp(db, USER, 'bank_skim', [stored.id, stored.id], { instant: true }))
            .rejects.toThrow('Duplicate agent in squad')
        await expect(dispatchHackOp(db, USER, 'port_scan', ['nope'], { instant: true }))
            .rejects.toThrow('One or more agents not found')
    })

    it('redeploys the same squad once the collect claim has flipped inside the transaction', async () => {
        const agent = await seedAgent()
        const { opId } = await dispatchHackOp(db, USER, 'port_scan', [agent.id], { instant: true, autoRedeploy: true })

        const next = await db.transaction(async (tx) => {
            const [claimed] = await tx.update(hackOps)
                .set({ collected: true })
                .where(and(eq(hackOps.id, opId), eq(hackOps.collected, false)))
                .returning({ id: hackOps.id })
            expect(claimed).toBeTruthy()
            return tx.transaction(sp => dispatchHackOp(sp, USER, 'port_scan', [agent.id], { instant: true, autoRedeploy: true }))
        })

        expect(next.opId).not.toBe(opId)
        const running = await db.query.hackOps.findMany({ where: and(eq(hackOps.userId, USER), eq(hackOps.collected, false)) })
        expect(running.map(o => o.id)).toEqual([next.opId])
        expect(running[0]!.autoRedeploy).toBe(true)
    })
})
