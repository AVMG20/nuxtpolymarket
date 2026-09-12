import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { user, townState, townPlots, townBuildings, townInventory, townOrders, townTrades, townProduction, townResearch, townRealm } from '#server/database/schema'
import { credit, creditGems, debit, debitGems } from '#server/utils/balance'
import { matchGemOrder } from '#shared/utils/gamelogic/gem-exchange'
import {
    TOWN_PLOT_SIZE,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MAX_PLOTS,
    townBuildingMaxLevel,
    TOWN_MARKET_MAX_OPEN_ORDERS,
    TOWN_MARKET_HISTORY_LIMIT,
    TOWN_MARKET_BOOK_DEPTH,
    TOWN_MARKET_MIN_PRICE,
    TOWN_RESOURCES,
    getTownBuilding,
    getTownResource,
    isTownResourceId,
    townLevelCost,
    townLevelBuildMs,
    townRushGemCost,
    townPlotCooldownMs,
    townPlotPrice,
    townPlotRefundFor,
    isValidTownListPrice,
    TOWN_FOUNDING_GAP,
    townSpiralCoords,
    townPlotIsFlat,
    townFloorPrice,
    type TownResearchBonus,
    townCeilingPrice,
    TOWN_MAX_ORDER_PRICE,
    townOrderTotal,
    isValidTownPrice,
    isValidTownQuantity,
    settleTown,
    deriveTown,
    townTierRequirement,
    townPlaceCost,
    townPlacementIssue,
    townGroupMoveIssue,
    TOWN_MAX_DRAG_TILES,
    type TownGroupMove,
    townMilestoneSnapshot,
    townMilestoneComplete,
    getTownMilestone,
    TOWN_MILESTONES,
    townBuildersFree,
    townBuilderGemCost,
    TOWN_MAX_BUILDERS,
    townBuildingCountIssue,
    townJewelsFor,
    type TownResourceId,
    type TownResourceBag,
    type TownSimBuilding,
    type TownSatisfied
} from '#shared/utils/gamelogic/town'
import { townResearchEffects } from '#shared/utils/gamelogic/town-research'

const CATEGORY = 'polytown'
/**
 * Coins returning to the player who escrowed them: change on a cheaper fill,
 * and the refund on a cancelled order. Tagged so the bank does not garnish
 * money the player never earned — see isEarning in server/utils/balance.ts.
 */
const CATEGORY_REFUND = 'polytown:refund'

// App-unique advisory lock keys. Plot claiming serializes on one global key so
// spiral indexes never collide; each resource book gets its own key so matching
// on wheat never waits on a steel trade.
const TOWN_PLOT_LOCK_KEY = 761_442_020
const TOWN_MARKET_LOCK_BASE = 761_442_100

async function lockPlots(tx: DbExecutor) {
    await tx.execute(sql`select pg_advisory_xact_lock(${TOWN_PLOT_LOCK_KEY})`)
}

async function lockBook(tx: DbExecutor, resource: TownResourceId) {
    const key = TOWN_MARKET_LOCK_BASE + TOWN_RESOURCES.findIndex(r => r.id === resource)
    await tx.execute(sql`select pg_advisory_xact_lock(${key})`)
}

// ─── State ───────────────────────────────────────────────────────────────────

export async function getTownState(userId: string, ex: DbExecutor = db) {
    return ex.query.townState.findFirst({ where: eq(townState.userId, userId) })
}

/**
 * Pattern B: every town mutation starts here. The FOR UPDATE lock on the state
 * row serializes settles, builds, rushes and plot buys for one player, so the
 * values read afterwards inside `tx` are never stale.
 */
async function lockTownState(tx: DbExecutor, userId: string) {
    const [row] = await tx.select().from(townState).where(eq(townState.userId, userId)).for('update')
    if (!row) throw createError({ statusCode: 400, statusMessage: 'Found a town first' })
    return row
}

/**
 * Pass `lock: true` from inside a transaction that is about to write deltas
 * derived from what it read (settle does): the FOR UPDATE makes a concurrent
 * sell/escrow wait, so the settle can never subtract inputs the player has
 * meanwhile sold — the read-then-write race CLAUDE.md warns about.
 */
export async function getInventory(userId: string, ex: DbExecutor = db, lock = false): Promise<TownResourceBag> {
    const query = ex.select().from(townInventory).where(eq(townInventory.userId, userId))
    const rows = lock ? await query.for('update') : await query
    const bag: TownResourceBag = {}
    for (const row of rows) {
        if (isTownResourceId(row.resource)) bag[row.resource] = row.amount
    }
    return bag
}

/**
 * Upsert-increment. Never writes an absolute value, so concurrent fills and
 * settles commute.
 *
 * Both halves floor at zero. A town cannot hold negative stock, and a shelf
 * that does not exist yet holds nothing rather than a debt — consuming from an
 * empty larder is a no-op, not a hole to be filled later.
 */
export async function addInventory(tx: DbExecutor, userId: string, resource: TownResourceId, delta: number) {
    if (delta === 0) return
    await tx.insert(townInventory)
        .values({ userId, resource, amount: Math.max(0, delta) })
        .onConflictDoUpdate({
            target: [townInventory.userId, townInventory.resource],
            set: { amount: sql`greatest(0, ${townInventory.amount} + ${delta})` }
        })
}

/** Conditional decrement — the `amount >= qty` guard is the check. Throws 400 if short. */
export async function takeInventory(tx: DbExecutor, userId: string, resource: TownResourceId, qty: number) {
    if (qty <= 0) return
    const [row] = await tx.update(townInventory)
        .set({ amount: sql`${townInventory.amount} - ${qty}` })
        .where(and(
            eq(townInventory.userId, userId),
            eq(townInventory.resource, resource),
            gte(townInventory.amount, qty)
        ))
        .returning({ amount: townInventory.amount })
    if (!row) {
        const def = getTownResource(resource)
        throw createError({ statusCode: 400, statusMessage: `Not enough ${def?.name ?? resource}` })
    }
}

export async function spendBag(tx: DbExecutor, userId: string, bag: TownResourceBag) {
    for (const [id, qty] of Object.entries(bag) as [TownResourceId, number][]) {
        await takeInventory(tx, userId, id, qty)
    }
}

export function toSim(row: typeof townBuildings.$inferSelect, plot?: { x: number, y: number }): TownSimBuilding {
    return {
        id: row.id,
        type: row.type as TownSimBuilding['type'],
        level: row.level,
        completesAt: row.completesAt.getTime(),
        upgradingTo: row.upgradingTo,
        createdAt: row.createdAt.getTime(),
        wx: plot ? plot.x * TOWN_PLOT_SIZE + row.tileX : undefined,
        wy: plot ? plot.y * TOWN_PLOT_SIZE + row.tileY : undefined,
        rotation: row.rotation
    }
}

export async function getPlotMap(userId: string, ex: DbExecutor = db) {
    const plots = await ex.select().from(townPlots).where(eq(townPlots.userId, userId)).orderBy(townPlots.createdAt)
    return { plots, byId: new Map(plots.map(p => [p.id, p])) }
}

export interface SettledTown {
    state: typeof townState.$inferSelect
    buildings: (typeof townBuildings.$inferSelect)[]
    plots: (typeof townPlots.$inferSelect)[]
    sim: TownSimBuilding[]
    inventory: TownResourceBag
    completed: { id: string, level: number }[]
    /** What the settle window produced/consumed, and how long it was — for the welcome-back summary. */
    delta: TownResourceBag
    elapsedMs: number
    /** Which needs the last tick could supply. */
    satisfied: TownSatisfied
    /**
     * What this town's research is worth. Handed back so every caller derives
     * with the same bonus the settle just paid out — a rate quoted without it
     * is a number the player would catch us lying about.
     */
    research: TownResearchBonus
}

/**
 * Bank the running project if its clock has run out. Lives here rather than in
 * the research module because the settle has to do it first, under the same
 * town_state lock, before it reads the bonus for the window it is about to pay.
 *
 * The insert is the guard: a second caller conflicts on the unique
 * (user, project) pair and changes nothing.
 */
export async function bankFinishedResearch(
    tx: DbExecutor,
    userId: string,
    state: typeof townState.$inferSelect,
    now = Date.now()
) {
    if (!state.researchId || !state.researchCompletesAt) return
    if (state.researchCompletesAt.getTime() > now) return
    await tx.insert(townResearch)
        .values({ userId, researchId: state.researchId })
        .onConflictDoNothing()
    await tx.update(townState)
        .set({ researchId: null, researchCompletesAt: null })
        .where(and(eq(townState.id, state.id), eq(townState.researchId, state.researchId)))
}

/**
 * What this player's finished research is worth, read inside the caller's
 * transaction. Research changes at most once every twelve hours, so this is a
 * cheap read next to everything else a settle does.
 */
export async function getResearchBonus(tx: DbExecutor, userId: string): Promise<TownResearchBonus> {
    const rows = await tx.select({ researchId: townResearch.researchId })
        .from(townResearch)
        .where(eq(townResearch.userId, userId))
    return townResearchEffects(rows.map(r => r.researchId))
}

/**
 * The town hall's price. It is the floor and nothing else: a per-player bonus
 * on top of it was arbitrage, because the order book's minimum ask stayed at
 * the raw floor and anyone with the perk could buy there and sell here for
 * more. Kept as a function so every sale path goes through one place.
 */
export function townPriceFor(resource: TownResourceId): number {
    return townFloorPrice(resource)
}

/**
 * Lock the town, advance the simulation to `now`, and persist the result as
 * increments. Must run inside `tx`; callers then continue their own mutation
 * with the returned (fresh) rows.
 */
export async function settleTownState(tx: DbExecutor, userId: string, now = Date.now()): Promise<SettledTown> {
    const state = await lockTownState(tx, userId)
    const rows = await tx.select().from(townBuildings).where(eq(townBuildings.userId, userId))
    const inventory = await getInventory(userId, tx, true)
    const { plots, byId } = await getPlotMap(userId, tx)
    const simBefore = rows.map(row => toSim(row, byId.get(row.plotId)))
    // A project that finished while the player was away has to be banked
    // before the window is settled, or the whole offline stretch is paid at
    // the un-researched rate and the bonus is quietly lost.
    await bankFinishedResearch(tx, userId, state, now)
    const research = await getResearchBonus(tx, userId)

    const result = settleTown({
        happiness: state.happiness,
        tickProgressMs: state.tickProgressMs,
        lastSettledAt: state.lastSettledAt.getTime(),
        inventory,
        buildings: simBefore,
        research,
        carry: state.carry
    }, now)

    for (const [id, delta] of Object.entries(result.delta) as [TownResourceId, number][]) {
        await addInventory(tx, userId, id, delta)
        inventory[id] = (inventory[id] ?? 0) + delta
    }
    // Chart data: what this window made. Gross output would be nicer than net,
    // but net-positive per resource is what the settle knows without a second
    // pass, and it is what the player sees land in storage.
    const produced = (Object.entries(result.delta) as [TownResourceId, number][]).filter(([, d]) => d > 0)
    const producedTotals: Record<string, number> = { ...state.produced }
    if (produced.length) {
        await tx.insert(townProduction).values(produced.map(([resource, amount]) => ({
            userId,
            resource,
            amount,
            fromAt: state.lastSettledAt,
            toAt: new Date(now)
        })))
        for (const [resource, amount] of produced) producedTotals[resource] = (producedTotals[resource] ?? 0) + amount
        // The chart only looks back a week; keep the log from growing forever.
        await tx.delete(townProduction).where(and(eq(townProduction.userId, userId), lte(townProduction.toAt, new Date(now - 8 * 24 * 3_600_000))))
    }

    for (const done of result.completed) {
        await tx.update(townBuildings)
            .set({ level: done.level, upgradingTo: null })
            .where(eq(townBuildings.id, done.id))
    }

    const [updated] = await tx.update(townState)
        .set({
            happiness: result.happiness,
            tickProgressMs: result.tickProgressMs,
            lastSettledAt: new Date(now),
            produced: producedTotals,
            carry: result.carry
        })
        .where(eq(townState.id, state.id))
        .returning()

    const doneMap = new Map(result.completed.map(c => [c.id, c.level]))
    const buildings = rows.map(row => {
        const level = doneMap.get(row.id)
        return level === undefined ? row : { ...row, level, upgradingTo: null }
    })
    const sim = buildings.map(row => toSim(row, byId.get(row.plotId)))

    return {
        state: updated!,
        buildings,
        plots,
        sim,
        inventory,
        completed: result.completed,
        delta: result.delta,
        elapsedMs: Math.min(now - state.lastSettledAt.getTime(), TOWN_MAX_OFFLINE_MS),
        satisfied: result.satisfied,
        research
    }
}

/** Convenience for read paths: settle in its own transaction. */
export async function settleTownForRead(userId: string) {
    return db.transaction(tx => settleTownState(tx, userId))
}

// ─── Founding & plots ────────────────────────────────────────────────────────

/** First free square walking the spiral out from the origin — where new towns are founded. */
/**
 * Every town lives in one realm. A new one is planted on the first square of
 * the spiral that is TOWN_FOUNDING_GAP plots clear of everybody else's land,
 * so new mayors get room to grow before they meet a neighbour.
 */
async function claimFoundingPlot(tx: DbExecutor, userId: string) {
    await lockPlots(tx)

    // Resume where the last founding finished. Squares behind the cursor were
    // rejected once and can only have become more crowded since, so walking
    // them again is pure waste — and it is what used to make founding
    // quadratic in the number of towns and fail outright past a few thousand.
    const [realm] = await tx.insert(townRealm)
        .values({ id: 1, foundingCursor: 0 })
        .onConflictDoNothing()
        .returning({ foundingCursor: townRealm.foundingCursor })
    let cursor = realm?.foundingCursor
        ?? (await tx.select({ foundingCursor: townRealm.foundingCursor }).from(townRealm).where(eq(townRealm.id, 1)))[0]?.foundingCursor
        ?? 0

    for (let checked = 0; checked < 50_000; checked++, cursor++) {
        const spot = townSpiralCoords(cursor)

        // Flat grassland is perfectly buildable but has no soil, no timber and
        // no stone worth the name. A first plot should have some of each so a
        // new mayor can see what terrain is for; bland land is something you
        // buy on purpose later, not something you are handed.
        if (townPlotIsFlat(spot.x, spot.y)) continue

        // Only the square's own neighbourhood matters, so ask the database for
        // that box instead of pulling the whole realm into memory.
        const [near] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(townPlots)
            .where(and(
                gte(townPlots.x, spot.x - TOWN_FOUNDING_GAP),
                lte(townPlots.x, spot.x + TOWN_FOUNDING_GAP),
                gte(townPlots.y, spot.y - TOWN_FOUNDING_GAP),
                lte(townPlots.y, spot.y + TOWN_FOUNDING_GAP)
            ))
        if ((near?.n ?? 0) > 0) continue

        const [plot] = await tx.insert(townPlots)
            .values({ userId, x: spot.x, y: spot.y, paidPrice: '0' })
            .onConflictDoNothing()
            .returning()
        if (!plot) continue

        // Everything up to and including this square is spoken for.
        await tx.update(townRealm)
            .set({ foundingCursor: cursor + 1 })
            .where(eq(townRealm.id, 1))
        return plot
    }
    throw createError({ statusCode: 500, statusMessage: 'No free land left' })
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/**
 * The squares a player could expand into: every free orthogonal neighbour of
 * a plot they own. Squares owned by someone else are reported too so the map
 * can show the neighbour instead of a for-sale sign.
 */
export async function getExpansions(userId: string, ownPlots: { x: number, y: number }[], ex: DbExecutor = db) {
    const own = new Set(ownPlots.map(p => `${p.x},${p.y}`))
    const candidates = new Map<string, { x: number, y: number }>()
    for (const p of ownPlots) {
        for (const [dx, dy] of NEIGHBOURS) {
            const key = `${p.x + dx},${p.y + dy}`
            if (!own.has(key)) candidates.set(key, { x: p.x + dx, y: p.y + dy })
        }
    }
    if (candidates.size === 0) return []
    const coords = [...candidates.values()]
    const rows = await ex.select({ x: townPlots.x, y: townPlots.y, userId: townPlots.userId, name: user.name })
        .from(townPlots)
        .innerJoin(user, eq(user.id, townPlots.userId))
        .where(sql`(${townPlots.x}, ${townPlots.y}) in (${sql.join(coords.map(c => sql`(${c.x}, ${c.y})`), sql`, `)})`)
    const takenBy = new Map(rows.map(r => [`${r.x},${r.y}`, r]))
    return coords.map((c) => {
        const t = takenBy.get(`${c.x},${c.y}`)
        return t ? { x: c.x, y: c.y, free: false as const, ownerName: t.name } : { x: c.x, y: c.y, free: true as const }
    })
}

export async function foundTown(userId: string) {
    return db.transaction(async (tx) => {
        const [created] = await tx.insert(townState)
            .values({ userId })
            .onConflictDoNothing()
            .returning()
        if (!created) throw createError({ statusCode: 400, statusMessage: 'You already have a town' })
        const plot = await claimFoundingPlot(tx, userId)
        return { stateId: created.id, plotId: plot.id }
    })
}

export function plotPurchaseInfo(state: { plotsBought: number, lastPlotBoughtAt: Date }, now = Date.now(), owned = state.plotsBought) {
    const nextIndex = state.plotsBought + 1
    const cooldownMs = townPlotCooldownMs(nextIndex)
    const availableAt = state.lastPlotBoughtAt.getTime() + cooldownMs
    return {
        nextIndex,
        price: townPlotPrice(nextIndex),
        cooldownMs,
        availableAt,
        remainingMs: Math.max(0, availableAt - now),
        // The cap is on land held, not land bought: plots also arrive from other players.
        maxed: owned >= TOWN_MAX_PLOTS
    }
}

export async function buyPlot(userId: string, x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw createError({ statusCode: 400, statusMessage: 'Pick a square on the map' })
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { state, plots } = await settleTownState(tx, userId, now)
        const info = plotPurchaseInfo(state, now, plots.length)
        if (info.maxed) throw createError({ statusCode: 400, statusMessage: 'You own the maximum number of plots' })
        if (info.remainingMs > 0) throw createError({ statusCode: 400, statusMessage: 'The land office is not selling to you yet' })
        if (!plots.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) === 1)) {
            throw createError({ statusCode: 400, statusMessage: 'New land must touch a plot you own' })
        }

        await debit(userId, info.price.toFixed(4), CATEGORY, tx)
        // The unique (x, y) constraint is the claim: lose the race, lose nothing (the tx rolls back).
        const [plot] = await tx.insert(townPlots).values({ userId, x, y, paidPrice: info.price.toFixed(4) }).onConflictDoNothing().returning()
        if (!plot) throw createError({ statusCode: 400, statusMessage: 'Someone just bought that square' })
        await tx.update(townState)
            .set({ plotsBought: sql`${townState.plotsBought} + 1`, lastPlotBoughtAt: new Date(now) })
            .where(eq(townState.id, state.id))
        return { plotId: plot.id, x: plot.x, y: plot.y, price: info.price }
    })
}

/** A plot can only change hands when nothing stands on it. */
async function assertPlotEmpty(tx: DbExecutor, plotId: string) {
    const [row] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(townBuildings)
        .where(eq(townBuildings.plotId, plotId))
    if ((row?.n ?? 0) > 0) {
        throw createError({ statusCode: 400, statusMessage: 'Clear every building off the plot first' })
    }
}

/** Put an empty plot on the market at your own price, or pass null to take it off. */
export async function listPlot(userId: string, plotId: string, price: number | null) {
    if (price !== null && !isValidTownListPrice(price)) {
        throw createError({ statusCode: 400, statusMessage: 'Asking price must be at least 1 coin, with at most 2 decimals' })
    }
    return db.transaction(async (tx) => {
        const { plots } = await settleTownState(tx, userId)
        const plot = plots.find(p => p.id === plotId)
        if (!plot) throw createError({ statusCode: 404, statusMessage: 'That plot is not yours' })
        if (price !== null) {
            if (plots.length <= 1) throw createError({ statusCode: 400, statusMessage: 'This is your last plot' })
            await assertPlotEmpty(tx, plotId)
        }
        await tx.update(townPlots)
            .set({ listPrice: price === null ? null : price.toFixed(4) })
            .where(and(eq(townPlots.id, plotId), eq(townPlots.userId, userId)))
        return { plotId, listPrice: price }
    })
}

/** Hand an empty plot back to the land office for a quarter of what it cost. */
export async function sellPlotToSystem(userId: string, plotId: string) {
    return db.transaction(async (tx) => {
        const { state, plots } = await settleTownState(tx, userId)
        const plot = plots.find(p => p.id === plotId)
        if (!plot) throw createError({ statusCode: 404, statusMessage: 'That plot is not yours' })
        if (plots.length <= 1) throw createError({ statusCode: 400, statusMessage: 'This is your last plot' })
        await assertPlotEmpty(tx, plotId)

        // The refund is a share of what this very plot cost its owner, so a
        // cheap plot bought off a neighbour cannot be flipped for a fortune.
        const refund = townPlotRefundFor(parseFloat(plot.paidPrice))
        const [removed] = await tx.delete(townPlots)
            .where(and(eq(townPlots.id, plotId), eq(townPlots.userId, userId)))
            .returning({ id: townPlots.id })
        if (!removed) throw createError({ statusCode: 409, statusMessage: 'That plot just changed hands' })
        await tx.update(townState)
            .set({ plotsBought: sql`greatest(1, ${townState.plotsBought} - 1)` })
            .where(eq(townState.id, state.id))
        if (refund > 0) await credit(userId, refund.toFixed(4), CATEGORY, tx)
        return { plotId, refund }
    })
}

/**
 * Buy a plot another mayor has listed. The land-office cooldown does not apply
 * — that is the point of the player market — but the plot still has to touch
 * land you already own, so towns stay contiguous.
 */
export async function buyPlotFromPlayer(userId: string, plotId: string, expectedPrice?: number) {
    if (expectedPrice !== undefined && !isValidTownListPrice(expectedPrice)) {
        throw createError({ statusCode: 400, statusMessage: 'That is not a price' })
    }
    return db.transaction(async (tx) => {
        await lockPlots(tx)
        const listing = await tx.query.townPlots.findFirst({ where: eq(townPlots.id, plotId) })
        if (!listing || listing.listPrice === null) throw createError({ statusCode: 400, statusMessage: 'That plot is not for sale' })
        if (listing.userId === userId) throw createError({ statusCode: 400, statusMessage: 'That plot is already yours' })
        const sellerId = listing.userId
        const price = parseFloat(listing.listPrice)
        // The buyer agreed to a price they saw, and what they saw can be half a
        // minute old. Without this a seller can re-list at any figure while the
        // click is in flight and the buyer pays it.
        if (expectedPrice !== undefined && price !== expectedPrice) {
            throw createError({ statusCode: 409, statusMessage: 'The asking price changed — take another look' })
        }

        // Lock both towns in id order so two crossing purchases cannot deadlock.
        for (const id of [userId, sellerId].sort()) {
            await tx.select({ id: townState.id }).from(townState).where(eq(townState.userId, id)).for('update')
        }

        // Re-checked under the lock: listing and selling are separate calls, so
        // the seller may have shed their other land since they listed this one.
        const sellerPlots = await tx.select({ id: townPlots.id }).from(townPlots).where(eq(townPlots.userId, sellerId))
        if (sellerPlots.length <= 1) {
            await tx.update(townPlots).set({ listPrice: null }).where(eq(townPlots.id, plotId))
            throw createError({ statusCode: 400, statusMessage: 'That is the seller\'s last plot — it is no longer for sale' })
        }

        const mine = await tx.select().from(townPlots).where(eq(townPlots.userId, userId))
        if (mine.length >= TOWN_MAX_PLOTS) throw createError({ statusCode: 400, statusMessage: 'You own the maximum number of plots' })
        if (!mine.some(p => Math.abs(p.x - listing.x) + Math.abs(p.y - listing.y) === 1)) {
            throw createError({ statusCode: 400, statusMessage: 'That plot does not touch your land' })
        }
        await assertPlotEmpty(tx, plotId)

        // The conditional update is the claim: whoever flips the listing owns it.
        const [bought] = await tx.update(townPlots)
            // paidPrice is what the LAND OFFICE was paid, and it stays at zero
            // through a player sale. The coins for this plot went to the seller,
            // not into the treasury, so the treasury owes nothing for it back —
            // otherwise two accounts could pass a plot between them at any price
            // they liked and mint a quarter of it every round.
            .set({ userId, listPrice: null, paidPrice: '0' })
            .where(and(eq(townPlots.id, plotId), eq(townPlots.userId, sellerId), sql`${townPlots.listPrice} is not null`))
            .returning({ id: townPlots.id })
        if (!bought) throw createError({ statusCode: 409, statusMessage: 'Someone just bought that plot' })

        await debit(userId, price.toFixed(4), CATEGORY, tx)
        await credit(sellerId, price.toFixed(4), CATEGORY, tx)
        // plotsBought counts plots taken from the LAND OFFICE, and a sale
        // between players is none of the office's business. Moving it here
        // would let a pair sell a plot back and forth to walk each other's
        // price ladder back down to the first rung.
        return { plotId, price, sellerId }
    })
}

/**
 * Everything the map should draw around the player: other mayors' plots (and
 * what stands on them) within a few squares, plus anything they have listed.
 */
export async function getWorldView(userId: string, ownPlots: { x: number, y: number }[], radius = 6) {
    if (ownPlots.length === 0) return { towns: [], listings: [] }
    const minX = Math.min(...ownPlots.map(p => p.x)) - radius
    const maxX = Math.max(...ownPlots.map(p => p.x)) + radius
    const minY = Math.min(...ownPlots.map(p => p.y)) - radius
    const maxY = Math.max(...ownPlots.map(p => p.y)) + radius

    // When the cap bites, it is the farthest land that goes, never a random
    // square in the middle of a neighbour's town. Distance is measured from
    // the DOUBLED centre so it stays an integer: a town spanning an even number
    // of squares has a half-square centre, and Postgres infers the parameter's
    // type from the integer column it is subtracted from, so `x - 0.5` was
    // rejected as invalid integer input. That made /api/town/state a 500 for
    // every mayor with such a town, and with it the whole world view.
    const cx2 = minX + maxX
    const cy2 = minY + maxY
    const rows = await db.select({
        id: townPlots.id,
        x: townPlots.x,
        y: townPlots.y,
        listPrice: townPlots.listPrice,
        ownerId: townPlots.userId,
        ownerName: user.name
    })
        .from(townPlots)
        .innerJoin(user, eq(user.id, townPlots.userId))
        .where(and(
            sql`${townPlots.userId} <> ${userId}`,
            gte(townPlots.x, minX), lte(townPlots.x, maxX),
            gte(townPlots.y, minY), lte(townPlots.y, maxY)
        ))
        .orderBy(sql`greatest(abs(2 * ${townPlots.x} - ${cx2}), abs(2 * ${townPlots.y} - ${cy2}))`, townPlots.id)
        .limit(120)
    if (rows.length === 0) return { towns: [], listings: [] }

    // Level 0 rows are included: a neighbour's building site, with its scaffold
    // and its clock, is half of what makes the realm look inhabited. Leaving
    // them out meant a plot stayed visibly empty until the moment it finished.
    //
    // Every building on those plots comes back — no row cap. The plot cap above
    // already bounds this at 120 × 64 tiles. A cap here used to be 600, without
    // an ORDER BY, so Postgres served heap order: an UPDATE writes a fresh tuple
    // at the end of the heap, which put every building a neighbour had just
    // moved behind the cut once the realm held more than 600 within range.
    // Freshly moved blocks vanished from everyone else's map while untouched
    // rows stayed.
    const rows2 = await db.select({
        plotId: townBuildings.plotId,
        type: townBuildings.type,
        tileX: townBuildings.tileX,
        tileY: townBuildings.tileY,
        rotation: townBuildings.rotation,
        level: townBuildings.level,
        upgradingTo: townBuildings.upgradingTo,
        completesAt: townBuildings.completesAt
    })
        .from(townBuildings)
        .where(inArray(townBuildings.plotId, rows.map(r => r.id)))
    const buildings = rows2.map(b => ({
        plotId: b.plotId,
        type: b.type,
        tileX: b.tileX,
        tileY: b.tileY,
        rotation: b.rotation,
        level: b.level,
        upgradingTo: b.upgradingTo,
        completesAt: b.completesAt.getTime()
    }))

    const byPlot = new Map<string, typeof buildings>()
    for (const b of buildings) {
        const list = byPlot.get(b.plotId)
        if (list) list.push(b)
        else byPlot.set(b.plotId, [b])
    }

    return {
        towns: rows.map(r => ({
            id: r.id,
            x: r.x,
            y: r.y,
            ownerId: r.ownerId,
            ownerName: r.ownerName,
            listPrice: r.listPrice === null ? null : parseFloat(r.listPrice),
            buildings: byPlot.get(r.id) ?? []
        })),
        listings: rows.filter(r => r.listPrice !== null).map(r => ({
            plotId: r.id,
            x: r.x,
            y: r.y,
            ownerName: r.ownerName,
            price: parseFloat(r.listPrice!)
        }))
    }
}

// ─── Buildings ───────────────────────────────────────────────────────────────

/**
 * A running purse for a bulk call: what the player had when the transaction
 * opened, less what this call has committed so far.
 *
 * It only decides where a batch stops — the debit and the inventory guards are
 * still what actually enforce the spend, so a stale read can make this
 * optimistic but never lets anything through unpaid.
 */
async function townPurse(tx: DbExecutor, userId: string, inventory: TownResourceBag) {
    const [row] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    let coins = parseFloat(row?.balance ?? '0')
    const goods: TownResourceBag = { ...inventory }
    return {
        /** Why this cost is out of reach right now, or null. */
        shortOf(cost: { coins: number, resources: TownResourceBag }): string | null {
            if (cost.coins > coins) return 'Not enough coins'
            for (const [id, qty] of Object.entries(cost.resources) as [TownResourceId, number][]) {
                if ((goods[id] ?? 0) < qty) return `Not enough ${getTownResource(id)?.name ?? id}`
            }
            return null
        },
        spend(cost: { coins: number, resources: TownResourceBag }) {
            coins -= cost.coins
            for (const [id, qty] of Object.entries(cost.resources) as [TownResourceId, number][]) {
                goods[id] = (goods[id] ?? 0) - qty
            }
        }
    }
}

export interface TownPlacement { plotId: string, tileX: number, tileY: number, type: string, rotation?: number }

function validatePlacementShape(item: TownPlacement) {
    const rotation = item.rotation ?? 0
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
        throw createError({ statusCode: 400, statusMessage: 'Rotation must be 0, 1, 2 or 3 quarter turns' })
    }
    const def = getTownBuilding(item.type)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Unknown building' })
    if (!Number.isInteger(item.tileX) || !Number.isInteger(item.tileY) || item.tileX < 0 || item.tileY < 0 || item.tileX >= TOWN_PLOT_SIZE || item.tileY >= TOWN_PLOT_SIZE) {
        throw createError({ statusCode: 400, statusMessage: 'That tile is off the plot' })
    }
    return { def, rotation }
}

/**
 * Place one or more buildings in a single transaction — what a road drag sends.
 *
 * Every item is validated against the layout the previous items in the same
 * drag already created, so a run of road tiles connects to itself and a house
 * may be dropped beside a road laid a moment earlier in the same call. A drag
 * across a tile that is taken, or past what the purse covers, skips that tile
 * rather than failing the whole gesture — but a request that places nothing at
 * all reports the first reason, so a single click still explains itself the way
 * it always did.
 *
 * A running total of what the drag has already committed decides where the
 * money runs out. The debit is still the guard that a concurrent spend cannot
 * slip past: if it refuses, the whole drag rolls back rather than half-charging.
 */
export async function placeBuildings(userId: string, items: TownPlacement[]) {
    if (items.length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to build' })
    if (items.length > TOWN_MAX_DRAG_TILES) throw createError({ statusCode: 400, statusMessage: 'Too many tiles in one go' })
    const shapes = items.map(validatePlacementShape)

    return db.transaction(async (tx) => {
        const now = Date.now()
        const { sim, state, research, inventory } = await settleTownState(tx, userId, now)
        const { byId: plotsById } = await getPlotMap(userId, tx)
        const purse = await townPurse(tx, userId, inventory)

        // The layout as this call builds it up, so each item sees the last one.
        const layout = [...sim]
        const counts = new Map<string, number>()
        for (const b of sim) counts.set(b.type, (counts.get(b.type) ?? 0) + 1)
        let buildersLeft = townBuildersFree(sim, state.builders, now)

        const placed: { buildingId: string, type: string, plotId: string, tileX: number, tileY: number, completesAt: number, cost: ReturnType<typeof townPlaceCost> }[] = []
        const touchedPlots = new Set<string>()
        let firstIssue: string | null = null
        const note = (why: string) => { if (!firstIssue) firstIssue = why }

        for (let i = 0; i < items.length; i++) {
            const item = items[i]!
            const { def, rotation } = shapes[i]!
            const plot = plotsById.get(item.plotId)
            if (!plot) { note('That plot is not yours'); continue }

            const lock = townTierRequirement(layout, def.tier, now, state.produced, research)
            if (lock) {
                note(lock.needsBuilding
                    ? `Finish a tier ${def.tier - 1} building first`
                    : lock.pop < lock.popRequired
                        ? `Tier ${def.tier} needs ${lock.popRequired} residents (you house ${lock.pop})`
                        : `Tier ${def.tier} opens after producing ${lock.producedRequired} tier-${lock.producedTier} goods (${lock.produced} so far)`)
                continue
            }

            // Counted against everything already standing plus what this same
            // call has put up, so one drag cannot lay three jewel mines at once.
            const capped = townBuildingCountIssue(def, counts.get(def.id) ?? 0)
            if (capped) { note(capped); continue }

            const wx = plot.x * TOWN_PLOT_SIZE + item.tileX
            const wy = plot.y * TOWN_PLOT_SIZE + item.tileY
            const issue = townPlacementIssue(layout, def, wx, wy, rotation)
            if (issue) { note(issue); continue }

            // Roads go up instantly and need nobody; everything else needs a crew.
            const instant = def.kind === 'road'
            if (!instant && buildersLeft <= 0) { note('Every builder is busy'); continue }

            // The n-th copy costs more: count every existing one, finished or not.
            const cost = townPlaceCost(def, counts.get(def.id) ?? 0)
            const short = purse.shortOf(cost)
            if (short) { note(short); continue }

            const buildMs = instant ? 0 : townLevelBuildMs(def, 1, state.happiness, research)
            // The unique (plot, tile) constraint is the occupancy guard, and the
            // insert comes first: a tile lost to a concurrent build must not be
            // paid for.
            const [building] = await tx.insert(townBuildings)
                .values({
                    userId,
                    plotId: item.plotId,
                    type: def.id,
                    tileX: item.tileX,
                    tileY: item.tileY,
                    rotation,
                    level: instant ? 1 : 0,
                    completesAt: new Date(now + buildMs)
                })
                .onConflictDoNothing()
                .returning()
            if (!building) { note('That tile is already taken'); continue }

            if (cost.coins > 0) await debit(userId, cost.coins.toFixed(4), CATEGORY, tx)
            await spendBag(tx, userId, cost.resources)
            purse.spend(cost)

            counts.set(def.id, (counts.get(def.id) ?? 0) + 1)
            if (!instant) buildersLeft--
            layout.push(toSim(building, plot))
            touchedPlots.add(item.plotId)
            placed.push({
                buildingId: building.id,
                type: def.id,
                plotId: item.plotId,
                tileX: item.tileX,
                tileY: item.tileY,
                completesAt: building.completesAt.getTime(),
                cost
            })
        }

        if (placed.length === 0) throw createError({ statusCode: 400, statusMessage: firstIssue ?? 'Nothing could be built there' })
        // Building on a listed plot takes it off the market.
        await tx.update(townPlots).set({ listPrice: null }).where(inArray(townPlots.id, [...touchedPlots]))
        return { placed, skipped: items.length - placed.length, reason: placed.length < items.length ? firstIssue : null }
    })
}

export async function placeBuilding(userId: string, plotId: string, tileX: number, tileY: number, type: string, rotation = 0) {
    const { placed } = await placeBuildings(userId, [{ plotId, tileX, tileY, type, rotation }])
    const one = placed[0]!
    return { buildingId: one.buildingId, completesAt: one.completesAt, cost: one.cost }
}

export interface TownRelocation { buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number }

/**
 * Move a set of buildings to new tiles on owned plots, all or nothing.
 *
 * A move is free and never touches the clock, so a building still going up (or
 * upgrading) travels with the rest of its block — the crew follows the site.
 * Only the ground is checked (occupied, water), so two buildings may swap
 * tiles and a block may carry its own street. A move may leave a building —
 * the moved one, or one whose road went — without a front door; it simply
 * stops working until a road reaches it, which the "!" on the map already says.
 */
export async function moveBuildings(userId: string, moves: TownRelocation[]) {
    if (moves.length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to move' })
    if (moves.length > TOWN_MAX_DRAG_TILES) throw createError({ statusCode: 400, statusMessage: 'Too many buildings in one go' })
    for (const m of moves) {
        if (!Number.isInteger(m.rotation) || m.rotation < 0 || m.rotation > 3) {
            throw createError({ statusCode: 400, statusMessage: 'Rotation must be 0, 1, 2 or 3 quarter turns' })
        }
        if (!Number.isInteger(m.tileX) || !Number.isInteger(m.tileY) || m.tileX < 0 || m.tileY < 0 || m.tileX >= TOWN_PLOT_SIZE || m.tileY >= TOWN_PLOT_SIZE) {
            throw createError({ statusCode: 400, statusMessage: 'That tile is off the plot' })
        }
    }
    if (new Set(moves.map(m => m.buildingId)).size !== moves.length) {
        throw createError({ statusCode: 400, statusMessage: 'A building can only be moved once' })
    }

    return db.transaction(async (tx) => {
        const now = Date.now()
        const { sim } = await settleTownState(tx, userId, now)
        const { byId: plotsById } = await getPlotMap(userId, tx)

        const wanted: TownGroupMove[] = []
        for (const m of moves) {
            if (!sim.some(b => b.id === m.buildingId)) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
            const plot = plotsById.get(m.plotId)
            if (!plot) throw createError({ statusCode: 400, statusMessage: 'That plot is not yours' })
            wanted.push({
                id: m.buildingId,
                wx: plot.x * TOWN_PLOT_SIZE + m.tileX,
                wy: plot.y * TOWN_PLOT_SIZE + m.tileY,
                rotation: m.rotation
            })
        }
        const issue = townGroupMoveIssue(sim, wanted)
        if (issue) throw createError({ statusCode: 400, statusMessage: issue })

        // Two buildings may be swapping tiles, and the unique (plot, tile) index
        // would reject whichever moved first. Park the whole set off the grid,
        // then set the real tiles: both statements run inside this transaction,
        // and the constraint is checked per statement, so the shuffle is legal.
        // Negative tiles never collide with a real one and never survive the call.
        let park = -1
        for (const m of moves) {
            await tx.update(townBuildings)
                .set({ tileX: park, tileY: park })
                .where(and(eq(townBuildings.id, m.buildingId), eq(townBuildings.userId, userId)))
            park--
        }
        for (const m of moves) {
            const [moved] = await tx.update(townBuildings)
                .set({ plotId: m.plotId, tileX: m.tileX, tileY: m.tileY, rotation: m.rotation })
                .where(and(eq(townBuildings.id, m.buildingId), eq(townBuildings.userId, userId)))
                .returning({ id: townBuildings.id })
            if (!moved) throw createError({ statusCode: 400, statusMessage: 'That tile is already taken' })
        }
        await tx.update(townPlots).set({ listPrice: null }).where(inArray(townPlots.id, [...new Set(moves.map(m => m.plotId))]))
        return { moved: moves.map(m => m.buildingId) }
    })
}

export async function moveBuilding(userId: string, buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number) {
    await moveBuildings(userId, [{ buildingId, plotId, tileX, tileY, rotation }])
    return { buildingId, plotId, tileX, tileY, rotation }
}

export async function upgradeBuilding(userId: string, buildingId: string) {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { buildings, state, sim, research } = await settleTownState(tx, userId, now)
        const building = buildings.find(b => b.id === buildingId)
        if (!building) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
        if (building.level === 0) throw createError({ statusCode: 400, statusMessage: 'Still under construction' })
        if (building.upgradingTo !== null) throw createError({ statusCode: 400, statusMessage: 'Already upgrading' })

        const def = getTownBuilding(building.type)!
        if (def.kind === 'road') throw createError({ statusCode: 400, statusMessage: 'Roads have no levels' })
        if (building.level >= townBuildingMaxLevel(def)) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })
        if (townBuildersFree(sim, state.builders, now) <= 0) {
            throw createError({ statusCode: 400, statusMessage: 'Every builder is busy' })
        }
        const nextLevel = building.level + 1
        const cost = townLevelCost(def, nextLevel)
        if (cost.coins > 0) await debit(userId, cost.coins.toFixed(4), CATEGORY, tx)
        await spendBag(tx, userId, cost.resources)

        const completesAt = new Date(now + townLevelBuildMs(def, nextLevel, state.happiness, research))
        const [updated] = await tx.update(townBuildings)
            .set({ upgradingTo: nextLevel, completesAt })
            .where(and(eq(townBuildings.id, buildingId), eq(townBuildings.level, building.level), sql`${townBuildings.upgradingTo} is null`))
            .returning()
        if (!updated) throw createError({ statusCode: 409, statusMessage: 'Building changed — try again' })
        return { buildingId, level: nextLevel, completesAt: completesAt.getTime(), cost }
    })
}

export async function rushBuilding(userId: string, buildingId: string) {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { buildings } = await settleTownState(tx, userId, now)
        const building = buildings.find(b => b.id === buildingId)
        if (!building) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
        const remainingMs = building.completesAt.getTime() - now
        if (remainingMs <= 0 || (building.level > 0 && building.upgradingTo === null)) {
            throw createError({ statusCode: 400, statusMessage: 'Nothing to rush' })
        }
        const gems = townRushGemCost(remainingMs)
        await debitGems(userId, gems, tx)

        // Safe without a CAS: the town_state lock held by settleTownState
        // serializes every mutation of this player's buildings.
        const level = building.upgradingTo ?? 1
        await tx.update(townBuildings)
            .set({ level, upgradingTo: null, completesAt: new Date(now) })
            .where(eq(townBuildings.id, buildingId))
        return { buildingId, gems, level }
    })
}

export async function demolishBuilding(userId: string, buildingId: string) {
    return db.transaction(async (tx) => {
        await settleTownState(tx, userId)
        const [deleted] = await tx.delete(townBuildings)
            .where(and(eq(townBuildings.id, buildingId), eq(townBuildings.userId, userId)))
            .returning({ id: townBuildings.id, type: townBuildings.type })
        if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
        return { buildingId: deleted.id, type: deleted.type }
    })
}

/** Clear a whole selection (or a bulldozer drag) in one transaction. */
export async function demolishBuildings(userId: string, buildingIds: string[]) {
    const ids = [...new Set(buildingIds.filter(Boolean))]
    if (ids.length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to demolish' })
    if (ids.length > TOWN_MAX_DRAG_TILES) throw createError({ statusCode: 400, statusMessage: 'Too many buildings in one go' })
    return db.transaction(async (tx) => {
        await settleTownState(tx, userId)
        // The DELETE is the guard: whatever comes back is what this call removed,
        // so a tile already cleared by another request is simply not in the list.
        const deleted = await tx.delete(townBuildings)
            .where(and(inArray(townBuildings.id, ids), eq(townBuildings.userId, userId)))
            .returning({ id: townBuildings.id, type: townBuildings.type })
        if (deleted.length === 0) throw createError({ statusCode: 404, statusMessage: 'Nothing left to demolish' })
        return { demolished: deleted.map(d => d.id), types: deleted.map(d => d.type) }
    })
}

/**
 * Start an upgrade on every building in a selection that can take one.
 *
 * Crews, coins and goods all run out partway through a big selection, so this
 * takes the ones it can afford in the order given and reports the rest rather
 * than failing the lot. Each upgrade is charged and started exactly like the
 * single-building path, under the same town_state lock.
 */
export async function upgradeBuildings(userId: string, buildingIds: string[]) {
    const ids = [...new Set(buildingIds.filter(Boolean))]
    if (ids.length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to upgrade' })
    if (ids.length > TOWN_MAX_DRAG_TILES) throw createError({ statusCode: 400, statusMessage: 'Too many buildings in one go' })

    return db.transaction(async (tx) => {
        const now = Date.now()
        const { buildings, state, sim, research, inventory } = await settleTownState(tx, userId, now)
        const purse = await townPurse(tx, userId, inventory)
        let buildersLeft = townBuildersFree(sim, state.builders, now)
        const started: { buildingId: string, level: number, completesAt: number }[] = []
        let firstIssue: string | null = null
        const note = (why: string) => { if (!firstIssue) firstIssue = why }

        for (const id of ids) {
            const building = buildings.find(b => b.id === id)
            if (!building) { note('Building not found'); continue }
            if (building.level === 0) { note('Still under construction'); continue }
            if (building.upgradingTo !== null) { note('Already upgrading'); continue }
            const def = getTownBuilding(building.type)!
            if (def.kind === 'road') { note('Roads have no levels'); continue }
            if (building.level >= townBuildingMaxLevel(def)) { note('Already at max level'); continue }
            if (buildersLeft <= 0) { note('Every builder is busy'); continue }

            const nextLevel = building.level + 1
            const cost = townLevelCost(def, nextLevel)
            const short = purse.shortOf(cost)
            if (short) { note(short); continue }
            const completesAt = new Date(now + townLevelBuildMs(def, nextLevel, state.happiness, research))
            // The conditional UPDATE claims the upgrade; only then is anything charged.
            const [updated] = await tx.update(townBuildings)
                .set({ upgradingTo: nextLevel, completesAt })
                .where(and(
                    eq(townBuildings.id, id),
                    eq(townBuildings.userId, userId),
                    eq(townBuildings.level, building.level),
                    sql`${townBuildings.upgradingTo} is null`
                ))
                .returning({ id: townBuildings.id })
            if (!updated) { note('Building changed — try again'); continue }
            if (cost.coins > 0) await debit(userId, cost.coins.toFixed(4), CATEGORY, tx)
            await spendBag(tx, userId, cost.resources)
            purse.spend(cost)

            buildersLeft--
            started.push({ buildingId: id, level: nextLevel, completesAt: completesAt.getTime() })
        }

        if (started.length === 0) throw createError({ statusCode: 400, statusMessage: firstIssue ?? 'Nothing could be upgraded' })
        return { started, skipped: ids.length - started.length, reason: started.length < ids.length ? firstIssue : null }
    })
}

/**
 * Lifetime sales counter behind the merchant milestones. Plain increment, no read.
 *
 * Only town-hall sales count. A player counterparty can be the seller's own
 * second account, and two accounts passing one unit back and forth at a price
 * they choose will run this counter to any figure they like — which then pays
 * out real coins and gems at the Magnate milestone. The hall is the one
 * counterparty nobody can be on both sides of.
 */
async function recordEarnings(tx: DbExecutor, userId: string, coins: number) {
    if (coins <= 0) return
    await tx.update(townState)
        .set({ coinsEarned: sql`${townState.coinsEarned} + ${coins.toFixed(4)}::numeric` })
        .where(eq(townState.userId, userId))
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export function milestoneSnapshotFor(settled: Pick<SettledTown, 'state' | 'sim' | 'inventory' | 'satisfied' | 'research'>, now: number) {
    const derived = deriveTown(settled.sim, settled.state.happiness, now, settled.satisfied, undefined, settled.research)
    return townMilestoneSnapshot(settled.sim, derived, settled.state.happiness, settled.state.plotsBought, parseFloat(settled.state.coinsEarned), now)
}

export function serializeMilestones(settled: Pick<SettledTown, 'state' | 'sim' | 'inventory' | 'satisfied' | 'research'>, now: number) {
    const snapshot = milestoneSnapshotFor(settled, now)
    const claimed = new Set(settled.state.milestonesClaimed)
    return TOWN_MILESTONES.map((m) => {
        const progress = m.progress(snapshot)
        return {
            id: m.id,
            title: m.title,
            description: m.description,
            emoji: m.emoji,
            reward: m.reward,
            gems: m.gems ?? 0,
            tier: m.tier,
            current: progress.current,
            target: progress.target,
            complete: progress.current >= progress.target,
            claimed: claimed.has(m.id)
        }
    })
}

export async function claimMilestone(userId: string, milestoneId: string) {
    const def = getTownMilestone(milestoneId)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Unknown milestone' })
    return db.transaction(async (tx) => {
        const now = Date.now()
        const settled = await settleTownState(tx, userId, now)
        if (!townMilestoneComplete(def, milestoneSnapshotFor(settled, now))) {
            throw createError({ statusCode: 400, statusMessage: 'Milestone not reached yet' })
        }
        // Claim-then-reward: the jsonb NOT-contains guard makes the append the mutex.
        const [claimed] = await tx.update(townState)
            .set({ milestonesClaimed: sql`${townState.milestonesClaimed} || ${JSON.stringify([def.id])}::jsonb` })
            .where(and(eq(townState.userId, userId), sql`not (${townState.milestonesClaimed} ? ${def.id})`))
            .returning({ id: townState.id })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already claimed' })
        if (def.reward > 0) await credit(userId, def.reward.toFixed(4), CATEGORY, tx)
        if (def.gems) await creditGems(userId, def.gems, tx)
        return { id: def.id, reward: def.reward, gems: def.gems ?? 0, title: def.title }
    })
}

// ─── System market (floor / ceiling) ─────────────────────────────────────────

/**
 * Lock order, everywhere a transaction touches more than one of these for a
 * player: town_state → town_inventory → user. settleTownState takes the first
 * two; the market paths below lock town_state first so a sell can never form
 * a cycle with a concurrent build/settle (which holds town_state and waits on
 * the user row the sell already credited).
 */
async function lockTownForMarket(tx: DbExecutor, userId: string) {
    await tx.select({ id: townState.id }).from(townState).where(eq(townState.userId, userId)).for('update')
}

/**
 * What one sell of `quantity` would fetch: every resting bid that beats the
 * town hall, best price first, then the hall for whatever is left.
 *
 * Read-only, and it reads the book — so the caller must already hold the book
 * lock for `resource`, and must not have locked any town yet. Locking a town
 * before the book is what deadlocks two mayors trading on two books at once.
 *
 * Own bids are skipped. Filling one would hand your own goods to your own
 * escrow and read as a sale on the tape for a price you set on both sides.
 */
async function planSweepSell(tx: DbExecutor, userId: string, resource: TownResourceId, quantity: number) {
    const floor = townPriceFor(resource)
    const restingRows = await tx
        .select()
        .from(townOrders)
        .where(and(
            eq(townOrders.resource, resource),
            eq(townOrders.status, 'open'),
            eq(townOrders.side, 'buy'),
            gte(townOrders.price, floor.toFixed(4))
        ))
        .orderBy(desc(townOrders.price), asc(townOrders.createdAt))

    const book = restingRows
        .filter(row => row.userId !== userId)
        .map(row => ({ id: row.id, userId: row.userId, price: parseFloat(row.price), remaining: row.quantity - row.filled }))

    const { fills, remaining } = matchGemOrder({ side: 'sell', price: floor, quantity, book })
    let playerTotal = 0
    for (const fill of fills) playerTotal += townOrderTotal(fill.price, fill.quantity)
    const hallTotal = townOrderTotal(floor, remaining)
    return { resource, quantity, floor, fills, remaining, playerTotal, hallTotal, total: playerTotal + hallTotal }
}

type SweepSellPlan = Awaited<ReturnType<typeof planSweepSell>>

/** Everyone whose town row a plan will touch, seller included. */
function sweepParticipants(userId: string, plans: SweepSellPlan[]) {
    return [...new Set([userId, ...plans.flatMap(plan => plan.fills.map(fill => fill.userId))])].sort()
}

/**
 * Apply one planned sweep. The seller's goods leave in a single conditional
 * decrement — the guard for the whole line — and are then handed to the
 * buyers the plan matched, with the rest going to the hall.
 *
 * Only the hall's share reaches recordEarnings: see the note on that function.
 */
async function applySweepSell(tx: DbExecutor, userId: string, plan: SweepSellPlan) {
    await takeInventory(tx, userId, plan.resource, plan.quantity)

    for (const fill of plan.fills) {
        const [resting] = await tx.update(townOrders)
            .set({
                filled: sql`${townOrders.filled} + ${fill.quantity}`,
                status: sql`case when ${townOrders.filled} + ${fill.quantity} >= ${townOrders.quantity} then 'filled' else 'open' end`,
                updatedAt: new Date()
            })
            .where(and(eq(townOrders.id, fill.orderId), eq(townOrders.status, 'open')))
            .returning({ id: townOrders.id })
        if (!resting) throw createError({ statusCode: 500, statusMessage: 'Order book conflict' })

        await addInventory(tx, fill.userId, plan.resource, fill.quantity)
        await tx.insert(townTrades).values({
            resource: plan.resource,
            buyerId: fill.userId,
            sellerId: userId,
            takerId: userId,
            price: fill.price.toFixed(4),
            quantity: fill.quantity
        })
    }

    if (plan.total > 0) await credit(userId, plan.total.toFixed(4), CATEGORY, tx)
    if (plan.hallTotal > 0) await recordEarnings(tx, userId, plan.hallTotal)
}

/**
 * Sell one good for the most coins on offer: the player bids that beat the
 * town hall first, best price first, then the hall for the remainder.
 *
 * Routing through the book rather than straight to the floor is the whole
 * point — a mayor who wants your steel badly should get it before the hall
 * does, without the seller having to watch the book to notice.
 */
export async function sellToFloor(userId: string, resource: string, quantity: number) {
    if (!isTownResourceId(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
    if (!isValidTownQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
    return db.transaction(async (tx) => {
        await lockBook(tx, resource)
        const plan = await planSweepSell(tx, userId, resource, quantity)
        for (const id of sweepParticipants(userId, [plan])) await lockTownForMarket(tx, id)
        await applySweepSell(tx, userId, plan)
        return {
            resource,
            quantity,
            price: plan.floor,
            total: plan.total,
            toPlayers: plan.playerTotal,
            toHall: plan.hallTotal,
            filledByPlayers: quantity - plan.remaining
        }
    })
}

/**
 * Sell several goods in one transaction, each routed the same way as a single
 * sell. Books are locked in resource order before anything is read, so two
 * bulk sells over overlapping goods queue instead of deadlocking.
 */
export async function sellBulkToFloor(userId: string, items: { resource: string, quantity: number }[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > TOWN_RESOURCES.length) {
        throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })
    }
    for (const item of items) {
        if (!isTownResourceId(item.resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
        if (!isValidTownQuantity(item.quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
    }
    // One line per good, or two lines would each plan against the same book and
    // then both fill the same resting bid: the second sweep reads a book the
    // first has not written yet, so together they can take more off a bid than
    // it ever escrowed. Merging is friendlier than refusing, and the merged
    // quantity has to clear the same bound as a single line.
    const merged = new Map<string, number>()
    for (const item of items) merged.set(item.resource, (merged.get(item.resource) ?? 0) + item.quantity)
    for (const quantity of merged.values()) {
        if (!isValidTownQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'That is more than anyone can hold' })
    }
    const order = new Map(TOWN_RESOURCES.map((r, i) => [r.id as string, i]))
    const sorted = [...merged.entries()]
        .map(([resource, quantity]) => ({ resource, quantity }))
        .sort((a, b) => (order.get(a.resource) ?? 0) - (order.get(b.resource) ?? 0))

    return db.transaction(async (tx) => {
        for (const item of sorted) await lockBook(tx, item.resource as TownResourceId)

        const plans: SweepSellPlan[] = []
        for (const item of sorted) plans.push(await planSweepSell(tx, userId, item.resource as TownResourceId, item.quantity))

        for (const id of sweepParticipants(userId, plans)) await lockTownForMarket(tx, id)

        let total = 0
        for (const plan of plans) {
            await applySweepSell(tx, userId, plan)
            total += plan.total
        }
        const lines = plans.map(plan => ({ resource: plan.resource, quantity: plan.quantity, price: plan.floor, total: plan.total }))
        return { total, lines, resources: plans.filter(plan => plan.fills.length > 0).map(plan => plan.resource) }
    })
}

/**
 * Production per hour bucket over the last `hours`, per resource. A settle
 * window that spans several buckets is spread evenly across them.
 */
export async function getProductionHistory(userId: string, hours = 24) {
    const now = Date.now()
    const span = Math.max(1, Math.min(168, Math.floor(hours)))
    const since = new Date(now - span * 3_600_000)
    const rows = await db.select().from(townProduction)
        .where(and(eq(townProduction.userId, userId), gte(townProduction.toAt, since)))
    const bucketMs = 3_600_000
    const start = Math.floor((now - span * bucketMs) / bucketMs) * bucketMs
    const buckets: { at: number, totals: Partial<Record<TownResourceId, number>> }[] = []
    for (let i = 0; i <= span; i++) buckets.push({ at: start + i * bucketMs, totals: {} })
    for (const row of rows) {
        const from = row.fromAt.getTime()
        const to = row.toAt.getTime()
        const first = Math.max(0, Math.floor((from - start) / bucketMs))
        const last = Math.min(buckets.length - 1, Math.floor((to - start) / bucketMs))
        const parts = Math.max(1, last - first + 1)
        for (let i = first; i <= last; i++) {
            const b = buckets[i]!
            const id = row.resource as TownResourceId
            b.totals[id] = (b.totals[id] ?? 0) + row.amount / parts
        }
    }
    return { bucketMs, buckets: buckets.map(b => ({ at: b.at, totals: Object.fromEntries(Object.entries(b.totals).map(([k, v]) => [k, Math.round(v)])) })) }
}

// ─── Player market (order book) ──────────────────────────────────────────────

export interface PlaceTownOrderResult {
    orderId: string
    resource: TownResourceId
    side: 'buy' | 'sell'
    status: 'open' | 'filled'
    quantity: number
    filled: number
    remaining: number
    price: number
    avgFillPrice: number | null
    coinsMoved: number
}

/**
 * Limit order with escrow, matched against the resting book.
 *
 * Price is the mayors' business, not the town hall's: any figure from a
 * hundredth of a coin up to TOWN_MAX_ORDER_PRICE is allowed, in either
 * direction. There is no floor — an ask under what the hall pays is a bad
 * trade, not an invalid one, and the quick sell routes past it anyway — and
 * no ceiling, because a scarce good late in the game is worth far more than
 * ten times its floor. Buys escrow coins (change refunded on cheaper fills),
 * sells escrow the resource. Same engine as the gem exchange.
 */
export async function placeTownOrder(
    userId: string,
    resource: string,
    side: 'buy' | 'sell',
    price: number,
    quantity: number
): Promise<PlaceTownOrderResult> {
    if (!isTownResourceId(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
    if (side !== 'buy' && side !== 'sell') throw createError({ statusCode: 400, statusMessage: 'Choose buy or sell' })
    if (!Number.isFinite(price) || price < TOWN_MARKET_MIN_PRICE) {
        throw createError({ statusCode: 400, statusMessage: `Price must be at least ${TOWN_MARKET_MIN_PRICE}` })
    }
    if (!isValidTownPrice(price)) throw createError({ statusCode: 400, statusMessage: 'Price must have at most 2 decimals' })
    if (!isValidTownQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
    // A price nobody could ever pay is a typo, not an order: the escrow on a
    // buy at 1e15 would fail anyway, and a sell at that price only clutters
    // the book. Cap it well above anything the game can produce.
    if (price > TOWN_MAX_ORDER_PRICE) {
        throw createError({ statusCode: 400, statusMessage: `Price must be ${TOWN_MAX_ORDER_PRICE.toLocaleString('en')} coins or less` })
    }

    return db.transaction(async (tx) => {
        await lockBook(tx, resource)

        // Read the book BEFORE locking any town, so that every town this order
        // touches — the taker's and every counterparty's — can then be locked
        // in one sorted pass. Locking your own first and the counterparty's
        // second deadlocks the moment two players trade with each other on two
        // different books at the same time: each holds what the other wants.
        // The book lock above is what makes reading first safe.
        const opposite = side === 'buy' ? 'sell' : 'buy'
        const priceStr = price.toFixed(4)
        const restingRows = await tx
            .select()
            .from(townOrders)
            .where(and(
                eq(townOrders.resource, resource),
                eq(townOrders.status, 'open'),
                eq(townOrders.side, opposite),
                side === 'buy' ? lte(townOrders.price, priceStr) : gte(townOrders.price, priceStr)
            ))
            .orderBy(side === 'buy' ? asc(townOrders.price) : desc(townOrders.price), asc(townOrders.createdAt))

        const book = restingRows.map(row => ({
            id: row.id,
            userId: row.userId,
            price: parseFloat(row.price),
            remaining: row.quantity - row.filled
        }))
        const { fills, remaining } = matchGemOrder({ side, price, quantity, book })

        const touched = [...new Set([userId, ...fills.map(f => f.userId)])].sort()
        for (const id of touched) await lockTownForMarket(tx, id)

        const [countRow] = await tx
            .select({ openCount: sql<number>`count(*)`.mapWith(Number) })
            .from(townOrders)
            .where(and(eq(townOrders.userId, userId), eq(townOrders.status, 'open')))
        if ((countRow?.openCount ?? 0) >= TOWN_MARKET_MAX_OPEN_ORDERS) {
            throw createError({ statusCode: 400, statusMessage: `All ${TOWN_MARKET_MAX_OPEN_ORDERS} market slots are in use` })
        }

        if (side === 'buy') {
            await debit(userId, townOrderTotal(price, quantity).toFixed(4), CATEGORY, tx)
        } else {
            await takeInventory(tx, userId, resource, quantity)
        }

        let coinsMoved = 0
        for (const fill of fills) {
            const [resting] = await tx.update(townOrders)
                .set({
                    filled: sql`${townOrders.filled} + ${fill.quantity}`,
                    status: sql`case when ${townOrders.filled} + ${fill.quantity} >= ${townOrders.quantity} then 'filled' else 'open' end`,
                    updatedAt: new Date()
                })
                .where(and(eq(townOrders.id, fill.orderId), eq(townOrders.status, 'open')))
                .returning({ id: townOrders.id })
            if (!resting) throw createError({ statusCode: 500, statusMessage: 'Order book conflict' })

            const fillTotal = townOrderTotal(fill.price, fill.quantity)
            // No recordEarnings here at all: see the note on that function.
            if (side === 'buy') {
                const change = townOrderTotal(price, fill.quantity) - fillTotal
                await addInventory(tx, userId, resource, fill.quantity)
                if (change > 0) await credit(userId, change.toFixed(4), CATEGORY_REFUND, tx)
                await credit(fill.userId, fillTotal.toFixed(4), CATEGORY, tx)
            } else {
                await addInventory(tx, fill.userId, resource, fill.quantity)
                await credit(userId, fillTotal.toFixed(4), CATEGORY, tx)
            }
            coinsMoved += fillTotal

            await tx.insert(townTrades).values({
                resource,
                buyerId: side === 'buy' ? userId : fill.userId,
                sellerId: side === 'buy' ? fill.userId : userId,
                takerId: userId,
                price: fill.price.toFixed(4),
                quantity: fill.quantity
            })
        }

        const filled = quantity - remaining
        const status = remaining === 0 ? 'filled' as const : 'open' as const
        const [order] = await tx.insert(townOrders)
            .values({ userId, resource, side, price: priceStr, quantity, filled, status })
            .returning({ id: townOrders.id })

        return {
            orderId: order!.id,
            resource,
            side,
            status,
            quantity,
            filled,
            remaining,
            price,
            avgFillPrice: filled > 0 ? coinsMoved / filled : null,
            coinsMoved
        }
    })
}

export async function cancelTownOrder(userId: string, orderId: string) {
    return db.transaction(async (tx) => {
        const existing = await tx.query.townOrders.findFirst({ where: and(eq(townOrders.id, orderId), eq(townOrders.userId, userId)) })
        if (!existing || !isTownResourceId(existing.resource)) throw createError({ statusCode: 400, statusMessage: 'Order not found' })
        await lockBook(tx, existing.resource)

        const [order] = await tx.update(townOrders)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(and(eq(townOrders.id, orderId), eq(townOrders.userId, userId), eq(townOrders.status, 'open')))
            .returning()
        if (!order) throw createError({ statusCode: 400, statusMessage: 'Order is no longer open' })

        const remaining = order.quantity - order.filled
        if (remaining > 0) {
            await lockTownForMarket(tx, userId)
            if (order.side === 'buy') {
                await credit(userId, townOrderTotal(parseFloat(order.price), remaining).toFixed(4), CATEGORY_REFUND, tx)
            } else {
                await addInventory(tx, userId, existing.resource, remaining)
            }
        }
        return { ok: true, orderId, resource: existing.resource, side: order.side as 'buy' | 'sell', refundedQuantity: remaining }
    })
}

/** One mayor's share of a price level. `mine` lets the client mark the caller's own offers. */
export interface TownBookPlayer {
    id: string
    name: string
    image: string | null
    quantity: number
    mine: boolean
}

export interface TownBookLevel {
    price: number
    quantity: number
    /** Who is behind the level, biggest share first. */
    players: TownBookPlayer[]
}

export async function getTownMarket(resource: string, userId: string | null) {
    if (!isTownResourceId(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })

    const open = await db.select({
        side: townOrders.side,
        price: townOrders.price,
        userId: townOrders.userId,
        userName: user.name,
        userImage: user.image,
        remaining: sql<number>`${townOrders.quantity} - ${townOrders.filled}`.mapWith(Number)
    })
        .from(townOrders)
        .innerJoin(user, eq(user.id, townOrders.userId))
        .where(and(eq(townOrders.resource, resource), eq(townOrders.status, 'open')))

    const agg = (side: 'buy' | 'sell') => {
        const map = new Map<number, Map<string, TownBookPlayer>>()
        for (const row of open) {
            if (row.side !== side) continue
            const price = parseFloat(row.price)
            let level = map.get(price)
            if (!level) map.set(price, level = new Map())
            const p = level.get(row.userId)
            if (p) p.quantity += row.remaining
            else level.set(row.userId, { id: row.userId, name: row.userName, image: row.userImage, quantity: row.remaining, mine: row.userId === userId })
        }
        const levels: TownBookLevel[] = [...map.entries()].map(([price, players]) => {
            const list = [...players.values()].sort((a, b) => b.quantity - a.quantity)
            return { price, quantity: list.reduce((n, p) => n + p.quantity, 0), players: list }
        })
        levels.sort((a, b) => side === 'buy' ? b.price - a.price : a.price - b.price)
        return levels.slice(0, TOWN_MARKET_BOOK_DEPTH)
    }

    // Self-trades are already excluded from the guide price below; leave them
    // out of the printed tape too, or one account can post any price it likes
    // and have every other mayor read it as the market.
    const trades = await db.select()
        .from(townTrades)
        .where(and(
            eq(townTrades.resource, resource),
            sql`(${townTrades.buyerId} is null or ${townTrades.sellerId} is null or ${townTrades.buyerId} <> ${townTrades.sellerId})`
        ))
        .orderBy(desc(townTrades.createdAt))
        .limit(TOWN_MARKET_HISTORY_LIMIT)

    let value = 0
    let volume = 0
    for (const t of trades) {
        if (t.buyerId && t.buyerId === t.sellerId) continue
        value += parseFloat(t.price) * t.quantity
        volume += t.quantity
    }
    const floor = townFloorPrice(resource)
    const ceiling = townCeilingPrice(resource)

    const myOrders = userId
        ? await db.select().from(townOrders)
            .where(and(eq(townOrders.userId, userId), eq(townOrders.resource, resource), eq(townOrders.status, 'open')))
            .orderBy(desc(townOrders.createdAt))
        : []

    return {
        resource,
        floor,
        ceiling,
        guidePrice: volume > 0 ? value / volume : Math.round(floor * 1.5 * 100) / 100,
        bids: agg('buy'),
        asks: agg('sell'),
        trades: trades.map(t => ({ price: parseFloat(t.price), quantity: t.quantity, at: t.createdAt.getTime(), mine: userId !== null && (t.buyerId === userId || t.sellerId === userId) })),
        myOrders: myOrders.map(o => ({
            id: o.id,
            side: o.side as 'buy' | 'sell',
            price: parseFloat(o.price),
            quantity: o.quantity,
            filled: o.filled,
            createdAt: o.createdAt.getTime()
        }))
    }
}

/** Every open order of the player across all resources, for the "my orders" panel. */
export async function getMyTownOrders(userId: string) {
    const rows = await db.select().from(townOrders)
        .where(and(eq(townOrders.userId, userId), eq(townOrders.status, 'open')))
        .orderBy(desc(townOrders.createdAt))
    return rows.map(o => ({
        id: o.id,
        resource: o.resource,
        side: o.side as 'buy' | 'sell',
        price: parseFloat(o.price),
        quantity: o.quantity,
        filled: o.filled,
        createdAt: o.createdAt.getTime()
    }))
}

/** Last-trade price per resource, for the inventory panel's "market" column. */
/**
 * The last traded price of every resource.
 *
 * Written as one indexed lookup per resource rather than `distinct on`: the
 * mixed-direction ordering `distinct on` needs cannot use
 * town_trades_resource_createdAt_idx, so it seq-scanned and disk-sorted the
 * whole trade table on every poll — nearly two seconds at three million rows.
 * A lateral join over the twelve resources hits the index twelve times and
 * comes back in well under a millisecond, however long the table gets.
 */
export async function getTownLastPrices(): Promise<Record<string, number>> {
    const rows = await db.execute<{ resource: string, price: string }>(sql`
        select r.resource, t.price
        from unnest(${sql.raw(`array[${TOWN_RESOURCES.map(r => `'${r.id}'`).join(', ')}]::text[]`)}) as r(resource)
        cross join lateral (
            select price
            from town_trades
            where town_trades.resource = r.resource
              -- A trade with yourself costs nothing and proves nothing, so it
              -- must not become the price every other mayor sees.
              and (buyer_id is null or seller_id is null or buyer_id <> seller_id)
            order by created_at desc
            limit 1
        ) as t
    `)
    const out: Record<string, number> = {}
    const list = Array.isArray(rows) ? rows : (rows as unknown as { rows: { resource: string, price: string }[] }).rows
    for (const row of list) out[row.resource] = parseFloat(row.price)
    return out
}

// ─── Jewels → gems ────────────────────────────────────────────────────────────────

/**
 * Turn jewels into gems, whole gems only. The settle runs first so the jewels
 * dug since the last visit are on the shelf; the conditional decrement in
 * takeInventory is the guard, so a burst of conversions can never pay out more
 * than the jewels actually held. Lock order is the milestone one:
 * town_state → town_inventory → user.
 */
export async function convertJewels(userId: string, gems: number) {
    if (!Number.isInteger(gems) || gems < 1) throw createError({ statusCode: 400, statusMessage: 'Convert at least one whole gem' })
    if (gems > 1_000_000) throw createError({ statusCode: 400, statusMessage: 'That is more than any mine could hold' })
    return db.transaction(async (tx) => {
        await settleTownState(tx, userId)
        const jewels = townJewelsFor(gems)
        await takeInventory(tx, userId, 'jewels', jewels)
        await creditGems(userId, gems, tx)
        return { gems, jewels }
    })
}

export async function deleteTownForUser(userId: string, tx: DbExecutor = db) {
    await tx.delete(townTrades).where(sql`${townTrades.buyerId} = ${userId} or ${townTrades.sellerId} = ${userId}`)
    await tx.delete(townOrders).where(eq(townOrders.userId, userId))
    await tx.delete(townProduction).where(eq(townProduction.userId, userId))
    await tx.delete(townBuildings).where(eq(townBuildings.userId, userId))
    await tx.delete(townInventory).where(eq(townInventory.userId, userId))
    await tx.delete(townPlots).where(eq(townPlots.userId, userId))
    await tx.delete(townResearch).where(eq(townResearch.userId, userId))
    await tx.delete(townState).where(eq(townState.userId, userId))
}
/**
 * Hire one more build crew, permanently. The town_state row is already locked
 * by the settle, so reading the current count inside that lock and writing the
 * increment is safe; the conditional WHERE is belt and braces.
 */
export async function hireTownBuilder(userId: string) {
    return db.transaction(async (tx) => {
        const { state } = await settleTownState(tx, userId)
        const gems = townBuilderGemCost(state.builders)
        if (gems === null) throw createError({ statusCode: 400, statusMessage: `You already have ${TOWN_MAX_BUILDERS} builders` })
        await debitGems(userId, gems, tx)
        const [updated] = await tx.update(townState)
            .set({ builders: state.builders + 1 })
            .where(and(eq(townState.id, state.id), eq(townState.builders, state.builders)))
            .returning({ builders: townState.builders })
        if (!updated) throw createError({ statusCode: 409, statusMessage: 'Try again' })
        return { builders: updated.builders, gems }
    })
}
