import { describe, it, expect } from 'vitest'
import {
    OP_TEMPLATES,
    MOD_RANGES,
    AGENT_TRAIT_RANGES,
    RARITY_MOD_COUNT,
    AGENT_TRAIT_COUNT,
    MAX_ROSTER_SLOTS,
    collectBonuses,
    effectiveGemRange,
    effectiveDurationMs,
    type AgentClass,
    type ModType,
    type AgentTraitType,
    type OpTemplate
} from '../../shared/utils/hack-config'

// A fully-invested squad: max level, max item level, near-perfect rolls, and both
// mod and trait slots spent on gems. This is the build that farms whatever op pays
// best, so it is the one the ladder has to hold up under.
const MOD_PRIORITY: ModType[] = ['gem_yield', 'speed_percent', 'power_flat', 'loot_percent', 'item_chance']
const TRAIT_PRIORITY: AgentTraitType[] = ['gem_yield', 'speed_percent', 'power_percent', 'power_flat', 'loot_percent']
const CLASSES: AgentClass[] = ['infiltrator', 'social_engineer', 'infiltrator', 'social_engineer']
const QUALITY = 0.95

function maxedSquad(size: number) {
    return Array.from({ length: size }, (_, i) => ({
        level: 20,
        class: CLASSES[i % CLASSES.length]!,
        rarity: 'phantom' as const,
        traits: TRAIT_PRIORITY.slice(0, AGENT_TRAIT_COUNT.phantom).map((t) => {
            const r = AGENT_TRAIT_RANGES[t]
            return { type: t, value: r.min + (r.max - r.min) * QUALITY }
        }),
        items: [0, 1, 2].map(() => ({
            itemLevel: 20,
            mods: MOD_PRIORITY.slice(0, RARITY_MOD_COUNT.phantom).map((t) => {
                const r = MOD_RANGES[t]
                return { type: t, value: r.min + (r.max - r.min) * QUALITY }
            })
        }))
    }))
}

/**
 * Expected gems per hour across the whole roster: an op ties up its entire squad, so
 * the roster caps how many run concurrently. Ignoring that concurrency flatters the
 * 4-agent ops, which is exactly the mistake that has to stay caught.
 */
function gemsPerHour(t: OpTemplate, roster = MAX_ROSTER_SLOTS): number {
    const size = Math.min(t.maxAgents, roster)
    const agents = maxedSquad(size)
    const [lo, hi] = effectiveGemRange(t, collectBonuses(agents))
    const hours = effectiveDurationMs(t, agents) / 3_600_000
    const parallel = Math.floor(roster / size)
    return (t.baseGemChance * ((lo + hi) / 2) / hours) * parallel
}

describe('gem ladder', () => {
    const gemOps = OP_TEMPLATES.filter(t => t.baseGemChance > 0)

    it('pays strictly more gems per hour the further up the ladder you go', () => {
        // The whole point of the rebalance. A flat squad bonus divided by duration
        // makes the SHORTEST op the best gem farm, which is what this prevents from
        // creeping back in: any additive gem bonus reintroduces that inversion.
        const rates = gemOps.map(t => ({ op: t.id, rate: gemsPerHour(t) }))
        for (let i = 1; i < rates.length; i++) {
            expect(rates[i]!.rate, `${rates[i]!.op} must beat ${rates[i - 1]!.op}`)
                .toBeGreaterThan(rates[i - 1]!.rate)
        }
    })

    it('makes the final op worth many times the first gem op', () => {
        const first = gemsPerHour(gemOps[0]!)
        const last = gemsPerHour(gemOps.at(-1)!)
        expect(last / first).toBeGreaterThan(100)
    })

    it('scales gems with squad investment rather than handing them out flat', () => {
        // An ungeared squad earns the op's listed gems; gear multiplies that. If gems
        // ever stop scaling with investment, maxing a roster stops paying for itself.
        const op = OP_TEMPLATES.find(t => t.id === 'project_zero')!
        const bare = collectBonuses(
            Array.from({ length: 4 }, () => ({ level: 1, class: 'bruteforce' as AgentClass, items: [] }))
        )
        expect(effectiveGemRange(op, bare)).toEqual(op.baseGemCount)
        expect(effectiveGemRange(op, collectBonuses(maxedSquad(4)))[0])
            .toBeGreaterThan(op.baseGemCount[0] * 3)
    })

    it('never lets gear influence an op gem drop chance', () => {
        // Chance belongs to the op alone — that is what preserves the 0.2%-to-80%
        // spread. Gear folding into the chance compresses the ladder into a flat band.
        const maxed = collectBonuses(maxedSquad(4))
        expect(maxed).not.toHaveProperty('gemChance')
        expect(gemOps.map(t => t.baseGemChance)).toEqual([...gemOps.map(t => t.baseGemChance)].sort((a, b) => a - b))
    })
})
