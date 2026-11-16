// Gridworks goals: Cog's guided first steps, then milestones. Each one is
// checked against the plot, and its reward (items, never coins) is claimed
// once, in order.
import { START_CHUNKS, type ItemId, type Kind, type Stock } from './defs'
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

/** Whether a miner stands on ore of this kind. */
function minerOn(s: GridState, ore: ItemId) {
    const map = oreMap(s.seed)
    return s.entities.some(e => e.k === 'miner' && oreAt(map, e.x, e.y) === ore)
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
        id: 'hand-mine', title: 'Mine by hand', pose: 'point', reward: { stone: 20 },
        say: 'Hi, I\'m Cog! This lit square is your plot. Click an iron ore rock to dig it up, and hold the button to keep digging. Grab 10!',
        progress: s => [Math.min(10, s.mined), 10],
        marker: s => nearestOre(s, 'iron-ore')
    },
    {
        id: 'first-belt', title: 'Your first line', pose: 'point', reward: { 'iron-ore': 50, stone: 60 },
        focus: s => minerOn(s, 'iron-ore') ? 'build:belt' : 'build:miner',
        say: 'Drop a Miner from Production on iron ore (R turns its arrow), then drag a belt from the arrow into the storage crate.',
        progress: (_, sol) => flag(rate(sol, 'iron-ore') > 0),
        marker: s => minerOn(s, 'iron-ore') ? storageArea(s) : nearestOre(s, 'iron-ore')
    },
    {
        id: 'smelting', title: 'Learn Smelting', pose: 'think', reward: { 'iron-ore': 30, stone: 60 },
        focus: s => s.done.includes('smelting') ? null : !s.queue.length ? 'research' : has(s, 'lab') ? null : 'build:lab',
        say: 'Open the research tree (T) and pick Smelting. Then build a Lab from the Storage tab and belt iron ore into it. Labs keep working while you\'re away.',
        progress: s => flag(s.done.includes('smelting'))
    },
    {
        id: 'plates', title: 'Make iron plates', pose: 'point', reward: { 'iron-plate': 80 }, focus: 'build:smelter',
        say: 'Build a Smelter. Plates come out of the side with the arrow; belt iron ore into any other side, then belt the plates into the storage.',
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
        id: 'gears', title: 'Gears', pose: 'point', reward: { gear: 40, 'iron-plate': 100, brick: 60 },
        focus: needs('press', 'press'),
        say: 'Four tier 1 researches open tier 2. Research the Press there and turn plates into gears.',
        progress: (_, sol) => flag(rate(sol, 'gear') > 0)
    },
    {
        id: 'steel', title: 'Steel', pose: 'point', reward: { steel: 40 },
        focus: needs('mixer', 'mixer'),
        say: 'The Mixer takes two inputs on its back edge. Feed it iron plates and coal for steel.',
        progress: (_, sol) => flag(rate(sol, 'steel') > 0)
    },
    {
        id: 'motors', title: 'Motors', pose: 'point', reward: { motor: 20, steel: 100, gear: 100 },
        focus: needs('assembler', 'assembler'),
        say: 'Five tier 2 researches open tier 3. Research the Assembler and build motors from steel, gears and wire.',
        progress: (_, sol) => flag(rate(sol, 'motor') > 0)
    },
    {
        id: 'chips', title: 'Chips', pose: 'point', reward: { chip: 40, motor: 60, circuit: 100 },
        focus: chain([{ research: 'oil' }, { kind: 'pumpjack' }, { kind: 'refinery' }, { research: 'electronics' }, { kind: 'mixer' }]),
        say: 'Six tier 3 researches open tier 4. Research Oil, pump it and refine plastic, then research Electronics: a Mixer turns circuits and plastic into chips.',
        progress: (_, sol) => flag(rate(sol, 'chip') > 0)
    },
    {
        id: 'fusion', title: 'Fusion Cores', pose: 'cheer', reward: { lens: 40, chip: 160, motor: 100 },
        focus: chain([{ research: 'crystal' }, { kind: 'crystal-drill' }, { kind: 'grinder' }, { research: 'fusion-reactor' }, { kind: 'reactor' }]),
        say: 'Four tier 4 researches open tier 5. Research Crystal and grind lenses, then the Fusion reactor: feed it chips, motors and lenses for a Fusion Core!',
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
