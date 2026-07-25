import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import gsap from 'gsap'
import { MOTHERSHIP_RADIUS, NEBULA_COLORS, STAR_LAYERS, WORLD_H, WORLD_W } from './constants'
import { randRange } from './math'
import type { VoidEnemyDefinition, VoidRockDefinition } from '#shared/utils/gamelogic/void'

const LABEL_STYLE = new TextStyle({ fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xffffff })

/**
 * Every looping tween this module starts is recorded here. Display objects get
 * torn down between runs, and a `repeat: -1` tween left pointing at a destroyed
 * container throws on its next frame — so the engine kills the whole set before
 * it clears a layer.
 */
const trackedTweens: gsap.core.Tween[] = []

function track<T extends gsap.core.Tween>(tween: T): T {
    trackedTweens.push(tween)
    return tween
}

export function killAllFxTweens() {
    for (const tween of trackedTweens) tween.kill()
    trackedTweens.length = 0
}

/**
 * Three parallax star layers. Each is its own container so the game loop can
 * offset them at different rates against the camera and sell the depth.
 */
export function buildStarfield() {
    return STAR_LAYERS.map((layer) => {
        const container = new Container()
        const gfx = new Graphics()
        // A star layer is thousands of dots that never change — one Graphics
        // baked once is far cheaper than a sprite per star.
        for (let i = 0; i < layer.count; i++) {
            const x = Math.random() * WORLD_W * 1.4 - WORLD_W * 0.2
            const y = Math.random() * WORLD_H * 1.4 - WORLD_H * 0.2
            const r = layer.radius * randRange(0.6, 1.5)
            gfx.circle(x, y, r).fill({ color: layer.tint, alpha: layer.alpha * randRange(0.5, 1) })
        }
        container.addChild(gfx)
        container.alpha = 1
        return { container, parallax: layer.parallax }
    })
}

export function drawNebula(gfx: Graphics) {
    gfx.clear()
    gfx.rect(-WORLD_W * 0.2, -WORLD_H * 0.2, WORLD_W * 1.4, WORLD_H * 1.4).fill({ color: 0x05060f })
    for (let i = 0; i < 22; i++) {
        const color = NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)]!
        const x = Math.random() * WORLD_W
        const y = Math.random() * WORLD_H
        const r = randRange(180, 520)
        gfx.ellipse(x, y, r, r * randRange(0.4, 0.8)).fill({ color, alpha: randRange(0.05, 0.14) })
    }
}

/** The one safe place in the sector. Slow counter-rotating rings, warm glow. */
export function buildMothership() {
    const root = new Container()

    const glow = new Graphics()
    glow.circle(0, 0, MOTHERSHIP_RADIUS * 2.4).fill({ color: 0x22d3ee, alpha: 0.06 })
    glow.circle(0, 0, MOTHERSHIP_RADIUS * 1.6).fill({ color: 0x22d3ee, alpha: 0.08 })
    root.addChild(glow)

    const dockRing = new Graphics()
    dockRing.circle(0, 0, 190).stroke({ width: 2, color: 0x22d3ee, alpha: 0.35 })
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        dockRing.moveTo(Math.cos(a) * 182, Math.sin(a) * 182)
            .lineTo(Math.cos(a) * 196, Math.sin(a) * 196)
            .stroke({ width: 2, color: 0x22d3ee, alpha: 0.22 })
    }
    root.addChild(dockRing)

    const outerRing = new Graphics()
    outerRing.circle(0, 0, MOTHERSHIP_RADIUS * 1.15).stroke({ width: 5, color: 0x0e7490, alpha: 0.85 })
    // Eight docking clamps spaced around the ring, each rotated to sit flush
    // against it rather than axis-aligned.
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const cx = Math.cos(a) * MOTHERSHIP_RADIUS * 1.15
        const cy = Math.sin(a) * MOTHERSHIP_RADIUS * 1.15
        const nx = Math.cos(a + Math.PI / 2)
        const ny = Math.sin(a + Math.PI / 2)
        outerRing.poly([
            cx + nx * 9, cy + ny * 9,
            cx - nx * 9, cy - ny * 9,
            cx - nx * 6 + Math.cos(a) * 14, cy - ny * 6 + Math.sin(a) * 14,
            cx + nx * 6 + Math.cos(a) * 14, cy + ny * 6 + Math.sin(a) * 14
        ]).fill({ color: 0x67e8f9, alpha: 0.9 })
    }
    root.addChild(outerRing)

    const hull = new Graphics()
    hull.circle(0, 0, MOTHERSHIP_RADIUS).fill({ color: 0x1e293b })
    hull.circle(0, 0, MOTHERSHIP_RADIUS).stroke({ width: 3, color: 0x38bdf8, alpha: 0.6 })
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        hull.moveTo(Math.cos(a) * 34, Math.sin(a) * 34)
            .lineTo(Math.cos(a) * MOTHERSHIP_RADIUS, Math.sin(a) * MOTHERSHIP_RADIUS)
            .stroke({ width: 6, color: 0x334155 })
    }
    hull.circle(0, 0, 46).fill({ color: 0x0f172a })
    hull.circle(0, 0, 34).fill({ color: 0x22d3ee, alpha: 0.9 })
    hull.circle(0, 0, 22).fill({ color: 0xcffafe })
    root.addChild(hull)

    const spinner = new Graphics()
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        spinner.moveTo(0, 0)
            .arc(0, 0, MOTHERSHIP_RADIUS * 1.35, a, a + 0.5)
            .stroke({ width: 4, color: 0x67e8f9, alpha: 0.5 })
    }
    root.addChild(spinner)

    track(gsap.to(outerRing, { rotation: Math.PI * 2, duration: 42, ease: 'none', repeat: -1 }))
    track(gsap.to(spinner, { rotation: -Math.PI * 2, duration: 26, ease: 'none', repeat: -1 }))
    track(gsap.to(glow, { alpha: 0.55, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(dockRing.scale, { x: 1.04, y: 1.04, duration: 3.1, yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return root
}

/**
 * Player hulls are drawn per class rather than tinted copies — the Leviathan
 * should read as a barge at a glance and the Wraith as a dart.
 */
export function buildPlayerShip(shipId: string, radius: number, color: number, accent: number) {
    const root = new Container()

    const engineGlow = new Graphics()
    engineGlow.circle(-radius * 0.95, 0, radius * 0.75).fill({ color: accent, alpha: 0.22 })
    root.addChild(engineGlow)

    const body = new Graphics()
    const r = radius
    switch (shipId) {
        case 'leviathan':
            body.poly([r * 1.5, 0, r * 0.5, -r * 0.95, -r * 1.05, -r * 1.05, -r * 1.25, 0, -r * 1.05, r * 1.05, r * 0.5, r * 0.95]).fill({ color })
            body.rect(-r * 0.9, -r * 1.25, r * 1.2, r * 0.35).fill({ color: accent, alpha: 0.75 })
            body.rect(-r * 0.9, r * 0.9, r * 1.2, r * 0.35).fill({ color: accent, alpha: 0.75 })
            break
        case 'wraith':
            body.poly([r * 1.9, 0, -r * 0.4, -r * 0.5, -r * 1.1, -r * 0.95, -r * 0.75, 0, -r * 1.1, r * 0.95, -r * 0.4, r * 0.5]).fill({ color })
            break
        case 'prospector':
            body.poly([r * 1.3, -r * 0.35, r * 1.3, r * 0.35, r * 0.2, r * 1.05, -r * 1.1, r * 0.8, -r * 1.1, -r * 0.8, r * 0.2, -r * 1.05]).fill({ color })
            body.rect(r * 0.9, -r * 0.95, r * 0.45, r * 0.4).fill({ color: accent })
            body.rect(r * 0.9, r * 0.55, r * 0.45, r * 0.4).fill({ color: accent })
            break
        case 'vanguard':
            body.poly([r * 1.6, 0, r * 0.3, -r * 0.7, -r * 0.6, -r * 1.1, -r * 1.05, -r * 0.4, -r * 1.05, r * 0.4, -r * 0.6, r * 1.1, r * 0.3, r * 0.7]).fill({ color })
            break
        case 'courier':
            body.poly([r * 1.65, 0, r * 0.1, -r * 0.8, -r * 1.15, -r * 0.6, -r * 0.8, 0, -r * 1.15, r * 0.6, r * 0.1, r * 0.8]).fill({ color })
            break
        default:
            body.poly([r * 1.55, 0, -r * 0.5, -r * 0.85, -r * 1.05, 0, -r * 0.5, r * 0.85]).fill({ color })
    }
    body.stroke({ width: 2, color: accent, alpha: 0.8 })
    root.addChild(body)

    const cockpit = new Graphics()
    cockpit.ellipse(r * 0.35, 0, r * 0.38, r * 0.26).fill({ color: 0xf8fafc, alpha: 0.9 })
    cockpit.ellipse(r * 0.35, 0, r * 0.22, r * 0.14).fill({ color: 0x0ea5e9 })
    root.addChild(cockpit)

    track(gsap.to(engineGlow.scale, { x: 1.25, y: 1.25, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body, engineGlow }
}

export function buildEnemyShip(def: VoidEnemyDefinition) {
    const root = new Container()
    const r = def.radius

    const aura = new Graphics()
    aura.circle(0, 0, r * 1.6).fill({ color: def.color, alpha: def.boss ? 0.16 : 0.08 })
    root.addChild(aura)

    const body = new Graphics()
    switch (def.id) {
        case 'stinger':
            body.poly([r * 1.9, 0, -r * 0.8, -r * 1.1, -r * 0.3, 0, -r * 0.8, r * 1.1]).fill({ color: def.color })
            break
        case 'bulwark':
            body.poly([r * 1.05, -r * 0.75, r * 1.05, r * 0.75, 0, r * 1.15, -r * 1.05, r * 0.75, -r * 1.05, -r * 0.75, 0, -r * 1.15]).fill({ color: def.color })
            body.circle(0, 0, r * 0.5).fill({ color: def.accentColor, alpha: 0.75 })
            break
        case 'lancer':
            body.poly([r * 2.3, -r * 0.16, r * 2.3, r * 0.16, r * 0.2, r * 0.5, -r * 1, r * 0.9, -r * 1, -r * 0.9, r * 0.2, -r * 0.5]).fill({ color: def.color })
            break
        case 'dreadnought':
            body.poly([r * 1.35, 0, r * 0.75, -r * 0.7, r * 0.1, -r * 1.05, -r * 0.85, -r * 0.95, -r * 1.15, 0, -r * 0.85, r * 0.95, r * 0.1, r * 1.05, r * 0.75, r * 0.7]).fill({ color: def.color })
            body.rect(-r * 0.5, -r * 1.25, r * 0.9, r * 0.32).fill({ color: def.accentColor, alpha: 0.8 })
            body.rect(-r * 0.5, r * 0.93, r * 0.9, r * 0.32).fill({ color: def.accentColor, alpha: 0.8 })
            body.circle(r * 0.15, 0, r * 0.42).fill({ color: 0xfef08a, alpha: 0.9 })
            break
        default:
            body.poly([r * 1.5, 0, -r * 0.55, -r * 0.95, -r * 0.95, 0, -r * 0.55, r * 0.95]).fill({ color: def.color })
    }
    body.stroke({ width: 2, color: def.accentColor, alpha: 0.85 })
    root.addChild(body)

    const eye = new Graphics()
    eye.circle(r * 0.55, 0, Math.max(2.5, r * 0.2)).fill({ color: def.accentColor })
    root.addChild(eye)

    track(gsap.to(aura.scale, { x: 1.18, y: 1.18, duration: def.boss ? 1.4 : 2.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body }
}

/**
 * Rocks get a jagged silhouette generated from a jittered circle, plus a
 * crystalline core that glows in the ore's colour so you can identify a seam
 * from across the sector.
 */
export function buildRock(def: VoidRockDefinition, radius: number) {
    const root = new Container()

    const glow = new Graphics()
    glow.circle(0, 0, radius * 1.5).fill({ color: def.glow, alpha: 0.07 })
    root.addChild(glow)

    const body = new Graphics()
    const points: number[] = []
    const sides = 9 + Math.floor(Math.random() * 4)
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2
        const rr = radius * randRange(0.74, 1.16)
        points.push(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    body.poly(points).fill({ color: def.color })
    body.poly(points).stroke({ width: 2, color: def.glow, alpha: 0.4 })
    root.addChild(body)

    const veins = new Graphics()
    for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2
        const len = radius * randRange(0.35, 0.8)
        veins.moveTo(Math.cos(a) * radius * 0.15, Math.sin(a) * radius * 0.15)
            .lineTo(Math.cos(a) * len, Math.sin(a) * len)
            .stroke({ width: randRange(2, 4), color: def.glow, alpha: 0.55 })
    }
    veins.circle(0, 0, radius * 0.22).fill({ color: def.glow, alpha: 0.8 })
    root.addChild(veins)

    track(gsap.to(veins, { alpha: 0.55, duration: randRange(1.4, 2.6), yoyo: true, repeat: -1, ease: 'sine.inOut' }))

    return { root, body }
}

/** A mining-progress arc drawn around a rock while the laser is on it. */
export function drawMiningRing(gfx: Graphics, radius: number, progress: number, color: number) {
    gfx.clear()
    if (progress <= 0) return
    gfx.circle(0, 0, radius + 12).stroke({ width: 3, color: 0x0f172a, alpha: 0.55 })
    gfx.arc(0, 0, radius + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
        .stroke({ width: 4, color, alpha: 0.95 })
}

export function buildBullet(color: number, rocket: boolean, size = 1) {
    const root = new Container()
    const gfx = new Graphics()
    if (rocket) {
        gfx.poly([9 * size, 0, -6 * size, -4 * size, -3 * size, 0, -6 * size, 4 * size]).fill({ color })
        gfx.circle(-7 * size, 0, 3.4 * size).fill({ color: 0xfbbf24, alpha: 0.85 })
    } else {
        gfx.ellipse(0, 0, 8 * size, 2.6 * size).fill({ color })
        gfx.ellipse(0, 0, 14 * size, 1.4 * size).fill({ color, alpha: 0.35 })
    }
    root.addChild(gfx)
    return root
}

export function buildDrone(color: number) {
    const root = new Container()
    const gfx = new Graphics()
    gfx.poly([9, 0, -5, -6, -2, 0, -5, 6]).fill({ color })
    gfx.circle(2, 0, 2.2).fill({ color: 0xffffff, alpha: 0.9 })
    root.addChild(gfx)
    return root
}

export function buildPickup(color: number, big: boolean) {
    const root = new Container()
    const gfx = new Graphics()
    const r = big ? 9 : 6
    gfx.circle(0, 0, r * 2).fill({ color, alpha: 0.16 })
    gfx.poly([0, -r, r * 0.9, 0, 0, r, -r * 0.9, 0]).fill({ color })
    gfx.poly([0, -r, r * 0.9, 0, 0, r, -r * 0.9, 0]).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 })
    root.addChild(gfx)
    track(gsap.to(root.scale, { x: 1.25, y: 1.25, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    track(gsap.to(root, { rotation: Math.PI * 2, duration: 3, repeat: -1, ease: 'none' }))
    return root
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

/** The two-second red ring a Bulwark paints on the floor before it vents. */
export function drawShockwave(gfx: Graphics, radius: number, telegraph: number, expandProgress: number, color: number) {
    gfx.clear()
    if (expandProgress <= 0) {
        gfx.circle(0, 0, radius).stroke({ width: 2, color, alpha: 0.25 + telegraph * 0.5 })
        gfx.circle(0, 0, radius * telegraph).fill({ color, alpha: 0.06 + telegraph * 0.12 })
        return
    }
    const r = radius * expandProgress
    gfx.circle(0, 0, r).stroke({ width: 14 * (1 - expandProgress) + 4, color, alpha: 0.85 * (1 - expandProgress) })
    gfx.circle(0, 0, r * 0.86).stroke({ width: 4, color: 0xffffff, alpha: 0.5 * (1 - expandProgress) })
}

export function drawRailbeam(gfx: Graphics, length: number, width: number, charge: number, active: number, color: number) {
    gfx.clear()
    if (active <= 0) {
        // Charge line: thin, bright, and unmistakably pointed at something.
        gfx.moveTo(0, 0).lineTo(length, 0).stroke({ width: 1 + charge * 3, color, alpha: 0.25 + charge * 0.55 })
        gfx.circle(0, 0, 6 + charge * 16).fill({ color, alpha: 0.2 + charge * 0.5 })
        return
    }
    const fade = 1 - active
    gfx.rect(0, -width / 2, length, width).fill({ color, alpha: 0.65 * fade })
    gfx.rect(0, -width / 6, length, width / 3).fill({ color: 0xffffff, alpha: 0.9 * fade })
    gfx.circle(0, 0, 30 * fade).fill({ color: 0xffffff, alpha: 0.5 * fade })
}
