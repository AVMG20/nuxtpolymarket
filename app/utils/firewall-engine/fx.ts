import { Container, Graphics, Text } from 'pixi.js'
import type { TextStyleOptions } from 'pixi.js'
import gsap from 'gsap'
import {
    CORE_X, CORE_Y, GRID_COLS, GRID_ROWS, HORIZON_Y, LANE_FAR_Y, LANE_NEAR_Y,
    MOUNTS_PER_FLOOR, MUZZLE_X, RIDGE_LAYERS, SPIKE_BAND, STAR_COUNT,
    TOWER_FLOOR_H, TOWER_ROOF_H, TOWER_W, TOWER_X, VIEW_H, VIEW_W, WALL_TOP_Y, WALL_X,
    mountPosition, muzzleY, towerFloors, towerTopY
} from './constants'
import { clamp, lerp, mixHex, randRange, shadeHex } from './math'
import type { FigureRig } from './types'
import type {
    FirewallEnemyDefinition, FirewallProjectile, FirewallTurretId
} from '#shared/utils/gamelogic/firewall'

/**
 * Nothing here is an image. Every figure, panel and spark is Graphics geometry
 * built once and then animated by transform, which is what keeps a screen with
 * sixty silhouettes on it cheap: no per-frame redraws except the handful of
 * meters that genuinely change shape.
 */

// ─── Palette ────────────────────────────────────────────────────────────────

export const INK = 0x070a12
export const STEEL = 0x1b2436
export const CYAN = 0x22d3ee
export const AMBER = 0xfbbf24
export const RED = 0xf87171
export const LIME = 0x4ade80

/**
 * Every looping tween started here is tracked, because the display objects they
 * drive are destroyed between runs and a `repeat: -1` tween pointed at a dead
 * container throws on its next frame.
 */
const tracked: gsap.core.Tween[] = []

function track<T extends gsap.core.Tween>(tween: T): T {
    tracked.push(tween)
    return tween
}

export function killFxTweens() {
    for (const tween of tracked) tween.kill()
    tracked.length = 0
}

/**
 * Deliberately a plain options object, not a `TextStyle`. Pixi holds a
 * `TextStyle` by reference, so a single shared instance means restyling one
 * damage number restyles every label on screen. Spread it per label.
 */
const LABEL_STYLE: TextStyleOptions = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 15,
    fontWeight: '700',
    fill: 0xffffff
}

// ─── Backdrop ───────────────────────────────────────────────────────────────

/**
 * The sky is banded rather than gradient-filled. Bands are one draw call all
 * told and render identically everywhere, which a real gradient fill does not.
 */
export function drawSky(gfx: Graphics) {
    const bands = 46
    const top = 0x05070f
    const bottom = 0x122036
    for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1)
        const y = (HORIZON_Y / bands) * i
        gfx.rect(0, y - 1, VIEW_W, HORIZON_Y / bands + 2)
            .fill({ color: mixHex(top, bottom, Math.pow(t, 1.6)) })
    }
    // Cold dawn glow sitting on the horizon, behind the ridges.
    for (let i = 0; i < 7; i++) {
        const spread = 460 - i * 52
        gfx.ellipse(VIEW_W * 0.24, HORIZON_Y, spread, spread * 0.34)
            .fill({ color: 0x1e3a5f, alpha: 0.16 })
    }
    gfx.circle(VIEW_W * 0.24, HORIZON_Y - 30, 26).fill({ color: 0x93c5fd, alpha: 0.5 })
    gfx.circle(VIEW_W * 0.24, HORIZON_Y - 30, 13).fill({ color: 0xe0f2fe, alpha: 0.9 })
}

export function buildStars() {
    const gfx = new Graphics()
    for (let i = 0; i < STAR_COUNT; i++) {
        const x = randRange(0, VIEW_W)
        const y = randRange(0, HORIZON_Y - 40)
        const r = randRange(0.6, 1.7)
        // Fade the field out toward the horizon so the ridges stay readable.
        const alpha = randRange(0.2, 0.9) * (1 - y / HORIZON_Y)
        gfx.circle(x, y, r).fill({ color: 0xdbeafe, alpha })
    }
    track(gsap.to(gfx, { alpha: 0.65, duration: 3.4, repeat: -1, yoyo: true, ease: 'sine.inOut' }))
    return gfx
}

/** Dead server-farm skyline on the horizon — two layers, back one paler. */
export function buildRidges() {
    const root = new Container()
    for (const layer of RIDGE_LAYERS) {
        const gfx = new Graphics()
        const step = VIEW_W / layer.jags
        for (let i = 0; i <= layer.jags; i++) {
            const x = i * step
            const h = randRange(layer.height * 0.35, layer.height)
            const w = step * randRange(0.55, 0.95)
            gfx.rect(x - w / 2, layer.y + layer.height - h, w, h + 60)
                .fill({ color: layer.hex, alpha: layer.alpha })
            // A single lit window per block: enough to say "occupied", not enough
            // to pull the eye off the field.
            if (Math.random() < 0.5) {
                gfx.rect(x - 2, layer.y + layer.height - h + 8, 4, 4)
                    .fill({ color: 0x38bdf8, alpha: 0.5 })
            }
        }
        gfx.rect(0, layer.y + layer.height, VIEW_W, 80).fill({ color: layer.hex, alpha: layer.alpha })
        root.addChild(gfx)
    }
    return root
}

/**
 * The plain. A faked perspective grid: row spacing eases toward the bottom and
 * columns fan out from a vanishing point, which is cheaper and more controllable
 * than an actual projection and never puts a line where a lane is.
 */
export function drawGround(gfx: Graphics) {
    gfx.rect(0, HORIZON_Y, VIEW_W, VIEW_H - HORIZON_Y).fill({ color: 0x080c15 })

    const vanishX = VIEW_W * 0.42
    for (let c = 0; c <= GRID_COLS; c++) {
        const t = c / GRID_COLS
        const farX = lerp(-VIEW_W * 0.2, VIEW_W * 1.2, t)
        const nearX = vanishX + (farX - vanishX) * 4.6
        gfx.moveTo(farX, HORIZON_Y).lineTo(nearX, VIEW_H)
            .stroke({ width: 1, color: 0x1e3a5f, alpha: 0.35 })
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
        const t = r / GRID_ROWS
        const y = HORIZON_Y + (VIEW_H - HORIZON_Y) * Math.pow(t, 2.1)
        gfx.moveTo(0, y).lineTo(VIEW_W, y)
            .stroke({ width: 1, color: 0x1e3a5f, alpha: 0.25 + t * 0.3 })
    }
    // Horizon seam — the brightest line on the plain, so the eye settles there.
    gfx.moveTo(0, HORIZON_Y).lineTo(VIEW_W, HORIZON_Y).stroke({ width: 2, color: 0x38bdf8, alpha: 0.45 })
    gfx.rect(0, HORIZON_Y, VIEW_W, 26).fill({ color: 0x38bdf8, alpha: 0.05 })
}

/** Darkens the frame edges so the HUD sits on something. */
export function drawVignette(gfx: Graphics) {
    const steps = 22
    for (let i = 0; i < steps; i++) {
        const inset = i * 5
        gfx.rect(inset, inset, VIEW_W - inset * 2, VIEW_H - inset * 2)
            .stroke({ width: 5, color: 0x000000, alpha: 0.05 })
    }
}

// ─── The bastion ────────────────────────────────────────────────────────────

export interface BastionParts {
    root: Container
    /** Redrawn as integrity drops — cracks, scorch, dead panels. */
    damage: Graphics
    /** The core diamond, recoloured by integrity and pulsed continuously. */
    core: Graphics
    /** Overshield dome, redrawn per frame while it is up. */
    shield: Graphics
    /** Player's rail, rotated to the aim vector. */
    turret: Container
    barrel: Container
    /** Flashes white when the wall is struck. */
    hitFlash: Graphics
}

/**
 * The bastion, built for a mount count.
 *
 * The wall never moves; the tower on top of it does. One storey per pair of
 * mounts means the building on screen is a direct readout of how much has been
 * spent on it, and the mounts spread across each storey's outer edges instead of
 * lining up along the parapet — a row of guns in one place reads as one gun.
 */
export function buildBastion(slots: number): BastionParts {
    const root = new Container()
    const floors = towerFloors(slots)
    const towerTop = towerTopY(slots)
    const shaftTop = towerTop + TOWER_ROOF_H

    const body = new Graphics()
    const groundY = VIEW_H + 10

    // ── The wall ──
    body.rect(WALL_X, WALL_TOP_Y - 4, VIEW_W - WALL_X, groundY - WALL_TOP_Y).fill({ color: 0x131c2c })
    body.rect(WALL_X, WALL_TOP_Y - 4, 26, groundY - WALL_TOP_Y).fill({ color: 0x1d2a40 })
    for (let y = WALL_TOP_Y + 26; y < VIEW_H; y += 54) {
        body.moveTo(WALL_X, y).lineTo(VIEW_W, y).stroke({ width: 2, color: 0x0a111c, alpha: 0.9 })
    }
    for (let x = WALL_X + 60; x < VIEW_W; x += 74) {
        body.moveTo(x, WALL_TOP_Y).lineTo(x, VIEW_H).stroke({ width: 2, color: 0x0a111c, alpha: 0.6 })
    }
    // Lit conduits running up the face — the only warm thing in the scene.
    for (let x = WALL_X + 34; x < VIEW_W; x += 74) {
        body.rect(x, WALL_TOP_Y + 40, 3, VIEW_H - WALL_TOP_Y - 40).fill({ color: CYAN, alpha: 0.18 })
    }
    // Parapet and crenellations.
    body.rect(WALL_X - 12, WALL_TOP_Y - 20, VIEW_W - WALL_X + 12, 24).fill({ color: 0x24334c })
    for (let x = WALL_X - 8; x < VIEW_W; x += 40) {
        body.rect(x, WALL_TOP_Y - 36, 22, 18).fill({ color: 0x1d2a40 })
    }

    // ── The tower shaft ──
    body.rect(TOWER_X, shaftTop, TOWER_W, WALL_TOP_Y - shaftTop).fill({ color: 0x18243a })
    body.rect(TOWER_X, shaftTop, 10, WALL_TOP_Y - shaftTop).fill({ color: 0x1f2d46 })
    body.rect(TOWER_X + TOWER_W - 10, shaftTop, 10, WALL_TOP_Y - shaftTop).fill({ color: 0x111a2a })

    for (let floor = 0; floor < floors; floor++) {
        const floorTop = WALL_TOP_Y - (floor + 1) * TOWER_FLOOR_H
        // Slab between storeys, so the count is countable at a glance.
        body.rect(TOWER_X - 6, floorTop, TOWER_W + 12, 7).fill({ color: 0x2b3d5c })
        body.rect(TOWER_X - 6, floorTop, TOWER_W + 12, 2).fill({ color: 0x486590, alpha: 0.9 })
        // Glass band. Higher storeys are lit a little brighter, which gives the
        // tower a top rather than reading as an extruded rectangle.
        body.rect(TOWER_X + 22, floorTop + 18, TOWER_W - 44, TOWER_FLOOR_H - 32)
            .fill({ color: 0x0b1220, alpha: 0.85 })
        body.rect(TOWER_X + 22, floorTop + 18, TOWER_W - 44, TOWER_FLOOR_H - 32)
            .stroke({ width: 1.5, color: CYAN, alpha: 0.14 + floor * 0.05 })
        for (let i = 0; i < 3; i++) {
            body.rect(TOWER_X + 34 + i * ((TOWER_W - 68) / 3), floorTop + 26, 10, TOWER_FLOOR_H - 48)
                .fill({ color: CYAN, alpha: 0.08 + floor * 0.03 })
        }
    }

    // ── Balconies ──
    // Every mount the tower *could* hold gets its pad, so an empty one still
    // reads as a place a turret goes rather than as a missing piece of building.
    const pads = new Graphics()
    for (let slot = 0; slot < floors * MOUNTS_PER_FLOOR; slot++) {
        const mount = mountPosition(slot)
        const inner = mount.x - mount.facing * 4
        const outer = mount.x + mount.facing * 26
        pads.poly([
            inner, mount.y - 6,
            outer, mount.y - 2,
            outer, mount.y + 9,
            inner, mount.y + 13
        ]).fill({ color: 0x24334c })
        pads.poly([inner, mount.y - 6, outer, mount.y - 2, outer, mount.y + 1, inner, mount.y - 3])
            .fill({ color: 0x486590, alpha: 0.8 })
        // Strut back to the shaft, so the balcony is carried by something.
        pads.poly([inner, mount.y + 13, outer, mount.y + 9, inner, mount.y + 26])
            .fill({ color: 0x141e30 })
    }

    // ── Roof and beacon ──
    body.rect(TOWER_X - 12, towerTop, TOWER_W + 24, TOWER_ROOF_H).fill({ color: 0x24334c })
    body.rect(TOWER_X - 12, towerTop, TOWER_W + 24, 5).fill({ color: 0x486590 })
    body.rect(TOWER_X + 16, towerTop - 9, TOWER_W - 32, 10).fill({ color: 0x1d2a40 })

    const beacon = new Graphics()
    const beaconY = towerTop - 15
    beacon.circle(TOWER_X + TOWER_W - 26, beaconY, 5).fill({ color: RED })
    beacon.circle(TOWER_X + TOWER_W - 26, beaconY, 13).fill({ color: RED, alpha: 0.2 })
    track(gsap.to(beacon, { alpha: 0.25, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut' }))

    const damage = new Graphics()
    const core = new Graphics()
    const shield = new Graphics()
    const hitFlash = new Graphics()
    hitFlash.rect(WALL_X - 14, WALL_TOP_Y - 40, VIEW_W - WALL_X + 14, VIEW_H - WALL_TOP_Y + 40)
        .fill({ color: 0xffffff })
    hitFlash.alpha = 0
    hitFlash.blendMode = 'add'

    const rail = buildRail()
    rail.root.position.set(MUZZLE_X, muzzleY(slots))

    root.addChild(body, pads, damage, core, beacon, rail.root, shield, hitFlash)
    drawCore(core, 1)
    track(gsap.to(core.scale, { x: 1.06, y: 1.06, duration: 1.5, repeat: -1, yoyo: true, ease: 'sine.inOut' }))

    return { root, damage, core, shield, turret: rail.root, barrel: rail.barrel, hitFlash }
}

/** The diamond behind the ground-storey glass. Colour is the integrity readout. */
export function drawCore(gfx: Graphics, integrity: number) {
    const hex = integrity > 0.55 ? CYAN : integrity > 0.25 ? AMBER : RED
    gfx.clear()
    gfx.poly([CORE_X, CORE_Y - 26, CORE_X + 20, CORE_Y, CORE_X, CORE_Y + 26, CORE_X - 20, CORE_Y])
        .fill({ color: hex, alpha: 0.22 })
    gfx.poly([CORE_X, CORE_Y - 17, CORE_X + 13, CORE_Y, CORE_X, CORE_Y + 17, CORE_X - 13, CORE_Y])
        .fill({ color: hex, alpha: 0.55 })
    gfx.poly([CORE_X, CORE_Y - 8, CORE_X + 6, CORE_Y, CORE_X, CORE_Y + 8, CORE_X - 6, CORE_Y])
        .fill({ color: 0xffffff, alpha: 0.85 })
    gfx.pivot.set(CORE_X, CORE_Y)
    gfx.position.set(CORE_X, CORE_Y)
}

/**
 * Damage decals, drawn in buckets rather than continuously — a redraw per hit
 * on a full-height Graphics is wasted work nobody can see.
 */
export function drawWallDamage(gfx: Graphics, integrity: number) {
    gfx.clear()
    if (integrity >= 0.98) return
    const severity = 1 - integrity
    const topY = WALL_TOP_Y
    // Many short fractures rather than a few long ones. Two big zigzags on a
    // dark wall read as stray glyphs; a spread of small ones reads as damage.
    const cracks = Math.max(4, Math.round(severity * 34))
    for (let i = 0; i < cracks; i++) {
        // Deterministic scatter seeded off the index, so a given damage level
        // always draws the same cracks and the wall does not fizz frame to frame.
        const seed = i * 97.13
        const x = WALL_X + 16 + ((seed * 7.7) % (VIEW_W - WALL_X - 32))
        const y = topY + 8 + ((seed * 13.3) % (VIEW_H - topY - 24))
        const len = 10 + ((seed * 3.1) % 22)
        const lean = ((seed * 1.7) % 2) - 1
        const path: [number, number][] = [
            [x, y],
            [x + len * 0.34 * lean, y + len * 0.4],
            [x - len * 0.22 * lean, y + len * 0.72],
            [x + len * 0.18 * lean, y + len]
        ]
        const trace = (dx: number, dy: number) => {
            gfx.moveTo(path[0]![0] + dx, path[0]![1] + dy)
            for (const [px, py] of path.slice(1)) gfx.lineTo(px + dx, py + dy)
        }
        // A dark fracture with a lit edge one pixel off it — the highlight is
        // what makes a scratch on a near-black surface visible at all.
        trace(0, 0)
        gfx.stroke({ width: 2.5, color: 0x000000, alpha: 0.8 })
        trace(1, -1)
        gfx.stroke({ width: 1, color: 0x64748b, alpha: 0.35 })
        if (severity > 0.5) {
            gfx.circle(x, y + len * 0.5, 2 + (seed % 3)).fill({ color: RED, alpha: 0.25 * severity })
        }
    }
    if (severity > 0.35) {
        gfx.rect(WALL_X, topY - 4, VIEW_W - WALL_X, VIEW_H - topY)
            .fill({ color: 0x450a0a, alpha: (severity - 0.35) * 0.5 })
    }
}

// ─── Barrier ────────────────────────────────────────────────────────────────

/** Geometry of the barrier dome, shared by the drawing and the impact ripples. */
const DOME_CX = WALL_X + 34
const DOME_CY = (WALL_TOP_Y + VIEW_H) * 0.5
const DOME_RX = 116
const DOME_RY = (VIEW_H - WALL_TOP_Y) * 0.62

/**
 * The overshield dome.
 *
 * Redrawn per frame rather than built once, because a static translucent ellipse
 * in front of a dark wall is genuinely invisible — players could not tell a full
 * barrier from a dead one. What sells it is motion the wall does not have: a
 * hexagonal cell lattice that scrolls, a scanline travelling up the face, and a
 * rim whose brightness tracks the charge left. All three run off the clock, so
 * the whole thing is one Graphics rebuild a frame and no tweens to leak.
 */
export function drawShieldDome(gfx: Graphics, fraction: number, timeMs: number) {
    gfx.clear()
    if (fraction <= 0) return

    const charge = clamp(fraction, 0, 1)
    // A barrier about to fail flickers and pulls in, so "nearly gone" is legible
    // without reading the meter.
    const flicker = charge < 0.3 ? 0.72 + Math.sin(timeMs / 42) * 0.28 : 1
    const alpha = (0.16 + charge * 0.34) * flicker
    const rx = DOME_RX * (0.82 + charge * 0.18)
    const ry = DOME_RY * (0.9 + charge * 0.1)
    const hex = charge > 0.35 ? 0x67e8f9 : AMBER

    gfx.ellipse(DOME_CX, DOME_CY, rx, ry).fill({ color: hex, alpha: alpha * 0.14 })

    // Cell lattice: chords across the dome at a scrolling offset. Cheap, and it
    // gives the surface something for the eye to track as it moves.
    const cells = 9
    const scroll = (timeMs / 2600) % 1
    for (let i = 0; i < cells; i++) {
        const t = ((i / cells) + scroll) % 1
        const y = DOME_CY - ry + ry * 2 * t
        // Half-width of the ellipse at this height, so the lattice hugs the shell.
        const k = 1 - Math.pow((y - DOME_CY) / ry, 2)
        if (k <= 0) continue
        const half = rx * Math.sqrt(k)
        gfx.moveTo(DOME_CX - half, y).lineTo(DOME_CX + half, y)
            .stroke({ width: 1, color: hex, alpha: alpha * 0.35 })
        gfx.moveTo(DOME_CX - half * 0.5, y - 9).lineTo(DOME_CX - half, y)
            .lineTo(DOME_CX - half * 0.5, y + 9)
            .stroke({ width: 1, color: hex, alpha: alpha * 0.22 })
    }

    // Travelling scanline — one bright band climbing the shell.
    const scanT = (timeMs / 1500) % 1
    const scanY = DOME_CY + ry - ry * 2 * scanT
    const scanK = 1 - Math.pow((scanY - DOME_CY) / ry, 2)
    if (scanK > 0) {
        const half = rx * Math.sqrt(scanK)
        gfx.moveTo(DOME_CX - half, scanY).lineTo(DOME_CX + half, scanY)
            .stroke({ width: 3, color: 0xffffff, alpha: alpha * 0.5 })
    }

    // Rim, brightest on the leading (left) edge where hits land.
    for (let i = 0; i < 3; i++) {
        gfx.ellipse(DOME_CX, DOME_CY, rx + i * 7, ry + i * 9)
            .stroke({ width: 3 - i * 0.8, color: hex, alpha: alpha * (1 - i * 0.3) })
    }
    gfx.blendMode = 'add'
}

/**
 * A hit on the barrier: a hexagonal cell lights up where the round landed and a
 * ripple runs out from it along the shell. This is the feedback that tells you
 * the barrier ate the hit rather than the wall — without it, a shielded hit and
 * an unshielded one look identical.
 */
export function shieldImpact(layer: Container, y: number, strong = false) {
    const clampedY = clamp(y, DOME_CY - DOME_RY + 6, DOME_CY + DOME_RY - 6)
    const k = Math.max(0.05, 1 - Math.pow((clampedY - DOME_CY) / DOME_RY, 2))
    const x = DOME_CX - DOME_RX * Math.sqrt(k)

    const gfx = new Graphics()
    const r = strong ? 30 : 20
    // The lit cell.
    const cell: number[] = []
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        cell.push(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.85)
    }
    gfx.poly(cell).fill({ color: 0xffffff, alpha: 0.5 })
    gfx.poly(cell).stroke({ width: 2.5, color: 0x67e8f9, alpha: 0.95 })
    // Two ripple rings, flattened onto the shell's curve.
    for (let i = 1; i <= 2; i++) {
        gfx.ellipse(0, 0, r * i * 0.7, r * i * 1.15)
            .stroke({ width: 2 / i, color: 0xa5f3fc, alpha: 0.6 / i })
    }
    gfx.blendMode = 'add'
    gfx.position.set(x, clampedY)
    layer.addChild(gfx)
    gsap.to(gfx.scale, { x: strong ? 2.4 : 1.8, y: strong ? 2.4 : 1.8, duration: 0.34, ease: 'power2.out' })
    gsap.to(gfx, { alpha: 0, duration: 0.34, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

/** Player's rail cannon: a yoke that pivots and a barrel that recoils. */
function buildRail() {
    const root = new Container()

    const mount = new Graphics()
    mount.circle(0, 0, 17).fill({ color: 0x24334c })
    mount.circle(0, 0, 17).stroke({ width: 2, color: 0x38bdf8, alpha: 0.4 })
    mount.circle(0, 0, 7).fill({ color: 0x0b1220 })

    const barrel = new Container()
    const barrelGfx = new Graphics()
    barrelGfx.rect(-6, -7, 62, 14).fill({ color: 0x2b3d5c })
    barrelGfx.rect(-6, -7, 62, 4).fill({ color: 0x486590 })
    barrelGfx.rect(46, -9, 10, 18).fill({ color: 0x334a6e })
    barrelGfx.rect(10, -2, 30, 4).fill({ color: CYAN, alpha: 0.7 })
    barrel.addChild(barrelGfx)

    // Barrel under the mount so the yoke caps the pivot; the game rotates `barrel`.
    root.addChild(barrel, mount)
    return { root, barrel }
}

/**
 * One silhouette per turret type. They have to be told apart at a glance from
 * across the field, so each gets a different barrel mass rather than a recolour.
 */
export function buildTurret(kind: FirewallTurretId, hex: number): { root: Container, barrel: Container } {
    const root = new Container()
    const post = new Graphics()
    post.rect(-5, 0, 10, 24).fill({ color: 0x1d2a40 })
    post.circle(0, 0, 11).fill({ color: 0x24334c })
    post.circle(0, 0, 11).stroke({ width: 1.5, color: hex, alpha: 0.5 })

    const barrel = new Container()
    const gfx = new Graphics()
    switch (kind) {
        case 'needler':
            // Three thin barrels: reads as "spits a lot of small things".
            for (let i = -1; i <= 1; i++) {
                gfx.rect(-3, i * 4 - 1.2, 30, 2.4).fill({ color: 0x2b3d5c })
            }
            gfx.rect(24, -5, 6, 10).fill({ color: 0x334a6e })
            gfx.rect(4, -1, 14, 2).fill({ color: hex, alpha: 0.7 })
            break
        case 'warhead':
            // A boxy rack of tubes.
            gfx.rect(-6, -9, 26, 18).fill({ color: 0x2b3d5c })
            gfx.rect(-6, -9, 26, 4).fill({ color: 0x486590 })
            for (let i = -1; i <= 1; i++) {
                gfx.circle(20, i * 6, 2.6).fill({ color: hex, alpha: 0.85 })
            }
            break
        case 'lance':
            // One long spine with a coil pack — the heavy single-target look.
            gfx.rect(-8, -3.5, 52, 7).fill({ color: 0x2b3d5c })
            gfx.rect(-8, -3.5, 52, 2).fill({ color: 0x486590 })
            gfx.rect(-10, -7, 12, 14).fill({ color: 0x334a6e })
            gfx.rect(8, -1.2, 28, 2.4).fill({ color: hex, alpha: 0.8 })
            break
        default:
            gfx.rect(-4, -4, 34, 8).fill({ color: 0x2b3d5c })
            gfx.rect(24, -5, 8, 10).fill({ color: 0x334a6e })
            gfx.rect(6, -1.5, 16, 3).fill({ color: hex, alpha: 0.6 })
            break
    }
    barrel.addChild(gfx)

    root.addChild(barrel, post)
    return { root, barrel }
}

// ─── Grid trap ──────────────────────────────────────────────────────────────

const TRAP_TOP = LANE_FAR_Y - 30
const TRAP_BOTTOM = LANE_NEAR_Y + 34

/** Deterministic hash, so the trap's "random" arcs are stable frame to frame. */
function noise(seed: number) {
    const x = Math.sin(seed * 127.1) * 43758.5453
    return x - Math.floor(x)
}

/**
 * The electrified band in front of the wall.
 *
 * Redrawn per frame because the motion is the whole point — the old version was
 * two sine waves crossing a flat rectangle, and once it stopped being new the
 * eye filed it as scenery and stopped registering that it was doing damage. This
 * one is built out of things that read as apparatus: emitter pylons down both
 * edges with charge caps that pulse on a shared clock, a floor that brightens
 * between discharges, and forked bolts that jump pylon-to-pylon on a stagger.
 * Intensity scales every one of those with the level bought, so upgrading the
 * trap is visible on the field and not only in the shop.
 */
export function drawSpikeBand(gfx: Graphics, dps: number, timeMs: number) {
    gfx.clear()
    if (dps <= 0) return

    const intensity = clamp(0.25 + dps / 340, 0, 1)
    const left = WALL_X - SPIKE_BAND
    const height = TRAP_BOTTOM - TRAP_TOP
    const pylons = 6
    // Charge cycle: the floor swells, then the bolts fire on the discharge.
    const cycle = (timeMs / 900) % 1
    const charge = Math.pow(Math.sin(cycle * Math.PI), 2)

    // Floor glow, brightest at the wall end where the field is anchored.
    for (let i = 0; i < 4; i++) {
        const t = i / 4
        gfx.rect(lerp(left, WALL_X, t), TRAP_TOP, SPIKE_BAND * 0.25 + 2, height)
            .fill({ color: 0x0ea5e9, alpha: (0.03 + intensity * 0.05) * (0.5 + t * 0.9) * (0.6 + charge * 0.6) })
    }

    // Conductor rails running the length of the band, one per lane row.
    for (let lane = 0; lane <= pylons; lane++) {
        const y = lerp(TRAP_TOP, TRAP_BOTTOM, lane / pylons)
        gfx.moveTo(left, y).lineTo(WALL_X, y)
            .stroke({ width: 1.5, color: 0x0ea5e9, alpha: 0.16 + intensity * 0.22 })
    }

    // Emitter pylons down both edges, caps lit on the charge cycle.
    for (let lane = 0; lane <= pylons; lane++) {
        const y = lerp(TRAP_TOP, TRAP_BOTTOM, lane / pylons)
        // Nearer lanes are drawn lower and read larger, so the band has depth.
        const size = lerp(5, 9, lane / pylons)
        for (const x of [left, WALL_X - 4]) {
            gfx.rect(x - 2, y - size * 1.6, 4, size * 1.6).fill({ color: 0x1d2a40 })
            gfx.circle(x, y - size * 1.7, size * 0.42)
                .fill({ color: 0x67e8f9, alpha: 0.35 + charge * 0.55 * intensity })
        }
    }

    // Bolts. Each jumps the band at its own lane on its own stagger, and forks
    // once — a straight line reads as a wire, a forked one reads as a discharge.
    const bolts = 2 + Math.round(intensity * 3)
    for (let b = 0; b < bolts; b++) {
        const phase = (timeMs / 620 + b * 0.37) % 1
        // Only alive for the front half of its own phase: the gaps are what make
        // the discharges read as discrete events rather than as a running hum.
        if (phase > 0.45) continue
        const life = 1 - phase / 0.45
        const lane = Math.floor(noise(b * 3.7 + Math.floor(timeMs / 620 + b * 0.37)) * (pylons + 1))
        const y = lerp(TRAP_TOP, TRAP_BOTTOM, lane / pylons)
        const alpha = (0.4 + intensity * 0.5) * life

        const steps = 7
        const points: [number, number][] = []
        for (let s = 0; s <= steps; s++) {
            const t = s / steps
            const jitter = s === 0 || s === steps
                ? 0
                : (noise(b * 11.3 + s + Math.floor(timeMs / 620)) - 0.5) * 26
            points.push([lerp(left, WALL_X, t), y + jitter])
        }
        const trace = () => {
            gfx.moveTo(points[0]![0], points[0]![1])
            for (const [px, py] of points.slice(1)) gfx.lineTo(px, py)
        }
        trace()
        gfx.stroke({ width: 7, color: 0x22d3ee, alpha: alpha * 0.25 })
        trace()
        gfx.stroke({ width: 2, color: 0xe0f2fe, alpha })

        // The fork, branching off the middle of the run.
        const mid = points[Math.floor(steps / 2)]!
        gfx.moveTo(mid[0], mid[1])
            .lineTo(mid[0] + 24, mid[1] + (lane > pylons / 2 ? -22 : 22))
            .lineTo(mid[0] + 52, mid[1] + (lane > pylons / 2 ? -14 : 14))
            .stroke({ width: 1.5, color: 0xa5f3fc, alpha: alpha * 0.75 })
    }
}

/**
 * A single enemy taking a tick of trap damage: the bolt earths through it. Fired
 * sparingly by the engine so the band stays readable when a crowd is standing
 * in it.
 */
export function trapZap(layer: Container, x: number, y: number) {
    const gfx = new Graphics()
    const height = randRange(26, 44)
    gfx.moveTo(0, 0)
    for (let i = 1; i <= 4; i++) {
        gfx.lineTo(randRange(-9, 9), -height * (i / 4))
    }
    gfx.stroke({ width: 6, color: 0x22d3ee, alpha: 0.3 })
    gfx.moveTo(0, 0)
    for (let i = 1; i <= 4; i++) {
        gfx.lineTo(randRange(-7, 7), -height * (i / 4))
    }
    gfx.stroke({ width: 1.8, color: 0xe0f2fe, alpha: 0.9 })
    gfx.ellipse(0, 0, 13, 4).fill({ color: 0x67e8f9, alpha: 0.55 })
    gfx.blendMode = 'add'
    gfx.position.set(x, y)
    layer.addChild(gfx)
    gsap.to(gfx, { alpha: 0, duration: 0.16, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

// ─── Enemy figures ──────────────────────────────────────────────────────────

/**
 * Limbs pivot at their top edge so a rotation reads as a swing from the joint.
 * Every part is the same near-black ink with a coloured rim, which is what makes
 * a crowd of these legible as silhouettes against a dark field.
 */
function limb(w: number, h: number, hex: number, alpha = 0.55) {
    const container = new Container()
    const gfx = new Graphics()
    gfx.roundRect(-w / 2, 0, w, h, w * 0.4).fill({ color: INK })
    gfx.roundRect(-w / 2, 0, w, h, w * 0.4).stroke({ width: 1.4, color: hex, alpha })
    container.addChild(gfx)
    return container
}

function rimPoly(gfx: Graphics, points: number[], hex: number, alpha = 0.7) {
    gfx.poly(points).fill({ color: INK })
    gfx.poly(points).stroke({ width: 1.6, color: hex, alpha })
}

/** A soft additive blob used for eyes, cores and thruster glow. */
function glow(x: number, y: number, r: number, hex: number) {
    const gfx = new Graphics()
    gfx.circle(x, y, r * 2.4).fill({ color: hex, alpha: 0.18 })
    gfx.circle(x, y, r).fill({ color: hex, alpha: 0.95 })
    gfx.blendMode = 'add'
    return gfx
}

/**
 * Builds the silhouette for one enemy type.
 *
 * Figures are drawn feet-at-origin and facing right (they always walk right),
 * so the game only ever sets `root.position` and a scale.
 */
export function buildFigure(def: FirewallEnemyDefinition): FigureRig {
    const root = new Container()
    const hex = def.hex
    const h = def.height

    // Contact shadow — grounds the figure on the grid. Flyers get none: their
    // origin is in the air, so a shadow at the feet would fly with them.
    if (def.kind !== 'flyer') {
        const shadow = new Graphics()
        shadow.ellipse(0, 0, h * 0.32, h * 0.09).fill({ color: 0x000000, alpha: 0.45 })
        root.addChild(shadow)
    }

    const legBack = new Container()
    const legFront = new Container()
    const armBack = new Container()
    const armFront = new Container()
    const torso = new Container()

    switch (def.id) {
        case 'drone': {
            // No legs; the "limbs" are fins that idle instead of striding.
            const bodyGfx = new Graphics()
            rimPoly(bodyGfx, [0, -h * 0.5, h * 0.62, 0, 0, h * 0.5, -h * 0.62, 0], hex, 0.8)
            bodyGfx.circle(h * 0.16, 0, h * 0.16).fill({ color: hex, alpha: 0.5 })
            torso.addChild(bodyGfx, glow(h * 0.16, 0, h * 0.1, hex))
            const finTop = limb(h * 0.16, h * 0.42, hex, 0.6)
            finTop.rotation = Math.PI
            finTop.position.set(-h * 0.3, 0)
            const finBottom = limb(h * 0.16, h * 0.42, hex, 0.6)
            finBottom.position.set(-h * 0.3, 0)
            armBack.addChild(finTop)
            armFront.addChild(finBottom)
            torso.addChild(armBack, armFront)
            // Sits at its own centre; the game positions it by altitude.
            torso.position.set(0, 0)
            root.addChild(torso)
            break
        }
        case 'titan': {
            const hipY = -h * 0.42
            for (const [leg, dx] of [[legBack, -h * 0.1], [legFront, h * 0.08]] as const) {
                const thigh = limb(h * 0.15, h * 0.24, hex, 0.5)
                const shin = limb(h * 0.12, h * 0.2, hex, 0.5)
                shin.position.set(0, h * 0.24)
                thigh.addChild(shin)
                const foot = new Graphics()
                foot.roundRect(-h * 0.1, h * 0.2, h * 0.22, h * 0.05, 3).fill({ color: INK })
                foot.roundRect(-h * 0.1, h * 0.2, h * 0.22, h * 0.05, 3).stroke({ width: 1.4, color: hex, alpha: 0.5 })
                shin.addChild(foot)
                leg.position.set(dx, hipY)
                leg.addChild(thigh)
            }
            const chest = new Graphics()
            rimPoly(chest, [
                -h * 0.3, 0, h * 0.3, -h * 0.04, h * 0.34, -h * 0.3,
                h * 0.1, -h * 0.42, -h * 0.26, -h * 0.36
            ], hex, 0.85)
            chest.rect(-h * 0.2, -h * 0.3, h * 0.4, h * 0.05).fill({ color: hex, alpha: 0.5 })
            const visor = new Graphics()
            rimPoly(visor, [-h * 0.14, -h * 0.42, h * 0.16, -h * 0.46, h * 0.14, -h * 0.56, -h * 0.1, -h * 0.54], hex, 0.9)
            torso.addChild(chest, visor, glow(h * 0.06, -h * 0.5, h * 0.045, hex), glow(0, -h * 0.28, h * 0.07, hex))

            // Shoulder cannons rather than arms — a boss should not read as a big grunt.
            const cannonR = limb(h * 0.14, h * 0.34, hex, 0.6)
            cannonR.position.set(h * 0.26, -h * 0.34)
            const cannonL = limb(h * 0.12, h * 0.3, hex, 0.45)
            cannonL.position.set(-h * 0.24, -h * 0.32)
            armFront.addChild(cannonR)
            armBack.addChild(cannonL)
            torso.position.set(0, hipY)
            torso.addChild(armBack, armFront)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'crawler': {
            // Hunched and low — the fast one has to look fast standing still.
            const hipY = -h * 0.46
            for (const [leg, dx] of [[legBack, -h * 0.06], [legFront, h * 0.06]] as const) {
                leg.addChild(limb(h * 0.12, h * 0.46, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const body = new Graphics()
            rimPoly(body, [-h * 0.34, 0, h * 0.3, -h * 0.12, h * 0.26, -h * 0.34, -h * 0.28, -h * 0.24], hex, 0.8)
            const head = new Graphics()
            rimPoly(head, [h * 0.22, -h * 0.16, h * 0.46, -h * 0.24, h * 0.4, -h * 0.4, h * 0.18, -h * 0.34], hex, 0.85)
            torso.addChild(body, head, glow(h * 0.34, -h * 0.27, h * 0.05, hex))
            const claw = limb(h * 0.1, h * 0.3, hex, 0.5)
            claw.position.set(h * 0.16, -h * 0.16)
            claw.rotation = 0.7
            armFront.addChild(claw)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'brute': {
            const hipY = -h * 0.44
            for (const [leg, dx] of [[legBack, -h * 0.12], [legFront, h * 0.1]] as const) {
                leg.addChild(limb(h * 0.19, h * 0.44, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const chest = new Graphics()
            rimPoly(chest, [-h * 0.26, 0, h * 0.28, -h * 0.05, h * 0.3, -h * 0.34, -h * 0.22, -h * 0.3], hex, 0.85)
            const head = new Graphics()
            rimPoly(head, [-h * 0.06, -h * 0.34, h * 0.16, -h * 0.36, h * 0.14, -h * 0.5, -h * 0.04, -h * 0.48], hex, 0.85)
            torso.addChild(chest, head, glow(h * 0.1, -h * 0.43, h * 0.045, hex))
            // Riot slab carried in front — reads instantly as "shoot this last".
            const slab = new Graphics()
            slab.roundRect(0, -h * 0.02, h * 0.12, h * 0.46, 4).fill({ color: 0x111826 })
            slab.roundRect(0, -h * 0.02, h * 0.12, h * 0.46, 4).stroke({ width: 2, color: hex, alpha: 0.7 })
            slab.rect(h * 0.03, h * 0.06, h * 0.06, h * 0.3).fill({ color: hex, alpha: 0.18 })
            const arm = limb(h * 0.13, h * 0.3, hex, 0.5)
            arm.position.set(h * 0.24, -h * 0.28)
            arm.addChild(slab)
            armFront.addChild(arm)
            const armB = limb(h * 0.12, h * 0.28, hex, 0.35)
            armB.position.set(-h * 0.16, -h * 0.26)
            armBack.addChild(armB)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'spitter': {
            const hipY = -h * 0.46
            for (const [leg, dx] of [[legBack, -h * 0.07], [legFront, h * 0.07]] as const) {
                leg.addChild(limb(h * 0.11, h * 0.46, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const chest = new Graphics()
            rimPoly(chest, [-h * 0.16, 0, h * 0.18, -h * 0.03, h * 0.2, -h * 0.32, -h * 0.14, -h * 0.28], hex, 0.8)
            const head = new Graphics()
            rimPoly(head, [-h * 0.04, -h * 0.32, h * 0.14, -h * 0.34, h * 0.12, -h * 0.48, -h * 0.02, -h * 0.46], hex, 0.85)
            torso.addChild(chest, head, glow(h * 0.09, -h * 0.41, h * 0.04, hex))
            // Long cannon arm, held level — the tell that it will stop and shoot.
            const cannon = new Graphics()
            cannon.roundRect(0, -h * 0.05, h * 0.5, h * 0.1, 4).fill({ color: INK })
            cannon.roundRect(0, -h * 0.05, h * 0.5, h * 0.1, 4).stroke({ width: 1.5, color: hex, alpha: 0.75 })
            cannon.circle(h * 0.46, 0, h * 0.06).fill({ color: hex, alpha: 0.45 })
            const arm = new Container()
            arm.addChild(cannon)
            arm.position.set(h * 0.12, -h * 0.24)
            armFront.addChild(arm)
            const armB = limb(h * 0.1, h * 0.26, hex, 0.35)
            armB.position.set(-h * 0.1, -h * 0.24)
            armBack.addChild(armB)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'sapper': {
            const hipY = -h * 0.44
            for (const [leg, dx] of [[legBack, -h * 0.07], [legFront, h * 0.07]] as const) {
                leg.addChild(limb(h * 0.12, h * 0.44, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const chest = new Graphics()
            rimPoly(chest, [-h * 0.18, 0, h * 0.2, -h * 0.04, h * 0.22, -h * 0.3, -h * 0.16, -h * 0.26], hex, 0.8)
            const head = new Graphics()
            rimPoly(head, [-h * 0.05, -h * 0.3, h * 0.15, -h * 0.32, h * 0.13, -h * 0.46, -h * 0.03, -h * 0.44], hex, 0.85)
            torso.addChild(chest, head, glow(h * 0.1, -h * 0.39, h * 0.04, hex))
            // The payload, strapped on and pulsing — the "get it before it lands" cue.
            const charge = new Graphics()
            charge.circle(-h * 0.24, -h * 0.16, h * 0.16).fill({ color: 0x2a0d12 })
            charge.circle(-h * 0.24, -h * 0.16, h * 0.16).stroke({ width: 2, color: hex, alpha: 0.9 })
            charge.circle(-h * 0.24, -h * 0.16, h * 0.08).fill({ color: hex, alpha: 0.8 })
            charge.blendMode = 'normal'
            track(gsap.to(charge.scale, { x: 1.16, y: 1.16, duration: 0.42, repeat: -1, yoyo: true, ease: 'sine.inOut' }))
            charge.pivot.set(-h * 0.24, -h * 0.16)
            charge.position.set(-h * 0.24, -h * 0.16)
            torso.addChild(charge)
            const arm = limb(h * 0.1, h * 0.28, hex, 0.5)
            arm.position.set(h * 0.14, -h * 0.24)
            arm.rotation = -0.5
            armFront.addChild(arm)
            const armB = limb(h * 0.1, h * 0.26, hex, 0.35)
            armB.position.set(-h * 0.08, -h * 0.24)
            armBack.addChild(armB)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'tank': {
            // Tracked, so the "legs" are road wheels that spin instead of swing.
            for (const [leg, dx] of [[legBack, -h * 0.22], [legFront, h * 0.16]] as const) {
                const wheel = new Graphics()
                wheel.circle(0, 0, h * 0.11).fill({ color: INK })
                wheel.circle(0, 0, h * 0.11).stroke({ width: 1.6, color: hex, alpha: 0.6 })
                wheel.moveTo(-h * 0.11, 0).lineTo(h * 0.11, 0).stroke({ width: 1.4, color: hex, alpha: 0.5 })
                wheel.moveTo(0, -h * 0.11).lineTo(0, h * 0.11).stroke({ width: 1.4, color: hex, alpha: 0.5 })
                leg.addChild(wheel)
                leg.position.set(dx, -h * 0.12)
            }
            const hull = new Graphics()
            rimPoly(hull, [
                -h * 0.44, -h * 0.06, h * 0.42, -h * 0.06, h * 0.46, -h * 0.3,
                h * 0.1, -h * 0.42, -h * 0.38, -h * 0.36
            ], hex, 0.85)
            hull.rect(-h * 0.46, -h * 0.24, h * 0.92, h * 0.05).fill({ color: hex, alpha: 0.2 })
            const cannon = new Graphics()
            cannon.rect(0, -h * 0.045, h * 0.66, h * 0.09).fill({ color: INK })
            cannon.rect(0, -h * 0.045, h * 0.66, h * 0.09).stroke({ width: 1.6, color: hex, alpha: 0.8 })
            cannon.rect(h * 0.58, -h * 0.07, h * 0.08, h * 0.14).fill({ color: INK })
            cannon.rect(h * 0.58, -h * 0.07, h * 0.08, h * 0.14).stroke({ width: 1.4, color: hex, alpha: 0.8 })
            cannon.position.set(h * 0.12, -h * 0.42)
            torso.addChild(hull, cannon, glow(-h * 0.2, -h * 0.36, h * 0.05, hex))
            torso.position.set(0, -h * 0.06)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'warden': {
            const hipY = -h * 0.44
            for (const [leg, dx] of [[legBack, -h * 0.11], [legFront, h * 0.09]] as const) {
                leg.addChild(limb(h * 0.17, h * 0.44, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const chest = new Graphics()
            rimPoly(chest, [-h * 0.24, 0, h * 0.26, -h * 0.04, h * 0.3, -h * 0.32, -h * 0.28, -h * 0.28], hex, 0.85)
            const head = new Graphics()
            rimPoly(head, [-h * 0.04, -h * 0.32, h * 0.16, -h * 0.34, h * 0.14, -h * 0.48, -h * 0.02, -h * 0.46], hex, 0.85)
            // Pauldrons: the plating tell, before you even see a damage number.
            for (const sx of [-1, 1]) {
                const pad = new Graphics()
                rimPoly(pad, [
                    sx * h * 0.16, -h * 0.34, sx * h * 0.34, -h * 0.3,
                    sx * h * 0.32, -h * 0.16, sx * h * 0.14, -h * 0.2
                ], hex, 0.9)
                chest.addChild(pad)
            }
            torso.addChild(chest, head, glow(h * 0.1, -h * 0.41, h * 0.04, hex))
            const arm = limb(h * 0.13, h * 0.3, hex, 0.5)
            arm.position.set(h * 0.2, -h * 0.26)
            armFront.addChild(arm)
            const armB = limb(h * 0.12, h * 0.28, hex, 0.35)
            armB.position.set(-h * 0.16, -h * 0.26)
            armBack.addChild(armB)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'artillery': {
            // Squat carriage, gun raised — it never gets close, so read it by
            // silhouette from across the field.
            for (const [leg, dx] of [[legBack, -h * 0.2], [legFront, h * 0.18]] as const) {
                const wheel = new Graphics()
                wheel.circle(0, 0, h * 0.13).fill({ color: INK })
                wheel.circle(0, 0, h * 0.13).stroke({ width: 1.6, color: hex, alpha: 0.6 })
                leg.addChild(wheel)
                leg.position.set(dx, -h * 0.14)
            }
            const carriage = new Graphics()
            rimPoly(carriage, [-h * 0.34, -h * 0.08, h * 0.34, -h * 0.08, h * 0.26, -h * 0.34, -h * 0.26, -h * 0.3], hex, 0.85)
            const tube = new Graphics()
            tube.rect(0, -h * 0.05, h * 0.72, h * 0.1).fill({ color: INK })
            tube.rect(0, -h * 0.05, h * 0.72, h * 0.1).stroke({ width: 1.6, color: hex, alpha: 0.85 })
            tube.circle(h * 0.7, 0, h * 0.07).fill({ color: hex, alpha: 0.35 })
            tube.rotation = -0.5
            tube.position.set(h * 0.04, -h * 0.34)
            torso.addChild(carriage, tube, glow(-h * 0.16, -h * 0.28, h * 0.05, hex))
            torso.position.set(0, -h * 0.08)
            root.addChild(legBack, torso, legFront)
            break
        }
        case 'gunship': {
            const body2 = new Graphics()
            rimPoly(body2, [
                -h * 0.7, 0, -h * 0.3, -h * 0.34, h * 0.5, -h * 0.3,
                h * 0.8, 0, h * 0.4, h * 0.24, -h * 0.4, h * 0.22
            ], hex, 0.85)
            body2.rect(-h * 0.2, -h * 0.16, h * 0.5, h * 0.07).fill({ color: hex, alpha: 0.4 })
            // Chin guns, which is what makes it read as a shooter not a drone.
            for (const dy of [-0.06, 0.1]) {
                body2.rect(h * 0.5, h * dy, h * 0.42, h * 0.06).fill({ color: INK })
                body2.rect(h * 0.5, h * dy, h * 0.42, h * 0.06).stroke({ width: 1.3, color: hex, alpha: 0.8 })
            }
            torso.addChild(body2, glow(h * 0.34, -h * 0.14, h * 0.09, hex))
            const rotorTop = limb(h * 0.14, h * 0.5, hex, 0.55)
            rotorTop.rotation = Math.PI
            rotorTop.position.set(-h * 0.12, -h * 0.28)
            const rotorLow = limb(h * 0.14, h * 0.5, hex, 0.55)
            rotorLow.position.set(-h * 0.12, h * 0.2)
            armBack.addChild(rotorTop)
            armFront.addChild(rotorLow)
            torso.addChild(armBack, armFront)
            root.addChild(torso)
            break
        }
        case 'leviathan': {
            // The heavy boss: a walking bunker. Same read as the ROOTKIT but
            // plated, wider, and lit colder.
            const hipY = -h * 0.4
            for (const [leg, dx] of [[legBack, -h * 0.16], [legFront, h * 0.14]] as const) {
                const thigh = limb(h * 0.2, h * 0.22, hex, 0.55)
                const shin = limb(h * 0.17, h * 0.2, hex, 0.55)
                shin.position.set(0, h * 0.22)
                thigh.addChild(shin)
                const foot = new Graphics()
                foot.roundRect(-h * 0.13, h * 0.2, h * 0.3, h * 0.06, 3).fill({ color: INK })
                foot.roundRect(-h * 0.13, h * 0.2, h * 0.3, h * 0.06, 3).stroke({ width: 1.5, color: hex, alpha: 0.55 })
                shin.addChild(foot)
                leg.position.set(dx, hipY)
                leg.addChild(thigh)
            }
            const chest = new Graphics()
            rimPoly(chest, [
                -h * 0.4, 0, h * 0.4, -h * 0.04, h * 0.44, -h * 0.3,
                h * 0.12, -h * 0.44, -h * 0.36, -h * 0.38
            ], hex, 0.9)
            for (let i = 0; i < 3; i++) {
                chest.rect(-h * 0.3, -h * 0.34 + i * h * 0.1, h * 0.6, h * 0.04).fill({ color: hex, alpha: 0.3 })
            }
            const visor = new Graphics()
            rimPoly(visor, [-h * 0.18, -h * 0.44, h * 0.2, -h * 0.48, h * 0.18, -h * 0.6, -h * 0.14, -h * 0.56], hex, 0.95)
            torso.addChild(chest, visor, glow(h * 0.06, -h * 0.53, h * 0.05, hex), glow(0, -h * 0.26, h * 0.09, hex))
            const cannonR = limb(h * 0.18, h * 0.38, hex, 0.65)
            cannonR.position.set(h * 0.34, -h * 0.36)
            const cannonL = limb(h * 0.16, h * 0.34, hex, 0.5)
            cannonL.position.set(-h * 0.32, -h * 0.34)
            armFront.addChild(cannonR)
            armBack.addChild(cannonL)
            torso.position.set(0, hipY)
            torso.addChild(armBack, armFront)
            root.addChild(legBack, torso, legFront)
            break
        }
        default: {
            // grunt — the baseline humanoid every other shape is read against.
            const hipY = -h * 0.46
            for (const [leg, dx] of [[legBack, -h * 0.08], [legFront, h * 0.08]] as const) {
                leg.addChild(limb(h * 0.13, h * 0.46, hex, 0.5))
                leg.position.set(dx, hipY)
            }
            const chest = new Graphics()
            rimPoly(chest, [-h * 0.19, 0, h * 0.2, -h * 0.04, h * 0.22, -h * 0.32, -h * 0.17, -h * 0.28], hex, 0.8)
            const head = new Graphics()
            rimPoly(head, [-h * 0.05, -h * 0.32, h * 0.15, -h * 0.34, h * 0.13, -h * 0.5, -h * 0.03, -h * 0.47], hex, 0.85)
            torso.addChild(chest, head, glow(h * 0.1, -h * 0.42, h * 0.04, hex))
            // Blade, angled forward.
            const blade = new Graphics()
            rimPoly(blade, [0, -h * 0.03, h * 0.44, -h * 0.09, h * 0.46, -h * 0.02, 0, h * 0.04], hex, 0.9)
            blade.alpha = 0.95
            const arm = new Container()
            arm.addChild(limb(h * 0.1, h * 0.28, hex, 0.5), blade)
            blade.position.set(h * 0.04, h * 0.26)
            arm.position.set(h * 0.14, -h * 0.26)
            arm.rotation = -0.35
            armFront.addChild(arm)
            const armB = limb(h * 0.1, h * 0.26, hex, 0.35)
            armB.position.set(-h * 0.1, -h * 0.24)
            armBack.addChild(armB)
            torso.addChild(armBack, armFront)
            torso.position.set(0, hipY)
            root.addChild(legBack, torso, legFront)
            break
        }
    }

    // Plated units carry a chevron badge in the kinetic colour, which is the
    // same amber the damage numbers use when a kinetic source lands on one. The
    // badge is the promise; the number is the payoff.
    if (def.armored) {
        const badge = new Graphics()
        const by = -h - 22
        const plate = [0, by - 7, 8, by - 2, 8, by + 5, 0, by + 9, -8, by + 5, -8, by - 2]
        badge.poly(plate).fill({ color: 0x0b1220, alpha: 0.9 })
        badge.poly(plate).stroke({ width: 1.5, color: AMBER, alpha: 0.9 })
        badge.moveTo(-3.5, by + 2).lineTo(0, by - 2).lineTo(3.5, by + 2)
            .stroke({ width: 1.5, color: AMBER, alpha: 0.95 })
        root.addChild(badge)
    }

    // Hit flash: an additive blob over the body's footprint. A silhouette-shaped
    // copy would be prettier but doubles the geometry of every figure on screen.
    const flash = new Graphics()
    flash.ellipse(0, -h * 0.45, h * 0.3, h * 0.5).fill({ color: 0xffffff })
    flash.blendMode = 'add'
    flash.alpha = 0
    root.addChild(flash)

    const gait: FigureRig['gait'] = def.id === 'tank' || def.id === 'artillery'
        ? 'roll'
        : def.kind === 'flyer' || def.id === 'gunship' ? 'hover' : 'walk'

    return {
        root, torso, legFront, legBack, armFront, armBack, flash, gait,
        height: h, torsoBaseY: torso.position.y
    }
}

/** Advances a figure's gait. `stride` is radians accumulated from distance. */
export function poseFigure(rig: FigureRig, stride: number, attacking: boolean) {
    if (rig.gait === 'hover') {
        rig.armFront.rotation = Math.sin(stride * 0.8) * 0.35
        rig.armBack.rotation = Math.PI - Math.sin(stride * 0.8) * 0.35
        rig.torso.rotation = Math.sin(stride * 0.5) * 0.08
        return
    }
    if (rig.gait === 'roll') {
        // Wheels turn with distance travelled; the hull just rocks a little.
        rig.legFront.rotation = stride
        rig.legBack.rotation = stride
        rig.torso.rotation = Math.sin(stride * 0.5) * 0.02
        rig.torso.position.y = rig.torsoBaseY + Math.sin(stride) * rig.height * 0.006
        return
    }
    const swing = Math.sin(stride)
    rig.legFront.rotation = swing * 0.62
    rig.legBack.rotation = -swing * 0.62
    // The torso dips once per footfall, so it bobs at twice the leg frequency.
    rig.torso.position.y = rig.torsoBaseY - Math.abs(Math.cos(stride)) * rig.height * 0.02
    rig.torso.rotation = swing * 0.05
    if (attacking) {
        // Overhand chop, independent of the (stopped) leg cycle.
        rig.armFront.rotation = -1.1 + Math.sin(stride * 3) * 0.9
        rig.armBack.rotation = 0.2
    } else {
        rig.armFront.rotation = -swing * 0.5
        rig.armBack.rotation = swing * 0.5
    }
}

// ─── Transient effects ──────────────────────────────────────────────────────

export function muzzleFlash(layer: Container, x: number, y: number, angle: number, hex: number, size = 1) {
    const gfx = new Graphics()
    gfx.poly([0, 0, 34 * size, -13 * size, 52 * size, 0, 34 * size, 13 * size])
        .fill({ color: hex, alpha: 0.9 })
    gfx.circle(6, 0, 11 * size).fill({ color: 0xffffff, alpha: 0.9 })
    gfx.blendMode = 'add'
    gfx.position.set(x, y)
    gfx.rotation = angle
    layer.addChild(gfx)
    gsap.to(gfx, {
        alpha: 0,
        duration: 0.09,
        onComplete: () => { if (!gfx.destroyed) gfx.destroy() }
    })
    gsap.to(gfx.scale, { x: 1.4, y: 0.5, duration: 0.09 })
}

export function impactSpark(layer: Container, x: number, y: number, hex: number, big = false) {
    const gfx = new Graphics()
    const r = big ? 26 : 14
    gfx.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.85 })
    gfx.circle(0, 0, r * 1.8).fill({ color: hex, alpha: 0.35 })
    for (let i = 0; i < (big ? 8 : 5); i++) {
        const a = randRange(0, Math.PI * 2)
        gfx.moveTo(0, 0)
            .lineTo(Math.cos(a) * r * 2.4, Math.sin(a) * r * 2.4)
            .stroke({ width: big ? 3 : 2, color: hex, alpha: 0.8 })
    }
    gfx.blendMode = 'add'
    gfx.position.set(x, y)
    layer.addChild(gfx)
    gsap.to(gfx, { alpha: 0, duration: big ? 0.3 : 0.18, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
    gsap.to(gfx.scale, { x: big ? 2 : 1.5, y: big ? 2 : 1.5, duration: big ? 0.3 : 0.18, ease: 'power2.out' })
}

export function shockRing(layer: Container, x: number, y: number, hex: number, radius: number, ms = 520) {
    const gfx = new Graphics()
    gfx.circle(0, 0, 40).stroke({ width: 7, color: hex, alpha: 0.9 })
    gfx.circle(0, 0, 30).stroke({ width: 2, color: 0xffffff, alpha: 0.7 })
    gfx.blendMode = 'add'
    gfx.position.set(x, y)
    // Flattened because the field is seen from the side — a true circle reads as
    // a bubble in front of the camera rather than a wave across the ground.
    gfx.scale.set(1, 0.42)
    layer.addChild(gfx)
    gsap.to(gfx.scale, { x: radius / 40, y: (radius / 40) * 0.42, duration: ms / 1000, ease: 'power2.out' })
    gsap.to(gfx, { alpha: 0, duration: ms / 1000, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

/** One fragment of a dead figure. The game owns its physics; this is the look. */
export function makeShard(hex: number, size: number) {
    const gfx = new Graphics()
    gfx.rect(-size / 2, -size / 2, size, size).fill({ color: INK })
    gfx.rect(-size / 2, -size / 2, size, size).stroke({ width: 1.2, color: hex, alpha: 0.9 })
    return gfx
}

export function makeSpark(hex: number, size: number) {
    const gfx = new Graphics()
    gfx.rect(-size, -size * 0.28, size * 2, size * 0.56).fill({ color: hex, alpha: 0.95 })
    gfx.blendMode = 'add'
    return gfx
}

export function floatingText(layer: Container, x: number, y: number, text: string, hex: number, scale = 1) {
    const label = new Text({ text, style: { ...LABEL_STYLE, fill: hex, fontSize: 15 * scale } })
    label.anchor.set(0.5)
    label.position.set(x, y)
    layer.addChild(label)
    gsap.to(label, {
        y: y - 46,
        alpha: 0,
        duration: 0.75,
        ease: 'power1.out',
        onComplete: () => { if (!label.destroyed) label.destroy() }
    })
    return label
}

/** Big centred announcement — wave banners, boss names, game over. */
export function banner(layer: Container, text: string, hex: number, sub?: string) {
    const root = new Container()
    const label = new Text({
        text,
        style: { ...LABEL_STYLE, fill: hex, fontSize: 54, letterSpacing: 6 }
    })
    label.anchor.set(0.5)
    root.addChild(label)
    if (sub) {
        const subLabel = new Text({ text: sub, style: { ...LABEL_STYLE, fill: 0x94a3b8, fontSize: 18, letterSpacing: 3 } })
        subLabel.anchor.set(0.5)
        subLabel.position.set(0, 42)
        root.addChild(subLabel)
    }
    root.position.set(VIEW_W / 2, VIEW_H * 0.3)
    root.alpha = 0
    layer.addChild(root)
    gsap.timeline({ onComplete: () => { if (!root.destroyed) root.destroy() } })
        .to(root, { alpha: 1, duration: 0.22 })
        .to(root.scale, { x: 1.06, y: 1.06, duration: 1.5 }, 0)
        .to(root, { alpha: 0, duration: 0.5 }, 1.6)
    return root
}

/**
 * The end-of-wave purge: a wall of light that sweeps the field right to left.
 * `onFront` is called each frame with the sweep's x so the game can delete what
 * the light has already passed, which is what makes the wipe feel causal.
 */
export function purgeSweep(layer: Container, onFront: (x: number) => void, onDone: () => void) {
    const gfx = new Graphics()
    gfx.rect(-40, HORIZON_Y - 60, 80, VIEW_H - HORIZON_Y + 60).fill({ color: 0xffffff, alpha: 0.85 })
    gfx.rect(-260, HORIZON_Y - 60, 260, VIEW_H - HORIZON_Y + 60).fill({ color: CYAN, alpha: 0.25 })
    gfx.blendMode = 'add'
    gfx.position.set(WALL_X, 0)
    layer.addChild(gfx)
    const state = { x: WALL_X }
    gsap.to(state, {
        x: -200,
        duration: 0.62,
        ease: 'power1.in',
        onUpdate: () => {
            gfx.position.x = state.x
            onFront(state.x)
        },
        onComplete: () => {
            if (!gfx.destroyed) gfx.destroy()
            onDone()
        }
    })
}

/** Full-screen white flash, used for the pulse and for the wall breaking. */
export function screenFlash(layer: Container, hex: number, strength = 0.5, ms = 260) {
    const gfx = new Graphics()
    gfx.rect(0, 0, VIEW_W, VIEW_H).fill({ color: hex, alpha: strength })
    gfx.blendMode = 'add'
    layer.addChild(gfx)
    gsap.to(gfx, { alpha: 0, duration: ms / 1000, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

/**
 * Round in flight. Each projectile type gets its own shape — at these speeds
 * the round itself is the only readout you get of what your weapon is doing.
 */
export function makeProjectile(
    kind: FirewallProjectile,
    hex: number,
    crit: boolean,
    fromTurret: boolean
) {
    const gfx = new Graphics()
    switch (kind) {
        case 'missile': {
            gfx.poly([14, 0, -6, -5, -10, 0, -6, 5]).fill({ color: 0xf8fafc, alpha: 0.95 })
            gfx.poly([-6, -5, -14, -9, -12, -2]).fill({ color: hex, alpha: 0.8 })
            gfx.poly([-6, 5, -14, 9, -12, 2]).fill({ color: hex, alpha: 0.8 })
            gfx.circle(-14, 0, 7).fill({ color: hex, alpha: 0.45 })
            gfx.circle(-22, 0, 4).fill({ color: hex, alpha: 0.2 })
            break
        }
        case 'pellet': {
            gfx.circle(0, 0, 3.4).fill({ color: 0xffffff, alpha: 0.95 })
            gfx.rect(-16, -1.1, 16, 2.2).fill({ color: hex, alpha: 0.5 })
            break
        }
        case 'arc': {
            // A jagged bolt rather than a bar, so a chain reads as lightning.
            gfx.moveTo(-22, 0).lineTo(-10, -5).lineTo(-2, 3).lineTo(10, -4).lineTo(20, 0)
                .stroke({ width: 3, color: 0xffffff, alpha: 0.95 })
            gfx.moveTo(-22, 0).lineTo(-10, -5).lineTo(-2, 3).lineTo(10, -4).lineTo(20, 0)
                .stroke({ width: 8, color: hex, alpha: 0.28 })
            break
        }
        case 'slug': {
            gfx.rect(-46, -2.6, 92, 5.2).fill({ color: 0xffffff, alpha: 0.95 })
            gfx.rect(-96, -1.4, 96, 2.8).fill({ color: hex, alpha: 0.6 })
            gfx.circle(40, 0, 6).fill({ color: hex, alpha: 0.8 })
            break
        }
        default: {
            const len = fromTurret ? 16 : crit ? 34 : 26
            const w = fromTurret ? 2.4 : crit ? 5 : 3.6
            gfx.rect(-len, -w / 2, len * 2, w).fill({ color: 0xffffff, alpha: 0.95 })
            gfx.rect(-len * 2.4, -w * 0.35, len * 2.4, w * 0.7).fill({ color: hex, alpha: 0.55 })
            gfx.circle(len * 0.6, 0, w * 1.3).fill({ color: hex, alpha: 0.8 })
            break
        }
    }
    gfx.blendMode = 'add'
    return gfx
}

/** A lightning jump between two points, drawn once and faded out. */
export function chainArc(layer: Container, x1: number, y1: number, x2: number, y2: number, hex: number) {
    const gfx = new Graphics()
    const steps = 6
    gfx.moveTo(x1, y1)
    for (let i = 1; i < steps; i++) {
        const t = i / steps
        const jitter = (i % 2 ? 1 : -1) * randRange(6, 18)
        const nx = -(y2 - y1)
        const ny = x2 - x1
        const len = Math.hypot(nx, ny) || 1
        gfx.lineTo(x1 + (x2 - x1) * t + (nx / len) * jitter, y1 + (y2 - y1) * t + (ny / len) * jitter)
    }
    gfx.lineTo(x2, y2)
    gfx.stroke({ width: 7, color: hex, alpha: 0.3 })
    gfx.stroke({ width: 2.5, color: 0xffffff, alpha: 0.9 })
    gfx.blendMode = 'add'
    layer.addChild(gfx)
    gsap.to(gfx, { alpha: 0, duration: 0.18, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

export function makeSpitGfx(hex: number) {
    const gfx = new Graphics()
    gfx.circle(0, 0, 7).fill({ color: 0xffffff, alpha: 0.9 })
    gfx.circle(0, 0, 13).fill({ color: hex, alpha: 0.4 })
    gfx.blendMode = 'add'
    track(gsap.to(gfx.scale, { x: 1.25, y: 1.25, duration: 0.3, repeat: -1, yoyo: true }))
    return gfx
}

/** Health pip above a wounded enemy. Rebuilt cheaply — it is a few rects. */
export function drawEnemyHealth(gfx: Graphics, fraction: number, width: number, hex: number, armored = false) {
    gfx.clear()
    if (fraction >= 1 || fraction <= 0) return
    gfx.rect(-width / 2, 0, width, 4).fill({ color: 0x000000, alpha: 0.6 })
    gfx.rect(-width / 2, 0, width * fraction, 4).fill({ color: hex, alpha: 0.95 })
    // Plated units get a hatched bar, so "why is this not dying" has an answer
    // on screen the whole time it is not dying.
    if (!armored) return
    for (let x = -width / 2; x < width / 2; x += 6) {
        gfx.rect(x, 0, 2, 4).fill({ color: 0x0b1220, alpha: 0.55 })
    }
    gfx.rect(-width / 2, -1, width, 6).stroke({ width: 1, color: 0xe2e8f0, alpha: 0.5 })
}

/**
 * A coin shed by something that died. The engine flies it to the wall and banks
 * it; this is only the look — a spinning disc, drawn as a squashing ellipse so
 * it reads as a coin tumbling rather than as a dot.
 */
export function makeCoin(size = 1) {
    const gfx = new Graphics()
    gfx.circle(0, 0, 11 * size).fill({ color: AMBER, alpha: 0.22 })
    gfx.circle(0, 0, 6.5 * size).fill({ color: 0xfde047 })
    gfx.circle(0, 0, 6.5 * size).stroke({ width: 1.4, color: 0xa16207, alpha: 0.9 })
    gfx.circle(-1.6 * size, -1.6 * size, 2.1 * size).fill({ color: 0xfffbeb, alpha: 0.85 })
    return gfx
}

/** The bank flash when a coin reaches the wall. */
export function coinLanded(layer: Container, x: number, y: number) {
    const gfx = new Graphics()
    gfx.circle(0, 0, 9).fill({ color: 0xfde047, alpha: 0.8 })
    gfx.circle(0, 0, 20).stroke({ width: 2, color: AMBER, alpha: 0.5 })
    gfx.blendMode = 'add'
    gfx.position.set(x, y)
    layer.addChild(gfx)
    gsap.to(gfx.scale, { x: 1.9, y: 1.9, duration: 0.26, ease: 'power2.out' })
    gsap.to(gfx, { alpha: 0, duration: 0.26, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}

/** Ground scorch left where something died. Fades on its own. */
export function scorch(layer: Container, x: number, y: number, hex: number, size: number) {
    const gfx = new Graphics()
    gfx.ellipse(0, 0, size, size * 0.3).fill({ color: shadeHex(hex, -0.6), alpha: 0.5 })
    gfx.position.set(x, y)
    layer.addChildAt(gfx, 0)
    gsap.to(gfx, { alpha: 0, duration: 3.5, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}
