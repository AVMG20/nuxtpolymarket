/**
 * Creates (or tops up) the accounts used to play-test the live table. Sign-up
 * goes through the running app's auth endpoint so passwords hash the same way a
 * real registration does; only the balance is set directly.
 *
 *   bun scripts/live-blackjack-testers.ts [--base http://localhost:3000] [--balance 5000000]
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '../server/database'
import { user } from '../server/database/schema'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}

const BASE = flag('base', 'http://localhost:3000')
const BALANCE = flag('balance', '5000000')
const PASSWORD = 'blackjack-test-42'

const NAMED = ['Ramon', 'Mila', 'Dex', 'Ines', 'Kwan', 'Vera']
const POOL_NAMES = [
    'Nova', 'Silas', 'Juno', 'Rafi', 'Wren', 'Otto', 'Lark', 'Bex', 'Cyra', 'Ivo',
    'Suki', 'Tobin', 'Vale', 'Rhea', 'Milo', 'Zaya', 'Enzo', 'Fable', 'Kit', 'Onyx'
]

/** Named seats for hand testing, plus a numbered pool so parallel play-test runs never share an account. */
const TESTERS = [
    ...NAMED.map(name => ({ email: `${name === 'Ramon' ? 'ramon-table' : `bot-${name.toLowerCase()}`}@polynux.test`, name })),
    ...POOL_NAMES.map((name, i) => ({
        email: `lb-bot-${String(i + 1).padStart(2, '0')}@polynux.test`,
        name
    }))
]

async function ensure(email: string, name: string) {
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, name })
    })
    if (res.ok) return 'created'
    const body = await res.text()
    // Already registered from a previous run — the password is unchanged.
    if (body.includes('already exists') || body.includes('USER_ALREADY_EXISTS')) return 'existing'
    throw new Error(`sign-up failed for ${email} (${res.status}): ${body}`)
}

for (const tester of TESTERS) {
    const status = await ensure(tester.email, tester.name)
    await db.update(user).set({ balance: BALANCE }).where(eq(user.email, tester.email))
    console.log(`${status.padEnd(8)} ${tester.email}  balance=${BALANCE}`)
}

const rows = await db
    .select({ email: user.email, name: user.name, balance: user.balance })
    .from(user)
    .where(inArray(user.email, TESTERS.map(t => t.email)))

console.log('\npassword for all test accounts:', PASSWORD)
console.table(rows)
process.exit(0)
