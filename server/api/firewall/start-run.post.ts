import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { firewallRuns, firewallState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { firewallCoinMultiplier, firewallLevels, getLockedFirewallState } from '#server/utils/firewall'
import {
    FIREWALL_DIFFICULTY_IDS,
    FIREWALL_SAVE_VERSION,
    firewallDifficulty,
    firewallDifficultyUnlocked,
    firewallEmptyArmoury,
    firewallLoadout,
    firewallMainframeEffects,
    firewallPower,
    firewallRunCooldownRemainingMs,
    type FirewallDifficultyId,
    type FirewallRunSave
} from '#shared/utils/gamelogic/firewall'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const difficultyId = body?.difficultyId as FirewallDifficultyId
    if (!FIREWALL_DIFFICULTY_IDS.includes(difficultyId)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid FIREWALL difficulty' })
    }

    return db.transaction(async (tx) => {
        const state = await getLockedFirewallState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'A FIREWALL run is already active' })

        if (firewallRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now()) > 0) {
            throw createError({ statusCode: 400, statusMessage: 'FIREWALL uplink is cooling down' })
        }


        const difficulty = firewallDifficulty(difficultyId)
        if (!firewallDifficultyUnlocked(difficulty, state.bestWave)) {
            throw createError({
                statusCode: 400,
                statusMessage: `${difficulty.name} unlocks at wave ${difficulty.requiredBestWave}`
            })
        }

        const levels = firewallLevels(state)
        const effects = firewallMainframeEffects(levels)
        const armoury = firewallEmptyArmoury(levels)
        const loadout = firewallLoadout(armoury, levels, difficultyId)
        const startedAt = new Date()
        const coinMultiplier = firewallCoinMultiplier(levels)

        const save: FirewallRunSave = {
            version: FIREWALL_SAVE_VERSION,
            difficulty: difficultyId,
            wave: 0,
            credits: effects.startingCredits,
            coins: 0,
            kills: 0,
            wallHp: loadout.wallMaxHp,
            armoury
        }

        await tx.update(firewallState).set({
            runStartedAt: startedAt,
            runDifficultySnapshot: difficultyId,
            runPowerSnapshot: firewallPower(levels),
            runCoinMultiplierSnapshot: coinMultiplier.toFixed(4)
        }).where(eq(firewallState.userId, userId))

        // A previous run's save is replaced outright — there is only ever one
        // FIREWALL run per account, and the active-run lock above is what makes
        // that safe to overwrite.
        await tx.insert(firewallRuns).values({
            userId,
            revision: 0,
            saveVersion: FIREWALL_SAVE_VERSION,
            runState: save,
            updatedAt: startedAt
        }).onConflictDoUpdate({
            target: firewallRuns.userId,
            set: { revision: 0, saveVersion: FIREWALL_SAVE_VERSION, runState: save, updatedAt: startedAt }
        })

        return {
            startedAt,
            difficulty,
            levels,
            effects,
            revision: 0,
            save,
            power: firewallPower(levels)
        }
    })
})
