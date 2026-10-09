import { and, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import {
    SEAL_COLUMN,
    SEAL_NAME,
    buyLadderSeals,
    claimFreePull,
    essenceBalance,
    essenceGain,
    lockLiveLoadout,
    sealBalance,
    sealSpend,
    settleHq,
    type HqStateRow
} from '#server/utils/hero-quest'
import {
    applyDupes,
    applyPulls,
    isGachaSystem,
    newEntry,
    pullCost,
    rarityFromRoll,
    type CollectionEntry,
    type GachaSystem
} from '#shared/utils/hero-quest/gacha'
import { gachaContent } from '#shared/utils/hero-quest/content/registry'
import { autoEquipFirstPieces, isGearId } from '#shared/utils/hero-quest/content/gear'
import { TEN_PULL_SIZE } from '#shared/utils/hero-quest/constants'
import { randomFloat } from '#shared/utils/random'
import type { Rarity } from '#shared/utils/hero-quest/types'

interface PullRecord {
    contentId: string
    name: string
    rarity: Rarity
    /** True the first time this item is ever obtained. */
    isNew: boolean
    /** Star/level after this pull landed, so the client can show the copy's new state. */
    star: number
    level: number
    /** Essence produced, non-zero only when the copy was already 5★ Lv10. */
    essence: number
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Pay for a pull with Seals. **Claim-then-reward** — the conditional debit *is* the mutex.
 *
 * The balance is decremented with a `WHERE <seals> >= cost`, so if no row comes back the request
 * throws before a single die is rolled. Ten parallel pulls against one Seal: one wins, nine 400.
 */
async function claimWithSeals(tx: Tx, userId: string, system: GachaSystem, seals: number): Promise<HqStateRow> {
    const [claimed] = await tx.update(hqState)
        .set(sealSpend(system, seals))
        .where(and(
            eq(hqState.userId, userId),
            sql`${SEAL_COLUMN[system]} >= ${seals}`
        ))
        .returning()

    if (!claimed) {
        throw createError({ statusCode: 400, statusMessage: `Not enough ${SEAL_NAME[system]}` })
    }
    return claimed
}

/**
 * Pull from any of the four gachas — `system` in the body (`tech-architecture.md` §5).
 *
 * **One route, not four.** `gacha-shared-system.md` makes the four deliberately parallel — one
 * rarity ladder, one levelling curve, one drop table, one dupe formula — so the machinery is
 * written once and takes `system` as an argument. Only two things genuinely differ per system: which content module resolves a roll,
 * and which two columns hold the balances. `content/registry.ts` covers the first and
 * `SEAL_COLUMN` / `ESSENCE_COLUMN` in the domain layer cover the second, so everything below is
 * identical for all four by construction rather than by four files staying in sync.
 *
 * ## Two ways to pay, one way to pull
 *
 * `free: true` spends one of the day's free 10-pull entitlements instead of Seals. Everything
 * after the payment is byte-identical — same rarity roll, same dupe merge, same level bump, same
 * auto-equip — because a free pull *is* a pull and only the payment differs. That is why this is
 * a branch inside one route rather than a second route: two routes would mean two copies of the
 * roll loop.
 *
 * ## Why the whole thing sits inside one transaction
 *
 * A pull reads a balance, reads the gacha level, rolls an outcome, and writes three different
 * things (currency, gacha level/progress, collection rows). Every one of those is a
 * read-then-write, which is the exact shape the platform guidance calls "always a bug" — ten
 * parallel pulls would otherwise all read the same balance, all pass the check, and all pay out.
 *
 * **The payment is the guard, and the two paths guard differently** — see `claimWithSeals`
 * (claim-then-reward, the conditional debit is the mutex) and `claimFreePull` (lock-then-read,
 * because availability is three coupled values and one of them is a timestamp). Either way,
 * nothing downstream runs for a request that did not win the payment.
 *
 * ## Buying the Seals it is short
 *
 * `autoBuy: { maxGold }` makes a Seal pull buy whatever Seals it is short off the day's Gold ladder
 * first, in this same transaction and under the same row lock, so Seals are never bought for a pull
 * that then fails. `maxGold` is the Gold price the button showed; a ladder that moved since (another
 * purchase, the daily reset) is refused rather than charged.
 *
 * ## Randomness
 *
 * `randomFloat` from the platform CSPRNG, never `Math.random()`: this decides a real payout.
 * Rarity comes from the drop table, then the specific item is a uniform pick within that rarity —
 * the two-step the drop table implies (it weights rarities, not individual items).
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'gacha')
    const body = await readBody<{ system?: string; count?: number; free?: boolean; autoBuy?: { maxGold?: number } }>(event)

    const system = body?.system
    if (typeof system !== 'string' || !isGachaSystem(system)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown gacha' })
    }
    const content = gachaContent(system)
    // A free pull is always the full ten — the entitlement exists for the 10-pull moment, and
    // letting it be spent as a single would quietly make it worth a ninth of itself.
    const free = body?.free === true
    const requested = free || body?.count === TEN_PULL_SIZE ? TEN_PULL_SIZE : 1
    const cost = pullCost(requested)
    const maxGold = Number(body?.autoBuy?.maxGold)
    const autoBuy = !free && body?.autoBuy !== undefined
    if (autoBuy && !(Number.isFinite(maxGold) && maxGold >= 0)) {
        throw createError({ statusCode: 400, statusMessage: 'An auto-buy needs the price it was shown' })
    }

    // Bank progress first so the pull can't be used to dodge a settle, and so the Seals a
    // milestone just granted are visible to this request.
    await settleHq(userId)

    return db.transaction(async (tx) => {
        if (autoBuy) {
            // lock-then-read: the shortfall and the day's ladder counter are read under the row lock
            const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
            if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
            const short = cost.seals - sealBalance(state, system)
            if (short > 0) await buyLadderSeals(tx, userId, state, system, short, maxGold)
        }
        const claimed = free
            ? await claimFreePull(tx, userId, system)
            : await claimWithSeals(tx, userId, system, cost.seals)

        const levels = claimed.gachaLevels as Record<string, number>
        const progress = claimed.gachaProgress as Record<string, number>
        const gachaLevel = levels[system] ?? 1

        // Every copy the player already owns of this system, keyed for in-loop merging — a
        // 10-pull can hit the same item twice and the second copy must see the first's result.
        const existing = await tx.select().from(hqCollection)
            .where(and(eq(hqCollection.userId, userId), eq(hqCollection.system, system)))
        const entries = new Map<string, CollectionEntry>(
            existing.map(row => [row.contentId, { star: row.star, level: row.level, dupeProgress: row.dupeProgress }])
        )

        const pulls: PullRecord[] = []
        let essenceGained = 0

        for (let index = 0; index < cost.pulls; index++) {
            // Rarity from the level's drop table, then a uniform pick inside it. Every roster
            // populates every rarity, so a rolled rarity is the rarity paid out.
            const rarity = rarityFromRoll(gachaLevel, randomFloat())
            const definition = content.fromRoll(rarity, randomFloat())

            const before = entries.get(definition.id)
            const isNew = before === undefined
            let entry = before ?? newEntry()
            let essence = 0

            if (!isNew) {
                const outcome = applyDupes(entry, 1, definition.rarity)
                entry = outcome.entry
                essence = outcome.essenceGained
                essenceGained += essence
            }

            entries.set(definition.id, entry)
            pulls.push({
                contentId: definition.id,
                name: definition.name,
                rarity: definition.rarity,
                isNew,
                star: entry.star,
                level: entry.level,
                essence
            })
        }

        // One upsert per distinct item *touched*, not one per pull — a 10-pull that hits the
        // same item three times writes its final merged state once, and copies this pull never
        // saw are not rewritten at all.
        for (const contentId of new Set(pulls.map(pull => pull.contentId))) {
            const entry = entries.get(contentId)!
            await tx.insert(hqCollection)
                .values({ userId, system, contentId, ...entry })
                .onConflictDoUpdate({
                    target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                    set: { star: entry.star, level: entry.level, dupeProgress: entry.dupeProgress }
                })
        }

        // Leveling counts pulls granted, not Seals spent — which is the whole point of the
        // 10-pull discount (`gacha-shared-system.md` §4).
        const advanced = applyPulls(gachaLevel, progress[system] ?? 0, cost.pulls)

        /**
         * Gear only: the first piece ever owned for a slot auto-equips (`gear-equipment.md` §3) —
         * "no reason to leave a brand-new slot empty when there's only one option to begin with".
         * It never *replaces* a choice the player has made, however weak; past the first piece,
         * swapping is always a manual tap.
         */
        const autoEquipped = system === 'gear'
            ? autoEquipFirstPieces(
                [...entries].filter(([id]) => isGearId(id))
                    .map(([contentId, entry]) => ({ contentId, star: entry.star, level: entry.level })),
                // on the player's own loadout: a raid's preferred one still live goes back first (`loadouts.md` §4)
                (await lockLiveLoadout(tx, userId)).equippedGear as Record<string, string>
            )
            : null

        const [updated] = await tx.update(hqState)
            .set({
                gachaLevels: { ...levels, [system]: advanced.level },
                gachaProgress: { ...progress, [system]: advanced.progress },
                ...essenceGain(system, essenceGained),
                ...(autoEquipped ? { equippedGear: autoEquipped } : {})
            })
            .where(eq(hqState.userId, userId))
            .returning()

        const after = updated ?? claimed
        return {
            system,
            pulls,
            /** True when this came out of the daily entitlement rather than the Seal balance. */
            free,
            sealsSpent: free ? 0 : cost.seals,
            seals: sealBalance(after, system),
            essence: essenceBalance(after, system),
            gachaLevel: advanced.level,
            gachaProgress: advanced.progress,
            essenceGained
        }
    })
})
