// Gridworks goals: Cog's guided first steps, then milestones. Each one is
// checked against the plot, and its reward (items, never coins) is claimed
// once, in order.
import { RESEARCH_BY_ID, START_CHUNKS, tierOpen, type ItemId, type Kind, type Stock } from './defs'
import type { Solution } from './flow'
import type { GridState } from './game'
import { oreAt, oreMap } from './world'

export type CogPose = 'idle' | 'point' | 'cheer' | 'think'

/** UI element a goal draws attention to. */
export type GoalFocus = `build:${Kind}` | 'research' | null

export interface Goal {
    id: string
    title: string
    /** What Cog says. */
    say: string
    pose: CogPose
    reward: Stock
    /** Fixed, or worked out from the plot when the next step depends on what is researched. */
    focus?: GoalFocus | ((s: GridState) => GoalFocus)
    /** Progress as [current, target]; met when current >= target. */
    progress(s: GridState, sol: Solution | null): [number, number]
    /** Tile area to point at on the map. */
    marker?(s: GridState): { x: number, y: number, w: number, h: number } | null
}

const rate = (sol: Solution | null, id: ItemId) => (sol?.store[id] ?? 0) * 60
const has = (s: GridState, k: string) => s.entities.some(e => e.k === k)
const flag = (ok: boolean): [number, number] => [ok ? 1 : 0, 1]

function storageArea(s: GridState) {
    const e = s.entities.find(x => x.k === 'storage')
    return e ? { x: e.x, y: e.y, w: 2, h: 2 } : null
}

/** The ore tile of a kind closest to the first storage, on the player's land. */
function nearestOre(s: GridState, ore: ItemId) {
    const st = s.entities.find(x => x.k === 'storage')
    const cx = st ? st.x + 1 : 48
    const cy = st ? st.y + 1 : 48
    const map = oreMap(s.seed)
    const taken = new Set(s.entities.map(e => `${e.x},${e.y}`))
    let best: { x: number, y: number, w: number, h: number } | null = null
    let bd = Infinity
    for (const c of s.chunks) {
        const [qx, qy] = c.split(',').map(Number) as [number, number]
        for (let y = qy * 8; y < qy * 8 + 8; y++) {
            for (let x = qx * 8; x < qx * 8 + 8; x++) {
                if (oreAt(map, x, y) !== ore || taken.has(`${x},${y}`)) continue
                const d = (x - cx) ** 2 + (y - cy) ** 2
                if (d < bd) {
                    bd = d
                    best = { x, y, w: 1, h: 1 }
                }
            }
        }
    }
    return best
}

/** Points at the research tree until `research` is done, then at the building it unlocks. */
const needs = (research: string, kind: Kind) => (s: GridState): GoalFocus => s.done.includes(research) ? `build:${kind}` : 'research'

/** Walks a production chain: the first step that is still missing gets the focus. */
function chain(steps: { research?: string, kind?: Kind }[]) {
    return (s: GridState): GoalFocus => {
        for (const step of steps) {
            if (step.research && !s.done.includes(step.research)) return 'research'
            if (step.kind && !has(s, step.kind)) return `build:${step.kind}`
        }
        return null
    }
}

export const GOALS: Goal[] = [
    {
        id: 'hello', title: 'Meet Cog', pose: 'idle', reward: {},
        say: 'Hi, I\'m Cog! This lit square is your plot, and the crate in the middle is your storage. Let\'s get a factory humming.',
        progress: () => [1, 1],
        marker: storageArea
    },
    {
        id: 'hand-mine', title: 'Mine by hand', pose: 'point', reward: { stone: 20 },
        say: 'Click an iron ore rock to dig it up yourself. Hold the button to keep digging. Grab 10!',
        progress: s => [Math.min(10, s.mined), 10],
        marker: s => nearestOre(s, 'iron-ore')
    },
    {
        id: 'first-miner', title: 'Place a miner', pose: 'point', reward: { 'iron-ore': 20 }, focus: 'build:miner',
        say: 'Digging is slow. Pick the Miner from Production and drop it on ore. The arrow shows where its ore comes out; press R to turn it.',
        progress: s => flag(has(s, 'miner')),
        marker: s => nearestOre(s, 'iron-ore')
    },
    {
        id: 'first-belt', title: 'Belt it home', pose: 'point', reward: { 'iron-ore': 30, stone: 20 }, focus: 'build:belt',
        say: 'Now drag a belt from the miner\'s arrow into the storage. Drop the end on the crate and the belt turns into it.',
        progress: (_, sol) => flag(Object.values(sol?.store ?? {}).some(v => v > 0)),
        marker: storageArea
    },
    {
        id: 'two-ores', title: 'Iron and stone', pose: 'idle', reward: { stone: 40 }, focus: 'build:miner',
        say: 'Storage takes anything you feed it. Get iron ore and stone flowing in at the same time.',
        progress: (_, sol) => [(rate(sol, 'iron-ore') > 0 ? 1 : 0) + (rate(sol, 'stone') > 0 ? 1 : 0), 2],
        marker: s => nearestOre(s, 'stone')
    },
    {
        id: 'pick-research', title: 'Pick a research', pose: 'think', reward: { stone: 20 }, focus: 'research',
        say: 'Time to learn something! Open the research tree (T) and pick Smelting.',
        progress: s => flag(s.queue.length > 0 || s.done.length > 0)
    },
    {
        id: 'lab', title: 'Feed a lab', pose: 'point', reward: { 'iron-ore': 30 }, focus: 'build:lab',
        say: 'Research runs on items. Build a Lab from the Storage tab and belt iron ore into it.',
        progress: (s, sol) => flag(Object.values(sol?.lab ?? {}).some(v => v > 0) || s.done.length > 0)
    },
    {
        id: 'smelting', title: 'Learn Smelting', pose: 'think', reward: { stone: 40 },
        say: 'Labs keep working while you\'re away, so feel free to come back later. Finish Smelting.',
        progress: s => flag(s.done.includes('smelting'))
    },
    {
        id: 'plates', title: 'Make iron plates', pose: 'point', reward: { 'iron-plate': 20 }, focus: 'build:smelter',
        say: 'Put a Smelter on a belt between a miner and the storage: ore goes in the back, plates come out the front.',
        progress: (_, sol) => flag(rate(sol, 'iron-plate') > 0)
    },
    {
        id: 'bricks', title: 'Bake bricks', pose: 'idle', reward: { brick: 30 },
        focus: needs('kiln', 'kiln'),
        say: 'Bricks pay for land. Research Kiln in the tree (T), then build one and bake stone into bricks.',
        progress: (_, sol) => flag(rate(sol, 'brick') > 0)
    },
    {
        id: 'land', title: 'Grow your plot', pose: 'cheer', reward: { brick: 40 },
        focus: s => s.done.includes('land-1') ? null : 'research',
        say: 'Research Land I, then click one of the tagged chunks next to your plot to buy it.',
        progress: s => flag(s.chunks.length > START_CHUNKS.length)
    },
    {
        id: 'plates-60', title: '60 plates a minute', pose: 'idle', reward: { 'iron-plate': 60 },
        say: 'One line is a start. Get 60 iron plates a minute into storage. Mergers help join lines.',
        progress: (_, sol) => [Math.min(60, Math.floor(rate(sol, 'iron-plate'))), 60]
    },
    {
        id: 'tier-2', title: 'Open tier 2', pose: 'think', reward: { 'iron-plate': 100, brick: 60 }, focus: 'research',
        say: 'Finish four tier 1 researches and tier 2 opens up: gears, wire, steel and faster belts.',
        progress: s => [Math.min(4, s.done.filter(id => RESEARCH_BY_ID[id]?.tier === 1).length), 4]
    },
    {
        id: 'gears', title: 'Gears', pose: 'point', reward: { gear: 40 },
        focus: needs('press', 'press'),
        say: 'The Press turns plates into gears. Research it and get gears flowing.',
        progress: (_, sol) => flag(rate(sol, 'gear') > 0)
    },
    {
        id: 'steel', title: 'Steel', pose: 'point', reward: { steel: 40 },
        focus: needs('mixer', 'mixer'),
        say: 'The Mixer takes two inputs on its back edge. Feed it iron plates and coal for steel.',
        progress: (_, sol) => flag(rate(sol, 'steel') > 0)
    },
    {
        id: 'tier-3', title: 'Open tier 3', pose: 'cheer', reward: { steel: 100, gear: 100 }, focus: 'research',
        say: 'Five tier 2 researches open tier 3: assemblers, smart splitters and skyways.',
        progress: s => flag(tierOpen(3, s.done))
    },
    {
        id: 'motors', title: 'Motors', pose: 'point', reward: { motor: 20 },
        focus: needs('assembler', 'assembler'),
        say: 'Assemblers take three inputs on their back edge. Build motors from steel, gears and wire.',
        progress: (_, sol) => flag(rate(sol, 'motor') > 0)
    },
    {
        id: 'tier-4', title: 'Open tier 4', pose: 'think', reward: { motor: 60, circuit: 100 }, focus: 'research',
        say: 'Six tier 3 researches open tier 4: oil, plastic and chips.',
        progress: s => flag(tierOpen(4, s.done))
    },
    {
        id: 'chips', title: 'Chips', pose: 'point', reward: { chip: 40 },
        focus: chain([{ research: 'oil' }, { kind: 'pumpjack' }, { kind: 'refinery' }, { research: 'electronics' }, { kind: 'mixer' }]),
        say: 'Research Oil, then pump it and refine plastic. Research Electronics, and a Mixer turns circuits and plastic into chips.',
        progress: (_, sol) => flag(rate(sol, 'chip') > 0)
    },
    {
        id: 'tier-5', title: 'Open tier 5', pose: 'think', reward: { motor: 100, chip: 60 }, focus: 'research',
        say: 'Four tier 4 researches open tier 5: crystal, lenses and the fusion reactor.',
        progress: s => flag(tierOpen(5, s.done))
    },
    {
        id: 'fusion', title: 'Fusion Cores', pose: 'cheer', reward: { lens: 40, chip: 100 },
        focus: chain([{ research: 'crystal' }, { kind: 'crystal-drill' }, { kind: 'grinder' }, { research: 'fusion-reactor' }, { kind: 'reactor' }]),
        say: 'Research Crystal and grind lenses, then research the Fusion reactor. Feed it chips, motors and lenses for a Fusion Core!',
        progress: (_, sol) => flag(rate(sol, 'fusion-core') > 0)
    }
]

/** No prototype, so a made-up id like 'constructor' finds nothing. */
export const GOAL_BY_ID: Record<string, Goal> = Object.assign(Object.create(null), Object.fromEntries(GOALS.map(g => [g.id, g])))

/** The next goal to claim, or null when they're all done. */
export function currentGoal(s: Pick<GridState, 'goals'>): Goal | null {
    return GOALS.find(g => !s.goals.includes(g.id)) ?? null
}

/** What the goal points at right now. */
export function goalFocus(g: Goal, s: GridState): GoalFocus {
    return typeof g.focus === 'function' ? g.focus(s) : g.focus ?? null
}

export function goalMet(g: Goal, s: GridState, sol: Solution | null): boolean {
    const [cur, target] = g.progress(s, sol)
    return cur >= target
}
