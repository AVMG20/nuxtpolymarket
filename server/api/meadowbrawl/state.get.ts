import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { ensureMeadowbrawlState, meadowbrawlActivePet, meadowbrawlLevels, meadowbrawlPetLevel, meadowbrawlRunCoinMult } from '#server/utils/meadowbrawl'
import {
    MEADOWBRAWL_PETS,
    MEADOWBRAWL_PET_ABILITY_LEVELS,
    MEADOWBRAWL_PET_MAX_LEVEL,
    MEADOWBRAWL_RUN_COOLDOWN_MS,
    MEADOWBRAWL_SAVE_VERSION,
    MEADOWBRAWL_UPGRADES,
    MEADOWBRAWL_WEAPON_UNLOCKS,
    meadowbrawlAccountEffects,
    meadowbrawlIsPetId,
    meadowbrawlPetCost,
    meadowbrawlPetEffects,
    meadowbrawlRunCooldownRemainingMs,
    meadowbrawlRushGemCost,
    meadowbrawlTotalUpgradeCost,
    meadowbrawlUnlockedWeapons,
    meadowbrawlUpgradeCost
} from '#shared/utils/gamelogic/meadowbrawl-meta'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, state] = await Promise.all([
        getBalance(userId),
        ensureMeadowbrawlState(db, userId)
    ])

    const levels = meadowbrawlLevels(state)
    const effects = meadowbrawlAccountEffects(levels)
    const unlocked = meadowbrawlUnlockedWeapons(state.bestWaveByWeapon, state.unlockedWeapons)
    const cooldownRemainingMs = meadowbrawlRunCooldownRemainingMs(state.lastRunFinishedAt, Date.now())
    const activePet = meadowbrawlActivePet(state)

    return {
        balance,
        levels,
        effects,
        coinMult: meadowbrawlRunCoinMult(state),
        totalUpgradeCost: meadowbrawlTotalUpgradeCost(),
        upgrades: MEADOWBRAWL_UPGRADES.map(def => ({
            id: def.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            max: def.max,
            level: levels[def.id],
            cost: meadowbrawlUpgradeCost(def, levels[def.id])
        })),
        pets: MEADOWBRAWL_PETS.map((def) => {
            const level = meadowbrawlPetLevel(state, def.id)
            return {
                id: def.id,
                name: def.name,
                tagline: def.tagline,
                color: def.color,
                passive: def.passive,
                abilities: def.abilities.map((a, i) => ({ ...a, unlockLevel: MEADOWBRAWL_PET_ABILITY_LEVELS[i] })),
                level,
                max: MEADOWBRAWL_PET_MAX_LEVEL,
                cost: meadowbrawlPetCost(def, level),
                effects: level > 0 ? meadowbrawlPetEffects(def.id, level) : null,
                nextEffects: level < MEADOWBRAWL_PET_MAX_LEVEL ? meadowbrawlPetEffects(def.id, level + 1) : null
            }
        }),
        activePet: activePet?.id ?? null,
        weapons: {
            unlocked,
            feats: MEADOWBRAWL_WEAPON_UNLOCKS.map(u => ({
                ...u,
                done: unlocked.includes(u.weapon),
                progress: Math.min(u.clearWave, state.bestWaveByWeapon[u.requires] ?? 0)
            }))
        },
        bestWaveByWeapon: state.bestWaveByWeapon,
        stats: {
            runsPlayed: state.runsPlayed,
            victories: state.victories,
            totalEarned: state.totalEarned,
            bestEarned: state.bestEarned,
            bestWave: state.bestWave
        },
        activeRun: state.runStartedAt
            ? {
                startedAt: state.runStartedAt,
                weapon: state.runWeapon,
                pet: meadowbrawlIsPetId(state.runPet) ? state.runPet : null,
                petLevel: state.runPetLevel,
                coinMult: Number(state.runCoinMult ?? '1') || 1,
                revision: state.runSaveRevision,
                // A save written by an older game version cannot be
                // restored — report it as gone; a new start overwrites it.
                save: state.runSave?.version === MEADOWBRAWL_SAVE_VERSION ? state.runSave : null
            }
            : null,
        runCooldown: {
            remainingMs: cooldownRemainingMs,
            totalMs: MEADOWBRAWL_RUN_COOLDOWN_MS,
            rushGems: meadowbrawlRushGemCost(cooldownRemainingMs),
            until: state.lastRunFinishedAt
                ? new Date(state.lastRunFinishedAt.getTime() + MEADOWBRAWL_RUN_COOLDOWN_MS)
                : null
        }
    }
})
