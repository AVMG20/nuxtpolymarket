/**
 * Rough income model for the caravan game.
 *
 * Simulates an hour of play at each tier with a plausible loadout for that tier,
 * and prints coins/hour against what the tier's node purchases and gates cost.
 * The number to watch is "hours to next node": if it climbs past a session or
 * two, the tier wall is too steep.
 */
import { RESOURCES, TIERS, nodeCost, salePrice, tierRequirement } from '../shared/utils/caravan/config'
import { createRng } from '../shared/utils/caravan/rng'
import { advance, projectRates } from '../shared/utils/caravan/sim'
import { createInitialState } from '../shared/utils/caravan/state'
import { createWorker } from '../shared/utils/caravan/workers'
import { generateWorld } from '../shared/utils/caravan/world'

const NOW = Date.now()
const world = generateWorld()

function neighbours(id: number) {
    return world.edges
        .filter(e => e.a === id || e.b === id)
        .map(e => (e.a === id ? e.b : e.a))
}

/** Grow a territory outward from the capital until `count` nodes are held. */
function claim(count: number, maxTier: number): number[] {
    const owned = [0]
    const seen = new Set([0])
    while (owned.length < count) {
        const frontier = owned.flatMap(neighbours).filter((id) => {
            const node = world.nodes[id]!
            return !seen.has(id) && node.kind !== 'camp' && node.tier <= maxTier
        })
        if (!frontier.length) break
        // Push outward: always take the highest-tier node available, the way a
        // player racing to the next tier would.
        const next = frontier.sort((a, b) => world.nodes[b]!.tier - world.nodes[a]!.tier)[0]!
        seen.add(next)
        owned.push(next)
    }
    return owned
}

console.log('tier  workers  nodes   sell/hr (raw)   node cost   hrs/node   tier gate coins   hrs/gate')

for (const def of TIERS) {
    const tier = def.tier
    const workerCount = Math.min(3 + tier * 2, 16)
    const nodes = claim(2 + tier * 2, tier)

    const state = createInitialState('balance', NOW)
    state.tier = tier
    state.ownedNodes = nodes
    for (const id of world.nodes.filter(n => n.kind === 'camp' && n.tier <= tier).map(n => n.id)) {
        state.clearedCamps.push(id)
    }
    // Keep the larder full so the run measures throughput, not starvation.
    for (const t of TIERS) state.resources[t.provision] = 1_000_000

    const resourceNodes = nodes.filter(id => world.nodes[id]!.kind === 'resource')
    const rng = createRng(tier * 7919)
    for (let i = 0; i < workerCount; i++) {
        const worker = createWorker(rng, tier, NOW)
        worker.at = 0
        worker.assignment = resourceNodes[i % resourceNodes.length] ?? null
        state.workers.push(worker)
    }

    const rates = projectRates(state, world, 1800)
    advance(state, world, NOW + 3_600_000)

    // Everything hauled, sold raw: the floor on what an hour is worth.
    const coins = rates.harvestValuePerHour
    const cost = nodeCost(nodes.length)
    const gate = tierRequirement(tier)
    const hauled = Object.entries(state.resources)
        .filter(([id]) => RESOURCES[id]?.tier === tier && RESOURCES[id]?.kind === 'raw')
        .reduce((sum, [, n]) => sum + n, 0)

    console.log(
        `${String(tier).padEnd(5)} ${String(workerCount).padEnd(8)} ${String(nodes.length).padEnd(7)} `
        + `${coins.toFixed(0).padStart(12)} ${cost.toFixed(0).padStart(12)} ${(cost / coins).toFixed(1).padStart(9)} `
        + `${(gate?.coins ?? 0).toFixed(0).padStart(16)} ${gate ? (gate.coins / coins).toFixed(1).padStart(10) : '         -'}`
        + `   raw/hr ${hauled.toFixed(0)}  gems/day ${(rates.gemsPerHour * 24).toFixed(1)}`
    )
}

// --- gem seams --------------------------------------------------------------

/**
 * Gems are the scarce currency, so the only question that matters is how many a
 * day a player who has actually invested in the seams sees. Staff every seam the
 * player could reach at the given tier and measure it.
 */
console.log('\ntier  gem seams held   workers on them   gems / day')
{
    for (const def of TIERS) {
        const seams = world.nodes.filter(n => n.gemYield && n.tier <= def.tier)
        if (!seams.length) continue

        const state = createInitialState('gems', NOW)
        state.tier = def.tier
        state.ownedNodes = [0, ...seams.map(s => s.id)]
        for (const camp of world.nodes.filter(n => n.kind === 'camp')) state.clearedCamps.push(camp.id)
        // Reachability: own the whole map so the seams are actually connected.
        for (const node of world.nodes) {
            if (node.kind === 'resource' && !state.ownedNodes.includes(node.id)) state.ownedNodes.push(node.id)
            state.nodePriority[node.id] = seams.some(s => s.id === node.id) ? 5 : 0
        }
        for (const tier of TIERS) state.resources[tier.provision] = 1_000_000

        const workerCount = Math.min(3 + def.tier * 2, 16)
        const rng3 = createRng(def.tier * 131)
        for (let i = 0; i < workerCount; i++) {
            const worker = createWorker(rng3, def.tier, NOW)
            worker.at = 0
            state.workers.push(worker)
        }

        // Let the allocator place everyone before counting, otherwise the column
        // reports the state before anyone has been given a seam.
        advance(state, world, NOW + 600_000)
        const rates = projectRates(state, world, 7200)
        const staffed = state.workers.filter(w => w.assignment !== null).length
        console.log(
            `${String(def.tier).padEnd(5)} ${String(seams.length).padStart(9)}        ${String(staffed).padStart(9)}      `
            + `${(rates.gemsPerHour * 24).toFixed(1).padStart(10)}`
        )
    }
}

// --- combat ----------------------------------------------------------------

console.log('\ntier  camp power (min/max)   party power (cap workers, no gear)   with a tier weapon')
{
    const rng2 = createRng(4242)
    for (const def of TIERS) {
        const camps = world.nodes.filter(n => n.kind === 'camp' && n.tier === def.tier)
        if (!camps.length) continue
        const powers = camps.map(c => c.power ?? 0)
        // A realistic party: the research-capped worker count for that tier, all
        // hired at that tier, no gear, average level.
        const workerCount = Math.min(3 + def.tier * 2, 16)
        let bare = 0
        for (let i = 0; i < workerCount; i++) bare += createWorker(rng2, def.tier, NOW).base.strength * 16
        console.log(
            `${String(def.tier).padEnd(5)} ${String(Math.min(...powers)).padStart(6)} / ${String(Math.max(...powers)).padEnd(14)} `
            + `${bare.toFixed(0).padStart(10)} (${workerCount} workers)`.padEnd(36)
            + `${(bare * 2.1).toFixed(0).padStart(10)}`
        )
    }
}
