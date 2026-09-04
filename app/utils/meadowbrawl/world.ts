// Arena layout in logic space. Purely positional data — the renderer paints
// it, the engine collides with it. Cosmetic placement uses Math.random on
// purpose: nothing here decides an outcome.
import { ARENA_H, ARENA_W } from './types'
import type { SpawnGroup, Vec } from './types'

export interface Obstacle {
    x: number
    y: number
    r: number
    kind: 'boulder' | 'tree'
    seed: number
    /** Visual size for boulders (collision radius is `r`). */
    scale: number
}

export interface TreeDeco {
    x: number
    y: number
    scale: number
    /** 0 = amber, 1 = crimson, 2 = gold, 3 = olive green. */
    palette: number
    seed: number
    inner: boolean
}

export interface Flower {
    x: number
    y: number
    color: string
    size: number
}

export interface Tuft {
    x: number
    y: number
    seed: number
}

export interface WorldLayout {
    w: number
    h: number
    margin: number
    obstacles: Obstacle[]
    trees: TreeDeco[]
    flowers: Flower[]
    tufts: Tuft[]
    leaves: Vec[]
    rocks: { x: number, y: number, r: number, seed: number }[]
    stream: { x: number, width: number, top: number, bottom: number }
    pool: { x: number, y: number, r: number }
    waterfall: { x: number, top: number, bottom: number, width: number }
    cliff: { x0: number, x1: number, y0: number, y1: number }
    bridge: { x0: number, x1: number, y: number, width: number }
    path: Vec[]
    spawn: Record<SpawnGroup['side'], () => Vec>
}

const FLOWER_COLORS = ['#fff7e0', '#ffe066', '#f7a6d2', '#c39bff', '#ff8f6b', '#ffffff', '#ffd1e8']

function rnd(a: number, b: number) {
    return a + Math.random() * (b - a)
}

export function generateWorld(): WorldLayout {
    const w = ARENA_W
    const h = ARENA_H
    const margin = 460
    const streamX = -120
    const bridgeY = 560

    const obstacles: Obstacle[] = []
    const trees: TreeDeco[] = []
    const flowers: Flower[] = []
    const tufts: Tuft[] = []
    const leaves: Vec[] = []
    const rocks: WorldLayout['rocks'] = []

    const path: Vec[] = [
        { x: -260, y: bridgeY },
        { x: 120, y: bridgeY - 20 },
        { x: 420, y: 470 },
        { x: 760, y: 520 },
        { x: 1100, y: 430 },
        { x: w + 300, y: 400 }
    ]

    const farFromCenter = (x: number, y: number, d: number) => Math.hypot(x - w / 2, y - h / 2) > d
    const clearOf = (x: number, y: number, d: number) => obstacles.every(o => Math.hypot(o.x - x, o.y - y) > d + o.r)

    // Inner boulders — cover, but never in the middle where the fight starts.
    let tries = 0
    while (obstacles.filter(o => o.kind === 'boulder').length < 6 && tries++ < 400) {
        const x = rnd(140, w - 140)
        const y = rnd(140, h - 140)
        const r = rnd(24, 40)
        if (!farFromCenter(x, y, 260) || !clearOf(x, y, 150)) continue
        obstacles.push({ x, y, r, kind: 'boulder', seed: Math.random(), scale: r / 30 })
    }

    // A few trees inside the arena for depth; their trunks collide, the
    // canopy fades when the player walks under it.
    tries = 0
    while (obstacles.filter(o => o.kind === 'tree').length < 3 && tries++ < 400) {
        const x = rnd(180, w - 180)
        const y = rnd(160, h - 160)
        if (!farFromCenter(x, y, 320) || !clearOf(x, y, 220)) continue
        obstacles.push({ x, y, r: 13, kind: 'tree', seed: Math.random(), scale: rnd(1.05, 1.3) })
        trees.push({ x, y, scale: rnd(1.05, 1.3), palette: Math.floor(Math.random() * 4), seed: Math.random(), inner: true })
    }

    const cliff = { x0: -margin, x1: 330, y0: -margin, y1: -150 }

    // Perimeter tree line. Two rows, staggered, denser than it needs to be so
    // the arena reads as a clearing in a forest.
    const ring = (count: number, pick: () => Vec) => {
        for (let i = 0; i < count; i++) {
            const p = pick()
            // Keep the cliff, the stream and the bridge approach clear.
            if (p.x < cliff.x1 && p.y < cliff.y1) continue
            if (Math.abs(p.x - streamX) < 110 && p.y > -140) continue
            if (Math.abs(p.y - bridgeY) < 70 && p.x < 60) continue
            trees.push({ x: p.x, y: p.y, scale: rnd(0.9, 1.5), palette: Math.floor(Math.random() * 4), seed: Math.random(), inner: false })
        }
    }
    ring(34, () => ({ x: rnd(-margin, w + margin), y: rnd(-margin + 60, -90) }))
    ring(34, () => ({ x: rnd(-margin, w + margin), y: rnd(h + 70, h + margin - 60) }))
    ring(20, () => ({ x: rnd(w + 70, w + margin - 60), y: rnd(-100, h + 100) }))
    ring(20, () => ({ x: rnd(-margin, -210), y: rnd(-100, h + 100) }))

    // Wildflower drifts.
    for (let c = 0; c < 46; c++) {
        const cx = rnd(-margin + 80, w + margin - 80)
        const cy = rnd(-160, h + 160)
        if (Math.abs(cx - streamX) < 90) continue
        const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)]!
        const n = 6 + Math.floor(Math.random() * 12)
        for (let i = 0; i < n; i++) {
            flowers.push({ x: cx + rnd(-60, 60), y: cy + rnd(-40, 40), color: Math.random() < 0.75 ? color : FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)]!, size: rnd(2.2, 3.6) })
        }
    }
    for (let i = 0; i < 700; i++) {
        const x = rnd(-margin, w + margin)
        const y = rnd(-margin, h + margin)
        if (Math.abs(x - streamX) < 70 && y > -150) continue
        tufts.push({ x, y, seed: Math.random() })
    }
    for (const t of trees) {
        const n = 6 + Math.floor(Math.random() * 8)
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2
            const d = rnd(20, 110) * t.scale
            leaves.push({ x: t.x + Math.cos(a) * d, y: t.y + Math.sin(a) * d * 0.7 })
        }
    }
    // Rocks along the stream and the pool.
    for (let i = 0; i < 26; i++) {
        const y = rnd(-40, h + 300)
        const side = Math.random() < 0.5 ? -1 : 1
        if (Math.abs(y - bridgeY) < 60) continue
        rocks.push({ x: streamX + side * rnd(44, 62), y, r: rnd(5, 11), seed: Math.random() })
    }
    for (let i = 0; i < 12; i++) {
        const a = rnd(0.2, Math.PI - 0.2)
        rocks.push({ x: streamX + Math.cos(a) * 96, y: -70 + Math.sin(a) * 76, r: rnd(7, 14), seed: Math.random() })
    }
    for (let i = 0; i < 18; i++) {
        rocks.push({ x: rnd(-margin, w + margin), y: rnd(-margin, h + margin), r: rnd(4, 9), seed: Math.random() })
    }

    const spawn: WorldLayout['spawn'] = {
        north: () => ({ x: rnd(220, w - 220), y: -60 }),
        east: () => ({ x: w + 60, y: rnd(140, h - 140) }),
        south: () => ({ x: rnd(220, w - 220), y: h + 60 }),
        west: () => ({ x: -90, y: bridgeY + rnd(-22, 22) })
    }

    return {
        w,
        h,
        margin,
        obstacles,
        trees,
        flowers,
        tufts,
        leaves,
        rocks,
        stream: { x: streamX, width: 76, top: -80, bottom: h + margin },
        pool: { x: streamX, y: -70, r: 84 },
        waterfall: { x: streamX, top: -300, bottom: -100, width: 54 },
        cliff,
        bridge: { x0: streamX - 78, x1: streamX + 78, y: bridgeY, width: 72 },
        path,
        spawn
    }
}
