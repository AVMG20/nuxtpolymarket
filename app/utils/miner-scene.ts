/**
 * Shared drawing helpers for the /miner pixi scenes.
 *
 * Every miner page renders one interactive scene instead of a stack of cards:
 * the machines ARE the buttons. These helpers keep the four scenes visually
 * consistent (same palette, same rock, same coin physics) without each one
 * re-deriving it.
 *
 * Pixi is imported dynamically by the components, so nothing here may import
 * it at module scope — the types are kept loose on purpose.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PALETTE = {
    rockDeep: 0x140f0c,
    rock: 0x241c16,
    rockLit: 0x35291f,
    rockEdge: 0x4a382a,
    gold: 0xfbbf24,
    goldDark: 0xb45309,
    goldLight: 0xfde68a,
    cyan: 0x22d3ee,
    cyanDark: 0x0e7490,
    cyanLight: 0xa5f3fc,
    steel: 0x5b6b7f,
    steelDark: 0x2b3542,
    steelLight: 0x9fb0c3,
    danger: 0xf87171,
    lamp: 0xffd68a
} as const

/** Deterministic 0..1 noise — same shape every mount, no hydration surprises. */
export function noise(seed: number) {
    const x = Math.sin(seed * 127.1) * 43758.5453
    return x - Math.floor(x)
}

export function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
}

export function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v))
}

/** Mix two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, t: number) {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
    return ((Math.round(lerp(ar, br, t)) << 16)
        | (Math.round(lerp(ag, bg, t)) << 8)
        | Math.round(lerp(ab, bb, t)))
}

/**
 * Layered rock backdrop: strata bands, scattered pebbles and a soft lamp glow
 * at the top of the frame. Drawn once per resize into a single Graphics.
 */
export function drawRock(g: any, w: number, h: number, opts: { warm?: number, seed?: number } = {}) {
    const warm = opts.warm ?? 0
    const seed = opts.seed ?? 1
    g.clear()
    g.rect(0, 0, w, h).fill({ color: mixColor(PALETTE.rockDeep, 0x2a1a10, warm) })

    // Strata: wavy horizontal bands, lighter near the top.
    const bands = 9
    for (let i = 0; i < bands; i++) {
        const t = i / bands
        const y = h * t
        const band = h / bands
        const shade = mixColor(PALETTE.rock, PALETTE.rockDeep, t * 0.8)
        g.moveTo(0, y)
        const steps = 8
        for (let s = 0; s <= steps; s++) {
            const px = (w * s) / steps
            const wobble = (noise(seed + i * 7.3 + s * 1.7) - 0.5) * band * 0.55
            g.lineTo(px, y + wobble)
        }
        g.lineTo(w, y + band)
        g.lineTo(0, y + band)
        g.closePath()
        g.fill({ color: shade, alpha: 0.55 })
    }

    // Pebbles / ore flecks.
    for (let i = 0; i < 70; i++) {
        const px = noise(seed + i * 3.1) * w
        const py = noise(seed + i * 5.7 + 11) * h
        const r = 1 + noise(seed + i * 9.4) * 2.6
        const ore = noise(seed + i * 13.2) > 0.86
        g.circle(px, py, r).fill({
            color: ore ? PALETTE.gold : PALETTE.rockEdge,
            alpha: ore ? 0.35 : 0.18
        })
    }

    // Lamp wash from the top edge.
    for (let i = 0; i < 6; i++) {
        const t = i / 6
        g.rect(0, 0, w, h * 0.42 * (1 - t)).fill({ color: PALETTE.lamp, alpha: 0.018 })
    }

    // Vignette.
    for (let i = 0; i < 5; i++) {
        const inset = i * 5
        g.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({ color: 0x000000, width: 10, alpha: 0.06 })
    }
}

/** Rounded metal plate with a highlight edge — the base of most machines. */
export function drawPlate(g: any, x: number, y: number, w: number, h: number, color: number = PALETTE.steelDark, radius = 6) {
    g.roundRect(x, y, w, h, radius).fill({ color })
    g.roundRect(x + 1.5, y + 1.5, w - 3, h * 0.42, radius).fill({ color: PALETTE.steel, alpha: 0.35 })
    g.roundRect(x, y, w, h, radius).stroke({ color: PALETTE.steelLight, width: 1, alpha: 0.35 })
}

/** Bolt studs along a plate edge — cheap way to read as "machine". */
export function drawBolts(g: any, x: number, y: number, w: number, count = 4) {
    for (let i = 0; i < count; i++) {
        const px = x + ((i + 0.5) / count) * w
        g.circle(px, y, 1.8).fill({ color: PALETTE.steelLight, alpha: 0.5 })
    }
}

export interface Particle {
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
    size: number
    color: number
    gravity: number
    spin: number
    rot: number
    shape: 'coin' | 'shard' | 'spark'
}

/**
 * Tiny particle pool shared by every scene: coins riding to the vault, gem
 * shards popping out of the press, sparks off a drill bit.
 */
export class Particles {
    list: Particle[] = []

    spawn(p: Partial<Particle> & { x: number, y: number }) {
        if (this.list.length > 320) this.list.shift()
        this.list.push({
            vx: 0,
            vy: 0,
            life: 1,
            maxLife: 1,
            size: 4,
            color: PALETTE.gold,
            gravity: 0,
            spin: 0,
            rot: 0,
            shape: 'spark',
            ...p
        })
    }

    /** A coin arcing from (x,y) toward a target point, landing in ~`seconds`. */
    spawnArc(x: number, y: number, tx: number, ty: number, seconds: number, color: number = PALETTE.gold, size = 5) {
        const gravity = 900
        const vx = (tx - x) / seconds
        const vy = (ty - y) / seconds - 0.5 * gravity * seconds
        this.spawn({
            x, y, vx, vy, gravity, color, size,
            life: seconds, maxLife: seconds,
            shape: 'coin',
            spin: (Math.random() - 0.5) * 14
        })
    }

    burst(x: number, y: number, count: number, color: number, opts: { speed?: number, size?: number, shape?: Particle['shape'], gravity?: number } = {}) {
        const speed = opts.speed ?? 220
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
            const s = speed * (0.45 + Math.random() * 0.75)
            this.spawn({
                x, y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s - speed * 0.35,
                gravity: opts.gravity ?? 620,
                color,
                size: opts.size ?? 4 + Math.random() * 3,
                life: 0.7 + Math.random() * 0.6,
                maxLife: 1.3,
                shape: opts.shape ?? 'coin',
                spin: (Math.random() - 0.5) * 16
            })
        }
    }

    update(dt: number) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i]!
            p.life -= dt
            if (p.life <= 0) {
                this.list.splice(i, 1)
                continue
            }
            p.vy += p.gravity * dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.rot += p.spin * dt
        }
    }

    draw(g: any) {
        g.clear()
        for (const p of this.list) {
            const alpha = clamp(p.life / (p.maxLife * 0.45), 0, 1)
            if (p.shape === 'coin') {
                // Squash horizontally as it "spins" — reads as a tumbling coin.
                const squash = Math.abs(Math.cos(p.rot))
                g.ellipse(p.x, p.y, Math.max(0.8, p.size * squash), p.size).fill({ color: p.color, alpha })
                g.ellipse(p.x, p.y, Math.max(0.4, p.size * squash * 0.5), p.size * 0.5)
                    .fill({ color: PALETTE.goldLight, alpha: alpha * 0.5 })
            } else if (p.shape === 'shard') {
                const s = p.size
                g.moveTo(p.x, p.y - s)
                g.lineTo(p.x + s * 0.6, p.y)
                g.lineTo(p.x, p.y + s)
                g.lineTo(p.x - s * 0.6, p.y)
                g.closePath()
                g.fill({ color: p.color, alpha })
            } else {
                g.circle(p.x, p.y, p.size * 0.5).fill({ color: p.color, alpha })
            }
        }
    }

    clear() {
        this.list = []
    }
}

/**
 * Machine build stages. Upgrades are meant to be *seen*, so every scene maps
 * its level onto a small number of visual stages: new drills bolt on, the silo
 * grows a ring, another crystal pillar lights up.
 */
export function stageOf(level: number, perStage: number, maxStages: number) {
    return clamp(Math.floor((level - 1) / perStage), 0, maxStages - 1)
}

/** 0..1 progress through the current stage — drives partial/ghosted parts. */
export function stageProgress(level: number, perStage: number) {
    return ((level - 1) % perStage) / perStage
}

// ─── Mine crew + storage tiers ───────────────────────────────────────────────
// Shared between the scene and the page copy so the two never disagree about
// how many miners are on screen or what the storage is currently called.

/** A new stick-figure miner joins the crew every this many rig levels. */
export const MINERS_PER_RIG_LEVEL = 5
export const MAX_MINERS = 14

export function minerCrewSize(rigLevel: number) {
    return clamp(1 + Math.floor((rigLevel - 1) / MINERS_PER_RIG_LEVEL), 1, MAX_MINERS)
}

/** Rig level at which the next miner shows up, or null once the crew is full. */
export function nextMinerAtLevel(rigLevel: number) {
    if (minerCrewSize(rigLevel) >= MAX_MINERS) return null
    return (Math.floor((rigLevel - 1) / MINERS_PER_RIG_LEVEL) + 1) * MINERS_PER_RIG_LEVEL + 1
}

/** Storage tiers, in build order — a loose coin pile up to a bank vault. */
export const STORAGE_TIERS = ['Coin pile', 'Crate stack', 'Timber shed', 'Stone depot', 'Warehouse', 'Bank vault']
export const VAULT_LEVELS_PER_TIER = 17

export function storageTierIndex(vaultLevel: number) {
    return stageOf(vaultLevel, VAULT_LEVELS_PER_TIER, STORAGE_TIERS.length)
}

export function storageTierName(vaultLevel: number) {
    return STORAGE_TIERS[storageTierIndex(vaultLevel)] ?? 'Storage'
}

/** Vault level at which the storage becomes the next building, or null at the top. */
export function nextStorageTierAt(vaultLevel: number) {
    const idx = storageTierIndex(vaultLevel)
    if (idx >= STORAGE_TIERS.length - 1) return null
    return (idx + 1) * VAULT_LEVELS_PER_TIER + 1
}

// ─── Stick-figure miner ──────────────────────────────────────────────────────
/**
 * The little worker that appears across the miner scenes: helmet with a lamp,
 * swinging pickaxe, ore cradled in both hands on the walk back. Drawn from
 * lines so it scales with `unit` and costs almost nothing per frame.
 */
export interface StickFigureOpts {
    x: number
    /** Y of the ground the figure stands on. */
    baseY: number
    /** Body height is ~1.9 units. */
    unit: number
    dir: 1 | -1
    /** 0..1 through a pickaxe swing, or null when not swinging. */
    swing: number | null
    /** Walk cycle phase in radians; 0 for a planted stance. */
    walk: number
    carrying?: number
    helmet?: number
    /** Colour of the ore/gem being carried. */
    cargoColor?: number
    lampCone?: boolean
}

export function drawStickFigure(g: any, o: StickFigureOpts) {
    const u = o.unit
    const s = u * 1.9
    const baseY = o.baseY
    const hipY = baseY - s * 0.45
    const shoulderY = baseY - s * 0.74
    const headR = s * 0.13
    const headY = baseY - s * 0.88
    const dir = o.dir
    const mining = o.swing !== null
    const stride = o.walk ? Math.sin(o.walk) * 0.5 : 0.18
    const lean = mining ? dir * -0.12 : 0
    const body = 0xe7e5e4
    const lw = Math.max(1.6, u * 0.11)
    const helmet = o.helmet ?? PALETTE.gold

    g.ellipse(o.x, baseY + 1, s * 0.24, s * 0.06).fill({ color: 0x000000, alpha: 0.35 })

    g.moveTo(o.x, hipY).lineTo(o.x + stride * s * 0.22, baseY).stroke({ color: body, width: lw })
    g.moveTo(o.x, hipY).lineTo(o.x - stride * s * 0.22, baseY).stroke({ color: body, width: lw })

    const shoulderX = o.x + lean * s
    g.moveTo(o.x, hipY).lineTo(shoulderX, shoulderY).stroke({ color: body, width: lw * 1.15 })

    const swingV = mining ? Math.sin((o.swing ?? 0) * Math.PI * 2) : 0
    const handX = shoulderX + dir * s * (mining ? 0.3 : 0.16)
    const handY = shoulderY + s * (mining ? 0.05 + swingV * 0.22 : 0.2)
    g.moveTo(shoulderX, shoulderY).lineTo(handX, handY).stroke({ color: body, width: lw })

    if (o.carrying) {
        g.circle(handX + dir * s * 0.06, handY, s * 0.1).fill({ color: o.cargoColor ?? PALETTE.gold })
        g.circle(handX + dir * s * 0.04, handY - s * 0.03, s * 0.04)
            .fill({ color: PALETTE.goldLight, alpha: 0.75 })
    } else {
        const axeAngle = mining ? -0.9 + swingV * 1.5 : -0.4
        const tipX = handX + dir * Math.cos(axeAngle) * s * 0.6
        const tipY = handY + Math.sin(axeAngle) * s * 0.6
        g.moveTo(handX, handY).lineTo(tipX, tipY).stroke({ color: 0x8b5a2b, width: lw })
        g.moveTo(tipX - dir * s * 0.14, tipY - s * 0.1)
        g.lineTo(tipX + dir * s * 0.1, tipY + s * 0.02)
        g.lineTo(tipX - dir * s * 0.12, tipY + s * 0.12)
        g.stroke({ color: PALETTE.steelLight, width: lw * 1.1 })
    }

    const headX = o.x + lean * s * 1.1
    g.circle(headX, headY, headR).fill({ color: 0xf5f5f4 })
    g.moveTo(headX - headR * 1.25, headY - headR * 0.15)
    g.arc(headX, headY - headR * 0.15, headR * 1.25, Math.PI, 0)
    g.fill({ color: helmet })
    const lampX = headX + dir * headR * 0.9
    g.circle(lampX, headY - headR * 0.2, headR * 0.3).fill({ color: PALETTE.lamp })
    if (o.lampCone !== false) {
        g.moveTo(lampX, headY - headR * 0.2)
        g.lineTo(lampX + dir * u * 2.2, headY - u * 0.55)
        g.lineTo(lampX + dir * u * 2.2, headY + u * 0.75)
        g.closePath()
        g.fill({ color: PALETTE.lamp, alpha: 0.035 })
    }
}
