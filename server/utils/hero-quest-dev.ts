/**
 * The Hero Quest playtest harness — **development only, never shipped.**
 *
 * ## Why this exists
 *
 * Hero Quest is an idle game measured in days — a first prestige takes about a week, and the Gold
 * ladder resets on a date key — and the
 * `UNTUNED ╧` constants are waiting on play data. This collapses that wait, so "playtest the
 * offline cap" takes a minute instead of a day.
 *
 * ## The one design rule here
 *
 * **Never reimplement game math.** Every function below moves *inputs* — the clock, a currency
 * balance, a run position, an owned row — and then lets the production code path do the work.
 * `devSkip` in particular does not compute what eight hours would have earned; it rewinds
 * `lastSettledAt` and calls the real `settleHq`. A harness that models the game separately is a
 * harness that lies to you about the game, which is worse than no harness at all.
 *
 * ## The gate
 *
 * `assertDevHarness` throws a **404**, not a 403, so in production these routes are
 * indistinguishable from routes that were never deployed.
 *
 * It reads `import.meta.dev` and **deliberately does not honour the `devMode` runtime config**
 * that `server/api/pathwarden/*` accepts alongside it. That flag is a deploy-time toggle, and
 * these routes mint Gold and Gems — which are shared balances across every polynux game, not
 * Hero Quest's own scrip. A dev harness for one game must not become a mint for the platform,
 * so the gate is the build mode alone and nothing that can be flipped in a running deployment.
 *
 * ## Scope, deliberately
 *
 * `devReset` clears Hero Quest's five tables and **does not touch `balance` or `gems`.** Those
 * belong to the platform; a game reset has no business zeroing a balance the player may have
 * earned in Cyber or the Bank. The asymmetry with `devGrant` is intentional — granting into a
 * shared balance is a dev convenience, silently deleting from one is data loss.
 */

import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqArenaLog, hqArenaSeasonResults, hqCollection, hqFights, hqLoadouts, hqShopUpgrades, hqState, hqTraitSaveSlots, hqTraitSlots } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { isBossStage, sealGrantSet, settleHq } from '#server/utils/hero-quest'
import { leaveLoadoutSession } from '#server/utils/hero-quest-loadout'
import { CLASS_NODES } from '#shared/utils/hero-quest/content/classes'
import { GACHA_CONTENT, gachaContent } from '#shared/utils/hero-quest/content/registry'
import { SHOP_TRACKS } from '#shared/utils/hero-quest/content/shop'
import {
    LEVELS_PER_STAR,
    MAX_STAR,
    HQ_SESSION_TIMEOUT_MS,
    ONLINE_THRESHOLD_MS,
    STAGES_PER_WORLD,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import { D, fromStore, toStore } from '#shared/utils/hero-quest/numbers'
import type { ClassId } from '#shared/utils/hero-quest/types'

// Harness safety rails, not game tuning — which is why they live here rather than in
// `constants.ts`. Nothing about game balance changes if these move, the same reasoning that
// keeps `settle.ts`'s float tolerance local.

/** A year. Generous enough for any prestige-depth test, small enough that a typo'd 1e9 stops. */
const MAX_SKIP_HOURS = 24 * 365

/**
 * ~100 hours of chunked online time. Each chunk is a real transaction with a row lock and a
 * `credit`, so this is the wall-clock bound as much as the game bound.
 */
const MAX_ONLINE_CHUNKS = 2000

/** Skipping at least this far is treated as crossing into a new day for the Gold ladder. */
const LADDER_RESET_HOURS = 24

export type SkipMode = 'offline' | 'online'

export function devHarnessEnabled(): boolean {
    return Boolean(import.meta.dev)
}

/** 404 rather than 403 — outside dev these routes should look like they do not exist. */
export function assertDevHarness(): void {
    if (!devHarnessEnabled()) throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

/**
 * How to cut a skip into settle windows.
 *
 * Pure, and separated from the DB work so the chunking arithmetic is testable without a
 * database — it is the only real logic in this module and the only part that can be subtly
 * wrong.
 *
 * **Offline is one window; online is many.** `settleHq` classifies a window by its own length
 * (`elapsedMs <= ONLINE_THRESHOLD_MS`), so there is no flag to pass and no way to ask for eight
 * online hours in one call. Eight hours of *presence* is what a present player would actually
 * have produced: 160 consecutive three-minute windows, each settled at the live rate. Handing
 * the same eight hours over as one window would instead measure the offline cap and the
 * efficiency tax, which is a different experiment and the reason both modes exist.
 */
export function skipPlan(hours: number, mode: SkipMode): { chunks: number; chunkMs: number } {
    if (!Number.isFinite(hours) || hours <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'hours must be a positive number' })
    }
    if (hours > MAX_SKIP_HOURS) {
        throw createError({ statusCode: 400, statusMessage: `hours must be at most ${MAX_SKIP_HOURS}` })
    }

    const totalMs = Math.round(hours * 3600 * 1000)
    if (mode === 'offline') return { chunks: 1, chunkMs: totalMs }

    const chunks = Math.ceil(totalMs / ONLINE_THRESHOLD_MS)
    if (chunks > MAX_ONLINE_CHUNKS) {
        const maxHours = (MAX_ONLINE_CHUNKS * ONLINE_THRESHOLD_MS) / 3600 / 1000
        throw createError({
            statusCode: 400,
            statusMessage: `online skip is capped at ${maxHours} hours — use offline mode for longer`
        })
    }
    return { chunks, chunkMs: ONLINE_THRESHOLD_MS }
}

export interface DevSkipResult {
    mode: SkipMode
    hoursRequested: number
    /** Windows actually settled — below `chunks` when a boss gate stopped the run early. */
    chunksRun: number
    kills: number
    goldEarned: number
    xpEarned: string
    levelsGained: number
    /** True when the run parked at a boss gate, which no amount of further skipping passes. */
    blockedAtBoss: boolean
    world: number
    stage: number
    heroLevel: number
}

/**
 * Move the clock and let the real settle path pay it out.
 *
 * Rewinds to `now - chunkMs` rather than subtracting from the stored `lastSettledAt`, so the
 * window is exactly the requested length regardless of how stale the row already was — a skip
 * asked for eight hours should settle eight hours, not eight plus however long the tab sat open.
 * The leading `settleHq` banks that genuine elapsed time first so it is not discarded.
 *
 * **Stops early at a boss gate.** `settle()` never resolves a boss, so once the run parks on one
 * every further window earns nothing; running the remaining 150 chunks would burn transactions
 * to report zeros. Stopping and saying so is the useful answer, and it is itself a finding worth
 * having during a playtest.
 */
export async function devSkip(userId: string, hours: number, mode: SkipMode): Promise<DevSkipResult> {
    const { chunks, chunkMs } = skipPlan(hours, mode)

    // An open raid session holds the run, so the skip leaves the raid first, or every online chunk
    // would pay nothing. Then bank whatever really elapsed before rewriting the clock underneath it.
    await db.transaction(tx => leaveLoadoutSession(tx, userId))
    const before = await settleHq(userId)

    /**
     * Every clock moves together, or the skip is a lie in the player's favour.
     *
     * The Gold ladder is the one clock that cannot be rewound by subtracting from it: it is keyed
     * on a real `YYYY-MM-DD` string compared against today, and skipping does not move the
     * calendar. Clearing it is the honest approximation of "a new day started", and is applied
     * only when the skip is actually a day or more. (The daily free-pull allowance is keyed the
     * same way and resets on its own when the real day turns.)
     */
    const totalMs = chunks * chunkMs
    if (totalMs >= LADDER_RESET_HOURS * 3600 * 1000) {
        await db.update(hqState)
            .set({ sealLadderDate: null, sealLadderPurchasedToday: {} })
            .where(eq(hqState.userId, userId))
    }

    let kills = 0
    let goldEarned = 0
    let xpEarned = D(0)
    let chunksRun = 0
    let blockedAtBoss = false
    let last = before

    for (let i = 0; i < chunks; i++) {
        await db.update(hqState)
            .set({ lastSettledAt: new Date(Date.now() - chunkMs) })
            .where(eq(hqState.userId, userId))

        const outcome = await settleHq(userId)
        chunksRun++
        last = outcome

        if (outcome.result) {
            kills += outcome.result.kills
            goldEarned += outcome.result.goldEarned
            xpEarned = xpEarned.add(outcome.result.xpEarned)
            blockedAtBoss = outcome.result.blockedAtBoss
        }
        if (blockedAtBoss) break
    }

    return {
        mode,
        hoursRequested: hours,
        chunksRun,
        kills,
        goldEarned,
        xpEarned: xpEarned.toString(),
        levelsGained: last.state.heroLevel - before.state.heroLevel,
        blockedAtBoss,
        world: last.state.world,
        stage: last.state.stage,
        heroLevel: last.state.heroLevel
    }
}

export interface DevGrant {
    /** Shared platform balance. */
    gold?: number
    /** Shared platform balance. */
    gems?: number
    voidShards?: number
    /** Paid into all four Seal columns at once, like every milestone grant. */
    seals?: number
    /** Paid into all four Essence columns at once. */
    essence?: number
    /** Hero Quest's own Trait currency (`traits.md`). */
    traitGems?: number
    /** Arena Medals, for trying the Arena Shop. */
    medals?: number
}

function positiveInt(value: unknown, field: string): number {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) {
        throw createError({ statusCode: 400, statusMessage: `${field} must be a non-negative number` })
    }
    return Math.floor(n)
}

/**
 * Top up any currency in the game.
 *
 * Increments are written as SQL expressions rather than read-then-write — not because a dev
 * harness is a concurrency target, but because the platform's rule is that the mutation is the
 * guard, and a util that models the wrong shape is the one that gets copied into a real route
 * later. Void Shards is the exception the rule allows: it is a Decimal in a `text` column, so
 * there is no SQL increment for it and it takes the lock-then-read path instead.
 */
export async function devGrant(userId: string, grant: DevGrant) {
    if (grant.gold) await credit(userId, positiveInt(grant.gold, 'gold').toFixed(4), 'hero-quest-dev')
    if (grant.gems) await creditGems(userId, positiveInt(grant.gems, 'gems'))

    const seals = grant.seals ? positiveInt(grant.seals, 'seals') : 0
    const essence = grant.essence ? positiveInt(grant.essence, 'essence') : 0
    const traitGems = grant.traitGems ? positiveInt(grant.traitGems, 'traitGems') : 0
    const medals = grant.medals ? positiveInt(grant.medals, 'medals') : 0

    if (seals || essence || traitGems || medals) {
        await db.update(hqState)
            .set({
                ...(seals ? sealGrantSet(seals) : {}),
                ...(traitGems ? { traitGems: sql`${hqState.traitGems} + ${traitGems}` } : {}),
                ...(medals ? { arenaMedals: sql`${hqState.arenaMedals} + ${medals}` } : {}),
                ...(essence
                    ? {
                        gearEssence: sql`${hqState.gearEssence} + ${essence}`,
                        championEssence: sql`${hqState.championEssence} + ${essence}`,
                        skillEssence: sql`${hqState.skillEssence} + ${essence}`,
                        artifactEssence: sql`${hqState.artifactEssence} + ${essence}`
                    }
                    : {})
            })
            .where(eq(hqState.userId, userId))
    }

    if (grant.voidShards) {
        const add = positiveInt(grant.voidShards, 'voidShards')
        await db.transaction(async (tx) => {
            const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
            if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
            await tx.update(hqState)
                .set({ voidShards: toStore(fromStore(state.voidShards).add(add)) })
                .where(eq(hqState.userId, userId))
        })
    }

    const [state] = await db.select().from(hqState).where(eq(hqState.userId, userId))
    return { voidShards: state?.voidShards ?? '0', guildSeals: state?.guildSeals ?? 0 }
}

export interface DevUnlock {
    /** Defaults to all four gachas. */
    systems?: GachaSystem[]
    star?: number
    level?: number
    /** Max every prestige-shop track, so all slot counts are at their ceiling. */
    maxShop?: boolean
}

/**
 * Own everything, at a chosen investment level.
 *
 * The point is not to skip the gacha — it is to make the *downstream* systems testable. Loadouts,
 * formation, the Artifact effect pool and the Skill potency curve are all invisible until there
 * is a collection to arrange, and pulling one honestly takes weeks. Star and level are settable
 * because `(star × 10 + level)` is the universal investment scalar every one of those systems
 * reads, so a 5★/Lv10 sweep is the only way to see the top of the curve without months of dupes.
 */
export async function devUnlock(userId: string, request: DevUnlock) {
    const systems = request.systems?.length
        ? request.systems
        : (Object.keys(GACHA_CONTENT) as GachaSystem[])

    for (const system of systems) {
        if (!GACHA_CONTENT[system]) {
            throw createError({ statusCode: 400, statusMessage: `Unknown gacha system: ${system}` })
        }
    }

    const star = Math.max(0, Math.min(MAX_STAR, Math.floor(request.star ?? 0)))
    const level = Math.max(1, Math.min(LEVELS_PER_STAR, Math.floor(request.level ?? 1)))

    let granted = 0
    for (const system of systems) {
        const rows = gachaContent(system).entries.map(entry => ({
            userId,
            system,
            contentId: entry.id,
            star,
            level,
            dupeProgress: 0
        }))
        if (!rows.length) continue

        await db.insert(hqCollection)
            .values(rows)
            .onConflictDoUpdate({
                target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                set: { star, level, dupeProgress: 0 }
            })
        granted += rows.length
    }

    if (request.maxShop) {
        // the uncapped stat tracks have no ceiling to max out to, so they are left as they are
        for (const track of SHOP_TRACKS.filter(entry => Number.isFinite(entry.maxLevel))) {
            await db.insert(hqShopUpgrades)
                .values({ userId, upgradeId: track.id, level: track.maxLevel })
                .onConflictDoUpdate({
                    target: [hqShopUpgrades.userId, hqShopUpgrades.upgradeId],
                    set: { level: track.maxLevel }
                })
        }
    }

    return { systems, granted, star, level, maxShop: Boolean(request.maxShop) }
}

export interface DevSet {
    prestige?: number
    world?: number
    stage?: number
    killCount?: number
    heroLevel?: number
    heroNodeId?: string
    /** Makes prestige available without beating the World 10 super boss. */
    runCleared?: boolean
    /** Marks the next gate's boss as having beaten the party, so it waits on the challenge button. */
    bossLost?: boolean
}

/**
 * Teleport the run.
 *
 * Settles first so pending progress is banked rather than silently overwritten by the jump, then
 * writes under the row lock like every other position mutation.
 *
 * Two details that are easy to get wrong and both matter to what a playtest observes:
 *
 * - **`atBossGate` is derived, never taken from the caller.** It is `isBossStage(stage)` exactly
 *   as `settleHq` and `boss/engage` write it, so the stored flag never disagrees with the stage.
 * - **Setting `heroLevel` zeroes `heroXp`.** `applyXp` returns level plus the *remainder within
 *   that level*, so the pair is only coherent if the remainder is reset when the level is forced.
 *   Leaving a level-1000 remainder on a level-5 hero would level them straight back up on the
 *   next settle and make the jump look like it had not worked.
 */
export async function devSet(userId: string, patch: DevSet) {
    await settleHq(userId)

    if (patch.heroNodeId && !CLASS_NODES.some(node => node.id === patch.heroNodeId)) {
        throw createError({ statusCode: 400, statusMessage: `Unknown class node: ${patch.heroNodeId}` })
    }

    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
        if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

        const world = patch.world === undefined
            ? state.world
            : Math.max(1, Math.min(WORLD_COUNT, Math.floor(patch.world)))
        const stage = patch.stage === undefined
            ? state.stage
            : Math.max(1, Math.min(STAGES_PER_WORLD, Math.floor(patch.stage)))

        const seen = new Set(state.seenNodeIds as string[])
        if (patch.heroNodeId) seen.add(patch.heroNodeId)

        const [updated] = await tx.update(hqState)
            .set({
                world,
                stage,
                atBossGate: isBossStage(stage),
                // a moved run starts standing, not mid-recovery from wherever it was, nor held by a boss it never met
                recoverySeconds: 0,
                bossLost: Boolean(patch.bossLost),
                ...(patch.prestige === undefined ? {} : { prestige: Math.max(0, Math.floor(patch.prestige)) }),
                // The carried part-kill belongs to the counter being overwritten, so it goes
                // with it — a harness that moves the run to 12/30 means 12, not 12 and a bit.
                ...(patch.killCount === undefined
                    ? {}
                    : { killCount: Math.max(0, Math.floor(patch.killCount)), killFraction: 0 }),
                ...(patch.heroLevel === undefined
                    ? {}
                    : { heroLevel: Math.max(1, Math.floor(patch.heroLevel)), heroXp: '0' }),
                ...(patch.heroNodeId
                    ? { heroNodeId: patch.heroNodeId as ClassId, seenNodeIds: [...seen] }
                    : {}),
                ...(patch.runCleared === undefined ? {} : { runCleared: Boolean(patch.runCleared) })
            })
            .where(eq(hqState.userId, userId))
            .returning()

        return {
            prestige: updated?.prestige ?? state.prestige,
            world: updated?.world ?? world,
            stage: updated?.stage ?? stage,
            killCount: updated?.killCount ?? state.killCount,
            atBossGate: updated?.atBossGate ?? isBossStage(stage),
            heroLevel: updated?.heroLevel ?? state.heroLevel,
            heroNodeId: updated?.heroNodeId ?? state.heroNodeId,
            runCleared: updated?.runCleared ?? state.runCleared,
            bossLost: updated?.bossLost ?? state.bossLost
        }
    })
}

/**
 * End the player's session, as an absence just past `HQ_SESSION_TIMEOUT_MS` would: bank what
 * really elapsed, then move the settle clock back past the timeout. The next read settles that gap
 * offline through the real `settleHq` and reports it, so the splash shows exactly what a player
 * coming back after an hour sees. Moves the clock only; computes nothing.
 */
export async function devAway(userId: string) {
    await settleHq(userId)
    const awayMs = HQ_SESSION_TIMEOUT_MS + 60_000
    await db.update(hqState)
        .set({ lastSettledAt: new Date(Date.now() - awayMs) })
        .where(eq(hqState.userId, userId))
    return { awaySeconds: awayMs / 1000 }
}

/**
 * Wipe Hero Quest back to unfounded, so the next `init` starts a genuinely fresh account.
 *
 * The first-hour experience is the single hardest thing to playtest, because you only get one
 * per account and every other test contaminates it. This is what makes it repeatable.
 *
 * `hqState` is deleted **last**: the other four tables reference `userId` and nothing else, but
 * ordering the delete so state outlives its dependents keeps the sequence honest if a foreign key
 * is ever added between them. Gold and Gems are untouched — see the module header.
 */
export async function devReset(userId: string) {
    await db.delete(hqArenaLog).where(eq(hqArenaLog.userId, userId))
    await db.delete(hqArenaSeasonResults).where(eq(hqArenaSeasonResults.userId, userId))
    await db.delete(hqFights).where(eq(hqFights.userId, userId))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, userId))
    await db.delete(hqCollection).where(eq(hqCollection.userId, userId))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, userId))
    await db.delete(hqTraitSlots).where(eq(hqTraitSlots.userId, userId))
    await db.delete(hqTraitSaveSlots).where(eq(hqTraitSaveSlots.userId, userId))
    await db.delete(hqState).where(eq(hqState.userId, userId))
    return { reset: true as const }
}
