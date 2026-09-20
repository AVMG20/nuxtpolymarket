import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { voidItems, voidRunHistory, voidState } from '#server/database/schema'
import { credit, debit, debitGems } from '#server/utils/balance'
import { randomFloat } from '#shared/utils/random'
import {
    VOID_MAX_SECTOR, VOID_SHIP_IDS, VOID_TRADE_MAX_LEVEL, voidAddBundles, voidCanAfford, voidCleanBundle, voidDescribeState, voidNormalizeFit, voidNormalizeLevels,
    voidSector, voidSellPrice, voidSettleRun, voidSubtractBundle, voidTradeCost, voidTradeMult, voidUpgradeCost,
    type VoidPrice, type VoidResourceId, type VoidShipFit, type VoidUpgradeId
} from '#shared/utils/gamelogic/void'
import {
    VOID_ITEM_MILESTONES, VOID_ITEM_TYPES, VOID_MOD_IDS, voidItemName, voidRollBonusAffix, voidRollSalvagedGear, voidCanCraftTier, voidCraftCost, voidItemUpgradeCost, voidMod, voidRollItem, voidRollMod, voidSalvageValue,
    type VoidItem, type VoidItemKind
} from '#shared/utils/gamelogic/void-items'
import { voidPilotLevel, voidRunXp } from '#shared/utils/gamelogic/void-skills'
import {
    VOID_BLUEPRINT_KINDS, VOID_DAILY_BLUEPRINTS, VOID_DAILY_MARKS, VOID_DAILY_RELICS, VOID_PERK_IDS, voidAllowedDepth, voidBountyXp, voidCapitalKills, voidGearCap, voidLoreForSector, voidNormalizePerks, voidPerkCost, voidRunMarks, type VoidPerkId
} from '#shared/utils/gamelogic/void-pilot'
import {
    VOID_CONTRACTS_PER_DAY, VOID_SUPPLY_STOCK_MAX, voidContractDay, voidContractsFor, voidNormalizeSupplies, voidSupplyCost,
    type VoidSupplyId
} from '#shared/utils/gamelogic/void-station'
import { voidApplyBeaconReport, voidCleanBeacons, voidOwnedShips } from '#shared/utils/gamelogic/void'

export type VoidStateRow = typeof voidState.$inferSelect

/** Creates the row on first visit. Safe under concurrency thanks to the unique userId. */
export async function ensureVoidState(userId: string) {
    await db.insert(voidState).values({ userId }).onConflictDoNothing({ target: voidState.userId })
}

export async function getLockedVoidState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(voidState).where(eq(voidState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Void state not initialized' })
    return state
}

export { voidOwnedShips, voidLoadoutFor } from '#shared/utils/gamelogic/void'

export async function listVoidItems(executor: DbExecutor, userId: string): Promise<VoidItem[]> {
    const rows = await executor.select().from(voidItems).where(eq(voidItems.userId, userId))
    return rows.map(r => ({ id: r.id, kind: r.kind as VoidItemKind, type: r.type, tier: r.tier, rarity: r.rarity, level: r.level, affixes: r.affixes ?? {}, mod: r.mod }))
}

export function describeVoidState(s: VoidStateRow, balance: number, gems: number, items: VoidItem[]) {
    return voidDescribeState(s, balance, gems, items)
}

/**
 * Hands a new pilot a common T1 blaster, pulse turret, plate and deflector,
 * fitted to the Sparrow. Flipping `starterGranted` is the claim, so a burst of
 * first visits grants the kit once.
 */
const VOID_KIT_VERSION = 2

/**
 * Pilots who got the kit before secondaries and devices existed receive a
 * T1 Seeker Pods and Shield Booster once. The version bump is the claim.
 */
async function topUpVoidKit(tx: DbExecutor, userId: string) {
    const [claimed] = await tx.update(voidState).set({ kitVersion: VOID_KIT_VERSION })
        .where(and(eq(voidState.userId, userId), lt(voidState.kitVersion, VOID_KIT_VERSION)))
        .returning({ loadouts: voidState.loadouts, equippedShipId: voidState.equippedShipId })
    if (!claimed) return
    const kit = await tx.insert(voidItems).values([
        { userId, kind: 'secondary', type: 'seekers', tier: 1 },
        { userId, kind: 'device', type: 'booster', tier: 1 }
    ]).returning({ id: voidItems.id, kind: voidItems.kind })
    const current = (claimed.loadouts?.[claimed.equippedShipId] ?? {}) as Record<string, unknown>
    const fit = { ...current, secondary: current.secondary ?? kit.find(k => k.kind === 'secondary')!.id, device: current.device ?? kit.find(k => k.kind === 'device')!.id }
    await tx.update(voidState).set({ loadouts: { ...(claimed.loadouts ?? {}), [claimed.equippedShipId]: fit } }).where(eq(voidState.userId, userId))
}

export async function grantVoidStarterKit(userId: string) {
    await db.transaction(async (tx) => {
        const [claimed] = await tx.update(voidState).set({ starterGranted: true, kitVersion: VOID_KIT_VERSION })
            .where(and(eq(voidState.userId, userId), eq(voidState.starterGranted, false)))
            .returning({ loadouts: voidState.loadouts })
        if (!claimed) {
            await topUpVoidKit(tx, userId)
            return
        }
        const kit = await tx.insert(voidItems).values([
            { userId, kind: 'gun', type: 'blaster', tier: 1 },
            { userId, kind: 'turret', type: 'pulse', tier: 1 },
            { userId, kind: 'armor', type: 'plating', tier: 1 },
            { userId, kind: 'shield', type: 'deflector', tier: 1 },
            { userId, kind: 'secondary', type: 'seekers', tier: 1 },
            { userId, kind: 'device', type: 'booster', tier: 1 }
        ]).returning({ id: voidItems.id, kind: voidItems.kind })
        const id = (kind: string) => kit.find(k => k.kind === kind)!.id
        const fit: VoidShipFit = { gun: id('gun'), turrets: [id('turret')], armor: [id('armor')], shields: [id('shield')], secondary: id('secondary'), device: id('device') }
        await tx.update(voidState).set({ loadouts: { ...(claimed.loadouts ?? {}), sparrow: fit } }).where(eq(voidState.userId, userId))
    })
}

/**
 * Charges a shipyard price inside the caller's locked transaction and returns
 * the stores left over. Coins and gems go through the guarded debits, which
 * throw when short, so a parallel purchase can never overdraw either.
 */
export async function voidCharge(tx: DbExecutor, userId: string, stores: Record<string, number>, price: VoidPrice) {
    const held = voidCleanBundle(stores)
    if (!voidCanAfford(held, price.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })
    if (price.coins > 0) await debit(userId, price.coins.toFixed(4), 'game:void', tx)
    if (price.gems > 0) await debitGems(userId, price.gems, tx)
    return voidSubtractBundle(held, price.resources)
}

export interface VoidFinishReport {
    reason: 'extracted' | 'destroyed' | 'abandoned'
    haul: unknown
    elapsedMs: unknown
    kills: unknown
    wardenKilled: unknown
    skillUses?: unknown
    suppliesUsed?: unknown
    relics?: unknown
    depth?: unknown
    carrierKilled?: unknown
    tyrantKilled?: unknown
    harbingerKilled?: unknown
    lore?: unknown
    gearCaches?: unknown
    bonusXp?: unknown
    beaconsCaptured?: unknown
    beaconsDefended?: unknown
}

/**
 * Relic caches a run may bank: one once the run passes two minutes, one more
 * per three minutes of flight (a carrier kill drops two), plus the warden's
 * once the run has lasted long enough to have fought one.
 */
export function voidRelicCap(elapsedMs: number, wardenKilled: boolean) {
    return Math.min(5, (elapsedMs >= 120_000 ? 1 : 0) + Math.floor(elapsedMs / 180_000) + (wardenKilled && elapsedMs >= 240_000 ? 1 : 0))
}

/**
 * Settles the active run. Clearing `runStartedAt` inside the row lock is the
 * claim, so a double-submitted finish banks exactly once.
 */
export async function voidFinishRun(userId: string, body: VoidFinishReport) {
    const reason = body.reason
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (!s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'No active run' })

        const tier = s.runSector ?? 1
        const settled = voidSettleRun({
            extracted: reason === 'extracted',
            haul: voidCleanBundle(body.haul as Record<string, unknown>),
            elapsedMs: Number(body.elapsedMs) || 0,
            kills: Number(body.kills) || 0,
            wardenKilled: body.wardenKilled === true,
            carrierKilled: body.carrierKilled === true,
            tyrantKilled: body.tyrantKilled === true,
            harbingerKilled: body.harbingerKilled === true,
            depth: Number(body.depth) || 1
        }, tier, s.runCargo ?? 0, Date.now() - s.runStartedAt.getTime())

        const extracted = reason === 'extracted'
        const clearedNow = extracted && settled.wardenKilled && tier > s.highestSectorCleared
        const highestSectorCleared = clearedNow ? Math.min(VOID_MAX_SECTOR, tier) : s.highestSectorCleared
        // Relic caches only come home with the hold. The client reports how
        // many it picked up; the server caps that and rolls what they hold.
        const relicsToday = s.rewardsDay === voidContractDay() ? s.relicsToday : 0
        const relicRoom = Math.max(0, VOID_DAILY_RELICS - relicsToday)
        const relicCount = extracted ? Math.max(0, Math.min(Math.floor(Number(body.relics) || 0), voidRelicCap(settled.elapsedMs, settled.wardenKilled) + voidNormalizePerks(s.perks).relics, relicRoom)) : 0
        const relics: string[] = []
        const mods = { ...(s.mods ?? {}) }
        for (let i = 0; i < relicCount; i++) {
            const mod = voidRollMod(randomFloat)
            relics.push(mod)
            mods[mod] = (mods[mod] ?? 0) + 1
        }
        // Command Marks, a possible blueprint and lore logs only come home with the hold.
        const depth = voidAllowedDepth(Number(body.depth) || 1, settled.elapsedMs)
        const carrierKilled = body.carrierKilled === true
        const tyrantKilled = body.tyrantKilled === true
        const harbingerKilled = body.harbingerKilled === true
        const capitals = voidCapitalKills({ carrierKilled, tyrantKilled, harbingerKilled, depth }, settled.elapsedMs)
        // Marks and blueprints need a run that actually did something, and are
        // capped per UTC day: the server cannot see carrier kills or jumps.
        const today = voidContractDay()
        const sameDay = s.rewardsDay === today
        const marksToday = sameDay ? s.marksToday : 0
        const blueprintsToday = sameDay ? s.blueprintsToday : 0
        const earnest = settled.kills >= 10 && settled.units >= 100
        const marks = earnest ? Math.max(0, Math.min(VOID_DAILY_MARKS - marksToday, voidRunMarks({ extracted, wardenKilled: settled.wardenKilled, carrierKilled, tyrantKilled, harbingerKilled, depth, elapsedMs: settled.elapsedMs }))) : 0
        const blueprints = [...(s.blueprints ?? [])]
        let blueprint: string | null = null
        const blueprintChance = !extracted || !earnest || blueprintsToday >= VOID_DAILY_BLUEPRINTS ? 0 : (settled.wardenKilled ? 0.25 : 0) + (capitals.carrier ? 0.25 : 0) + (capitals.tyrant ? 0.25 : 0) + (capitals.harbinger ? 0.35 : 0)
        if (blueprintChance > 0 && randomFloat() < blueprintChance) {
            const pool = VOID_ITEM_TYPES.filter(t => VOID_BLUEPRINT_KINDS.includes(t.kind) && t.minTier <= Math.min(5, s.highestSectorCleared + 2) && !blueprints.includes(t.id))
            if (pool.length) {
                blueprint = pool[Math.floor(randomFloat() * pool.length)]!.id
                blueprints.push(blueprint)
            }
        }
        const sectorLore = voidLoreForSector(tier)
        const reportedLore = Array.isArray(body.lore) ? body.lore.map(String).filter(id => sectorLore.includes(id)) : []
        const newLore = extracted ? [...new Set(reportedLore)].filter(id => !(s.lore ?? []).includes(id)).slice(0, 3) : []
        // Salvaged gear: the client reports caches picked up; the server caps
        // them by time, warden and a daily limit, then rolls real items.
        const gearToday = sameDay ? s.gearToday : 0
        const gearCap = voidGearCap({ elapsedMs: settled.elapsedMs, wardenKilled: settled.wardenKilled, carrierKilled, tyrantKilled, harbingerKilled, depth, earnest }, gearToday)
        const gearCount = extracted ? Math.max(0, Math.min(Math.floor(Number(body.gearCaches) || 0), gearCap)) : 0
        const gearRolled = Array.from({ length: gearCount }, () => voidRollSalvagedGear(Math.min(tier, Math.min(5, s.highestSectorCleared + 1)), randomFloat))
        // XP is earned whether or not the hold made it home.
        const xp = voidRunXp({
            extracted,
            kills: settled.kills,
            elapsedMs: settled.elapsedMs,
            wardenKilled: settled.wardenKilled,
            tier,
            skillUses: Number(body.skillUses) || 0
        }) + voidBountyXp(body.bonusXp, settled.elapsedMs)

        // Beacons change hands whether or not the hold made it home: the fight was won out there.
        const beacons = voidApplyBeaconReport(voidCleanBeacons(s.beacons), tier, { captured: body.beaconsCaptured, defended: body.beaconsDefended }, Date.now(), settled.elapsedMs)

        // Clearing runStartedAt is the claim: a second finish in flight finds
        // it null and banks nothing.
        const [claimed] = await tx.update(voidState).set({
            runStartedAt: null,
            runSector: null,
            runShipId: null,
            runCargo: null,
            resources: voidAddBundles(voidCleanBundle(s.resources), settled.haul),
            runsPlayed: s.runsPlayed + 1,
            extractions: s.extractions + (extracted ? 1 : 0),
            kills: s.kills + settled.kills,
            wardensKilled: s.wardensKilled + (extracted && settled.wardenKilled ? 1 : 0),
            highestSectorCleared,
            bestHaulValue: Math.max(s.bestHaulValue, settled.value),
            pilotXp: s.pilotXp + xp,
            runSupplies: null,
            mods,
            marks: s.marks + marks,
            rewardsDay: today,
            marksToday: marksToday + marks,
            blueprintsToday: blueprintsToday + (blueprint ? 1 : 0),
            gearToday: gearToday + gearCount,
            relicsToday: relicsToday + relicCount,
            blueprints,
            lore: [...(s.lore ?? []), ...newLore],
            beacons: beacons.records
        }).where(and(eq(voidState.userId, userId), isNotNull(voidState.runStartedAt)))
            .returning({ userId: voidState.userId })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'No active run' })

        const gear = gearRolled.length
            ? await tx.insert(voidItems).values(gearRolled.map(item => ({ userId, ...item }))).returning({ id: voidItems.id, type: voidItems.type, tier: voidItems.tier, rarity: voidItems.rarity, affixes: voidItems.affixes })
            : []

        await tx.insert(voidRunHistory).values({
            userId,
            sector: tier,
            shipId: s.runShipId ?? s.equippedShipId,
            durationMs: settled.elapsedMs,
            haul: settled.haul,
            haulValue: settled.value,
            extracted,
            reason,
            kills: settled.kills,
            wardenKilled: extracted && settled.wardenKilled
        })

        return {
            reason,
            extracted,
            haul: settled.haul,
            value: settled.value,
            coinValue: Math.round(settled.value * voidTradeMult(s.tradeLevel)),
            units: settled.units,
            kills: settled.kills,
            trimmed: settled.trimmed,
            sectorCleared: clearedNow ? voidSector(tier).name : null,
            /** The sector this clear opened, when there is a deeper one. */
            sectorOpened: clearedNow && tier < VOID_MAX_SECTOR ? voidSector(tier + 1).name : null,
            /** A reported warden kill the run was too short to hold. Never silent: the pilot is told. */
            wardenRejected: extracted && body.wardenKilled === true && !settled.wardenKilled,
            xp,
            levelBefore: voidPilotLevel(s.pilotXp),
            levelAfter: voidPilotLevel(s.pilotXp + xp),
            relics,
            marks,
            blueprint,
            lore: newLore,
            depth,
            beaconsCaptured: beacons.captured,
            beaconsDefended: beacons.defended,
            gear: gear.map(g => ({ name: voidItemName(g), tier: g.tier, rarity: g.rarity })),
            /** Caches picked up that came back empty: over the run or daily limit. */
            gearEmpty: extracted ? Math.min(10, Math.max(0, Math.floor(Number(body.gearCaches) || 0) - gearCount)) : 0
        }
    })
}

/** The only place materials become coins. Lock-then-read on the stock. */
export async function voidSell(userId: string, resource: VoidResourceId, requested: number) {
    return db.transaction(async (tx) => {
        // Lock-then-read: the stock is read and written inside the row lock.
        const s = await getLockedVoidState(tx, userId)
        const held = voidCleanBundle(s.resources)
        const available = held[resource] ?? 0
        const amount = Math.min(available, requested)
        if (amount <= 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })

        const payout = amount * voidSellPrice(resource, s.tradeLevel)
        await tx.update(voidState).set({
            resources: voidCleanBundle({ ...held, [resource]: available - amount }),
            totalSold: s.totalSold + payout
        }).where(eq(voidState.userId, userId))
        await credit(userId, payout.toFixed(4), 'game:void', tx)
        return { resource, amount, payout }
    })
}

/** Trade Contracts: coins only, lock-then-read on the level. */
export async function voidBuyTrade(userId: string) {
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        const cost = voidTradeCost(s.tradeLevel)
        if (cost === null || s.tradeLevel >= VOID_TRADE_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })
        await debit(userId, cost.toFixed(4), 'game:void', tx)
        await tx.update(voidState).set({ tradeLevel: s.tradeLevel + 1 }).where(eq(voidState.userId, userId))
        return { level: s.tradeLevel + 1 }
    })
}

/** Buys supplies into station stock. Lock-then-read on stock and stores. */
export async function voidBuySupplies(userId: string, id: VoidSupplyId, count: number) {
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before restocking' })
        const stock = voidNormalizeSupplies(s.supplies)
        const n = Math.min(count, VOID_SUPPLY_STOCK_MAX - stock[id])
        if (n <= 0) throw createError({ statusCode: 400, statusMessage: 'Stock is full' })
        const unit = voidSupplyCost(id, s.highestSectorCleared, voidNormalizePerks(s.perks).quartermaster > 0)
        const price = {
            resources: Object.fromEntries(Object.entries(unit.resources).map(([k, v]) => [k, v! * n])),
            coins: unit.coins * n,
            gems: 0
        }
        const resources = await voidCharge(tx, userId, s.resources, price)
        await tx.update(voidState).set({ supplies: { ...stock, [id]: stock[id] + n }, resources }).where(eq(voidState.userId, userId))
        return { supply: id, stock: stock[id] + n }
    })
}

/**
 * Delivers one of today's station contracts. The completed-index list is read
 * and written inside the row lock, so a contract pays exactly once.
 */
export async function voidClaimContract(userId: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= VOID_CONTRACTS_PER_DAY) throw createError({ statusCode: 400, statusMessage: 'Invalid contract' })
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        const day = voidContractDay()
        const done = s.contractsDay === day ? (s.contractsDone ?? []) : []
        if (done.includes(index)) throw createError({ statusCode: 400, statusMessage: 'Contract already delivered' })
        const contract = voidContractsFor(userId, day, s.highestSectorCleared, s.tradeLevel)[index]!
        const resources = await voidCharge(tx, userId, s.resources, { resources: { [contract.resource]: contract.amount }, coins: 0, gems: 0 })
        await tx.update(voidState).set({
            resources,
            contractsDay: day,
            contractsDone: [...done, index],
            pilotXp: s.pilotXp + contract.xp,
            totalSold: s.totalSold + contract.coins
        }).where(eq(voidState.userId, userId))
        await credit(userId, contract.coins.toFixed(4), 'game:void', tx)
        return { contract }
    })
}

/** Buys one rank of a pilot perk with Command Marks. Lock-then-read on marks and ranks. */
export async function voidBuyPerk(userId: string, id: VoidPerkId) {
    if (!VOID_PERK_IDS.includes(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid perk' })
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        const ranks = voidNormalizePerks(s.perks)
        const cost = voidPerkCost(id, ranks[id])
        if (cost === null) throw createError({ statusCode: 400, statusMessage: 'Already at max rank' })
        if (s.marks < cost) throw createError({ statusCode: 400, statusMessage: 'Not enough Command Marks' })
        await tx.update(voidState).set({ marks: s.marks - cost, perks: { ...ranks, [id]: ranks[id] + 1 } }).where(eq(voidState.userId, userId))
        return { perk: id, rank: ranks[id] + 1 }
    })
}

export async function voidBuyUpgrade(userId: string, id: VoidUpgradeId) {
    return db.transaction(async (tx) => {
        // Lock-then-read: the level is read and written inside the row lock,
        // so two parallel refits cannot both pay for the same level.
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })
        const levels = voidNormalizeLevels(s.upgradeLevels)
        const price = voidUpgradeCost(id, levels[id])
        if (!price) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })
        const resources = await voidCharge(tx, userId, s.resources, price)
        const next = { ...levels, [id]: levels[id] + 1 }
        await tx.update(voidState).set({ upgradeLevels: next, resources }).where(eq(voidState.userId, userId))
        return { upgrade: id, level: next[id] }
    })
}

// ─── Gear ───────────────────────────────────────────────────────────────────

/** Crafts one item. The row lock serialises crafts; the roll uses the CSPRNG. */
export async function voidCraftItem(userId: string, kind: VoidItemKind, type: string, tier: number) {
    const def = VOID_ITEM_TYPES.find(t => t.id === type && t.kind === kind)
    if (!def || !Number.isInteger(tier) || tier < def.minTier) throw createError({ statusCode: 400, statusMessage: 'Invalid blueprint' })
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (!voidCanCraftTier(tier, s.highestSectorCleared)) throw createError({ statusCode: 400, statusMessage: `Clear sector ${tier - 1} to craft T${tier}` })
        const resources = await voidCharge(tx, userId, s.resources, voidCraftCost(kind, tier, type))
        const rolled = voidRollItem(kind, type, tier, randomFloat, (s.blueprints ?? []).includes(type))
        await tx.update(voidState).set({ resources }).where(eq(voidState.userId, userId))
        const [row] = await tx.insert(voidItems).values({ userId, ...rolled }).returning()
        return { item: { ...rolled, id: row!.id } }
    })
}

async function lockedItem(tx: DbExecutor, userId: string, itemId: string) {
    const [row] = await tx.select().from(voidItems).where(and(eq(voidItems.id, itemId), eq(voidItems.userId, userId))).for('update')
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
    return row
}

/** Levels an item. State row first, then the item row, both locked. */
export async function voidUpgradeItem(userId: string, itemId: string) {
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before upgrading' })
        const item = await lockedItem(tx, userId, itemId)
        const price = voidItemUpgradeCost({ kind: item.kind as VoidItemKind, type: item.type, tier: item.tier, level: item.level })
        if (!price) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })
        const resources = await voidCharge(tx, userId, s.resources, price)
        await tx.update(voidState).set({ resources }).where(eq(voidState.userId, userId))
        const level = item.level + 1
        // Milestone levels roll a bonus affix.
        const milestone = VOID_ITEM_MILESTONES.includes(level)
        const affixes = milestone ? voidRollBonusAffix({ kind: item.kind as VoidItemKind, rarity: item.rarity, affixes: item.affixes ?? {} }, randomFloat) : item.affixes
        await tx.update(voidItems).set({ level, affixes }).where(eq(voidItems.id, item.id))
        return { itemId, level, milestone }
    })
}

/** Scraps an item for a quarter of its craft materials. The delete is the claim. */
export async function voidSalvageItem(userId: string, itemId: string) {
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before salvaging' })
        const [row] = await tx.delete(voidItems).where(and(eq(voidItems.id, itemId), eq(voidItems.userId, userId))).returning()
        if (!row) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
        const refund = voidSalvageValue({ kind: row.kind as VoidItemKind, type: row.type, tier: row.tier })
        // Pull it off every hull it was fitted to.
        const loadouts: Record<string, unknown> = {}
        for (const [shipId, raw] of Object.entries(s.loadouts ?? {})) {
            const fit = raw as Partial<VoidShipFit>
            const strip = (list: unknown) => (Array.isArray(list) ? list.map(x => (x === itemId ? null : x)) : [])
            loadouts[shipId] = { gun: fit.gun === itemId ? null : fit.gun ?? null, turrets: strip(fit.turrets), armor: strip(fit.armor), shields: strip(fit.shields) }
        }
        await tx.update(voidState).set({ resources: voidAddBundles(voidCleanBundle(s.resources), refund), loadouts }).where(eq(voidState.userId, userId))
        return { itemId, refund }
    })
}

/** Sockets a relic mod, consuming it. Anything already socketed is destroyed. */
export async function voidSocketMod(userId: string, itemId: string, modId: string) {
    const mod = voidMod(modId)
    if (!mod || !VOID_MOD_IDS.includes(mod.id)) throw createError({ statusCode: 400, statusMessage: 'Invalid mod' })
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before socketing' })
        const item = await lockedItem(tx, userId, itemId)
        if (!mod.kinds.includes(item.kind as VoidItemKind)) throw createError({ statusCode: 400, statusMessage: 'That mod does not fit this item' })
        const held = Math.floor(Number(s.mods?.[mod.id]) || 0)
        if (held < 1) throw createError({ statusCode: 400, statusMessage: 'No mod of that kind' })
        await tx.update(voidState).set({ mods: { ...(s.mods ?? {}), [mod.id]: held - 1 } }).where(eq(voidState.userId, userId))
        await tx.update(voidItems).set({ mod: mod.id }).where(eq(voidItems.id, item.id))
        return { itemId, mod: mod.id }
    })
}

/** Fits gear to a hull. Unknown or mismatched ids simply become empty slots. */
export async function voidSetFit(userId: string, shipId: string, raw: unknown) {
    if (!VOID_SHIP_IDS.includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid ship' })
    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })
        if (!voidOwnedShips(s).includes(shipId)) throw createError({ statusCode: 400, statusMessage: 'Ship not owned' })
        const items = await listVoidItems(tx, userId)
        const fit = voidNormalizeFit(shipId, raw, items)
        await tx.update(voidState).set({ loadouts: { ...(s.loadouts ?? {}), [shipId]: fit } }).where(eq(voidState.userId, userId))
        return { shipId, fit }
    })
}
