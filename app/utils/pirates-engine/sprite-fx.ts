import { Container, Graphics, Text } from 'pixi.js'
import gsap from 'gsap'
import { WORLD_H, WORLD_W } from './constants'
import { randRange } from './math'
import type { AmmoKind, Enemy, PirateCannonRuntime, ShipVisual } from './types'

// Layered vector geometry: no external textures, and crisp at every resolution.
export function drawWaterTexture(bg: Graphics) {
    bg.clear().rect(0, 0, WORLD_W, WORLD_H).fill(0x083b50)
    for (let y = 0; y < WORLD_H; y += 24) {
        bg.rect(0, y, WORLD_W, 24).fill({ color: 0x167f89, alpha: 0.22 * (1 - y / WORLD_H) })
    }
    for (let i = 0; i < 14; i++) {
        const y = i * 85 - 50
        bg.moveTo(0, y).bezierCurveTo(WORLD_W * 0.3, y + 180, WORLD_W * 0.65, y - 140, WORLD_W, y + 40)
            .stroke({ width: 25, color: 0x167780, alpha: 0.045 })
    }
    // Quiet chart grid and an engraved compass give the sea a sense of scale.
    for (let x = 80; x < WORLD_W; x += 160) {
        for (let y = 70; y < WORLD_H; y += 160) {
            bg.moveTo(x - 4, y).lineTo(x + 4, y).moveTo(x, y - 4).lineTo(x, y + 4)
                .stroke({ color: 0x94dacf, alpha: 0.13, width: 1 })
        }
    }
    const cx = WORLD_W - 100
    const cy = WORLD_H - 100
    bg.circle(cx, cy, 48).stroke({ color: 0xace4d8, alpha: 0.12, width: 1 })
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4
        const length = i % 2 ? 26 : 40
        bg.poly([cx + Math.cos(a) * length, cy + Math.sin(a) * length,
            cx + Math.cos(a + 1.57) * 5, cy + Math.sin(a + 1.57) * 5,
            cx, cy]).fill({ color: 0xace4d8, alpha: 0.16 })
    }
}

export function spawnAmbientWaves(waveLayer: Container) {
    for (let i = 0; i < 85; i++) {
        const wave = new Graphics()
        const w = randRange(10, 42)
        wave.moveTo(-w, 0).quadraticCurveTo(-w / 2, -4, 0, 0).quadraticCurveTo(w / 2, 4, w, 0)
            .stroke({ width: 1.2, color: 0xb6f4e4, alpha: randRange(0.08, 0.24) })
        wave.moveTo(-w * 0.5, 6).lineTo(w * 0.4, 6).stroke({ width: 0.7, color: 0x80c7ce, alpha: 0.12 })
        wave.position.set(Math.random() * WORLD_W, Math.random() * WORLD_H)
        waveLayer.addChild(wave)
        const duration = randRange(3, 7)
        const wavePosition = wave.position
        gsap.to(wavePosition, { x: '+=22', y: '+=5', duration, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(wave, { alpha: 0.1, duration, delay: Math.random() * 3, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        wave.on('destroyed', () => {
            gsap.killTweensOf(wave)
            gsap.killTweensOf(wavePosition)
        })
    }
}

export function drawIsland(obstacleLayer: Container, x: number, y: number, r: number) {
    const root = new Container()
    root.position.set(x, y)
    const seed = Math.random() * 6
    const outline = (scale: number, offsetY = 0) => {
        const points: number[] = []
        for (let i = 0; i < 48; i++) {
            const a = i / 48 * Math.PI * 2
            const radius = r * (0.9 + 0.045 * Math.sin(a * 5 + seed) + 0.035 * Math.cos(a * 3 + seed)) * scale
            points.push(Math.cos(a) * radius, Math.sin(a) * radius + offsetY)
        }
        return points
    }
    const reef = new Graphics()
    for (const [scale, color, alpha] of [[1.48, 0x117d87, 0.22], [1.3, 0x1ba79c, 0.3], [1.14, 0x50c8af, 0.4]]) {
        reef.poly(outline(scale!)).fill({ color: color!, alpha: alpha! })
    }
    root.addChild(reef)
    const land = new Graphics()
    land.poly(outline(1, 6)).fill(0x263e39)
    land.poly(outline(1)).fill(0xb3945b)
    land.poly(outline(0.96, -4)).fill(0xf0d79c)
    land.poly(outline(0.87, -6)).fill(0xf9e6ae)
    land.poly(outline(0.7, -9)).fill(0x35664b)
    land.poly(outline(0.65, -13)).fill(0x44865b)
    land.poly(outline(0.56, -16)).fill(0x69a46b)
    root.addChild(land)
    const surf = new Graphics()
    surf.poly(outline(1.07)).stroke({ width: 2, color: 0xd8fff0, alpha: 0.55 })
    root.addChild(surf)
    gsap.to(surf.scale, { x: 1.055, y: 1.055, duration: 2.8, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    gsap.to(surf, { alpha: 0.25, duration: 2.8, repeat: -1, yoyo: true })
    const decor = new Graphics()
    const volcanic = seed > 4
    if (volcanic) {
        // Faceted basalt peak with a warm crater, all inside the collision shore.
        decor.poly([-r * 0.48, 12, -r * 0.18, -r * 0.61, r * 0.16, -r * 0.68, r * 0.49, 9]).fill(0x33424b)
        decor.poly([-r * 0.48, 12, -r * 0.18, -r * 0.61, 0, 7]).fill(0x64716c)
        decor.poly([0, 7, r * 0.16, -r * 0.68, r * 0.49, 9]).fill(0x263840)
        decor.ellipse(0, -r * 0.48, r * 0.16, r * 0.09).fill(0x1c2b32).stroke({ color: 0xf39254, width: 3 })
    } else {
        for (let i = 0; i < 5; i++) {
            const a = i * 2.4 + seed
            const px = Math.cos(a) * r * 0.38
            const py = Math.sin(a) * r * 0.34 - 8
            decor.ellipse(px + 9, py + 12, 15, 7).fill({ color: 0x203d34, alpha: 0.22 })
            decor.moveTo(px + 4, py + 12).quadraticCurveTo(px - 3, py, px, py - 13).stroke({ width: 4, color: 0x8c6740 })
            for (let leaf = 0; leaf < 6; leaf++) {
                const a = leaf * Math.PI / 3 + i
                const lx = px + Math.cos(a) * 21
                const ly = py - 13 + Math.sin(a) * 13
                decor.moveTo(px, py - 13).quadraticCurveTo(lx, ly - 8, lx, ly)
                    .quadraticCurveTo(px + Math.cos(a + 0.5) * 8, py - 7, px, py - 13)
                    .fill(leaf % 2 ? 0x2d8051 : 0x7fbe70)
            }
        }
    }
    for (let i = 0; i < 8; i++) {
        const a = i * 2.4 + seed
        const px = Math.cos(a) * r * 0.73
        const py = Math.sin(a) * r * 0.73
        decor.poly([px - 5, py + 3, px - 7, py - 3, px, py - 8, px + 6, py - 2, px + 5, py + 4]).fill(0x8b9c8a)
        decor.poly([px - 7, py - 3, px, py - 8, px + 6, py - 2, px, py]).fill(0xbdc6a5)
    }
    root.addChild(decor)
    root.on('destroyed', () => {
        gsap.killTweensOf(surf)
        gsap.killTweensOf(surf.scale)
    })
    obstacleLayer.addChild(root)
}

const skinColors: Record<string, number> = {
    'starter': 0xe8bc63,
    'crimson-privateer': 0xc94b53,
    'emerald-serpent': 0x3bc49e,
    'royal-aether': 0xa98bf5,
    'crown-of-tides': 0xffd56c
}

export function createShipVisual(
    color: number, isPlayer: boolean, sizeScale: number, tierId?: string, playerSkinId?: string,
    loadout: PirateCannonRuntime[] = []
): ShipVisual {
    const root = new Container()
    const hull = new Container()
    const body = new Container()
    body.scale.set(sizeScale)
    const accent = isPlayer ? skinColors[playerSkinId ?? 'starter'] ?? skinColors.starter! : color
    const armored = tierId === 'ironclad' || tierId === 'dreadnought'
    const slender = tierId === 'sniper' || tierId === 'razorskiff'
    const width = armored ? 21 : slender ? 12 : 17
    const shape = [45, 0, 26, -width, -25, -width, -36, -width * 0.6, -39, 0, -36, width * 0.6, -25, width, 26, width]
    const shadow = new Graphics().ellipse(3, 7, 46, width + 6).fill({ color: 0x011b27, alpha: 0.4 })
    body.addChild(shadow)
    const wood = new Graphics()
    wood.poly(shape).fill(0x302c2b).stroke({ color: 0x071f29, width: 3 })
    wood.poly(shape.map((v, i) => i % 2 ? v * 0.87 - 2 : v * 0.94)).fill(armored ? 0x556e7b : 0x93603c)
        .stroke({ color: accent, width: 2 })
    wood.poly(shape.map((v, i) => i % 2 ? v * 0.67 - 2 : v * 0.85)).fill(armored ? 0x839294 : 0xc39b64)
    for (let y = -9; y <= 9; y += 4) {
        wood.moveTo(-29, y).lineTo(29 - Math.abs(y), y).stroke({ width: 0.7, color: 0x624e3a, alpha: 0.6 })
    }
    wood.moveTo(32, 0).lineTo(53, 0).stroke({ color: 0xdec78f, width: 2 })
    wood.roundRect(-31, -10, 13, 20, 3).fill(0x584533).stroke({ color: accent, width: 1.5 })
    wood.roundRect(-29, -8, 9, 16, 2).fill(armored ? 0x425966 : 0x936a43)
    wood.circle(-25, 0, 3).fill(accent)
    body.addChild(wood)
    const cannons: ShipVisual['cannons'] = []
    const guns = isPlayer ? loadout : Array.from({ length: armored ? 6 : 4 }, (_, slotIndex) => ({ slotIndex, shotColor: accent }))
    const rows = Math.max(1, Math.ceil(guns.length / 2))
    for (let i = 0; i < guns.length; i++) {
        const gun = guns[i]!
        const mount = new Container()
        mount.position.set(rows === 1 ? 2 : -14 + Math.floor(i / 2) * 36 / Math.max(1, rows - 1), (i % 2 ? 1 : -1) * (width - 1))
        mount.rotation = i % 2 ? Math.PI / 2 : -Math.PI / 2
        const base = new Graphics().circle(0, 0, 4).fill(0x2a333a).stroke({ color: 0xb8a37a, width: 1 })
        const barrel = new Graphics()
        barrel.roundRect(-3, -3, 16, 6, 2).fill(0x293c48).stroke({ color: 0x111e28, width: 1 })
        barrel.rect(2, -3, 4, 6).fill(gun.shotColor)
        barrel.moveTo(0, -2).lineTo(11, -2).stroke({ width: 1, color: 0xd0e2df, alpha: 0.65 })
        barrel.rect(12, -3.5, 3, 7).fill(0x132633)
        mount.addChild(base, barrel)
        body.addChild(mount)
        cannons.push({ mount, barrel, slotIndex: gun.slotIndex, recoil: 0 })
    }
    const sails: Graphics[] = []
    for (const [x, half] of armored ? [[4, 13]] : [[14, 21], [-9, 16]]) {
        const rig = new Graphics()
        rig.moveTo(x!, -half!).lineTo(x!, half!).stroke({ color: 0x443d30, width: 2 })
        rig.moveTo(x!, -half!).lineTo(37, 0).lineTo(x!, half!).stroke({ color: 0xebd7a6, alpha: 0.45, width: 0.65 })
        body.addChild(rig)
        const sail = new Graphics()
        sail.moveTo(0, -half!).quadraticCurveTo(-16, -half! * 0.6, -10, 0)
            .quadraticCurveTo(-15, half! * 0.7, 0, half!).quadraticCurveTo(-5, 0, 0, -half!)
            .fill(isPlayer && playerSkinId !== 'starter' ? accent : tierId === 'ghostship' ? 0x8cf1cd : isPlayer ? 0xfff0ce : 0xc1cbd0)
            .stroke({ width: 0.8, color: 0x4b584e, alpha: 0.5 })
        sail.moveTo(-2, -half! + 3).quadraticCurveTo(-12, 0, -2, half! - 3).stroke({ color: 0xffffff, alpha: 0.5, width: 1.5 })
        sail.position.set(x!, -3)
        body.addChild(sail)
        sails.push(sail)
        body.addChild(new Graphics().circle(x!, -3, 2.5).fill(0xefe1b7))
    }
    const flag = new Graphics().poly([-34, -3, -51, -9, -47, -2, -52, 3, -34, 2]).fill(accent)
    body.addChild(flag)
    const flashOverlay = new Graphics().poly(shape).fill(0xffffff)
    flashOverlay.alpha = 0
    body.addChild(flashOverlay)
    hull.addChild(body)
    root.addChild(hull)
    return { root, hull, body, sails, cannons, flashOverlay, phase: Math.random() * Math.PI * 2 }
}

/** Aim the actual equipped mount; return its muzzle in world coordinates. */
export function fireShipCannon(visual: ShipVisual, targetX: number, targetY: number, slotIndex?: number) {
    const gun = visual.cannons.find(gun => gun.slotIndex === slotIndex) ?? visual.cannons[0]
    if (!gun || !visual.root.parent) return { x: visual.root.x, y: visual.root.y }
    const target = visual.body.toLocal(visual.root.parent.toGlobal({ x: targetX, y: targetY }))
    gun.mount.rotation = Math.atan2(target.y - gun.mount.y, target.x - gun.mount.x)
    const muzzle = visual.root.parent.toLocal(gun.mount.toGlobal({ x: 16, y: 0 }))
    gun.recoil = 1
    return muzzle
}

export function updateShipCannons(visual: ShipVisual, dt: number) {
    for (const gun of visual.cannons) {
        gun.recoil = Math.max(0, gun.recoil - dt * 4)
        gun.barrel.x = -gun.recoil * 5
    }
}

export function flashShip(v: ShipVisual) {
    gsap.killTweensOf(v.flashOverlay)
    v.flashOverlay.alpha = 0.75
    gsap.to(v.flashOverlay, { alpha: 0, duration: 0.22, ease: 'power2.out' })
}

export function createHpBar(width = 52, offsetY = -50) {
    const container = new Container()
    container.position.set(-width / 2, offsetY)
    const bg = new Graphics()
    bg.roundRect(0, 0, width, 7, 3).fill({ color: 0x1c1917, alpha: 0.75 })
    container.addChild(bg)
    const fill = new Graphics()
    fill.roundRect(0, 0, width, 7, 3).fill({ color: 0x4ade80 })
    container.addChild(fill)
    return { container, fill, width }
}

export function updateEnemyHpBar(enemy: Enemy) {
    updateBarFill(enemy.hpBarFill, enemy.hpBarWidth, enemy.hp / enemy.maxHp)
}

/** Shared health-bar repaint used by both enemy hulls and friendly escorts. */
export function updateBarFill(fill: Graphics, width: number, fraction: number) {
    const frac = Math.max(0, Math.min(1, fraction))
    fill.clear()
    fill.roundRect(0, 0, width * frac, 7, 3)
        .fill({ color: frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfbbf24 : 0xef4444 })
}

/**
 * Floating combat text. Popups aimed at the same target stack into "lanes"
 * so rapid multi-cannon volleys stay readable instead of piling onto the
 * exact same pixel.
 */
export function spawnDamagePopup(
    effectsLayer: Container, popupLanes: Map<string, number>,
    laneKey: string, x: number, y: number, text: string, color: number, crit: boolean
) {
    const lane = popupLanes.get(laneKey) ?? 0
    popupLanes.set(laneKey, lane + 1)
    gsap.delayedCall(0.45, () => {
        const cur = popupLanes.get(laneKey) ?? 0
        popupLanes.set(laneKey, Math.max(0, cur - 1))
    })

    const laneOffsetY = -lane * 22
    const laneOffsetX = lane % 2 === 0 ? 0 : (lane % 4 === 1 ? 18 : -18)

    const label = new Text({
        text,
        style: {
            fill: color,
            fontFamily: 'Inter, ui-sans-serif, system-ui',
            fontSize: crit ? 26 : text === 'MISS' ? 17 : 20,
            fontWeight: '900',
            stroke: { color: 0x111827, width: 4 },
            dropShadow: { color, blur: 8, distance: 0, alpha: 0.85 }
        }
    })
    label.anchor.set(0.5)
    label.position.set(x + laneOffsetX + (Math.random() - 0.5) * 8, y + laneOffsetY)
    label.scale.set(0.5)
    effectsLayer.addChild(label)
    const drift = (Math.random() - 0.5) * 20
    gsap.to(label.scale, { x: 1, y: 1, duration: 0.16, ease: 'back.out(3)' })
    gsap.to(label.position, { x: label.x + drift, y: label.y - 56, duration: 0.75, ease: 'power2.out' })
    gsap.to(label, { alpha: 0, duration: 0.22, delay: 0.52, ease: 'power2.in', onComplete: () => label.destroy() })
}

/**
 * Soft additive halo. Additive blending is what makes light read as light on
 * the dark sea — a plain alpha disc just looks like a coloured sticker.
 */
function spawnGlow(effectsLayer: Container, x: number, y: number, radius: number, color: number, duration: number, alpha = 0.4, grow = 1.8) {
    const glow = new Graphics()
    glow.circle(0, 0, radius).fill({ color, alpha: alpha * 0.5 })
    glow.circle(0, 0, radius * 0.55).fill({ color, alpha })
    glow.blendMode = 'add'
    glow.position.set(x, y)
    effectsLayer.addChild(glow)
    gsap.to(glow.scale, { x: grow, y: grow, duration, ease: 'power2.out' })
    gsap.to(glow, { alpha: 0, duration, ease: 'power2.out', onComplete: () => glow.destroy() })
    return glow
}

export function spawnSplash(effectsLayer: Container, x: number, y: number) {
    for (let i = 0; i < 11; i++) {
        const p = new Graphics()
        p.circle(0, 0, 2 + Math.random() * 2.4).fill({ color: 0xdbeafe, alpha: 0.8 })
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const ang = Math.random() * Math.PI * 2
        const r = 18 + Math.random() * 26
        // Droplets arc: out and up first, then fall back toward the surface.
        gsap.to(p.position, { x: x + Math.cos(ang) * r, duration: 0.45, ease: 'power2.out' })
        gsap.to(p.position, { y: y + Math.sin(ang) * r - 14, duration: 0.22, ease: 'power2.out' })
        gsap.to(p.position, { y: y + Math.sin(ang) * r + 4, duration: 0.24, delay: 0.22, ease: 'power2.in' })
        gsap.to(p, { alpha: 0, duration: 0.46, ease: 'power2.in', onComplete: () => p.destroy() })
    }
    // A brief column of spray at the point of entry.
    const column = new Graphics()
    column.ellipse(0, 0, 7, 15).fill({ color: 0xeff6ff, alpha: 0.55 })
    column.position.set(x, y)
    effectsLayer.addChild(column)
    gsap.to(column.scale, { x: 1.7, y: 0.35, duration: 0.4, ease: 'power2.out' })
    gsap.to(column, { alpha: 0, duration: 0.4, ease: 'power2.in', onComplete: () => column.destroy() })
    for (const [delay, width, alpha] of [[0, 2.2, 0.75], [0.12, 1.2, 0.4]] as const) {
        const ring = new Graphics()
        ring.circle(0, 0, 8).stroke({ width, color: 0xbfdbfe, alpha })
        ring.position.set(x, y)
        ring.alpha = 0
        effectsLayer.addChild(ring)
        gsap.to(ring, { alpha: 1, duration: 0.05, delay })
        gsap.to(ring.scale, { x: 3.4, y: 2.6, duration: 0.55, delay, ease: 'power2.out' })
        gsap.to(ring, { alpha: 0, duration: 0.5, delay: delay + 0.1, ease: 'power2.out', onComplete: () => ring.destroy() })
    }
}

export function spawnExplosion(effectsLayer: Container, x: number, y: number, color: number, big: boolean) {
    // Colour-led fireball: a small white-hot point inside a tinted bloom that
    // swells and fades. Kept saturated on purpose — additive white discs wash
    // out to a blob, the cannon colour is what makes a hit readable. Smoke,
    // rings and wreckage are layered by the caller where the beat deserves it.
    const ball = new Graphics()
    ball.circle(0, 0, big ? 22 : 13).fill({ color, alpha: 0.28 })
    ball.circle(0, 0, big ? 13 : 8).fill({ color, alpha: 0.75 })
    ball.circle(0, 0, big ? 5 : 3).fill({ color: 0xfff7ed, alpha: 0.9 })
    ball.blendMode = 'add'
    ball.position.set(x, y)
    effectsLayer.addChild(ball)
    gsap.fromTo(ball.scale, { x: 0.4, y: 0.4 }, { x: big ? 1.6 : 1.3, y: big ? 1.6 : 1.3, duration: big ? 0.28 : 0.2, ease: 'power3.out' })
    gsap.to(ball, { alpha: 0, duration: big ? 0.3 : 0.22, delay: 0.04, ease: 'power2.in', onComplete: () => ball.destroy() })

    // Streaked embers thrown outward with momentum.
    const count = big ? 9 : 5
    for (let i = 0; i < count; i++) {
        const ember = new Graphics()
        const size = big ? randRange(2, 4) : randRange(1.5, 2.8)
        ember.ellipse(0, 0, size * 2.4, size).fill({ color: i % 3 === 0 ? 0xfde68a : color, alpha: 0.95 })
        ember.blendMode = 'add'
        ember.position.set(x, y)
        const ang = (i / count) * Math.PI * 2 + randRange(-0.35, 0.35)
        ember.rotation = ang
        effectsLayer.addChild(ember)
        const r = (big ? 36 : 22) + Math.random() * (big ? 40 : 24)
        gsap.to(ember.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r - randRange(4, 12), duration: randRange(0.38, 0.52), ease: 'power3.out' })
        gsap.to(ember.scale, { x: 0.3, y: 0.3, duration: 0.5, ease: 'power2.in' })
        gsap.to(ember, { alpha: 0, duration: 0.5, ease: 'power2.in', onComplete: () => ember.destroy() })
    }

    // A few thin shards for force.
    const shardCount = big ? 5 : 3
    for (let i = 0; i < shardCount; i++) {
        const shard = new Graphics()
        const len = big ? randRange(14, 26) : randRange(9, 16)
        shard.moveTo(0, 0).lineTo(len, -1.2).lineTo(len + 5, 0).lineTo(len, 1.2).closePath()
            .fill({ color: 0xfde68a, alpha: 0.85 })
        shard.blendMode = 'add'
        shard.position.set(x, y)
        shard.rotation = (i / shardCount) * Math.PI * 2 + randRange(-0.4, 0.4)
        effectsLayer.addChild(shard)
        const push = big ? randRange(30, 56) : randRange(18, 34)
        gsap.to(shard.position, { x: x + Math.cos(shard.rotation) * push, y: y + Math.sin(shard.rotation) * push, duration: 0.28, ease: 'power3.out' })
        gsap.to(shard, { alpha: 0, duration: 0.28, ease: 'power2.in', onComplete: () => shard.destroy() })
    }
}

export function spawnMuzzleFlash(
    effectsLayer: Container, x: number, y: number, angle: number, kind: AmmoKind | 'enemy', cannonColor?: number
) {
    const color = cannonColor ?? (kind === 'gem' ? 0x7dd3fc : 0xfcd34d)
    // A forked tongue of flame with a white-hot core, blended additively so
    // it glows against the hull instead of painting over it.
    const flash = new Graphics()
    flash.poly([0, 0, 18, -7, 26, -2, 30, 0, 26, 2, 18, 7]).fill({ color, alpha: 0.9 })
    flash.poly([0, 0, 12, -3, 20, 0, 12, 3]).fill({ color: 0xffffff, alpha: 0.9 })
    flash.blendMode = 'add'
    flash.position.set(x, y)
    flash.rotation = angle
    effectsLayer.addChild(flash)
    gsap.fromTo(flash.scale, { x: 0.6, y: 0.6 }, { x: 1.3, y: 1.1, duration: 0.12, ease: 'power2.out' })
    gsap.to(flash, { alpha: 0, duration: 0.14, ease: 'power2.out', onComplete: () => flash.destroy() })
    spawnGlow(effectsLayer, x, y, 14, color, 0.18, 0.5, 1.9)

    // Burning grains kicked forward out of the barrel.
    for (let i = 0; i < 5; i++) {
        const spark = new Graphics()
        spark.circle(0, 0, randRange(1, 2.2)).fill({ color: 0xfef08a, alpha: 0.95 })
        spark.blendMode = 'add'
        spark.position.set(x, y)
        effectsLayer.addChild(spark)
        const sparkAngle = angle + randRange(-0.42, 0.42)
        const reach = randRange(18, 42)
        gsap.to(spark.position, { x: x + Math.cos(sparkAngle) * reach, y: y + Math.sin(sparkAngle) * reach, duration: 0.28, ease: 'power3.out' })
        gsap.to(spark, { alpha: 0, duration: 0.28, ease: 'power2.in', onComplete: () => spark.destroy() })
    }

    for (let i = 0; i < 3; i++) {
        const smoke = new Graphics()
        smoke.circle(0, 0, randRange(3, 5)).fill({ color: cannonColor ?? (kind === 'gem' ? 0xbae6fd : 0x9ca3af), alpha: cannonColor ? 0.38 : 0.5 })
        smoke.position.set(x, y)
        effectsLayer.addChild(smoke)
        const sAng = angle + randRange(-0.5, 0.5)
        gsap.to(smoke.position, {
            x: x + Math.cos(sAng) * randRange(12, 26),
            y: y + Math.sin(sAng) * randRange(12, 26) - 6,
            duration: 0.55,
            ease: 'power2.out'
        })
        gsap.to(smoke.scale, { x: 2, y: 2, duration: 0.55, ease: 'power1.out' })
        gsap.to(smoke, { alpha: 0, duration: 0.55, ease: 'power1.in', onComplete: () => smoke.destroy() })
    }
}

export function spawnTrailParticle(effectsLayer: Container, x: number, y: number, color: number, scale = 1, alpha = 0.85) {
    const p = new Graphics()
    p.circle(0, 0, randRange(1.5, 3) * scale).fill({ color, alpha })
    p.blendMode = 'add'
    p.position.set(x + randRange(-3, 3), y + randRange(-3, 3))
    effectsLayer.addChild(p)
    gsap.to(p.scale, { x: 0.2, y: 0.2, duration: 0.4, ease: 'power1.in' })
    gsap.to(p, { alpha: 0, duration: 0.4, ease: 'power1.in', onComplete: () => p.destroy() })
}

export function spawnPowerUpBurst(effectsLayer: Container, world: Container, x: number, y: number, color: number) {
    spawnGlow(effectsLayer, x, y, 34, color, 0.45, 0.45, 2)
    spawnShockRing(effectsLayer, x, y, 70, color)
    for (let i = 0; i < 14; i++) {
        const p = new Graphics()
        p.star(0, 0, 4, randRange(3, 6), randRange(1, 2)).fill({ color, alpha: 0.95 })
        p.blendMode = 'add'
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const angle = (i / 14) * Math.PI * 2 + randRange(-0.1, 0.1)
        const radius = randRange(35, 75)
        gsap.to(p.position, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, duration: 0.55, ease: 'power3.out' })
        gsap.to(p, { alpha: 0, rotation: Math.PI, duration: 0.55, ease: 'power2.in', onComplete: () => p.destroy() })
    }
    shake(world, 5)
}

export function spawnShieldImpact(effectsLayer: Container, x: number, y: number, absorbed: number) {
    const shield = new Graphics()
    shield.circle(0, 0, 43).fill({ color: 0x22d3ee, alpha: 0.13 })
    shield.circle(0, 0, 43).stroke({ width: 4, color: 0x67e8f9, alpha: 0.9 })
    shield.blendMode = 'add'
    shield.position.set(x, y)
    effectsLayer.addChild(shield)
    gsap.fromTo(shield.scale, { x: 0.75, y: 0.75 }, { x: 1.25 + absorbed / 50, y: 1.25 + absorbed / 50, duration: 0.25, ease: 'power2.out' })
    gsap.to(shield, { alpha: 0, duration: 0.35, ease: 'power2.out', onComplete: () => shield.destroy() })
}

export function spawnWake(effectsLayer: Container, x: number, y: number, angle: number) {
    const wake = new Graphics()
    wake.ellipse(0, 0, 7, 3.5).fill({ color: 0xdbeafe, alpha: 0.35 })
    wake.position.set(x - Math.cos(angle) * 30, y - Math.sin(angle) * 30)
    wake.rotation = angle
    effectsLayer.addChild(wake)
    gsap.to(wake.scale, { x: 2.4, y: 2, duration: 1, ease: 'power1.out' })
    gsap.to(wake, { alpha: 0, duration: 1, ease: 'power1.out', onComplete: () => wake.destroy() })
}

export function spawnMoveMarker(effectsLayer: Container, x: number, y: number) {
    const marker = new Graphics()
    marker.circle(0, 0, 12).stroke({ width: 2.5, color: 0xfef08a, alpha: 0.9 })
    marker.circle(0, 0, 3).fill({ color: 0xfef08a, alpha: 0.9 })
    marker.position.set(x, y)
    effectsLayer.addChild(marker)
    gsap.from(marker.scale, { x: 2, y: 2, duration: 0.3, ease: 'power2.out' })
    gsap.to(marker, { alpha: 0, duration: 0.5, delay: 0.2, ease: 'power2.in', onComplete: () => marker.destroy() })
}

export function spawnSinkBubbles(effectsLayer: Container, x: number, y: number) {
    for (let i = 0; i < 8; i++) {
        const b = new Graphics()
        b.circle(0, 0, randRange(1.5, 3.5)).stroke({ width: 1.2, color: 0xe0f2fe, alpha: 0.8 })
        b.position.set(x + randRange(-18, 18), y + randRange(-10, 10))
        effectsLayer.addChild(b)
        gsap.to(b.position, { y: b.position.y - randRange(10, 24), duration: randRange(0.6, 1.1), ease: 'power1.out', delay: i * 0.06 })
        gsap.to(b, { alpha: 0, duration: randRange(0.6, 1.1), delay: i * 0.06, ease: 'power1.in', onComplete: () => b.destroy() })
    }
}

export function spawnTreasureSparkles(root: Container) {
    for (let i = 0; i < 3; i++) {
        const spark = new Graphics()
        spark.star(0, 0, 4, 3.5, 1.4).fill({ color: 0xfef9c3, alpha: 0.95 })
        spark.position.set(randRange(-14, 14), randRange(-16, 4))
        spark.alpha = 0
        root.addChild(spark)
        gsap.to(spark, {
            alpha: 1,
            duration: 0.5,
            delay: i * 0.5,
            yoyo: true,
            repeat: -1,
            repeatDelay: 1,
            ease: 'sine.inOut'
        })
        gsap.to(spark, { rotation: Math.PI, duration: 2.4, repeat: -1, ease: 'none' })
    }
}

export function drawLightningArc(effectsLayer: Container, fromX: number, fromY: number, toX: number, toY: number) {
    const bolt = new Graphics()
    bolt.moveTo(fromX, fromY)
    const segments = 7
    for (let i = 1; i < segments; i++) {
        const t = i / segments
        const x = fromX + (toX - fromX) * t + randRange(-12, 12)
        const y = fromY + (toY - fromY) * t + randRange(-12, 12)
        bolt.lineTo(x, y)
    }
    bolt.lineTo(toX, toY).stroke({ width: 7, color: 0x38bdf8, alpha: 0.25 })
    bolt.moveTo(fromX, fromY)
    for (let i = 1; i < segments; i++) {
        const t = i / segments
        bolt.lineTo(fromX + (toX - fromX) * t + randRange(-7, 7), fromY + (toY - fromY) * t + randRange(-7, 7))
    }
    bolt.lineTo(toX, toY).stroke({ width: 2.5, color: 0xe0f2fe, alpha: 1 })
    bolt.blendMode = 'add'
    effectsLayer.addChild(bolt)
    spawnGlow(effectsLayer, toX, toY, 16, 0x38bdf8, 0.3, 0.45, 1.6)
    gsap.to(bolt, { alpha: 0, duration: 0.32, ease: 'power2.in', onComplete: () => bolt.destroy() })
}

/**
 * A repair tick. Deliberately small and quiet — regen fires often enough that
 * anything showier would clutter the screen.
 */
export function spawnRegenSparkle(effectsLayer: Container, x: number, y: number) {
    for (let i = 0; i < 4; i++) {
        const mote = new Graphics()
        mote.circle(0, 0, randRange(1.5, 3)).fill({ color: 0xfda4af, alpha: 0.85 })
        mote.position.set(x + randRange(-24, 24), y + randRange(-12, 12))
        effectsLayer.addChild(mote)
        gsap.to(mote.position, { y: mote.y - randRange(22, 38), duration: randRange(0.6, 0.95), ease: 'power1.out' })
        gsap.to(mote, { alpha: 0, duration: randRange(0.6, 0.95), ease: 'power1.in', onComplete: () => mote.destroy() })
    }
}

/** A single Hunter's Chain warhead — used both in orbit and as the projectile. */
export function createHunterWarhead() {
    const warhead = new Container()
    const glow = new Graphics()
    glow.circle(0, 0, 11).fill({ color: 0xfb7185, alpha: 0.3 })
    glow.circle(0, 0, 6).fill({ color: 0xf43f5e, alpha: 0.45 })
    const body = new Graphics()
    body.moveTo(14, 0).lineTo(-8, -6).lineTo(-4, 0).lineTo(-8, 6).closePath()
        .fill({ color: 0xfff1f2 }).stroke({ width: 2, color: 0xe11d48 })
    body.circle(2, 0, 2.2).fill({ color: 0xfb7185 })
    warhead.addChild(glow, body)
    gsap.to(glow.scale, { x: 1.35, y: 1.35, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
    return warhead
}

/** Expanding pressure ring — the readable "something big just landed" beat. */
export function spawnShockRing(effectsLayer: Container, x: number, y: number, radius: number, color: number) {
    const ring = new Graphics()
    ring.circle(0, 0, 20).stroke({ width: 4, color, alpha: 0.9 })
    ring.circle(0, 0, 20).stroke({ width: 10, color, alpha: 0.22 })
    ring.blendMode = 'add'
    ring.position.set(x, y)
    effectsLayer.addChild(ring)
    gsap.to(ring.scale, { x: radius / 20, y: radius / 20, duration: 0.42, ease: 'power3.out' })
    gsap.to(ring, { alpha: 0, duration: 0.48, ease: 'power2.out', onComplete: () => ring.destroy() })
}

/** Tumbling embers thrown outward — layered on top of explosions for weight. */
export function spawnEmberBurst(effectsLayer: Container, x: number, y: number, count: number, colors: number[]) {
    for (let i = 0; i < count; i++) {
        const ember = new Graphics()
        const color = colors[i % colors.length]!
        ember.star(0, 0, 4, randRange(2.5, 6), randRange(1, 2.4)).fill({ color, alpha: 0.95 })
        ember.blendMode = 'add'
        ember.position.set(x, y)
        effectsLayer.addChild(ember)
        const angle = (i / count) * Math.PI * 2 + randRange(-0.3, 0.3)
        const radius = randRange(40, 110)
        gsap.to(ember.position, {
            x: x + Math.cos(angle) * radius,
            y: y + Math.sin(angle) * radius - randRange(0, 18),
            duration: randRange(0.45, 0.75),
            ease: 'power3.out'
        })
        gsap.to(ember.scale, { x: 0.2, y: 0.2, duration: 0.7, ease: 'power2.in' })
        gsap.to(ember, { alpha: 0, rotation: randRange(-Math.PI, Math.PI), duration: 0.7, ease: 'power2.in', onComplete: () => ember.destroy() })
    }
}

/** Drifting smoke puffs — soft, slow, and cheap. Sells the aftermath of a hit. */
export function spawnSmokePuffs(effectsLayer: Container, x: number, y: number, count: number, color = 0x94a3b8) {
    for (let i = 0; i < count; i++) {
        const puff = new Graphics()
        puff.circle(0, 0, randRange(4, 9)).fill({ color, alpha: 0.35 })
        puff.position.set(x + randRange(-10, 10), y + randRange(-10, 10))
        effectsLayer.addChild(puff)
        gsap.to(puff.position, {
            x: puff.x + randRange(-26, 26),
            y: puff.y - randRange(14, 38),
            duration: randRange(0.8, 1.3),
            ease: 'power1.out'
        })
        gsap.to(puff.scale, { x: 2.4, y: 2.4, duration: 1.2, ease: 'power1.out' })
        gsap.to(puff, { alpha: 0, duration: randRange(0.8, 1.3), ease: 'power1.in', onComplete: () => puff.destroy() })
    }
}

/**
 * The soft mutated plasma trail left by the three highest cannon tiers. Rather
 * than a plain fading dot it wobbles outward and blooms, so a Leviathan volley
 * reads instantly as end-game hardware.
 */
export function spawnMutatedTrail(effectsLayer: Container, x: number, y: number, color: number, scale = 1) {
    // Kept deliberately soft — a hazy wake that suggests the shot rather than
    // a hard string of beads chasing it.
    const core = new Graphics()
    core.circle(0, 0, randRange(2, 3.4) * scale).fill({ color, alpha: 0.4 })
    core.circle(0, 0, randRange(5, 7.5) * scale).fill({ color, alpha: 0.09 })
    core.position.set(x + randRange(-2, 2), y + randRange(-2, 2))
    effectsLayer.addChild(core)
    const drift = randRange(0, Math.PI * 2)
    gsap.to(core.position, {
        x: core.x + Math.cos(drift) * randRange(5, 14),
        y: core.y + Math.sin(drift) * randRange(5, 14),
        duration: 0.55,
        ease: 'sine.out'
    })
    gsap.to(core.scale, { x: 1.7, y: 1.7, duration: 0.55, ease: 'power1.out' })
    gsap.to(core, { alpha: 0, duration: 0.55, ease: 'power1.in', onComplete: () => core.destroy() })

    // An occasional pale mote gives the trail its "mutated" shimmer without
    // making the whole wake read as sparkles.
    if (Math.random() < 0.22) {
        const mote = new Graphics()
        mote.star(0, 0, 3, randRange(1.6, 2.6) * scale, 1).fill({ color: 0xffffff, alpha: 0.35 })
        mote.position.set(x, y)
        effectsLayer.addChild(mote)
        gsap.to(mote.position, { x: x - Math.cos(drift) * randRange(6, 15), y: y - Math.sin(drift) * randRange(6, 15), duration: 0.45, ease: 'sine.out' })
        gsap.to(mote, { alpha: 0, rotation: Math.PI, duration: 0.45, ease: 'power1.in', onComplete: () => mote.destroy() })
    }
}

/**
 * The Ghostly Consort's gunfire wake. Same soft bloom shape as the top-tier
 * mutated trail so it reads as heavy ordnance, but in a cold slate-and-blue
 * palette with a dark shadow underlay — unmistakably the escort's shot rather
 * than one of the captain's own.
 */
export function spawnConsortTrail(effectsLayer: Container, x: number, y: number, scale = 1) {
    const shadow = new Graphics()
    shadow.circle(0, 0, randRange(5, 8) * scale).fill({ color: 0x1e293b, alpha: 0.22 })
    shadow.circle(0, 0, randRange(2.2, 3.6) * scale).fill({ color: 0x64748b, alpha: 0.5 })
    shadow.position.set(x + randRange(-2, 2), y + randRange(-2, 2))
    effectsLayer.addChild(shadow)
    const drift = randRange(0, Math.PI * 2)
    gsap.to(shadow.position, {
        x: shadow.x + Math.cos(drift) * randRange(5, 13),
        y: shadow.y + Math.sin(drift) * randRange(5, 13),
        duration: 0.6,
        ease: 'sine.out'
    })
    gsap.to(shadow.scale, { x: 1.8, y: 1.8, duration: 0.6, ease: 'power1.out' })
    gsap.to(shadow, { alpha: 0, duration: 0.6, ease: 'power1.in', onComplete: () => shadow.destroy() })

    // A cold blue spark riding inside the smoke.
    if (Math.random() < 0.4) {
        const spark = new Graphics()
        spark.circle(0, 0, randRange(1.4, 2.6) * scale).fill({ color: 0x93c5fd, alpha: 0.7 })
        spark.position.set(x, y)
        effectsLayer.addChild(spark)
        gsap.to(spark.position, { x: x - Math.cos(drift) * randRange(6, 14), y: y - Math.sin(drift) * randRange(6, 14), duration: 0.45, ease: 'sine.out' })
        gsap.to(spark, { alpha: 0, duration: 0.45, ease: 'power1.in', onComplete: () => spark.destroy() })
    }
}

/** Spectral rings and motes marking a summoned escort arriving. */
export function spawnSummonBurst(effectsLayer: Container, x: number, y: number, color: number) {
    for (let ring = 0; ring < 3; ring++) {
        const glyph = new Graphics()
        glyph.circle(0, 0, 26 + ring * 10).stroke({ width: 3, color, alpha: 0.8 })
        glyph.blendMode = 'add'
        glyph.position.set(x, y)
        effectsLayer.addChild(glyph)
        gsap.fromTo(glyph.scale, { x: 0.2, y: 0.2 }, { x: 1.6, y: 1.6, duration: 0.55 + ring * 0.1, ease: 'power2.out' })
        gsap.to(glyph, { alpha: 0, duration: 0.55 + ring * 0.1, ease: 'power2.out', onComplete: () => glyph.destroy() })
    }
    for (let i = 0; i < 14; i++) {
        const mote = new Graphics()
        mote.circle(0, 0, randRange(2, 4)).fill({ color: 0xdbeafe, alpha: 0.9 })
        const angle = (i / 14) * Math.PI * 2
        mote.position.set(x + Math.cos(angle) * 60, y + Math.sin(angle) * 60)
        effectsLayer.addChild(mote)
        gsap.to(mote.position, { x, y, duration: 0.5, ease: 'power2.in' })
        gsap.to(mote, { alpha: 0, duration: 0.5, ease: 'power2.in', onComplete: () => mote.destroy() })
    }
}

/**
 * The Hellfire danger zone. It is intentionally huge and only loosely
 * predictive — the shells scatter randomly inside it — so it is drawn as a
 * sweeping targeting reticle rather than a precise blast circle.
 */
export function drawHellfireZone(effectsLayer: Container, x: number, y: number, radius: number) {
    const zone = new Container()
    zone.position.set(x, y)

    const field = new Graphics()
    field.circle(0, 0, radius).fill({ color: 0xdc2626, alpha: 0.07 })
    field.circle(0, 0, radius).stroke({ width: 4, color: 0xfb923c, alpha: 0.8 })
    field.circle(0, 0, radius * 0.66).stroke({ width: 2, color: 0xfdba74, alpha: 0.45 })
    field.circle(0, 0, radius * 0.33).stroke({ width: 2, color: 0xfed7aa, alpha: 0.35 })
    zone.addChild(field)

    const ticks = new Graphics()
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2
        ticks.moveTo(Math.cos(angle) * (radius - 26), Math.sin(angle) * (radius - 26))
            .lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
            .stroke({ width: 3, color: 0xfb923c, alpha: 0.7 })
    }
    zone.addChild(ticks)

    effectsLayer.addChild(zone)
    gsap.fromTo(zone.scale, { x: 0.35, y: 0.35 }, { x: 1, y: 1, duration: 0.45, ease: 'power3.out' })
    gsap.to(field, { alpha: 0.45, duration: 0.3, yoyo: true, repeat: 7 })
    gsap.to(ticks, { rotation: Math.PI / 2, duration: 3, ease: 'none' })
    return zone
}

export function shake(world: Container, amount: number) {
    gsap.killTweensOf(world.position)
    const timeline = gsap.timeline({ onComplete: () => world.position.set(0, 0) })
    for (let i = 0; i < 4; i++) {
        timeline.to(world.position, {
            x: (Math.random() - 0.5) * amount,
            y: (Math.random() - 0.5) * amount,
            duration: 0.045
        })
    }
    timeline.to(world.position, { x: 0, y: 0, duration: 0.05 })
}
