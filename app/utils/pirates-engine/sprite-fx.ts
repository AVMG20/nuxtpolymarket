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
    const frac = Math.max(0, enemy.hp / enemy.maxHp)
    enemy.hpBarFill.clear()
    enemy.hpBarFill.roundRect(0, 0, enemy.hpBarWidth * frac, 7, 3)
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
    for (let i = 0; i < 6; i++) {
        const p = new Graphics()
        p.circle(0, 0, 2 + Math.random() * 2).fill({ color: 0xdbeafe, alpha: 0.8 })
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const ang = Math.random() * Math.PI * 2
        const r = 18 + Math.random() * 22
        gsap.to(p.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r, duration: 0.4, ease: 'power2.out' })
        gsap.to(p, { alpha: 0, duration: 0.4, ease: 'power2.in', onComplete: () => p.destroy() })
    }
    const ring = new Graphics()
    ring.circle(0, 0, 8).stroke({ width: 2, color: 0xbfdbfe, alpha: 0.7 })
    ring.position.set(x, y)
    effectsLayer.addChild(ring)
    gsap.to(ring.scale, { x: 3, y: 3, duration: 0.5, ease: 'power2.out' })
    gsap.to(ring, { alpha: 0, duration: 0.5, ease: 'power2.out', onComplete: () => ring.destroy() })
}

export function spawnExplosion(effectsLayer: Container, x: number, y: number, color: number, big: boolean) {
    const count = big ? 10 : 6
    for (let i = 0; i < count; i++) {
        const p = new Graphics()
        p.circle(0, 0, big ? 3 + Math.random() * 3 : 2 + Math.random() * 2).fill({ color, alpha: 0.9 })
        p.position.set(x, y)
        effectsLayer.addChild(p)
        const ang = Math.random() * Math.PI * 2
        const r = (big ? 30 : 20) + Math.random() * 26
        gsap.to(p.position, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r - 10, duration: 0.45, ease: 'power3.out' })
        gsap.to(p, { alpha: 0, duration: 0.45, ease: 'power2.in', onComplete: () => p.destroy() })
    }
    const flash = new Graphics()
    flash.circle(0, 0, big ? 18 : 12).fill({ color: 0xffffff, alpha: 0.85 })
    flash.position.set(x, y)
    effectsLayer.addChild(flash)
    gsap.to(flash.scale, { x: 1.8, y: 1.8, duration: 0.18, ease: 'power2.out' })
    gsap.to(flash, { alpha: 0, duration: 0.18, ease: 'power2.out', onComplete: () => flash.destroy() })
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
    gsap.to(flash, { alpha: 0, duration: 0.14, ease: 'power2.out', onComplete: () => flash.destroy() })

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
