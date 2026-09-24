import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { goldMinerState } from '#server/database/schema'
import { credit, debit, getBalance } from '#server/utils/balance'
import { randomInt } from '#shared/utils/random'
import {
    GM_INTRO_MS,
    GM_LEVEL_MS,
    GM_MAX_DYNAMITE,
    GM_MAX_STAKE,
    GM_MIN_STAKE,
    GM_SUBMIT_GRACE_MS,
    gmBagOutcome,
    gmGenerateLevel,
    gmGoal,
    gmLevelSeed,
    gmPayout,
    gmScoreLevel,
    gmShopOffers,
    type GmBagOutcome,
    type GmGrab,
    type GmLevelResult,
    type GmOffer,
    type GmPerks,
    type GmRunView,
    type GmShopItem
} from '#shared/utils/gamelogic/gold-miner'

type GoldMinerRow = typeof goldMinerState.$inferSelect

/** Wall-clock slack either way between the client's level clock and ours. */
const CLOCK_SLACK_MS = 2_500

export async function ensureGoldMinerState(userId: string) {
    // Two first-visit requests can race the insert — the loser reads the row the winner created.
    await db.insert(goldMinerState).values({ userId }).onConflictDoNothing()
}

export async function getLockedGoldMinerState(tx: DbExecutor, userId: string): Promise<GoldMinerRow> {
    const [state] = await tx.select().from(goldMinerState).where(eq(goldMinerState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Gold Miner state not initialised' })
    return state
}

function perksOf(row: GoldMinerRow): GmPerks {
    return { strength: row.strength, clover: row.clover, book: row.book, polish: row.polish }
}

/** The run as the client sees it. Never includes `secret`. */
export function goldMinerRunView(row: GoldMinerRow, now = Date.now()): GmRunView | null {
    if (!row.phase) return null
    const stake = parseFloat(row.stake)
    return {
        phase: row.phase,
        stake,
        level: row.level,
        levelSeed: row.phase === 'level' ? gmLevelSeed(row.secret, row.level) : null,
        goal: gmGoal(row.level),
        cash: row.cash,
        dynamite: row.dynamite,
        perks: perksOf(row),
        // Negative while the intro card is still up.
        levelElapsedMs: row.phase === 'level' && row.levelStartsAt ? now - row.levelStartsAt.getTime() : null,
        offers: row.phase === 'shop' ? row.offers : [],
        bought: row.phase === 'shop' ? row.bought : [],
        payoutNow: gmPayout(stake, row.cash)
    }
}

function statsView(row: GoldMinerRow) {
    return {
        runsPlayed: row.runsPlayed,
        bestLevel: row.bestLevel,
        bestPayout: parseFloat(row.bestPayout),
        totalStaked: parseFloat(row.totalStaked),
        totalPaid: parseFloat(row.totalPaid)
    }
}

/** Every run column back to its between-runs value. */
function clearedRun() {
    return {
        phase: null,
        stake: '0',
        secret: 0,
        level: 0,
        cash: 0,
        dynamite: 0,
        strength: false,
        clover: false,
        book: false,
        polish: false,
        levelStartsAt: null,
        offers: [] as GmOffer[],
        bought: [] as GmShopItem[]
    }
}

/**
 * Ends the run in the row without paying anything. The phase guard is the
 * claim: a second request that raced us here finds no run and updates nothing.
 */
async function loseRun(tx: DbExecutor, row: GoldMinerRow) {
    const [ended] = await tx.update(goldMinerState).set({ ...clearedRun() })
        .where(and(eq(goldMinerState.id, row.id), isNotNull(goldMinerState.phase)))
        .returning({ id: goldMinerState.id })
    return !!ended
}

/** A level left running past its deadline is forfeit. Call with the row locked. */
async function expireIfAbandoned(tx: DbExecutor, row: GoldMinerRow, now: number): Promise<boolean> {
    if (row.phase !== 'level' || !row.levelStartsAt) return false
    if (now <= row.levelStartsAt.getTime() + GM_LEVEL_MS + GM_SUBMIT_GRACE_MS) return false
    return loseRun(tx, row)
}

export async function goldMinerSnapshot(userId: string) {
    await ensureGoldMinerState(userId)
    const now = Date.now()
    const row = await db.transaction(async (tx) => {
        const state = await getLockedGoldMinerState(tx, userId)
        if (await expireIfAbandoned(tx, state, now)) return getLockedGoldMinerState(tx, userId)
        return state
    })
    return {
        balance: parseFloat(await getBalance(userId)),
        stats: statsView(row),
        run: goldMinerRunView(row, now)
    }
}

export function parseGoldMinerStake(raw: unknown): number {
    const stake = Math.floor(Number(raw) * 100) / 100
    if (!Number.isFinite(stake) || stake < GM_MIN_STAKE || stake > GM_MAX_STAKE) {
        throw createError({ statusCode: 400, statusMessage: `Stake must be between ${GM_MIN_STAKE} and ${GM_MAX_STAKE.toLocaleString('en')} coins` })
    }
    return stake
}

export async function goldMinerStart(userId: string, stake: number) {
    await ensureGoldMinerState(userId)
    return db.transaction(async (tx) => {
        const now = Date.now()
        const state = await getLockedGoldMinerState(tx, userId)
        await expireIfAbandoned(tx, state, now)
        const fresh = await getLockedGoldMinerState(tx, userId)
        if (fresh.phase) throw createError({ statusCode: 400, statusMessage: 'A Gold Miner run is already underway' })

        // Throws 400 when the player can't cover it, rolling the whole thing back.
        await debit(userId, stake.toFixed(4), 'gold-miner', tx)
        const [row] = await tx.update(goldMinerState).set({
            ...clearedRun(),
            phase: 'level',
            stake: stake.toFixed(4),
            secret: randomInt(1, 2_147_483_646),
            level: 1,
            levelStartsAt: new Date(now + GM_INTRO_MS),
            runsPlayed: sql`${goldMinerState.runsPlayed} + 1`,
            totalStaked: sql`${goldMinerState.totalStaked} + ${stake.toFixed(4)}`
        }).where(and(eq(goldMinerState.id, fresh.id), sql`${goldMinerState.phase} is null`)).returning()
        if (!row) throw createError({ statusCode: 400, statusMessage: 'A Gold Miner run is already underway' })
        return { run: goldMinerRunView(row, now)! }
    })
}

/** Reveals one mystery bag on the current level. Read-only: the result is a pure function of the secret. */
export async function goldMinerBag(userId: string, itemId: number): Promise<GmBagOutcome> {
    const row = await db.query.goldMinerState.findFirst({ where: eq(goldMinerState.userId, userId) })
    if (!row || row.phase !== 'level') throw createError({ statusCode: 400, statusMessage: 'No level in progress' })
    const level = gmGenerateLevel(gmLevelSeed(row.secret, row.level), row.level)
    const item = level.items.find(i => i.id === itemId)
    if (!item || item.kind !== 'bag') throw createError({ statusCode: 400, statusMessage: 'That is not a mystery bag' })
    return gmBagOutcome(row.secret, row.level, itemId, row.clover)
}

export async function goldMinerSubmitLevel(userId: string, grabs: GmGrab[]): Promise<GmLevelResult> {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const row = await getLockedGoldMinerState(tx, userId)
        if (row.phase !== 'level' || !row.levelStartsAt) {
            throw createError({ statusCode: 400, statusMessage: 'No level in progress' })
        }
        const goal = gmGoal(row.level)
        if (await expireIfAbandoned(tx, row, now)) {
            return { cleared: false, earned: 0, cash: row.cash, goal, level: row.level, reason: 'timeout', run: null }
        }

        const level = gmGenerateLevel(gmLevelSeed(row.secret, row.level), row.level)
        const score = gmScoreLevel({
            level,
            grabs,
            perks: perksOf(row),
            dynamite: row.dynamite,
            bag: id => gmBagOutcome(row.secret, row.level, id, row.clover)
        })
        if (!score.ok) throw createError({ statusCode: 400, statusMessage: score.reason })

        // The report can't describe a pull that hasn't happened yet.
        const elapsed = now - row.levelStartsAt.getTime()
        const lastAt = grabs.length ? grabs[grabs.length - 1]!.at : 0
        if (lastAt > elapsed + CLOCK_SLACK_MS) {
            throw createError({ statusCode: 400, statusMessage: 'Level report is ahead of the clock' })
        }

        // Each level's goal has to be dug on that level; carried cash never pays it.
        const cash = row.cash + score.earned
        if (score.earned < goal) {
            if (!await loseRun(tx, row)) throw createError({ statusCode: 400, statusMessage: 'No level in progress' })
            await tx.update(goldMinerState).set({
                bestLevel: sql`greatest(${goldMinerState.bestLevel}, ${row.level - 1})`
            }).where(eq(goldMinerState.id, row.id))
            return { cleared: false, earned: score.earned, cash, goal, level: row.level, reason: 'goal', run: null }
        }

        const [updated] = await tx.update(goldMinerState).set({
            phase: 'shop',
            cash,
            dynamite: score.dynamite,
            // One-level boosts are spent.
            strength: false,
            clover: false,
            book: false,
            polish: false,
            levelStartsAt: null,
            offers: gmShopOffers(row.secret, row.level),
            bought: [],
            bestLevel: sql`greatest(${goldMinerState.bestLevel}, ${row.level})`
        }).where(and(eq(goldMinerState.id, row.id), eq(goldMinerState.phase, 'level'))).returning()
        if (!updated) throw createError({ statusCode: 400, statusMessage: 'No level in progress' })
        return { cleared: true, earned: score.earned, cash, goal, level: row.level, run: goldMinerRunView(updated, now) }
    })
}

export async function goldMinerBuy(userId: string, item: GmShopItem) {
    return db.transaction(async (tx) => {
        const row = await getLockedGoldMinerState(tx, userId)
        if (row.phase !== 'shop') throw createError({ statusCode: 400, statusMessage: 'The shop is closed' })
        const offer = row.offers.find((o: GmOffer) => o.item === item)
        if (!offer) throw createError({ statusCode: 400, statusMessage: 'Not for sale this round' })
        if (row.bought.includes(item)) throw createError({ statusCode: 400, statusMessage: 'Already bought' })
        if (row.cash < offer.price) throw createError({ statusCode: 400, statusMessage: 'Not enough cash' })
        if (item === 'dynamite' && row.dynamite >= GM_MAX_DYNAMITE) {
            throw createError({ statusCode: 400, statusMessage: 'Your pack is full of dynamite' })
        }

        const effect = {
            dynamite: { dynamite: row.dynamite + 1 },
            strength: { strength: true },
            clover: { clover: true },
            book: { book: true },
            polish: { polish: true }
        }[item]
        const [updated] = await tx.update(goldMinerState).set({
            ...effect,
            cash: row.cash - offer.price,
            bought: [...row.bought, item]
        }).where(and(eq(goldMinerState.id, row.id), eq(goldMinerState.phase, 'shop'))).returning()
        if (!updated) throw createError({ statusCode: 400, statusMessage: 'The shop is closed' })
        return { run: goldMinerRunView(updated)! }
    })
}

export async function goldMinerNextLevel(userId: string) {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const row = await getLockedGoldMinerState(tx, userId)
        if (row.phase !== 'shop') throw createError({ statusCode: 400, statusMessage: 'The shop is closed' })
        const [updated] = await tx.update(goldMinerState).set({
            phase: 'level',
            level: row.level + 1,
            levelStartsAt: new Date(now + GM_INTRO_MS),
            offers: [],
            bought: []
        }).where(and(eq(goldMinerState.id, row.id), eq(goldMinerState.phase, 'shop'))).returning()
        if (!updated) throw createError({ statusCode: 400, statusMessage: 'The shop is closed' })
        return { run: goldMinerRunView(updated, now)! }
    })
}

export async function goldMinerCashOut(userId: string) {
    return db.transaction(async (tx) => {
        const row = await getLockedGoldMinerState(tx, userId)
        if (row.phase !== 'shop') throw createError({ statusCode: 400, statusMessage: 'You can only cash out at the shop' })
        const payout = gmPayout(parseFloat(row.stake), row.cash)
        // Clearing the phase is the claim: a parallel cash-out finds no run and pays nothing.
        const [claimed] = await tx.update(goldMinerState).set({
            ...clearedRun(),
            totalPaid: sql`${goldMinerState.totalPaid} + ${payout.toFixed(4)}`,
            bestPayout: sql`greatest(${goldMinerState.bestPayout}, ${payout.toFixed(4)})`
        }).where(and(eq(goldMinerState.id, row.id), eq(goldMinerState.phase, 'shop'))).returning({ id: goldMinerState.id })
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'You can only cash out at the shop' })
        if (payout > 0) await credit(userId, payout.toFixed(4), 'gold-miner', tx)
        return { payout, cash: row.cash, level: row.level }
    })
}
