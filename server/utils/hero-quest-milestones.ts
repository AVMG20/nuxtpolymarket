/**
 * Milestones on the server (`shared/utils/hero-quest/milestones.ts`): the feats as they stand, the
 * rows the scene draws, and a claim.
 *
 * A claim is a compare-and-swap on the claimed tracks' stored counts, never a `hq_state` lock, for
 * the calendar's reason: a raid track's Keys go to the raid's row first, and a raid entry locks its
 * raid row before touching `hq_state`, so taking `hq_state` first here could deadlock against it.
 * Two claims at once read the same counts; the second's swap matches nothing and throws, rolling
 * back its Keys. Every feat only grows, so a feat read a moment stale can only claim less.
 */

import { and, count, eq, sql, type SQL } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { hqCollection, hqRaidState, hqState } from '#server/database/schema'
import { creditGems } from '#server/utils/balance'
import { sealGrant, type HqStateRow } from '#server/utils/hero-quest'
import { RAID_KEYS_PER_DAY } from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS, type GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { RaidId } from '#shared/utils/hero-quest/content/raids'
import {
    MILESTONE_TRACKS,
    getMilestoneTrack,
    mergeMilestoneRewards,
    milestoneRows,
    worldsClearedOf,
    type MilestoneSnapshot
} from '#shared/utils/hero-quest/milestones'

/** Every feat a track counts, from the state row, each raid's best and the items owned per gacha. */
export function milestoneSnapshotOf(
    state: HqStateRow,
    raidLevels: Partial<Record<RaidId, number>>,
    owned: Partial<Record<GachaSystem, number>>
): MilestoneSnapshot {
    return {
        worldsCleared: worldsClearedOf(state.prestige, state.world, state.runCleared),
        prestiges: state.prestige,
        raidLevels,
        owned
    }
}

/**
 * The rows the Milestones scene draws. Named apart from Polytown's `serializeMilestones`
 * (`town.ts`): Nitro auto-imports every `server/utils` export, and two of one name shadow each other.
 */
export function serializeHqMilestones(state: HqStateRow, raidLevels: Partial<Record<RaidId, number>>, owned: Partial<Record<GachaSystem, number>>) {
    return milestoneRows(milestoneSnapshotOf(state, raidLevels, owned), state.milestonesClaimed)
}

async function readFeats(tx: DbExecutor, userId: string) {
    const [raids, collections] = await Promise.all([
        tx.select({ raidId: hqRaidState.raidId, level: hqRaidState.highestLevel }).from(hqRaidState).where(eq(hqRaidState.userId, userId)),
        tx.select({ system: hqCollection.system, owned: count() }).from(hqCollection).where(eq(hqCollection.userId, userId)).groupBy(hqCollection.system)
    ])
    const raidLevels: Partial<Record<RaidId, number>> = {}
    for (const r of raids) raidLevels[r.raidId as RaidId] = r.level
    const owned: Partial<Record<GachaSystem, number>> = {}
    for (const c of collections) owned[c.system as GachaSystem] = Number(c.owned)
    return { raidLevels, owned }
}

/**
 * Claim every step reached and not yet claimed: on one track with `trackId`, or on every track.
 * Call it inside a transaction.
 */
export async function claimMilestones(tx: DbExecutor, userId: string, trackId: string | null) {
    const tracks = trackId === null ? MILESTONE_TRACKS : [getMilestoneTrack(trackId)].filter(t => t !== undefined)
    if (!tracks.length) throw createError({ statusCode: 400, statusMessage: 'Unknown milestone' })

    const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId))
    if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    const { raidLevels, owned } = await readFeats(tx, userId)

    const wanted = new Set(tracks.map(t => t.id))
    const rows = serializeHqMilestones(state, raidLevels, owned).filter(r => wanted.has(r.id) && r.claimable.length > 0)
    if (!rows.length) throw createError({ statusCode: 400, statusMessage: 'No milestone to claim' })

    const rewards = rows.flatMap(r => r.claimable)
    const seals = Object.fromEntries(GACHA_SYSTEMS.map(s => [s, 0])) as Record<GachaSystem, number>
    let gems = 0
    const keys = new Map<RaidId, number>()
    for (const r of rewards) {
        if (r.kind === 'all_seals') for (const s of GACHA_SYSTEMS) seals[s] += r.amount
        else if (r.kind === 'seals') seals[r.system] += r.amount
        else if (r.kind === 'gems') gems += r.amount
        else keys.set(r.raid, (keys.get(r.raid) ?? 0) + r.amount)
    }

    // Keys before the swap: a raid entry takes its raid row before hq_state, so this keeps that order.
    // A raid never visited starts with a day's Keys, as `lockRaid` would create it.
    for (const [raid, amount] of keys) {
        await tx.insert(hqRaidState)
            .values({ userId, raidId: raid, keyBalance: RAID_KEYS_PER_DAY + amount })
            .onConflictDoUpdate({
                target: [hqRaidState.userId, hqRaidState.raidId],
                set: { keyBalance: sql`${hqRaidState.keyBalance} + ${amount}` }
            })
    }

    const patch = Object.fromEntries(rows.map(r => [r.id, r.reached]))
    const guards: SQL[] = rows.map(r => sql`coalesce((${hqState.milestonesClaimed} ->> ${r.id})::int, 0) = ${r.claimed}`)
    const [claimed] = await tx.update(hqState)
        .set({
            milestonesClaimed: sql`${hqState.milestonesClaimed} || ${JSON.stringify(patch)}::jsonb`,
            ...Object.assign({}, ...GACHA_SYSTEMS.filter(s => seals[s] > 0).map(s => sealGrant(s, seals[s])))
        })
        .where(and(eq(hqState.userId, userId), ...guards))
        .returning({ userId: hqState.userId })
    if (!claimed) throw createError({ statusCode: 409, statusMessage: 'Milestones changed; try again' })

    if (gems > 0) await creditGems(userId, gems, tx)

    return {
        claimed: rows.map(r => ({ id: r.id, from: r.claimed, to: r.reached })),
        rewards: mergeMilestoneRewards(rewards)
    }
}
