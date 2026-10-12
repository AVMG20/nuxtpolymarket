/**
 * Raids on the server (`raid-system.md`): the per-raid row, the lazy Key grant, a round and a
 * quick-clear. Every write happens under the raid row's lock, read inside it: the Key grant runs
 * off a timestamp, which is never compare-and-swapped.
 *
 * A Key is spent exactly when a reward is paid (§3). The Training Grounds dummy can't be beaten,
 * so a round always pays, from level 1, and spends its Key as it starts.
 */

import { and, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqFights, hqRaidState, hqState } from '#server/database/schema'
import { positionOf, sealGrant, type HqStateRow } from '#server/utils/hero-quest'
import { engageLoadout } from '#server/utils/hero-quest-loadout'
import { getRaid, RAIDS, RAIDS_OPEN, type RaidId } from '#shared/utils/hero-quest/content/raids'
import { RAID_KEY_CAP, grantKeys, nextKeyGrantAt, nextRaidLevel, raidReward, rampageLevelReached, runDigSiteFight, runDummyRound, runForgeFight, runKnightFight, runRampageFight } from '#shared/utils/hero-quest/raids'
import type { FightResult } from '#shared/utils/hero-quest/fight'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { RAID_KEYS_PER_DAY } from '#shared/utils/hero-quest/constants'
import { randomInt } from '#shared/utils/random'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

type RaidRow = typeof hqRaidState.$inferSelect

/**
 * The raid's row, locked for the rest of the transaction, with the Keys owed since the last read
 * already applied (not yet written: the caller writes them with whatever it spends or adds). A
 * first visit creates the row, which starts with a day's Keys. Exported for the Arena Shop, which
 * adds Keys the same way a spend takes them.
 */
export async function lockRaid(tx: DbExecutor, userId: string, raidId: RaidId, now: number): Promise<{ row: RaidRow, keys: number, lastKeyGrantAt: Date }> {
    await tx.insert(hqRaidState).values({ userId, raidId }).onConflictDoNothing()
    const [row] = await tx.select().from(hqRaidState)
        .where(and(eq(hqRaidState.userId, userId), eq(hqRaidState.raidId, raidId)))
        .for('update')
    if (!row) throw createError({ statusCode: 500, statusMessage: 'Could not open the raid' })
    const granted = grantKeys(row.keyBalance, row.lastKeyGrantAt.getTime(), now)
    return { row, keys: granted.balance, lastKeyGrantAt: new Date(granted.lastGrantAt) }
}

function assertOpen(raidId: RaidId): void {
    if (!RAIDS_OPEN.has(raidId)) throw createError({ statusCode: 400, statusMessage: `${getRaid(raidId).name} opens later` })
}

/** Pay a raid's reward into its currency: the Seals of the gacha it pairs with. */
async function payReward(tx: DbExecutor, userId: string, raidId: RaidId, amount: number): Promise<void> {
    if (amount <= 0) return
    const system = getRaid(raidId).pairedSystem
    // a standalone raid (Shardcaller Beast) pays Trait Gems; the rest pay their gacha's Seals
    const grant = system ? sealGrant(system, amount) : { traitGems: sql`${hqState.traitGems} + ${amount}` }
    await tx.update(hqState).set(grant).where(eq(hqState.userId, userId))
}

/**
 * Enter a raid and play its round, by the raid's fight type. A Key goes exactly when a reward is
 * paid (§3): the Training Grounds dummy and Shardcaller Beast can't be beaten, so every round pays
 * the level it reached and spends its Key; a boss (the Gilded Knight, the Dig Site, God's Forge) is fought at one past the best, and only a win
 * pays, spends the Key and raises the best. A loss costs nothing.
 *
 * The raid's preferred Loadout goes on first (`loadouts.md` §4, `engageLoadout`): after the raid
 * row's lock, before the party is read off the state, the fight runs or a Key moves, so a Trait
 * Key is never spent on a round fought with the wrong loadout. `heroFor` builds the party off the
 * row the swap leaves.
 */
export async function engageRaid(tx: DbExecutor, userId: string, raidId: RaidId, heroFor: (state: HqStateRow) => HeroSnapshot | Promise<HeroSnapshot>) {
    assertOpen(raidId)
    const now = Date.now()
    const { row, keys, lastKeyGrantAt } = await lockRaid(tx, userId, raidId, now)
    if (keys < 1) throw createError({ statusCode: 400, statusMessage: `No ${getRaid(raidId).key} left` })

    const loadout = await engageLoadout(tx, userId, raidId)
    const hero = await heroFor(loadout.state)
    const position = positionOf(loadout.state)

    // CSPRNG for the seed; the round is deterministic from it, so the client replays it exactly
    const seed = randomInt(1, 0x7FFFFFFF)
    const fightType = getRaid(raidId).fightType
    let fight: FightResult
    let level: number
    let paid: boolean
    let damage: string | null = null
    if (fightType === 'training_dummy') {
        const round = runDummyRound(hero, position, seed)
        fight = round.fight
        level = round.level
        damage = round.damage.toString()
        paid = true
    } else if (fightType === 'rampaging_boss') {
        // it can't die: the run goes until the party falls, and the level it reached pays
        fight = runRampageFight(hero, position, seed)
        level = rampageLevelReached(fight)
        paid = true
    } else if (fightType === 'solo_boss' || fightType === 'reinforced_boss' || fightType === 'boss_gauntlet') {
        level = nextRaidLevel(row.highestLevel)
        const run = fightType === 'solo_boss' ? runKnightFight : fightType === 'reinforced_boss' ? runDigSiteFight : runForgeFight
        fight = run(hero, position, seed, level)
        paid = fight.outcome === 'win'
    } else {
        throw createError({ statusCode: 400, statusMessage: `${getRaid(raidId).name} opens later` })
    }

    const reward = paid ? raidReward(raidId, level) : 0
    const best = paid ? Math.max(row.highestLevel, level) : row.highestLevel
    const keysLeft = paid ? keys - 1 : keys
    // the grant owed since the last visit is written either way; the Key and the best only on a pay
    await tx.update(hqRaidState)
        .set({ keyBalance: keysLeft, lastKeyGrantAt, highestLevel: best })
        .where(eq(hqRaidState.id, row.id))
    if (paid) await payReward(tx, userId, raidId, reward)
    await tx.insert(hqFights).values({
        userId,
        kind: 'raid',
        seed,
        outcome: fight.outcome,
        context: { raidId, heroLevel: hero.heroLevel, classId: hero.classId, level, reward, ...(damage === null ? {} : { damage }) }
    })

    return {
        raidId,
        seed,
        outcome: fight.outcome,
        /** The level fought (a boss) or reached (the dummy). */
        level,
        damage,
        reward,
        best,
        newBest: paid && level > row.highestLevel,
        keys: keysLeft,
        /** The preferred Loadout slot the round was fought with; null for the player's own loadout. */
        loadoutSlot: loadout.slotIndex,
        secondsElapsed: fight.secondsElapsed,
        events: fight.events,
        /** Each enemy's starting HP, for the replay's HP bars. */
        enemyMaxHps: fight.enemyMaxHps,
        /** The party as the fight indexed it, for the stage to put each hit on the right body. */
        partyIds: [hero.classId, ...(hero.champions ?? []).map(champion => champion.championId)],
        partyMaxHps: partyUnitStats(hero).map(unit => unit.maxHp.toString())
    }
}

/** Spend a Key to take the personal best's reward again, without a round (§4). */
export async function quickClearRaid(tx: DbExecutor, userId: string, raidId: RaidId) {
    assertOpen(raidId)
    const { row, keys, lastKeyGrantAt } = await lockRaid(tx, userId, raidId, Date.now())
    if (row.highestLevel < 1) throw createError({ statusCode: 400, statusMessage: 'Play a round first' })
    if (keys < 1) throw createError({ statusCode: 400, statusMessage: `No ${getRaid(raidId).key} left` })

    const reward = raidReward(raidId, row.highestLevel)
    await tx.update(hqRaidState).set({ keyBalance: keys - 1, lastKeyGrantAt }).where(eq(hqRaidState.id, row.id))
    await payReward(tx, userId, raidId, reward)
    return { raidId, level: row.highestLevel, reward, keys: keys - 1 }
}

/**
 * Every raid as the client shows it: its Keys with the grant applied as of now (read only; the
 * grant is written by the next entry), when the next day's arrive, its best, and what that pays.
 */
export async function serializeRaids(userId: string, executor: DbExecutor = db) {
    const rows = await executor.select().from(hqRaidState).where(eq(hqRaidState.userId, userId))
    const now = Date.now()
    return RAIDS.map((raid) => {
        const row = rows.find(r => r.raidId === raid.id)
        // a raid never visited has a day's Keys and its grant clock starts now
        const granted = row ? grantKeys(row.keyBalance, row.lastKeyGrantAt.getTime(), now) : { balance: RAID_KEYS_PER_DAY, lastGrantAt: now }
        const best = row?.highestLevel ?? 0
        return {
            id: raid.id,
            open: RAIDS_OPEN.has(raid.id),
            keys: granted.balance,
            keyCap: RAID_KEY_CAP,
            nextKeyAt: granted.balance >= RAID_KEY_CAP ? null : nextKeyGrantAt(granted.lastGrantAt),
            best,
            /** What a quick-clear of the best pays; 0 before a first round. */
            bestReward: best > 0 ? raidReward(raid.id, best) : 0
        }
    })
}
