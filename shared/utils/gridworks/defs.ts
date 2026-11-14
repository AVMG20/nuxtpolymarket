// Gridworks: static game data. Items, buildings, recipes, research and the
// numbers that tie them together. Everything else in the game reads from here.

export const CHUNK = 8
/** The plot is MAP_CHUNKS × MAP_CHUNKS chunks (96 × 96 tiles). */
export const MAP_CHUNKS = 12
export const MAP_TILES = CHUNK * MAP_CHUNKS
export const START_CHUNKS = ['5,5', '6,5', '5,6', '6,6']

export const ITEM_IDS = [
    'iron-ore', 'copper-ore', 'stone', 'coal', 'oil', 'crystal',
    'iron-plate', 'copper-plate', 'brick',
    'gear', 'wire', 'steel', 'circuit',
    'motor', 'plastic', 'chip',
    'lens', 'fusion-core'
] as const
export type ItemId = typeof ITEM_IDS[number]
export type Stock = Partial<Record<ItemId, number>>

export interface ItemDef { name: string, color: string, shape: 'circle' | 'square' | 'brick' | 'gear' | 'ring' | 'hex' | 'dot' | 'diamond' | 'star' }
export const ITEMS: Record<ItemId, ItemDef> = {
    'iron-ore': { name: 'Iron ore', color: '#8b98ab', shape: 'circle' },
    'copper-ore': { name: 'Copper ore', color: '#e07a3f', shape: 'circle' },
    'stone': { name: 'Stone', color: '#cfc4ab', shape: 'circle' },
    'coal': { name: 'Coal', color: '#3b3d45', shape: 'circle' },
    'oil': { name: 'Oil', color: '#6d4fb3', shape: 'circle' },
    'crystal': { name: 'Crystal', color: '#5fd4f5', shape: 'diamond' },
    'iron-plate': { name: 'Iron plate', color: '#d7dee8', shape: 'square' },
    'copper-plate': { name: 'Copper plate', color: '#f2a33a', shape: 'square' },
    'brick': { name: 'Brick', color: '#c2562f', shape: 'brick' },
    'gear': { name: 'Gear', color: '#a3aebd', shape: 'gear' },
    'wire': { name: 'Wire', color: '#f2b83a', shape: 'ring' },
    'steel': { name: 'Steel', color: '#6b7a90', shape: 'hex' },
    'circuit': { name: 'Circuit', color: '#3fbf6a', shape: 'dot' },
    'motor': { name: 'Motor', color: '#e5484d', shape: 'hex' },
    'plastic': { name: 'Plastic', color: '#f6f7f9', shape: 'circle' },
    'chip': { name: 'Chip', color: '#3b82f6', shape: 'dot' },
    'lens': { name: 'Lens', color: '#b9f0ff', shape: 'diamond' },
    'fusion-core': { name: 'Fusion Core', color: '#d946ef', shape: 'star' }
}

/** Ore that can sit under a tile. */
export type OreId = 'iron-ore' | 'copper-ore' | 'stone' | 'coal' | 'oil' | 'crystal'

export interface Recipe { id: string, out: ItemId, outQty: number, inputs: Stock, time: number }
export const RECIPES: Record<string, Recipe> = {
    'iron-plate': { id: 'iron-plate', out: 'iron-plate', outQty: 1, inputs: { 'iron-ore': 1 }, time: 2 },
    'copper-plate': { id: 'copper-plate', out: 'copper-plate', outQty: 1, inputs: { 'copper-ore': 1 }, time: 2 },
    'brick': { id: 'brick', out: 'brick', outQty: 1, inputs: { stone: 2 }, time: 3 },
    'gear': { id: 'gear', out: 'gear', outQty: 1, inputs: { 'iron-plate': 2 }, time: 2 },
    'wire': { id: 'wire', out: 'wire', outQty: 2, inputs: { 'copper-plate': 1 }, time: 2 },
    'steel': { id: 'steel', out: 'steel', outQty: 1, inputs: { 'iron-plate': 2, 'coal': 1 }, time: 4 },
    'circuit': { id: 'circuit', out: 'circuit', outQty: 1, inputs: { 'iron-plate': 1, 'wire': 3 }, time: 3 },
    'motor': { id: 'motor', out: 'motor', outQty: 1, inputs: { steel: 1, gear: 2, wire: 4 }, time: 6 },
    'plastic': { id: 'plastic', out: 'plastic', outQty: 1, inputs: { oil: 2 }, time: 3 },
    'chip': { id: 'chip', out: 'chip', outQty: 1, inputs: { circuit: 2, plastic: 1 }, time: 5 },
    'lens': { id: 'lens', out: 'lens', outQty: 1, inputs: { crystal: 2 }, time: 4 },
    'fusion-core': { id: 'fusion-core', out: 'fusion-core', outQty: 1, inputs: { chip: 20, motor: 10, lens: 5 }, time: 60 }
}

export type Category = 'logistics' | 'production' | 'storage' | 'power'

export type Kind =
    | 'belt' | 'ramp-up' | 'ramp-down' | 'splitter' | 'merger' | 'smart-splitter' | 'overflow-splitter'
    | 'miner' | 'pumpjack' | 'crystal-drill'
    | 'smelter' | 'kiln' | 'press' | 'refinery' | 'grinder' | 'mixer' | 'assembler' | 'reactor'
    | 'storage' | 'silo' | 'lab'
    | 'amplifier'

export type Role = 'belt' | 'ramp' | 'splitter' | 'merger' | 'smart' | 'overflow' | 'source' | 'machine' | 'sink' | 'passive'

export interface BuildingDef {
    name: string
    category: Category
    role: Role
    /** Footprint in the default orientation (flow → right): w along the flow, h across it. */
    w: number
    h: number
    cost: Stock
    /** Research node that unlocks it; null when available from the start. */
    unlock: string | null
    /** Machines: the recipes it can run, first is the default. */
    recipes?: string[]
    /** Sources: the ore it must stand on, and what it yields per second at Mk1. */
    ore?: OreId[]
    rate?: number
    /** Output row (0-based) for machines taller than one tile. */
    outRow?: number
    /** Sprite path under /gridworks/sprites. */
    sprite: string
    hotkey?: string
}

export const BUILDINGS: Record<Kind, BuildingDef> = {
    'belt': { name: 'Belt', category: 'logistics', role: 'belt', w: 1, h: 1, cost: { 'iron-ore': 1 }, unlock: null, sprite: '', hotkey: '1' },
    'merger': { name: 'Merger', category: 'logistics', role: 'merger', w: 1, h: 1, cost: { 'iron-plate': 6 }, unlock: 'merger', sprite: 'logistics/merger.svg', hotkey: '2' },
    'splitter': { name: 'Splitter', category: 'logistics', role: 'splitter', w: 1, h: 1, cost: { gear: 6 }, unlock: 'splitter', sprite: 'logistics/splitter.svg', hotkey: '3' },
    'ramp-up': { name: 'Ramp up', category: 'logistics', role: 'ramp', w: 1, h: 1, cost: { steel: 4 }, unlock: 'bridges', sprite: 'logistics/ramp-up.svg', hotkey: '4' },
    'ramp-down': { name: 'Ramp down', category: 'logistics', role: 'ramp', w: 1, h: 1, cost: { steel: 4 }, unlock: 'bridges', sprite: 'logistics/ramp-down.svg', hotkey: '5' },
    'smart-splitter': { name: 'Smart splitter', category: 'logistics', role: 'smart', w: 1, h: 1, cost: { circuit: 8, gear: 4 }, unlock: 'smart-splitter', sprite: 'logistics/smart-splitter.svg', hotkey: '6' },
    'overflow-splitter': { name: 'Overflow', category: 'logistics', role: 'overflow', w: 1, h: 1, cost: { gear: 10, brick: 6 }, unlock: 'overflow', sprite: 'logistics/overflow-splitter.svg', hotkey: '7' },

    'miner': { name: 'Miner', category: 'production', role: 'source', w: 1, h: 1, cost: { 'iron-ore': 10, stone: 10 }, unlock: null, ore: ['iron-ore', 'copper-ore', 'stone', 'coal'], rate: 0.5, sprite: 'machines/miner.svg', hotkey: '1' },
    'smelter': { name: 'Smelter', category: 'production', role: 'machine', w: 1, h: 1, cost: { stone: 20, 'iron-ore': 10 }, unlock: 'smelting', recipes: ['iron-plate', 'copper-plate'], sprite: 'machines/smelter.svg', hotkey: '2' },
    'kiln': { name: 'Kiln', category: 'production', role: 'machine', w: 1, h: 1, cost: { stone: 30 }, unlock: 'kiln', recipes: ['brick'], sprite: 'machines/kiln.svg', hotkey: '3' },
    'press': { name: 'Press', category: 'production', role: 'machine', w: 1, h: 1, cost: { 'iron-plate': 20, brick: 10 }, unlock: 'press', recipes: ['gear', 'wire'], sprite: 'machines/press.svg', hotkey: '4' },
    'mixer': { name: 'Mixer', category: 'production', role: 'machine', w: 1, h: 2, cost: { 'iron-plate': 40, brick: 20 }, unlock: 'mixer', recipes: ['steel', 'circuit', 'chip'], outRow: 0, sprite: 'machines/mixer.svg', hotkey: '5' },
    'assembler': { name: 'Assembler', category: 'production', role: 'machine', w: 1, h: 3, cost: { steel: 50, gear: 30 }, unlock: 'assembler', recipes: ['motor'], outRow: 1, sprite: 'machines/assembler.svg', hotkey: '6' },
    'pumpjack': { name: 'Pumpjack', category: 'production', role: 'source', w: 1, h: 1, cost: { steel: 30, gear: 20 }, unlock: 'oil', ore: ['oil'], rate: 0.5, sprite: 'machines/pumpjack.svg', hotkey: '7' },
    'refinery': { name: 'Refinery', category: 'production', role: 'machine', w: 1, h: 1, cost: { steel: 40, circuit: 20 }, unlock: 'oil', recipes: ['plastic'], sprite: 'machines/refinery.svg', hotkey: '8' },
    'crystal-drill': { name: 'Crystal drill', category: 'production', role: 'source', w: 1, h: 1, cost: { motor: 20, chip: 10 }, unlock: 'crystal', ore: ['crystal'], rate: 0.25, sprite: 'machines/crystal-drill.svg', hotkey: '9' },
    'grinder': { name: 'Grinder', category: 'production', role: 'machine', w: 1, h: 1, cost: { motor: 10, steel: 20 }, unlock: 'crystal', recipes: ['lens'], sprite: 'machines/grinder.svg' },
    'reactor': { name: 'Fusion reactor', category: 'production', role: 'machine', w: 1, h: 3, cost: { motor: 80, chip: 80, lens: 20 }, unlock: 'fusion-reactor', recipes: ['fusion-core'], outRow: 1, sprite: 'machines/reactor.svg' },

    'storage': { name: 'Storage', category: 'storage', role: 'sink', w: 2, h: 2, cost: { stone: 60 }, unlock: null, sprite: 'machines/storage.svg', hotkey: '1' },
    'lab': { name: 'Lab', category: 'storage', role: 'sink', w: 2, h: 2, cost: { stone: 30, 'iron-ore': 20 }, unlock: null, sprite: 'machines/lab.svg', hotkey: '2' },
    'silo': { name: 'Silo', category: 'storage', role: 'sink', w: 3, h: 3, cost: { brick: 400, steel: 200 }, unlock: 'silo', sprite: 'machines/silo.svg', hotkey: '3' },

    'amplifier': { name: 'Amplifier', category: 'power', role: 'passive', w: 1, h: 1, cost: { circuit: 40, steel: 20 }, unlock: 'amplifier', sprite: 'power/amplifier.svg', hotkey: '1' }
}
export const KINDS = Object.keys(BUILDINGS) as Kind[]

/** Belt throughput (items per second) and visual speed (tiles per second) per Mk. */
export const BELT_MK = [
    { rate: 1, speed: 1.2 },
    { rate: 2, speed: 2 },
    { rate: 4, speed: 3.2 },
    { rate: 8, speed: 5 }
]
/** Speed multiplier for machines and sources per Mk. */
export const MACHINE_MK = [1, 1.5, 2, 3, 4]
export const LAB_RATE = 0.5
/** Amplifiers add this much speed to each machine they touch (stacking). */
export const AMP_BONUS = 0.25

/** Research that unlocks each upgrade level (index = level − 1, so level 1 needs nothing). */
export const BELT_MK_UNLOCK = [null, 'belt-mk2', 'belt-mk3', 'belt-mk4'] as const
export const MACHINE_MK_UNLOCK = [null, 'machine-mk2', 'machine-mk3', 'machine-mk4', 'machine-mk5'] as const

/** Cost to upgrade to a level (index = target level − 1). */
export function upgradeCost(kind: Kind, toMk: number): Stock {
    const def = BUILDINGS[kind]
    if (def.role === 'belt') return [{}, { gear: 1 }, { steel: 1 }, { motor: 1 }][toMk - 1] ?? {}
    const scale = [0, 1, 2, 4, 8][toMk - 1] ?? 8
    const by: Stock[] = [{}, { gear: 10, 'iron-plate': 10 }, { steel: 15, circuit: 5 }, { motor: 8, steel: 20 }, { lens: 6, chip: 10 }]
    const base = by[toMk - 1] ?? {}
    const out: Stock = {}
    const size = def.w * def.h
    for (const [k, v] of Object.entries(base) as [ItemId, number][]) out[k] = Math.ceil(v * Math.max(1, scale / 2) * size)
    return out
}

/** Max items of each kind that one storage block holds, by storage research level (0 = base). */
export const STORAGE_CAP = [400, 1000, 2500, 6000, 15000, 40000]
export const STORAGE_CAP_RESEARCH = ['storage-2', 'storage-3', 'silo', 'storage-5', 'storage-6']
export const SILO_MULT = 4

export type Branch = 'production' | 'logistics' | 'idle'
export interface ResearchNode { id: string, tier: number, branch: Branch, name: string, cost: Stock, desc: string }
export const RESEARCH: ResearchNode[] = [
    { id: 'smelting', tier: 1, branch: 'production', name: 'Smelting', cost: { 'iron-ore': 40 }, desc: 'Smelter: ore into plates' },
    { id: 'kiln', tier: 1, branch: 'production', name: 'Kiln', cost: { stone: 60 }, desc: 'Kiln: stone into brick' },
    { id: 'merger', tier: 1, branch: 'logistics', name: 'Merger', cost: { 'iron-plate': 50 }, desc: '3 belts in, 1 out' },
    { id: 'land-1', tier: 1, branch: 'idle', name: 'Land I', cost: { brick: 80 }, desc: 'Buy neighbouring chunks' },
    { id: 'storage-2', tier: 1, branch: 'idle', name: 'Storage II', cost: { brick: 120 }, desc: 'Storage holds 1k of each item' },

    { id: 'press', tier: 2, branch: 'production', name: 'Press', cost: { 'iron-plate': 300 }, desc: 'Gears and wire' },
    { id: 'mixer', tier: 2, branch: 'production', name: 'Mixer', cost: { gear: 300, brick: 200 }, desc: '1×2: steel and circuits' },
    { id: 'machine-mk2', tier: 2, branch: 'production', name: 'Machine Mk2', cost: { gear: 300, 'iron-plate': 300 }, desc: 'Machines ×1.5' },
    { id: 'splitter', tier: 2, branch: 'logistics', name: 'Splitter', cost: { gear: 250 }, desc: '1 belt in, 3 out' },
    { id: 'bridges', tier: 2, branch: 'logistics', name: 'Bridges', cost: { steel: 300 }, desc: 'Ramps and belts on layer 1' },
    { id: 'belt-mk2', tier: 2, branch: 'logistics', name: 'Belt Mk2', cost: { gear: 400 }, desc: '120 items/min' },
    { id: 'storage-3', tier: 2, branch: 'idle', name: 'Storage III', cost: { steel: 400 }, desc: 'Storage holds 2.5k of each item' },

    { id: 'assembler', tier: 3, branch: 'production', name: 'Assembler', cost: { steel: 1000, circuit: 1000 }, desc: '1×3: motors' },
    { id: 'amplifier', tier: 3, branch: 'production', name: 'Amplifier', cost: { circuit: 1500 }, desc: '+25% speed to touching machines' },
    { id: 'machine-mk3', tier: 3, branch: 'production', name: 'Machine Mk3', cost: { steel: 2000 }, desc: 'Machines ×2' },
    { id: 'smart-splitter', tier: 3, branch: 'logistics', name: 'Smart splitter', cost: { circuit: 800 }, desc: 'Pull one item off a belt' },
    { id: 'overflow', tier: 3, branch: 'logistics', name: 'Overflow', cost: { gear: 1500, brick: 1000 }, desc: 'Extra goes sideways' },
    { id: 'skyway', tier: 3, branch: 'logistics', name: 'Skyway', cost: { steel: 2000 }, desc: 'Belts on layer 2' },
    { id: 'belt-mk3', tier: 3, branch: 'logistics', name: 'Belt Mk3', cost: { steel: 1500 }, desc: '240 items/min' },
    { id: 'auto-queue', tier: 3, branch: 'idle', name: 'Auto-queue', cost: { circuit: 2000 }, desc: 'Research queue keeps going offline' },
    { id: 'silo', tier: 3, branch: 'idle', name: 'Silo', cost: { brick: 4000, steel: 2000 }, desc: '3×3 storage, 6k of each item' },

    { id: 'oil', tier: 4, branch: 'production', name: 'Oil', cost: { steel: 5000, circuit: 3000 }, desc: 'Pumpjack, refinery, plastic' },
    { id: 'electronics', tier: 4, branch: 'production', name: 'Electronics', cost: { plastic: 4000 }, desc: 'Chips' },
    { id: 'machine-mk4', tier: 4, branch: 'production', name: 'Machine Mk4', cost: { motor: 2000 }, desc: 'Machines ×3' },
    { id: 'belt-mk4', tier: 4, branch: 'logistics', name: 'Belt Mk4', cost: { motor: 2000 }, desc: '480 items/min' },
    { id: 'storage-5', tier: 4, branch: 'idle', name: 'Storage V', cost: { steel: 10000 }, desc: 'Storage holds 15k of each item' },

    { id: 'crystal', tier: 5, branch: 'production', name: 'Crystal', cost: { chip: 10000, motor: 5000 }, desc: 'Crystal drill, grinder, lenses' },
    { id: 'fusion-reactor', tier: 5, branch: 'production', name: 'Fusion reactor', cost: { lens: 5000, chip: 10000 }, desc: '1×3: Fusion Cores' },
    { id: 'machine-mk5', tier: 5, branch: 'production', name: 'Machine Mk5', cost: { lens: 4000 }, desc: 'Machines ×4' },
    { id: 'storage-6', tier: 5, branch: 'idle', name: 'Storage VI', cost: { motor: 8000 }, desc: 'Storage holds 40k of each item' }
]
/**
 * No prototype: ids arrive from the client, and a plain object would answer
 * 'constructor' or 'toString' with something truthy.
 */
export const RESEARCH_BY_ID: Record<string, ResearchNode> = Object.assign(Object.create(null), Object.fromEntries(RESEARCH.map(n => [n.id, n])))

/** Own-key check for the lookup tables here, safe for untrusted strings. */
export function hasKey<T extends object>(table: T, key: unknown): key is keyof T & string {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
}
/** Nodes of the previous tier needed before a tier opens. */
export const TIER_GATE: Record<number, number> = { 1: 0, 2: 4, 3: 5, 4: 6, 5: 4 }

export function tierOpen(tier: number, done: readonly string[]): boolean {
    if (!Number.isFinite(tier)) return false
    if (tier <= 1) return true
    const prev = RESEARCH.filter(n => n.tier === tier - 1 && done.includes(n.id)).length
    return prev >= (TIER_GATE[tier] ?? 0) && tierOpen(tier - 1, done)
}

export function researchAvailable(id: string, done: readonly string[]): boolean {
    const node = RESEARCH_BY_ID[id]
    return !!node && !done.includes(id) && tierOpen(node.tier, done)
}

export function isUnlocked(kind: Kind, done: readonly string[]): boolean {
    const u = BUILDINGS[kind].unlock
    return u === null || done.includes(u)
}

/** Highest Mk a building may be upgraded to with this research. */
export function maxMk(kind: Kind, done: readonly string[]): number {
    const def = BUILDINGS[kind]
    if (def.role === 'belt') return 1 + BELT_MK_UNLOCK.slice(1).filter(id => id && done.includes(id)).length
    if (def.role === 'machine' || def.role === 'source') return 1 + MACHINE_MK_UNLOCK.slice(1).filter(id => id && done.includes(id)).length
    return 1
}

/** The highest storage research done sets the level; the ones below it aren't needed. */
export function storageLevel(done: readonly string[]): number {
    for (let i = STORAGE_CAP_RESEARCH.length - 1; i >= 0; i--) {
        if (done.includes(STORAGE_CAP_RESEARCH[i]!)) return i + 1
    }
    return 0
}

/** Price of the n-th chunk bought (0-based, the free start chunks excluded). */
export function chunkCost(bought: number): Stock {
    const brick = Math.round(60 * Math.pow(1.35, bought))
    const steel = bought < 2 ? 0 : Math.round(25 * Math.pow(1.4, bought - 2))
    return steel ? { brick, steel } : { brick }
}

export const START_STOCK: Stock = { 'iron-ore': 60, stone: 140 }
/** Items one hand-mining click yields. */
export const HAND_MINE = 1
