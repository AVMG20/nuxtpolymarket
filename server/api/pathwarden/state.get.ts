import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { pathwardenLevels } from '#server/utils/pathwarden'
import {
    PATHWARDEN_BOOST_IDS,
    PATHWARDEN_BOOSTS,
    PATHWARDEN_DEFENSE_BLUEPRINTS,
    PATHWARDEN_SKINS,
    PATHWARDEN_RUN_COOLDOWN_MS,
    PATHWARDEN_SURGE_COST_GEMS,
    pathwardenBoostCost,
    pathwardenCooldownRushCost,
    pathwardenBoostEffects,
    pathwardenPower,
    pathwardenRunCooldownRemainingMs
} from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const debugMode = import.meta.dev || Boolean(useRuntimeConfig(event).devMode)
    const [balance, currentUser, existing] = await Promise.all([
        getBalance(userId),
        db.query.user.findFirst({ where: eq(user.id, userId), columns: { gems: true } }),
        db.query.pathwardenState.findFirst({ where: eq(pathwardenState.userId, userId) })
    ])
    const state = existing
        ?? (await db.insert(pathwardenState).values({ userId }).onConflictDoNothing().returning())[0]
        ?? (await db.query.pathwardenState.findFirst({ where: eq(pathwardenState.userId, userId) }))!
    const levels = pathwardenLevels(state)
    const cooldownRemainingMs = pathwardenRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
    return {
        balance,
        gems: currentUser?.gems ?? 0,
        debugMode,
        levels,
        effects: pathwardenBoostEffects(levels),
        power: pathwardenPower(levels),
        surgeCharges: state.surgeCharges,
        ambientProgress: {
            seen: state.ambientStoryIds.length,
            total: 250,
            achievementUnlocked: state.ambientRewardClaimed,
            freeBoostCredits: state.freeBoostCredits
        },
        surgeCostGems: PATHWARDEN_SURGE_COST_GEMS,
        defenses: PATHWARDEN_DEFENSE_BLUEPRINTS.map(defense => ({
            ...defense,
            owned: ['bolt', 'mortar', 'frost', ...(state.ownedDefenseIds ?? [])].includes(defense.id)
        })),
        skins: PATHWARDEN_SKINS.map(skin => ({
            ...skin,
            owned: ['warden-stone', ...(state.ownedSkinIds ?? [])].includes(skin.id),
            equipped: skin.id === state.equippedSkinId
        })),
        equippedSkinId: state.equippedSkinId,
        runCooldown: cooldownRemainingMs > 0 && state.lastRunFinishedAt
            ? {
                until: new Date(state.lastRunFinishedAt.getTime() + PATHWARDEN_RUN_COOLDOWN_MS),
                remainingMs: cooldownRemainingMs,
                rushCost: pathwardenCooldownRushCost(cooldownRemainingMs)
            }
            : null,
        activeRun: state.runStartedAt
            ? {
                startedAt: state.runStartedAt,
                realm: state.runRealmSnapshot,
                surged: state.runSurgedSnapshot
            }
            : null,
        progression: {
            runsPlayed: state.runsPlayed,
            totalCoinsEarned: state.totalCoinsEarned,
            bestWave: state.bestWave,
            bestScore: state.bestScore,
            bestRealm: state.bestRealm,
            bestFlawless: state.bestFlawless,
            highestCompletedRealm: state.highestCompletedRealm,
            maxUnlockedRealm: Math.min(5, state.highestCompletedRealm + 1)
        },
        boosts: PATHWARDEN_BOOST_IDS.map(id => ({
            id,
            ...PATHWARDEN_BOOSTS[id],
            level: levels[id],
            cost: pathwardenBoostCost(id, levels[id])
        }))
    }
})
