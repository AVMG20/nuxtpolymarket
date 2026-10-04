import { and, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { townBuildings, townStreak, user } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { activateTownBoosts, addInventory, finishLongestTownJobs, getPlotMap, getTownState, settleTownState, toSim, townInstantJobs } from '#server/utils/town'
import type { TownResourceId } from '#shared/utils/gamelogic/town'
import {
    TOWN_STREAK_DAYS,
    TOWN_STREAK_TRACK,
    claimTownStreakReward,
    getTownStreakStep,
    townStreakOpensChest,
    isValidTownStreakStep,
    lockTownStreakStep,
    sumTownStreakRewards,
    townStreakBit,
    townStreakCanReset,
    townStreakClaimable,
    townStreakClaimedSteps,
    townStreakDayKey,
    townStreakDue,
    townStreakIsClaimed,
    townStreakNextDayAt,
    townStreakPreview,
    townStreakScale,
    townStreakStatus,
    townStreakYesterday,
    type TownStreakLock,
    type TownStreakReward,
    type TownStreakStepDef,
    type TownStreakScale
} from '#shared/utils/gamelogic/town-streak'

const CATEGORY = 'polytown:streak'

type StreakRow = typeof townStreak.$inferSelect

async function readStreak(userId: string, ex: DbExecutor = db) {
    const [row] = await ex.select().from(townStreak).where(eq(townStreak.userId, userId))
    return row
}

/**
 * Unlock today's step if it is due. Both writes are their own guard: the
 * insert only lands for the first visit ever, and the update only matches a
 * row whose last unlock was yesterday, so two tabs opening at once advance it
 * once and only the request that wrote it reports `advanced`.
 */
async function advanceStreak(userId: string, now: number, scale: TownStreakScale): Promise<{ row: StreakRow, advanced: boolean }> {
    const today = townStreakDayKey(now)
    const existing = await readStreak(userId)
    if (!existing) {
        const [inserted] = await db.insert(townStreak)
            .values({ userId, step: 1, lastDay: today, claimed: 0, cycle: 0, locked: lockedFor(1, scale) })
            .onConflictDoNothing()
            .returning()
        if (inserted) return { row: inserted, advanced: true }
        return { row: (await readStreak(userId))!, advanced: false }
    }
    if (!townStreakDue(existing, today)) return { row: existing, advanced: false }

    // Pinned to the step read above, so the step whose worth is locked is the one unlocked.
    const next = existing.step + 1
    const [updated] = await db.update(townStreak)
        .set({
            step: next,
            lastDay: today,
            locked: sql`${townStreak.locked} || ${JSON.stringify(lockedFor(next, scale))}::jsonb`,
            updatedAt: new Date(now)
        })
        .where(and(
            eq(townStreak.userId, userId),
            eq(townStreak.step, existing.step),
            lt(townStreak.step, TOWN_STREAK_DAYS),
            or(eq(townStreak.lastDay, townStreakYesterday(today)), isNull(townStreak.lastDay))
        ))
        .returning()
    if (updated) return { row: updated, advanced: true }
    return { row: (await readStreak(userId))!, advanced: false }
}

/** The lock entry for a step that just unlocked: its worth, fixed from today's town. */
function lockedFor(step: number, scale: TownStreakScale): Record<string, TownStreakLock> {
    const def = getTownStreakStep(step)
    return def ? { [step]: lockTownStreakStep(def, scale) } : {}
}

/** Read-only scale for the preview and for locking a step: no settle, no locks. */
async function previewScale(userId: string, happiness: number, now: number) {
    const [rows, { byId }] = await Promise.all([
        db.select().from(townBuildings).where(eq(townBuildings.userId, userId)),
        getPlotMap(userId)
    ])
    return townStreakScale(rows.map(row => toSim(row, byId.get(row.plotId))), happiness, now)
}

export async function getTownStreak(userId: string) {
    const now = Date.now()
    const state = await getTownState(userId)
    if (!state) return { initialized: false as const }

    const scale = await previewScale(userId, state.happiness, now)
    const { row, advanced } = await advanceStreak(userId, now, scale)
    const today = townStreakDayKey(now)

    return {
        initialized: true as const,
        day: today,
        step: row.step,
        status: townStreakStatus(row, today),
        cycle: row.cycle,
        claimedSteps: townStreakClaimedSteps(row.claimed),
        claimableSteps: townStreakClaimable(row.step, row.claimed),
        canReset: townStreakCanReset(row, today),
        advancedToday: advanced,
        /** Lucky charges waiting: the next chest opened is one tier better. */
        lucky: row.lucky,
        serverNow: now,
        nextDayAt: townStreakNextDayAt(now),
        // Unlocked steps show what they were locked at; the rest follow the town as it is now.
        track: TOWN_STREAK_TRACK.map(def => townStreakPreview(def, scale, def.step <= row.step ? row.locked[def.step] : undefined))
    }
}

async function payReward(tx: DbExecutor, userId: string, reward: Pick<TownStreakReward, 'coins' | 'gems' | 'resources'>) {
    if (reward.coins > 0) await credit(userId, reward.coins.toFixed(4), CATEGORY, tx)
    if (reward.gems > 0) await creditGems(userId, reward.gems, tx)
    for (const [id, qty] of Object.entries(reward.resources) as [TownResourceId, number][]) {
        if (qty > 0) await addInventory(tx, userId, id, qty)
    }
}

/**
 * Open (or pay) one step inside the claim transaction, under the town lock
 * the settle took. A chest spends a lucky charge with a conditional
 * decrement, so two chests opened at once can never both use the same one.
 * Extras then take effect at once: an instant finish completes the longest
 * job, boosts and the borrowed crew start or lengthen, a market day adds its
 * budget, and a lucky extra adds a charge for the next chest.
 */
async function openStep(tx: DbExecutor, userId: string, def: TownStreakStepDef, lock: TownStreakLock | undefined, scale: TownStreakScale, now: number): Promise<TownStreakReward> {
    let lucky = false
    let instantJobs = 0
    if (townStreakOpensChest(def, lock)) {
        const [spent] = await tx.update(townStreak)
            .set({ lucky: sql`${townStreak.lucky} - 1` })
            .where(and(eq(townStreak.userId, userId), gt(townStreak.lucky, 0)))
            .returning({ lucky: townStreak.lucky })
        lucky = !!spent
        instantJobs = (await townInstantJobs(tx, userId, now)).length
    }
    const reward = claimTownStreakReward(def, lock, scale, undefined, { lucky, instantJobs })
    await payReward(tx, userId, reward)

    const extras = reward.extras ?? []
    const count = (kind: string) => extras.filter(e => e.kind === kind).length
    const finished = await finishLongestTownJobs(tx, userId, count('instant'), now)
    let next = 0
    for (const extra of extras) {
        if (extra.kind === 'instant') {
            const done = finished[next++]
            if (done) Object.assign(extra, done)
        }
        // One day of the town's floor income per market day, at the scale the
        // chest rolled from: the one locked the day it unlocked, so propping up
        // income before opening a backlog of chests buys no bigger budget.
        if (extra.kind === 'market') extra.bonusCoins = Math.round((lock?.scale ?? scale).incomePerDay)
    }
    await activateTownBoosts(tx, userId, {
        ...reward.boosts,
        builder: extras.filter(e => e.kind === 'builder').reduce((sum, e) => sum + (e.ms ?? 0), 0),
        market: extras.filter(e => e.kind === 'market').reduce((sum, e) => sum + (e.ms ?? 0), 0),
        marketBudget: extras.filter(e => e.kind === 'market').reduce((sum, e) => sum + (e.bonusCoins ?? 0), 0)
    }, now)
    const charges = count('lucky')
    if (charges > 0) {
        await tx.update(townStreak).set({ lucky: sql`${townStreak.lucky} + ${charges}::int` }).where(eq(townStreak.userId, userId))
    }
    return reward
}

async function wallet(tx: DbExecutor, userId: string) {
    const [row] = await tx.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, userId))
    return { balance: row?.balance ?? '0', gems: row?.gems ?? 0 }
}

/**
 * Claim-then-reward. The settle takes the town lock first (town_state →
 * town_inventory → user is the lock order everywhere), then the conditional
 * OR on the claimed mask is the mutex: a second claim of the same step
 * matches no row and pays nothing.
 */
export async function claimTownStreakStep(userId: string, step: unknown) {
    if (!isValidTownStreakStep(step)) throw createError({ statusCode: 400, statusMessage: 'Unknown day' })
    const def = getTownStreakStep(step)!
    const bit = townStreakBit(step)

    return db.transaction(async (tx) => {
        const now = Date.now()
        const settled = await settleTownState(tx, userId, now)
        const [claimed] = await tx.update(townStreak)
            .set({ claimed: sql`${townStreak.claimed} | ${bit}::int`, updatedAt: new Date(now) })
            .where(and(
                eq(townStreak.userId, userId),
                sql`(${townStreak.claimed} & ${bit}::int) = 0`,
                gte(townStreak.step, step)
            ))
            .returning({ step: townStreak.step, locked: townStreak.locked })
        if (!claimed) {
            const row = await readStreak(userId, tx)
            const already = row && townStreakIsClaimed(row.claimed, step)
            throw createError({ statusCode: 400, statusMessage: already ? 'Already claimed' : 'That day is still locked' })
        }

        const scale = townStreakScale(settled.sim, settled.state.happiness, now)
        const reward = await openStep(tx, userId, def, claimed.locked[step], scale, now)
        return { step, reward, ...(await wallet(tx, userId)) }
    })
}

/**
 * Lock-then-read. Only a broken or finished track resets: the row is locked,
 * re-checked inside the lock, every unclaimed step is paid, and the run starts
 * again with today as day 1 (tomorrow, if today unlocked day 30). A second
 * reset waits on the lock, then finds an active track and throws, so nothing
 * is paid twice.
 */
export async function resetTownStreak(userId: string) {
    return db.transaction(async (tx) => {
        const now = Date.now()
        const today = townStreakDayKey(now)
        const settled = await settleTownState(tx, userId, now)
        const [row] = await tx.select().from(townStreak).where(eq(townStreak.userId, userId)).for('update')
        if (!row) throw createError({ statusCode: 400, statusMessage: 'No streak to reset' })
        if (!townStreakCanReset(row, today)) throw createError({ statusCode: 400, statusMessage: 'The streak is still running' })

        const scale = townStreakScale(settled.sim, settled.state.happiness, now)
        // One step at a time, so a lucky charge or instant finish from one chest is there for the next.
        const paid: TownStreakReward[] = []
        for (const s of townStreakClaimable(row.step, row.claimed)) {
            paid.push(await openStep(tx, userId, getTownStreakStep(s)!, row.locked[s], scale, now))
        }
        const total = sumTownStreakRewards(paid)

        // A track that finished today already unlocked today's step, so day 1 waits for tomorrow.
        const step = row.lastDay === today ? 0 : 1
        await tx.update(townStreak)
            .set({ step, lastDay: today, claimed: 0, cycle: row.cycle + 1, locked: step ? lockedFor(step, scale) : {}, updatedAt: new Date(now) })
            .where(eq(townStreak.userId, userId))
        return { paid, total, ...(await wallet(tx, userId)) }
    })
}
