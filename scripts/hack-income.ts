// Gems and cash per hour across the op ladder, at each stage of progression.
// The property this exists to protect: gems/hour must climb monotonically with op
// tier, so the reason to run a harder op is that it pays better per hour — not just
// more per run. Re-run this after touching OP_TEMPLATES, MOD_RANGES,
// AGENT_TRAIT_RANGES or MIN_DEPLOY_SUCCESS.
import {
    OP_TEMPLATES,
    MOD_RANGES,
    AGENT_TRAIT_RANGES,
    RARITY_MOD_COUNT,
    AGENT_TRAIT_COUNT,
    MAX_ROSTER_SLOTS,
    MIN_DEPLOY_SUCCESS,
    collectBonuses,
    effectiveCashRange,
    effectiveGemRange,
    effectiveDurationMs,
    opSuccessChance,
    agentPower,
    type HackRarity,
    type AgentClass,
    type ModType,
    type AgentTraitType,
    type OpTemplate
} from '../shared/utils/hack-config'

type Profile = {
    name: string
    roster: number
    agentRarity: HackRarity
    agentLevel: number
    itemRarity: HackRarity
    itemLevel: number
    /** Where every roll lands in its band, 0-1. */
    quality: number
    classes: AgentClass[]
    modPriority: ModType[]
    traitPriority: AgentTraitType[]
}

function buildSquad(p: Profile, size: number) {
    const modCount = RARITY_MOD_COUNT[p.itemRarity]
    return Array.from({ length: size }, (_, i) => ({
        level: p.agentLevel,
        class: p.classes[i % p.classes.length]!,
        rarity: p.agentRarity,
        traits: p.traitPriority.slice(0, AGENT_TRAIT_COUNT[p.agentRarity]).map((t) => {
            const r = AGENT_TRAIT_RANGES[t]
            return { type: t, value: r.min + (r.max - r.min) * p.quality }
        }),
        items: [0, 1, 2].map(() => ({
            itemLevel: p.itemLevel,
            mods: p.modPriority.slice(0, modCount).map((t) => {
                const r = MOD_RANGES[t]
                return { type: t, value: r.min + (r.max - r.min) * p.quality }
            })
        }))
    }))
}

const PROFILES: Profile[] = [
    {
        name: 'Starter', roster: 2, agentRarity: 'ghost', agentLevel: 3,
        itemRarity: 'ghost', itemLevel: 1, quality: 0.5,
        classes: ['infiltrator', 'bruteforce'],
        modPriority: ['power_flat', 'speed_percent', 'loot_percent', 'gem_yield'],
        traitPriority: ['power_flat', 'speed_percent', 'loot_percent', 'gem_yield']
    },
    {
        name: 'Early', roster: 3, agentRarity: 'operative', agentLevel: 6,
        itemRarity: 'operative', itemLevel: 4, quality: 0.5,
        classes: ['infiltrator', 'bruteforce', 'cryptographer'],
        modPriority: ['power_flat', 'speed_percent', 'gem_yield', 'loot_percent'],
        traitPriority: ['power_flat', 'speed_percent', 'gem_yield', 'power_percent']
    },
    {
        name: 'Mid', roster: 4, agentRarity: 'specialist', agentLevel: 10,
        itemRarity: 'specialist', itemLevel: 8, quality: 0.5,
        classes: ['infiltrator', 'bruteforce', 'social_engineer', 'cryptographer'],
        modPriority: ['power_flat', 'speed_percent', 'gem_yield', 'loot_percent'],
        traitPriority: ['power_flat', 'speed_percent', 'gem_yield', 'power_percent']
    },
    {
        name: 'Late', roster: 6, agentRarity: 'elite', agentLevel: 16,
        itemRarity: 'elite', itemLevel: 14, quality: 0.75,
        classes: ['infiltrator', 'social_engineer', 'infiltrator', 'bruteforce'],
        modPriority: ['gem_yield', 'speed_percent', 'power_flat', 'loot_percent'],
        traitPriority: ['gem_yield', 'speed_percent', 'power_percent', 'power_flat']
    },
    {
        name: 'Maxed', roster: MAX_ROSTER_SLOTS, agentRarity: 'phantom', agentLevel: 20,
        itemRarity: 'phantom', itemLevel: 20, quality: 0.95,
        classes: ['infiltrator', 'social_engineer', 'infiltrator', 'social_engineer'],
        modPriority: ['gem_yield', 'speed_percent', 'power_flat', 'loot_percent', 'item_chance'],
        traitPriority: ['gem_yield', 'speed_percent', 'power_percent', 'power_flat', 'loot_percent']
    }
]

function rates(p: Profile, t: OpTemplate) {
    const size = Math.min(t.maxAgents, p.roster)
    if (size < t.minAgents) return null
    const agents = buildSquad(p, size)
    const bonuses = collectBonuses(agents)
    const power = agents.reduce((s, a) => s + agentPower(a, a.items, a.traits), 0)
    const success = opSuccessChance(power, t.minPower)
    if (success < MIN_DEPLOY_SUCCESS) return null

    const hours = effectiveDurationMs(t, agents) / 3_600_000
    // Ops occupy their whole squad, so the roster caps how many run at once. That
    // concurrency is why a per-squad rate flatters the 4-agent ops.
    const parallel = Math.floor(p.roster / size)

    const [gLo, gHi] = effectiveGemRange(t, bonuses)
    const gems = (success * t.baseGemChance * (gLo + gHi) / 2 / hours) * parallel
    const [cLo, cHi] = effectiveCashRange(t, bonuses)
    const cash = (success * (cLo + cHi) / 2 / hours) * parallel

    return { op: t.name, size, success, hours, gems, cash, yieldPct: bonuses.gemYield }
}

const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

let previousBest = 0
for (const p of PROFILES) {
    const rows = OP_TEMPLATES.map(t => rates(p, t)).filter(r => r !== null)
    const gemRows = rows.filter(r => r.gems > 0)
    console.log(`\n=== ${p.name} — roster ${p.roster} ===`)
    console.table(rows.map(r => ({
        op: r.op,
        agents: r.size,
        'success %': (r.success * 100).toFixed(0),
        hours: r.hours.toFixed(2),
        'gems/hr': r.gems.toFixed(3),
        'cash/hr': compact(r.cash)
    })))

    if (!gemRows.length) continue
    const best = gemRows.reduce((a, b) => (b.gems > a.gems ? b : a))
    const worst = gemRows.reduce((a, b) => (b.gems < a.gems ? b : a))
    console.log(`  squad gem yield: +${gemRows[0]!.yieldPct.toFixed(0)}% (at ${gemRows[0]!.size} agents)`)
    console.log(`  best gem op: ${best.op} at ${best.gems.toFixed(2)}/hr — ${(best.gems / worst.gems).toFixed(0)}x the worst deployable gem op`)

    // The whole point of the rebalance: the top op must be the best gem farm.
    const topDeployable = gemRows.at(-1)!
    if (topDeployable.op !== best.op) {
        console.log(`  WARNING: ${best.op} out-earns the highest deployable op (${topDeployable.op}) — the ladder is inverted here`)
    }
    if (best.gems < previousBest) {
        console.log(`  WARNING: peak gems/hr fell versus the previous stage (${best.gems.toFixed(2)} < ${previousBest.toFixed(2)})`)
    }
    previousBest = best.gems
}
