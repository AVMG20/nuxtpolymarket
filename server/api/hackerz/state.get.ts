import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzRuns, hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { hackerzLevels } from '#server/utils/hackerz'
import {
    HACKERZ_BASE_CREDITS,
    HACKERZ_DIFFICULTIES,
    HACKERZ_MAINFRAME,
    HACKERZ_MAX_WAVE,
    HACKERZ_RUN_COOLDOWN_MS,
    HACKERZ_SAVE_VERSION,
    hackerzCooldownRushCost,
    hackerzDifficultyUnlocked,
    hackerzMainframeCost,
    hackerzMainframeEffects,
    hackerzPower
} from '#shared/utils/gamelogic/hackerz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.hackerzState.findFirst({ where: eq(hackerzState.userId, userId) })
    ])

    // Two first-visit requests can race the insert — the loser reads the row the
    // winner created instead of failing on the unique constraint.
    const state = existing
        ?? (await db.insert(hackerzState).values({ userId }).onConflictDoNothing().returning())[0]
        ?? (await db.query.hackerzState.findFirst({ where: eq(hackerzState.userId, userId) }))!

    const levels = hackerzLevels(state)
    const saved = state.runStartedAt
        ? await db.query.hackerzRuns.findFirst({ where: eq(hackerzRuns.userId, userId) })
        : null
    // A save written before a balance change cannot be resumed into the current
    // game. Report it as gone; start-run overwrites the stale row.
    const resumable = saved && saved.saveVersion === HACKERZ_SAVE_VERSION ? saved : null

    return {
        balance,
        levels,
        effects: hackerzMainframeEffects(levels),
        power: hackerzPower(levels),
        baseCredits: HACKERZ_BASE_CREDITS,
        maxWave: HACKERZ_MAX_WAVE,
        mainframe: HACKERZ_MAINFRAME.map(def => ({
            id: def.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            color: def.color,
            max: def.max,
            level: levels[def.id],
            cost: hackerzMainframeCost(def, levels[def.id]),
            current: def.value(levels[def.id]),
            next: levels[def.id] >= def.max ? null : def.value(levels[def.id] + 1)
        })),
        difficulties: HACKERZ_DIFFICULTIES.map(difficulty => ({
            ...difficulty,
            unlocked: hackerzDifficultyUnlocked(difficulty, state.bestWave)
        })),
        // Database entries opened so far; the client adds what the best wave has shown.
        codex: state.codex,
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
                const until = new Date(state.lastRunFinishedAt.getTime() + HACKERZ_RUN_COOLDOWN_MS)
                return {
                    until,
                    rushCost: hackerzCooldownRushCost(until.getTime() - Date.now())
                }
            })()
            : null
    }
})

