// Clones one account's Hero Quest save onto a second login, so the Arena has a real defender to
// draw. Usage: bun scripts/seed-hero-quest-rival.ts [sourceEmail] [rivalEmail] [rivalName]
import { eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { db } from '../server/database/index.ts'
import {
    user,
    account,
    hqState,
    hqCollection,
    hqLoadouts,
    hqShopUpgrades,
    hqTraitSlots,
    hqTraitSaveSlots
} from '../server/database/schema.ts'

const SOURCE_EMAIL = process.argv[2] ?? 'test@test.test'
const RIVAL_EMAIL = process.argv[3] ?? 'rival@test.test'
const RIVAL_NAME = process.argv[4] ?? 'Rival'
const PASSWORD = 'password123'

/** A row as copied: a fresh id and the rival's user id. */
function cloned<T extends { id: string, userId: string }>(row: T, userId: string): T {
    return { ...row, id: crypto.randomUUID(), userId }
}

async function main() {
    const source = await db.query.user.findFirst({ where: eq(user.email, SOURCE_EMAIL) })
    if (!source) throw new Error(`No account ${SOURCE_EMAIL}`)
    const [state] = await db.select().from(hqState).where(eq(hqState.userId, source.id))
    if (!state) throw new Error(`${SOURCE_EMAIL} has no Hero Quest save`)

    // every Hero Quest table cascades off the user row, so deleting it clears an earlier rival
    const existing = await db.query.user.findFirst({ where: eq(user.email, RIVAL_EMAIL) })
    if (existing) {
        await db.delete(user).where(eq(user.id, existing.id))
        console.log(`Removed existing ${RIVAL_EMAIL}`)
    }

    const userId = crypto.randomUUID()
    const now = new Date()
    await db.insert(user).values({
        id: userId,
        name: RIVAL_NAME,
        email: RIVAL_EMAIL,
        emailVerified: true,
        image: null,
        balance: '1000000.0000',
        gems: 5000,
        createdAt: now,
        updatedAt: now
    })
    await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(PASSWORD),
        createdAt: now,
        updatedAt: now
    })

    // the source's live party defends, as its saved defence may be long out of date; Arena standing
    // starts fresh, and the Defense GPN needs the server's sim, so it waits for the rival to save it
    const defenseLoadout = {
        partyChampionIds: state.partyChampionIds,
        formation: state.formation,
        equippedSkillIds: state.equippedSkillIds,
        equippedArtifactIds: state.equippedArtifactIds,
        equippedGear: state.equippedGear
    }
    await db.insert(hqState).values({
        ...cloned(state, userId),
        lastSettledAt: now,
        defenseLoadout,
        defenseGpn: null,
        arenaRating: 1000,
        arenaSeasonId: 0,
        arenaSeasonMatches: 0,
        arenaMedals: 0,
        arenaWins: 0,
        arenaAttemptsUsedToday: 0,
        arenaExtraAttemptsPurchasedToday: 0,
        arenaAttemptDate: null,
        arenaRefreshesToday: 0,
        arenaRefreshDate: null,
        arenaCandidates: []
    })

    const tables = [hqCollection, hqLoadouts, hqShopUpgrades, hqTraitSlots, hqTraitSaveSlots] as const
    for (const table of tables) {
        const rows = await db.select().from(table).where(eq(table.userId, source.id))
        if (rows.length) await db.insert(table).values(rows.map(row => cloned(row, userId)) as never)
        console.log(`${table === hqCollection ? 'collection' : 'rows'}: ${rows.length}`)
    }

    console.log(`${RIVAL_EMAIL} / ${PASSWORD} cloned from ${SOURCE_EMAIL}: log in and save its defence to fill in its GPN`)
    process.exit(0)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
