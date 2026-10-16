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

import { and, desc, eq, gt, inArray, isNotNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqArenaLog, hqArenaSeasonResults, hqArenaSeasons, hqCollection, hqFights, hqShopUpgrades, hqState, hqTraitSlots, user } from '#server/database/schema'
import { creditGems, debitGems } from '#server/utils/balance'
import { defenseGpnOf, emptyCollections, getCollections, getShopLevels, getTraitBoard, heroSnapshotOf, loadoutSnapshotOf, positionOf, restoreLoadoutSession, sealGrant, withDefenseLoadout, type HqCollectionRow, type HqCollections, type HqStateRow } from '#server/utils/hero-quest'
import { traitSlotView } from '#server/utils/hero-quest-traits'
import { engageLoadout, validateLiveLoadout, type LoadoutInput } from '#server/utils/hero-quest-loadout'
import { addRaidKeys } from '#server/utils/hero-quest-raids'
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
    inMatchBand,
    matchBand,
    medalsFor,
    rankStandings,
    ratingIn,
    refreshPrice,
    refreshesOn,
    rollStanding,
    seasonRewardFor,
    defenseTraitBoard,
    defenseTraitsFrom,
    type ArenaAttempts,
    type ArenaRefreshes,
    type ArenaDefenseLoadout,
    type ArenaStanding
} from '#shared/utils/hero-quest/arena'
import { runArenaDummy, runDuel, type DuelResult } from '#shared/utils/hero-quest/duel'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { globalPower } from '#shared/utils/hero-quest/power'
import { arenaBots, getArenaBot, type ArenaBot } from '#shared/utils/hero-quest/content/arena-bots'
import { ROOT_CLASS_ID } from '#shared/utils/hero-quest/content/classes'
import { getGear } from '#shared/utils/hero-quest/content/gear'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { HeroSnapshot, OwnedCopy } from '#shared/utils/hero-quest/types'
import { ladderDateKey } from '#shared/utils/hero-quest/gacha'
import { getRaid } from '#shared/utils/hero-quest/content/raids'
import {
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_FREE_REFRESHES_PER_DAY,
    ARENA_LEADERBOARD_NEIGHBORS,
    ARENA_LEADERBOARD_TOP,
    ARENA_LOG_MAX_AGE_HOURS,
    ARENA_LOG_SIZE,
    ARENA_RATING_START,
    ARENA_SHOP_MAX_QUANTITY
} from '#shared/utils/hero-quest/constants'
import { randomInt } from '#shared/utils/random'
import { traitBoardOf, type TraitBoard } from '#shared/utils/hero-quest/traits'
import type { HqArenaPayload } from '#server/utils/hero-quest-api'

// ── Standing, attempts, defence ────────────────────────────────────────────────────

export function standingOf(state: HqStateRow): ArenaStanding {
    return { season: state.arenaSeasonId, rating: state.arenaRating, matches: state.arenaSeasonMatches }
}

function refreshesOf(state: HqStateRow): ArenaRefreshes {
    return { date: state.arenaRefreshDate, used: state.arenaRefreshesToday }
}

function attemptsOf(state: HqStateRow): ArenaAttempts {
    return { date: state.arenaAttemptDate, used: state.arenaAttemptsUsedToday, purchased: state.arenaExtraAttemptsPurchasedToday }
}

function standingWrites(standing: ArenaStanding) {
    return { arenaSeasonId: standing.season, arenaRating: standing.rating, arenaSeasonMatches: standing.matches }
}

/**
 * The defender as they are fought: their class, level, Passive Skill Tree, Shop and whole collection
 * as they stand now, with the stored defence (its Traits included) fielded in place of whatever they
 * play with live (§1). Wealth-neutral, as the defender's banked Gold has nothing to do with a fight
 * they are not at. `liveTraits` is only read for a defence stored without its own board.
 */
export function defenseSnapshotOf(state: HqStateRow, shopLevels: Record<string, number>, collections: HqCollections, liveTraits: TraitBoard = []): HeroSnapshot | null {
    const defended = withDefenseLoadout(state)
    return defended ? heroSnapshotOf(defended, shopLevels, collections, undefined, defenseTraitBoard(state.defenseLoadout!, liveTraits)) : null
}

/** What the defence's stats are read off: the account's progress as it stands. */
export interface DefenderProgress {
    shopLevels: Record<string, number>
    collections: HqCollections
    /** The live Trait board, read only for a defence stored without its own. */
    traits: TraitBoard
}

/**
 * Defense GPN (§2) at the account's progress now (issue #32): the selection is the stored one, the
 * hero level, the copies' stars and levels, the Passive Skill Tree, the Shop's stat tracks and the
 * collection passives are today's. Null without a defence.
 */
export function defenseGpnNow(state: HqStateRow, progress: DefenderProgress): string | null {
    if (!state.defenseLoadout) return null
    return defenseGpnOf(state, progress.shopLevels, progress.collections, defenseTraitBoard(state.defenseLoadout, progress.traits)).defenseGpn
}

/**
 * Several defenders' progress at once, for the opponent list: one query a table for all of them
 * rather than three a defender. The live Trait board is read only for a defence without its own.
 */
async function defendersProgress(executor: DbExecutor, states: readonly HqStateRow[]): Promise<Map<string, DefenderProgress>> {
    const ids = states.map(state => state.userId)
    const progress = new Map<string, DefenderProgress>(ids.map(id => [id, { shopLevels: {}, collections: emptyCollections(), traits: [] }]))
    if (ids.length === 0) return progress
    const liveTraitIds = states.filter(state => state.defenseLoadout && !state.defenseLoadout.traits).map(state => state.userId)
    const [shops, owned, slots] = await Promise.all([
        executor.select().from(hqShopUpgrades).where(inArray(hqShopUpgrades.userId, ids)),
        executor.select().from(hqCollection).where(inArray(hqCollection.userId, ids)),
        liveTraitIds.length ? executor.select().from(hqTraitSlots).where(inArray(hqTraitSlots.userId, liveTraitIds)) : Promise.resolve([])
    ])
    for (const row of shops) progress.get(row.userId)!.shopLevels[row.upgradeId] = row.level
    for (const row of owned) progress.get(row.userId)!.collections[row.system as GachaSystem]?.push(row)
    for (const id of liveTraitIds) progress.get(id)!.traits = traitBoardOf(slots.filter(row => row.userId === id))
    return progress
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

// ── Arena bots ─────────────────────────────────────────────────────────────────────

const botDefenses = new Map<string, { hero: HeroSnapshot, gpn: string }>()

/**
 * A bot's defence as it is fought, and its GPN for the card. Built through the same snapshot path as
 * a player's, off a collection that is just what it wears, and kept: a bot never changes.
 */
function botDefense(bot: ArenaBot): { hero: HeroSnapshot, gpn: string } {
    const kept = botDefenses.get(bot.id)
    if (kept) return kept
    const row = (system: GachaSystem, copy: OwnedCopy): HqCollectionRow => ({
        id: bot.id, userId: bot.id, system, contentId: copy.contentId, star: copy.star, level: copy.level, dupeProgress: 0, acquiredAt: new Date(0)
    })
    const collections: HqCollections = {
        champion: bot.champions.map(copy => row('champion', copy)),
        skill: bot.skills.map(copy => row('skill', copy)),
        artifact: bot.artifacts.map(copy => row('artifact', copy)),
        gear: bot.gear.map(copy => row('gear', copy))
    }
    const hero = loadoutSnapshotOf({
        heroNodeId: ROOT_CLASS_ID,
        ascendantSkillIds: [],
        heroLevel: bot.heroLevel,
        heroXp: '0',
        formation: Object.fromEntries(bot.champions.map(copy => [copy.contentId, copy.row])),
        partyChampionIds: bot.champions.map(copy => copy.contentId),
        equippedSkillIds: bot.skills.map(copy => copy.contentId),
        equippedArtifactIds: bot.artifacts.map(copy => copy.contentId),
        equippedGear: Object.fromEntries(bot.gear.map(copy => [getGear(copy.contentId).slot, copy.contentId]))
    }, {}, collections)
    const built = { hero, gpn: globalPower(hero).gpn.toString() }
    botDefenses.set(bot.id, built)
    return built
}

/** The defence as the stage shows it: the Hero's class and row, then each Champion and its row. */
function enemyOf(defender: HeroSnapshot) {
    return {
        classId: defender.classId as string,
        heroRow: partyUnitStats(defender)[0]?.row ?? 'front',
        champions: (defender.champions ?? []).map(c => ({ id: c.championId, row: c.row }))
    }
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
        const rows = await tx.select({ userId: hqState.userId, rating: hqState.arenaRating, ratingAt: hqState.arenaRatingAt })
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

/**
 * The players a list is drawn from (§2): everyone else with a defence whose Rating this season is
 * within `ARENA_MATCH_BAND_RATING` of the attacker's, a row not yet rolled into the season counting
 * at `ARENA_RATING_START` (the user's call, 2026-10-10: the band is on Rating, not GPN). The band is
 * held only here, when the list is drawn: whoever is on it stays attackable until it is redrawn.
 */
async function candidatePool(executor: DbExecutor, userId: string, rating: number, season: number): Promise<string[]> {
    const band = matchBand(rating)
    const current = sql`case when ${hqState.arenaSeasonId} = ${season} then ${hqState.arenaRating} else ${ARENA_RATING_START} end`
    const rows = await executor.select({ userId: hqState.userId })
        .from(hqState)
        .where(and(
            ne(hqState.userId, userId),
            isNotNull(hqState.defenseLoadout),
            sql`${current} between ${band.lo} and ${band.hi}`
        ))
    return rows.map(row => row.userId)
}

/** A fresh list for the attacker at `rating`: in-band players at random, then in-band bots, dummies for the rest (§2a). */
async function drawFor(executor: DbExecutor, userId: string, rating: number, season: number): Promise<(string | null)[]> {
    const pool = await candidatePool(executor, userId, rating, season)
    const bots = arenaBots().filter(bot => inMatchBand(rating, bot.rating)).map(bot => bot.id)
    return drawCandidates(pool, n => randomInt(0, n - 1), bots)
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
    const ids = candidates.filter((id): id is string => id !== null && !getArenaBot(id))
    const rows = ids.length
        ? await executor.select({ state: hqState, name: user.name })
            .from(hqState).innerJoin(user, eq(user.id, hqState.userId)).where(inArray(hqState.userId, ids))
        : []
    // each defence's GPN at its owner's progress now, not as it stood when it was set (issue #32)
    const defended = rows.map(row => row.state).filter(state => state.defenseLoadout)
    const progress = await defendersProgress(executor, defended)
    return candidates.map((id, slot) => {
        const bot = id === null ? undefined : getArenaBot(id)
        if (bot) {
            const { hero, gpn } = botDefense(bot)
            return { slot, id: bot.id, dummy: false, name: bot.name, rating: bot.rating, defenseGpn: gpn, ...enemyOf(hero) }
        }
        const row = id === null ? undefined : rows.find(r => r.state.userId === id)
        if (id === null || !row?.state.defenseLoadout) {
            return { slot, id: id ?? ARENA_DUMMY_ID, dummy: id === null, name: id === null ? 'Training Dummy' : 'Gone', rating: null, defenseGpn: null, classId: null, heroRow: null, champions: [] }
        }
        const state = row.state
        const defense = state.defenseLoadout!
        return {
            slot,
            id,
            dummy: false,
            name: row.name,
            rating: rollStanding(standingOf(state), season).rating,
            defenseGpn: defenseGpnNow(state, progress.get(id)!),
            classId: state.heroNodeId,
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
/** The list as it stands, drawn free the first time it is read; a list once drawn is kept until a refresh or an attack. */
export async function getCandidates(userId: string, now: number) {
    return db.transaction(async (tx) => {
        const state = await lockOwn(tx, userId)
        const season = arenaSeasonAt(now)
        let candidates = state.arenaCandidates
        if (candidates.length === 0) {
            candidates = await drawFor(tx, userId, ratingIn(standingOf(state), season), season)
            await tx.update(hqState).set({ arenaCandidates: candidates }).where(eq(hqState.userId, userId))
        }
        return serializeCandidates(tx, candidates, season)
    })
}

/**
 * Redraw the list (§2): free `ARENA_FREE_REFRESHES_PER_DAY` times a UTC day, then 5, 10, 20, … Gems
 * (the user's call, 2026-10-10). The day's count is read and written under the row lock, so a burst
 * prices each redraw at its own rung.
 */
export async function refreshCandidates(userId: string, now: number) {
    return db.transaction(async (tx) => {
        const state = await lockOwn(tx, userId)
        const today = refreshesOn(refreshesOf(state), ladderDateKey(now))
        const price = refreshPrice(today.used)
        if (price > 0) await debitGems(userId, price, tx)
        const season = arenaSeasonAt(now)
        const candidates = await drawFor(tx, userId, ratingIn(standingOf(state), season), season)
        await tx.update(hqState)
            .set({ arenaCandidates: candidates, arenaRefreshDate: today.date, arenaRefreshesToday: today.used + 1 })
            .where(eq(hqState.userId, userId))
        return { gemsSpent: price, nextPrice: refreshPrice(today.used + 1), candidates: await serializeCandidates(tx, candidates, season) }
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

/**
 * "Set current loadout as defence" (§1; the user's call, 2026-10-10: the one way a defence is set,
 * kept apart from the saved Loadout slots). The player's own loadout and Trait board: a raid's or
 * the Arena's preferred Loadout still live is put back first. Checked against ownership and slot
 * counts as an equip is, free, and never touches the live loadout. The selection stays as set until
 * the next press; its stats follow the account (issue #32). `defenseGpn` is written as it stands
 * now, a record only: everything shown works it out afresh (`defenseGpnNow`).
 */
export async function setDefense(tx: DbExecutor, userId: string) {
    const state = await restoreLoadoutSession(tx, userId, await lockOwn(tx, userId))
    const shopLevels = await getShopLevels(userId, tx)
    const input: LoadoutInput = { championIds: state.partyChampionIds, formation: state.formation, skillIds: state.equippedSkillIds, artifactIds: state.equippedArtifactIds, gear: state.equippedGear }

    const writes = await validateLiveLoadout(tx, userId, state, input, shopLevels)
    const [collections, traits] = await Promise.all([getCollections(userId, tx), getTraitBoard(userId, tx)])
    const defense: ArenaDefenseLoadout = {
        partyChampionIds: writes.partyChampionIds ?? [],
        formation: writes.formation ?? {},
        equippedSkillIds: writes.equippedSkillIds ?? [],
        equippedArtifactIds: writes.equippedArtifactIds ?? [],
        equippedGear: writes.equippedGear ?? {},
        traits: defenseTraitsFrom(traits)
    }
    const defenseGpn = defenseGpnNow({ ...state, defenseLoadout: defense }, { shopLevels, collections, traits })
    await tx.update(hqState).set({ defenseLoadout: defense, defenseGpn }).where(eq(hqState.userId, userId))
    return { defense, defenseGpn }
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
    // a bot has no row to lock: its Rating never moves
    const bot = dummy ? undefined : getArenaBot(listed)
    const player = !dummy && !bot

    const locked = await lockStates(tx, player ? [userId, listed] : [userId])
    const attacker = locked.get(userId)
    if (!attacker) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    // read again under the lock: a concurrent attack may have redrawn the list
    const slotNow = attacker.arenaCandidates[slot]
    if (slotNow === undefined || (slotNow ?? ARENA_DUMMY_ID) !== opponent) {
        throw createError({ statusCode: 409, statusMessage: 'The opponent list changed; pick again' })
    }
    const defender = player ? locked.get(listed) ?? null : null
    if (player && !defender?.defenseLoadout) throw createError({ statusCode: 400, statusMessage: 'That opponent has no defence any more' })

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
    // The Arena's preferred Loadout goes on first, exactly as a raid's does (`loadouts.md` §4, the
    // user's call 2026-10-10): snapshot and apply on a fresh session, kept across attacks, put back on
    // leaving the Arena. Before the snapshot below and before the attempt is spent.
    const fielded = (await engageLoadout(tx, userId, 'arena')).state
    const [attackerShop, attackerCollections, attackerTraits] = await Promise.all([getShopLevels(userId, tx), getCollections(userId, tx), getTraitBoard(userId, tx)])
    const hero = heroSnapshotOf(fielded, attackerShop, attackerCollections, bankedGold, attackerTraits)

    const seed = randomInt(1, 0x7FFFFFFF)
    let fight: DuelResult
    let enemy: ReturnType<typeof enemyOf> | null = null
    if (dummy) {
        fight = runArenaDummy(hero, positionOf(attacker), seed)
    } else {
        let defenderHero: HeroSnapshot
        if (bot) {
            defenderHero = botDefense(bot).hero
        } else {
            // the defence's own Traits; the live board only for one stored before they were kept with it
            const [shop, collections, traits] = await Promise.all([
                getShopLevels(listed, tx),
                getCollections(listed, tx),
                defender!.defenseLoadout!.traits ? [] : getTraitBoard(listed, tx)
            ])
            defenderHero = defenseSnapshotOf(defender!, shop, collections, traits)!
        }
        fight = runDuel({ attacker: hero, defender: defenderHero, seed })
        enemy = enemyOf(defenderHero)
    }
    // the dummy always falls (§2a); a timeout goes against the side with less of its max HP left
    const won = dummy || fight.attackerWon

    const attackerStanding = rollStanding(standingOf(attacker), season)
    const elo = dummy ? null : eloUpdate(attackerStanding.rating, bot ? bot.rating : rollStanding(standingOf(defender!), season).rating, won)
    const medals = medalsFor(won, elo?.expectedAttacker ?? null)
    // a fresh list after every attack, drawn on the Rating it ends at, so the same three can't be farmed
    const candidates = await drawFor(tx, userId, (elo?.attacker.after ?? attackerStanding.rating), season)

    // a dummy fight never touches the ladder, and is no match for the season's standings
    const attackerAfter: ArenaStanding = elo
        ? { season: attackerStanding.season, rating: elo.attacker.after, matches: attackerStanding.matches + 1 }
        : attackerStanding
    await tx.update(hqState).set({
        ...standingWrites(attackerAfter),
        // a rated match stamps the Rating when it moves it, or when it is the row's first this season
        ...(elo && (elo.attacker.after !== attackerStanding.rating || attacker.arenaSeasonId !== attackerStanding.season) ? { arenaRatingAt: sql`now()` } : {}),
        arenaMedals: sql`${hqState.arenaMedals} + ${medals}`,
        ...(won ? { arenaWins: sql`${hqState.arenaWins} + 1` } : {}),
        arenaAttemptDate: attempts.date,
        arenaAttemptsUsedToday: attempts.used + 1,
        arenaExtraAttemptsPurchasedToday: attempts.purchased,
        arenaCandidates: candidates
    }).where(eq(hqState.userId, userId))

    if (elo && defender) {
        const before = rollStanding(standingOf(defender), season)
        await tx.update(hqState)
            .set({
                ...standingWrites({ season: before.season, rating: elo.defender.after, matches: before.matches + 1 }),
                ...(elo.defender.after !== before.rating || defender.arenaSeasonId !== before.season ? { arenaRatingAt: sql`now()` } : {})
            })
            .where(eq(hqState.userId, defender.userId))
    }

    await tx.insert(hqFights).values({
        userId,
        kind: 'arena',
        seed,
        outcome: fight.outcome,
        context: {
            opponentUserId: player ? listed : null,
            opponentBotId: bot?.id ?? null,
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
        { userId, opponentUserId: player ? listed : null, opponentBotId: bot?.id ?? null, role: 'attacker', won, ratingChange: elo?.attacker.change ?? 0, medalsEarned: medals, isDummy: dummy },
        ...(elo && defender ? [{ userId: defender.userId, opponentUserId: userId, role: 'defender', won: !won, ratingChange: elo.defender.change, medalsEarned: 0, isDummy: false }] : [])
    ])

    const [named] = player ? await tx.select({ name: user.name }).from(user).where(eq(user.id, listed)) : []
    return {
        seed,
        dummy,
        opponentName: dummy ? 'Training Dummy' : bot ? bot.name : named?.name ?? 'Unknown',
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

/**
 * Inside the battle log's window (§8, issue #29): written in the last `ARENA_LOG_MAX_AGE_HOURS`. An
 * age compared in SQL, against the same clock the rows are stamped with.
 */
const inLogWindow = sql`${hqArenaLog.createdAt} > clock_timestamp() - make_interval(hours => ${ARENA_LOG_MAX_AGE_HOURS})`

/**
 * Write battle log rows, then trim each player's log (§8): rows past the window go, and of the rest
 * only the newest `ARENA_LOG_SIZE` stay. A player's log is trimmed whenever they fight or are
 * fought; one left alone keeps its stale rows, which `arenaLog` never reads.
 */
async function writeLog(tx: DbExecutor, rows: (typeof hqArenaLog.$inferInsert)[]) {
    if (rows.length === 0) return
    // the insert's own instant, not the transaction's: a queued attack started before the one ahead of it committed
    await tx.insert(hqArenaLog).values(rows.map(row => ({ ...row, createdAt: sql`clock_timestamp()` })))
    for (const id of [...new Set(rows.map(row => row.userId))]) {
        const keep = tx.select({ id: hqArenaLog.id }).from(hqArenaLog)
            .where(eq(hqArenaLog.userId, id))
            .orderBy(desc(hqArenaLog.createdAt), desc(hqArenaLog.id))
            .limit(ARENA_LOG_SIZE)
        await tx.delete(hqArenaLog).where(and(
            eq(hqArenaLog.userId, id),
            or(sql`not (${inLogWindow})`, notInArray(hqArenaLog.id, keep))
        ))
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
    if (item.kind === 'keys') await addRaidKeys(tx, userId, item.raid, count)

    const [spent] = await tx.update(hqState)
        .set({
            arenaMedals: sql`${hqState.arenaMedals} - ${cost}`,
            ...(item.kind === 'seals' ? sealGrant(item.system, count) : {})
        })
        .where(and(eq(hqState.userId, userId), sql`${hqState.arenaMedals} >= ${cost}`))
        .returning()
    if (!spent) throw createError({ statusCode: 400, statusMessage: 'Not enough Arena Medals' })

    const amount = count
    if (item.kind === 'gems') await creditGems(userId, count, tx)
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

/** The battle log (§8): the last day's matches, newest first and `ARENA_LOG_SIZE` at most, the opponent named, a dummy as "Training Dummy". */
export async function arenaLog(userId: string, executor: DbExecutor = db) {
    const rows = await executor.select({
        id: hqArenaLog.id,
        role: hqArenaLog.role,
        won: hqArenaLog.won,
        ratingChange: hqArenaLog.ratingChange,
        medalsEarned: hqArenaLog.medalsEarned,
        isDummy: hqArenaLog.isDummy,
        opponentBotId: hqArenaLog.opponentBotId,
        createdAt: hqArenaLog.createdAt,
        opponentName: user.name
    })
        .from(hqArenaLog)
        .leftJoin(user, eq(user.id, hqArenaLog.opponentUserId))
        .where(and(eq(hqArenaLog.userId, userId), inLogWindow))
        .orderBy(desc(hqArenaLog.createdAt), desc(hqArenaLog.id))
        .limit(ARENA_LOG_SIZE)
    return rows.map(row => ({
        id: row.id,
        role: row.role as 'attacker' | 'defender',
        won: row.won,
        ratingChange: row.ratingChange,
        medalsEarned: row.medalsEarned,
        isDummy: row.isDummy,
        opponentName: row.isDummy
            ? 'Training Dummy'
            : (row.opponentBotId ? getArenaBot(row.opponentBotId)?.name : row.opponentName) ?? 'Unknown',
        at: row.createdAt.getTime()
    }))
}

interface LeaderRow { userId: string, name: string, rating: number, rank: number, pos: number }

/**
 * The Rating leaderboard (§9), for the current season: the top `ARENA_LEADERBOARD_TOP`, and the
 * viewer's own rank with `ARENA_LEADERBOARD_NEIGHBORS` either side. Ranked are the players who have
 * fought, or been fought, this season; an equal Rating ranks whoever reached it first, as the
 * season's close does (`rankStandings`).
 */
export async function arenaLeaderboard(userId: string, now: number) {
    const season = arenaSeasonAt(now)
    const result = await db.execute(sql`
        with ranked as (
            select user_id, arena_rating as rating,
                   row_number() over (order by arena_rating desc, arena_rating_at asc nulls last, user_id collate "C")::int as pos
            from hq_state
            where arena_season_id = ${season} and arena_season_matches > 0
        ), mine as (
            select pos from ranked where user_id = ${userId}
        )
        select r.user_id, u.name, r.rating, r.pos as rank, r.pos
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
 * and the next one's price, the defence with its Traits and its GPN at the account's progress now,
 * and any season reward waiting. Read only: a stale season shows as the start Rating until
 * something rolls the row.
 */
export function serializeArena(state: HqStateRow, unclaimed: Awaited<ReturnType<typeof unclaimedSeasons>>, progress: DefenderProgress, now = Date.now()): HqArenaPayload {
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
        refreshes: (() => {
            const t = refreshesOn(refreshesOf(state), ladderDateKey(now))
            return { free: ARENA_FREE_REFRESHES_PER_DAY, used: t.used, nextPrice: refreshPrice(t.used) }
        })(),
        defense: state.defenseLoadout
            ? {
                ...state.defenseLoadout,
                gpn: defenseGpnNow(state, progress),
                /** The Traits it fights with, by slot: its own, or the live board for one set before they were kept. */
                traits: defenseTraitBoard(state.defenseLoadout, progress.traits).map(traitSlotView)
            }
            : null,
        unclaimed
    }
}
