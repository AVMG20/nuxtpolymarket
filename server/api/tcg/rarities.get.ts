import { sql } from 'drizzle-orm'
import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'

/**
 * The rarity reference (§5.2): per committed set, each tier's pool size and
 * real pull rate — straight from the imported thepricedex rows.
 */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const rows = await db.execute(sql`
        select s.id as set_id, s.name as set_name, s.code as set_code,
               coalesce(c.raw->'pullRate'->>'tier', c.rarity) as tier,
               count(distinct c.id)::int as pool,
               max((c.raw->'pullRate'->>'tierPerPack')::float) as per_pack,
               max((c.raw->'pullRate'->>'specificOneIn')::float) as one_in
        from tcg_cards c
        join tcg_sets s on s.id = c.set_id and s.status = 'committed'
        group by s.id, s.name, s.code, tier
        order by s.name
    `)
    const sets = new Map<string, { id: string, name: string, code: string, tiers: { tier: string | null, pool: number, perPack: number | null, oneIn: number | null }[] }>()
    for (const row of rows.rows as { set_id: string, set_name: string, set_code: string, tier: string | null, pool: number, per_pack: number | null, one_in: number | null }[]) {
        const entry = sets.get(row.set_id) ?? { id: row.set_id, name: row.set_name, code: row.set_code, tiers: [] }
        entry.tiers.push({ tier: row.tier, pool: row.pool, perPack: row.per_pack, oneIn: row.one_in })
        sets.set(row.set_id, entry)
    }
    return [...sets.values()]
})
