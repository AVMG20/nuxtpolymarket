import { eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { db } from '../server/database/index.ts'
import { user, account, hackState, hackAgents, hackArtifacts, hackItems, hackOps } from '../server/database/schema.ts'
import {
  AGENT_TRAIT_RANGES,
  RARITY_ORDER,
  OP_TEMPLATES,
  type AgentClass,
  type AgentTraitType,
  type HackRarity,
  type ArtifactRoll,
  type OpReward,
} from '../shared/utils/hack-config.ts'

const EMAIL = 'test@gmail.com'
const PASSWORD = 'password123'

const ALL_TRAIT_TYPES: AgentTraitType[] = [
  'gem_chance',
  'speed_percent',
  'loot_percent',
  'xp_boost',
  'power_flat',
  'power_percent',
  'gem_bonus',
]

function traitMid(type: AgentTraitType) {
  const range = AGENT_TRAIT_RANGES[type]
  return (range.min + range.max) / 2
}

async function main() {
  const existing = await db.query.user.findFirst({ where: eq(user.email, EMAIL) })
  if (existing) {
    await db.delete(hackItems).where(eq(hackItems.userId, existing.id))
    await db.delete(hackArtifacts).where(eq(hackArtifacts.userId, existing.id))
    await db.delete(hackAgents).where(eq(hackAgents.userId, existing.id))
    await db.delete(hackState).where(eq(hackState.userId, existing.id))
    await db.delete(account).where(eq(account.userId, existing.id))
    await db.delete(user).where(eq(user.id, existing.id))
    console.log('Removed existing test account')
  }

  const userId = crypto.randomUUID()
  const passwordHash = await hashPassword(PASSWORD)
  const now = new Date()

  await db.insert(user).values({
    id: userId,
    name: 'Test',
    email: EMAIL,
    emailVerified: true,
    image: null,
    balance: '1000000.0000',
    rake: '0.0000',
    rakebackUnlocked: true,
    gems: 5000,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(hackState).values({
    userId,
    rosterSlots: 6,
    totalOpsCompleted: 0,
    totalRecruits: 0,
    shopItems: [],
    shopRefreshAt: now,
  })

  const agent1Traits = ALL_TRAIT_TYPES.slice(0, 4).map(type => ({ type, value: traitMid(type) }))
  const agent2Traits = ALL_TRAIT_TYPES.slice(4, 7).map(type => ({ type, value: traitMid(type) }))

  const [a1, a2] = await db.insert(hackAgents).values([
    {
      userId,
      name: 'Cipher',
      class: 'cryptographer' as AgentClass,
      rarity: 'elite' as HackRarity,
      level: 10,
      xp: 0,
      traits: agent1Traits,
      active: true,
      createdAt: now,
    },
    {
      userId,
      name: 'Wraith',
      class: 'infiltrator' as AgentClass,
      rarity: 'phantom' as HackRarity,
      level: 5,
      xp: 0,
      traits: agent2Traits,
      active: true,
      createdAt: now,
    },
  ]).returning()

  const [tool] = await db.insert(hackItems).values({
    userId,
    name: 'Overclocked Deck',
    slot: 'tool',
    itemLevel: 5,
    rarity: 'specialist',
    mods: [{ type: 'power_flat', value: 15 }, { type: 'speed_percent', value: 5 }],
    equippedBy: a1.id,
    createdAt: now,
  }).returning()

  const [software] = await db.insert(hackItems).values({
    userId,
    name: 'Icebreaker',
    slot: 'software',
    itemLevel: 3,
    rarity: 'operative',
    mods: [{ type: 'loot_percent', value: 4 }, { type: 'gem_chance', value: 0.005 }],
    equippedBy: a1.id,
    createdAt: now,
  }).returning()

  const [hardware] = await db.insert(hackItems).values({
    userId,
    name: 'Neural Link',
    slot: 'hardware',
    itemLevel: 4,
    rarity: 'elite',
    mods: [{ type: 'xp_flat', value: 5 }, { type: 'power_flat', value: 10 }],
    equippedBy: a1.id,
    createdAt: now,
  }).returning()

  await db.update(hackAgents).set({
    equippedTool: tool.id,
    equippedSoftware: software.id,
    equippedHardware: hardware.id,
  }).where(eq(hackAgents.id, a1.id))

  const artifactRows: Array<{ userId: string; traitType: AgentTraitType; rarity: HackRarity; count: number; createdAt: Date }> = []
  for (const traitType of ALL_TRAIT_TYPES) {
    for (const rarity of RARITY_ORDER.slice(0, 4) as HackRarity[]) {
      artifactRows.push({
        userId,
        traitType,
        rarity,
        count: 1 + RARITY_ORDER.indexOf(rarity),
        createdAt: now,
      })
    }
  }
  await db.insert(hackArtifacts).values(artifactRows)

  // Pre-seed a few completed ops that are ready to collect in the UI.
  const opTemplates = [
    OP_TEMPLATES.find(t => t.id === 'corp_breach'),
    OP_TEMPLATES.find(t => t.id === 'dark_web'),
    OP_TEMPLATES.find(t => t.id === 'gov_heist'),
  ].filter(Boolean)

  const opRewards: OpReward[] = [
    {
      success: true,
      cash: 3_500,
      gems: 0,
      item: null,
      inventoryFull: false,
      artifacts: [
        { type: 'power_flat', rarity: 'operative', count: 1 } as ArtifactRoll,
      ]
    },
    {
      success: true,
      cash: 12_000,
      gems: 1,
      item: {
        name: 'Shim Router',
        slot: 'hardware',
        itemLevel: 1,
        rarity: 'ghost',
        mods: [{ type: 'speed_percent', value: 2 }, { type: 'loot_percent', value: 1 }]
      },
      inventoryFull: false,
      artifacts: [
        { type: 'loot_percent', rarity: 'specialist', count: 1 } as ArtifactRoll,
        { type: 'gem_chance', rarity: 'ghost', count: 2 } as ArtifactRoll,
      ]
    },
    {
      success: true,
      cash: 110_000,
      gems: 1,
      item: null,
      inventoryFull: false,
      artifacts: [
        { type: 'power_flat', rarity: 'elite', count: 1 } as ArtifactRoll,
        { type: 'xp_boost', rarity: 'operative', count: 1 } as ArtifactRoll,
        { type: 'speed_percent', rarity: 'specialist', count: 2 } as ArtifactRoll,
      ]
    },
  ]

  const opRows = opTemplates.map((template, i) => {
    const t = template!
    const durationMs = t.durationMs
    const completedAt = new Date(now.getTime() - 60 * 60 * 1000)
    const startedAt = new Date(completedAt.getTime() - durationMs)
    return {
      userId,
      templateId: t.id,
      agentIds: [a1.id, a2.id],
      startedAt,
      completesAt: completedAt,
      collected: false,
      reward: opRewards[i]! as unknown,
    }
  })
  await db.insert(hackOps).values(opRows)

  console.log(`Seeded test account: ${EMAIL} / ${PASSWORD}`)
  console.log(`User ID: ${userId}`)
  console.log(`Agents: ${a1.id}, ${a2.id}`)
  console.log(`Artifacts: ${artifactRows.length}`)
  console.log(`Ops ready to collect: ${opRows.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
}).finally(() => process.exit(0))
