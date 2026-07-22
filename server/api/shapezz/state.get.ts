import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import { shapezzArsenal } from '#server/utils/shapezz'
import {
    SHAPEZZ_DIFFICULTIES,
    SHAPEZZ_MAX_PERMANENT_LEVEL,
    SHAPEZZ_RUN_COOLDOWN_MS,
    SHAPEZZ_PERMANENT_UPGRADE_IDS,
    SHAPEZZ_PERMANENT_UPGRADES,
    SHAPEZZ_WEAPONS,
    shapezzPermanentUpgradeCost,
    shapezzCooldownRushCost,
    shapezzPlayerStats,
    shapezzPower,
    shapezzWeapon,
    shapezzWeaponRefund,
    type ShapezzPermanentLevels,
    type ShapezzWeaponType
} from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.shapezzState.findFirst({ where: eq(shapezzState.userId, userId) })
    ])

    // Two first-visit requests can race the insert — the loser reads the row
    // the winner created instead of failing on the unique constraint.
    const state = existing
        ?? (await db.insert(shapezzState).values({ userId }).onConflictDoNothing().returning())[0]
        ?? (await db.query.shapezzState.findFirst({ where: eq(shapezzState.userId, userId) }))!
    const levels: ShapezzPermanentLevels = {
        core: state.coreLevel,
        overclock: state.overclockLevel,
        armor: state.armorLevel,
        thrusters: state.thrustersLevel,
        magnet: state.magnetLevel,
        killHeal: state.killHealLevel
    }
    const arsenal = shapezzArsenal(state)
    const equippedType = state.weaponType as ShapezzWeaponType
    const currentWeapon = shapezzWeapon(equippedType, arsenal[equippedType]?.rarity ?? 'common')

    return {
        balance,
        levels,
        power: shapezzPower(levels, currentWeapon),
        stats: shapezzPlayerStats(levels),
        currentWeapon,
        weapons: SHAPEZZ_WEAPONS.map((weapon) => {
            const ownedInType = arsenal[weapon.type]
            const owned = ownedInType.rarity === weapon.rarity
            // The trade-in only applies within the weapon's own type.
            const refund = owned ? 0 : shapezzWeaponRefund(ownedInType.rarity === null ? 0 : ownedInType.purchasePrice)
            return {
                ...weapon,
                owned,
                equipped: weapon.id === currentWeapon.id,
                refund,
                netCost: owned ? 0 : weapon.cost - refund
            }
        }),
        maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL,
        upgrades: SHAPEZZ_PERMANENT_UPGRADE_IDS.map(id => ({
            id,
            ...SHAPEZZ_PERMANENT_UPGRADES[id],
            level: levels[id],
            valueLabel: id === 'killHeal' ? `${shapezzPlayerStats(levels).healthPerKill} HP / kill` : null,
            cost: shapezzPermanentUpgradeCost(id, levels[id])
        })),
        difficulties: SHAPEZZ_DIFFICULTIES,
        runsPlayed: state.runsPlayed,
        totalCoinsEarned: state.totalCoinsEarned,
        bestSurvivalMs: state.bestSurvivalMs,
        bestKills: state.bestKills,
        bestCheckpoint: state.bestCheckpoint,
        activeRun: state.runStartedAt ? { startedAt: state.runStartedAt } : null,
        runCooldown: state.lastRunFinishedAt
            ? (() => {
                const until = new Date(state.lastRunFinishedAt.getTime() + SHAPEZZ_RUN_COOLDOWN_MS)
                return {
                    until,
                    rushCost: shapezzCooldownRushCost(until.getTime() - Date.now())
                }
            })()
            : null
    }
})
