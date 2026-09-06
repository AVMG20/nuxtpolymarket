import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { user, townState, townPlots, townBuildings, townInventory, townOrders, townTrades, townProduction } from '#server/database/schema'
import { credit, creditGems, debit, debitGems } from '#server/utils/balance'
import { matchGemOrder } from '#shared/utils/gamelogic/gem-exchange'
import {
    TOWN_PLOT_SIZE,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MAX_PLOTS,
    TOWN_MAX_BUILDING_LEVEL,
    TOWN_MARKET_MAX_OPEN_ORDERS,
    TOWN_MARKET_HISTORY_LIMIT,
    TOWN_MARKET_BOOK_DEPTH,
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
    townPlotDistance,
    isValidTownListPrice,
    TOWN_FOUNDING_GAP,
    townSpiralCoords,
    townFloorPrice,
    townCeilingPrice,
    townOrderTotal,
    isValidTownPrice,
    isValidTownQuantity,
    settleTown,
    deriveTown,
    townTierRequirement,
    townPlaceCost,
    townPlacementIssue,
    townMilestoneSnapshot,
    townMilestoneComplete,
    getTownMilestone,
    TOWN_MILESTONES,
    type TownResourceId,
    type TownResourceBag,
    type TownSimBuilding,
    type TownSatisfied
} from '#shared/utils/gamelogic/town'

const CATEGORY = 'polytown'

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

/** Upsert-increment. Never writes an absolute value, so concurrent fills and settles commute. */
export async function addInventory(tx: DbExecutor, userId: string, resource: TownResourceId, delta: number) {
    if (delta === 0) return
    await tx.insert(townInventory)
        .values({ userId, resource, amount: delta })
        .onConflictDoUpdate({
            target: [townInventory.userId, townInventory.resource],
            set: { amount: sql`${townInventory.amount} + ${delta}` }
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

async function spendBag(tx: DbExecutor, userId: string, bag: TownResourceBag) {
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

    const result = settleTown({
        happiness: state.happiness,
        tickProgressMs: state.tickProgressMs,
        lastSettledAt: state.lastSettledAt.getTime(),
        inventory,
        buildings: simBefore
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
            produced: producedTotals
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
        satisfied: result.satisfied
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
    const owned = await tx.select({ x: townPlots.x, y: townPlots.y }).from(townPlots)
    for (let i = 0; i < 100_000; i++) {
        const spot = townSpiralCoords(i)
        if (owned.some(p => townPlotDistance(p, spot) <= TOWN_FOUNDING_GAP)) continue
        const [plot] = await tx.insert(townPlots).values({ userId, x: spot.x, y: spot.y, paidPrice: '0' }).onConflictDoNothing().returning()
        if (plot) return plot
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

export function plotPurchaseInfo(state: { plotsBought: number, lastPlotBoughtAt: Date }, now = Date.now()) {
    const nextIndex = state.plotsBought + 1
    const cooldownMs = townPlotCooldownMs(nextIndex)
    const availableAt = state.lastPlotBoughtAt.getTime() + cooldownMs
    return {
        nextIndex,
        price: townPlotPrice(nextIndex),
        cooldownMs,
        availableAt,
        remainingMs: Math.max(0, availableAt - now),
        maxed: state.plotsBought >= TOWN_MAX_PLOTS
    }
}

export async function buyPlot(userId: string, x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw createError({ statusCode: 400, statusMessage: 'Pick a square on the map' })
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { state, plots } = await settleTownState(tx, userId, now)
        const info = plotPurchaseInfo(state, now)
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
export async function buyPlotFromPlayer(userId: string, plotId: string) {
    return db.transaction(async (tx) => {
        await lockPlots(tx)
        const listing = await tx.query.townPlots.findFirst({ where: eq(townPlots.id, plotId) })
        if (!listing || listing.listPrice === null) throw createError({ statusCode: 400, statusMessage: 'That plot is not for sale' })
        if (listing.userId === userId) throw createError({ statusCode: 400, statusMessage: 'That plot is already yours' })
        const sellerId = listing.userId
        const price = parseFloat(listing.listPrice)

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
            .set({ userId, listPrice: null, paidPrice: price.toFixed(4) })
            .where(and(eq(townPlots.id, plotId), eq(townPlots.userId, sellerId), sql`${townPlots.listPrice} is not null`))
            .returning({ id: townPlots.id })
        if (!bought) throw createError({ statusCode: 409, statusMessage: 'Someone just bought that plot' })

        await debit(userId, price.toFixed(4), CATEGORY, tx)
        await credit(sellerId, price.toFixed(4), CATEGORY, tx)
        await tx.update(townState).set({ plotsBought: sql`${townState.plotsBought} + 1` }).where(eq(townState.userId, userId))
        await tx.update(townState).set({ plotsBought: sql`greatest(1, ${townState.plotsBought} - 1)` }).where(eq(townState.userId, sellerId))
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
        .limit(120)
    if (rows.length === 0) return { towns: [], listings: [] }

    const buildings = await db.select({
        plotId: townBuildings.plotId,
        type: townBuildings.type,
        tileX: townBuildings.tileX,
        tileY: townBuildings.tileY,
        rotation: townBuildings.rotation,
        level: townBuildings.level
    })
        .from(townBuildings)
        .where(and(inArray(townBuildings.plotId, rows.map(r => r.id)), gt(townBuildings.level, 0)))
        .limit(600)

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

export async function placeBuilding(userId: string, plotId: string, tileX: number, tileY: number, type: string, rotation = 0) {
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
        throw createError({ statusCode: 400, statusMessage: 'Rotation must be 0, 1, 2 or 3 quarter turns' })
    }
    const def = getTownBuilding(type)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Unknown building' })
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX >= TOWN_PLOT_SIZE || tileY >= TOWN_PLOT_SIZE) {
        throw createError({ statusCode: 400, statusMessage: 'That tile is off the plot' })
    }

    return db.transaction(async (tx) => {
        const now = Date.now()
        const { sim, state } = await settleTownState(tx, userId, now)

        const plot = await tx.query.townPlots.findFirst({ where: and(eq(townPlots.id, plotId), eq(townPlots.userId, userId)) })
        if (!plot) throw createError({ statusCode: 400, statusMessage: 'That plot is not yours' })
        const lock = townTierRequirement(sim, def.tier, now, state.produced)
        if (lock) {
            const why = lock.needsBuilding
                ? `Finish a tier ${def.tier - 1} building first`
                : lock.pop < lock.popRequired
                    ? `Tier ${def.tier} needs ${lock.popRequired} residents (you house ${lock.pop})`
                    : `Tier ${def.tier} opens after producing ${lock.producedRequired} tier-${lock.producedTier} goods (${lock.produced} so far)`
            throw createError({ statusCode: 400, statusMessage: why })
        }

        const wx = plot.x * TOWN_PLOT_SIZE + tileX
        const wy = plot.y * TOWN_PLOT_SIZE + tileY
        const issue = townPlacementIssue(sim, def, wx, wy, rotation)
        if (issue) throw createError({ statusCode: 400, statusMessage: issue })

        // The n-th copy costs more: count every existing one, finished or not.
        const existing = sim.filter(b => b.type === def.id).length
        const cost = townPlaceCost(def, existing)
        if (cost.coins > 0) await debit(userId, cost.coins.toFixed(4), CATEGORY, tx)
        await spendBag(tx, userId, cost.resources)

        // Roads are instant; everything else builds, faster in a happier town.
        const instant = def.kind === 'road'
        const buildMs = instant ? 0 : townLevelBuildMs(def, 1, state.happiness)

        // The unique (plot, tile) constraint is the occupancy guard.
        const [building] = await tx.insert(townBuildings)
            .values({
                userId,
                plotId,
                type: def.id,
                tileX,
                tileY,
                rotation,
                level: instant ? 1 : 0,
                completesAt: new Date(now + buildMs)
            })
            .onConflictDoNothing()
            .returning()
        if (!building) throw createError({ statusCode: 400, statusMessage: 'That tile is already taken' })
        // Building on a listed plot takes it off the market.
        await tx.update(townPlots).set({ listPrice: null }).where(eq(townPlots.id, plotId))
        return { buildingId: building.id, completesAt: building.completesAt.getTime(), cost }
    })
}

/**
 * Move a finished building to another tile on any owned plot. Free, but the
 * same road rule applies at the new spot, and a road cannot be moved out from
 * under the buildings whose front door it serves.
 */
export async function moveBuilding(userId: string, buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number) {
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
        throw createError({ statusCode: 400, statusMessage: 'Rotation must be 0, 1, 2 or 3 quarter turns' })
    }
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX >= TOWN_PLOT_SIZE || tileY >= TOWN_PLOT_SIZE) {
        throw createError({ statusCode: 400, statusMessage: 'That tile is off the plot' })
    }
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { sim, buildings } = await settleTownState(tx, userId, now)
        const row = buildings.find(b => b.id === buildingId)
        const me = sim.find(b => b.id === buildingId)
        if (!row || !me) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
        if (row.level === 0 || row.upgradingTo !== null) throw createError({ statusCode: 400, statusMessage: 'Finish building it first' })
        const def = getTownBuilding(row.type)!

        const plot = await tx.query.townPlots.findFirst({ where: and(eq(townPlots.id, plotId), eq(townPlots.userId, userId)) })
        if (!plot) throw createError({ statusCode: 400, statusMessage: 'That plot is not yours' })
        const wx = plot.x * TOWN_PLOT_SIZE + tileX
        const wy = plot.y * TOWN_PLOT_SIZE + tileY

        // Moving a road may cut buildings off — they simply stop working until reconnected.
        const others = sim.filter(b => b.id !== buildingId)
        const issue = townPlacementIssue(others, def, wx, wy, rotation)
        if (issue) throw createError({ statusCode: 400, statusMessage: issue })

        const [moved] = await tx.update(townBuildings)
            .set({ plotId, tileX, tileY, rotation })
            .where(and(eq(townBuildings.id, buildingId), eq(townBuildings.userId, userId)))
            .returning({ id: townBuildings.id })
        if (!moved) throw createError({ statusCode: 400, statusMessage: 'That tile is already taken' })
        await tx.update(townPlots).set({ listPrice: null }).where(eq(townPlots.id, plotId))
        return { buildingId, plotId, tileX, tileY, rotation }
    })
}

export async function upgradeBuilding(userId: string, buildingId: string) {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const { buildings, state } = await settleTownState(tx, userId, now)
        const building = buildings.find(b => b.id === buildingId)
        if (!building) throw createError({ statusCode: 404, statusMessage: 'Building not found' })
        if (building.level === 0) throw createError({ statusCode: 400, statusMessage: 'Still under construction' })
        if (building.upgradingTo !== null) throw createError({ statusCode: 400, statusMessage: 'Already upgrading' })
        if (building.level >= TOWN_MAX_BUILDING_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

        const def = getTownBuilding(building.type)!
        if (def.kind === 'road') throw createError({ statusCode: 400, statusMessage: 'Roads have no levels' })
        const nextLevel = building.level + 1
        const cost = townLevelCost(def, nextLevel)
        if (cost.coins > 0) await debit(userId, cost.coins.toFixed(4), CATEGORY, tx)
        await spendBag(tx, userId, cost.resources)

        const completesAt = new Date(now + townLevelBuildMs(def, nextLevel, state.happiness))
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

/** Lifetime sales counter behind the merchant milestones. Plain increment, no read. */
async function recordEarnings(tx: DbExecutor, userId: string, coins: number) {
    if (coins <= 0) return
    await tx.update(townState)
        .set({ coinsEarned: sql`${townState.coinsEarned} + ${coins.toFixed(4)}::numeric` })
        .where(eq(townState.userId, userId))
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export function milestoneSnapshotFor(settled: Pick<SettledTown, 'state' | 'sim' | 'inventory' | 'satisfied'>, now: number) {
    const derived = deriveTown(settled.sim, settled.state.happiness, now, settled.satisfied)
    return townMilestoneSnapshot(settled.sim, derived, settled.state.happiness, settled.state.plotsBought, parseFloat(settled.state.coinsEarned), now)
}

export function serializeMilestones(settled: Pick<SettledTown, 'state' | 'sim' | 'inventory' | 'satisfied'>, now: number) {
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

export async function sellToFloor(userId: string, resource: string, quantity: number) {
    if (!isTownResourceId(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
    if (!isValidTownQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
    const price = townFloorPrice(resource)
    const total = townOrderTotal(price, quantity)
    return db.transaction(async (tx) => {
        await lockTownForMarket(tx, userId)
        // The conditional decrement is the guard — inventory increments commute.
        await takeInventory(tx, userId, resource, quantity)
        await credit(userId, total.toFixed(4), CATEGORY, tx)
        await recordEarnings(tx, userId, total)
        return { resource, quantity, price, total }
    })
}

/**
 * Sell several resources to the town hall in one transaction. Each line is
 * guarded by the conditional decrement in takeInventory, so a stale quantity
 * fails that line's whole batch rather than overselling.
 */
export async function sellBulkToFloor(userId: string, items: { resource: string, quantity: number }[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > TOWN_RESOURCES.length) {
        throw createError({ statusCode: 400, statusMessage: 'Nothing to sell' })
    }
    const lines: { resource: TownResourceId, quantity: number, price: number, total: number }[] = []
    for (const item of items) {
        if (!isTownResourceId(item.resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })
        if (!isValidTownQuantity(item.quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
        const price = townFloorPrice(item.resource)
        lines.push({ resource: item.resource, quantity: item.quantity, price, total: townOrderTotal(price, item.quantity) })
    }
    return db.transaction(async (tx) => {
        await lockTownForMarket(tx, userId)
        let total = 0
        for (const line of lines) {
            await takeInventory(tx, userId, line.resource, line.quantity)
            total += line.total
        }
        await credit(userId, total.toFixed(4), CATEGORY, tx)
        await recordEarnings(tx, userId, total)
        return { total, lines }
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
 * Limit order with escrow, matched against the resting book. Prices are
 * clamped to the system band [floor, ceiling]: nobody can undercut the
 * system's buy price or overcharge above what the system sells at, which keeps
 * the book meaningful and pump-proof. Buys escrow coins (change refunded on
 * cheaper fills), sells escrow the resource. Same engine as the gem exchange.
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
    if (!isValidTownPrice(price)) throw createError({ statusCode: 400, statusMessage: 'Price must have at most 2 decimals' })
    if (!isValidTownQuantity(quantity)) throw createError({ statusCode: 400, statusMessage: 'Quantity must be a whole number' })
    const floor = townFloorPrice(resource)
    const ceiling = townCeilingPrice(resource)
    if (price < floor || price > ceiling) {
        throw createError({ statusCode: 400, statusMessage: `Price must be between ${floor} and ${ceiling} coins` })
    }

    return db.transaction(async (tx) => {
        await lockBook(tx, resource)
        // Own town first (lock order: town_state → inventory → user). This also
        // serializes the cross-resource open-order cap below.
        await lockTownForMarket(tx, userId)

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
            if (fill.userId !== userId) await lockTownForMarket(tx, fill.userId)
            if (side === 'buy') {
                const change = townOrderTotal(price, fill.quantity) - fillTotal
                await addInventory(tx, userId, resource, fill.quantity)
                if (change > 0) await credit(userId, change.toFixed(4), CATEGORY, tx)
                await recordEarnings(tx, fill.userId, fillTotal)
                await credit(fill.userId, fillTotal.toFixed(4), CATEGORY, tx)
            } else {
                await addInventory(tx, fill.userId, resource, fill.quantity)
                await recordEarnings(tx, userId, fillTotal)
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
                await credit(userId, townOrderTotal(parseFloat(order.price), remaining).toFixed(4), CATEGORY, tx)
            } else {
                await addInventory(tx, userId, existing.resource, remaining)
            }
        }
        return { ok: true, orderId, resource: existing.resource, side: order.side as 'buy' | 'sell', refundedQuantity: remaining }
    })
}

export interface TownBookLevel {
    price: number
    quantity: number
}

export async function getTownMarket(resource: string, userId: string | null) {
    if (!isTownResourceId(resource)) throw createError({ statusCode: 400, statusMessage: 'Unknown resource' })

    const open = await db.select({
        side: townOrders.side,
        price: townOrders.price,
        remaining: sql<number>`${townOrders.quantity} - ${townOrders.filled}`.mapWith(Number)
    })
        .from(townOrders)
        .where(and(eq(townOrders.resource, resource), eq(townOrders.status, 'open')))

    const agg = (side: 'buy' | 'sell') => {
        const map = new Map<number, number>()
        for (const row of open) {
            if (row.side !== side) continue
            const price = parseFloat(row.price)
            map.set(price, (map.get(price) ?? 0) + row.remaining)
        }
        const levels: TownBookLevel[] = [...map.entries()].map(([price, quantity]) => ({ price, quantity }))
        levels.sort((a, b) => side === 'buy' ? b.price - a.price : a.price - b.price)
        return levels.slice(0, TOWN_MARKET_BOOK_DEPTH)
    }

    const trades = await db.select()
        .from(townTrades)
        .where(eq(townTrades.resource, resource))
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
export async function getTownLastPrices(): Promise<Record<string, number>> {
    const rows = await db.execute<{ resource: string, price: string }>(sql`
        select distinct on (resource) resource, price
        from town_trades
        order by resource, created_at desc
    `)
    const out: Record<string, number> = {}
    const list = Array.isArray(rows) ? rows : (rows as unknown as { rows: { resource: string, price: string }[] }).rows
    for (const row of list) out[row.resource] = parseFloat(row.price)
    return out
}

export async function deleteTownForUser(userId: string, tx: DbExecutor = db) {
    await tx.delete(townTrades).where(sql`${townTrades.buyerId} = ${userId} or ${townTrades.sellerId} = ${userId}`)
    await tx.delete(townOrders).where(eq(townOrders.userId, userId))
    await tx.delete(townProduction).where(eq(townProduction.userId, userId))
    await tx.delete(townBuildings).where(eq(townBuildings.userId, userId))
    await tx.delete(townInventory).where(eq(townInventory.userId, userId))
    await tx.delete(townPlots).where(eq(townPlots.userId, userId))
    await tx.delete(townState).where(eq(townState.userId, userId))
}