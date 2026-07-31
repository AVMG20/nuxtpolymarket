import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import gsap from 'gsap'
import { MOTHERSHIP_RADIUS, STAR_LAYERS, VIEW_H, VIEW_W, WORLD_H, WORLD_W } from './constants'
import { randRange } from './math'
import type { VoidEnemyDefinition, VoidRockDefinition } from '#shared/utils/gamelogic/void'

const LABEL_STYLE = new TextStyle({ fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xffffff })

/**
 * Every looping tween this module starts is recorded here. Display objects get
 * torn down between runs, and a `repeat: -1` tween left pointing at a destroyed
 * container throws on its next frame — so the owner kills its set before it
 * clears a layer.
 *
 * Tweens are bucketed by scope because two consumers share these builders: the
 * live game, and the hangar's ship showcase. Resetting a run must not silently
 * freeze the showcase, and closing the showcase must not stop a paused run's
 * engine flames.
 */
export type FxScope = 'game' | 'showcase'

const trackedTweens: Record<FxScope, gsap.core.Tween[]> = { game: [], showcase: [] }
let currentScope: FxScope = 'game'

/** Everything built inside `fn` is attributed to `scope`. */
export function withFxScope<T>(scope: FxScope, fn: () => T): T {
    const previous = currentScope
    currentScope = scope
    try {
        return fn()
    } finally {
        currentScope = previous
    }
}

function track<T extends gsap.core.Tween>(tween: T): T {
    trackedTweens[currentScope].push(tween)
    return tween
}

export function killFxScope(scope: FxScope) {
    for (const tween of trackedTweens[scope]) tween.kill()
    trackedTweens[scope].length = 0
}

export function killAllFxTweens() {
    killFxScope('game')
}

/** Mixes two packed RGB colours — handy for panel shading without gradients. */
function mix(a: number, b: number, t: number) {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
    return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) & 0xffffff
}

function shade(color: number, amount: number) {
    return amount < 0 ? mix(color, 0x000000, -amount) : mix(color, 0xffffff, amount)
}

// ─── Backdrop ───────────────────────────────────────────────────────────────

/**
 * Three parallax star layers, each baked into a single Graphics — thousands of
 * dots that never change are far cheaper as one geometry than as sprites.
 */
export function buildStarfield() {
    return STAR_LAYERS.map((layer) => {
        const container = new Container()
        const gfx = new Graphics()
        for (let i = 0; i < layer.count; i++) {
            const x = Math.random() * WORLD_W * 1.6 - WORLD_W * 0.3
            const y = Math.random() * WORLD_H * 1.6 - WORLD_H * 0.3
            const r = layer.radius * randRange(0.5, 1.6)
            const alpha = layer.alpha * randRange(0.4, 1)
            gfx.circle(x, y, r).fill({ color: layer.tint, alpha })
            // A handful of the brightest stars get a soft bloom and cross flare.
            if (layer.parallax > 0.6 && Math.random() < 0.06) {
                gfx.circle(x, y, r * 4).fill({ color: layer.tint, alpha: alpha * 0.14 })
                gfx.rect(x - r * 6, y - r * 0.22, r * 12, r * 0.44).fill({ color: 0xffffff, alpha: alpha * 0.28 })
                gfx.rect(x - r * 0.22, y - r * 6, r * 0.44, r * 12).fill({ color: 0xffffff, alpha: alpha * 0.28 })
            }
        }
        container.addChild(gfx)
        return { container, parallax: layer.parallax }
    })
}

/**
 * Flat deep-space fill, drawn in screen space and never moved. Anything large
 * that slides with the camera reads as sheets of fog sweeping over the sector,
 * so the backdrop is deliberately inert — the parallax comes from the stars.
 */
export function drawNebula(gfx: Graphics) {
    gfx.clear()
    gfx.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x04050c })
}

/**
 * Static set dressing pinned to the viewport: a couple of distant worlds and a
 * few muted constellations. None of it moves, so it never competes with the
 * things you actually have to track.
 */
export function drawStaticBackdrop(gfx: Graphics, _tint: number) {
    gfx.clear()
}

/** Slow-drifting dust motes so empty space still has parallax cues up close. */
export function buildDustField(layer: Container, count: number) {
    for (let i = 0; i < count; i++) {
        const mote = new Graphics()
        const r = randRange(1, 2.6)
        mote.circle(0, 0, r).fill({ color: 0x94a3b8, alpha: randRange(0.15, 0.4) })
        mote.position.set(Math.random() * WORLD_W, Math.random() * WORLD_H)
        layer.addChild(mote)
        const drift = randRange(30, 90)
        const dur = randRange(6, 14)
        track(gsap.to(mote.position, { x: `+=${randRange(-drift, drift)}`, y: `+=${randRange(-drift, drift)}`, duration: dur, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
        track(gsap.to(mote, { alpha: 0.05, duration: dur * 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    }
}

/** The hard edge of the surveyed sector — hazard chevrons on a dim frame. */
export function drawWorldBounds(gfx: Graphics) {
    gfx.clear()
    gfx.rect(0, 0, WORLD_W, WORLD_H).stroke({ width: 4, color: 0x1e293b, alpha: 0.9 })
    gfx.rect(-14, -14, WORLD_W + 28, WORLD_H + 28).stroke({ width: 2, color: 0x334155, alpha: 0.5 })
    const step = 120
    for (let x = 0; x < WORLD_W; x += step) {
        gfx.poly([x, 0, x + 40, 0, x + 26, 16, x - 14, 16]).fill({ color: 0x475569, alpha: 0.28 })
        gfx.poly([x, WORLD_H, x + 40, WORLD_H, x + 26, WORLD_H - 16, x - 14, WORLD_H - 16]).fill({ color: 0x475569, alpha: 0.28 })
    }
    for (let y = 0; y < WORLD_H; y += step) {
        gfx.poly([0, y, 0, y + 40, 16, y + 26, 16, y - 14]).fill({ color: 0x475569, alpha: 0.28 })
        gfx.poly([WORLD_W, y, WORLD_W, y + 40, WORLD_W - 16, y + 26, WORLD_W - 16, y - 14]).fill({ color: 0x475569, alpha: 0.28 })
    }
}

/** The one safe place in the sector. Counter-rotating rings, warm dock glow. */
export function buildMothership() {
    const root = new Container()

    const glow = new Graphics()
    glow.circle(0, 0, MOTHERSHIP_RADIUS * 2.6).fill({ color: 0x22d3ee, alpha: 0.05 })
    glow.circle(0, 0, MOTHERSHIP_RADIUS * 1.7).fill({ color: 0x22d3ee, alpha: 0.07 })
    root.addChild(glow)

    const dockRing = new Graphics()
    dockRing.circle(0, 0, 200).stroke({ width: 2, color: 0x22d3ee, alpha: 0.32 })
    for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2
        dockRing.moveTo(Math.cos(a) * 192, Math.sin(a) * 192)
            .lineTo(Math.cos(a) * 206, Math.sin(a) * 206)
            .stroke({ width: 2, color: 0x22d3ee, alpha: 0.2 })
    }
    root.addChild(dockRing)

    const outerRing = new Graphics()
    outerRing.circle(0, 0, MOTHERSHIP_RADIUS * 1.18).stroke({ width: 7, color: 0x155e75, alpha: 0.95 })
    outerRing.circle(0, 0, MOTHERSHIP_RADIUS * 1.18).stroke({ width: 2, color: 0x67e8f9, alpha: 0.4 })
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        const cx = Math.cos(a) * MOTHERSHIP_RADIUS * 1.18
        const cy = Math.sin(a) * MOTHERSHIP_RADIUS * 1.18
        const nx = Math.cos(a + Math.PI / 2)
        const ny = Math.sin(a + Math.PI / 2)
        outerRing.poly([
            cx + nx * 10, cy + ny * 10,
            cx - nx * 10, cy - ny * 10,
            cx - nx * 6 + Math.cos(a) * 18, cy - ny * 6 + Math.sin(a) * 18,
            cx + nx * 6 + Math.cos(a) * 18, cy + ny * 6 + Math.sin(a) * 18
        ]).fill({ color: 0x0e7490 })
        outerRing.circle(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12, 3.4).fill({ color: 0x67e8f9, alpha: 0.95 })
    }
    root.addChild(outerRing)

    const hull = new Graphics()
    hull.circle(0, 0, MOTHERSHIP_RADIUS).fill({ color: 0x1e293b })
    // Radial bulkheads plus a plated skin, so it reads as a station and not a disc.
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const a2 = ((i + 1) / 12) * Math.PI * 2
        hull.poly([
            Math.cos(a) * 40, Math.sin(a) * 40,
            Math.cos(a) * MOTHERSHIP_RADIUS, Math.sin(a) * MOTHERSHIP_RADIUS,
            Math.cos(a2) * MOTHERSHIP_RADIUS, Math.sin(a2) * MOTHERSHIP_RADIUS,
            Math.cos(a2) * 40, Math.sin(a2) * 40
        ]).fill({ color: i % 2 === 0 ? 0x243244 : 0x1b2635 })
    }
    hull.circle(0, 0, MOTHERSHIP_RADIUS).stroke({ width: 3, color: 0x38bdf8, alpha: 0.45 })
    hull.circle(0, 0, 78).stroke({ width: 2, color: 0x334155 })
    hull.circle(0, 0, 46).fill({ color: 0x0f172a })
    hull.circle(0, 0, 36).fill({ color: 0x0891b2, alpha: 0.9 })
    hull.circle(0, 0, 24).fill({ color: 0x67e8f9 })
    hull.circle(0, 0, 13).fill({ color: 0xecfeff })
    root.addChild(hull)

    const spinner = new Graphics()
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        spinner.arc(0, 0, MOTHERSHIP_RADIUS * 1.42, a, a + 0.55).stroke({ width: 5, color: 0x67e8f9, alpha: 0.45 })
        spinner.arc(0, 0, MOTHERSHIP_RADIUS * 1.42, a, a + 0.55).stroke({ width: 1.5, color: 0xecfeff, alpha: 0.6 })
    }
    root.addChild(spinner)

    track(gsap.to(outerRing, { rotation: Math.PI * 2, duration: 48, ease: 'none', repeat: -1 }))
    track(gsap.to(spinner, { rotation: -Math.PI * 2, duration: 28, ease: 'none', repeat: -1 }))
    track(gsap.to(glow, { alpha: 0.6, duration: 2.8, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(dockRing.scale, { x: 1.035, y: 1.035, duration: 3.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return root
}

// ─── Ship construction helpers ──────────────────────────────────────────────

/** A glowing thruster bell, drawn pointing backwards from (x, y). */
function addNozzle(hull: Graphics, flame: Graphics, x: number, y: number, size: number, color: number) {
    hull.rect(x - size * 1.5, y - size * 0.62, size * 1.6, size * 1.24).fill({ color: 0x0f172a })
    hull.rect(x - size * 1.5, y - size * 0.62, size * 0.5, size * 1.24).fill({ color: shade(color, -0.35) })
    flame.poly([x - size * 1.4, y - size * 0.5, x - size * 4.4, y, x - size * 1.4, y + size * 0.5]).fill({ color, alpha: 0.55 })
    flame.poly([x - size * 1.4, y - size * 0.26, x - size * 2.9, y, x - size * 1.4, y + size * 0.26]).fill({ color: 0xffffff, alpha: 0.8 })
}

/** Thin panel seams across a hull, for the sense that it was welded together. */
function addPanelLines(gfx: Graphics, points: [number, number][], color: number, width = 1) {
    for (const [ax, ay] of points) {
        gfx.moveTo(ax, ay).lineTo(ax, -ay).stroke({ width, color, alpha: 0.35 })
    }
}

function addCanopy(gfx: Graphics, x: number, y: number, rx: number, ry: number) {
    gfx.ellipse(x, y, rx, ry).fill({ color: 0x0c4a6e })
    gfx.ellipse(x, y, rx * 0.82, ry * 0.78).fill({ color: 0x0ea5e9, alpha: 0.85 })
    gfx.ellipse(x + rx * 0.18, y - ry * 0.28, rx * 0.4, ry * 0.34).fill({ color: 0xe0f2fe, alpha: 0.85 })
}

// ─── Player ships ───────────────────────────────────────────────────────────

/**
 * Player hulls are drawn per class from scratch rather than tinted copies of
 * one silhouette. The Leviathan should read as a barge at a glance and the
 * Wraith as a dart, because that is exactly how they fly.
 */
export function buildPlayerShip(shipId: string, radius: number, color: number, accent: number, trim: number) {
    const root = new Container()
    const r = radius

    const engineGlow = new Graphics()
    const flame = new Graphics()
    const wings = new Graphics()
    const hull = new Graphics()
    const details = new Graphics()

    const light = shade(color, 0.22)
    const dark = shade(color, -0.3)

    switch (shipId) {
        case 'courier': {
            wings.poly([r * 0.3, -r * 0.35, -r * 0.5, -r * 1.5, -r * 1.1, -r * 1.45, -r * 0.55, -r * 0.4]).fill({ color: trim })
            wings.poly([r * 0.3, r * 0.35, -r * 0.5, r * 1.5, -r * 1.1, r * 1.45, -r * 0.55, r * 0.4]).fill({ color: trim })
            hull.poly([r * 1.9, 0, r * 0.6, -r * 0.52, -r * 0.9, -r * 0.6, -r * 1.15, 0, -r * 0.9, r * 0.6, r * 0.6, r * 0.52]).fill({ color })
            hull.poly([r * 1.9, 0, r * 0.6, -r * 0.52, -r * 0.9, -r * 0.6, -r * 1.15, 0]).fill({ color: light, alpha: 0.5 })
            addPanelLines(hull, [[r * 0.5, r * 0.5], [-r * 0.2, r * 0.58]], dark)
            addNozzle(hull, flame, -r * 1.05, -r * 0.3, r * 0.34, accent)
            addNozzle(hull, flame, -r * 1.05, r * 0.3, r * 0.34, accent)
            addCanopy(details, r * 0.55, 0, r * 0.42, r * 0.26)
            break
        }
        case 'prospector': {
            // Industrial cutter: twin laser booms out front, cargo pods aft.
            wings.rect(-r * 1.2, -r * 1.35, r * 1.5, r * 0.62).fill({ color: trim })
            wings.rect(-r * 1.2, r * 0.73, r * 1.5, r * 0.62).fill({ color: trim })
            wings.rect(-r * 1.05, -r * 1.22, r * 1.2, r * 0.36).fill({ color: shade(trim, 0.25) })
            wings.rect(-r * 1.05, r * 0.86, r * 1.2, r * 0.36).fill({ color: shade(trim, 0.25) })
            hull.rect(r * 0.55, -r * 0.92, r * 1.05, r * 0.3).fill({ color: dark })
            hull.rect(r * 0.55, r * 0.62, r * 1.05, r * 0.3).fill({ color: dark })
            hull.circle(r * 1.62, -r * 0.77, r * 0.19).fill({ color: 0xfbbf24 })
            hull.circle(r * 1.62, r * 0.77, r * 0.19).fill({ color: 0xfbbf24 })
            hull.poly([r * 1.35, -r * 0.42, r * 1.35, r * 0.42, r * 0.35, r * 1, -r * 1.2, r * 0.78, -r * 1.35, 0, -r * 1.2, -r * 0.78, r * 0.35, -r * 1]).fill({ color })
            hull.poly([r * 1.35, -r * 0.42, r * 0.35, -r * 1, -r * 1.2, -r * 0.78, -r * 1.35, 0]).fill({ color: light, alpha: 0.4 })
            addPanelLines(hull, [[r * 0.6, r * 0.75], [-r * 0.2, r * 0.85], [-r * 0.75, r * 0.8]], dark)
            addNozzle(hull, flame, -r * 1.28, -r * 0.42, r * 0.3, accent)
            addNozzle(hull, flame, -r * 1.28, r * 0.42, r * 0.3, accent)
            addNozzle(hull, flame, -r * 1.28, 0, r * 0.24, accent)
            addCanopy(details, r * 0.72, 0, r * 0.36, r * 0.3)
            break
        }
        case 'vanguard': {
            wings.poly([r * 0.2, -r * 0.5, -r * 0.3, -r * 1.5, -r * 1.15, -r * 1.35, -r * 0.85, -r * 0.5]).fill({ color: trim })
            wings.poly([r * 0.2, r * 0.5, -r * 0.3, r * 1.5, -r * 1.15, r * 1.35, -r * 0.85, r * 0.5]).fill({ color: trim })
            wings.rect(-r * 0.95, -r * 1.42, r * 0.5, r * 0.24).fill({ color: 0xf87171 })
            wings.rect(-r * 0.95, r * 1.18, r * 0.5, r * 0.24).fill({ color: 0xf87171 })
            hull.poly([r * 1.75, 0, r * 1.1, -r * 0.42, r * 0.1, -r * 0.78, -r * 0.95, -r * 0.66, -r * 1.2, 0, -r * 0.95, r * 0.66, r * 0.1, r * 0.78, r * 1.1, r * 0.42]).fill({ color })
            hull.poly([r * 1.75, 0, r * 1.1, -r * 0.42, r * 0.1, -r * 0.78, -r * 0.95, -r * 0.66, -r * 1.2, 0]).fill({ color: light, alpha: 0.42 })
            // Armoured nose block
            hull.poly([r * 1.75, 0, r * 1.05, -r * 0.34, r * 0.72, 0, r * 1.05, r * 0.34]).fill({ color: shade(color, -0.15) })
            addPanelLines(hull, [[r * 0.45, r * 0.68], [-r * 0.35, r * 0.74]], dark)
            addNozzle(hull, flame, -r * 1.12, -r * 0.36, r * 0.38, accent)
            addNozzle(hull, flame, -r * 1.12, r * 0.36, r * 0.38, accent)
            addCanopy(details, r * 0.42, 0, r * 0.4, r * 0.28)
            break
        }
        case 'leviathan': {
            // A barge: blocky spine, container racks, a bridge tower up front.
            wings.rect(-r * 1.05, -r * 1.28, r * 1.5, r * 0.5).fill({ color: trim })
            wings.rect(-r * 1.05, r * 0.78, r * 1.5, r * 0.5).fill({ color: trim })
            for (let i = 0; i < 3; i++) {
                wings.rect(-r * 0.95 + i * r * 0.46, -r * 1.2, r * 0.36, r * 0.34).fill({ color: shade(trim, 0.3) })
                wings.rect(-r * 0.95 + i * r * 0.46, r * 0.86, r * 0.36, r * 0.34).fill({ color: shade(trim, 0.3) })
            }
            hull.poly([r * 1.45, -r * 0.42, r * 1.45, r * 0.42, r * 0.55, r * 0.92, -r * 1.35, r * 0.86, -r * 1.5, 0, -r * 1.35, -r * 0.86, r * 0.55, -r * 0.92]).fill({ color })
            hull.poly([r * 1.45, -r * 0.42, r * 0.55, -r * 0.92, -r * 1.35, -r * 0.86, -r * 1.5, 0]).fill({ color: light, alpha: 0.35 })
            hull.rect(-r * 1.1, -r * 0.5, r * 1.6, r * 1).fill({ color: shade(color, -0.18) })
            addPanelLines(hull, [[r * 0.7, r * 0.8], [r * 0.1, r * 0.88], [-r * 0.5, r * 0.86], [-r * 1.05, r * 0.8]], dark, 1.4)
            addNozzle(hull, flame, -r * 1.42, -r * 0.6, r * 0.32, accent)
            addNozzle(hull, flame, -r * 1.42, -r * 0.2, r * 0.32, accent)
            addNozzle(hull, flame, -r * 1.42, r * 0.2, r * 0.32, accent)
            addNozzle(hull, flame, -r * 1.42, r * 0.6, r * 0.32, accent)
            details.rect(r * 0.5, -r * 0.3, r * 0.5, r * 0.6).fill({ color: shade(color, 0.1) })
            addCanopy(details, r * 0.95, 0, r * 0.3, r * 0.22)
            break
        }
        case 'aurelian': {
            // Obsidian hull, gold filigree, sapphire drive core. Drawn in more
            // layers than anything else in the game because it should read as
            // the most expensive object in the sector.
            const gold = 0xfbbf24
            const sapphire = 0x1d4ed8
            const obsidian = 0x0b1020

            wings.poly([r * 0.5, -r * 0.4, r * 0.55, -r * 1.55, -r * 0.35, -r * 1.7, -r * 1, -r * 0.55]).fill({ color: obsidian })
            wings.poly([r * 0.5, r * 0.4, r * 0.55, r * 1.55, -r * 0.35, r * 1.7, -r * 1, r * 0.55]).fill({ color: obsidian })
            wings.poly([r * 0.5, -r * 0.4, r * 0.55, -r * 1.55, -r * 0.35, -r * 1.7]).fill({ color: gold, alpha: 0.22 })
            wings.poly([r * 0.5, r * 0.4, r * 0.55, r * 1.55, -r * 0.35, r * 1.7]).fill({ color: gold, alpha: 0.22 })
            wings.poly([r * 0.5, -r * 0.4, r * 0.55, -r * 1.55, -r * 0.35, -r * 1.7, -r * 1, -r * 0.55]).stroke({ width: 2, color: gold, alpha: 0.85 })
            wings.poly([r * 0.5, r * 0.4, r * 0.55, r * 1.55, -r * 0.35, r * 1.7, -r * 1, r * 0.55]).stroke({ width: 2, color: gold, alpha: 0.85 })
            // Sapphire wing gems
            for (const side of [-1, 1]) {
                wings.poly([r * 0.2, side * r * 1.28, r * 0.42, side * r * 1.05, r * 0.2, side * r * 0.82, -r * 0.02, side * r * 1.05])
                    .fill({ color: sapphire })
                wings.poly([r * 0.2, side * r * 1.28, r * 0.42, side * r * 1.05, r * 0.2, side * r * 1.05])
                    .fill({ color: 0x93c5fd, alpha: 0.9 })
            }

            hull.poly([r * 2, 0, r * 1.1, -r * 0.5, r * 0.05, -r * 0.78, -r * 0.95, -r * 0.62, -r * 1.25, 0, -r * 0.95, r * 0.62, r * 0.05, r * 0.78, r * 1.1, r * 0.5]).fill({ color: obsidian })
            hull.poly([r * 2, 0, r * 1.1, -r * 0.5, r * 0.05, -r * 0.78, -r * 0.95, -r * 0.62, -r * 1.25, 0]).fill({ color: 0x1b2440, alpha: 0.9 })
            // Gold filigree following the hull line
            hull.poly([r * 1.85, 0, r * 1.02, -r * 0.42, r * 0.05, -r * 0.66, -r * 0.85, -r * 0.52]).stroke({ width: 2, color: gold, alpha: 0.9 })
            hull.poly([r * 1.85, 0, r * 1.02, r * 0.42, r * 0.05, r * 0.66, -r * 0.85, r * 0.52]).stroke({ width: 2, color: gold, alpha: 0.9 })
            hull.moveTo(r * 1.5, 0).lineTo(-r * 0.9, 0).stroke({ width: 1.5, color: gold, alpha: 0.45 })
            // Triple barrel cluster
            for (const offset of [-1, 0, 1]) {
                hull.rect(r * 1.15, offset * r * 0.3 - r * 0.06, r * 0.95, r * 0.12).fill({ color: gold })
                hull.circle(r * 2.1, offset * r * 0.3, r * 0.08).fill({ color: 0x93c5fd })
            }
            // Sapphire drive core sunk into the spine
            hull.poly([-r * 0.3, -r * 0.3, r * 0.25, 0, -r * 0.3, r * 0.3, -r * 0.75, 0]).fill({ color: sapphire })
            hull.poly([-r * 0.3, -r * 0.16, r * 0.05, 0, -r * 0.3, r * 0.16, -r * 0.55, 0]).fill({ color: 0xbfdbfe, alpha: 0.95 })

            addNozzle(hull, flame, -r * 1.18, -r * 0.34, r * 0.36, 0x60a5fa)
            addNozzle(hull, flame, -r * 1.18, r * 0.34, r * 0.36, 0x60a5fa)
            addNozzle(hull, flame, -r * 1.28, 0, r * 0.3, gold)

            details.ellipse(r * 0.72, 0, r * 0.36, r * 0.24).fill({ color: 0x0f172a })
            details.ellipse(r * 0.72, 0, r * 0.29, r * 0.18).fill({ color: sapphire })
            details.ellipse(r * 0.8, -r * 0.05, r * 0.14, r * 0.08).fill({ color: 0xdbeafe, alpha: 0.95 })
            details.ellipse(r * 0.72, 0, r * 0.36, r * 0.24).stroke({ width: 1.5, color: gold })
            // A small crown over the canopy, because of course
            details.poly([r * 0.45, -r * 0.34, r * 0.55, -r * 0.46, r * 0.65, -r * 0.34, r * 0.75, -r * 0.46, r * 0.85, -r * 0.34])
                .stroke({ width: 2, color: gold, alpha: 0.9 })
            break
        }
        case 'wraith': {
            // Forward-swept blades and a single oversized drive on a bare spine.
            wings.poly([r * 0.1, -r * 0.28, r * 0.95, -r * 1.35, r * 0.35, -r * 1.4, -r * 0.6, -r * 0.32]).fill({ color: trim })
            wings.poly([r * 0.1, r * 0.28, r * 0.95, r * 1.35, r * 0.35, r * 1.4, -r * 0.6, r * 0.32]).fill({ color: trim })
            hull.poly([r * 2.25, 0, r * 0.5, -r * 0.34, -r * 0.7, -r * 0.5, -r * 1.05, 0, -r * 0.7, r * 0.5, r * 0.5, r * 0.34]).fill({ color })
            hull.poly([r * 2.25, 0, r * 0.5, -r * 0.34, -r * 0.7, -r * 0.5, -r * 1.05, 0]).fill({ color: light, alpha: 0.5 })
            // Glowing spine down the centreline
            hull.rect(-r * 0.6, -r * 0.07, r * 2, r * 0.14).fill({ color: accent, alpha: 0.9 })
            addNozzle(hull, flame, -r * 0.95, 0, r * 0.55, accent)
            addCanopy(details, r * 0.75, 0, r * 0.34, r * 0.19)
            break
        }
        default: {
            // Scout Skiff — small arrowhead, canards, one central drive.
            wings.poly([r * 0.15, -r * 0.3, -r * 0.45, -r * 1.15, -r * 0.95, -r * 1.05, -r * 0.7, -r * 0.32]).fill({ color: trim })
            wings.poly([r * 0.15, r * 0.3, -r * 0.45, r * 1.15, -r * 0.95, r * 1.05, -r * 0.7, r * 0.32]).fill({ color: trim })
            hull.poly([r * 1.8, 0, r * 0.3, -r * 0.55, -r * 0.85, -r * 0.55, -r * 1.05, 0, -r * 0.85, r * 0.55, r * 0.3, r * 0.55]).fill({ color })
            hull.poly([r * 1.8, 0, r * 0.3, -r * 0.55, -r * 0.85, -r * 0.55, -r * 1.05, 0]).fill({ color: light, alpha: 0.45 })
            addPanelLines(hull, [[r * 0.15, r * 0.55], [-r * 0.5, r * 0.55]], dark)
            addNozzle(hull, flame, -r * 0.95, 0, r * 0.44, accent)
            addCanopy(details, r * 0.5, 0, r * 0.38, r * 0.25)
        }
    }

    hull.stroke({ width: 2, color: accent, alpha: 0.55 })
    engineGlow.circle(-r * 1.15, 0, r * 0.9).fill({ color: accent, alpha: 0.16 })

    root.addChild(engineGlow, flame, wings, hull, details)
    track(gsap.to(flame.scale, { x: 1.35, duration: 0.13, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(engineGlow.scale, { x: 1.3, y: 1.3, duration: 0.38, yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body: hull, engineGlow, flame }
}

// ─── Enemy ships ────────────────────────────────────────────────────────────

export function buildEnemyShip(def: VoidEnemyDefinition) {
    const root = new Container()
    const r = def.radius
    const color = def.color
    const light = shade(color, 0.24)
    const dark = shade(color, -0.34)

    const aura = new Graphics()
    aura.circle(0, 0, r * (def.boss ? 1.8 : 1.6)).fill({ color, alpha: def.boss ? 0.14 : 0.07 })
    root.addChild(aura)

    const flame = new Graphics()
    const wings = new Graphics()
    const body = new Graphics()
    const details = new Graphics()

    switch (def.id) {
        case 'stinger': {
            wings.poly([-r * 0.2, -r * 0.3, -r * 1.3, -r * 1.25, -r * 1.5, -r * 0.75, -r * 0.6, -r * 0.25]).fill({ color: def.trimColor })
            wings.poly([-r * 0.2, r * 0.3, -r * 1.3, r * 1.25, -r * 1.5, r * 0.75, -r * 0.6, r * 0.25]).fill({ color: def.trimColor })
            body.poly([r * 2.4, 0, r * 0.4, -r * 0.42, -r * 0.9, -r * 0.5, -r * 1.1, 0, -r * 0.9, r * 0.5, r * 0.4, r * 0.42]).fill({ color })
            body.poly([r * 2.4, 0, r * 0.4, -r * 0.42, -r * 0.9, -r * 0.5, -r * 1.1, 0]).fill({ color: light, alpha: 0.45 })
            addNozzle(body, flame, -r * 1, 0, r * 0.5, def.accentColor)
            details.circle(r * 0.55, 0, r * 0.22).fill({ color: def.accentColor })
            break
        }
        case 'bulwark': {
            // Six armour plates ringing a heavy core.
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                const a2 = ((i + 1) / 6) * Math.PI * 2
                wings.poly([
                    Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55,
                    Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2,
                    Math.cos(a2) * r * 1.2, Math.sin(a2) * r * 1.2,
                    Math.cos(a2) * r * 0.55, Math.sin(a2) * r * 0.55
                ]).fill({ color: i % 2 === 0 ? def.trimColor : shade(def.trimColor, 0.2) })
            }
            body.poly([r * 1.05, -r * 0.78, r * 1.05, r * 0.78, 0, r * 1.2, -r * 1.05, r * 0.78, -r * 1.05, -r * 0.78, 0, -r * 1.2]).fill({ color, alpha: 0.92 })
            body.circle(0, 0, r * 0.58).fill({ color: dark })
            details.circle(0, 0, r * 0.4).fill({ color: def.accentColor, alpha: 0.85 })
            details.circle(0, 0, r * 0.2).fill({ color: 0xffffff, alpha: 0.9 })
            addNozzle(body, flame, -r * 1.15, -r * 0.42, r * 0.3, def.accentColor)
            addNozzle(body, flame, -r * 1.15, r * 0.42, r * 0.3, def.accentColor)
            break
        }
        case 'lancer': {
            wings.poly([-r * 0.4, -r * 0.3, -r * 1.2, -r * 1.15, -r * 1.45, -r * 0.5, -r * 0.8, -r * 0.28]).fill({ color: def.trimColor })
            wings.poly([-r * 0.4, r * 0.3, -r * 1.2, r * 1.15, -r * 1.45, r * 0.5, -r * 0.8, r * 0.28]).fill({ color: def.trimColor })
            // The rail itself: two long rails with a charge coil between them.
            body.rect(r * 0.2, -r * 0.3, r * 2.3, r * 0.16).fill({ color: dark })
            body.rect(r * 0.2, r * 0.14, r * 2.3, r * 0.16).fill({ color: dark })
            body.rect(r * 0.5, -r * 0.14, r * 1.6, r * 0.28).fill({ color: def.accentColor, alpha: 0.45 })
            body.poly([r * 0.6, 0, -r * 0.2, -r * 0.62, -r * 1.05, -r * 0.5, -r * 1.2, 0, -r * 1.05, r * 0.5, -r * 0.2, r * 0.62]).fill({ color })
            body.poly([r * 0.6, 0, -r * 0.2, -r * 0.62, -r * 1.05, -r * 0.5, -r * 1.2, 0]).fill({ color: light, alpha: 0.4 })
            details.circle(r * 2.5, 0, r * 0.16).fill({ color: def.accentColor })
            addNozzle(body, flame, -r * 1.1, 0, r * 0.36, def.accentColor)
            break
        }
        case 'warden': {
            // Drone carrier: a fat armoured core with open launch bays down
            // both flanks, so you can see where the swarm comes from.
            wings.rect(-r * 0.6, -r * 1.3, r * 1.3, r * 0.5).fill({ color: def.trimColor })
            wings.rect(-r * 0.6, r * 0.8, r * 1.3, r * 0.5).fill({ color: def.trimColor })
            for (let i = 0; i < 4; i++) {
                wings.rect(-r * 0.5 + i * r * 0.3, -r * 1.22, r * 0.2, r * 0.34).fill({ color: 0x020617 })
                wings.rect(-r * 0.5 + i * r * 0.3, r * 0.88, r * 0.2, r * 0.34).fill({ color: 0x020617 })
                wings.circle(-r * 0.4 + i * r * 0.3, -r * 1.05, r * 0.06).fill({ color: def.accentColor, alpha: 0.9 })
                wings.circle(-r * 0.4 + i * r * 0.3, r * 1.05, r * 0.06).fill({ color: def.accentColor, alpha: 0.9 })
            }
            body.poly([r * 1.2, -r * 0.5, r * 1.2, r * 0.5, r * 0.3, r * 0.95, -r * 0.9, r * 0.8, -r * 1.15, 0, -r * 0.9, -r * 0.8, r * 0.3, -r * 0.95]).fill({ color })
            body.poly([r * 1.2, -r * 0.5, r * 0.3, -r * 0.95, -r * 0.9, -r * 0.8, -r * 1.15, 0]).fill({ color: light, alpha: 0.38 })
            body.circle(0, 0, r * 0.42).fill({ color: dark })
            addPanelLines(body, [[r * 0.4, r * 0.72], [-r * 0.35, r * 0.8]], dark, 1.4)
            addNozzle(body, flame, -r * 1.1, -r * 0.34, r * 0.3, def.accentColor)
            addNozzle(body, flame, -r * 1.1, r * 0.34, r * 0.3, def.accentColor)
            details.circle(0, 0, r * 0.3).fill({ color: def.accentColor, alpha: 0.9 })
            details.circle(0, 0, r * 0.15).fill({ color: 0xffffff, alpha: 0.9 })
            break
        }
        case 'nettle': {
            // Minelayer: a hunched hull with a rack of unarmed mines slung under it.
            wings.poly([-r * 0.3, -r * 0.3, -r * 1.05, -r * 1.1, -r * 1.4, -r * 0.6, -r * 0.75, -r * 0.25]).fill({ color: def.trimColor })
            wings.poly([-r * 0.3, r * 0.3, -r * 1.05, r * 1.1, -r * 1.4, r * 0.6, -r * 0.75, r * 0.25]).fill({ color: def.trimColor })
            body.poly([r * 1.7, 0, r * 0.35, -r * 0.6, -r * 0.85, -r * 0.55, -r * 1.05, 0, -r * 0.85, r * 0.55, r * 0.35, r * 0.6]).fill({ color })
            body.poly([r * 1.7, 0, r * 0.35, -r * 0.6, -r * 0.85, -r * 0.55, -r * 1.05, 0]).fill({ color: light, alpha: 0.45 })
            // The rack itself
            for (let i = 0; i < 3; i++) {
                const mx = -r * 0.65 + i * r * 0.5
                body.circle(mx, 0, r * 0.2).fill({ color: dark })
                body.circle(mx, 0, r * 0.1).fill({ color: def.accentColor, alpha: 0.9 })
            }
            addNozzle(body, flame, -r * 0.95, 0, r * 0.4, def.accentColor)
            details.circle(r * 0.6, 0, r * 0.2).fill({ color: def.accentColor })
            break
        }
        case 'drone': {
            // Barely a ship: a lens with two stub fins and one eye.
            body.poly([r * 1.6, 0, 0, -r, -r * 0.8, 0, 0, r]).fill({ color })
            body.poly([r * 1.6, 0, 0, -r, -r * 0.8, 0]).fill({ color: light, alpha: 0.55 })
            body.circle(r * 0.3, 0, r * 0.4).fill({ color: 0x020617 })
            details.circle(r * 0.3, 0, r * 0.24).fill({ color: def.accentColor })
            details.circle(r * 0.3, 0, r * 0.1).fill({ color: 0xffffff })
            flame.poly([-r * 0.7, -r * 0.3, -r * 2.1, 0, -r * 0.7, r * 0.3]).fill({ color: def.accentColor, alpha: 0.6 })
            break
        }
        case 'harbinger': {
            // Strike cruiser: forward-swept wings, twin cannon spines, three drives.
            wings.poly([r * 0.35, -r * 0.4, r * 1.15, -r * 1.5, r * 0.35, -r * 1.6, -r * 0.85, -r * 0.5]).fill({ color: def.trimColor })
            wings.poly([r * 0.35, r * 0.4, r * 1.15, r * 1.5, r * 0.35, r * 1.6, -r * 0.85, r * 0.5]).fill({ color: def.trimColor })
            wings.rect(r * 0.45, -r * 1.5, r * 0.6, r * 0.2).fill({ color: def.accentColor, alpha: 0.85 })
            wings.rect(r * 0.45, r * 1.3, r * 0.6, r * 0.2).fill({ color: def.accentColor, alpha: 0.85 })
            body.rect(r * 0.8, -r * 0.62, r * 1.15, r * 0.2).fill({ color: dark })
            body.rect(r * 0.8, r * 0.42, r * 1.15, r * 0.2).fill({ color: dark })
            body.poly([r * 1.6, 0, r * 0.8, -r * 0.55, -r * 0.4, -r * 0.85, -r * 1.2, -r * 0.6, -r * 1.35, 0, -r * 1.2, r * 0.6, -r * 0.4, r * 0.85, r * 0.8, r * 0.55]).fill({ color })
            body.poly([r * 1.6, 0, r * 0.8, -r * 0.55, -r * 0.4, -r * 0.85, -r * 1.2, -r * 0.6, -r * 1.35, 0]).fill({ color: light, alpha: 0.4 })
            addPanelLines(body, [[r * 0.4, r * 0.72], [-r * 0.4, r * 0.82]], dark, 1.4)
            addNozzle(body, flame, -r * 1.3, -r * 0.42, r * 0.34, def.accentColor)
            addNozzle(body, flame, -r * 1.3, 0, r * 0.4, def.accentColor)
            addNozzle(body, flame, -r * 1.3, r * 0.42, r * 0.34, def.accentColor)
            details.ellipse(r * 0.55, 0, r * 0.34, r * 0.24).fill({ color: 0xfef3c7, alpha: 0.9 })
            break
        }
        case 'dreadnought': {
            // Layered armour, side hangars, a spinal gun and a wall of drives.
            wings.rect(-r * 0.95, -r * 1.32, r * 1.5, r * 0.55).fill({ color: def.trimColor })
            wings.rect(-r * 0.95, r * 0.77, r * 1.5, r * 0.55).fill({ color: def.trimColor })
            for (let i = 0; i < 4; i++) {
                wings.rect(-r * 0.85 + i * r * 0.36, -r * 1.24, r * 0.26, r * 0.39).fill({ color: shade(def.trimColor, 0.3) })
                wings.rect(-r * 0.85 + i * r * 0.36, r * 0.85, r * 0.26, r * 0.39).fill({ color: shade(def.trimColor, 0.3) })
            }
            body.rect(r * 0.7, -r * 0.13, r * 1.4, r * 0.26).fill({ color: dark })
            body.rect(r * 1.5, -r * 0.22, r * 0.35, r * 0.44).fill({ color: def.accentColor, alpha: 0.9 })
            body.poly([
                r * 1.3, 0, r * 0.95, -r * 0.55, r * 0.15, -r * 0.95, -r * 0.75, -r * 1, -r * 1.25, -r * 0.55,
                -r * 1.35, 0, -r * 1.25, r * 0.55, -r * 0.75, r * 1, r * 0.15, r * 0.95, r * 0.95, r * 0.55
            ]).fill({ color })
            body.poly([r * 1.3, 0, r * 0.95, -r * 0.55, r * 0.15, -r * 0.95, -r * 0.75, -r * 1, -r * 1.25, -r * 0.55, -r * 1.35, 0]).fill({ color: light, alpha: 0.34 })
            body.poly([r * 0.5, -r * 0.62, -r * 0.55, -r * 0.68, -r * 0.55, r * 0.68, r * 0.5, r * 0.62]).fill({ color: shade(color, -0.15) })
            addPanelLines(body, [[r * 0.25, r * 0.85], [-r * 0.35, r * 0.92], [-r * 0.9, r * 0.8]], dark, 1.6)
            for (let i = -2; i <= 2; i++) addNozzle(body, flame, -r * 1.3, i * r * 0.38, r * 0.28, def.accentColor)
            details.ellipse(r * 0.1, 0, r * 0.42, r * 0.3).fill({ color: 0xfef08a, alpha: 0.9 })
            details.ellipse(r * 0.1, 0, r * 0.22, r * 0.16).fill({ color: 0xffffff, alpha: 0.9 })
            break
        }
        default: {
            // Interceptor — a red trident with two forward prongs.
            wings.poly([r * 0.1, -r * 0.35, -r * 0.6, -r * 1.2, -r * 1.1, -r * 1.05, -r * 0.75, -r * 0.35]).fill({ color: def.trimColor })
            wings.poly([r * 0.1, r * 0.35, -r * 0.6, r * 1.2, -r * 1.1, r * 1.05, -r * 0.75, r * 0.35]).fill({ color: def.trimColor })
            body.poly([r * 1.15, -r * 0.62, r * 1.55, -r * 0.5, r * 0.6, -r * 0.2]).fill({ color: dark })
            body.poly([r * 1.15, r * 0.62, r * 1.55, r * 0.5, r * 0.6, r * 0.2]).fill({ color: dark })
            body.poly([r * 1.55, 0, r * 0.25, -r * 0.62, -r * 0.85, -r * 0.55, -r * 1.05, 0, -r * 0.85, r * 0.55, r * 0.25, r * 0.62]).fill({ color })
            body.poly([r * 1.55, 0, r * 0.25, -r * 0.62, -r * 0.85, -r * 0.55, -r * 1.05, 0]).fill({ color: light, alpha: 0.45 })
            addNozzle(body, flame, -r * 0.95, 0, r * 0.42, def.accentColor)
            details.circle(r * 0.45, 0, r * 0.22).fill({ color: def.accentColor })
        }
    }

    body.stroke({ width: 2, color: def.accentColor, alpha: 0.6 })
    root.addChild(flame, wings, body, details)

    track(gsap.to(aura.scale, { x: 1.16, y: 1.16, duration: def.boss ? 1.5 : 2.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(flame.scale, { x: 1.4, duration: randRange(0.11, 0.18), yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body }
}

// ─── Rocks ──────────────────────────────────────────────────────────────────

/**
 * A rock is a jagged silhouette with a lit facet, craters, glowing ore veins
 * and a couple of shards drifting alongside it — so a seam is identifiable from
 * across the sector by colour alone.
 */
export function buildRock(def: VoidRockDefinition, radius: number) {
    const root = new Container()

    const glow = new Graphics()
    glow.circle(0, 0, radius * 1.6).fill({ color: def.glow, alpha: 0.06 })
    glow.circle(0, 0, radius * 1.15).fill({ color: def.glow, alpha: 0.05 })
    root.addChild(glow)

    const body = new Graphics()
    const points: number[] = []
    const sides = 10 + Math.floor(Math.random() * 5)
    const radii: number[] = []
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2
        const rr = radius * randRange(0.72, 1.18)
        radii.push(rr)
        points.push(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    body.poly(points).fill({ color: def.shade })

    // Lit facet: the same silhouette clipped to its upper-left half.
    const litPoints: number[] = []
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2
        const rr = radii[i]! * 0.92
        litPoints.push(Math.cos(a) * rr - radius * 0.1, Math.sin(a) * rr - radius * 0.12)
    }
    body.poly(litPoints).fill({ color: def.color, alpha: 0.95 })
    body.poly(points).stroke({ width: 2, color: shade(def.color, 0.25), alpha: 0.45 })
    root.addChild(body)

    const craters = new Graphics()
    for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2
        const d = radius * randRange(0.15, 0.6)
        const cr = radius * randRange(0.09, 0.2)
        craters.circle(Math.cos(a) * d, Math.sin(a) * d, cr).fill({ color: def.shade, alpha: 0.8 })
        craters.circle(Math.cos(a) * d - cr * 0.2, Math.sin(a) * d - cr * 0.2, cr * 0.7).fill({ color: shade(def.shade, -0.25), alpha: 0.6 })
    }
    root.addChild(craters)

    const veins = new Graphics()
    for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2
        const len = radius * randRange(0.4, 0.85)
        const wobble = a + randRange(-0.5, 0.5)
        veins.moveTo(Math.cos(a) * radius * 0.1, Math.sin(a) * radius * 0.1)
            .lineTo(Math.cos(wobble) * len * 0.6, Math.sin(wobble) * len * 0.6)
            .lineTo(Math.cos(a) * len, Math.sin(a) * len)
            .stroke({ width: randRange(2, 4.5), color: def.glow, alpha: 0.6 })
        veins.circle(Math.cos(a) * len, Math.sin(a) * len, randRange(2, 3.6)).fill({ color: def.glow, alpha: 0.85 })
    }
    // Crystalline core
    veins.poly([0, -radius * 0.26, radius * 0.2, 0, 0, radius * 0.26, -radius * 0.2, 0]).fill({ color: def.glow, alpha: 0.75 })
    veins.poly([0, -radius * 0.14, radius * 0.1, 0, 0, radius * 0.14, -radius * 0.1, 0]).fill({ color: 0xffffff, alpha: 0.7 })
    root.addChild(veins)

    const shards = new Container()
    for (let i = 0; i < 3; i++) {
        const shard = new Graphics()
        const s = radius * randRange(0.1, 0.2)
        shard.poly([s, 0, 0, -s, -s * 0.8, 0, 0, s]).fill({ color: def.color })
        const a = Math.random() * Math.PI * 2
        const d = radius * randRange(1.2, 1.6)
        shard.position.set(Math.cos(a) * d, Math.sin(a) * d)
        shards.addChild(shard)
        track(gsap.to(shard, { rotation: Math.PI * 2 * (Math.random() < 0.5 ? 1 : -1), duration: randRange(6, 14), repeat: -1, ease: 'none' }))
    }
    root.addChild(shards)
    track(gsap.to(shards, { rotation: Math.PI * 2, duration: randRange(18, 34), repeat: -1, ease: 'none' }))
    track(gsap.to(veins, { alpha: 0.6, duration: randRange(1.4, 2.6), yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body }
}

/** A mining-progress arc drawn around a rock while the laser is on it. */
export function drawMiningRing(gfx: Graphics, radius: number, progress: number, color: number) {
    gfx.clear()
    if (progress <= 0) return
    gfx.circle(0, 0, radius + 14).stroke({ width: 4, color: 0x0f172a, alpha: 0.6 })
    gfx.arc(0, 0, radius + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
        .stroke({ width: 5, color, alpha: 0.95 })
    gfx.arc(0, 0, radius + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 })
}

// ─── Projectiles and pickups ────────────────────────────────────────────────

export function buildBullet(color: number, rocket: boolean, size = 1) {
    const root = new Container()
    const gfx = new Graphics()
    if (rocket) {
        gfx.circle(-6 * size, 0, 5 * size).fill({ color: 0xfbbf24, alpha: 0.35 })
        gfx.poly([10 * size, 0, -6 * size, -4.5 * size, -3 * size, 0, -6 * size, 4.5 * size]).fill({ color })
        gfx.poly([10 * size, 0, -6 * size, -4.5 * size, -3 * size, 0]).fill({ color: 0xffffff, alpha: 0.3 })
        gfx.circle(-7 * size, 0, 3.2 * size).fill({ color: 0xfde68a, alpha: 0.95 })
    } else {
        gfx.ellipse(-4 * size, 0, 16 * size, 1.6 * size).fill({ color, alpha: 0.28 })
        gfx.ellipse(0, 0, 8 * size, 2.8 * size).fill({ color })
        gfx.ellipse(1.5 * size, 0, 4 * size, 1.5 * size).fill({ color: 0xffffff, alpha: 0.85 })
    }
    root.addChild(gfx)
    return root
}

export function buildDrone(color: number) {
    const root = new Container()
    const gfx = new Graphics()
    gfx.circle(0, 0, 9).fill({ color, alpha: 0.16 })
    gfx.poly([10, 0, -4, -6, -1, 0, -4, 6]).fill({ color })
    gfx.poly([10, 0, -4, -6, -1, 0]).fill({ color: 0xffffff, alpha: 0.3 })
    gfx.circle(3, 0, 2).fill({ color: 0xffffff, alpha: 0.95 })
    root.addChild(gfx)
    return root
}

export function buildPickup(color: number, big: boolean) {
    const root = new Container()
    const gfx = new Graphics()
    const r = big ? 10 : 6.5
    gfx.circle(0, 0, r * 2.2).fill({ color, alpha: 0.14 })
    gfx.poly([0, -r, r * 0.92, 0, 0, r, -r * 0.92, 0]).fill({ color })
    gfx.poly([0, -r, r * 0.92, 0, 0, 0]).fill({ color: 0xffffff, alpha: 0.4 })
    gfx.poly([0, -r, r * 0.92, 0, 0, r, -r * 0.92, 0]).stroke({ width: 1.5, color: 0xffffff, alpha: 0.55 })
    root.addChild(gfx)
    track(gsap.to(root.scale, { x: 1.22, y: 1.22, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(root, { rotation: Math.PI * 2, duration: 3, repeat: -1, ease: 'none' }))
    return root
}

/**
 * A proximity mine. Unarmed mines are dull and slow-blinking; once armed the
 * core goes hot and the blast radius is drawn so it can actually be avoided.
 */
export function buildMine(color: number) {
    const root = new Container()
    const ring = new Graphics()
    const body = new Graphics()

    body.circle(0, 0, 11).fill({ color: 0x1e293b })
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        body.poly([
            Math.cos(a) * 10, Math.sin(a) * 10,
            Math.cos(a + 0.28) * 9, Math.sin(a + 0.28) * 9,
            Math.cos(a + 0.14) * 17, Math.sin(a + 0.14) * 17
        ]).fill({ color: 0x334155 })
    }
    body.circle(0, 0, 6).fill({ color })
    body.circle(0, 0, 2.6).fill({ color: 0xffffff, alpha: 0.9 })

    root.addChild(ring, body)
    track(gsap.to(body, { rotation: Math.PI * 2, duration: 9, repeat: -1, ease: 'none' }))
    return { root, ring, body }
}

export function drawMineRing(gfx: Graphics, radius: number, armed: boolean, pulse: number) {
    gfx.clear()
    const color = armed ? 0xf87171 : 0x94a3b8
    gfx.circle(0, 0, radius).stroke({ width: armed ? 2 : 1, color, alpha: armed ? 0.22 + pulse * 0.28 : 0.12 })
    if (armed) gfx.circle(0, 0, radius * (0.55 + pulse * 0.45)).fill({ color, alpha: 0.05 })
}

/**
 * The player's own hull bar. It rides above the ship unrotated, is invisible
 * while nothing is happening, and snaps to full opacity on any hit — so you
 * get a readout exactly when you need one and clean space the rest of the time.
 */
export function buildPlayerHealthBar() {
    const root = new Container()
    const width = 74

    const backing = new Graphics()
    backing.roundRect(-width / 2 - 1, -1, width + 2, 8, 3).fill({ color: 0x020617, alpha: 0.85 })
    const hullFill = new Graphics()
    const shieldFill = new Graphics()

    root.addChild(backing, hullFill, shieldFill)
    root.alpha = 0
    return { root, hullFill, shieldFill, width }
}

export function drawPlayerHealthBar(
    hullFill: Graphics,
    shieldFill: Graphics,
    width: number,
    hullPct: number,
    shieldPct: number
) {
    const color = hullPct > 0.5 ? 0x4ade80 : hullPct > 0.25 ? 0xfbbf24 : 0xf87171
    hullFill.clear()
    hullFill.roundRect(-width / 2, 0, width * Math.max(0, hullPct), 6, 2).fill({ color })
    shieldFill.clear()
    if (shieldPct > 0) {
        shieldFill.roundRect(-width / 2, -4, width * Math.max(0, shieldPct), 3, 1.5).fill({ color: 0x38bdf8 })
    }
}

export function floatingText(layer: Container, x: number, y: number, text: string, color: number, size = 13) {
    const label = new Text({ text, style: LABEL_STYLE })
    label.style.fontSize = size
    label.style.fill = color
    label.anchor.set(0.5)
    label.position.set(x, y)
    layer.addChild(label)
    track(gsap.to(label, {
        y: y - 46,
        alpha: 0,
        duration: 1.05,
        ease: 'power2.out',
        // The layer may have been wiped between runs, in which case the label
        // is already gone and destroying it again would throw.
        onComplete: () => { if (!label.destroyed) label.destroy() }
    }))
    track(gsap.fromTo(label.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.22, ease: 'back.out(3)' }))
    return label
}

// ─── Telegraphs ─────────────────────────────────────────────────────────────

/** The ring a Bulwark paints on the field before it vents. */
export function drawShockwave(gfx: Graphics, radius: number, telegraph: number, expandProgress: number, color: number) {
    gfx.clear()
    if (expandProgress <= 0) {
        gfx.circle(0, 0, radius).stroke({ width: 2, color, alpha: 0.2 + telegraph * 0.5 })
        gfx.circle(0, 0, radius * telegraph).fill({ color, alpha: 0.05 + telegraph * 0.1 })
        // Dashed inner marker so the danger zone is legible against the nebula.
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2 + telegraph * 2
            gfx.moveTo(Math.cos(a) * radius * 0.9, Math.sin(a) * radius * 0.9)
                .lineTo(Math.cos(a) * radius * 0.98, Math.sin(a) * radius * 0.98)
                .stroke({ width: 3, color, alpha: 0.3 + telegraph * 0.5 })
        }
        return
    }
    const r = radius * expandProgress
    gfx.circle(0, 0, r).stroke({ width: 14 * (1 - expandProgress) + 4, color, alpha: 0.85 * (1 - expandProgress) })
    gfx.circle(0, 0, r * 0.86).stroke({ width: 4, color: 0xffffff, alpha: 0.5 * (1 - expandProgress) })
}

export function drawRailbeam(gfx: Graphics, length: number, width: number, charge: number, active: number, color: number) {
    gfx.clear()
    if (active <= 0) {
        gfx.moveTo(0, 0).lineTo(length, 0).stroke({ width: 1 + charge * 3, color, alpha: 0.22 + charge * 0.55 })
        gfx.circle(0, 0, 6 + charge * 18).fill({ color, alpha: 0.2 + charge * 0.5 })
        gfx.circle(0, 0, 4 + charge * 10).fill({ color: 0xffffff, alpha: charge * 0.7 })
        return
    }
    const fade = 1 - active
    gfx.rect(0, -width / 2, length, width).fill({ color, alpha: 0.6 * fade })
    gfx.rect(0, -width / 4, length, width / 2).fill({ color: shade(color, 0.4), alpha: 0.75 * fade })
    gfx.rect(0, -width / 8, length, width / 4).fill({ color: 0xffffff, alpha: 0.95 * fade })
    gfx.circle(0, 0, 34 * fade).fill({ color: 0xffffff, alpha: 0.5 * fade })
}
