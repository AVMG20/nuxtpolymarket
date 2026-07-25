import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import gsap from 'gsap'
import { WORLD_H, WORLD_W } from './constants'
import { randRange } from './math'
import type { AmmoKind, Enemy, ShipVisual } from './types'

export interface PirateShipTextures {
    playerSkins: Map<string, Texture>
    playerDefault: Texture | null
    sniper: Texture | null
    dpsRaider: Texture | null
    tankRaider: Texture | null
    raider: Texture | null
}

export function drawWaterTexture(bg: Graphics) {
    bg.clear()
    bg.rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0x0b3a57 })
    // Depth blotches
    for (let i = 0; i < 26; i++) {
        const x = Math.random() * WORLD_W
        const y = Math.random() * WORLD_H
        const w = 60 + Math.random() * 140
        bg.ellipse(x, y, w, w * 0.4).fill({ color: 0x0e4466, alpha: 0.25 + Math.random() * 0.15 })
    }
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * WORLD_W
        const y = Math.random() * WORLD_H
        const w = 40 + Math.random() * 90
        bg.ellipse(x, y, w, w * 0.18).fill({ color: 0x1c5c82, alpha: 0.12 + Math.random() * 0.08 })
    }
}

/** Slow-drifting wave glints that loop forever — makes the sea feel alive. */
export function spawnAmbientWaves(waveLayer: Container) {
    for (let i = 0; i < 14; i++) {
        const wave = new Graphics()
        const w = randRange(24, 60)
        wave.moveTo(-w / 2, 0)
            .quadraticCurveTo(0, -w * 0.14, w / 2, 0)
            .stroke({ width: 2, color: 0x9fd0e8, alpha: randRange(0.12, 0.3) })
        wave.position.set(Math.random() * WORLD_W, Math.random() * WORLD_H)
        waveLayer.addChild(wave)
        const drift = randRange(20, 50)
        const dur = randRange(4, 8)
        gsap.to(wave.position, { x: `+=${drift}`, duration: dur, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: Math.random() * dur })
        gsap.to(wave, { alpha: 0.05, duration: dur * 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
    }
}

export function drawIsland(obstacleLayer: Container, islandTextures: Texture[], x: number, y: number, r: number) {
    const root = new Container()
    root.position.set(x, y)

    const shallows = new Graphics()
    shallows.circle(0, 0, r + 16).fill({ color: 0x2e7ea8, alpha: 0.5 })
    shallows.circle(0, 0, r + 7).fill({ color: 0x5eb3d6, alpha: 0.35 })
    root.addChild(shallows)

    if (islandTextures.length) {
        const texture = islandTextures[Math.floor(Math.random() * islandTextures.length)]!
        const island = new Sprite(texture)
        island.anchor.set(0.5)
        island.width = r * 2.05
        island.height = r * 2.04
        island.rotation = randRange(-0.3, 0.3)
        root.addChild(island)
        obstacleLayer.addChild(root)
        gsap.to(shallows, { alpha: 0.7, duration: randRange(2, 3.2), ease: 'sine.inOut', yoyo: true, repeat: -1 })
        return
    }

    // Irregular sandy blob
    const sand = new Graphics()
    const points: number[] = []
    const segments = 14
    for (let i = 0; i < segments; i++) {
        const ang = (i / segments) * Math.PI * 2
        const rad = r * randRange(0.82, 1)
        points.push(Math.cos(ang) * rad, Math.sin(ang) * rad)
    }
    sand.poly(points).fill({ color: 0xe7cf9a }).stroke({ width: 3, color: 0xc9a86a, alpha: 0.8 })
    root.addChild(sand)

    const grass = new Graphics()
    const gPoints: number[] = []
    for (let i = 0; i < segments; i++) {
        const ang = (i / segments) * Math.PI * 2 + 0.3
        const rad = r * randRange(0.45, 0.62)
        gPoints.push(Math.cos(ang) * rad, Math.sin(ang) * rad)
    }
    grass.poly(gPoints).fill({ color: 0x4d8f4f, alpha: 0.9 })
    root.addChild(grass)

    // A couple of palms or rocks
    const decor = new Graphics()
    const decorCount = Math.round(randRange(1, 3))
    for (let i = 0; i < decorCount; i++) {
        const ang = randRange(0, Math.PI * 2)
        const dx = Math.cos(ang) * r * 0.3
        const dy = Math.sin(ang) * r * 0.3
        if (Math.random() < 0.6) {
            // palm: trunk dot + fronds
            decor.circle(dx, dy, 3).fill({ color: 0x6b4a2b })
            for (let f = 0; f < 5; f++) {
                const fa = (f / 5) * Math.PI * 2
                decor.ellipse(dx + Math.cos(fa) * 8, dy + Math.sin(fa) * 8, 7, 3).fill({ color: 0x2f6b31, alpha: 0.95 })
            }
        } else {
            decor.circle(dx, dy, randRange(4, 7)).fill({ color: 0x8a8f98 }).stroke({ width: 1.5, color: 0x5b5f66 })
        }
    }
    root.addChild(decor)

    obstacleLayer.addChild(root)

    // Gentle breathing of the shallows ring
    gsap.to(shallows, { alpha: 0.7, duration: randRange(2, 3.2), ease: 'sine.inOut', yoyo: true, repeat: -1 })
}

/**
 * Top-down ship art. Everything is drawn in "bird's eye" view (hull planks,
 * square-rig sails seen from above) so rotating toward any heading —
 * including straight down — never flips the sprite upside down.
 */
export function createShipVisual(
    color: number, isPlayer: boolean, sizeScale: number, textures: PirateShipTextures, tierId?: string, playerSkinId?: string
): ShipVisual {
    const root = new Container()
    const hull = new Container()
    const body = new Container()
    body.scale.set(sizeScale)

    const shadow = new Graphics()
    shadow.ellipse(3, 5, 40, 18).fill({ color: 0x000000, alpha: 0.25 })
    body.addChild(shadow)

    const isSniper = tierId === 'sniper'
    const isDpsRaider = tierId === 'corsair' || tierId === 'frigate' || tierId === 'manowar'
    const isTankRaider = tierId === 'ironclad' || tierId === 'dreadnought'
    const spriteTexture = isPlayer
        ? (textures.playerSkins.get(playerSkinId ?? 'starter') ?? textures.playerDefault)
        : isSniper
            ? textures.sniper
            : isDpsRaider
                ? textures.dpsRaider
                : isTankRaider ? textures.tankRaider : textures.raider
    if (spriteTexture) {
        const sprite = new Sprite(spriteTexture)
        sprite.anchor.set(0.5)
        sprite.width = isSniper ? 88 : isDpsRaider ? 82 : isTankRaider ? 76 : isPlayer ? 82 : 78
        sprite.height = isPlayer
            ? sprite.width * spriteTexture.height / spriteTexture.width
            : isSniper ? 24 : isDpsRaider ? 30 : isTankRaider ? 42 : 37
        body.addChild(sprite)

        // Preserve instant faction/tier readability without recoloring the art.
        const marker = new Graphics()
        marker.circle(-27, 0, isSniper ? 3 : 4).fill({ color, alpha: 0.95 })
        marker.circle(-27, 0, isSniper ? 6 : 7).stroke({ width: 1.5, color, alpha: 0.6 })
        body.addChild(marker)

        const flashOverlay = new Graphics()
        flashOverlay.ellipse(0, 0, isSniper ? 44 : isDpsRaider ? 41 : 39, isSniper ? 12 : isTankRaider ? 21 : 18).fill({ color: 0xffffff })
        flashOverlay.alpha = 0
        body.addChild(flashOverlay)

        hull.addChild(body)
        root.addChild(hull)
        return { root, hull, body, sprite, sails: [], flashOverlay, phase: Math.random() * Math.PI * 2 }
    }

    // Hull: pointed bow (+x), rounded stern
    const hullShape = new Graphics()
    hullShape.poly([
        36, 0,
        24, -11,
        -18, -13,
        -28, -8,
        -30, 0,
        -28, 8,
        -18, 13,
        24, 11
    ]).fill({ color: 0x6b4a2b }).stroke({ width: 3, color: 0x2d1e10, alpha: 0.85 })
    body.addChild(hullShape)

    // Deck inset + planks
    const deck = new Graphics()
    deck.poly([
        29, 0,
        19, -8,
        -16, -9.5,
        -24, -5,
        -25, 0,
        -24, 5,
        -16, 9.5,
        19, 8
    ]).fill({ color: 0x9c7347 })
    deck.moveTo(-22, -3).lineTo(24, -2.5).stroke({ width: 1, color: 0x7a5836, alpha: 0.8 })
    deck.moveTo(-22, 3).lineTo(24, 2.5).stroke({ width: 1, color: 0x7a5836, alpha: 0.8 })
    body.addChild(deck)

    // Colored gunwale trim marks the faction/tier color
    const trim = new Graphics()
    trim.poly([
        36, 0,
        24, -11,
        -18, -13,
        -28, -8
    ]).stroke({ width: 3.5, color, alpha: 0.95 })
    trim.poly([
        -28, 8,
        -18, 13,
        24, 11,
        36, 0
    ]).stroke({ width: 3.5, color, alpha: 0.95 })
    body.addChild(trim)

    // Side cannons peeking out
    const guns = new Graphics()
    for (const gx of [-8, 6]) {
        guns.rect(gx, -15.5, 4, 4).fill({ color: 0x1c1917 })
        guns.rect(gx, 11.5, 4, 4).fill({ color: 0x1c1917 })
    }
    body.addChild(guns)

    // Square-rig sails seen from above: yard (spar) across the hull with a
    // billowing canvas behind it. Two masts.
    const sailColor = isPlayer ? 0xfaf3e0 : 0xd9d2c4
    const sails: Graphics[] = []
    const mastDefs = [
        { x: 8, half: 19 },
        { x: -12, half: 14 }
    ]
    for (const m of mastDefs) {
        const yard = new Graphics()
        yard.roundRect(m.x - 1.5, -m.half, 3, m.half * 2, 1.5).fill({ color: 0x3f2f1f })
        body.addChild(yard)

        const sail = new Graphics()
        // Canvas billows backward (toward -x)
        sail.moveTo(0, -m.half + 2)
            .quadraticCurveTo(-11, 0, 0, m.half - 2)
            .quadraticCurveTo(-4, 0, 0, -m.half + 2)
            .fill({ color: sailColor, alpha: 0.95 })
            .stroke({ width: 1.2, color: 0x1c1917, alpha: 0.4 })
        sail.position.set(m.x - 1, 0)
        body.addChild(sail)
        sails.push(sail)

        const top = new Graphics()
        top.circle(m.x, 0, 2.4).fill({ color: 0x2d1e10 })
        body.addChild(top)
    }

    // Stern flag
    const flag = new Graphics()
    flag.poly([-30, 0, -42, -4, -42, 4]).fill({ color: isPlayer ? 0xef4444 : color })
    body.addChild(flag)

    // Damage flash overlay, blinked from flashShip()
    const flashOverlay = new Graphics()
    flashOverlay.poly([
        36, 0,
        24, -11,
        -18, -13,
        -28, -8,
        -30, 0,
        -28, 8,
        -18, 13,
        24, 11
    ]).fill({ color: 0xffffff })
    flashOverlay.alpha = 0
    body.addChild(flashOverlay)

    hull.addChild(body)
    root.addChild(hull)
    return { root, hull, body, sails, flashOverlay, phase: Math.random() * Math.PI * 2 }
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
    const ring = new Graphics()
    ring.circle(0, 0, 8).stroke({ width: 2, color: 0xbfdbfe, alpha: 0.7 })
    ring.position.set(x, y)
    effectsLayer.addChild(ring)
    gsap.to(ring.scale, { x: 3, y: 3, duration: 0.5, ease: 'power2.out' })
    gsap.to(ring, { alpha: 0, duration: 0.5, ease: 'power2.out', onComplete: () => ring.destroy() })
}

export function spawnExplosion(effectsLayer: Container, x: number, y: number, color: number, big: boolean) {
    const count = big ? 18 : 10
    for (let i = 0; i < count; i++) {
        const p = new Graphics()
        p.circle(0, 0, big ? 3 + Math.random() * 3.5 : 2 + Math.random() * 2.5).fill({ color, alpha: 0.9 })
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const ang = Math.random() * Math.PI * 2
        const r = (big ? 34 : 22) + Math.random() * 30
        gsap.to(p.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r - 10, duration: 0.45, ease: 'power3.out' })
        gsap.to(p.scale, { x: 0.25, y: 0.25, duration: 0.45, ease: 'power2.in' })
        gsap.to(p, { alpha: 0, duration: 0.45, ease: 'power2.in', onComplete: () => p.destroy() })
    }

    // Sharp radiating shards read as force rather than just a puff of dots.
    const shardCount = big ? 8 : 4
    for (let i = 0; i < shardCount; i++) {
        const shard = new Graphics()
        const len = big ? randRange(14, 26) : randRange(8, 15)
        shard.moveTo(0, 0).lineTo(len, -2).lineTo(len + 5, 0).lineTo(len, 2).closePath()
            .fill({ color: 0xfef3c7, alpha: 0.9 })
        shard.position.set(x, y)
        shard.rotation = (i / shardCount) * Math.PI * 2 + randRange(-0.25, 0.25)
        effectsLayer.addChild(shard)
        const push = big ? randRange(30, 58) : randRange(18, 34)
        gsap.to(shard.position, { x: x + Math.cos(shard.rotation) * push, y: y + Math.sin(shard.rotation) * push, duration: 0.34, ease: 'power3.out' })
        gsap.to(shard, { alpha: 0, duration: 0.34, ease: 'power2.in', onComplete: () => shard.destroy() })
    }

    const flash = new Graphics()
    flash.circle(0, 0, big ? 18 : 12).fill({ color: 0xffffff, alpha: 0.85 })
    flash.circle(0, 0, big ? 26 : 17).fill({ color, alpha: 0.35 })
    flash.position.set(x, y)
    effectsLayer.addChild(flash)
    gsap.to(flash.scale, { x: 2, y: 2, duration: 0.18, ease: 'power2.out' })
    gsap.to(flash, { alpha: 0, duration: 0.2, ease: 'power2.out', onComplete: () => flash.destroy() })

    if (big) {
        spawnShockRing(effectsLayer, x, y, 58, color)
        spawnSmokePuffs(effectsLayer, x, y, 4, 0x57534e)
    }
}

export function spawnMuzzleFlash(
    effectsLayer: Container, x: number, y: number, angle: number, kind: AmmoKind | 'enemy', cannonColor?: number
) {
    const color = cannonColor ?? (kind === 'gem' ? 0x7dd3fc : 0xfcd34d)
    const flash = new Graphics()
    flash.poly([0, 0, 16, -5, 20, 0, 16, 5]).fill({ color, alpha: 0.95 })
    flash.position.set(x, y)
    flash.rotation = angle
    effectsLayer.addChild(flash)
    gsap.to(flash.scale, { x: 1.4, y: 1.4, duration: 0.14, ease: 'power2.out' })
    gsap.to(flash, { alpha: 0, duration: 0.14, ease: 'power2.out', onComplete: () => flash.destroy() })

    // Muzzle bloom: a short-lived halo right at the gun port.
    const bloom = new Graphics()
    bloom.circle(0, 0, 9).fill({ color: 0xffffff, alpha: 0.8 })
    bloom.circle(0, 0, 14).fill({ color, alpha: 0.3 })
    bloom.position.set(x, y)
    effectsLayer.addChild(bloom)
    gsap.to(bloom.scale, { x: 1.9, y: 1.9, duration: 0.16, ease: 'power2.out' })
    gsap.to(bloom, { alpha: 0, duration: 0.16, ease: 'power2.out', onComplete: () => bloom.destroy() })

    // Burning grains kicked forward out of the barrel.
    for (let i = 0; i < 5; i++) {
        const spark = new Graphics()
        spark.circle(0, 0, randRange(1, 2.2)).fill({ color: 0xfef08a, alpha: 0.95 })
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
    p.position.set(x + randRange(-3, 3), y + randRange(-3, 3))
    effectsLayer.addChild(p)
    gsap.to(p.scale, { x: 0.2, y: 0.2, duration: 0.4, ease: 'power1.in' })
    gsap.to(p, { alpha: 0, duration: 0.4, ease: 'power1.in', onComplete: () => p.destroy() })
}

export function spawnPowerUpBurst(effectsLayer: Container, world: Container, x: number, y: number, color: number) {
    for (let i = 0; i < 16; i++) {
        const p = new Graphics()
        p.star(0, 0, 4, randRange(3, 6), randRange(1, 2)).fill({ color, alpha: 0.95 })
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const angle = (i / 16) * Math.PI * 2 + randRange(-0.1, 0.1)
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
    effectsLayer.addChild(bolt)
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
    ring.circle(0, 0, 20).stroke({ width: 6, color, alpha: 0.9 })
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
