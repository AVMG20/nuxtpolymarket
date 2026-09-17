import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallRuns, firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { firewallLevels } from '#server/utils/firewall'
import {
    FIREWALL_BASE_CREDITS,
    FIREWALL_DIFFICULTIES,
    FIREWALL_MAINFRAME,
    FIREWALL_MAX_WAVE,
    FIREWALL_RUN_COOLDOWN_MS,
    FIREWALL_SAVE_VERSION,
    firewallCooldownRushCost,
    firewallDifficultyUnlocked,
    firewallMainframeCost,
    firewallMainframeEffects,
    firewallPower
} from '#shared/utils/gamelogic/firewall'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.firewallState.findFirst({ where: eq(firewallState.userId, userId) })
    ])

    // Two first-visit requests can race the insert — the loser reads the row the
    // winner created instead of failing on the unique constraint.
    const state = existing
        ?? (await db.insert(firewallState).values({ userId }).onConflictDoNothing().returning())[0]
        ?? (await db.query.firewallState.findFirst({ where: eq(firewallState.userId, userId) }))!

    const levels = firewallLevels(state)
    const saved = state.runStartedAt
        ? await db.query.firewallRuns.findFirst({ where: eq(firewallRuns.userId, userId) })
        : null
    // A save written before a balance change cannot be resumed into the current
    // game. Report it as gone; start-run overwrites the stale row.
    const resumable = saved && saved.saveVersion === FIREWALL_SAVE_VERSION ? saved : null

    return {
        balance,
        levels,
        effects: firewallMainframeEffects(levels),
        power: firewallPower(levels),
        baseCredits: FIREWALL_BASE_CREDITS,
        maxWave: FIREWALL_MAX_WAVE,
        mainframe: FIREWALL_MAINFRAME.map(def => ({
            id: def.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            color: def.color,
            max: def.max,
            level: levels[def.id],
            cost: firewallMainframeCost(def, levels[def.id]),
            current: def.value(levels[def.id]),
            next: levels[def.id] >= def.max ? null : def.value(levels[def.id] + 1)
        })),
        difficulties: FIREWALL_DIFFICULTIES.map(difficulty => ({
            ...difficulty,
            unlocked: firewallDifficultyUnlocked(difficulty, state.bestWave)
        })),
        stats: {
            runsPlayed: state.runsPlayed,
            totalCoinsEarned: state.totalCoinsEarned,
            bestWave: state.bestWave,
            bestKills: state.bestKills,
            bestPayout: state.bestPayout,
            victories: state.victories
        },
        activeRun: state.runStartedAt
            ? {
                startedAt: state.runStartedAt,
                difficulty: state.runDifficultySnapshot,
                revision: resumable?.revision ?? null,
                save: resumable?.runState ?? null,
                savedAt: resumable?.updatedAt ?? null
            }
            : null,
        runCooldown: state.lastRunFinishedAt
            ? (() => {
                const until = new Date(state.lastRunFinishedAt.getTime() + FIREWALL_RUN_COOLDOWN_MS)
                return {
                    until,
                    rushCost: firewallCooldownRushCost(until.getTime() - Date.now())
                }
            })()
            : null
    }
})

