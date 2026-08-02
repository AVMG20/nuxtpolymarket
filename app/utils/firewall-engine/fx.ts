import { Container, Graphics, Text } from 'pixi.js'
import type { TextStyleOptions } from 'pixi.js'
import gsap from 'gsap'
import {
    GRID_COLS, GRID_ROWS, HORIZON_Y, LANE_FAR_Y, LANE_NEAR_Y, MUZZLE_X, MUZZLE_Y, RIDGE_LAYERS,
    SPIKE_BAND, STAR_COUNT, TOWER_TOP_Y, TOWER_X, VIEW_H, VIEW_W, WALL_X
} from './constants'
import { clamp, lerp, mixHex, randRange, shadeHex } from './math'
import type { FigureRig } from './types'
import type { FirewallEnemyDefinition } from '#shared/utils/gamelogic/firewall'

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
    /** Overshield dome, alpha driven by remaining shield. */
    shield: Graphics
    /** Player's rail, rotated to the aim vector. */
    turret: Container
    barrel: Container
    /** Flashes white when the wall is struck. */
    hitFlash: Graphics
}

export function buildBastion(): BastionParts {
    const root = new Container()

    // Body of the wall: face, then the tower block behind it.
    const body = new Graphics()
    const groundY = VIEW_H + 10
    body.rect(WALL_X, HORIZON_Y - 4, VIEW_W - WALL_X, groundY - HORIZON_Y)
        .fill({ color: 0x131c2c })
    body.rect(WALL_X, HORIZON_Y - 4, 26, groundY - HORIZON_Y)
        .fill({ color: 0x1d2a40 })
    // Panel seams down the face.
    for (let y = HORIZON_Y + 26; y < VIEW_H; y += 54) {
        body.moveTo(WALL_X, y).lineTo(VIEW_W, y).stroke({ width: 2, color: 0x0a111c, alpha: 0.9 })
    }
    for (let x = WALL_X + 60; x < VIEW_W; x += 74) {
        body.moveTo(x, HORIZON_Y).lineTo(x, VIEW_H).stroke({ width: 2, color: 0x0a111c, alpha: 0.6 })
    }
    // Lit conduits running up the face — the only warm thing in the scene.
    for (let x = WALL_X + 34; x < VIEW_W; x += 74) {
        body.rect(x, HORIZON_Y + 40, 3, VIEW_H - HORIZON_Y - 40).fill({ color: CYAN, alpha: 0.18 })
    }

    // Parapet the sentries stand on.
    body.rect(WALL_X - 12, HORIZON_Y - 22, VIEW_W - WALL_X + 12, 26).fill({ color: 0x24334c })
    for (let x = WALL_X - 8; x < VIEW_W; x += 40) {
        body.rect(x, HORIZON_Y - 40, 22, 20).fill({ color: 0x1d2a40 })
    }

    // The core tower rising behind the parapet.
    body.rect(TOWER_X + 78, TOWER_TOP_Y, 176, HORIZON_Y - TOWER_TOP_Y + 6).fill({ color: 0x18243a })
    body.rect(TOWER_X + 78, TOWER_TOP_Y, 176, 10).fill({ color: 0x2b3d5c })
    for (let i = 0; i < 5; i++) {
        body.rect(TOWER_X + 96, TOWER_TOP_Y + 24 + i * 20, 140, 8)
            .fill({ color: CYAN, alpha: 0.1 + i * 0.03 })
    }
    // Mast and beacon.
    body.rect(TOWER_X + 162, TOWER_TOP_Y - 54, 6, 56).fill({ color: 0x2b3d5c })
    const beacon = new Graphics()
    beacon.circle(TOWER_X + 165, TOWER_TOP_Y - 58, 6).fill({ color: RED })
    beacon.circle(TOWER_X + 165, TOWER_TOP_Y - 58, 14).fill({ color: RED, alpha: 0.2 })
    track(gsap.to(beacon, { alpha: 0.25, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut' }))

    // Turret platform.
    body.rect(TOWER_X + 10, HORIZON_Y - 76, 84, 54).fill({ color: 0x24334c })
    body.rect(TOWER_X + 10, HORIZON_Y - 76, 84, 8).fill({ color: 0x334a6e })

    const damage = new Graphics()
    const core = new Graphics()
    const shield = new Graphics()
    const hitFlash = new Graphics()
    hitFlash.rect(WALL_X - 14, HORIZON_Y - 44, VIEW_W - WALL_X + 14, VIEW_H - HORIZON_Y + 44)
        .fill({ color: 0xffffff })
    hitFlash.alpha = 0
    hitFlash.blendMode = 'add'

    const rail = buildRail()
    rail.root.position.set(MUZZLE_X, MUZZLE_Y)

    root.addChild(body, damage, core, beacon, rail.root, shield, hitFlash)
    drawCore(core, 1)
    track(gsap.to(core.scale, { x: 1.06, y: 1.06, duration: 1.5, repeat: -1, yoyo: true, ease: 'sine.inOut' }))

    return { root, damage, core, shield, turret: rail.root, barrel: rail.barrel, hitFlash }
}

/** The diamond behind the tower glass. Colour is the integrity readout. */
export function drawCore(gfx: Graphics, integrity: number) {
    const hex = integrity > 0.55 ? CYAN : integrity > 0.25 ? AMBER : RED
    const cx = TOWER_X + 166
    const cy = TOWER_TOP_Y + 118
    gfx.clear()
    gfx.poly([cx, cy - 40, cx + 30, cy, cx, cy + 40, cx - 30, cy]).fill({ color: hex, alpha: 0.22 })
    gfx.poly([cx, cy - 26, cx + 19, cy, cx, cy + 26, cx - 19, cy]).fill({ color: hex, alpha: 0.55 })
    gfx.poly([cx, cy - 12, cx + 9, cy, cx, cy + 12, cx - 9, cy]).fill({ color: 0xffffff, alpha: 0.85 })
    gfx.pivot.set(cx, cy)
    gfx.position.set(cx, cy)
}

/**
 * Damage decals, drawn in buckets rather than continuously — a redraw per hit
 * on a full-height Graphics is wasted work nobody can see.
 */
export function drawWallDamage(gfx: Graphics, integrity: number) {
    gfx.clear()
    if (integrity >= 0.98) return
    const severity = 1 - integrity
    const cracks = Math.round(severity * 16)
    for (let i = 0; i < cracks; i++) {
        // Deterministic-ish scatter: seeded off the index so the same damage
        // level always draws the same cracks and the wall does not fizz.
        const seed = i * 97.13
        const x = WALL_X + 20 + ((seed * 7.7) % (VIEW_W - WALL_X - 40))
        const y = HORIZON_Y + 10 + ((seed * 13.3) % (VIEW_H - HORIZON_Y - 30))
        const len = 20 + ((seed * 3.1) % 46)
        gfx.moveTo(x, y)
            .lineTo(x + len * 0.4, y + len * 0.6)
            .lineTo(x - len * 0.2, y + len)
            .stroke({ width: 2, color: 0x000000, alpha: 0.75 })
        if (severity > 0.5) {
            gfx.circle(x, y + len * 0.5, 3 + (seed % 4)).fill({ color: RED, alpha: 0.25 * severity })
        }
    }
    if (severity > 0.35) {
        gfx.rect(WALL_X, HORIZON_Y - 4, VIEW_W - WALL_X, VIEW_H - HORIZON_Y)
            .fill({ color: 0x450a0a, alpha: (severity - 0.35) * 0.5 })
    }
}

/** The overshield dome, wrapping the wall face. */
export function drawShieldDome(gfx: Graphics, fraction: number) {
    gfx.clear()
    if (fraction <= 0) return
    const alpha = 0.12 + fraction * 0.3
    for (let i = 0; i < 3; i++) {
        gfx.ellipse(WALL_X + 40, HORIZON_Y + 190, 92 + i * 12, 300 + i * 16)
            .stroke({ width: 3 - i, color: 0x67e8f9, alpha: alpha * (1 - i * 0.28) })
    }
    gfx.ellipse(WALL_X + 40, HORIZON_Y + 190, 92, 300).fill({ color: 0x22d3ee, alpha: alpha * 0.12 })
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

/** Sentries share one silhouette — a squat autoloader on a post. */
export function buildSentry(): { root: Container, barrel: Container } {
    const root = new Container()
    const post = new Graphics()
    post.rect(-5, 0, 10, 26).fill({ color: 0x1d2a40 })
    post.circle(0, 0, 11).fill({ color: 0x24334c })
    post.circle(0, 0, 11).stroke({ width: 1.5, color: LIME, alpha: 0.45 })

    const barrel = new Container()
    const barrelGfx = new Graphics()
    barrelGfx.rect(-4, -4, 34, 8).fill({ color: 0x2b3d5c })
    barrelGfx.rect(24, -5, 8, 10).fill({ color: 0x334a6e })
    barrelGfx.rect(6, -1.5, 16, 3).fill({ color: LIME, alpha: 0.6 })
    barrel.addChild(barrelGfx)

    root.addChild(barrel, post)
    return { root, barrel }
}

/**
 * The electrified band in front of the wall. Redrawn per frame because the arcs
 * are the whole point — a static trap field reads as scenery and players stop
 * noticing it is doing damage.
 */
export function drawSpikeBand(gfx: Graphics, dps: number, timeMs: number) {
    gfx.clear()
    if (dps <= 0) return
    const intensity = clamp(0.3 + dps / 300, 0, 1)
    const left = WALL_X - SPIKE_BAND
    gfx.rect(left, LANE_FAR_Y - 30, SPIKE_BAND, LANE_NEAR_Y - LANE_FAR_Y + 60)
        .fill({ color: 0x22d3ee, alpha: 0.05 + intensity * 0.06 })

    for (let lane = 0; lane <= 6; lane++) {
        const y = lerp(LANE_FAR_Y - 20, LANE_NEAR_Y + 30, lane / 6)
        gfx.moveTo(left, y).lineTo(WALL_X, y)
            .stroke({ width: 1.5, color: 0x0ea5e9, alpha: 0.2 + intensity * 0.2 })
    }
    // Two travelling arcs, phase-offset, walking up the band.
    for (let a = 0; a < 2; a++) {
        const phase = ((timeMs / 620) + a * 0.5) % 1
        const x = left + SPIKE_BAND * phase
        gfx.moveTo(x, LANE_FAR_Y - 26)
        for (let s = 1; s <= 8; s++) {
            const t = s / 8
            const y = lerp(LANE_FAR_Y - 26, LANE_NEAR_Y + 30, t)
            gfx.lineTo(x + Math.sin(t * 9 + timeMs / 90) * 12, y)
        }
        gfx.stroke({ width: 2.5, color: 0x67e8f9, alpha: 0.35 + intensity * 0.4 })
    }
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

    // Hit flash: an additive blob over the body's footprint. A silhouette-shaped
    // copy would be prettier but doubles the geometry of every figure on screen.
    const flash = new Graphics()
    flash.ellipse(0, -h * 0.45, h * 0.3, h * 0.5).fill({ color: 0xffffff })
    flash.blendMode = 'add'
    flash.alpha = 0
    root.addChild(flash)

    return {
        root, torso, legFront, legBack, armFront, armBack, flash,
        height: h, torsoBaseY: torso.position.y
    }
}

/** Advances a figure's walk cycle. `stride` is radians accumulated from distance. */
export function poseFigure(rig: FigureRig, stride: number, kind: string, attacking: boolean) {
    if (kind === 'flyer') {
        rig.armFront.rotation = Math.sin(stride * 0.8) * 0.35
        rig.armBack.rotation = Math.PI - Math.sin(stride * 0.8) * 0.35
        rig.torso.rotation = Math.sin(stride * 0.5) * 0.08
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

/** Bullet tracer: a stretched capsule that fades behind the round. */
export function makeTracer(hex: number, crit: boolean, fromSentry: boolean) {
    const gfx = new Graphics()
    const len = fromSentry ? 16 : crit ? 34 : 26
    const w = fromSentry ? 2.4 : crit ? 5 : 3.6
    gfx.rect(-len, -w / 2, len * 2, w).fill({ color: 0xffffff, alpha: 0.95 })
    gfx.rect(-len * 2.4, -w * 0.35, len * 2.4, w * 0.7).fill({ color: hex, alpha: 0.55 })
    gfx.circle(len * 0.6, 0, w * 1.3).fill({ color: hex, alpha: 0.8 })
    gfx.blendMode = 'add'
    return gfx
}

export function makeSpitGfx(hex: number) {
    const gfx = new Graphics()
    gfx.circle(0, 0, 7).fill({ color: 0xffffff, alpha: 0.9 })
    gfx.circle(0, 0, 13).fill({ color: hex, alpha: 0.4 })
    gfx.blendMode = 'add'
    track(gsap.to(gfx.scale, { x: 1.25, y: 1.25, duration: 0.3, repeat: -1, yoyo: true }))
    return gfx
}

/** Health pip above a wounded enemy. Rebuilt cheaply — it is two rects. */
export function drawEnemyHealth(gfx: Graphics, fraction: number, width: number, hex: number) {
    gfx.clear()
    if (fraction >= 1 || fraction <= 0) return
    gfx.rect(-width / 2, 0, width, 4).fill({ color: 0x000000, alpha: 0.6 })
    gfx.rect(-width / 2, 0, width * fraction, 4).fill({ color: hex, alpha: 0.95 })
}

/** Ground scorch left where something died. Fades on its own. */
export function scorch(layer: Container, x: number, y: number, hex: number, size: number) {
    const gfx = new Graphics()
    gfx.ellipse(0, 0, size, size * 0.3).fill({ color: shadeHex(hex, -0.6), alpha: 0.5 })
    gfx.position.set(x, y)
    layer.addChildAt(gfx, 0)
    gsap.to(gfx, { alpha: 0, duration: 3.5, onComplete: () => { if (!gfx.destroyed) gfx.destroy() } })
}
