/**
 * Prestige clears progress by asking Postgres which tables carry a `user_id`
 * and wiping every one of them, minus an explicit preserve list. These tests
 * pin each side of that bargain:
 *
 *   - the scan actually reaches the game tables (so a new game is wiped from
 *     the day it ships, with nobody having to remember to add it), and
 *   - the preserve list still covers identity and history (so nobody's OAuth
 *     link or chat scrollback disappears because a table got renamed), and
 *   - the `tcg_` prefix exemption holds for every card table, present and
 *     future, because a collection is property rather than run progress.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { PRESTIGE_PRESERVED_PREFIXES, PRESTIGE_PRESERVED_TABLES, isPrestigePreserved, prestigeWipeTables } from '#server/utils/prestige'
import { SKIP } from '../setup/db-helpers'

describe.skipIf(SKIP)('prestige wipe scan', () => {
    afterAll(async () => { await db.$client.end() })

    it('clears the game tables it is supposed to clear', async () => {
        const tables = await prestigeWipeTables()

        // One representative table per game plus the shared economy surfaces —
        // if any of these stops being wiped, progress survives a reset.
        expect(tables).toEqual(expect.arrayContaining([
            'bank_state',
            'colony_bugs',
            'firewall_state',
            'gem_orders',
            'hack_agents',
            'miner_state',
            'pathwarden_state',
            'pirate_state',
            'shapezz_state',
            'xeno_plants'
        ]))
    })

    it('never clears identity or history tables', async () => {
        const tables = await prestigeWipeTables()

        for (const preserved of PRESTIGE_PRESERVED_TABLES) {
            expect(tables).not.toContain(preserved)
        }
        // Spelled out separately from the loop above: these are the ones where
        // a wipe is not "lost progress" but a locked-out account or a hole in
        // everyone else's chat.
        expect(tables).not.toContain('account')
        expect(tables).not.toContain('session')
        expect(tables).not.toContain('chat_messages')
        expect(tables).not.toContain('transactions')
    })

    it('never clears a card table', async () => {
        const tables = await prestigeWipeTables()

        // Named individually rather than asserted by prefix: these are the
        // eight card tables that DO carry a `user_id`, so they are exactly the
        // ones the scan would reach if the exemption regressed. The rest of
        // the TCG schema hangs off `owner_id`/`seller_id` and was never in
        // range to begin with.
        for (const table of [
            'tcg_allowances',
            'tcg_battler_decks',
            'tcg_battler_ratings',
            'tcg_battler_runs',
            'tcg_battler_snapshots',
            'tcg_buy_orders',
            'tcg_displays',
            'tcg_submissions'
        ]) {
            expect(tables).not.toContain(table)
        }
        expect(tables.filter(name => name.startsWith('tcg_'))).toEqual([])
    })

    it('exempts card tables that do not exist yet', async () => {
        // The point of the prefix rule: someone ships tcg_whatever next month
        // and it survives without anyone editing the preserve list.
        expect(isPrestigePreserved('tcg_a_table_nobody_has_written_yet')).toBe(true)
        expect(isPrestigePreserved('miner_state')).toBe(false)
        // The prefix must not be so broad it swallows another game's tables.
        for (const prefix of PRESTIGE_PRESERVED_PREFIXES) {
            expect(prefix).toMatch(/^[a-z][a-z0-9]*_$/)
        }
    })

    it('only returns real, plainly-named tables', async () => {
        const tables = await prestigeWipeTables()

        expect(tables.length).toBeGreaterThan(0)
        for (const table of tables) {
            expect(table).toMatch(/^[a-z_][a-z0-9_]*$/)
        }
        expect(new Set(tables).size).toBe(tables.length)
    })
})
