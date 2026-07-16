// Dev helper — generate a heavy deposit/withdraw history so the bank chart can
// be tested under load across the 1d/7d/30d ranges.
//
//   bun run scripts/seed-bank-history.ts                     test@gmail.com, 3000 actions over 40 days
//   bun run scripts/seed-bank-history.ts --email a@b.com
//   bun run scripts/seed-bank-history.ts --count 8000 --days 45
//   bun run scripts/seed-bank-history.ts --clear

import { eq } from 'drizzle-orm'
import { db } from '../server/database'
import { user, bankHistory } from '../server/database/schema'

const args = process.argv.slice(2)
const arg = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
    ?? (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)

const email = arg('email') ?? 'test@gmail.com'
const count = arg('count') ? parseInt(arg('count')!, 10) : 3000
const days = arg('days') ? parseInt(arg('days')!, 10) : 40
const clear = args.includes('--clear')
const CHUNK = 2000

function round(value: number) {
    return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

async function main() {
    const target = await db.query.user.findFirst({ where: eq(user.email, email) })
    if (!target) {
        console.error(`No user with email ${email}`)
        process.exit(1)
    }
    console.log(`Target user: ${target.email} (${target.id})`)

    if (clear) {
        await db.delete(bankHistory).where(eq(bankHistory.userId, target.id))
        console.log('Cleared existing bank history for this user')
    }

    const now = Date.now()
    const spanMs = days * 86_400_000
    const timestamps = Array.from({ length: count }, () => now - Math.floor(Math.random() * spanMs)).sort((a, b) => a - b)

    let balance = 0
    const rows = timestamps.map((ts) => {
        const deposit = balance <= 0 || Math.random() < 0.55
        const action = deposit ? 'deposit' : 'withdraw'
        const amount = deposit
            ? round(Math.random() * 250_000 + 1000)
            : round(Math.min(balance, Math.random() * balance))
        balance = round(deposit ? balance + amount : balance - amount)
        return {
            userId: target.id,
            balance: balance.toFixed(4),
            action,
            amount: amount.toFixed(4),
            createdAt: new Date(ts)
        }
    })

    for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(bankHistory).values(rows.slice(i, i + CHUNK))
        process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
    }
    process.stdout.write('\n')
    console.log(`Done. Seeded ${count} bank actions over ${days} days for ${target.email}.`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
}).finally(() => process.exit(0))
