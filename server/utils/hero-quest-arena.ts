/**
 * The Arena on the server (`arena.md`): the defence, the opponent list, attacks, attempts, the
 * Arena Shop, seasons, the battle log and the Rating leaderboard. The rules are `arena.ts`'s and
 * the fight is `duel.ts`'s; this module only applies them.
 *
 * ## Locks
 *
 * Everything an attack moves sits on `hq_state`: the attacker's attempts, Medals, Rating and list,
 * and the defender's Rating. An attack locks **both** rows, always in user-ID order, so two attacks
 * on the same defender queue on its row and read its Rating fresh, and A attacking B while B
 * attacks A can't deadlock. Every spend (an extra attempt, a refresh) locks its row before it reads
 * a counter and pays with the same `tx`, `hq_state` before `user`, the order `settleHq` takes them in.
 * A shop purchase of Keys writes the raid row before `hq_state`, the order a raid entry takes them in.
 *
 * ## Seasons, with no cron
 *
 * A season ends for everyone at once (`arenaSeasonAt`). Nothing happens at that instant: a row
 * still carrying an old season is rolled to the current one, Rating back to the start, the first
 * time something touches it (`rollStanding`). Before anything may roll a row, the season it leaves
 * must have its final standings written down, so every Arena request first closes the seasons that
 * have ended (`ensureSeasonsClosed`), each in its own short transaction, before taking any row lock.
 * The `hq_arena_seasons` insert is the claim: one request writes a season's standings, every other
 * waits on it and then finds it done. A request reads the clock once, before closing anything, and
 * judges seasons by that same instant, so it never rolls a row out of a season it did not close.
 */

import { and, desc, eq, gt, inArray, isNotNull, ne, notInArray, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqArenaLog, hqArenaSeasonResults, hqArenaSeasons, hqFights, hqLoadouts, hqRaidState, hqState, user } from '#server/database/schema'
import { credit, creditGems, debitGems } from '#server/utils/balance'
import { defenseGpnOf, getCollections, getShopLevels, heroSnapshotOf, loadoutSlots, positionOf, sealGrant, tenureDaysOf, withDefenseLoadout, type HqCollections, type HqStateRow } from '#server/utils/hero-quest'
import { validateLiveLoadout, type LoadoutInput } from '#server/utils/hero-quest-loadout'
import { lockRaid } from '#server/utils/hero-quest-raids'
import {
    ARENA_DUMMY_ID,
    arenaSeasonAt,
    arenaSeasonEndsAt,
    arenaShopItem,
    attemptsLeft,
    attemptsOn,
    drawCandidates,
    eloUpdate,
    extraAttemptPrice,
    matchBand,
    medalsFor,
    rankStandings,
    rollStanding,
    seasonRewardFor,
    type ArenaAttempts,
    type ArenaDefenseLoadout,
    type ArenaStanding
} from '#shared/utils/hero-quest/arena'
import { runArenaDummy, runDuel, type DuelResult } from '#shared/utils/hero-quest/duel'
import { globalPower } from '#shared/utils/hero-quest/power'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { goldPerHourAt } from '#shared/utils/hero-quest/settle'
import { ladderDateKey } from '#shared/utils/hero-quest/gacha'
import { getRaid } from '#shared/utils/hero-quest/content/raids'
import {
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_LEADERBOARD_NEIGHBORS,
    ARENA_LEADERBOARD_TOP,
    ARENA_LOG_SIZE,
    ARENA_REFRESH_GEMS,
    ARENA_SHOP_MAX_QUANTITY
} from '#shared/utils/hero-quest/constants'
import { randomInt } from '#shared/utils/random'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'
import type { Decimal } from '#shared/utils/hero-quest/numbers'

// ── Standing, attempts, defence ────────────────────────────────────────────────────

export function standingOf(state: HqStateRow): ArenaStanding {
    return { season: state.arenaSeasonId, rating: state.arenaRating, matches: state.arenaSeasonMatches }
}

function attemptsOf(state: HqStateRow): ArenaAttempts {
    return { date: state.arenaAttemptDate, used: state.arenaAttemptsUsedToday, purchased: state.arenaExtraAttemptsPurchasedToday }
}

function standingWrites(standing: ArenaStanding) {
    return { arenaSeasonId: standing.season, arenaRating: standing.rating, arenaSeasonMatches: standing.matches }
}

/**
 * The defender as they are fought: their class, level and whole collection as they stand now, with
 * the stored defence fielded in place of whatever they play with live (§1). Wealth-neutral, as the
 * defender's banked Gold has nothing to do with a fight they are not at.
 */
export function defenseSnapshotOf(state: HqStateRow, shopLevels: Record<string, number>, collections: HqCollections): HeroSnapshot | null {
    const defended = withDefenseLoadout(state)
    return defended ? heroSnapshotOf(defended, shopLevels, collections) : null
}

/** Lock the given players' rows for the rest of the transaction, in user-ID order. */
async function lockStates(tx: DbExecutor, userIds: readonly string[]): Promise<Map<string, HqStateRow>> {
    const rows = new Map<string, HqStateRow>()
    for (const id of [...new Set(userIds)].sort()) {
        const [row] = await tx.select().from(hqState).where(eq(hqState.userId, id)).for('update')
        if (row) rows.set(id, row)
    }
    return rows
}

async function lockOwn(tx: DbExecutor, userId: string): Promise<HqStateRow> {
    const row = (await lockStates(tx, [userId])).get(userId)
    if (!row) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    return row
}

// ── Seasons ────────────────────────────────────────────────────────────────────────

/**
 * Write a finished season's final standings, once. Every player who fought, or was fought, in it
 * is ranked by the Rating their row still holds for it (rows are only rolled after this has run).
 */
export async function closeSeason(season: number): Promise<void> {
    await db.transaction(async (tx) => {
        const [claimed] = await tx.insert(hqArenaSeasons).values({ seasonId: season }).onConflictDoNothing().returning()
        if (!claimed) return
        // locked, in the user-ID order an attack takes them in: a match still in flight on one of
        // these rows lands in the standings first, and one queued behind finds the season closed
        const rows = await tx.select({ userId: hqState.userId, rating: hqState.arenaRating })
            .from(hqState)
            .where(and(eq(hqState.arenaSeasonId, season), gt(hqState.arenaSeasonMatches, 0)))
            .orderBy(sql`${hqState.userId} collate "C"`)
            .for('update')
        const ranked = rankStandings(rows)
        if (ranked.length === 0) return
        await tx.insert(hqArenaSeasonResults)
            .values(ranked.map(r => ({ seasonId: season, userId: r.userId, rating: r.rating, rank: r.rank, medals: seasonRewardFor(r.rank) })))
            .onConflictDoNothing()
    })
}

/**
 * Close every season that has ended and still has a player standing in it. Run before any Arena
 * row lock is taken, outside the caller's transaction, so waiting on another request's close never
 * holds a lock that request might want.
 */
export async function ensureSeasonsClosed(now: number): Promise<void> {
    const current = arenaSeasonAt(now)
    const stale = await db.selectDistinct({ season: hqState.arenaSeasonId })
        .from(hqState)
        .where(and(
            gt(hqState.arenaSeasonId, 0),
            sql`${hqState.arenaSeasonId} < ${current}`,
            sql`not exists (select 1 from ${hqArenaSeasons} where ${hqArenaSeasons.seasonId} = ${hqState.arenaSeasonId})`
        ))
    for (const { season } of stale.sort((a, b) => a.season - b.season)) await closeSeason(season)
}

/** Seasons that paid this player and are still waiting to be claimed. */
export async function unclaimedSeasons(userId: string, executor: DbExecutor = db) {
    return executor.select({ season: hqArenaSeasonResults.seasonId, rank: hqArenaSeasonResults.rank, rating: hqArenaSeasonResults.rating, medals: hqArenaSeasonResults.medals })
        .from(hqArenaSeasonResults)
        .where(and(eq(hqArenaSeasonResults.userId, userId), eq(hqArenaSeasonResults.claimed, false)))
        .orderBy(hqArenaSeasonResults.seasonId)
}

/**
 * Take every season reward waiting (§7), claim-then-reward: the flags flip first and only the rows
 * that came back pay, so a burst of claims pays each season once.
 */
export async function claimSeasonRewards(tx: DbExecutor, userId: string) {
    const claimed = await tx.update(hqArenaSeasonResults)
        .set({ claimed: true })
        .where(and(eq(hqArenaSeasonResults.userId, userId), eq(hqArenaSeasonResults.claimed, false)))
        .returning()
    if (claimed.length === 0) throw createError({ statusCode: 400, statusMessage: 'No season reward to claim' })
    const medals = claimed.reduce((sum, row) => sum + row.medals, 0)
    const [paid] = await tx.update(hqState)
        .set({ arenaMedals: sql`${hqState.arenaMedals} + ${medals}` })
        .where(eq(hqState.userId, userId))
        .returning({ arenaMedals: hqState.arenaMedals })
    if (!paid) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    return {
        seasons: claimed.map(row => ({ season: row.seasonId, rank: row.rank, medals: row.medals })).sort((a, b) => a.season - b.season),
        medals,
        arenaMedals: paid.arenaMedals
    }
}

// ── The opponent list ──────────────────────────────────────────────────────────────

/** Everyone with a defence whose Defense GPN is in band of `gpn` (§2), the attacker left out. */
async function candidatePool(executor: DbExecutor, userId: string, gpn: Decimal): Promise<string[]> {
    const band = matchBand(gpn)
    if (!band) return []
    const rows = await executor.select({ userId: hqState.userId })
        .from(hqState)
        .where(and(
            ne(hqState.userId, userId),
            isNotNull(hqState.defenseLoadout),
            sql`${hqState.defenseGpnLog} between ${band.lo} and ${band.hi}`
        ))
    return rows.map(row => row.userId)
}

/**
 * Whether every real opponent on `candidates` still fields a defence in band of `hero` (§2). The
 * band is the one `candidatePool` draws with, on the same stored Defense GPN.
 */
async function listInBand(executor: DbExecutor, candidates: readonly (string | null)[], hero: HeroSnapshot): Promise<boolean> {
    const ids = candidates.filter((id): id is string => id !== null)
    if (ids.length === 0) return true
    const band = matchBand(globalPower(hero).gpn)
    if (!band) return false
    const rows = await executor.select({ log: hqState.defenseGpnLog })
        .from(hqState)
        .where(and(inArray(hqState.userId, ids), isNotNull(hqState.defenseLoadout)))
    return rows.length === ids.length && rows.every(row => row.log !== null && row.log >= band.lo && row.log <= band.hi)
}

/** A fresh list for the attacker whose live party is `hero`: in-band players at random, dummies for the rest (§2a). */
async function drawFor(executor: DbExecutor, userId: string, hero: HeroSnapshot): Promise<(string | null)[]> {
    const pool = await candidatePool(executor, userId, globalPower(hero).gpn)
    return drawCandidates(pool, n => randomInt(0, n - 1))
}

function liveHeroOf(executor: DbExecutor, state: HqStateRow, bankedGold?: number): Promise<HeroSnapshot> {
    return Promise.all([getShopLevels(state.userId, executor), getCollections(state.userId, executor)])
        .then(([shop, collections]) => heroSnapshotOf(state, shop, collections, bankedGold))
}

export interface ArenaCandidate {
    slot: number
    /** `ARENA_DUMMY_ID` for a Training Dummy, else the defender's user ID: what an attack names. */
    id: string
    dummy: boolean
    name: string
    rating: number | null
    defenseGpn: string | null
    /** The defence they field, for the card: the Hero's class and row, then each Champion and its row. */
    classId: string | null
    heroRow: 'front' | 'back' | null
    champions: { id: string, row: 'front' | 'back' }[]
}

/** The stored list as the scene shows it: names, Ratings in the current season and the defence each fields. */
export async function serializeCandidates(executor: DbExecutor, candidates: readonly (string | null)[], season: number): Promise<ArenaCandidate[]> {
    const ids = candidates.filter((id): id is string => id !== null)
    const rows = ids.length
        ? await executor.select({
            userId: hqState.userId,
            name: user.name,
            heroNodeId: hqState.heroNodeId,
            defenseLoadout: hqState.defenseLoadout,
            defenseGpn: hqState.defenseGpn,
            arenaRating: hqState.arenaRating,
            arenaSeasonId: hqState.arenaSeasonId,
            arenaSeasonMatches: hqState.arenaSeasonMatches
        }).from(hqState).innerJoin(user, eq(user.id, hqState.userId)).where(inArray(hqState.userId, ids))
        : []
    return candidates.map((id, slot) => {
        const row = id === null ? undefined : rows.find(r => r.userId === id)
        if (id === null || !row?.defenseLoadout) {
            return { slot, id: id ?? ARENA_DUMMY_ID, dummy: id === null, name: id === null ? 'Training Dummy' : 'Gone', rating: null, defenseGpn: null, classId: null, heroRow: null, champions: [] }
        }
        const defense = row.defenseLoadout
        return {
            slot,
            id,
            dummy: false,
            name: row.name,
            rating: rollStanding({ season: row.arenaSeasonId, rating: row.arenaRating, matches: row.arenaSeasonMatches }, season).rating,
            defenseGpn: row.defenseGpn,
            classId: row.heroNodeId,
            heroRow: defense.formation.hero ?? null,
            champions: defense.partyChampionIds.map(c => ({ id: c, row: defense.formation[c] ?? 'front' }))
        }
    })
}

/**
 * The list (`arena/candidates.get.ts`): the one stored, or one drawn free when there is none yet or
 * the party has left a listed opponent's band (an attack refuses one out of band). Call after a
 * settle, so the attacker's GPN is the run's as it stands.
 */
export async function getCandidates(userId: string, now: number) {
    return db.transaction(async (tx) => {
        const state = await lockOwn(tx, userId)
        let candidates = state.arenaCandidates
        const hero = await liveHeroOf(tx, state)
        if (candidates.length === 0 || !(await listInBand(tx, candidates, hero))) {
            candidates = await drawFor(tx, userId, hero)
            await tx.update(hqState).set({ arenaCandidates: candidates }).where(eq(hqState.userId, userId))
        }
        return serializeCandidates(tx, candidates, arenaSeasonAt(now))
    })
}

/** Pay `ARENA_REFRESH_GEMS` for a new list (§2). Each refresh pays for its own draw. */
export async function refreshCandidates(userId: string, now: number) {
    return db.transaction(async (tx) => {
        const state = await lockOwn(tx, userId)
        await debitGems(userId, ARENA_REFRESH_GEMS, tx)
        const candidates = await drawFor(tx, userId, await liveHeroOf(tx, state))
        await tx.update(hqState).set({ arenaCandidates: candidates }).where(eq(hqState.userId, userId))
        return { gemsSpent: ARENA_REFRESH_GEMS, candidates: await serializeCandidates(tx, candidates, arenaSeasonAt(now)) }
    })
}

// ── Attempts ───────────────────────────────────────────────────────────────────────

/** Buy one extra attack today at the ladder's next rung (§3), read and paid under the row lock. */
export async function buyAttempt(tx: DbExecutor, userId: string, now: number) {
    const state = await lockOwn(tx, userId)
    const today = attemptsOn(attemptsOf(state), ladderDateKey(now))
    const price = extraAttemptPrice(today.purchased)
    await debitGems(userId, price, tx)
    const after = { ...today, purchased: today.purchased + 1 }
    await tx.update(hqState)
        .set({ arenaAttemptDate: after.date, arenaAttemptsUsedToday: after.used, arenaExtraAttemptsPurchasedToday: after.purchased })
        .where(eq(hqState.userId, userId))
    return { gemsSpent: price, attemptsLeft: attemptsLeft(after), nextPrice: extraAttemptPrice(after.purchased) }
}

// ── The defence ────────────────────────────────────────────────────────────────────

export type DefenseSource = { source: 'live' } | { source: 'loadout', slotIndex: number } | ({ source: 'custom' } & LoadoutInput)

/**
 * Save the defence (§1): a copy of the live loadout, of a saved Loadout, or five components named
 * outright, checked against ownership and slot counts exactly as an equip is. Free, and never
 * touches the live loadout. Defense GPN is recomputed with it.
 */
export async function setDefense(tx: DbExecutor, userId: string, request: DefenseSource) {
    const state = await lockOwn(tx, userId)
    const shopLevels = await getShopLevels(userId, tx)

    let input: LoadoutInput
    if (request.source === 'live') {
        input = { championIds: state.partyChampionIds, formation: state.formation, skillIds: state.equippedSkillIds, artifactIds: state.equippedArtifactIds, gear: state.equippedGear }
    } else if (request.source === 'loadout') {
        if (!Number.isInteger(request.slotIndex) || request.slotIndex < 0 || request.slotIndex >= loadoutSlots(shopLevels)) {
            throw createError({ statusCode: 400, statusMessage: 'That loadout slot is locked' })
        }
        const [preset] = await tx.select().from(hqLoadouts)
            .where(and(eq(hqLoadouts.userId, userId), eq(hqLoadouts.slotIndex, request.slotIndex)))
        if (!preset) throw createError({ statusCode: 400, statusMessage: 'Nothing saved in that slot' })
        input = { championIds: preset.partyChampionIds, formation: preset.formation, skillIds: preset.equippedSkillIds, artifactIds: preset.equippedArtifactIds, gear: preset.equippedGear }
    } else {
        // every component, so nothing falls back to the live loadout's
        input = {
            championIds: request.championIds ?? [],
            formation: request.formation ?? {},
            skillIds: request.skillIds ?? [],
            artifactIds: request.artifactIds ?? [],
            gear: request.gear ?? {}
        }
    }

    const writes = await validateLiveLoadout(tx, userId, state, input, shopLevels)
    const defense: ArenaDefenseLoadout = {
        partyChampionIds: writes.partyChampionIds ?? [],
        formation: writes.formation ?? {},
        equippedSkillIds: writes.equippedSkillIds ?? [],
        equippedArtifactIds: writes.equippedArtifactIds ?? [],
        equippedGear: writes.equippedGear ?? {}
    }
    const collections = await getCollections(userId, tx)
    const gpn = defenseGpnOf({ ...state, defenseLoadout: defense }, shopLevels, collections)
    await tx.update(hqState).set({ defenseLoadout: defense, ...gpn }).where(eq(hqState.userId, userId))
    return { defense, defenseGpn: gpn.defenseGpn }
}

// ── The attack ─────────────────────────────────────────────────────────────────────

/**
 * Attack the candidate in `slot` (§1–§5), which must still be `opponent` (a user ID, or
 * `ARENA_DUMMY_ID`): the list can be redrawn between the player seeing it and pressing.
 *
 * Under both rows' locks, in order: the season is still open; the defender is still in band of the
 * attacker's live party; the attacker has an attack left today; the fight runs with the
 * attacker's live party against the defender's stored defence (or the Training Dummy); both Ratings
 * move (never for a dummy); the attacker is paid Medals, spends the attack and gets a fresh list;
 * the fight and the battle log are written. A burst of attacks queues on the attacker's row, and
 * each one after the first reads the attempt it left and the list it redrew.
 *
 * `bankedGold` is read by the caller before the transaction opens (the Gambler's Strike family),
 * as a raid entry does. `now` is the clock the request closed seasons by.
 */
export async function attackArena(tx: DbExecutor, userId: string, slot: number, opponent: string, bankedGold: number, now: number) {
    // the target, from the list as it stands; the locks below are taken in user-ID order, so the
    // attacker's row can't be locked first just to read it
    const [peek] = await tx.select({ candidates: hqState.arenaCandidates }).from(hqState).where(eq(hqState.userId, userId))
    if (!peek) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    const listed = peek.candidates[slot]
    if (listed === undefined) throw createError({ statusCode: 400, statusMessage: 'Pick an opponent from the list' })
    if ((listed ?? ARENA_DUMMY_ID) !== opponent) throw createError({ statusCode: 409, statusMessage: 'The opponent list changed; pick again' })
    const dummy = listed === null

    const locked = await lockStates(tx, dummy ? [userId] : [userId, listed])
    const attacker = locked.get(userId)
    if (!attacker) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    // read again under the lock: a concurrent attack may have redrawn the list
    const slotNow = attacker.arenaCandidates[slot]
    if (slotNow === undefined || (slotNow ?? ARENA_DUMMY_ID) !== opponent) {
        throw createError({ statusCode: 409, statusMessage: 'The opponent list changed; pick again' })
    }
    const defender = dummy ? null : locked.get(listed) ?? null
    if (!dummy && !defender?.defenseLoadout) throw createError({ statusCode: 400, statusMessage: 'That opponent has no defence any more' })

    // a closed season takes no more matches: its standings are written (`closeSeason` locks these
    // rows, so a match ahead of it is in them), and a row already rolled past it can't take one either
    const season = arenaSeasonAt(now)
    const [closed] = await tx.select({ seasonId: hqArenaSeasons.seasonId }).from(hqArenaSeasons).where(eq(hqArenaSeasons.seasonId, season))
    if (closed || attacker.arenaSeasonId > season || (defender && defender.arenaSeasonId > season)) {
        throw createError({ statusCode: 409, statusMessage: 'The season just ended; try again' })
    }
    const attempts = attemptsOn(attemptsOf(attacker), ladderDateKey(now))
    if (attemptsLeft(attempts) < 1) throw createError({ statusCode: 400, statusMessage: 'No attacks left today' })

    // ── The attacker's party. ──
    // The live loadout, exactly as it stands: this is the seam for the preferred-Loadout
    // auto-apply (`loadouts.md` §4, `arena.md` §1). When the Arena has a preferred Loadout, it is
    // applied to the live state here, before the snapshot below is taken and before the fight runs,
    // and reverted on leaving the Arena; the attempt is spent only after, so the swap always lands
    // before the cost. Built by the generic per-raid/Arena auto-apply, not by this module.
    const [attackerShop, attackerCollections] = await Promise.all([getShopLevels(userId, tx), getCollections(userId, tx)])
    const hero = heroSnapshotOf(attacker, attackerShop, attackerCollections, bankedGold)
    // the band is held here, under the lock, against the party about to fight: a list drawn on a
    // weaker loadout, or a defender who has since saved a weaker defence, can't be punched down on
    const banded = heroSnapshotOf(attacker, attackerShop, attackerCollections)
    if (!dummy && !(await listInBand(tx, [listed], banded))) {
        throw createError({ statusCode: 409, statusMessage: 'That opponent is out of your range now; pick again' })
    }

    const seed = randomInt(1, 0x7FFFFFFF)
    let fight: DuelResult
    let enemy: { classId: string, heroRow: 'front' | 'back', champions: { id: string, row: 'front' | 'back' }[] } | null = null
    if (dummy) {
        fight = runArenaDummy(hero, positionOf(attacker), seed)
    } else {
        const [shop, collections] = await Promise.all([getShopLevels(listed, tx), getCollections(listed, tx)])
        const defenderHero = defenseSnapshotOf(defender!, shop, collections)!
        fight = runDuel({ attacker: hero, defender: defenderHero, seed })
        enemy = {
            classId: defenderHero.classId,
            heroRow: partyUnitStats(defenderHero)[0]?.row ?? 'front',
            champions: (defenderHero.champions ?? []).map(c => ({ id: c.championId, row: c.row }))
        }
    }
    // the dummy always falls (§2a); its log is the show, sized to end well inside the clock
    const won = dummy || fight.outcome === 'win'

    const attackerStanding = rollStanding(standingOf(attacker), season)
    const elo = dummy ? null : eloUpdate(attackerStanding.rating, rollStanding(standingOf(defender!), season).rating, won)
    const medals = medalsFor(won, elo?.expectedAttacker ?? null)
    const candidates = await drawFor(tx, userId, banded)

    // a dummy fight never touches the ladder, and is no match for the season's standings
    const attackerAfter: ArenaStanding = elo
        ? { season: attackerStanding.season, rating: elo.attacker.after, matches: attackerStanding.matches + 1 }
        : attackerStanding
    await tx.update(hqState).set({
        ...standingWrites(attackerAfter),
        arenaMedals: sql`${hqState.arenaMedals} + ${medals}`,
        arenaAttemptDate: attempts.date,
        arenaAttemptsUsedToday: attempts.used + 1,
        arenaExtraAttemptsPurchasedToday: attempts.purchased,
        arenaCandidates: candidates
    }).where(eq(hqState.userId, userId))

    if (elo && defender) {
        const before = rollStanding(standingOf(defender), season)
        await tx.update(hqState)
            .set(standingWrites({ season: before.season, rating: elo.defender.after, matches: before.matches + 1 }))
            .where(eq(hqState.userId, defender.userId))
    }

    await tx.insert(hqFights).values({
        userId,
        kind: 'arena',
        seed,
        outcome: fight.outcome,
        context: {
            opponentUserId: dummy ? null : listed,
            dummy,
            won,
            medals,
            ratingChange: elo?.attacker.change ?? 0,
            defenderRatingChange: elo?.defender.change ?? 0,
            season,
            heroLevel: hero.heroLevel,
            classId: hero.classId
        }
    })
    await writeLog(tx, [
        { userId, opponentUserId: dummy ? null : listed, role: 'attacker', won, ratingChange: elo?.attacker.change ?? 0, medalsEarned: medals, isDummy: dummy },
        ...(elo && defender ? [{ userId: defender.userId, opponentUserId: userId, role: 'defender', won: !won, ratingChange: elo.defender.change, medalsEarned: 0, isDummy: false }] : [])
    ])

    const [named] = dummy ? [] : await tx.select({ name: user.name }).from(user).where(eq(user.id, listed))
    return {
        seed,
        dummy,
        opponentName: dummy ? 'Training Dummy' : named?.name ?? 'Unknown',
        outcome: fight.outcome,
        won,
        medals,
        rating: attackerAfter.rating,
        ratingChange: elo?.attacker.change ?? 0,
        attemptsLeft: attemptsLeft({ ...attempts, used: attempts.used + 1 }),
        secondsElapsed: fight.secondsElapsed,
        events: fight.events,
        /** The attacker as the fight indexed it (`unitIndex`), for the stage. */
        partyIds: [hero.classId, ...(hero.champions ?? []).map(champion => champion.championId)],
        partyMaxHps: fight.partyMaxHps,
        /** The defence as the fight indexed it (`enemyIndex`); null for the dummy. */
        enemy,
        enemyMaxHps: fight.enemyMaxHps
    }
}

/** Write battle log rows and keep each player's newest `ARENA_LOG_SIZE` (§8). */
async function writeLog(tx: DbExecutor, rows: (typeof hqArenaLog.$inferInsert)[]) {
    if (rows.length === 0) return
    // the insert's own instant, not the transaction's: a queued attack started before the one ahead of it committed
    await tx.insert(hqArenaLog).values(rows.map(row => ({ ...row, createdAt: sql`clock_timestamp()` })))
    for (const id of [...new Set(rows.map(row => row.userId))]) {
        const keep = tx.select({ id: hqArenaLog.id }).from(hqArenaLog)
            .where(eq(hqArenaLog.userId, id))
            .orderBy(desc(hqArenaLog.createdAt), desc(hqArenaLog.id))
            .limit(ARENA_LOG_SIZE)
        await tx.delete(hqArenaLog).where(and(eq(hqArenaLog.userId, id), notInArray(hqArenaLog.id, keep)))
    }
}

// ── The Arena Shop ─────────────────────────────────────────────────────────────────

/**
 * Buy `quantity` of a shop item with Medals (§6), claim-then-reward: the Medals come off in one
 * conditional decrement that only passes with enough of them, and the goods are paid in the same
 * transaction, so a burst of purchases can never spend more Medals than there were.
 */
export async function buyFromShop(tx: DbExecutor, userId: string, itemId: unknown, quantity: unknown) {
    const item = arenaShopItem(itemId)
    if (!item) throw createError({ statusCode: 400, statusMessage: 'Unknown item' })
    const count = Math.floor(Number(quantity ?? 1))
    if (!Number.isFinite(count) || count < 1 || count > ARENA_SHOP_MAX_QUANTITY) {
        throw createError({ statusCode: 400, statusMessage: `Buy between 1 and ${ARENA_SHOP_MAX_QUANTITY}` })
    }
    const cost = item.price * count

    // Keys go to the raid's row before the Medals come off `hq_state`: a raid entry takes its raid
    // row first and `hq_state` after, and this keeps that order. A failed spend rolls them back.
    // The grant owed since the last visit is applied and written first, as a raid entry does, so the
    // Keys bought land on top of it. Bought Keys may stand above `RAID_KEY_CAP`: the cap only stops
    // the daily grant (`grantKeys`), and a purchase is never silently cut to it.
    if (item.kind === 'keys') {
        const raid = await lockRaid(tx, userId, item.raid, Date.now())
        await tx.update(hqRaidState)
            .set({ keyBalance: raid.keys + count, lastKeyGrantAt: raid.lastKeyGrantAt })
            .where(eq(hqRaidState.id, raid.row.id))
    }

    const [spent] = await tx.update(hqState)
        .set({
            arenaMedals: sql`${hqState.arenaMedals} - ${cost}`,
            ...(item.kind === 'seals' ? sealGrant(item.system, count) : {})
        })
        .where(and(eq(hqState.userId, userId), sql`${hqState.arenaMedals} >= ${cost}`))
        .returning()
    if (!spent) throw createError({ statusCode: 400, statusMessage: 'Not enough Arena Medals' })

    let amount = count
    if (item.kind === 'gold') {
        // minutes of the run's income as it stands: the caller settled first
        const [shopLevels, collections] = await Promise.all([getShopLevels(userId, tx), getCollections(userId, tx)])
        const perHour = goldPerHourAt(heroSnapshotOf(spent, shopLevels, collections), positionOf(spent), tenureDaysOf(spent))
        amount = Math.floor(perHour * item.minutes / 60 * count)
        if (amount > 0) await credit(userId, amount.toFixed(4), 'hero-quest:arena', tx)
    } else if (item.kind === 'gems') {
        await creditGems(userId, count, tx)
    }
    return {
        itemId: item.id,
        kind: item.kind,
        quantity: count,
        amount,
        medalsSpent: cost,
        arenaMedals: spent.arenaMedals,
        ...(item.kind === 'keys' ? { raidName: getRaid(item.raid).name } : {})
    }
}

// ── Reads ──────────────────────────────────────────────────────────────────────────

/** The battle log (§8): newest first, the opponent named, a dummy as "Training Dummy". */
export async function arenaLog(userId: string, executor: DbExecutor = db) {
    const rows = await executor.select({
        id: hqArenaLog.id,
        role: hqArenaLog.role,
        won: hqArenaLog.won,
        ratingChange: hqArenaLog.ratingChange,
        medalsEarned: hqArenaLog.medalsEarned,
        isDummy: hqArenaLog.isDummy,
        createdAt: hqArenaLog.createdAt,
        opponentName: user.name
    })
        .from(hqArenaLog)
        .leftJoin(user, eq(user.id, hqArenaLog.opponentUserId))
        .where(eq(hqArenaLog.userId, userId))
        .orderBy(desc(hqArenaLog.createdAt), desc(hqArenaLog.id))
        .limit(ARENA_LOG_SIZE)
    return rows.map(row => ({
        id: row.id,
        role: row.role as 'attacker' | 'defender',
        won: row.won,
        ratingChange: row.ratingChange,
        medalsEarned: row.medalsEarned,
        isDummy: row.isDummy,
        opponentName: row.isDummy ? 'Training Dummy' : row.opponentName ?? 'Unknown',
        at: row.createdAt.getTime()
    }))
}

interface LeaderRow { userId: string, name: string, rating: number, rank: number, pos: number }

/**
 * The Rating leaderboard (§9), for the current season: the top `ARENA_LEADERBOARD_TOP`, and the
 * viewer's own rank with `ARENA_LEADERBOARD_NEIGHBORS` either side. Ranked are the players who have
 * fought, or been fought, this season; ties share a rank.
 */
export async function arenaLeaderboard(userId: string, now: number) {
    const season = arenaSeasonAt(now)
    const result = await db.execute(sql`
        with ranked as (
            select user_id, arena_rating as rating,
                   rank() over (order by arena_rating desc)::int as rank,
                   row_number() over (order by arena_rating desc, user_id)::int as pos
            from hq_state
            where arena_season_id = ${season} and arena_season_matches > 0
        ), mine as (
            select pos from ranked where user_id = ${userId}
        )
        select r.user_id, u.name, r.rating, r.rank, r.pos
        from ranked r
        join "user" u on u.id = r.user_id
        where r.pos <= ${ARENA_LEADERBOARD_TOP}
           or exists (select 1 from mine m where r.pos between m.pos - ${ARENA_LEADERBOARD_NEIGHBORS} and m.pos + ${ARENA_LEADERBOARD_NEIGHBORS})
        order by r.pos
    `)
    const rows = (result.rows as { user_id: string, name: string, rating: number, rank: number, pos: number }[])
        .map((row): LeaderRow => ({ userId: row.user_id, name: row.name, rating: Number(row.rating), rank: Number(row.rank), pos: Number(row.pos) }))
    const entry = (row: LeaderRow) => ({ rank: row.rank, name: row.name, rating: row.rating, you: row.userId === userId })
    const me = rows.find(row => row.userId === userId) ?? null
    return {
        season,
        endsAt: arenaSeasonEndsAt(season),
        top: rows.filter(row => row.pos <= ARENA_LEADERBOARD_TOP).map(entry),
        /** The viewer's rank, or null before they have fought this season. */
        me: me ? { rank: me.rank, rating: me.rating } : null,
        /** The viewer and their neighbours, when they sit below the top list. */
        around: me && me.pos > ARENA_LEADERBOARD_TOP
            ? rows.filter(row => Math.abs(row.pos - me.pos) <= ARENA_LEADERBOARD_NEIGHBORS).map(entry)
            : []
    }
}

/**
 * The player's Arena as the state payload carries it: Medals, Rating this season, today's attacks
 * and the next one's price, the defence and its GPN, and any season reward waiting. Read only: a
 * stale season shows as the start Rating until something rolls the row.
 */
export function serializeArena(state: HqStateRow, unclaimed: Awaited<ReturnType<typeof unclaimedSeasons>>, now = Date.now()) {
    const season = arenaSeasonAt(now)
    const standing = rollStanding(standingOf(state), season)
    const today = attemptsOn(attemptsOf(state), ladderDateKey(now))
    return {
        medals: state.arenaMedals,
        rating: standing.rating,
        matches: standing.matches,
        season,
        seasonEndsAt: arenaSeasonEndsAt(season),
        attempts: {
            free: ARENA_FREE_ATTEMPTS_PER_DAY,
            used: today.used,
            purchased: today.purchased,
            left: attemptsLeft(today),
            nextPrice: extraAttemptPrice(today.purchased)
        },
        refreshGems: ARENA_REFRESH_GEMS,
        defense: state.defenseLoadout
            ? { ...state.defenseLoadout, gpn: state.defenseGpn }
            : null,
        unclaimed
    }
}
