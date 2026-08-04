import { and, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { bankState, liveBlackjackWagers, transactions, user } from '#server/database/schema'
import { nextPrestigeTier, type PrestigeTier } from '#shared/utils/prestige'

/**
 * Tables that carry a `user_id` but must SURVIVE a prestige.
 *
 * The wipe works the other way round from a hand-maintained delete list: it
 * asks Postgres which tables have a `user_id` column and clears every one of
 * them. That way a new game's tables are wiped from the day they ship, with no
 * chance of someone adding a game and forgetting to update this file — the
 * failure mode is inverted into "a new table gets cleared when it maybe
 * shouldn't", which is loud and fixable, instead of "a new table silently
 * keeps progress across a reset", which is invisible.
 *
 * The price of that is this list. Anything added here is a deliberate decision
 * that the data is NOT game progress. Say why, every time.
 */
export const PRESTIGE_PRESERVED_TABLES = new Set([
    // Identity. Deleting these signs the player out or, for `account`, orphans
    // their OAuth link and locks them out of their own account permanently.
    'session',
    'account',
    // The coin ledger is an audit trail, not progress — it has to keep showing
    // what happened before the reset (including the prestige debit itself).
    'transactions',
    // Emblems are cosmetic and predate the run being reset. Losing your drawing
    // because you prestiged would be a punishment nobody asked for.
    'emblem_history',
    // Global chat is shared history. Deleting one player's messages would tear
    // holes in everyone else's scrollback.
    'chat_messages',
    'chat_mentions',
    // Assistant transcripts belong to the person, not the run.
    'ai_conversations',
    'ai_messages',
    // Live escrow for an in-flight blackjack round. Deleting an unsettled row
    // makes the recovery sweep drop a real refund on the floor — prestige
    // refuses to run while any exist instead (see prestigeBlockers).
    'live_blackjack_wagers'
])

const SAFE_TABLE_NAME = /^[a-z_][a-z0-9_]*$/

export interface PrestigeBlocker {
    code: 'loan' | 'live-wager'
    message: string
}

/**
 * Every table the wipe would clear, newest schema included. Exported so a test
 * can assert the preserve list still covers everything it is meant to.
 */
export async function prestigeWipeTables(ex: DbExecutor = db): Promise<string[]> {
    const result = await ex.execute<{ table_name: string }>(sql`
        select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and c.column_name = 'user_id'
        order by c.table_name
    `)

    return result.rows
        .map(row => row.table_name)
        .filter(name => !PRESTIGE_PRESERVED_TABLES.has(name) && SAFE_TABLE_NAME.test(name))
}

/**
 * Reasons this account cannot prestige right now. Both are cases where wiping
 * would either destroy money the server still owes the player or erase a debt
 * the player still owes the server.
 */
export async function prestigeBlockers(userId: string, ex: DbExecutor = db): Promise<PrestigeBlocker[]> {
    const blockers: PrestigeBlocker[] = []

    const [bank] = await ex.select({ loanPrincipal: bankState.loanPrincipal })
        .from(bankState)
        .where(eq(bankState.userId, userId))
    if (bank && parseFloat(bank.loanPrincipal) > 0) {
        blockers.push({
            code: 'loan',
            message: 'Repay your outstanding bank loan before prestiging — a reset would erase the debt, not settle it.'
        })
    }

    const [wager] = await ex.select({ id: liveBlackjackWagers.id })
        .from(liveBlackjackWagers)
        .where(and(eq(liveBlackjackWagers.userId, userId), eq(liveBlackjackWagers.settled, false)))
        .limit(1)
    if (wager) {
        blockers.push({
            code: 'live-wager',
            message: 'Finish your live blackjack round before prestiging — you still have chips on the table.'
        })
    }

    return blockers
}

export interface PrestigeResult {
    level: number
    /** Token balance after the ascent — the new tier's full allowance. */
    tokens: number
    /** Coins that went up in smoke — the tier price plus everything above it. */
    coinsBurned: string
    tablesCleared: string[]
}

/**
 * Ascend one prestige level: charge the tier, wipe the account back to zero and
 * pay out the tier's tokens.
 *
 * Everything runs inside one transaction that opens by taking a `FOR UPDATE`
 * lock on the user row, so a bet settling concurrently either lands entirely
 * before the wipe or entirely after it — never half either side. Every write
 * therefore has to go through `tx`; issuing one on a pool connection would
 * deadlock against the lock this transaction is already holding.
 */
export async function prestigeUser(userId: string): Promise<PrestigeResult> {
    return db.transaction(async (tx) => {
        // Lock first, read second. A balance read taken before the lock is
        // already stale by the time the wipe below acts on it.
        const [locked] = await tx.select({
            balance: user.balance,
            gems: user.gems,
            prestige: user.prestige,
            prestigeTokens: user.prestigeTokens
        })
            .from(user)
            .where(eq(user.id, userId))
            .for('update')
        if (!locked) throw createError({ statusCode: 404, statusMessage: 'User not found' })

        const tier = nextPrestigeTier(locked.prestige)
        if (!tier) throw createError({ statusCode: 400, statusMessage: 'You have already reached the highest prestige' })

        assertAffordable(locked.balance, locked.gems, tier)

        const blockers = await prestigeBlockers(userId, tx)
        if (blockers[0]) throw createError({ statusCode: 400, statusMessage: blockers[0].message })

        const tables = await prestigeWipeTables(tx)
        for (const table of tables) {
            await tx.execute(sql`delete from ${sql.identifier(table)} where user_id = ${userId}`)
        }

        // Fixed resets for the columns that live on the user row itself, which
        // the table scan can never reach. Balance, rake and gems all go to
        // zero — the tier price is a floor, not a fee.
        //
        // Tokens are SET to the tier's allowance, not added to it: 5/10/15/20
        // is what you hold at each tier, so the ceiling is 20. Because the wipe
        // above already deleted every shop perk the previous run's tokens paid
        // for, setting the balance here is also the refund for them.
        const [updated] = await tx.update(user)
            .set({
                balance: '0',
                rake: '0',
                gems: 0,
                prestige: locked.prestige + 1,
                prestigeTokens: tier.tokens
            })
            .where(and(eq(user.id, userId), eq(user.prestige, locked.prestige)))
            .returning({ prestige: user.prestige, prestigeTokens: user.prestigeTokens })
        if (!updated) throw createError({ statusCode: 409, statusMessage: 'Prestige already in progress' })

        // The ledger has to account for the whole balance, not just the tier
        // price, or the transaction history stops reconciling with the wallet.
        if (parseFloat(locked.balance) > 0) {
            await tx.insert(transactions).values({
                userId,
                amount: locked.balance,
                type: 'debit',
                category: `prestige:${tier.level}`
            })
        }

        return {
            level: updated.prestige,
            tokens: updated.prestigeTokens,
            coinsBurned: locked.balance,
            tablesCleared: tables
        }
    })
}

function assertAffordable(balance: string, gems: number, tier: PrestigeTier) {
    if (parseFloat(balance) < tier.coinCost) {
        throw createError({ statusCode: 400, statusMessage: `Prestige ${tier.roman} needs ${tier.coinCost.toLocaleString('en-US')} coins` })
    }
    if (gems < tier.gemCost) {
        throw createError({ statusCode: 400, statusMessage: `Prestige ${tier.roman} needs ${tier.gemCost.toLocaleString('en-US')} gems` })
    }
}
