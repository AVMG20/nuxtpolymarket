/**
 * Loadout validation (`loadouts.md`, and the equip rules of all four gacha docs).
 *
 * `validateLiveLoadout` is the security boundary for the live loadout: it is the one
 * place a client-supplied party, skill list, artifact list or gear map is checked before it
 * becomes the state the settle math runs on. Every assertion below is really the same question —
 * **can the client claim this?** — asked of a different component.
 *
 * It is also what makes `loadouts.md` §1's "never goes stale" promise safe: a saved preset is run
 * through the *same* validation as a hand-typed request, so an old preset is filtered rather than
 * trusted, and filtering can only ever be a no-op or a truncation.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqLoadouts, hqShopUpgrades, hqState } from '#server/database/schema'
import { ensureHqState, getShopLevels } from '#server/utils/hero-quest'
import { renameLoadout, validateLiveLoadout } from '#server/utils/hero-quest-loadout'
import { LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-hero-quest-loadout-user'

async function cleanup() {
    await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

async function own(system: GachaSystem, ...contentIds: string[]) {
    for (const contentId of contentIds) {
        await db.insert(hqCollection)
            .values({ userId: USER_ID, system, contentId })
            .onConflictDoNothing()
    }
}

async function grantSlots(upgradeId: string, level: number) {
    await db.insert(hqShopUpgrades)
        .values({ userId: USER_ID, upgradeId, level })
        .onConflictDoUpdate({
            target: [hqShopUpgrades.userId, hqShopUpgrades.upgradeId],
            set: { level }
        })
}

async function validate(input: Parameters<typeof validateLiveLoadout>[3]) {
    const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
    const shopLevels = await getShopLevels(USER_ID)
    return validateLiveLoadout(db, USER_ID, state!, input, shopLevels)
}

describe.skipIf(SKIP)('hero-quest loadout validation', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('ownership', () => {
        it('rejects a Champion the player never pulled', async () => {
            // The single most important check here: without it a client fields a Mythic it never
            // owned, and every stat downstream is a lie.
            await expect(validate({ championIds: ['champ_kaira'] })).rejects.toThrow()
        })

        it('rejects a Skill, an Artifact and a Gear piece the same way', async () => {
            await expect(validate({ skillIds: ['skill_ragnarok_strike'] })).rejects.toThrow()
            await expect(validate({ artifactIds: ['artifact_offense_10'] })).rejects.toThrow()
            await expect(validate({ gear: { weapon: 'gear_weapon_mythic' } })).rejects.toThrow()
        })

        it('accepts what the player does own', async () => {
            await own('skill', 'skill_quick_strike')
            const writes = await validate({ skillIds: ['skill_quick_strike'] })
            expect(writes.equippedSkillIds).toEqual(['skill_quick_strike'])
        })
    })

    describe('content validity', () => {
        it('rejects an id that is not in the roster at all', async () => {
            await expect(validate({ championIds: ['champ_nobody'] })).rejects.toThrow()
            await expect(validate({ skillIds: ['skill_nonsense'] })).rejects.toThrow()
        })

        it('rejects a Gear piece put in the wrong slot', async () => {
            // Without this a client equips a Helmet in the Weapon slot and takes a DEF-scaled
            // bonus onto its PWR — the slot is what decides which stat the bonus lands on.
            await own('gear', 'gear_helmet_common')
            await expect(validate({ gear: { weapon: 'gear_helmet_common' } })).rejects.toThrow()
        })

        it('rejects an unknown Gear slot name', async () => {
            await own('gear', 'gear_weapon_common')
            await expect(validate({ gear: { cape: 'gear_weapon_common' } })).rejects.toThrow()
        })
    })

    describe('slot counts', () => {
        it('refuses more Skills than the prestige shop has unlocked', async () => {
            await own('skill', 'skill_quick_strike', 'skill_marching_drill', 'skill_iron_discipline')
            // Starts at 2 (`skills-gacha.md` §6).
            await expect(validate({
                skillIds: ['skill_quick_strike', 'skill_marching_drill', 'skill_iron_discipline']
            })).rejects.toThrow()

            await grantSlots('skillSlots', 1)
            const writes = await validate({
                skillIds: ['skill_quick_strike', 'skill_marching_drill', 'skill_iron_discipline']
            })
            expect(writes.equippedSkillIds).toHaveLength(3)
        })

        it('refuses more Artifacts than unlocked, on the same 2→5 track', async () => {
            await own('artifact', 'artifact_offense_0', 'artifact_defense_0', 'artifact_tempo_0')
            await expect(validate({
                artifactIds: ['artifact_offense_0', 'artifact_defense_0', 'artifact_tempo_0']
            })).rejects.toThrow()
        })

        it('imposes no slot limit on Gear — all six are open from account start', async () => {
            // The deliberate exception among the four gachas (`gear-equipment.md` §1).
            const pieces = [
                'gear_weapon_common', 'gear_boots_common', 'gear_gauntlets_common',
                'gear_charm_common', 'gear_armor_common', 'gear_helmet_common'
            ]
            await own('gear', ...pieces)
            const writes = await validate({
                gear: {
                    weapon: 'gear_weapon_common', boots: 'gear_boots_common',
                    gauntlets: 'gear_gauntlets_common', charm: 'gear_charm_common',
                    armor: 'gear_armor_common', helmet: 'gear_helmet_common'
                }
            })
            expect(Object.keys(writes.equippedGear!)).toHaveLength(6)
        })
    })

    describe('duplicate slotting', () => {
        it('refuses the same Skill twice', async () => {
            // §5: levelling the one copy you own is how a skill gets stronger, not slotting it
            // twice. The same rule holds for Champions and Artifacts.
            await own('skill', 'skill_quick_strike')
            await expect(validate({
                skillIds: ['skill_quick_strike', 'skill_quick_strike']
            })).rejects.toThrow()
        })

        it('refuses the same Champion twice', async () => {
            await own('champion', 'champ_rask')
            await expect(validate({
                championIds: ['champ_rask', 'champ_rask']
            })).rejects.toThrow()
        })
    })

    describe('formation', () => {
        it('drops placements for units no longer in the party', async () => {
            // Stale state from a previous party would otherwise persist forever, and a formation
            // is only meaningful against the party it was saved with.
            await own('champion', 'champ_rask')
            const writes = await validate({
                championIds: ['champ_rask'],
                formation: { hero: 'front', champ_rask: 'back', champ_kaira: 'front' }
            })
            expect(Object.keys(writes.formation!).sort()).toEqual(['champ_rask', 'hero'])
        })

        it('enforces the 3-per-row capacity across the whole party, Hero included', async () => {
            await grantSlots('championSlots', 3)
            await own('champion', 'champ_rask', 'champ_vheln', 'champ_sorrek')
            await expect(validate({
                championIds: ['champ_rask', 'champ_vheln', 'champ_sorrek'],
                formation: {
                    hero: 'front', champ_rask: 'front', champ_vheln: 'front', champ_sorrek: 'front'
                }
            })).rejects.toThrow()
        })

        it('allows an empty front row — rows are capacities, not quotas', async () => {
            await own('champion', 'champ_rask')
            const writes = await validate({
                championIds: ['champ_rask'],
                formation: { hero: 'back', champ_rask: 'back' }
            })
            expect(writes.formation).toEqual({ hero: 'back', champ_rask: 'back' })
        })

        it('re-validates the formation when the party changes without one supplied', async () => {
            // Party and formation are one invariant, so a party change has to re-filter the
            // formation even if the caller said nothing about it.
            await own('champion', 'champ_rask')
            await db.update(hqState)
                .set({ formation: { hero: 'front', champ_kaira: 'front' } })
                .where(eq(hqState.userId, USER_ID))

            const writes = await validate({ championIds: ['champ_rask'] })
            expect(writes.formation).toEqual({ hero: 'front' })
        })
    })

    describe('partial updates', () => {
        it('touches only the components actually supplied', async () => {
            // The Gear page sends `gear` alone and knows nothing about the party.
            await own('gear', 'gear_weapon_common')
            const writes = await validate({ gear: { weapon: 'gear_weapon_common' } })
            expect(Object.keys(writes)).toEqual(['equippedGear'])
        })

        it('accepts an empty request as a no-op rather than clearing everything', async () => {
            expect(await validate({})).toEqual({})
        })

        it('clears a Gear slot when given an empty value', async () => {
            // The one way to un-equip without owning a replacement.
            await own('gear', 'gear_weapon_common')
            const writes = await validate({ gear: { weapon: '' } })
            expect(writes.equippedGear).toEqual({})
        })
    })

    describe('rename', () => {
        it('changes the name and nothing else', async () => {
            await db.insert(hqLoadouts).values({ userId: USER_ID, slotIndex: 0, name: 'Old', equippedSkillIds: ['skill_coin_toss'] })
            expect(await renameLoadout(db, USER_ID, 0, '  Boss setup  ')).toBe('Boss setup')
            const [row] = await db.select().from(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
            expect(row!.name).toBe('Boss setup')
            expect(row!.equippedSkillIds).toEqual(['skill_coin_toss'])
        })

        it('caps the name at the saved maximum', async () => {
            await db.insert(hqLoadouts).values({ userId: USER_ID, slotIndex: 0 })
            const name = await renameLoadout(db, USER_ID, 0, 'x'.repeat(LOADOUT_NAME_MAX_LENGTH + 10))
            expect(name).toHaveLength(LOADOUT_NAME_MAX_LENGTH)
        })

        it('refuses an empty slot and a blank name', async () => {
            expect(await renameLoadout(db, USER_ID, 3, 'Anything')).toBeNull()
            await db.insert(hqLoadouts).values({ userId: USER_ID, slotIndex: 0, name: 'Kept' })
            expect(await renameLoadout(db, USER_ID, 0, '   ')).toBeNull()
            const [row] = await db.select().from(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
            expect(row!.name).toBe('Kept')
        })
    })
})
