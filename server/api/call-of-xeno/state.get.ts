import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { callOfXenoState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { callOfXenoBestRounds, callOfXenoLevels } from '#server/utils/call-of-xeno'
import {
    CALL_OF_XENO_DIFFICULTIES,
    CALL_OF_XENO_PAYOUT_RATE,
    CALL_OF_XENO_RUN_COOLDOWN_MS,
    CALL_OF_XENO_UPGRADES,
    callOfXenoDifficultyUnlocked,
    callOfXenoRunCooldownRemainingMs,
    callOfXenoTotalUpgradeCost,
    callOfXenoUpgradeCost,
    callOfXenoUpgradeEffects
} from '#shared/utils/gamelogic/call-of-xeno-meta'
import { CALL_OF_XENO_SAVE_VERSION } from '#shared/utils/gamelogic/call-of-xeno-save'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.callOfXenoState.findFirst({ where: eq(callOfXenoState.userId, userId) })
    ])

    // Two first-visit requests can race the insert — the loser reads the row
    // the winner created instead of failing on the unique constraint.
    const state = existing
        ?? (await db.insert(callOfXenoState).values({ userId }).onConflictDoNothing().returning())[0]
        ?? (await db.query.callOfXenoState.findFirst({ where: eq(callOfXenoState.userId, userId) }))!

    const levels = callOfXenoLevels(state)
    const best = callOfXenoBestRounds(state)
    const cooldownRemainingMs = callOfXenoRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())

    return {
        balance,
        levels,
        effects: callOfXenoUpgradeEffects(levels),
        payoutRate: CALL_OF_XENO_PAYOUT_RATE,
        totalUpgradeCost: callOfXenoTotalUpgradeCost(),
        upgrades: CALL_OF_XENO_UPGRADES.map(def => ({
            id: def.id,
            name: def.name,
            description: def.description,
            max: def.max,
            level: levels[def.id],
            cost: callOfXenoUpgradeCost(def, levels[def.id])
        })),
        difficulties: CALL_OF_XENO_DIFFICULTIES.map(difficulty => ({
            ...difficulty,
            unlocked: callOfXenoDifficultyUnlocked(difficulty, best)
        })),
        stats: {
            runsPlayed: state.runsPlayed,
            totalEarned: state.totalEarned,
            bestEarned: state.bestEarned,
            bestRounds: best
        },
        activeRun: state.runStartedAt
            ? {
                startedAt: state.runStartedAt,
                difficulty: state.runDifficultySnapshot,
                payoutMult: Number(state.runPayoutMultSnapshot ?? '1') || 1,
                revision: state.runSaveRevision,
                // A save written by an older game version cannot be
                // restored — report it as gone; deploy overwrites it.
                save: state.runSave?.version === CALL_OF_XENO_SAVE_VERSION ? state.runSave : null
            }
            : null,
        runCooldown: {
            remainingMs: cooldownRemainingMs,
            until: state.lastRunFinishedAt
                ? new Date(state.lastRunFinishedAt.getTime() + CALL_OF_XENO_RUN_COOLDOWN_MS)
                : null
        }
    }
})
