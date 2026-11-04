// One-off: bring stray Polytown towns back to the others. Founding used to
// resume a spiral cursor that only moved outward, so some mayors were planted
// far from everybody else. This moves every town that stands more than
// STRAY_GAP squares from the nearest other town to the closest free spot by
// the centre, keeping its shape (all its plots shift together, buildings ride
// along on them) and the founding gap, and never putting a building on water.
//
// Terrain is a function of world coordinates, so a moved town gets the new
// spot's soil, timber and stone bonuses.
//
//   bun scripts/polytown-gather-towns.ts           show the moves (dry run)
//   bun scripts/polytown-gather-towns.ts --apply   make them
//
// Point DATABASE_URL at the database to fix.
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../server/database/index.ts'
import { townBuildings, townPlots, townState, user } from '../server/database/schema.ts'
import {
    TOWN_FOUNDING_GAP,
    TOWN_PLOT_SIZE,
    getTownTerrain,
    townBuildingSize,
    townFootprint,
    townSpiralCoords,
    townTerrainAt
} from '../shared/utils/gamelogic/town.ts'

/** A town further than this many empty squares from every other town is moved in. */
const STRAY_GAP = TOWN_FOUNDING_GAP + 4
/** The same advisory lock founding and plot buys take, so nobody claims land mid-move. */
const TOWN_PLOT_LOCK_KEY = 761_442_020

const apply = process.argv.includes('--apply')

interface Plot { id: string, x: number, y: number, createdAt: Date }
interface Town { userId: string, name: string, plots: Plot[], buildings: { plotId: string, type: string, tileX: number, tileY: number }[] }

const chebyshev = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const ring = (p: { x: number, y: number }) => Math.max(Math.abs(p.x), Math.abs(p.y))

await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${TOWN_PLOT_LOCK_KEY})`)

    const plotRows = await tx.select({ id: townPlots.id, userId: townPlots.userId, x: townPlots.x, y: townPlots.y, createdAt: townPlots.createdAt, name: user.name })
        .from(townPlots).innerJoin(user, eq(user.id, townPlots.userId))
        .orderBy(asc(townPlots.createdAt), asc(townPlots.id))
    const buildingRows = await tx.select({ plotId: townBuildings.plotId, userId: townBuildings.userId, type: townBuildings.type, tileX: townBuildings.tileX, tileY: townBuildings.tileY })
        .from(townBuildings)

    const towns = new Map<string, Town>()
    for (const p of plotRows) {
        const town = towns.get(p.userId) ?? { userId: p.userId, name: p.name, plots: [], buildings: [] }
        town.plots.push({ id: p.id, x: p.x, y: p.y, createdAt: p.createdAt })
        towns.set(p.userId, town)
    }
    for (const b of buildingRows) towns.get(b.userId)?.buildings.push(b)

    // Nearest the centre first: those are the realm the strays are brought to.
    const order = [...towns.values()].sort((a, z) => Math.min(...a.plots.map(ring)) - Math.min(...z.plots.map(ring)))
    const placed: { x: number, y: number }[] = []
    const occupied = new Set(plotRows.map(p => `${p.x},${p.y}`))
    const moves: { town: Town, dx: number, dy: number, from: number }[] = []

    const fits = (town: Town, dx: number, dy: number) => {
        for (const p of town.plots) {
            const at = { x: p.x + dx, y: p.y + dy }
            if (occupied.has(`${at.x},${at.y}`)) return false
            if (placed.some(q => chebyshev(q, at) <= TOWN_FOUNDING_GAP)) return false
        }
        const byId = new Map(town.plots.map(p => [p.id, p]))
        for (const b of town.buildings) {
            const p = byId.get(b.plotId)
            if (!p) continue
            const wx = (p.x + dx) * TOWN_PLOT_SIZE + b.tileX
            const wy = (p.y + dy) * TOWN_PLOT_SIZE + b.tileY
            for (const t of townFootprint(wx, wy, townBuildingSize(b.type))) {
                if (getTownTerrain(townTerrainAt(t.wx, t.wy)).blocked) return false
            }
        }
        return true
    }

    for (const town of order) {
        const nearest = placed.length === 0 ? 0 : Math.min(...town.plots.flatMap(p => placed.map(q => chebyshev(p, q)))) - 1
        if (placed.length === 0 || nearest <= STRAY_GAP) {
            placed.push(...town.plots)
            continue
        }
        // The first-founded plot is the anchor the rest of the town keeps its shape around.
        const anchor = town.plots[0]!
        let found: { dx: number, dy: number } | null = null
        for (let index = 0; index < 200_000 && !found; index++) {
            const spot = townSpiralCoords(index)
            if (fits(town, spot.x - anchor.x, spot.y - anchor.y)) found = { dx: spot.x - anchor.x, dy: spot.y - anchor.y }
        }
        if (!found) {
            console.log(`No spot found for ${town.name}; left where it is`)
            placed.push(...town.plots)
            continue
        }
        for (const p of town.plots) {
            occupied.delete(`${p.x},${p.y}`)
            occupied.add(`${p.x + found.dx},${p.y + found.dy}`)
            placed.push({ x: p.x + found.dx, y: p.y + found.dy })
        }
        moves.push({ town, ...found, from: nearest })
    }

    if (moves.length === 0) {
        console.log(`All ${towns.size} towns already stand together. Nothing to move.`)
        return
    }
    for (const { town, dx, dy, from } of moves) {
        const a = town.plots[0]!
        console.log(`${town.name}: ${town.plots.length} plot(s), ${town.buildings.length} building(s), ${from} squares from the nearest town, (${a.x},${a.y}) → (${a.x + dx},${a.y + dy})`)
    }
    if (!apply) {
        console.log('\nDry run. Run with --apply to move them.')
        return
    }

    // Each mayor's town is locked like any town mutation, so a settle or a
    // build in flight finishes first and none starts mid-move.
    await tx.select({ id: townState.id }).from(townState).where(inArray(townState.userId, moves.map(m => m.town.userId))).for('update')
    for (const { town, dx, dy } of moves) {
        for (const p of town.plots) {
            await tx.update(townPlots).set({ x: p.x + dx, y: p.y + dy }).where(eq(townPlots.id, p.id))
        }
    }
    console.log(`\nMoved ${moves.length} town(s).`)
})

await db.$client.end()
