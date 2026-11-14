// Gridworks: the ore map. Deterministic from the plot seed so the client and
// the server agree on every tile without storing it.
import { createSeededRandom } from '#shared/utils/random'
import { CHUNK, MAP_CHUNKS, MAP_TILES, type OreId } from './defs'

export interface OreMap {
    /** ore[y * MAP_TILES + x], 0 = none, otherwise index + 1 into ORE_ORDER. */
    tiles: Uint8Array
}
export const ORE_ORDER: OreId[] = ['iron-ore', 'copper-ore', 'stone', 'coal', 'oil', 'crystal']

interface Patch { ore: OreId, cx: number, cy: number, r: number }

const CENTER = (MAP_CHUNKS / 2) * CHUNK

function blob(tiles: Uint8Array, p: Patch, rng: ReturnType<typeof createSeededRandom>) {
    const id = ORE_ORDER.indexOf(p.ore) + 1
    const wobble = [rng.randomFloat(), rng.randomFloat(), rng.randomFloat()]
    const r2 = p.r + 1
    for (let y = Math.floor(p.cy - r2); y <= Math.ceil(p.cy + r2); y++) {
        for (let x = Math.floor(p.cx - r2); x <= Math.ceil(p.cx + r2); x++) {
            if (x < 0 || y < 0 || x >= MAP_TILES || y >= MAP_TILES) continue
            const dx = x + 0.5 - p.cx
            const dy = y + 0.5 - p.cy
            const a = Math.atan2(dy, dx)
            const edge = p.r * (0.82 + 0.18 * Math.sin(a * 3 + wobble[0]! * 6.28) + 0.1 * Math.sin(a * 5 + wobble[1]! * 6.28))
            if (Math.hypot(dx, dy) <= edge) {
                const i = y * MAP_TILES + x
                if (!tiles[i]) tiles[i] = id
            }
        }
    }
}

const cache = new Map<number, OreMap>()

export function oreMap(seed: number): OreMap {
    const hit = cache.get(seed)
    if (hit) return hit
    const rng = createSeededRandom(seed >>> 0)
    const tiles = new Uint8Array(MAP_TILES * MAP_TILES)
    const patches: Patch[] = []

    // The starting 16×16: a small patch of each early ore in its own corner, shuffled.
    const startOres: OreId[] = ['iron-ore', 'stone', 'copper-ore', 'coal']
    for (let i = startOres.length - 1; i > 0; i--) {
        const j = rng.randomInt(0, i)
        ;[startOres[i], startOres[j]] = [startOres[j]!, startOres[i]!]
    }
    const corners = [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]
    startOres.forEach((ore, i) => {
        const [ox, oy] = corners[i]!
        patches.push({
            ore,
            cx: CENTER + ox! + (rng.randomFloat() - 0.5) * 1.5,
            cy: CENTER + oy! + (rng.randomFloat() - 0.5) * 1.5,
            r: ore === 'coal' ? 1.8 : 2.4
        })
    })

    // The rest of the map: richer and rarer the further out a chunk sits.
    for (let cy = 0; cy < MAP_CHUNKS; cy++) {
        for (let cx = 0; cx < MAP_CHUNKS; cx++) {
            const d = Math.max(Math.abs(cx + 0.5 - MAP_CHUNKS / 2), Math.abs(cy + 0.5 - MAP_CHUNKS / 2))
            if (d < 1) continue
            const chance = d < 2 ? 0.55 : 0.75
            if (!rng.randomChance(chance)) continue
            const pool: OreId[] = ['iron-ore', 'copper-ore', 'stone', 'coal', 'iron-ore', 'copper-ore']
            if (d >= 2) pool.push('oil', 'coal')
            if (d >= 3) pool.push('oil', 'crystal')
            if (d >= 4) pool.push('crystal', 'crystal')
            const ore = rng.randomPick(pool)
            const r = ore === 'oil' ? 1.4 + rng.randomFloat() : ore === 'crystal' ? 1.6 + rng.randomFloat() * 1.2 : 2 + rng.randomFloat() * (1 + d * 0.4)
            patches.push({
                ore,
                cx: cx * CHUNK + 2 + rng.randomFloat() * (CHUNK - 4),
                cy: cy * CHUNK + 2 + rng.randomFloat() * (CHUNK - 4),
                r
            })
        }
    }
    for (const p of patches) blob(tiles, p, rng)

    const map = { tiles }
    if (cache.size > 64) cache.delete(cache.keys().next().value!)
    cache.set(seed, map)
    return map
}

export function oreAt(map: OreMap, x: number, y: number): OreId | null {
    if (x < 0 || y < 0 || x >= MAP_TILES || y >= MAP_TILES) return null
    const v = map.tiles[y * MAP_TILES + x]!
    return v ? ORE_ORDER[v - 1]! : null
}

export function chunkOf(x: number, y: number): string {
    return `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`
}

export function chunkNeighbours(key: string): string[] {
    const [cx, cy] = key.split(',').map(Number) as [number, number]
    return [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [cx + dx!, cy + dy!] as const)
        .filter(([x, y]) => x >= 0 && y >= 0 && x < MAP_CHUNKS && y < MAP_CHUNKS)
        .map(([x, y]) => `${x},${y}`)
}
