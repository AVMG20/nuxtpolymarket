// Dev helper — flood a user with fake transactions so the Analytics page can be
// exercised under realistic load. Only writes `transactions` rows; it does not
// touch the user's balance (the analytics page reads transactions, not balance).
//
// Run from the repo root so .env resolves:
//   bun run scripts/seed-transactions.ts                        first user, 15000 rows today
//   bun run scripts/seed-transactions.ts --email a@b.com        target a specific user
//   bun run scripts/seed-transactions.ts --count 30000          today's row count
//   bun run scripts/seed-transactions.ts --clear                delete the user's rows first

import { eq, sql } from 'drizzle-orm'
import { db } from '../server/database'
import { user, transactions } from '../server/database/schema'

const args = process.argv.slice(2)
const emailArg = args.find(a => a.startsWith('--email='))?.split('=')[1]
    ?? (args.includes('--email') ? args[args.indexOf('--email') + 1] : undefined)
const countArg = args.find(a => a.startsWith('--count='))?.split('=')[1]
    ?? (args.includes('--count') ? args[args.indexOf('--count') + 1] : undefined)
const clear = args.includes('--clear')

const TODAY_COUNT = countArg ? parseInt(countArg, 10) : 15000
const PRIOR_DAY_COUNT = 400
const CHUNK = 2000

const CATEGORIES = ['pirates', 'blackjack', 'colony', 'miner', 'HackOps', 'xeno', 'lootbox', 'rakeback', 'gems', null]

function randomAmount() {
    // Skewed toward small stakes with the occasional big swing.
    const base = Math.random() < 0.9 ? Math.random() * 500 : Math.random() * 50000
    return (base + 0.01).toFixed(4)
}

function makeRow(userId: string, createdAt: Date) {
    return {
        userId,
        amount: randomAmount(),
        type: Math.random() < 0.5 ? 'credit' : 'debit',
        category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
        createdAt
    }
}

async function insertChunked(rows: ReturnType<typeof makeRow>[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(transactions).values(rows.slice(i, i + CHUNK))
        process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
    }
    process.stdout.write('\n')
}

async function main() {
    const target = emailArg
        ? await db.query.user.findFirst({ where: eq(user.email, emailArg) })
        : await db.query.user.findFirst()

    if (!target) {
        console.error(emailArg ? `No user with email ${emailArg}` : 'No users in the database')
        process.exit(1)
    }

    console.log(`Target user: ${target.email} (${target.id})`)

    if (clear) {
        await db.delete(transactions).where(eq(transactions.userId, target.id))
        console.log('Cleared existing transactions for this user')
    }

    const now = Date.now()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const sinceMidnight = now - todayStart.getTime()

    console.log(`Seeding ${TODAY_COUNT} transactions across today...`)
    const todayRows = Array.from({ length: TODAY_COUNT }, () =>
        makeRow(target.id, new Date(todayStart.getTime() + Math.floor(Math.random() * sinceMidnight)))
    )
    await insertChunked(todayRows)

    for (const daysAgo of [1, 2]) {
        const dayStart = new Date(todayStart)
        dayStart.setDate(dayStart.getDate() - daysAgo)
        console.log(`Seeding ${PRIOR_DAY_COUNT} transactions for ${daysAgo} day(s) ago...`)
        const rows = Array.from({ length: PRIOR_DAY_COUNT }, () =>
            makeRow(target.id, new Date(dayStart.getTime() + Math.floor(Math.random() * 86400000)))
        )
        await insertChunked(rows)
    }

    const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(eq(transactions.userId, target.id))

    console.log(`Done. ${target.email} now has ${total} transactions total.`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
}).finally(() => process.exit(0))
