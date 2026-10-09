/**
 * Loadout validation — the one place a live loadout is checked before it is written.
 *
 * Shared by `loadout/set.post.ts` (a request body) and `loadout/apply.post.ts` (a saved preset),
 * because the two are the same operation over different sources. That sharing is what makes
 * `loadouts.md`'s "never goes stale" promise safe to keep: a preset saved long ago under fewer
 * slots is not rejected, it is simply *filtered* through today's ownership and slot counts, the
 * same way a hand-typed request is. Nothing in this game is ever un-owned and slot counts only
 * grow, so filtering is always a no-op or a truncation, never a loss.
 *
 * Every check here answers the same question: **is the client allowed to claim this?** Ownership
 * is read from `hqCollection`, never taken from the request — otherwise a client could field a
 * Mythic it never pulled.
 */

import { and, eq, inArray } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import type { hqState } from '#server/database/schema'
import { hqCollection, hqLoadouts } from '#server/database/schema'
import { artifactSlots, championSlots, skillSlots } from '#server/utils/hero-quest'
import { ASCENDANT_KIT_SIZE, FORMATION_ROW_CAPACITY, LOADOUT_NAME_MAX_LENGTH } from '#shared/utils/hero-quest/constants'
import { getArchetype, getChampion, isChampionId } from '#shared/utils/hero-quest/content/champions'
import { classOfSkill, getClass, isAscendantPick } from '#shared/utils/hero-quest/content/classes'
import { GEAR_SLOTS, getGear, isGearId, isGearSlot } from '#shared/utils/hero-quest/content/gear'
import { isSkillId } from '#shared/utils/hero-quest/content/skills'
import { isArtifactId } from '#shared/utils/hero-quest/content/artifacts'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { ClassId, FormationRow } from '#shared/utils/hero-quest/types'

type HqStateRow = typeof hqState.$inferSelect

/** Every component optional — omitting one leaves the live value untouched. */
export interface LoadoutInput {
    championIds?: unknown
    formation?: unknown
    skillIds?: unknown
    artifactIds?: unknown
    gear?: unknown
    ascendantSkillIds?: unknown
}

/** The columns a validated loadout writes. Only the components actually supplied appear. */
export interface LoadoutWrites {
    partyChampionIds?: string[]
    formation?: Record<string, FormationRow>
    equippedSkillIds?: string[]
    equippedArtifactIds?: string[]
    equippedGear?: Record<string, string>
    ascendantSkillIds?: string[]
}

function asIdArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) {
        throw createError({ statusCode: 400, statusMessage: `${label} must be an array of ids` })
    }
    const ids = value as string[]
    // §5 of both the Skills and Artifacts docs: no duplicate slotting. Levelling the one copy you
    // own is how a single item gets stronger, not slotting it twice.
    if (new Set(ids).size !== ids.length) {
        throw createError({ statusCode: 400, statusMessage: `${label} cannot hold the same entry twice` })
    }
    return ids
}

/** Ownership check against `hqCollection` — the client's word is never taken for it. */
async function assertOwned(
    tx: DbExecutor,
    userId: string,
    system: GachaSystem,
    ids: readonly string[],
    label: string
) {
    if (ids.length === 0) return
    const owned = await tx.select({ contentId: hqCollection.contentId })
        .from(hqCollection)
        .where(and(
            eq(hqCollection.userId, userId),
            eq(hqCollection.system, system),
            inArray(hqCollection.contentId, ids as string[])
        ))
    if (owned.length !== ids.length) {
        throw createError({ statusCode: 400, statusMessage: `You do not own every ${label} in that loadout` })
    }
}

/**
 * Validate and normalise a loadout change, returning the columns to write.
 *
 * Takes the already-locked `state` rather than re-reading it: the caller holds the `hqState` row
 * lock, and a second read would be pointless at best and inconsistent at worst.
 */
export async function validateLiveLoadout(
    tx: DbExecutor,
    userId: string,
    state: HqStateRow,
    input: LoadoutInput,
    shopLevels: Record<string, number>
): Promise<LoadoutWrites> {
    const writes: LoadoutWrites = {}

    // ── Party ──────────────────────────────────────────
    let party = state.partyChampionIds as string[]
    if (input.championIds !== undefined) {
        const ids = asIdArray(input.championIds, 'championIds')
        for (const id of ids) {
            if (!isChampionId(id)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown Champion: ${id}` })
            }
        }
        const slots = championSlots(shopLevels)
        if (ids.length > slots) {
            throw createError({ statusCode: 400, statusMessage: `Only ${slots} Champion slots unlocked` })
        }
        await assertOwned(tx, userId, 'champion', ids, 'Champion')
        party = ids
        writes.partyChampionIds = ids
    }

    // ── Formation ──────────────────────────────────────
    if (input.formation !== undefined || input.championIds !== undefined) {
        const requested = (input.formation ?? state.formation ?? {}) as Record<string, unknown>
        const formation: Record<string, FormationRow> = {}
        for (const [key, value] of Object.entries(requested)) {
            if (value !== 'front' && value !== 'back') {
                throw createError({ statusCode: 400, statusMessage: `Invalid row for ${key}` })
            }
            // Only the Hero and fielded Champions have a position; anything else is stale state
            // from a previous party and is dropped rather than persisted forever.
            if (key === 'hero' || party.includes(key)) formation[key] = value
        }

        // Rows are capacities, not quotas (`classes-and-combat.md` §6): an empty front row is
        // legal, but neither row may exceed 3 across the whole party, Hero included.
        const rowOf = (id: string, fallback: FormationRow) => formation[id] ?? fallback
        const rows: FormationRow[] = [
            rowOf('hero', getClass(state.heroNodeId as ClassId).defaultRow),
            ...party.map(id => rowOf(id, getArchetype(getChampion(id).archetype).defaultRow))
        ]
        for (const row of ['front', 'back'] as const) {
            if (rows.filter(entry => entry === row).length > FORMATION_ROW_CAPACITY) {
                throw createError({
                    statusCode: 400,
                    statusMessage: `The ${row} row holds at most ${FORMATION_ROW_CAPACITY}`
                })
            }
        }
        writes.formation = formation
    }

    // ── Skills ─────────────────────────────────────────
    if (input.skillIds !== undefined) {
        const ids = asIdArray(input.skillIds, 'skillIds')
        for (const id of ids) {
            if (!isSkillId(id)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown Skill: ${id}` })
            }
        }
        const slots = skillSlots(shopLevels)
        if (ids.length > slots) {
            throw createError({ statusCode: 400, statusMessage: `Only ${slots} Skill slots unlocked` })
        }
        await assertOwned(tx, userId, 'skill', ids, 'Skill')
        writes.equippedSkillIds = ids
    }

    // ── Artifacts ──────────────────────────────────────
    if (input.artifactIds !== undefined) {
        const ids = asIdArray(input.artifactIds, 'artifactIds')
        for (const id of ids) {
            if (!isArtifactId(id)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown Artifact: ${id}` })
            }
        }
        const slots = artifactSlots(shopLevels)
        if (ids.length > slots) {
            throw createError({ statusCode: 400, statusMessage: `Only ${slots} Artifact slots unlocked` })
        }
        await assertOwned(tx, userId, 'artifact', ids, 'Artifact')
        writes.equippedArtifactIds = ids
    }

    // ── Gear ───────────────────────────────────────────
    if (input.gear !== undefined) {
        const requested = input.gear as Record<string, unknown>
        if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) {
            throw createError({ statusCode: 400, statusMessage: 'gear must be a slot → item map' })
        }

        const gear: Record<string, string> = {}
        for (const [slot, id] of Object.entries(requested)) {
            // A null clears the slot — the one way to un-equip without owning a replacement.
            if (id === null || id === undefined || id === '') continue
            if (!isGearSlot(slot)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown Gear slot: ${slot}` })
            }
            if (typeof id !== 'string' || !isGearId(id)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown Gear piece: ${String(id)}` })
            }
            // The piece has to belong to the slot it is being put in. Without this a client could
            // equip a Helmet in the Weapon slot and take a DEF bonus onto its PWR.
            if (getGear(id).slot !== slot) {
                throw createError({
                    statusCode: 400,
                    statusMessage: `${getGear(id).name} does not go in the ${slot} slot`
                })
            }
            gear[slot] = id
        }

        await assertOwned(tx, userId, 'gear', Object.values(gear), 'Gear piece')
        // No slot-count check: all six Forge slots are available from account start
        // (`gear-equipment.md` §1), the deliberate exception among the four gachas. The map is
        // rebuilt from `GEAR_SLOTS` so an unknown key can never survive into the column.
        writes.equippedGear = Object.fromEntries(
            GEAR_SLOTS.filter(slot => gear[slot]).map(slot => [slot, gear[slot]!])
        )
    }

    // ── The Ascendant's picks ──────────────────────────
    // Class skills, not owned items: a pick is legal once its class has been reached, which every
    // class has been by the time the Ascendant opens. Free to change at any time.
    if (input.ascendantSkillIds !== undefined) {
        const ids = asIdArray(input.ascendantSkillIds, 'ascendantSkillIds')
        if (ids.length > ASCENDANT_KIT_SIZE) {
            throw createError({ statusCode: 400, statusMessage: `The Ascendant picks at most ${ASCENDANT_KIT_SIZE} skills` })
        }
        const seen = new Set(state.seenNodeIds as string[])
        for (const id of ids) {
            if (!isAscendantPick(id)) {
                throw createError({ statusCode: 400, statusMessage: `Unknown class skill: ${id}` })
            }
            if (!seen.has(classOfSkill(id)!)) {
                throw createError({ statusCode: 400, statusMessage: `${getClass(classOfSkill(id)!).name} has not been reached yet` })
            }
        }
        writes.ascendantSkillIds = ids
    }

    return writes
}

/**
 * Rename a saved loadout, leaving what it holds alone (`loadouts.md` §2: player-named). Saving
 * re-snapshots the live state, so it cannot double as a rename. Returns the name written, or null
 * when the slot holds nothing to rename or the name is blank.
 */
export async function renameLoadout(tx: DbExecutor, userId: string, slotIndex: number, name: string): Promise<string | null> {
    const trimmed = name.trim().slice(0, LOADOUT_NAME_MAX_LENGTH)
    if (!trimmed) return null
    const [renamed] = await tx.update(hqLoadouts)
        .set({ name: trimmed, updatedAt: new Date() })
        .where(and(eq(hqLoadouts.userId, userId), eq(hqLoadouts.slotIndex, slotIndex)))
        .returning({ name: hqLoadouts.name })
    return renamed?.name ?? null
}
