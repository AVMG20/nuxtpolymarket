/**
 * The Passive Skill Tree on the server (`passive-skill-tree.md`, `shared/utils/hero-quest/passive-tree.ts`):
 * the payload the scene draws, and the two mutations, buy a level and respec.
 *
 * Both are **lock-then-read** on the `hq_state` row: the points are derived from `heroLevel` and the
 * map itself, so a level is priced and checked against the row as it stands under `FOR UPDATE`, and
 * two buys at once queue on the lock, each paying from what the other left. The free respec is a
 * boolean flag spent with a conditional update; the paid one takes Gems in the same transaction.
 */

import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { hqState } from '#server/database/schema'
import { debitGems } from '#server/utils/balance'
import type { HqStateRow } from '#server/utils/hero-quest'
import { PASSIVE_RESPEC_GEMS } from '#shared/utils/hero-quest/constants'
import { PASSIVE_NODES, getPassiveNode, isPassiveNodeId } from '#shared/utils/hero-quest/content/passive-tree'
import {
    maxLevelOf,
    passiveBuyBlock,
    passiveLevelCost,
    passiveNodeActive,
    passivePathsOf,
    passivePointsEarned,
    passivePointsLeft,
    passiveTreeOf
} from '#shared/utils/hero-quest/passive-tree'
import type { ClassId } from '#shared/utils/hero-quest/types'

async function lockState(tx: DbExecutor, userId: string): Promise<HqStateRow> {
    const [row] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
    if (!row) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    return row
}

/**
 * The scene's payload: the points, the respec's price, and every node with what it holds, what its
 * next level costs and whether it can be bought. What a node does is shared content, read on both sides.
 */
export function serializePassiveTree(state: HqStateRow) {
    const levels = passiveTreeOf(state.passiveTree)
    const classId = state.heroNodeId as ClassId
    return {
        pointsEarned: passivePointsEarned(state.heroLevel),
        pointsLeft: passivePointsLeft(state.heroLevel, levels),
        respecFree: state.passiveRespecFree,
        respecGems: PASSIVE_RESPEC_GEMS,
        /** The class lines the Hero's class is on, which is where class-path nodes work. */
        paths: [...passivePathsOf(classId)],
        nodes: PASSIVE_NODES.map((node) => {
            const level = levels[node.id] ?? 0
            const max = maxLevelOf(node)
            return {
                id: node.id,
                level,
                maxLevel: max,
                nextCost: max !== null && level >= max ? null : passiveLevelCost(node, level + 1),
                block: passiveBuyBlock(node, state.heroLevel, levels),
                active: passiveNodeActive(node, classId)
            }
        })
    }
}

/** Buy one level of a node. Throws 400 when it is locked, maxed or the points don't cover it. */
export async function buyPassiveLevel(tx: DbExecutor, userId: string, nodeId: string) {
    if (!isPassiveNodeId(nodeId)) throw createError({ statusCode: 400, statusMessage: 'Unknown node' })
    const node = getPassiveNode(nodeId)
    const state = await lockState(tx, userId)
    const levels = passiveTreeOf(state.passiveTree)
    const block = passiveBuyBlock(node, state.heroLevel, levels)
    if (block === 'locked') throw createError({ statusCode: 400, statusMessage: 'Take the node before it first' })
    if (block === 'maxed') throw createError({ statusCode: 400, statusMessage: 'That node is maxed' })
    if (block === 'points') throw createError({ statusCode: 400, statusMessage: 'Not enough tree points' })
    const next = { ...levels, [nodeId]: (levels[nodeId] ?? 0) + 1 }
    await tx.update(hqState).set({ passiveTree: next }).where(eq(hqState.userId, userId))
    return { nodeId, level: next[nodeId]!, pointsLeft: passivePointsLeft(state.heroLevel, next) }
}

/**
 * Refund every point. The free respec a prestige grants goes first; without one it costs
 * `PASSIVE_RESPEC_GEMS`. An empty tree refunds nothing, so it is refused rather than charged.
 */
export async function respecPassiveTree(tx: DbExecutor, userId: string) {
    const state = await lockState(tx, userId)
    if (Object.keys(passiveTreeOf(state.passiveTree)).length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'Nothing to refund' })
    }
    const free = state.passiveRespecFree
    if (!free) await debitGems(userId, PASSIVE_RESPEC_GEMS, tx)
    await tx.update(hqState).set({ passiveTree: {}, passiveRespecFree: false }).where(eq(hqState.userId, userId))
    return { free, pointsLeft: passivePointsEarned(state.heroLevel) }
}
