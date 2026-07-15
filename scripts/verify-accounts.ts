import { db } from '../server/database/index.ts'
import { user } from '../server/database/schema.ts'

async function main() {
  const users = await db.select({ id: user.id, email: user.email, name: user.name }).from(user)
  console.log(`Total users in database: ${users.length}`)
  for (const u of users) {
    console.log(`- ${u.email} (${u.name})`)
  }
}

main().catch(err => { console.error(err); process.exit(1) }).finally(() => process.exit(0))
