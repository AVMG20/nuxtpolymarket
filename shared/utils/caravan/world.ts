import { RESOURCES, TIERS } from './config'
import { seededRng } from './rng'
import type { EdgeId, NodeId, World, WorldEdge, WorldNode } from './types'

/**
 * Procedural world generation from a single global seed -- every player walks
 * the same map, so routes and node names mean the same thing to everybody.
 *
 * The world is a set of concentric tier rings. The capital sits at the origin,
 * tier 1 nodes ring it closely, and each tier pushes further out. Camps sit on
 * the boundaries between rings and gate access to everything past them, which
 * is what makes combat a progression wall rather than a side activity.
 */

export const WORLD_SEED = 0x43415241 // "CARA"

const PREFIX = [
    'Ash', 'Bram', 'Cold', 'Dun', 'Ever', 'Fen', 'Grim', 'Hollow', 'Iron', 'Kel',
    'Lorn', 'Mist', 'North', 'Oak', 'Pale', 'Quarry', 'Red', 'Stone', 'Thorn',
    'Umber', 'Vale', 'West', 'Wyrm', 'Yarrow', 'Gloom', 'Marrow', 'Salt', 'Storm'
]
const SUFFIX = [
    'ford', 'hollow', 'reach', 'gate', 'moor', 'crag', 'run', 'watch', 'fall',
    'mere', 'barrow', 'wick', 'hearth', 'spire', 'deep', 'march', 'rest', 'brook'
]

const GEM_PREFIX = ['Glimmer', 'Starfall', 'Prism', 'Lodestar', 'Halcyon']
const GEM_SUFFIX = ['Vault', 'Lode', 'Cache', 'Reliquary', 'Hoard']

const CAMP_PREFIX = ['Blackfang', 'Ashclaw', 'Rotbone', 'Hollowmask', 'Ironjaw', 'Grave', 'Sable', 'Wretch', 'Direhorn', 'Nightmaw']
const CAMP_SUFFIX = ['Camp', 'Warband', 'Hold', 'Stockade', 'Redoubt', 'Warren', 'Pyre', 'Nest']

/** Distance from the origin at which a tier's ring sits. */
function tierRadius(tier: number): number {
    return 250 * Math.pow(tier, 1.06)
}

/** How many resource nodes a tier gets. Later tiers are wider and busier. */
function tierNodeCount(tier: number): number {
    return 7 + tier * 2
}

/** How many camps guard the approach to a tier. */
function tierCampCount(tier: number): number {
    return tier === 1 ? 0 : 1 + Math.floor(tier / 2)
}

function dist(a: { x: number, y: number }, b: { x: number, y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

export function edgeId(a: NodeId, b: NodeId): EdgeId {
    return a < b ? `${a}-${b}` : `${b}-${a}`
}

/**
 * Build the whole map. Deterministic for a given seed -- call it freely on both
 * sides of the wire rather than shipping ~120 nodes down with every response.
 */
export function generateWorld(seed: number = WORLD_SEED): World {
    const rng = seededRng(seed, 'world')
    const nodes: WorldNode[] = []

    // The origin capital. Always owned, always free, always node 0.
    nodes.push({
        id: 0,
        kind: 'capital',
        x: 0,
        y: 0,
        tier: 1,
        name: 'Waystone Hearth'
    })

    const usedNames = new Set<string>(['Waystone Hearth'])
    const nextName = (prefixes: string[], suffixes: string[]) => {
        for (let attempt = 0; attempt < 60; attempt++) {
            const n = `${rng.pick(prefixes)}${suffixes === SUFFIX ? '' : ' '}${rng.pick(suffixes)}`
            if (!usedNames.has(n)) {
                usedNames.add(n)
                return n
            }
        }
        const fallback = `Outpost ${nodes.length}`
        usedNames.add(fallback)
        return fallback
    }

    for (const tierDef of TIERS) {
        const tier = tierDef.tier
        const inner = tier === 1 ? 190 : tierRadius(tier - 1) + 120
        const outer = tierRadius(tier)

        // Camps sit just inside the ring, on the approach from the previous tier.
        for (let i = 0; i < tierCampCount(tier); i++) {
            const angle = rng.next() * Math.PI * 2
            const radius = inner - 60 + rng.next() * 90
            // Tuned against what a party can actually field. Worker power now
            // climbs a flat 25% a tier rather than doubling, so camps have to
            // climb at roughly the rate of party size plus gear -- not faster.
            const power = Math.round(55 * Math.pow(1.85, tier - 1) * (0.8 + rng.next() * 0.6))
            const lootScale = Math.pow(2.9, tier - 1)
            nodes.push({
                id: nodes.length,
                kind: 'camp',
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                tier,
                name: nextName(CAMP_PREFIX, CAMP_SUFFIX),
                power,
                loot: {
                    coins: Math.round(180_000 * lootScale * (0.7 + rng.next() * 0.9)),
                    resources: Object.fromEntries(
                        tierDef.raw.map(r => [r, Math.round(200 * (0.6 + rng.next()))])
                    )
                }
            })
        }

        // Resource nodes, scattered around the ring with a golden-angle base so
        // they spread evenly, plus jitter so the map never looks like a clock face.
        const count = tierNodeCount(tier)
        for (let i = 0; i < count; i++) {
            const angle = (i * 2.39996 + rng.next() * 0.55) % (Math.PI * 2)
            const radius = inner + (outer - inner) * (0.15 + rng.next() * 0.85)
            const resource = tierDef.raw[i % tierDef.raw.length]!
            const richness = 0.65 + rng.next() * 0.9
            nodes.push({
                id: nodes.length,
                kind: 'resource',
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                tier,
                name: nextName(PREFIX, SUFFIX),
                resource,
                yield: Math.max(1, Math.round(6 * richness)),
                capacity: Math.round(2600 * richness * Math.pow(1.35, tier - 1))
            })
        }

        // Gem seams: one per tier from tier 4, five in the whole world. They are
        // the only place gems come from, so they are worth going to war over --
        // and they sit far enough out that reaching one is a campaign.
        if (tier >= 4) {
            const angle = rng.next() * Math.PI * 2
            const radius = inner + (outer - inner) * (0.55 + rng.next() * 0.4)
            const gemResource = tierDef.raw.find(r => RESOURCES[r]?.category === 'gem') ?? tierDef.raw[0]!
            const richness = 0.7 + rng.next() * 0.6
            nodes.push({
                id: nodes.length,
                kind: 'resource',
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                tier,
                name: nextName(GEM_PREFIX, GEM_SUFFIX),
                resource: gemResource,
                yield: Math.max(1, Math.round(6 * richness)),
                capacity: Math.round(2600 * richness * Math.pow(1.35, tier - 1)),
                // Tuned so a well-staffed seam is worth a handful of gems a day
                // and all five together sit near the top of the daily range.
                gemYield: 0.004 + (tier - 4) * 0.0016
            })
        }

        // One extra capital site per tier from tier 2 on, so expanding your reach
        // is a real decision instead of an automatic purchase.
        if (tier >= 2) {
            const angle = rng.next() * Math.PI * 2
            const radius = (inner + outer) / 2
            nodes.push({
                id: nodes.length,
                kind: 'capital',
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                tier,
                name: nextName(PREFIX, SUFFIX)
            })
        }
    }

    // Push overlapping nodes apart so labels stay readable at map zoom.
    for (let pass = 0; pass < 12; pass++) {
        for (let i = 1; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]!
                const b = nodes[j]!
                const d = dist(a, b)
                const minD = 125
                if (d < minD && d > 0.001) {
                    const push = (minD - d) / 2
                    const nx = (b.x - a.x) / d
                    const ny = (b.y - a.y) / d
                    a.x -= nx * push
                    a.y -= ny * push
                    b.x += nx * push
                    b.y += ny * push
                }
            }
        }
    }

    const edges = buildEdges(nodes)
    return { seed, nodes, edges, adjacency: buildAdjacency(nodes, edges) }
}

/**
 * Wire the nodes up. Every node links to its nearest few neighbours that sit
 * closer to the origin, which guarantees the graph is connected and that all
 * routes eventually funnel back toward the capital. A handful of lateral links
 * are added so the map has loops and alternate routes worth paving.
 */
function buildEdges(nodes: WorldNode[]): WorldEdge[] {
    const seen = new Set<EdgeId>()
    const edges: WorldEdge[] = []
    const radiusOf = (n: WorldNode) => Math.hypot(n.x, n.y)
    const byRadius = [...nodes].sort((a, b) => radiusOf(a) - radiusOf(b))

    const add = (a: WorldNode, b: WorldNode) => {
        const id = edgeId(a.id, b.id)
        if (seen.has(id)) return
        seen.add(id)
        edges.push({ id, a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), length: dist(a, b) })
    }

    for (let i = 1; i < byRadius.length; i++) {
        const node = byRadius[i]!
        const inward = byRadius
            .slice(0, i)
            .map(other => ({ other, d: dist(node, other) }))
            .sort((p, q) => p.d - q.d)

        // Camps get exactly one inward link so they genuinely block the way past.
        const links = node.kind === 'camp' ? 1 : 2
        for (const { other } of inward.slice(0, links)) add(node, other)
    }

    // Lateral links between same-tier neighbours, for loops and route choice.
    for (const node of nodes) {
        if (node.kind === 'camp') continue
        const peers = nodes
            .filter(o => o.id !== node.id && o.kind !== 'camp' && Math.abs(o.tier - node.tier) <= 1)
            .map(other => ({ other, d: dist(node, other) }))
            .sort((p, q) => p.d - q.d)
            .slice(0, 2)
        for (const { other } of peers) add(node, other)
    }

    return edges
}

export function buildAdjacency(nodes: WorldNode[], edges: WorldEdge[]): Record<NodeId, EdgeId[]> {
    const adj: Record<NodeId, EdgeId[]> = {}
    for (const n of nodes) adj[n.id] = []
    for (const e of edges) {
        adj[e.a]!.push(e.id)
        adj[e.b]!.push(e.id)
    }
    return adj
}

/** The node on the other end of an edge. */
export function otherEnd(edge: WorldEdge, from: NodeId): NodeId {
    return edge.a === from ? edge.b : edge.a
}

/** A node is purchasable only once it touches something the player already holds. */
export function isReachable(world: World, nodeId: NodeId, owned: Set<NodeId>): boolean {
    if (owned.has(nodeId)) return true
    for (const eid of world.adjacency[nodeId] ?? []) {
        const edge = world.edges.find(e => e.id === eid)!
        if (owned.has(otherEnd(edge, nodeId))) return true
    }
    return false
}
