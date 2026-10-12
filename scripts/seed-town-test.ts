// Local dev: a Polytown account that owns every building at every look, to
// walk around the artwork in the real game. Five plots in a row, one per look
// (level 1, 5, 10, 15, 20); buildings that cap lower show their top look.
//
//   bun scripts/seed-town-test.ts
//
// Log in as towntest@local.test / password123. Re-running rebuilds it.
import { eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { db } from '../server/database/index.ts'
import { account, townBuildings, townPlots, townState, user } from '../server/database/schema.ts'
import { TOWN_BUILDINGS, TOWN_PLOT_SIZE, townBuildingMaxLevel } from '../shared/utils/gamelogic/town.ts'

const EMAIL = 'towntest@local.test'
const PASSWORD = 'password123'
const LEVELS = [1, 5, 10, 15, 20]
/** Right beside the towns near the origin, so it shows up when you look around. */
const ORIGIN = { x: 2, y: -1 }

const existing = await db.query.user.findFirst({ where: eq(user.email, EMAIL) })
if (existing) {
    await db.delete(user).where(eq(user.id, existing.id))
    console.log('Removed the previous test town')
}

const userId = crypto.randomUUID()
const now = new Date()
const past = new Date(now.getTime() - 60_000)
await db.insert(user).values({ id: userId, name: 'Town Test', email: EMAIL, emailVerified: true, balance: '100000000.0000', gems: 50_000, createdAt: now, updatedAt: now })
await db.insert(account).values({ id: crypto.randomUUID(), accountId: userId, providerId: 'credential', userId, password: await hashPassword(PASSWORD), createdAt: now, updatedAt: now })
await db.insert(townState).values({ userId, plotsBought: LEVELS.length, happiness: 100 })

const types = TOWN_BUILDINGS.filter(b => b.kind !== 'road')
for (const [i, level] of LEVELS.entries()) {
    const [plot] = await db.insert(townPlots).values({ userId, x: ORIGIN.x + i, y: ORIGIN.y }).returning()
    const rows: typeof townBuildings.$inferInsert[] = []
    const put = (type: string, tileX: number, tileY: number, lvl: number) => rows.push({ userId, plotId: plot!.id, type, tileX, tileY, level: lvl, completesAt: past })
    // Every building type on the first rows, a road, then a street of houses.
    const slots: [number, number][] = []
    for (const ty of [0, 1, 3, 4, 6, 7]) for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) slots.push([tx, ty])
    types.forEach((def, n) => put(def.id, slots[n]![0], slots[n]![1], Math.min(level, townBuildingMaxLevel(def))))
    for (let n = types.length; n < slots.length; n++) put('house', slots[n]![0], slots[n]![1], level)
    for (const ty of [2, 5]) for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) put('road', tx, ty, 1)
    await db.insert(townBuildings).values(rows)
    console.log(`Plot ${ORIGIN.x + i},${ORIGIN.y}: level ${level}, ${rows.length} tiles`)
}

console.log(`Log in as ${EMAIL} / ${PASSWORD}`)
process.exit(0)
