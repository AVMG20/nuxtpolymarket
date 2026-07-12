// Dev helper — seed already-completed HackOps with forced rewards so the collect
// reveal modal can be exercised against specific loot/traits without grinding.
//
// A seeded op is an uncollected row that already carries a `reward` jsonb. The
// collect endpoint honors that reward (dev only) instead of re-rolling, so
// clicking "Collect" on /hack plays the real reveal with the outcome below.
//
// Run from the repo root so .env resolves:
//   bun run scripts/seed-hack-ops.ts                 seed for the default account
//   bun run scripts/seed-hack-ops.ts --email a@b.com target a specific user
//   bun run scripts/seed-hack-ops.ts --clear         remove existing seeded ops first
//   bun run scripts/seed-hack-ops.ts --clear-only    just remove seeded ops, no reseed

import { and, eq, isNotNull, asc } from 'drizzle-orm'
import { db } from '../server/database'
import { user, hackAgents, hackOps } from '../server/database/schema'
import {
  OP_TEMPLATES, generateItem, xpToNextLevel, AGENT_MAX_LEVEL,
  type OpReward, type HackRarity,
} from '../shared/utils/hack-config'

const args = process.argv.slice(2)
const emailArg = args.find(a => a.startsWith('--email='))?.split('=')[1]
  ?? (args.includes('--email') ? args[args.indexOf('--email') + 1] : undefined)
const email = emailArg ?? 'test@polynux.dev'
const clear = args.includes('--clear') || args.includes('--clear-only')
const clearOnly = args.includes('--clear-only')

type Scenario = {
  label: string
  templateId: string
  agents: number       // how many of the user's active agents to assign
  primeLevelUps: number // prime this many assigned agents to the brink of a level up
  reward: (rarity: (r: HackRarity) => OpReward['item']) => OpReward
}

// `rarity` builds a realistic item (full-range mods) for the given rarity.
const scenarios: Scenario[] = [
  {
    label: 'Phantom jackpot — cash + gems + phantom item + level up',
    templateId: 'project_zero', agents: 4, primeLevelUps: 1,
    reward: item => ({ success: true, cash: 2_400_000, gems: 5, item: item('phantom'), inventoryFull: false }),
  },
  {
    label: 'Specialist drop — cash + specialist item, two level ups',
    templateId: 'black_site', agents: 3, primeLevelUps: 2,
    reward: item => ({ success: true, cash: 410_000, gems: 0, item: item('specialist'), inventoryFull: false }),
  },
  {
    label: 'Elite drop lost — inventory-full warning path',
    templateId: 'quantum_heist', agents: 4, primeLevelUps: 0,
    reward: () => ({ success: true, cash: 980_000, gems: 3, item: null, inventoryFull: true }),
  },
  {
    label: 'Plain cash success — no gems, no gear',
    templateId: 'crypto_heist', agents: 2, primeLevelUps: 0,
    reward: () => ({ success: true, cash: 18_500, gems: 0, item: null, inventoryFull: false }),
  },
  {
    label: 'Failure — no loot, XP only',
    templateId: 'gov_heist', agents: 3, primeLevelUps: 0,
    reward: () => ({ success: false, cash: 0, gems: 0, item: null, inventoryFull: false }),
  },
]

async function main() {
  const account = await db.query.user.findFirst({ where: eq(user.email, email) })
  if (!account) throw new Error(`No user with email ${email}`)
  console.log(`Target account: ${account.name} <${account.email}> (${account.id})`)

  if (clear) {
    const removed = await db.delete(hackOps)
      .where(and(eq(hackOps.userId, account.id), eq(hackOps.collected, false), isNotNull(hackOps.reward)))
      .returning({ id: hackOps.id })
    console.log(`Cleared ${removed.length} previously-seeded op(s).`)
  }
  if (clearOnly) return

  const activeAgents = await db.query.hackAgents.findMany({
    where: and(eq(hackAgents.userId, account.id), eq(hackAgents.active, true)),
    orderBy: [asc(hackAgents.createdAt)],
  })
  if (activeAgents.length === 0) {
    console.warn('No active agents — ops will seed with an empty squad (xp/level-up scenarios need agents).')
  }

  for (const s of scenarios) {
    const template = OP_TEMPLATES.find(t => t.id === s.templateId)!
    const squad = activeAgents.slice(0, s.agents)
    const agentIds = squad.map(a => a.id)

    // Prime the front of the squad so the forced success tips them into a level up.
    for (const agent of squad.slice(0, s.primeLevelUps)) {
      if (agent.level >= AGENT_MAX_LEVEL) continue
      await db.update(hackAgents)
        .set({ xp: xpToNextLevel(agent.level) - 1 })
        .where(eq(hackAgents.id, agent.id))
    }

    const completesAt = new Date(Date.now() - 60 * 1000)
    const startedAt = new Date(completesAt.getTime() - template.durationMs)
    const [op] = await db.insert(hackOps).values({
      userId: account.id,
      templateId: s.templateId,
      agentIds,
      startedAt,
      completesAt,
      collected: false,
      reward: s.reward(generateItem),
    }).returning({ id: hackOps.id })

    console.log(`  seeded ${op!.id}  ${template.name.padEnd(16)} — ${s.label}`)
  }

  console.log('\nDone. Open /hack and collect the completed ops to play each reveal.')
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
