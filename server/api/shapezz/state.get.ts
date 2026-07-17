import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { shapezzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    SHAPEZZ_DIFFICULTIES,
    SHAPEZZ_MAX_PERMANENT_LEVEL,
    SHAPEZZ_PERMANENT_UPGRADE_IDS,
    SHAPEZZ_PERMANENT_UPGRADES,
    SHAPEZZ_WEAPONS,
    shapezzPermanentUpgradeCost,
    shapezzPlayerStats,
    shapezzPower,
    shapezzWeapon,
    shapezzWeaponRefund,
    type ShapezzPermanentLevels
} from '#shared/utils/gamelogic/shapezz'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const [balance, existing] = await Promise.all([
        getBalance(userId),
        db.query.shapezzState.findFirst({ where: eq(shapezzState.userId, userId) })
    ])

    const state = existing ?? (await db.insert(shapezzState).values({ userId }).returning())[0]!
    const levels: ShapezzPermanentLevels = {
        core: state.coreLevel,
        overclock: state.overclockLevel,
        armor: state.armorLevel,
        thrusters: state.thrustersLevel,
        magnet: state.magnetLevel,
        killHeal: state.killHealLevel
    }
    const currentWeapon = shapezzWeapon(state.weaponType, state.weaponRarity)
    const weaponRefund = shapezzWeaponRefund(state.weaponPurchasePrice)

    return {
        balance,
        levels,
        power: shapezzPower(levels, currentWeapon),
        stats: shapezzPlayerStats(levels),
        currentWeapon: { ...currentWeapon, purchasePrice: state.weaponPurchasePrice, refund: weaponRefund },
        weapons: SHAPEZZ_WEAPONS.map(weapon => ({
            ...weapon,
            equipped: weapon.id === currentWeapon.id,
            refund: weapon.id === currentWeapon.id ? 0 : weaponRefund,
            netCost: weapon.id === currentWeapon.id ? 0 : weapon.cost - weaponRefund
        })),
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
        activeRun: state.runStartedAt ? { startedAt: state.runStartedAt } : null
    }
})
