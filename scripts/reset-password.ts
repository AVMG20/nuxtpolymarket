/**
 * One-off: reset a local dev account's password through better-auth's own
 * hasher, so the stored hash matches what the login flow expects.
 *
 *   bun run scripts/reset-password.ts <email>
 *
 * The new password is read from the NEW_PASSWORD env var if set, otherwise
 * prompted on stdin. Run it yourself in a terminal — don't paste passwords
 * into anything else.
 */
import { eq } from 'drizzle-orm'
import { auth } from '../server/utils/auth'
import { db } from '../server/database'
import { user, account } from '../server/database/schema'

const email = process.argv[2]
if (!email) {
    console.error('usage: bun run scripts/reset-password.ts <email>')
    process.exit(1)
}

async function readPassword(): Promise<string> {
    if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD
    process.stdout.write(`New password for ${email}: `)
    for await (const line of console) {
        return line.trim()
    }
    return ''
}

const newPassword = await readPassword()
if (newPassword.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
}

const [target] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email))
if (!target) {
    console.error(`No user with email ${email}`)
    process.exit(1)
}

const [credential] = await db.select({ id: account.id }).from(account)
    .where(eq(account.userId, target.id))
if (!credential) {
    console.error(`${email} has no credential account row — was it created via a social provider?`)
    process.exit(1)
}

// better-auth's own scrypt hasher + adapter, so the format is exactly what
// the sign-in flow verifies against.
const ctx = await auth.$context
const hash = await ctx.password.hash(newPassword)
await ctx.internalAdapter.updatePassword(target.id, hash)

console.log(`Password updated for ${target.name} <${email}>.`)
process.exit(0)
