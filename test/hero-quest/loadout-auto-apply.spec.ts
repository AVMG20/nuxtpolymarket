/**
 * Preferred Loadouts on raid engage (`loadouts.md` §4), against the real tables: a fresh engage
 * snapshots and applies, a retry keeps, leaving reverts, the run holds while a session is open and
 * a settle past presence closes it, the run's boss and every loadout write put the player's own
 * loadout back first, and quick-clear touches none of it.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqFights, hqLoadouts, hqRaidState, hqShopUpgrades, hqState } from '#server/database/schema'
import { ensureHqState, lockLiveLoadout, resolveBossEngage, settleHq } from '#server/utils/hero-quest'
import { engageRaid, quickClearRaid } from '#server/utils/hero-quest-raids'
import { leaveLoadoutSession, serializeLoadoutPreferences, setLoadoutPreference } from '#server/utils/hero-quest-loadout'
import { CHAMPIONS } from '#shared/utils/hero-quest/content/champions'
import { GEAR } from '#shared/utils/hero-quest/content/gear'
import { ONLINE_THRESHOLD_MS, RAID_KEYS_PER_DAY } from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-hero-quest-auto-apply-user'
const HERO = { classId: 'class_beginner', heroLevel: 5, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0 } as HeroSnapshot

const [C1, C2, C3, C4] = CHAMPIONS.slice(0, 4).map(c => c.id) as [string, string, string, string]
const WEAPON = GEAR.find(g => g.slot === 'weapon')!.id
const BOOTS = GEAR.find(g => g.slot === 'boots')!.id

async function cleanup() {
    await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
    await db.delete(hqRaidState).where(eq(hqRaidState.userId, USER_ID))
    await db.delete(hqFights).where(eq(hqFights.userId, USER_ID))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

async function own(system: GachaSystem, ...contentIds: string[]) {
    for (const contentId of contentIds) await db.insert(hqCollection).values({ userId: USER_ID, system, contentId }).onConflictDoNothing()
}

async function save(slotIndex: number, partyChampionIds: string[], equippedGear: Record<string, string> = {}) {
    await db.insert(hqLoadouts).values({ userId: USER_ID, slotIndex, name: `Slot ${slotIndex}`, partyChampionIds, equippedGear, formation: {} })
}

const stateOf = async () => (await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!
const prefer = (target: Parameters<typeof setLoadoutPreference>[2], slot: number | null) => db.transaction(tx => setLoadoutPreference(tx, USER_ID, target, slot))
const engage = (raidId: Parameters<typeof engageRaid>[2], seen?: string[][]) => db.transaction(tx => engageRaid(tx, USER_ID, raidId, (state) => {
    seen?.push(state.partyChampionIds)
    return { ...HERO }
}))
const leave = () => db.transaction(tx => leaveLoadoutSession(tx, USER_ID))

describe.skipIf(SKIP)('hero-quest preferred loadouts on raid engage', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
        await own('champion', C1, C2, C3, C4)
        await own('gear', WEAPON, BOOTS)
        // the player's own loadout: one Champion and a weapon
        await db.update(hqState).set({ partyChampionIds: [C1], equippedGear: { weapon: WEAPON } }).where(eq(hqState.userId, USER_ID))
        await save(0, [C2, C3], { boots: BOOTS })
        await save(1, [C4])
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('swaps nothing for a raid with no preferred Loadout, but still opens its session', async () => {
        const result = await engage('raid_training_grounds')

        expect(result.loadoutSlot).toBeNull()
        const state = await stateOf()
        expect(state.partyChampionIds).toEqual([C1])
        expect(state.preRaidSnapshot).toEqual({ target: 'raid_training_grounds', slotIndex: null })

        expect(await leave()).toBe(true)
        expect((await stateOf()).preRaidSnapshot).toBeNull()
        expect((await stateOf()).partyChampionIds).toEqual([C1])
    })

    it('snapshots, applies and fights on the preferred Loadout on a fresh engage', async () => {
        await prefer('raid_training_grounds', 0)
        const seen: string[][] = []

        const result = await engage('raid_training_grounds', seen)

        expect(result.loadoutSlot).toBe(0)
        expect(seen).toEqual([[C2, C3]])
        const state = await stateOf()
        expect(state.partyChampionIds).toEqual([C2, C3])
        expect(state.equippedGear).toEqual({ boots: BOOTS })
        expect(state.preRaidSnapshot).toMatchObject({ target: 'raid_training_grounds', slotIndex: 0, partyChampionIds: [C1], equippedGear: { weapon: WEAPON } })
    })

    it('keeps the swap across retries, and reverts once on leaving', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')
        await engage('raid_training_grounds')
        // the snapshot is still the player's own loadout, never the preferred one taken over itself
        expect((await stateOf()).preRaidSnapshot).toMatchObject({ partyChampionIds: [C1] })

        expect(await leave()).toBe(true)
        const state = await stateOf()
        expect(state.partyChampionIds).toEqual([C1])
        expect(state.equippedGear).toEqual({ weapon: WEAPON })
        expect(state.preRaidSnapshot).toBeNull()
        expect(await leave()).toBe(false)
    })

    it('swaps before the Trait Key is spent and the fight runs', async () => {
        await prefer('raid_trait', 1)
        const seen: string[][] = []

        await engage('raid_trait', seen)

        expect(seen).toEqual([[C4]])
        const [row] = await db.select().from(hqRaidState).where(and(eq(hqRaidState.userId, USER_ID), eq(hqRaidState.raidId, 'raid_trait')))
        expect(row!.keyBalance).toBe(RAID_KEYS_PER_DAY - 1)
    })

    it('keeps the pre-raid snapshot when the player moves from one raid to another', async () => {
        await prefer('raid_training_grounds', 0)
        await prefer('raid_trait', 1)
        await engage('raid_training_grounds')

        const seen: string[][] = []
        await engage('raid_trait', seen)

        expect(seen).toEqual([[C4]])
        expect((await stateOf()).preRaidSnapshot).toMatchObject({ target: 'raid_trait', slotIndex: 1, partyChampionIds: [C1] })

        // on to a raid with none: the player's own loadout goes back, and the round runs on it
        const own: string[][] = []
        await engage('raid_dig_site', own)
        expect(own).toEqual([[C1]])
        expect((await stateOf()).preRaidSnapshot).toEqual({ target: 'raid_dig_site', slotIndex: null })
    })

    it('follows a picker changed mid-session on the next engage', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')
        await prefer('raid_training_grounds', 1)

        const seen: string[][] = []
        await engage('raid_training_grounds', seen)

        expect(seen).toEqual([[C4]])
        expect((await stateOf()).preRaidSnapshot).toMatchObject({ slotIndex: 1, partyChampionIds: [C1] })
    })

    it('leaves quick-clear out entirely: no snapshot, apply or revert', async () => {
        await db.insert(hqRaidState).values({ userId: USER_ID, raidId: 'raid_training_grounds', highestLevel: 2, keyBalance: 3 })
        await prefer('raid_training_grounds', 0)

        await db.transaction(tx => quickClearRaid(tx, USER_ID, 'raid_training_grounds'))
        expect((await stateOf()).preRaidSnapshot).toBeNull()
        expect((await stateOf()).partyChampionIds).toEqual([C1])

        // and inside a session it closes nothing
        await engage('raid_training_grounds')
        await db.transaction(tx => quickClearRaid(tx, USER_ID, 'raid_training_grounds'))
        expect((await stateOf()).preRaidSnapshot).not.toBeNull()
        expect((await stateOf()).partyChampionIds).toEqual([C2, C3])
    })

    it('ignores a preference pointing at a slot with nothing saved, or one no longer unlocked', async () => {
        await db.update(hqState).set({ raidLoadoutPreferences: { raid_training_grounds: 4, raid_trait: 1 } }).where(eq(hqState.userId, USER_ID))
        await db.delete(hqLoadouts).where(and(eq(hqLoadouts.userId, USER_ID), eq(hqLoadouts.slotIndex, 1)))

        expect((await engage('raid_training_grounds')).loadoutSlot).toBeNull()
        expect((await engage('raid_trait')).loadoutSlot).toBeNull()
        expect((await stateOf()).preRaidSnapshot).toEqual({ target: 'raid_trait', slotIndex: null })
        expect(serializeLoadoutPreferences(await stateOf(), [{ slotIndex: 0 }], {})).toEqual({})
    })

    it('refuses the engage, spending nothing, when the preferred Loadout can no longer be applied', async () => {
        await prefer('raid_trait', 1)
        await db.delete(hqCollection).where(and(eq(hqCollection.userId, USER_ID), eq(hqCollection.contentId, C4)))

        await expect(engage('raid_trait')).rejects.toMatchObject({ statusCode: 400 })

        const state = await stateOf()
        expect(state.partyChampionIds).toEqual([C1])
        expect(state.preRaidSnapshot).toBeNull()
        const rows = await db.select().from(hqRaidState).where(eq(hqRaidState.userId, USER_ID))
        expect(rows).toHaveLength(0)
    })

    it('refuses to point at an empty or locked slot, and clears with null', async () => {
        await expect(prefer('raid_guild', 4)).rejects.toMatchObject({ statusCode: 400 })
        await db.delete(hqLoadouts).where(and(eq(hqLoadouts.userId, USER_ID), eq(hqLoadouts.slotIndex, 1)))
        await expect(prefer('raid_guild', 1)).rejects.toMatchObject({ statusCode: 400 })

        await prefer('raid_guild', 0)
        await prefer('arena', 0)
        expect((await stateOf()).raidLoadoutPreferences).toEqual({ raid_guild: 0, arena: 0 })
        await prefer('raid_guild', null)
        expect((await stateOf()).raidLoadoutPreferences).toEqual({ arena: 0 })
    })

    it('holds the run while a session is open: a settle pays nothing and only moves the clock', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')
        const before = await stateOf()
        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - 120_000) }).where(eq(hqState.userId, USER_ID))

        const outcome = await settleHq(USER_ID)

        expect(outcome.result).toBeNull()
        const state = await stateOf()
        expect(Date.now() - state.lastSettledAt.getTime()).toBeLessThan(5_000)
        expect([state.world, state.stage, state.killCount, state.heroXp]).toEqual([before.world, before.stage, before.killCount, before.heroXp])
        expect(state.partyChampionIds).toEqual([C2, C3])
        expect(state.preRaidSnapshot).not.toBeNull()
    })

    it('pauses a running Battle Speed block with the run, on a held settle and on leaving', async () => {
        await engage('raid_training_grounds')
        const expiresAt = new Date(Date.now() + 600_000)
        await db.update(hqState).set({ speedBoostMultiplier: 2, speedBoostExpiresAt: expiresAt, lastSettledAt: new Date(Date.now() - 120_000) }).where(eq(hqState.userId, USER_ID))

        await settleHq(USER_ID)
        const held = (await stateOf()).speedBoostExpiresAt!.getTime()
        expect(held - expiresAt.getTime()).toBeGreaterThanOrEqual(120_000)
        expect(held - expiresAt.getTime()).toBeLessThan(125_000)

        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - 60_000) }).where(eq(hqState.userId, USER_ID))
        expect(await leave()).toBe(true)
        expect((await stateOf()).speedBoostExpiresAt!.getTime() - held).toBeGreaterThanOrEqual(60_000)
    })

    it('leaves a block that ran out before the raid alone', async () => {
        await engage('raid_training_grounds')
        const expiresAt = new Date(Date.now() - 300_000)
        await db.update(hqState).set({ speedBoostMultiplier: 2, speedBoostExpiresAt: expiresAt, lastSettledAt: new Date(Date.now() - 120_000) }).where(eq(hqState.userId, USER_ID))

        await settleHq(USER_ID)

        expect((await stateOf()).speedBoostExpiresAt!.getTime()).toBe(expiresAt.getTime())
    })

    it('drops the time spent in the raid on leaving, and the run goes on from there', async () => {
        await engage('raid_training_grounds')
        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - 120_000) }).where(eq(hqState.userId, USER_ID))

        expect(await leave()).toBe(true)

        expect(Date.now() - (await stateOf()).lastSettledAt.getTime()).toBeLessThan(5_000)
    })

    it('closes a session left open past presence on the next settle, and settles the gap on the player\'s own loadout', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')
        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - ONLINE_THRESHOLD_MS - 60_000) }).where(eq(hqState.userId, USER_ID))

        const outcome = await settleHq(USER_ID)

        expect(outcome.result).not.toBeNull()
        expect(outcome.online).toBe(false)
        expect(outcome.state.partyChampionIds).toEqual([C1])
        const state = await stateOf()
        expect(state.preRaidSnapshot).toBeNull()
        expect(state.equippedGear).toEqual({ weapon: WEAPON })
    })

    it('leaves a gap past presence to the settle when the session is left late', async () => {
        await engage('raid_training_grounds')
        const awayAt = new Date(Date.now() - ONLINE_THRESHOLD_MS - 60_000)
        await db.update(hqState).set({ lastSettledAt: awayAt }).where(eq(hqState.userId, USER_ID))

        expect(await leave()).toBe(true)

        expect((await stateOf()).lastSettledAt.getTime()).toBe(awayAt.getTime())
    })

    it('puts back the loadout of a session whose raid no longer reads', async () => {
        await db.update(hqState).set({
            partyChampionIds: [C4],
            preRaidSnapshot: { target: 'raid_gone', slotIndex: 0, partyChampionIds: [C1], formation: {}, equippedSkillIds: [], equippedArtifactIds: [], equippedGear: { weapon: WEAPON }, ascendantSkillIds: [] } as never
        }).where(eq(hqState.userId, USER_ID))
        await prefer('raid_training_grounds', 0)

        const seen: string[][] = []
        await engage('raid_training_grounds', seen)

        // the player's own loadout is the snapshot again, not the Loadout that was live
        expect(seen).toEqual([[C2, C3]])
        expect((await stateOf()).preRaidSnapshot).toMatchObject({ target: 'raid_training_grounds', partyChampionIds: [C1] })
        expect(await leave()).toBe(true)
        expect((await stateOf()).partyChampionIds).toEqual([C1])
    })

    it('refuses to overwrite a snapshot it cannot read', async () => {
        const broken = { target: 'raid_guild', slotIndex: 0, partyChampionIds: 'nope' }
        await db.update(hqState).set({ preRaidSnapshot: broken as never }).where(eq(hqState.userId, USER_ID))
        await prefer('raid_training_grounds', 0)

        await expect(engage('raid_training_grounds')).rejects.toMatchObject({ statusCode: 500 })
        await expect(leave()).rejects.toMatchObject({ statusCode: 500 })
        expect((await stateOf()).preRaidSnapshot).toEqual(broken)
        expect((await stateOf()).partyChampionIds).toEqual([C1])
    })

    it('puts the player\'s own loadout back before a Gear auto-equip lands on it', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')

        // the pull and the craft read the Gear they auto-equip onto through this
        const live = await db.transaction(tx => lockLiveLoadout(tx, USER_ID))

        expect(live.equippedGear).toEqual({ weapon: WEAPON })
        expect(live.partyChampionIds).toEqual([C1])
        expect((await stateOf()).preRaidSnapshot).toBeNull()
    })

    it('fights the run\'s boss on the player\'s own loadout, closing the session first', async () => {
        await prefer('raid_training_grounds', 0)
        await engage('raid_training_grounds')
        await db.update(hqState).set({ stage: 5, atBossGate: true }).where(eq(hqState.userId, USER_ID))

        const fight = await db.transaction(tx => resolveBossEngage(tx, USER_ID, 0))

        expect(fight.partyIds.slice(1)).toEqual([C1])
        const state = await stateOf()
        expect(state.partyChampionIds).toEqual([C1])
        expect(state.preRaidSnapshot).toBeNull()
    })
})
