import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import {
    bankState,
    colonyBugResearch,
    colonyBugs,
    colonyState,
    colonyUpgrades,
    hackAgents,
    hackItems,
    hackState,
    minerState,
    prestigePurchases,
    user,
    xenoPlants,
    xenoPlantsUnlocked
} from '#server/database/schema'
import { debitPrestigeTokens } from '#server/utils/balance'
import {
    CREDIT_LINE_PER_PURCHASE,
    HACK_DARKNET_AGENTS,
    HACK_DARKNET_ITEMS,
    HACK_GHOST_AGENTS,
    HACK_GHOST_ITEMS,
    MINER_CORE_FACTORY_GRANT,
    MINER_CORE_RIG_GRANT,
    MINER_CORE_VAULT_GRANT,
    XENO_LEAP_FIRST_TIER,
    XENO_LEAP_PLANTS_PER_TYPE,
    minerFactoryMaxLevel,
    minerRigMaxLevel,
    minerVaultMaxLevel,
    prestigeShopItem,
    xenoLeapTier,
    type PrestigeShopItem
} from '#shared/utils/prestige-shop'
import {
    MAX_TIER as COLONY_MAX_TIER,
    UPGRADE_TRACKS,
    getBug,
    habitatTrackRequirement,
    rollEatRate,
    rollTraitPct,
    rollYieldLevel
} from '#shared/utils/colony'
import { CATALYST_MAX_LEVEL, OVERCLOCK_MAX_LEVEL } from '#shared/utils/miner-config'
import {
    AGENT_PULL_TIERS,
    ITEM_PULL_TIERS,
    MAX_AGENTS,
    MAX_INVENTORY_SLOTS,
    generateAgentDef,
    rollItemFromTier,
    rollRarity
} from '#shared/utils/hack-config'
import { PLANT_TYPES } from '#shared/utils/xeno'
import { LOAN_MULTIPLIER } from '#shared/utils/gamelogic/bank'

/**
 * Applies one purchase's effect. Runs inside the caller's transaction, which
 * already holds a FOR UPDATE lock on the user row — every write here must go
 * through `tx` or it deadlocks against that lock on a second pool connection.
 *
 * `owned` is the count AFTER this purchase, so the first purchase sees 1.
 */
type Effect = (tx: DbExecutor, userId: string, owned: number) => Promise<void>

// ─── Miner ────────────────────────────────────────────────────────────────────

async function ensureMinerState(tx: DbExecutor, userId: string) {
    await tx.insert(minerState).values({ userId }).onConflictDoNothing()
}

const minerCore: Effect = async (tx, userId, owned) => {
    await ensureMinerState(tx, userId)
    // `least` clamps to the ceiling this purchase just raised, so a player who
    // is already at the old cap gets the full grant and nobody overshoots.
    await tx.update(minerState)
        .set({
            rigLevel: sql`least(${minerState.rigLevel} + ${MINER_CORE_RIG_GRANT}, ${minerRigMaxLevel(owned)})`,
            vaultLevel: sql`least(${minerState.vaultLevel} + ${MINER_CORE_VAULT_GRANT}, ${minerVaultMaxLevel(owned)})`,
            factoryLevel: sql`least(${minerState.factoryLevel} + ${MINER_CORE_FACTORY_GRANT}, ${minerFactoryMaxLevel(owned)})`
        })
        .where(eq(minerState.userId, userId))
}

const minerOverclock: Effect = async (tx, userId) => {
    await ensureMinerState(tx, userId)
    await tx.update(minerState)
        .set({ overclockLevel: sql`greatest(${minerState.overclockLevel}, ${OVERCLOCK_MAX_LEVEL})` })
        .where(eq(minerState.userId, userId))
}

const minerCatalyst: Effect = async (tx, userId) => {
    await ensureMinerState(tx, userId)
    await tx.update(minerState)
        .set({ catalystLevel: sql`greatest(${minerState.catalystLevel}, ${CATALYST_MAX_LEVEL})` })
        .where(eq(minerState.userId, userId))
}

// ─── Xeno ─────────────────────────────────────────────────────────────────────

const xenoLeap: Effect = async (tx, userId, owned) => {
    const tier = xenoLeapTier(owned - 1)
    // The first leap has to hand over everything below it too, or the player
    // lands on T3 with nothing to breed from. Later leaps stock only their own
    // tier — the lower ones are already in the encyclopedia by then.
    const tiers = owned === 1
        ? Array.from({ length: XENO_LEAP_FIRST_TIER }, (_, i) => i + 1)
        : [tier]

    const types = PLANT_TYPES.filter(plant => tiers.includes(plant.tier))
    if (!types.length) return

    await tx.insert(xenoPlants).values(
        types.flatMap(type => Array.from({ length: XENO_LEAP_PLANTS_PER_TYPE }, () => ({
            userId,
            typeId: type.id,
            speed: type.speed,
            yield: type.yield
        })))
    )

    // xeno_plants_unlocked has no (user, type) unique constraint, so
    // onConflictDoNothing would only catch duplicate ids — check first.
    const typeIds = types.map(type => type.id)
    const existing = await tx.select({ typeId: xenoPlantsUnlocked.typeId })
        .from(xenoPlantsUnlocked)
        .where(and(eq(xenoPlantsUnlocked.userId, userId), inArray(xenoPlantsUnlocked.typeId, typeIds)))
    const known = new Set(existing.map(row => row.typeId))

    const missing = typeIds.filter(typeId => !known.has(typeId))
    if (missing.length) {
        await tx.insert(xenoPlantsUnlocked).values(missing.map(typeId => ({ userId, typeId })))
    }
}

// ─── Colony ───────────────────────────────────────────────────────────────────

async function ensureColonyState(tx: DbExecutor, userId: string) {
    await tx.insert(colonyState).values({ userId }).onConflictDoNothing()
}

const colonyBrood: Effect = async (tx, userId) => {
    await ensureColonyState(tx, userId)

    const research = await tx.select({ typeId: colonyBugResearch.typeId, level: colonyBugResearch.level })
        .from(colonyBugResearch)
        .where(eq(colonyBugResearch.userId, userId))
    const levelFor = new Map(research.map(row => [row.typeId, row.level]))

    const rows = ['larva', 'grub'].flatMap((typeId) => {
        const type = getBug(typeId)
        if (!type) return []
        const level = levelFor.get(typeId) ?? 0
        return [{
            userId,
            typeId,
            speed: rollTraitPct(level),
            yield: rollYieldLevel(level),
            eat: rollEatRate(type)
        }]
    })
    if (rows.length) await tx.insert(colonyBugs).values(rows)
}

const colonyUplink: Effect = async (tx, userId) => {
    await ensureColonyState(tx, userId)

    const [state] = await tx.select({ habitatLevel: colonyState.habitatLevel })
        .from(colonyState)
        .where(eq(colonyState.userId, userId))
    const habitatLevel = state?.habitatLevel ?? 1
    if (habitatLevel >= COLONY_MAX_TIER) {
        throw createError({ statusCode: 400, statusMessage: `Habitat is already at level ${COLONY_MAX_TIER}` })
    }

    // Every track has to clear its own requirement for this step before the
    // habitat can rise — the uplink pays all of them at once.
    for (const track of UPGRADE_TRACKS) {
        const required = habitatTrackRequirement(track.id, habitatLevel)
        await tx.insert(colonyUpgrades)
            .values({ userId, trackId: track.id, level: required })
            .onConflictDoUpdate({
                // Column order matches the declared unique constraint.
                target: [colonyUpgrades.trackId, colonyUpgrades.userId],
                set: { level: sql`greatest(${colonyUpgrades.level}, ${required})` }
            })
    }

    // Cancelling the builder is deliberate: whatever it was mid-way through is
    // at or below the level just granted, so leaving it running would let the
    // player collect a level they already have.
    await tx.update(colonyState)
        .set({ habitatLevel: habitatLevel + 1, builderTrackId: null, builderStartedAt: null })
        .where(eq(colonyState.userId, userId))
}

// ─── HackOps ──────────────────────────────────────────────────────────────────

/**
 * Grant agents and items from named pull tiers, rolled exactly as the shop
 * would roll them. Refuses rather than silently dropping the overflow when the
 * roster or inventory cannot hold the whole package — losing tokens for gear
 * that never arrives is worse than a failed purchase.
 */
async function grantHackPackage(
    tx: DbExecutor,
    userId: string,
    agentTierId: string,
    agentCount: number,
    itemTierId: string,
    itemCount: number
) {
    const agentTier = AGENT_PULL_TIERS.find(tier => tier.id === agentTierId)
    const itemTier = ITEM_PULL_TIERS.find(tier => tier.id === itemTierId)
    if (!agentTier || !itemTier) throw createError({ statusCode: 500, statusMessage: 'Unknown pull tier' })

    await tx.insert(hackState).values({ userId }).onConflictDoNothing()

    // Sequential, not Promise.all: `tx` is a single pinned pg connection and
    // cannot run two queries at once.
    const agents = await tx.select({ name: hackAgents.name, active: hackAgents.active })
        .from(hackAgents).where(eq(hackAgents.userId, userId))
    const items = await tx.select({ equippedBy: hackItems.equippedBy })
        .from(hackItems).where(eq(hackItems.userId, userId))
    const [state] = await tx.select({ rosterSlots: hackState.rosterSlots })
        .from(hackState).where(eq(hackState.userId, userId))

    if (agents.length + agentCount > MAX_AGENTS) {
        throw createError({ statusCode: 400, statusMessage: `Not enough room for ${agentCount} agents — fire someone first (${MAX_AGENTS} max).` })
    }
    const freeInventory = MAX_INVENTORY_SLOTS - items.filter(item => !item.equippedBy).length
    if (itemCount > freeInventory) {
        throw createError({ statusCode: 400, statusMessage: `Not enough room for ${itemCount} items — sell some unequipped gear first.` })
    }

    const takenNames = agents.map(agent => agent.name)
    let activeCount = agents.filter(agent => agent.active).length
    const rosterSlots = state?.rosterSlots ?? 0

    const agentRows = Array.from({ length: agentCount }, () => {
        const def = generateAgentDef(rollRarity(agentTier.weights), takenNames)
        takenNames.push(def.name)
        // Fill the active roster first, then storage — same rule as recruiting.
        const active = activeCount < rosterSlots
        if (active) activeCount++
        return { userId, ...def, active }
    })
    if (agentRows.length) {
        await tx.insert(hackAgents).values(agentRows)
        await tx.update(hackState)
            .set({ totalRecruits: sql`${hackState.totalRecruits} + ${agentRows.length}` })
            .where(eq(hackState.userId, userId))
    }

    const itemRows = Array.from({ length: itemCount }, () => {
        const def = rollItemFromTier(itemTier)
        return { userId, name: def.name, slot: def.slot, itemLevel: def.itemLevel, rarity: def.rarity, mods: def.mods }
    })
    if (itemRows.length) await tx.insert(hackItems).values(itemRows)
}

const hackGhost: Effect = async (tx, userId) => {
    await grantHackPackage(tx, userId, 'elite', HACK_GHOST_AGENTS, 'ghost_cache', HACK_GHOST_ITEMS)
}

const hackDarknet: Effect = async (tx, userId) => {
    await grantHackPackage(tx, userId, 'advanced', HACK_DARKNET_AGENTS, 'premium', HACK_DARKNET_ITEMS)
}

// ─── Account ──────────────────────────────────────────────────────────────────

const accountRakeback: Effect = async (tx, userId) => {
    await tx.update(user).set({ rakebackUnlocked: true }).where(eq(user.id, userId))
}

/**
 * The bank lends LOAN_MULTIPLIER times the all-time deposit high-water mark,
 * so granting borrowing power is exactly a bump to that mark — no bank code
 * has to learn about prestige at all, and it dies with bank_state on the next
 * ascent like every other perk.
 */
const accountCredit: Effect = async (tx, userId) => {
    const bump = (CREDIT_LINE_PER_PURCHASE / LOAN_MULTIPLIER).toFixed(4)
    await tx.insert(bankState).values({ userId, maxPrincipal: bump }).onConflictDoUpdate({
        target: bankState.userId,
        set: { maxPrincipal: sql`${bankState.maxPrincipal} + ${bump}::numeric` }
    })
}

const EFFECTS: Record<string, Effect> = {
    'miner-core': minerCore,
    'miner-overclock': minerOverclock,
    'miner-catalyst': minerCatalyst,
    'xeno-leap': xenoLeap,
    'colony-brood': colonyBrood,
    'colony-uplink': colonyUplink,
    'hack-ghost': hackGhost,
    'hack-darknet': hackDarknet,
    'account-rakeback': accountRakeback,
    'account-credit': accountCredit
}

export interface PrestigePurchaseResult {
    itemId: string
    owned: number
    spent: number
    tokensLeft: number
}

/** How many of each shop item this run has bought. Missing keys mean zero. */
export async function getPrestigePurchases(userId: string, ex: DbExecutor = db): Promise<Record<string, number>> {
    const rows = await ex.select({ itemId: prestigePurchases.itemId, count: prestigePurchases.count })
        .from(prestigePurchases)
        .where(eq(prestigePurchases.userId, userId))

    const owned: Record<string, number> = {}
    for (const row of rows) owned[row.itemId] = row.count
    return owned
}

/** Live count for one item — used by the games that read a raised ceiling. */
export async function getPrestigePurchaseCount(userId: string, itemId: string, ex: DbExecutor = db): Promise<number> {
    const [row] = await ex.select({ count: prestigePurchases.count })
        .from(prestigePurchases)
        .where(and(eq(prestigePurchases.userId, userId), eq(prestigePurchases.itemId, itemId)))
    return row?.count ?? 0
}

/**
 * Buy one unit of a shop item.
 *
 * The price depends on how many are already owned, so this cannot be expressed
 * as a single conditional UPDATE — it takes the `FOR UPDATE` lock on the user
 * row first (pattern B) and reads the owned count inside it. Two concurrent
 * buys therefore serialize: the second one sees the first one's count, pays the
 * escalated price, and trips the maxOwned guard when the item is exhausted.
 */
export async function buyPrestigeShopItem(userId: string, itemId: string): Promise<PrestigePurchaseResult> {
    const item = prestigeShopItem(itemId)
    if (!item) throw createError({ statusCode: 400, statusMessage: 'Unknown shop item' })

    const effect = EFFECTS[item.id]
    if (!effect) throw createError({ statusCode: 500, statusMessage: 'Shop item has no effect' })

    return db.transaction(async (tx) => {
        const [locked] = await tx.select({ prestige: user.prestige })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
        if (!locked) throw createError({ statusCode: 404, statusMessage: 'User not found' })
        if (locked.prestige < 1) {
            throw createError({ statusCode: 400, statusMessage: 'Prestige at least once to unlock the shop' })
        }

        const owned = await getPrestigePurchaseCount(userId, item.id, tx)
        assertAvailable(item, owned)

        const cost = item.cost(owned)
        const tokensLeft = await debitPrestigeTokens(userId, cost, tx)

        await tx.insert(prestigePurchases)
            .values({ userId, itemId: item.id, count: 1 })
            .onConflictDoUpdate({
                target: [prestigePurchases.userId, prestigePurchases.itemId],
                set: { count: sql`${prestigePurchases.count} + 1` }
            })

        await effect(tx, userId, owned + 1)

        return { itemId: item.id, owned: owned + 1, spent: cost, tokensLeft }
    })
}

function assertAvailable(item: PrestigeShopItem, owned: number) {
    if (owned >= item.maxOwned) {
        throw createError({ statusCode: 400, statusMessage: `${item.name} is fully bought for this run` })
    }
}
