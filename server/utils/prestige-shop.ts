import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import {
    bankState,
    colonyBuilderJobs,
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
    COLONY_BROOD_PACKS,
    COLONY_HIVE_SNAILS_PER_PURCHASE,
    COLONY_HIVE_SNAIL_TYPE_ID,
    CREDIT_LINE_PER_PURCHASE,
    HACK_DARKNET_AGENTS,
    HACK_DARKNET_ITEMS,
    HACK_GHOST_AGENTS,
    HACK_GHOST_ITEMS,
    MINER_CATALYST_STEPS,
    MINER_CORE_FACTORY_GRANT,
    MINER_CORE_RIG_GRANT,
    MINER_CORE_VAULT_GRANT,
    MINER_OVERCLOCK_STEPS,
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
    HABITAT_BUILDER_JOB_ID,
    UPGRADE_TRACKS,
    getBug,
    habitatTrackRequirement,
    rollEatRate,
    rollTraitPct,
    rollYieldLevel
} from '#shared/utils/colony'
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

// Both gem tracks are sold in two halves. `greatest` means a player who
// already bought levels with real gems keeps them — the perk raises the floor
// to this half's step, it never rolls anyone backwards.
const minerOverclock: Effect = async (tx, userId, owned) => {
    const level = MINER_OVERCLOCK_STEPS[owned - 1] ?? MINER_OVERCLOCK_STEPS.at(-1)!
    await ensureMinerState(tx, userId)
    await tx.update(minerState)
        .set({ overclockLevel: sql`greatest(${minerState.overclockLevel}, ${level})` })
        .where(eq(minerState.userId, userId))
}

const minerCatalyst: Effect = async (tx, userId, owned) => {
    const level = MINER_CATALYST_STEPS[owned - 1] ?? MINER_CATALYST_STEPS.at(-1)!
    await ensureMinerState(tx, userId)
    await tx.update(minerState)
        .set({ catalystLevel: sql`greatest(${minerState.catalystLevel}, ${level})` })
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

/**
 * Insert `quantity` bugs of each listed species, rolling traits exactly as a
 * bought bug would — against the player's own Research level for that species,
 * so a run that has already invested in Research gets better bugs out of the
 * same grant.
 */
async function grantBugs(tx: DbExecutor, userId: string, pack: { typeId: string, quantity: number }[]) {
    await ensureColonyState(tx, userId)

    const research = await tx.select({ typeId: colonyBugResearch.typeId, level: colonyBugResearch.level })
        .from(colonyBugResearch)
        .where(eq(colonyBugResearch.userId, userId))
    const levelFor = new Map(research.map(row => [row.typeId, row.level]))

    const rows = pack.flatMap((entry) => {
        const type = getBug(entry.typeId)
        if (!type) return []
        const level = levelFor.get(entry.typeId) ?? 0
        return Array.from({ length: entry.quantity }, () => ({
            userId,
            typeId: entry.typeId,
            speed: rollTraitPct(level),
            yield: rollYieldLevel(level),
            eat: rollEatRate(type)
        }))
    })
    if (rows.length) await tx.insert(colonyBugs).values(rows)
}

const colonyBrood: Effect = async (tx, userId, owned) => {
    const pack = COLONY_BROOD_PACKS[owned - 1]
    if (!pack) throw createError({ statusCode: 500, statusMessage: 'No Brood Seed pack for this purchase' })
    await grantBugs(tx, userId, pack)
}

const colonyHiveSnail: Effect = async (tx, userId) => {
    await grantBugs(tx, userId, [{ typeId: COLONY_HIVE_SNAIL_TYPE_ID, quantity: COLONY_HIVE_SNAILS_PER_PURCHASE }])
}

/**
 * Extra builders are not a row anywhere — how many a colony has is derived
 * from the purchase count itself (colonyBuilderCount), which the endpoints
 * read live. Nothing to write, and nothing to clean up on ascent beyond the
 * prestige_purchases row the wipe already clears.
 */
const colonyBuilder: Effect = async (tx, userId) => {
    await ensureColonyState(tx, userId)
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

    // Read the levels BEFORE writing any: "was this track raised?" cannot be
    // recovered from the post-update row, which looks identical whether the
    // uplink moved the track up to the requirement or the player was already
    // sitting exactly on it.
    const before = await tx.select({ trackId: colonyUpgrades.trackId, level: colonyUpgrades.level })
        .from(colonyUpgrades)
        .where(eq(colonyUpgrades.userId, userId))
    const levelBefore = new Map(before.map(row => [row.trackId, row.level]))

    // Every track has to clear its own requirement for this step before the
    // habitat can rise — the uplink pays all of them at once. `greatest` means
    // a track the player already pushed PAST the requirement is left alone.
    const raised: string[] = []
    for (const track of UPGRADE_TRACKS) {
        const required = habitatTrackRequirement(track.id, habitatLevel)
        if ((levelBefore.get(track.id) ?? 0) >= required) continue

        await tx.insert(colonyUpgrades)
            .values({ userId, trackId: track.id, level: required })
            .onConflictDoUpdate({
                // Column order matches the declared unique constraint.
                target: [colonyUpgrades.trackId, colonyUpgrades.userId],
                set: { level: sql`greatest(${colonyUpgrades.level}, ${required})` }
            })
        raised.push(track.id)
    }

    // Cancel only the builds this uplink actually invalidated.
    //
    // A builder targets "current level + 1", resolved at COLLECT time — so
    // raising a track's level under a running job silently retargets it at a
    // level the player never paid for, and the job has to go. But a track the
    // player had already pushed past the requirement was not touched by the
    // loop above, so its job is still building exactly what it was sold: it
    // keeps running. Cancelling those too (as this used to) burned the coins
    // and items already spent on them, with no refund.
    //
    // The habitat job always goes: this grants the level it was building.
    const doomed = [...raised, HABITAT_BUILDER_JOB_ID]
    await tx.delete(colonyBuilderJobs)
        .where(and(eq(colonyBuilderJobs.userId, userId), inArray(colonyBuilderJobs.trackId, doomed)))

    await tx.update(colonyState)
        .set({ habitatLevel: habitatLevel + 1 })
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
    'colony-hive-snail': colonyHiveSnail,
    'colony-builder': colonyBuilder,
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
