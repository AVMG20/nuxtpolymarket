import {
    PIRATE_CANNON_TIERS, PIRATE_ENEMY_TIERS, pirateShipSkin,
    type PirateBossKind, type PirateSkinPalette
} from '#shared/utils/gamelogic/pirates'
import { ENEMY_GUNS, PLAYER_GUN_SIZE, enemyHull, pirateGunMounts, playerHull, type HullSize } from './layout'
import type { SimEnemyState, SimGun } from './types'
import { clamp01, css, mix, rgba, seededRandom, shade, sprites, stampGlow } from './fx'

// Procedural ship art, top-down. The game draws every hull with drawShip and
// the Armory, history and wiki pages reuse drawShipPreview, so a skin looks the
// same in the shop as it does at sea. Everything is drawn in ship-local space
// (+x = bow) from the same hull sizes the sim uses for hit radii, and every gun
// is drawn at its real mount, pointing where the sim says it is aiming.

export interface ShipLook {
    kind: 'player' | 'ally' | 'enemy'
    palette: PirateSkinPalette
    tierId?: string
    sizeScale: number
    spectral?: boolean
    boss?: PirateBossKind | null
    /** Player skins only: which skin's silhouette and signature details to draw. */
    skinId?: string
}

export interface ShipPose {
    x: number
    y: number
    angle: number
    time: number
    guns: SimGun[]
    flash: number
    damage: number
    alpha: number
    velocity: number
}

type HullShape = 'brig' | 'sleek' | 'barge' | 'galleon' | 'serpent' | 'aether' | 'crown'
type SailStyle = 'square' | 'lateen' | 'tattered' | 'none'
type Special = 'fire' | 'iron' | 'orb' | 'mortar' | null
type Figurehead = 'serpent' | 'crown' | 'crystal' | 'skull' | null

interface HullDesign {
    shape: HullShape
    masts: number
    sail: SailStyle
    special: Special
    figurehead: Figurehead
    /** Jolly roger on enemies, the skin accent on the player. */
    flag: number
    /** Sail emblem: a dark mark on the main course (crimson skull, crown star). */
    emblem: 'skull' | 'star' | 'rune' | null
}

// ─── Looks ──────────────────────────────────────────────────────────────────

const SKIN_DESIGNS: Record<string, Omit<HullDesign, 'flag'>> = {
    'starter': { shape: 'brig', masts: 2, sail: 'square', special: null, figurehead: null, emblem: null },
    'crimson-privateer': { shape: 'sleek', masts: 2, sail: 'square', special: null, figurehead: 'skull', emblem: 'skull' },
    'emerald-serpent': { shape: 'serpent', masts: 2, sail: 'square', special: null, figurehead: 'serpent', emblem: null },
    'royal-aether': { shape: 'aether', masts: 2, sail: 'square', special: null, figurehead: 'crystal', emblem: 'rune' },
    'crown-of-tides': { shape: 'crown', masts: 3, sail: 'square', special: null, figurehead: 'crown', emblem: 'star' }
}

const ENEMY_DESIGNS: Record<string, Omit<HullDesign, 'flag'>> = {
    sloop: { shape: 'brig', masts: 1, sail: 'square', special: null, figurehead: null, emblem: null },
    razorskiff: { shape: 'sleek', masts: 1, sail: 'lateen', special: null, figurehead: null, emblem: null },
    fireship: { shape: 'brig', masts: 1, sail: 'tattered', special: 'fire', figurehead: null, emblem: null },
    corsair: { shape: 'sleek', masts: 2, sail: 'square', special: null, figurehead: null, emblem: 'skull' },
    brigantine: { shape: 'brig', masts: 2, sail: 'square', special: null, figurehead: null, emblem: null },
    sniper: { shape: 'sleek', masts: 1, sail: 'lateen', special: null, figurehead: null, emblem: null },
    ironclad: { shape: 'barge', masts: 1, sail: 'square', special: 'iron', figurehead: null, emblem: null },
    harpooner: { shape: 'brig', masts: 2, sail: 'square', special: null, figurehead: null, emblem: null },
    frigate: { shape: 'galleon', masts: 2, sail: 'square', special: null, figurehead: null, emblem: null },
    mortar: { shape: 'barge', masts: 0, sail: 'none', special: 'mortar', figurehead: null, emblem: null },
    tidecaller: { shape: 'brig', masts: 1, sail: 'square', special: 'orb', figurehead: null, emblem: null },
    manowar: { shape: 'galleon', masts: 3, sail: 'square', special: null, figurehead: null, emblem: 'skull' },
    ghostship: { shape: 'brig', masts: 2, sail: 'tattered', special: null, figurehead: 'skull', emblem: null },
    dreadnought: { shape: 'galleon', masts: 3, sail: 'square', special: null, figurehead: 'skull', emblem: 'skull' },
    phantom: { shape: 'galleon', masts: 3, sail: 'tattered', special: null, figurehead: 'skull', emblem: 'rune' }
}

export function skinLook(skinId: string): ShipLook {
    const skin = pirateShipSkin(skinId)
    return { kind: 'player', palette: skin.palette, sizeScale: 1, skinId: skin.id }
}

/** Enemy palettes: dark stained hulls with the tier colour on sails and trim. */
export function enemyLook(tierId: string): ShipLook {
    const tier = PIRATE_ENEMY_TIERS.find(entry => entry.id === tierId) ?? PIRATE_ENEMY_TIERS[0]!
    const c = tier.color
    let palette: PirateSkinPalette = {
        hull: mix(0x2a1d14, c, 0.16),
        deck: mix(0x5c4329, c, 0.1),
        trim: shade(c, 0.12),
        sail: mix(c, 0xd8cfbd, 0.32),
        accent: c
    }
    let spectral = false
    if (tierId === 'fireship') palette = { hull: 0x1c120e, deck: 0x2e1f16, trim: 0x7c2d12, sail: 0x3b2a22, accent: 0xf97316 }
    else if (tierId === 'ironclad') palette = { hull: 0x334155, deck: 0x475569, trim: 0x93c5fd, sail: 0x9aa7b8, accent: 0x60a5fa }
    else if (tierId === 'mortar') palette = { hull: 0x3f3226, deck: 0x6b5a45, trim: 0xa8a29e, sail: 0x78716c, accent: 0xfbbf24 }
    else if (tierId === 'tidecaller') palette = { hull: 0x10303a, deck: 0x2a4d56, trim: 0x67e8f9, sail: 0x7dd3dd, accent: 0x22d3ee, glow: true }
    else if (tierId === 'dreadnought') palette = { hull: 0x170b0b, deck: 0x3a1d18, trim: 0xef4444, sail: 0x7f1d1d, accent: 0xef4444 }
    else if (tierId === 'ghostship') {
        palette = { hull: 0x0f3b33, deck: 0x1d5a4d, trim: 0x5eead4, sail: 0x99f6e4, accent: 0x2dd4bf, glow: true }
        spectral = true
    } else if (tierId === 'phantom') {
        palette = { hull: 0x0c2f3a, deck: 0x155e63, trim: 0xccfbf1, sail: 0x5eead4, accent: 0x99f6e4, glow: true }
        spectral = true
    }
    return { kind: 'enemy', palette, tierId, sizeScale: tier.sizeScale ?? 1, spectral, boss: tier.boss ?? null }
}

function designFor(look: ShipLook): HullDesign {
    if (look.kind !== 'enemy') {
        const base = SKIN_DESIGNS[look.skinId ?? 'starter'] ?? SKIN_DESIGNS.starter!
        return { ...base, flag: look.palette.accent }
    }
    const base = ENEMY_DESIGNS[look.tierId ?? 'sloop'] ?? ENEMY_DESIGNS.sloop!
    return { ...base, flag: 0x111111 }
}

function hullOf(look: ShipLook): HullSize {
    return look.kind === 'enemy' ? enemyHull(look.sizeScale) : playerHull(look.sizeScale)
}

// ─── Hull paths (cached per shape and size) ────────────────────────────────

const pathCache = new Map<string, Path2D>()

function hullPath(shape: HullShape, length: number, beam: number) {
    const key = `${shape}|${length.toFixed(1)}|${beam.toFixed(1)}`
    let path = pathCache.get(key)
    if (path) return path
    path = new Path2D()
    const bow = length / 2
    const stern = -length / 2
    const half = beam / 2
    if (shape === 'barge') {
        const r = beam * 0.3
        path.moveTo(bow - r, -half)
        path.quadraticCurveTo(bow, -half, bow, -half + r)
        path.lineTo(bow, half - r)
        path.quadraticCurveTo(bow, half, bow - r, half)
        path.lineTo(stern + r * 0.5, half)
        path.quadraticCurveTo(stern, half, stern, half - r * 0.5)
        path.lineTo(stern, -half + r * 0.5)
        path.quadraticCurveTo(stern, -half, stern + r * 0.5, -half)
        path.closePath()
    } else {
        // Bow sharpness, where the beam peaks, and how square the stern is.
        const sharp = shape === 'sleek' || shape === 'serpent' ? 0.62 : shape === 'galleon' || shape === 'crown' ? 0.95 : 0.8
        const peak = shape === 'galleon' || shape === 'crown' ? -0.05 : 0.05
        const sternHalf = shape === 'galleon' || shape === 'crown' ? 0.4 : shape === 'sleek' || shape === 'serpent' ? 0.26 : 0.32
        path.moveTo(bow, 0)
        path.bezierCurveTo(bow * sharp, -half * 0.3, length * (0.22 + peak), -half, length * peak, -half)
        path.lineTo(-length * 0.34, -half * 0.95)
        path.quadraticCurveTo(stern, -half * 0.9, stern, -beam * sternHalf)
        path.lineTo(stern, beam * sternHalf)
        path.quadraticCurveTo(stern, half * 0.9, -length * 0.34, half * 0.95)
        path.lineTo(length * peak, half)
        path.bezierCurveTo(length * (0.22 + peak), half, bow * sharp, half * 0.3, bow, 0)
        path.closePath()
    }
    pathCache.set(key, path)
    return path
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** World units per device pixel under the current transform, for minimum line widths. */
function pixelUnit(ctx: CanvasRenderingContext2D) {
    const m = ctx.getTransform()
    const scale = Math.hypot(m.a, m.b)
    return scale > 0 ? 1 / scale : 1
}

function mastPositions(count: number, length: number) {
    if (count <= 0) return []
    if (count === 1) return [length * 0.04]
    if (count === 2) return [length * 0.16, -length * 0.14]
    return [length * 0.24, 0, -length * 0.24]
}

/** The bellied outline of a square sail: straight yard at `mastX`, canvas bulging `belly` toward the bow. */
function sailPath(ctx: CanvasRenderingContext2D, mastX: number, half: number, belly: number) {
    ctx.beginPath()
    ctx.moveTo(mastX, -half)
    ctx.bezierCurveTo(mastX + belly * 1.3, -half * 0.55, mastX + belly * 1.3, half * 0.55, mastX, half)
    ctx.closePath()
}

function drawSail(ctx: CanvasRenderingContext2D, style: SailStyle, mastX: number, width: number, depth: number, billow: number, color: number, damage: number, seed: number, unit: number) {
    if (style === 'none') return
    const alpha = ctx.globalAlpha
    if (style === 'lateen') {
        // A triangular fore-and-aft sail swung a little off the centreline.
        const swing = 0.22 + billow * 0.1
        ctx.fillStyle = 'rgba(2,10,20,0.28)'
        ctx.beginPath()
        ctx.moveTo(mastX + depth * 2.4 + 2, -width * 0.05 + 2.5)
        ctx.quadraticCurveTo(mastX + 2, -width * (0.34 + swing) + 2.5, mastX - depth * 2.8 + 2, -width * 0.12 + 2.5)
        ctx.closePath()
        ctx.fill()
        const gradient = ctx.createLinearGradient(mastX, 0, mastX, -width * 0.4)
        gradient.addColorStop(0, css(shade(color, -0.2)))
        gradient.addColorStop(1, css(shade(color, 0.15)))
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(mastX + depth * 2.4, -width * 0.05)
        ctx.quadraticCurveTo(mastX, -width * (0.34 + swing), mastX - depth * 2.8, -width * 0.12)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = css(shade(color, -0.45))
        ctx.lineWidth = Math.max(unit * 1.2, width * 0.03)
        ctx.stroke()
        return
    }
    // A square course seen from above: a straight yard with the canvas
    // bellied out toward the bow, fuller the faster the ship sails. The
    // topsail sits above it, narrower and brighter, so the rig reads as
    // stacked canvas rather than a flat sliver.
    const half = width / 2
    const belly = depth * (0.75 + billow * 0.5)
    const draw = (x: number, w: number, b: number, tint: number, holes: number) => {
        // Shadow the sail throws on the deck (light from the upper left).
        ctx.fillStyle = 'rgba(2,10,20,0.3)'
        sailPath(ctx, x + 2.2, w + 0.5, b)
        ctx.save()
        ctx.translate(0, 2.4)
        ctx.fill()
        ctx.restore()
        const gradient = ctx.createLinearGradient(x, 0, x + b, 0)
        gradient.addColorStop(0, css(shade(tint, -0.3)))
        gradient.addColorStop(0.45, css(tint))
        gradient.addColorStop(1, css(shade(tint, 0.2)))
        ctx.fillStyle = gradient
        sailPath(ctx, x, w, b)
        ctx.fill()
        // Seams following the belly.
        ctx.strokeStyle = rgba(shade(tint, -0.4), 0.28)
        ctx.lineWidth = Math.max(unit, w * 0.03)
        for (const f of [0.4, 0.72]) {
            ctx.beginPath()
            ctx.moveTo(x, -w * f)
            ctx.bezierCurveTo(x + b * 1.3 * (1 - f * 0.9), -w * f * 0.55, x + b * 1.3 * (1 - f * 0.9), w * f * 0.55, x, w * f)
            ctx.stroke()
        }
        // Lit leading edge.
        ctx.strokeStyle = rgba(0xffffff, 0.45)
        ctx.lineWidth = Math.max(unit * 1.2, w * 0.045)
        ctx.beginPath()
        ctx.moveTo(x, -w)
        ctx.bezierCurveTo(x + b * 1.3, -w * 0.55, x + b * 1.3, w * 0.55, x, w)
        ctx.stroke()
        // Dark edge of the canvas.
        ctx.strokeStyle = rgba(shade(tint, -0.55), 0.7)
        ctx.lineWidth = Math.max(unit, w * 0.03)
        sailPath(ctx, x, w, b)
        ctx.stroke()
        if (holes > 0) {
            // Rents in the canvas: water shows through as dark notches.
            const random = seededRandom(seed + x)
            ctx.fillStyle = 'rgba(8,18,28,0.6)'
            for (let i = 0; i < holes; i++) {
                const y = (random() - 0.5) * w * 1.5
                const px = x + random() * b * 0.8
                ctx.beginPath()
                ctx.arc(px, y, 1 + random() * 1.8, 0, Math.PI * 2)
                ctx.fill()
            }
        }
    }
    const holes = style === 'tattered' ? 4 : damage > 0.45 ? Math.round((damage - 0.45) * 8) : 0
    draw(mastX, half, belly, color, holes)
    draw(mastX + belly * 0.5, half * 0.66, belly * 0.75, shade(color, 0.08), Math.ceil(holes / 2))
    // The yard, poking out past the canvas at both ends.
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#2a1c10'
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(unit * 1.6, width * 0.05)
    ctx.beginPath()
    ctx.moveTo(mastX, -half * 1.08)
    ctx.lineTo(mastX, half * 1.08)
    ctx.stroke()
    ctx.lineCap = 'butt'
}

function drawEmblem(ctx: CanvasRenderingContext2D, emblem: HullDesign['emblem'], x: number, size: number, palette: PirateSkinPalette, time: number) {
    if (!emblem) return
    if (emblem === 'skull') {
        ctx.fillStyle = 'rgba(15,10,10,0.75)'
        ctx.beginPath()
        ctx.arc(x, 0, size * 0.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = css(shade(palette.sail, 0.3))
        ctx.beginPath()
        ctx.arc(x + size * 0.08, -size * 0.18, size * 0.13, 0, Math.PI * 2)
        ctx.arc(x + size * 0.08, size * 0.18, size * 0.13, 0, Math.PI * 2)
        ctx.fill()
    } else if (emblem === 'star') {
        ctx.fillStyle = css(palette.hull)
        ctx.beginPath()
        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? size * 0.6 : size * 0.25
            const a = i / 10 * Math.PI * 2
            ctx.lineTo(x + Math.cos(a) * r, Math.sin(a) * r)
        }
        ctx.closePath()
        ctx.fill()
    } else {
        // A glowing rune line.
        ctx.strokeStyle = rgba(palette.accent, 0.7 + Math.sin(time * 3) * 0.2)
        ctx.lineWidth = size * 0.14
        ctx.beginPath()
        ctx.moveTo(x - size * 0.2, -size * 0.55)
        ctx.lineTo(x + size * 0.3, 0)
        ctx.lineTo(x - size * 0.2, size * 0.55)
        ctx.stroke()
    }
}

function drawFigurehead(ctx: CanvasRenderingContext2D, kind: Figurehead, bow: number, beam: number, palette: PirateSkinPalette, time: number) {
    if (!kind) return
    if (kind === 'serpent') {
        // A jade serpent's neck and head curling off the bow.
        const sway = Math.sin(time * 2.2) * beam * 0.08
        ctx.strokeStyle = css(shade(palette.trim, -0.1))
        ctx.lineWidth = beam * 0.16
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(bow - beam * 0.2, 0)
        ctx.quadraticCurveTo(bow + beam * 0.2, -beam * 0.2 + sway, bow + beam * 0.42, sway)
        ctx.stroke()
        ctx.fillStyle = css(palette.accent)
        ctx.beginPath()
        ctx.ellipse(bow + beam * 0.5, sway, beam * 0.16, beam * 0.11, 0, 0, Math.PI * 2)
        ctx.fill()
        stampGlowNormal(ctx, 0xfacc15, bow + beam * 0.55, sway - beam * 0.05, beam * 0.08)
        stampGlowNormal(ctx, 0xfacc15, bow + beam * 0.55, sway + beam * 0.05, beam * 0.08)
        ctx.lineCap = 'butt'
    } else if (kind === 'crown') {
        // A gilded crown on the bow, points forward.
        ctx.fillStyle = css(0xfacc15)
        ctx.strokeStyle = css(0x92400e)
        ctx.lineWidth = beam * 0.03
        ctx.beginPath()
        const x = bow - beam * 0.05
        const s = beam * 0.24
        ctx.moveTo(x - s, -s)
        ctx.lineTo(x + s * 0.3, -s)
        ctx.lineTo(x + s * 1.1, -s * 0.6)
        ctx.lineTo(x + s * 0.5, -s * 0.2)
        ctx.lineTo(x + s * 1.2, 0)
        ctx.lineTo(x + s * 0.5, s * 0.2)
        ctx.lineTo(x + s * 1.1, s * 0.6)
        ctx.lineTo(x + s * 0.3, s)
        ctx.lineTo(x - s, s)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        stampGlowNormal(ctx, palette.accent, x, 0, s * 0.45)
    } else if (kind === 'crystal') {
        ctx.fillStyle = css(palette.accent)
        ctx.beginPath()
        ctx.moveTo(bow + beam * 0.34, 0)
        ctx.lineTo(bow - beam * 0.02, -beam * 0.1)
        ctx.lineTo(bow - beam * 0.08, 0)
        ctx.lineTo(bow - beam * 0.02, beam * 0.1)
        ctx.closePath()
        ctx.fill()
        stampGlowNormal(ctx, palette.accent, bow + beam * 0.1, 0, beam * 0.4 * (0.8 + Math.sin(time * 4) * 0.2))
    } else {
        ctx.fillStyle = '#e7e5e4'
        ctx.beginPath()
        ctx.arc(bow - beam * 0.02, 0, beam * 0.1, 0, Math.PI * 2)
        ctx.fill()
    }
}

/** Additive glow stamp that restores normal compositing, for use mid-drawing. */
function stampGlowNormal(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, radius: number, alpha = 0.9) {
    ctx.globalCompositeOperation = 'lighter'
    stampGlow(ctx, color, x, y, radius, alpha * ctx.globalAlpha)
    ctx.globalCompositeOperation = 'source-over'
}

const TIER_RANK = new Map(PIRATE_CANNON_TIERS.map((tier, index) => [tier.id, index / (PIRATE_CANNON_TIERS.length - 1)]))

/**
 * One barrel at its mount, aimed in world space. `hullAngle` is the ship's
 * heading; the caller has translated to the ship centre but not rotated.
 */
function drawGun(ctx: CanvasRenderingContext2D, gun: SimGun, hullAngle: number, unit: number, spectral: boolean) {
    const cos = Math.cos(hullAngle)
    const sin = Math.sin(hullAngle)
    const mx = gun.mountX * cos - gun.mountY * sin
    const my = gun.mountX * sin + gun.mountY * cos
    const rank = gun.tierId ? TIER_RANK.get(gun.tierId) ?? 0 : 0.15
    const bore = Math.max(gun.bore, unit * 2)
    const length = gun.length
    const kick = gun.recoil * length * 0.35
    ctx.save()
    ctx.translate(mx, my)
    ctx.rotate(gun.aim)
    const metal = spectral ? mix(0x0f3b3a, gun.color, 0.4) : gun.style === 'spectral' ? mix(0x134e4a, gun.color, 0.35) : 0x26221f

    if (gun.style === 'mortar') {
        // A squat tube seen from above: a fat ring with a dark bore.
        const r = bore * 0.75
        ctx.fillStyle = css(shade(metal, 0.1))
        ctx.beginPath()
        ctx.arc(-kick * 0.3, 0, r * 1.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = css(mix(metal, gun.color, 0.3))
        ctx.beginPath()
        ctx.arc(-kick * 0.3, 0, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#0c0a09'
        ctx.beginPath()
        ctx.arc(-kick * 0.3, 0, r * 0.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        if (gun.charge > 0.9) {
            // A faint ember deep in the tube just before it fires.
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xfb923c, mx, my, r * 0.9, (gun.charge - 0.9) * 4 * ctx.globalAlpha)
            ctx.globalCompositeOperation = 'source-over'
        }
        return
    }

    // Swivel base.
    ctx.fillStyle = css(shade(metal, -0.2))
    ctx.beginPath()
    ctx.arc(0, 0, bore * 1.15, 0, Math.PI * 2)
    ctx.fill()

    const barrelStart = -bore * 0.5 - kick
    const barrelEnd = length - kick
    if (gun.style === 'harpoon') {
        ctx.fillStyle = css(shade(metal, 0.12))
        ctx.fillRect(barrelStart, -bore * 0.55, length * 0.8, bore * 1.1)
        // The loaded spear, visible while the launcher is charged.
        if (gun.charge > 0.4) {
            ctx.strokeStyle = '#d6d3d1'
            ctx.lineWidth = Math.max(unit * 1.5, bore * 0.3)
            ctx.beginPath()
            ctx.moveTo(barrelStart, 0)
            ctx.lineTo(barrelEnd, 0)
            ctx.stroke()
            ctx.fillStyle = css(mix(0xd6d3d1, gun.color, 0.5))
            ctx.beginPath()
            ctx.moveTo(barrelEnd + bore * 1.1, 0)
            ctx.lineTo(barrelEnd - bore * 0.2, -bore * 0.6)
            ctx.lineTo(barrelEnd - bore * 0.2, bore * 0.6)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
        return
    }

    const thickness = gun.style === 'long' ? bore * 0.7 : bore
    const gradient = ctx.createLinearGradient(0, -thickness / 2, 0, thickness / 2)
    gradient.addColorStop(0, css(shade(metal, 0.45)))
    gradient.addColorStop(0.4, css(shade(metal, 0.08)))
    gradient.addColorStop(1, css(shade(metal, -0.45)))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(barrelStart, -thickness * 0.62)
    ctx.lineTo(barrelEnd, -thickness * 0.45)
    ctx.lineTo(barrelEnd, thickness * 0.45)
    ctx.lineTo(barrelStart, thickness * 0.62)
    ctx.closePath()
    ctx.fill()
    // Dark edge so the barrel stays legible over pale canvas.
    ctx.strokeStyle = 'rgba(4,8,14,0.7)'
    ctx.lineWidth = Math.max(unit, thickness * 0.18)
    ctx.stroke()
    // Reinforcing band in dark iron and a muted tier-tinted band at the muzzle:
    // a hint of colour on a metal gun, not a light.
    ctx.fillStyle = css(shade(metal, -0.35))
    ctx.fillRect(barrelStart + length * 0.3, -thickness * 0.6, Math.max(unit * 1.5, length * 0.1), thickness * 1.2)
    ctx.fillStyle = css(mix(shade(metal, 0.05), gun.color, 0.35 + rank * 0.15))
    ctx.fillRect(barrelEnd - Math.max(unit * 2, length * 0.18), -thickness * 0.6, Math.max(unit * 2, length * 0.18), thickness * 1.2)
    // Dark bore at the muzzle.
    ctx.fillStyle = '#07090c'
    ctx.fillRect(barrelEnd - Math.max(unit, length * 0.06), -thickness * 0.3, Math.max(unit, length * 0.06), thickness * 0.6)
    if (gun.style === 'long') {
        ctx.fillStyle = css(shade(metal, 0.2))
        ctx.fillRect(barrelStart + length * 0.35, -thickness * 1.1, length * 0.2, thickness * 0.5)
    }
    ctx.restore()

    // A brief, small flash at the muzzle only while the barrel is kicking back from a shot.
    if (gun.recoil > 0.15) {
        const tipX = mx + Math.cos(gun.aim) * barrelEnd
        const tipY = my + Math.sin(gun.aim) * barrelEnd
        const flash = (gun.recoil - 0.15) / 0.85
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, gun.color, tipX, tipY, bore * (1.2 + flash * 1.6), flash * 0.8 * ctx.globalAlpha, true)
        ctx.globalCompositeOperation = 'source-over'
    }
}

// ─── Skin signatures ────────────────────────────────────────────────────────
// The paid skins carry a standing aura on top of their trails (fx.ts
// emitSkinTrail): Aether's orbiting crystal shards, the Crown's halo of light
// rays. Drawn in world space around the hull centre, under the hull.

export function drawSkinAura(ctx: CanvasRenderingContext2D, skinId: string | undefined, length: number, beam: number, time: number, strength = 1) {
    if (!skinId) return
    ctx.globalCompositeOperation = 'lighter'
    const base = ctx.globalAlpha
    if (skinId === 'royal-aether') {
        const pulse = 0.75 + Math.sin(time * 2.4) * 0.25
        stampGlow(ctx, 0x7c3aed, 0, 0, length * 0.95, 0.32 * pulse * strength * base)
        ctx.globalCompositeOperation = 'source-over'
        // Crystal shards on an elliptical orbit around the hull.
        for (let i = 0; i < 5; i++) {
            const a = time * 1.1 + i / 5 * Math.PI * 2
            const x = Math.cos(a) * length * 0.62
            const y = Math.sin(a) * beam * 1.05
            ctx.globalAlpha = base * strength * (0.7 + Math.sin(a) * 0.3)
            ctx.fillStyle = i % 2 ? '#e9d5ff' : '#c084fc'
            ctx.beginPath()
            ctx.moveTo(x, y - 4)
            ctx.lineTo(x + 2.2, y)
            ctx.lineTo(x, y + 4)
            ctx.lineTo(x - 2.2, y)
            ctx.closePath()
            ctx.fill()
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xc084fc, x, y, 9, 0.6 * base * strength)
            ctx.globalCompositeOperation = 'source-over'
        }
    } else if (skinId === 'crown-of-tides') {
        const pulse = 0.8 + Math.sin(time * 1.8) * 0.2
        stampGlow(ctx, 0x2563eb, 0, 0, length * 1.05, 0.34 * pulse * strength * base)
        stampGlow(ctx, 0xfacc15, 0, 0, length * 0.7, 0.28 * pulse * strength * base)
        // Slowly turning light rays beneath the hull.
        ctx.save()
        ctx.rotate(time * 0.25)
        for (let i = 0; i < 10; i++) {
            ctx.rotate(Math.PI * 2 / 10)
            const reach = length * (0.72 + Math.sin(time * 2 + i) * 0.1)
            const gradient = ctx.createLinearGradient(0, 0, reach, 0)
            gradient.addColorStop(0, 'rgba(253,224,71,0.3)')
            gradient.addColorStop(1, 'rgba(253,224,71,0)')
            ctx.globalAlpha = base * strength * 0.8
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(reach, -beam * 0.12)
            ctx.lineTo(reach, beam * 0.12)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
    } else if (skinId === 'emerald-serpent') {
        stampGlow(ctx, 0x10b981, 0, 0, length * 0.7, 0.14 * strength * base)
    } else if (skinId === 'crimson-privateer') {
        stampGlow(ctx, 0x7f1d1d, 0, 0, length * 0.6, 0.12 * strength * base)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = base
}

// ─── Ship ───────────────────────────────────────────────────────────────────

export function drawShip(ctx: CanvasRenderingContext2D, look: ShipLook, pose: ShipPose) {
    const design = designFor(look)
    const hull = hullOf(look)
    const { length, beam } = hull
    const palette = look.palette
    const unit = pixelUnit(ctx)
    const speed = clamp01(pose.velocity / 260)
    const spectral = !!look.spectral
    const alpha = pose.alpha * (spectral ? 0.78 : 1)
    if (alpha <= 0.01) return
    const time = pose.time
    const seed = (look.tierId?.length ?? 3) * 97 + Math.round(length)

    ctx.save()
    ctx.translate(pose.x, pose.y)
    ctx.globalAlpha = alpha

    // Aura beneath the hull: boss menace, spectral shimmer, glow skins.
    if (look.boss || spectral || palette.glow) {
        ctx.globalCompositeOperation = 'lighter'
        const pulse = 0.8 + Math.sin(time * 2.6) * 0.2
        const auraColor = look.boss && !spectral ? 0xdc2626 : palette.accent
        stampGlow(ctx, auraColor, 0, 0, length * (look.boss ? 1.05 : 0.8), (look.boss ? 0.36 : 0.22) * pulse * alpha)
        ctx.globalCompositeOperation = 'source-over'
    }
    if (look.kind === 'player' && !spectral) drawSkinAura(ctx, look.skinId, length, beam, time)

    ctx.save()
    ctx.rotate(pose.angle)
    // Slight heel with speed, and a gentle bob.
    const bob = Math.sin(time * 2 + seed) * 0.6
    ctx.translate(0, bob)
    const path = hullPath(design.shape, length, beam)

    // Soft shadow on the water, offset down-right to match the island and palm shadows.
    ctx.save()
    ctx.fillStyle = spectral ? 'rgba(20,80,90,0.14)' : 'rgba(2,12,26,0.2)'
    ctx.translate(2.5, 3.5)
    ctx.fill(path)
    ctx.translate(2, 2.5)
    ctx.scale(1.03, 1.06)
    ctx.fill(path)
    ctx.restore()

    // Planked hull: dark rim, lit centre.
    const hullGradient = ctx.createLinearGradient(0, -beam / 2, 0, beam / 2)
    hullGradient.addColorStop(0, css(shade(palette.hull, -0.35)))
    hullGradient.addColorStop(0.3, css(palette.hull))
    hullGradient.addColorStop(0.5, css(shade(palette.hull, 0.14)))
    hullGradient.addColorStop(0.7, css(palette.hull))
    hullGradient.addColorStop(1, css(shade(palette.hull, -0.5)))
    ctx.fillStyle = hullGradient
    ctx.fill(path)
    // Heavy dark rim so the silhouette holds against the sea at 40px.
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(unit * 2.2, beam * 0.08)
    ctx.strokeStyle = css(mix(shade(palette.hull, -0.7), 0x05101c, 0.5))
    ctx.stroke(path)

    // Gunwale in trim, then the deck inset.
    ctx.save()
    ctx.scale(0.9, 0.82)
    ctx.lineWidth = Math.max(unit * 1.5, beam * 0.07)
    ctx.strokeStyle = css(palette.trim)
    ctx.stroke(path)
    ctx.scale(0.93, 0.86)
    const deckGradient = ctx.createLinearGradient(-length / 2, -beam / 2, length / 2, beam / 2)
    deckGradient.addColorStop(0, css(shade(palette.deck, 0.1)))
    deckGradient.addColorStop(1, css(shade(palette.deck, -0.12)))
    ctx.fillStyle = deckGradient
    ctx.fill(path)
    ctx.clip(path)
    // Planks.
    ctx.strokeStyle = rgba(shade(palette.deck, -0.35), 0.5)
    ctx.lineWidth = Math.max(unit, beam * 0.018)
    ctx.beginPath()
    for (let y = -beam / 2; y < beam / 2; y += beam / 7) {
        ctx.moveTo(-length / 2, y)
        ctx.lineTo(length / 2, y)
    }
    ctx.stroke()
    // Inner shadow along the gunwale gives the deck depth.
    ctx.lineWidth = Math.max(unit * 2, beam * 0.1)
    ctx.strokeStyle = 'rgba(2,10,20,0.28)'
    ctx.stroke(path)
    ctx.restore()

    drawHullDetails(ctx, look, design, length, beam, unit, time, seed)

    // Scorch marks as the hull takes damage.
    if (pose.damage > 0.08) {
        const random = seededRandom(seed * 7)
        ctx.fillStyle = `rgba(18,10,6,${(0.25 + pose.damage * 0.45).toFixed(2)})`
        const marks = Math.ceil(pose.damage * 6)
        for (let i = 0; i < marks; i++) {
            ctx.beginPath()
            ctx.ellipse((random() - 0.5) * length * 0.7, (random() - 0.5) * beam * 0.6, 3 + random() * beam * 0.18, 2 + random() * beam * 0.12, random() * 3, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    // Masts and sails.
    const masts = mastPositions(design.masts, length)
    const billow = speed + Math.sin(time * 2.8 + seed) * 0.08
    const sailWidth = beam * (design.shape === 'crown' || design.shape === 'galleon' ? 1.12 : 1.02)
    // Rigging from the masts to the rails, under the canvas.
    if (masts.length) {
        ctx.strokeStyle = 'rgba(30,20,12,0.5)'
        ctx.lineWidth = Math.max(unit, beam * 0.015)
        ctx.beginPath()
        for (const mastX of masts) {
            ctx.moveTo(mastX, 0)
            ctx.lineTo(mastX - length * 0.1, -beam * 0.42)
            ctx.moveTo(mastX, 0)
            ctx.lineTo(mastX - length * 0.1, beam * 0.42)
        }
        ctx.moveTo(masts[0]!, 0)
        ctx.lineTo(length * 0.62, 0)
        ctx.stroke()
    }
    // Bowsprit and a small jib.
    if (design.shape !== 'barge') {
        ctx.strokeStyle = '#2a1c10'
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(unit * 1.5, beam * 0.06)
        ctx.beginPath()
        ctx.moveTo(length * 0.4, 0)
        ctx.lineTo(length * 0.66, 0)
        ctx.stroke()
        ctx.lineCap = 'butt'
        if (design.sail !== 'none') {
            ctx.fillStyle = css(shade(palette.sail, -0.06))
            ctx.globalAlpha = alpha * 0.9
            ctx.beginPath()
            ctx.moveTo(length * 0.64, 0)
            ctx.quadraticCurveTo(length * 0.5, -beam * (0.2 + billow * 0.08), length * 0.34, -beam * 0.04)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = rgba(shade(palette.sail, -0.5), 0.6)
            ctx.lineWidth = Math.max(unit, beam * 0.02)
            ctx.stroke()
            ctx.globalAlpha = alpha
        }
    }
    // Sails from the stern forward so the foresail overlaps the main.
    for (let index = masts.length - 1; index >= 0; index--) {
        const mastX = masts[index]!
        const main = masts.length > 1 && index === (masts.length === 3 ? 1 : 0)
        const depth = beam * 0.34 * (main ? 1.12 : 1)
        const sailColor = spectral ? mix(palette.sail, 0xffffff, 0.2) : palette.sail
        ctx.globalAlpha = alpha * (design.sail === 'tattered' ? 0.85 : 1)
        drawSail(ctx, design.sail, mastX, sailWidth * (main ? 1 : 0.88), depth, billow, sailColor, pose.damage, seed + index, unit)
        ctx.globalAlpha = alpha
        if ((main || masts.length === 1) && design.sail === 'square') drawEmblem(ctx, design.emblem, mastX + depth * 0.55, beam * 0.3, palette, time)
        // Mast top.
        ctx.fillStyle = '#2a1c10'
        ctx.beginPath()
        ctx.arc(mastX, 0, Math.max(unit * 1.6, beam * 0.075), 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#8a6a44'
        ctx.beginPath()
        ctx.arc(mastX - beam * 0.015, -beam * 0.015, Math.max(unit, beam * 0.035), 0, Math.PI * 2)
        ctx.fill()
    }
    drawFigurehead(ctx, design.figurehead, length / 2, beam, palette, time)

    // Flag streaming astern from the aftmost mast: the skin accent on the
    // player, the tier colour on enemies so they read at a glance.
    if (masts.length) {
        const flagX = masts[masts.length - 1]!
        const flutter = Math.sin(time * 9 + seed) * beam * 0.08
        const flagColor = look.kind === 'enemy' ? palette.accent : design.flag
        ctx.fillStyle = css(flagColor)
        ctx.strokeStyle = css(shade(flagColor, -0.5))
        ctx.lineWidth = Math.max(unit, beam * 0.02)
        ctx.beginPath()
        ctx.moveTo(flagX, 0)
        ctx.quadraticCurveTo(flagX - beam * 0.3, flutter, flagX - beam * 0.6, flutter * 1.6)
        ctx.lineTo(flagX - beam * 0.55, beam * 0.18 + flutter)
        ctx.quadraticCurveTo(flagX - beam * 0.25, beam * 0.18, flagX, beam * 0.13)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        if (look.kind === 'enemy') {
            ctx.fillStyle = '#0c0a09'
            ctx.beginPath()
            ctx.arc(flagX - beam * 0.28, beam * 0.09 + flutter * 0.7, beam * 0.055, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    // Hit flash tints the whole hull white-red.
    if (pose.flash > 0.01) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.min(1, pose.flash) * 0.55 * alpha
        ctx.fillStyle = '#ff9a8a'
        ctx.fill(path)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = alpha
    }

    // Stern lantern.
    ctx.globalCompositeOperation = 'lighter'
    const lantern = 0.7 + Math.sin(time * 7 + seed) * 0.12 + Math.sin(time * 13) * 0.06
    stampGlow(ctx, palette.accent, -length / 2 + beam * 0.12, 0, beam * 0.4, lantern * alpha * 0.45)
    stampGlow(ctx, 0xfff7d6, -length / 2 + beam * 0.12, 0, beam * 0.11, lantern * alpha * 0.7, true)
    ctx.globalCompositeOperation = 'source-over'

    ctx.restore()

    // Guns on top, aimed in world space.
    for (const gun of pose.guns) drawGun(ctx, gun, pose.angle, unit, spectral)

    // Spectral outline shimmer.
    if (spectral) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = alpha * (0.35 + Math.sin(time * 5) * 0.12)
        ctx.rotate(pose.angle)
        ctx.strokeStyle = css(palette.accent)
        ctx.lineWidth = Math.max(unit * 1.5, beam * 0.06)
        ctx.stroke(path)
        ctx.globalCompositeOperation = 'source-over'
    }
    ctx.restore()
}

/** Silhouette-specific details drawn on the deck: rails, armour, cargo, figure work. */
function drawHullDetails(ctx: CanvasRenderingContext2D, look: ShipLook, design: HullDesign, length: number, beam: number, unit: number, time: number, seed: number) {
    const palette = look.palette
    // Captain's cabin roof on the quarterdeck, and a hatch grate amidships.
    if (design.shape !== 'barge') {
        const cabinX = -length * (design.shape === 'galleon' || design.shape === 'crown' ? 0.4 : 0.36)
        const cabinW = length * 0.13
        const cabinH = beam * 0.5
        ctx.fillStyle = 'rgba(2,10,20,0.3)'
        ctx.fillRect(cabinX + 1.5, -cabinH / 2 + 2, cabinW, cabinH)
        const roof = ctx.createLinearGradient(0, -cabinH / 2, 0, cabinH / 2)
        roof.addColorStop(0, css(shade(palette.hull, 0.22)))
        roof.addColorStop(1, css(shade(palette.hull, -0.15)))
        ctx.fillStyle = roof
        ctx.fillRect(cabinX, -cabinH / 2, cabinW, cabinH)
        ctx.strokeStyle = css(palette.trim)
        ctx.lineWidth = Math.max(unit, beam * 0.03)
        ctx.strokeRect(cabinX, -cabinH / 2, cabinW, cabinH)
        // Ship's wheel just forward of the cabin.
        ctx.strokeStyle = css(shade(palette.trim, -0.2))
        ctx.lineWidth = Math.max(unit, beam * 0.025)
        ctx.beginPath()
        ctx.arc(cabinX + cabinW + beam * 0.1, 0, beam * 0.07, 0, Math.PI * 2)
        ctx.stroke()
        const hatchX = length * 0.02
        ctx.fillStyle = 'rgba(10,6,4,0.55)'
        ctx.fillRect(hatchX - beam * 0.14, -beam * 0.13, beam * 0.28, beam * 0.26)
        ctx.strokeStyle = rgba(shade(palette.deck, 0.25), 0.7)
        ctx.lineWidth = Math.max(unit, beam * 0.02)
        ctx.strokeRect(hatchX - beam * 0.14, -beam * 0.13, beam * 0.28, beam * 0.26)
        ctx.beginPath()
        ctx.moveTo(hatchX, -beam * 0.13)
        ctx.lineTo(hatchX, beam * 0.13)
        ctx.moveTo(hatchX - beam * 0.14, 0)
        ctx.lineTo(hatchX + beam * 0.14, 0)
        ctx.stroke()
    }

    if (design.shape === 'serpent') {
        // Scales along the hull sides.
        ctx.strokeStyle = rgba(palette.accent, 0.5)
        ctx.lineWidth = Math.max(unit, beam * 0.025)
        for (let side = -1; side <= 1; side += 2) {
            ctx.beginPath()
            for (let x = -length * 0.38; x < length * 0.3; x += beam * 0.2) {
                ctx.moveTo(x + beam * 0.1, side * beam * 0.43)
                ctx.arc(x, side * beam * 0.43, beam * 0.1, 0, Math.PI * side, side < 0)
            }
            ctx.stroke()
        }
    } else if (design.shape === 'aether') {
        // Crystal-studded rails that pulse in turn.
        for (let i = 0; i < 7; i++) {
            const x = -length * 0.36 + i / 6 * length * 0.66
            for (let side = -1; side <= 1; side += 2) {
                const y = side * beam * 0.41 * (1 - Math.abs(x) / length * 0.5)
                const glow = 0.5 + Math.sin(time * 3 - i * 0.7) * 0.5
                ctx.fillStyle = css(mix(palette.trim, palette.accent, glow))
                ctx.beginPath()
                ctx.moveTo(x, y - beam * 0.07)
                ctx.lineTo(x + beam * 0.05, y)
                ctx.lineTo(x, y + beam * 0.07)
                ctx.lineTo(x - beam * 0.05, y)
                ctx.closePath()
                ctx.fill()
                stampGlowNormal(ctx, palette.accent, x, y, beam * 0.16, 0.4 + glow * 0.5)
            }
        }
        // A crystal core amidships.
        stampGlowNormal(ctx, palette.accent, 0, 0, beam * 0.5, 0.5 + Math.sin(time * 2) * 0.15)
    } else if (design.shape === 'crown') {
        // Gilded, ornate stern castle with scrollwork and sapphire lights.
        const sternX = -length / 2
        ctx.fillStyle = css(0xd4a017)
        ctx.beginPath()
        ctx.moveTo(sternX - beam * 0.06, -beam * 0.42)
        ctx.quadraticCurveTo(sternX - beam * 0.22, 0, sternX - beam * 0.06, beam * 0.42)
        ctx.lineTo(sternX + beam * 0.18, beam * 0.36)
        ctx.lineTo(sternX + beam * 0.18, -beam * 0.36)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = css(0x78350f)
        ctx.lineWidth = Math.max(unit, beam * 0.025)
        ctx.stroke()
        for (let i = -1; i <= 1; i++) stampGlowNormal(ctx, palette.trim, sternX + beam * 0.02, i * beam * 0.22, beam * 0.12, 0.9)
        // Gold rail studs.
        ctx.fillStyle = css(0xfde68a)
        for (let i = 0; i < 8; i++) {
            const x = -length * 0.34 + i / 7 * length * 0.62
            ctx.beginPath()
            ctx.arc(x, -beam * 0.4, beam * 0.035, 0, Math.PI * 2)
            ctx.arc(x, beam * 0.4, beam * 0.035, 0, Math.PI * 2)
            ctx.fill()
        }
    } else if (design.shape === 'sleek' && look.skinId === 'crimson-privateer') {
        // Silver racing stripe down each side.
        ctx.strokeStyle = css(palette.trim)
        ctx.lineWidth = Math.max(unit, beam * 0.03)
        ctx.beginPath()
        ctx.moveTo(-length * 0.4, -beam * 0.36)
        ctx.lineTo(length * 0.3, -beam * 0.3)
        ctx.moveTo(-length * 0.4, beam * 0.36)
        ctx.lineTo(length * 0.3, beam * 0.3)
        ctx.stroke()
    }

    if (design.special === 'iron') {
        // Riveted armour plates.
        ctx.strokeStyle = 'rgba(15,23,42,0.6)'
        ctx.lineWidth = Math.max(unit, beam * 0.03)
        for (let x = -length * 0.4; x < length * 0.42; x += length * 0.16) {
            ctx.strokeRect(x, -beam * 0.4, length * 0.15, beam * 0.8)
        }
        ctx.fillStyle = '#cbd5e1'
        for (let x = -length * 0.38; x < length * 0.42; x += length * 0.08) {
            ctx.fillRect(x, -beam * 0.36, unit * 2, unit * 2)
            ctx.fillRect(x, beam * 0.34, unit * 2, unit * 2)
        }
        // A squat funnel with a hot glow.
        ctx.fillStyle = '#1e293b'
        ctx.beginPath()
        ctx.arc(-length * 0.18, 0, beam * 0.17, 0, Math.PI * 2)
        ctx.fill()
        stampGlowNormal(ctx, 0xf97316, -length * 0.18, 0, beam * 0.14, 0.6)
    } else if (design.special === 'mortar') {
        // Powder barrels stacked on the barge.
        ctx.fillStyle = '#5b3d22'
        for (let i = 0; i < 4; i++) {
            ctx.beginPath()
            ctx.arc(-length * 0.32 + (i % 2) * beam * 0.3, (i < 2 ? -1 : 1) * beam * 0.2, beam * 0.12, 0, Math.PI * 2)
            ctx.fill()
        }
    } else if (design.special === 'orb') {
        const pulse = 0.7 + Math.sin(time * 3) * 0.3
        ctx.strokeStyle = rgba(palette.accent, 0.6)
        ctx.lineWidth = Math.max(unit * 1.2, beam * 0.03)
        ctx.beginPath()
        ctx.arc(length * 0.04, 0, beam * (0.35 + pulse * 0.08), 0, Math.PI * 2)
        ctx.stroke()
        stampGlowNormal(ctx, palette.accent, length * 0.04, 0, beam * 0.8, pulse)
        ctx.fillStyle = '#ecfeff'
        ctx.beginPath()
        ctx.arc(length * 0.04, 0, beam * 0.1, 0, Math.PI * 2)
        ctx.fill()
    } else if (design.special === 'fire') {
        // Flames licking up from the deck of the fire ship.
        const random = seededRandom(seed)
        for (let i = 0; i < 5; i++) {
            const x = (random() - 0.5) * length * 0.7
            const y = (random() - 0.5) * beam * 0.5
            const flicker = 0.6 + Math.sin(time * 14 + i * 2.1) * 0.25 + Math.sin(time * 23 + i) * 0.15
            stampGlowNormal(ctx, 0xf97316, x, y, beam * 0.45 * flicker, 0.9)
            stampGlowNormal(ctx, 0xfde047, x, y, beam * 0.18 * flicker, 0.8)
        }
    }
}

// ─── The Kraken ─────────────────────────────────────────────────────────────

const KRAKEN_RISE_MS = 900

export interface KrakenPose {
    x: number
    y: number
    time: number
    hpFrac: number
    state: SimEnemyState
    stateMs: number
    tentacles: { x: number, y: number, raise: number }[]
    flash: number
    alpha: number
}

/** How far above the surface the Kraken is: 0 submerged, 1 fully surfaced. */
export function krakenEmergence(state: SimEnemyState, stateMs: number) {
    if (state === 'submerged') return 0
    if (state === 'surfacing') return 1 - clamp01(stateMs / KRAKEN_RISE_MS)
    if (state === 'diving') return clamp01(stateMs / KRAKEN_RISE_MS)
    return 1
}

export function drawKraken(ctx: CanvasRenderingContext2D, pose: KrakenPose) {
    const tier = PIRATE_ENEMY_TIERS.find(entry => entry.id === 'kraken')
    const radius = enemyHull(tier?.sizeScale ?? 1.7).length * 0.46
    const up = krakenEmergence(pose.state, pose.stateMs)
    const unit = pixelUnit(ctx)
    const time = pose.time
    ctx.save()
    ctx.translate(pose.x, pose.y)
    ctx.globalAlpha = pose.alpha

    // The shape beneath the surface is always faintly visible.
    ctx.fillStyle = `rgba(10,4,24,${(0.3 + (1 - up) * 0.2).toFixed(2)})`
    ctx.beginPath()
    ctx.ellipse(0, 4, radius * 1.3, radius * 1.1, 0, 0, Math.PI * 2)
    ctx.fill()

    // Churning foam where it breaks the surface: a soft band with a brighter crest.
    ctx.lineCap = 'round'
    ctx.strokeStyle = `rgba(230,245,255,${(0.08 + up * 0.18).toFixed(2)})`
    ctx.lineWidth = Math.max(unit * 3, 9)
    ctx.beginPath()
    ctx.ellipse(0, 0, radius * (1.18 + Math.sin(time * 2) * 0.04), radius * (1.02 + Math.cos(time * 2.3) * 0.04), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(240,250,255,${(0.15 + up * 0.35).toFixed(2)})`
    ctx.lineWidth = Math.max(unit * 1.5, 2.5)
    for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + time * 0.6
        ctx.beginPath()
        ctx.ellipse(0, 0, radius * (1.2 + Math.sin(time * 2 + i) * 0.05), radius * (1.04 + Math.cos(time * 2.3 + i) * 0.05), 0, a, a + 0.5)
        ctx.stroke()
    }

    // Tentacles, drawn as tapering chains of discs along a swaying curve.
    for (let index = 0; index < pose.tentacles.length; index++) {
        const t = pose.tentacles[index]!
        const dx = t.x - pose.x
        const dy = t.y - pose.y
        const reach = Math.hypot(dx, dy) || 1
        const nx = dx / reach
        const ny = dy / reach
        const raise = clamp01(t.raise) * (0.35 + up * 0.65)
        const baseX = nx * radius * 0.7
        const baseY = ny * radius * 0.7
        const sway = Math.sin(time * 2.4 + index * 1.7) * reach * 0.18
        const cx = (baseX + dx) / 2 - ny * sway
        const cy = (baseY + dy) / 2 + nx * sway
        const segments = 18
        for (let s = 0; s <= segments; s++) {
            const u = s / segments
            const inv = 1 - u
            const px = inv * inv * baseX + 2 * inv * u * cx + u * u * dx
            const py = inv * inv * baseY + 2 * inv * u * cy + u * u * dy
            const r = (4 + raise * 11) * (1 - u * 0.8)
            ctx.fillStyle = css(mix(0x3b0764, 0x7c3aed, 0.3 + raise * 0.4 - u * 0.2))
            ctx.globalAlpha = pose.alpha * (0.45 + raise * 0.55)
            ctx.beginPath()
            ctx.arc(px, py, r, 0, Math.PI * 2)
            ctx.fill()
            if (s % 2 === 0 && raise > 0.4 && u < 0.85) {
                ctx.fillStyle = '#f5d0fe'
                ctx.beginPath()
                ctx.arc(px - ny * r * 0.4, py + nx * r * 0.4, Math.max(unit, r * 0.22), 0, Math.PI * 2)
                ctx.fill()
            }
        }
        if (raise > 0.6) {
            // Spray where a raised tentacle slaps the water.
            ctx.globalAlpha = pose.alpha * (raise - 0.6) * 1.6
            ctx.strokeStyle = 'rgba(230,245,255,0.8)'
            ctx.lineWidth = Math.max(unit * 1.5, 2)
            ctx.beginPath()
            ctx.arc(dx, dy, 10 + raise * 8, 0, Math.PI * 2)
            ctx.stroke()
        }
    }
    ctx.globalAlpha = pose.alpha

    if (up > 0.02) {
        const scale = 0.82 + up * 0.18
        ctx.save()
        ctx.scale(scale, scale)
        ctx.globalAlpha = pose.alpha * up
        const sway = Math.sin(time * 0.6) * 0.12
        ctx.rotate(sway)
        // The mantle: a great bulbous head, eyes toward the viewer's south.
        const mantle = ctx.createRadialGradient(-radius * 0.2, -radius * 0.3, radius * 0.1, 0, 0, radius * 1.1)
        mantle.addColorStop(0, '#7c3aed')
        mantle.addColorStop(0.5, '#4c1d95')
        mantle.addColorStop(1, '#1e0b3b')
        ctx.fillStyle = mantle
        ctx.beginPath()
        ctx.ellipse(0, -radius * 0.12, radius * 0.82, radius, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#150828'
        ctx.lineWidth = Math.max(unit * 1.5, 3)
        ctx.stroke()
        // Mottling.
        const random = seededRandom(1337)
        ctx.fillStyle = 'rgba(196,181,253,0.18)'
        for (let i = 0; i < 12; i++) {
            ctx.beginPath()
            ctx.arc((random() - 0.5) * radius * 1.2, (random() - 0.7) * radius * 1.3, 3 + random() * 7, 0, Math.PI * 2)
            ctx.fill()
        }
        // Wounds as it weakens.
        if (pose.hpFrac < 0.7) {
            ctx.fillStyle = `rgba(190,18,60,${((0.7 - pose.hpFrac) * 0.9).toFixed(2)})`
            for (let i = 0; i < 4; i++) {
                ctx.beginPath()
                ctx.ellipse((random() - 0.5) * radius, (random() - 0.6) * radius, 6, 3, random() * 3, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        // Eyes: glowing, slit-pupiled, blinking now and then.
        const blink = (Math.sin(time * 0.9) > 0.97) ? 0.15 : 1
        for (let side = -1; side <= 1; side += 2) {
            const ex = side * radius * 0.36
            const ey = radius * 0.42
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xfacc15, ex, ey, radius * 0.4, 0.55 * up * pose.alpha)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = pose.alpha * up
            ctx.fillStyle = '#fde047'
            ctx.beginPath()
            ctx.ellipse(ex, ey, radius * 0.16, radius * 0.11 * blink, side * 0.3, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#1c1917'
            ctx.beginPath()
            ctx.ellipse(ex, ey, radius * 0.035, radius * 0.09 * blink, side * 0.3, 0, Math.PI * 2)
            ctx.fill()
        }
        if (pose.flash > 0.01) {
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = Math.min(1, pose.flash) * 0.5 * pose.alpha
            ctx.fillStyle = '#ff9a8a'
            ctx.beginPath()
            ctx.ellipse(0, -radius * 0.12, radius * 0.82, radius, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.restore()
    }
    ctx.restore()
}

// ─── Guns for previews ──────────────────────────────────────────────────────

/** Build display guns for a look: real mounts, aimed at `aim` (world angle). */
export function previewGuns(look: ShipLook, aim: number, options: { gunCount?: number, gunColors?: number[], gunTierIds?: string[] } = {}): SimGun[] {
    const hull = hullOf(look)
    if (look.kind === 'enemy') {
        const spec = ENEMY_GUNS[look.tierId ?? 'sloop']
        if (!spec || spec.count <= 0) return []
        return pirateGunMounts(spec.count, hull).map(mount => ({
            mountX: mount.x, mountY: mount.y, aim, color: spec.color, length: spec.length * look.sizeScale, bore: spec.bore * look.sizeScale,
            recoil: 0, charge: 1, style: spec.style
        }))
    }
    const count = options.gunCount ?? options.gunTierIds?.length ?? options.gunColors?.length ?? 2
    return pirateGunMounts(count, hull).map((mount, index) => {
        const tierId = options.gunTierIds?.[index]
        const tier = tierId ? PIRATE_CANNON_TIERS.find(entry => entry.id === tierId) : undefined
        const size = PLAYER_GUN_SIZE[tierId ?? 'swivel'] ?? PLAYER_GUN_SIZE.swivel!
        return {
            mountX: mount.x, mountY: mount.y, aim,
            color: options.gunColors?.[index] ?? tier?.shotColor ?? look.palette.trim,
            length: size.length, bore: size.bore, recoil: 0, charge: 1, style: 'cannon' as const, tierId
        }
    })
}

/**
 * Draw one ship (or the Kraken) centred and fitted in a preview canvas, bow
 * toward the upper right, guns aimed the same way. Paid skins show a light
 * version of their signature aura and trail so the Armory sells the upgrade.
 */
export function drawShipPreview(canvas: HTMLCanvasElement, look: ShipLook, options: { angle?: number, time?: number, gunCount?: number, gunColors?: number[], gunTierIds?: string[] } = {}) {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const cssWidth = canvas.clientWidth || canvas.width || 160
    const cssHeight = canvas.clientHeight || canvas.height || 120
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const angle = options.angle ?? -Math.PI / 4
    const time = options.time ?? 0

    if (look.tierId === 'kraken') {
        const tier = PIRATE_ENEMY_TIERS.find(entry => entry.id === 'kraken')
        const radius = enemyHull(tier?.sizeScale ?? 1.7).length * 0.46
        const extent = radius * 4.2
        const scale = Math.min(width, height) / extent
        ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2)
        const tentacles = Array.from({ length: 6 }, (_, i) => {
            const a = i / 6 * Math.PI * 2 + 0.3
            return { x: Math.cos(a) * radius * 1.8, y: Math.sin(a) * radius * 1.6, raise: 0.6 + Math.sin(time * 2 + i) * 0.35 }
        })
        drawKraken(ctx, { x: 0, y: 0, time, hpFrac: 1, state: 'sailing', stateMs: 0, tentacles, flash: 0, alpha: 1 })
        return
    }

    const hull = hullOf(look)
    // The rotated hull's bounding box, with room for guns, sails and aura.
    const extentX = Math.abs(Math.cos(angle)) * hull.length + Math.abs(Math.sin(angle)) * hull.beam * 1.4
    const extentY = Math.abs(Math.sin(angle)) * hull.length + Math.abs(Math.cos(angle)) * hull.beam * 1.4
    const paid = look.kind === 'player' && look.skinId && look.skinId !== 'starter'
    const margin = paid ? 1.55 : 1.28
    const scale = Math.min(width / (extentX * margin), height / (extentY * margin))
    ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2)
    if (paid) drawPreviewTrail(ctx, look.skinId!, hull, angle, time)
    drawShip(ctx, look, {
        x: 0, y: 0, angle, time, guns: previewGuns(look, angle, options), flash: 0, damage: 0, alpha: 1, velocity: 180
    })
}

/** A still, hand-placed version of each paid skin's trail for the previews. */
function drawPreviewTrail(ctx: CanvasRenderingContext2D, skinId: string, hull: HullSize, angle: number, time: number) {
    const back = angle + Math.PI
    const sternX = Math.cos(angle) * -hull.length / 2
    const sternY = Math.sin(angle) * -hull.length / 2
    const side = angle + Math.PI / 2
    const along = (d: number, offset = 0) => ({
        x: sternX + Math.cos(back) * d + Math.cos(side) * offset,
        y: sternY + Math.sin(back) * d + Math.sin(side) * offset
    })
    const spriteCache = sprites()
    if (skinId === 'crimson-privateer') {
        for (let i = 0; i < 6; i++) {
            const p = along(8 + i * 9, Math.sin(time * 2 + i) * 3)
            const r = 6 + i * 2.2
            ctx.globalAlpha = 0.5 - i * 0.06
            ctx.drawImage(spriteCache.smoke(0x1c1917), p.x - r, p.y - r, r * 2, r * 2)
        }
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 4; i++) {
            const p = along(6 + i * 11, Math.sin(time * 3 + i * 2) * 5)
            stampGlow(ctx, 0xef4444, p.x, p.y, 3, 0.8)
        }
    } else if (skinId === 'emerald-serpent') {
        ctx.globalCompositeOperation = 'lighter'
        for (let strand = -1; strand <= 1; strand += 2) {
            for (let i = 0; i < 16; i++) {
                const p = along(4 + i * 4, Math.sin(time * 3 + i * 0.5 + strand * 1.6) * hull.beam * 0.3 * strand)
                stampGlow(ctx, strand > 0 ? 0x34d399 : 0x10b981, p.x, p.y, 6 + i * 0.3, 0.4 - i * 0.02)
            }
        }
    } else if (skinId === 'royal-aether') {
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 12; i++) {
            const p = along(4 + i * 5, Math.sin(time * 2 + i) * 4)
            stampGlow(ctx, i % 2 ? 0xc084fc : 0x8b5cf6, p.x, p.y, 7 + i * 0.6, 0.35 - i * 0.02)
        }
    } else if (skinId === 'crown-of-tides') {
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 14; i++) {
            const p = along(4 + i * 5, Math.sin(time * 2.5 + i) * 6)
            stampGlow(ctx, 0x3b82f6, p.x, p.y, 10 + i * 0.5, 0.25)
            stampGlow(ctx, 0xfacc15, p.x + Math.sin(i * 7) * 4, p.y + Math.cos(i * 5) * 4, 3.5, 0.9, true)
        }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
}
