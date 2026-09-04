// Canvas drawing for the companion, its effects, and coins. Kept apart from
// the main renderer so the pet can grow without the sprite file growing.

import type { Companion } from './companion'
import type { Coin } from './engine'

type Ctx = CanvasRenderingContext2D

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
}

function shadow(ctx: Ctx, x: number, y: number, r: number, z: number) {
    const k = Math.max(0.35, 1 - z / 90)
    ctx.fillStyle = `rgba(20,30,12,${0.28 * k})`
    ellipse(ctx, x, y, r * (1.6 - (1 - k) * 0.4), r * 0.55)
    ctx.fill()
}

/**
 * Draws the pet at its projected screen position. `sx, sy` is the ground
 * point; the body is lifted by `c.z`. `ys` is the ground foreshortening.
 */
export function drawCompanion(ctx: Ctx, c: Companion, sx: number, sy: number, time: number) {
    const flip = Math.cos(c.facing) < 0 ? -1 : 1
    const squash = 1 + c.squash * 0.25
    ctx.save()
    shadow(ctx, sx, sy, c.id === 'tortoise' ? 14 : 11, c.z)
    ctx.translate(sx, sy - c.z)
    ctx.scale(flip * squash, 1 / squash)
    switch (c.id) {
        case 'fox': drawFox(ctx, c, time); break
        case 'tortoise': drawTortoise(ctx, c, time); break
        case 'owl': drawOwl(ctx, c, time); break
    }
    ctx.restore()

    // Ward bubble around the player is drawn by the renderer; the pet shows
    // a small charged glyph so the player knows it is up.
    if (c.ward) {
        ctx.save()
        ctx.globalAlpha = 0.7 + Math.sin(time * 6) * 0.2
        ctx.strokeStyle = '#b8f0a0'
        ctx.lineWidth = 2
        ellipse(ctx, sx, sy - c.z - 24, 16, 9)
        ctx.stroke()
        ctx.restore()
    }
}

function drawFox(ctx: Ctx, c: Companion, time: number) {
    const bob = c.moving ? Math.sin(c.anim * 2) * 1.5 : Math.sin(time * 2) * 0.6
    const legSwing = c.moving ? Math.sin(c.anim * 2) * 5 : 0
    // Tail of live coals, drawn first so the body overlaps it.
    ctx.save()
    ctx.translate(-12, -8 + bob)
    ctx.rotate(-0.5 + Math.sin(time * 3) * 0.15)
    const tail = ctx.createLinearGradient(0, 0, -20, 0)
    tail.addColorStop(0, '#e8722c')
    tail.addColorStop(0.7, '#ff9a3c')
    tail.addColorStop(1, '#ffd166')
    ctx.fillStyle = tail
    ellipse(ctx, -10, 0, 12, 5)
    ctx.fill()
    ctx.globalAlpha = 0.75
    ctx.fillStyle = '#ffe9a8'
    ellipse(ctx, -17, 0, 4, 2.5)
    ctx.fill()
    ctx.restore()
    // Legs.
    ctx.fillStyle = '#b8541f'
    ctx.fillRect(-7 + legSwing * 0.4, -6, 3, 7)
    ctx.fillRect(4 - legSwing * 0.4, -6, 3, 7)
    ctx.fillStyle = '#d9682a'
    ctx.fillRect(-4 - legSwing * 0.4, -7, 3, 8)
    ctx.fillRect(7 + legSwing * 0.4, -7, 3, 8)
    // Body.
    const body = ctx.createLinearGradient(0, -20, 0, -4)
    body.addColorStop(0, '#f2803a')
    body.addColorStop(1, '#c95a22')
    ctx.fillStyle = body
    ellipse(ctx, 0, -12 + bob, 13, 7)
    ctx.fill()
    ctx.fillStyle = '#fbe6cf'
    ellipse(ctx, 1, -9 + bob, 8, 3.5)
    ctx.fill()
    // Head.
    const howl = c.howl > 0 ? -0.7 : 0
    ctx.save()
    ctx.translate(11, -17 + bob)
    ctx.rotate(howl)
    ctx.fillStyle = '#ef7c36'
    ellipse(ctx, 0, 0, 7, 6)
    ctx.fill()
    ctx.fillStyle = '#fbe6cf'
    ellipse(ctx, 4, 2, 4, 2.5)
    ctx.fill()
    ctx.fillStyle = '#ef7c36'
    ctx.beginPath()
    ctx.moveTo(-5, -3)
    ctx.lineTo(-3, -12)
    ctx.lineTo(1, -4)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(1, -4)
    ctx.lineTo(4, -12)
    ctx.lineTo(6, -3)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#2a1408'
    ellipse(ctx, 7, 1, 1.6, 1.6)
    ctx.fill()
    ctx.fillStyle = '#1a1a1a'
    ellipse(ctx, 2, -1, 1.2, 1.4)
    ctx.fill()
    ctx.restore()
    // Ember glow.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.25 + Math.sin(time * 5) * 0.08
    const glow = ctx.createRadialGradient(-18, -8, 0, -18, -8, 18)
    glow.addColorStop(0, '#ffb347')
    glow.addColorStop(1, 'rgba(255,140,40,0)')
    ctx.fillStyle = glow
    ctx.fillRect(-36, -26, 36, 36)
    ctx.restore()
}

function drawTortoise(ctx: Ctx, c: Companion, time: number) {
    const step = c.moving ? Math.sin(c.anim) * 3 : 0
    // Legs.
    ctx.fillStyle = '#6a8a4c'
    ctx.fillRect(-11 + step, -5, 5, 6)
    ctx.fillRect(6 - step, -5, 5, 6)
    ctx.fillRect(-6 - step, -4, 5, 5)
    ctx.fillRect(2 + step, -4, 5, 5)
    // Shell.
    const shell = ctx.createRadialGradient(-3, -16, 2, 0, -12, 18)
    shell.addColorStop(0, '#9cc47a')
    shell.addColorStop(0.6, '#5f8f47')
    shell.addColorStop(1, '#3c6330')
    ctx.fillStyle = shell
    ellipse(ctx, 0, -11, 15, 10)
    ctx.fill()
    // Moss patches and plates.
    ctx.strokeStyle = 'rgba(30,60,25,0.5)'
    ctx.lineWidth = 1.2
    for (let i = -1; i <= 1; i++) {
        ellipse(ctx, i * 7, -12 + Math.abs(i) * 2, 4, 3.2)
        ctx.stroke()
    }
    ctx.fillStyle = '#b6d98a'
    ellipse(ctx, -5, -18, 4, 2)
    ctx.fill()
    ellipse(ctx, 6, -15, 3, 1.6)
    ctx.fill()
    // Tiny flower on the shell.
    ctx.fillStyle = '#ff8fb0'
    for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + time * 0.5
        ellipse(ctx, 3 + Math.cos(a) * 2.2, -20 + Math.sin(a) * 1.6, 1.4, 1.1)
        ctx.fill()
    }
    ctx.fillStyle = '#ffe066'
    ellipse(ctx, 3, -20, 1.1, 0.9)
    ctx.fill()
    // Head.
    ctx.fillStyle = '#7fa65a'
    ellipse(ctx, 15, -8 + Math.sin(time * 1.5) * 0.8, 5.5, 4.5)
    ctx.fill()
    ctx.fillStyle = '#1e2a14'
    ellipse(ctx, 17, -9, 1.3, 1.3)
    ctx.fill()
    // Bloom aura while mending.
    if (c.bloom > 0) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.35 + Math.sin(time * 8) * 0.1
        const g = ctx.createRadialGradient(0, -12, 2, 0, -12, 26)
        g.addColorStop(0, '#c9f5b0')
        g.addColorStop(1, 'rgba(140,220,120,0)')
        ctx.fillStyle = g
        ctx.fillRect(-30, -40, 60, 50)
        ctx.restore()
    }
}

function drawOwl(ctx: Ctx, c: Companion, time: number) {
    const flap = c.gust > 0 ? Math.sin(time * 40) * 0.9 : Math.sin(c.anim * 1.4) * 0.45
    // Wings.
    ctx.fillStyle = '#8d97c9'
    for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(side * 5, -12)
        ctx.rotate(side * (0.3 - flap))
        ctx.scale(side, 1)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(12, -10, 20, 0)
        ctx.quadraticCurveTo(12, 4, 0, 6)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
    }
    // Body.
    const body = ctx.createLinearGradient(0, -22, 0, -2)
    body.addColorStop(0, '#c4ccf5')
    body.addColorStop(1, '#7d86b8')
    ctx.fillStyle = body
    ellipse(ctx, 0, -11, 8, 10)
    ctx.fill()
    ctx.fillStyle = '#e8ecff'
    ellipse(ctx, 0, -8, 5, 6)
    ctx.fill()
    // Face disc, eyes, beak.
    ctx.fillStyle = '#f2f4ff'
    ellipse(ctx, 0, -18, 7.5, 5.5)
    ctx.fill()
    ctx.fillStyle = '#ffd166'
    ellipse(ctx, -3, -18.5, 2.4, 2.4)
    ctx.fill()
    ellipse(ctx, 3, -18.5, 2.4, 2.4)
    ctx.fill()
    ctx.fillStyle = '#1a1a2a'
    ellipse(ctx, -3, -18.5, 1.1, 1.1)
    ctx.fill()
    ellipse(ctx, 3, -18.5, 1.1, 1.1)
    ctx.fill()
    ctx.fillStyle = '#e0a13c'
    ctx.beginPath()
    ctx.moveTo(-1.5, -16)
    ctx.lineTo(1.5, -16)
    ctx.lineTo(0, -13)
    ctx.closePath()
    ctx.fill()
    // Ear tufts.
    ctx.fillStyle = '#8d97c9'
    ctx.beginPath()
    ctx.moveTo(-6, -21)
    ctx.lineTo(-7, -27)
    ctx.lineTo(-2, -22)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(6, -21)
    ctx.lineTo(7, -27)
    ctx.lineTo(2, -22)
    ctx.closePath()
    ctx.fill()
    // Moon-glow.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.18 + Math.sin(time * 2) * 0.05
    const g = ctx.createRadialGradient(0, -12, 2, 0, -12, 24)
    g.addColorStop(0, '#dfe6ff')
    g.addColorStop(1, 'rgba(180,190,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-28, -40, 56, 50)
    ctx.restore()
}

/** Burning ground left by Flame Dash (ground layer, before sprites). */
export function drawFireTrail(ctx: Ctx, x: number, y: number, r: number, k: number, time: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const flicker = 0.75 + Math.sin(time * 14 + x) * 0.25
    ctx.globalAlpha = Math.min(1, k * 1.4) * flicker
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, '#ffd27a')
    g.addColorStop(0.45, '#ff8c2a')
    g.addColorStop(1, 'rgba(255,80,20,0)')
    ctx.fillStyle = g
    ellipse(ctx, x, y, r, r * 0.55)
    ctx.fill()
    ctx.restore()
}

/** A lucky feather drifting in place. */
export function drawFeather(ctx: Ctx, sx: number, sy: number, z: number, time: number, taken: boolean, life: number) {
    ctx.save()
    if (taken) ctx.globalAlpha = Math.max(0, life / 0.5)
    shadow(ctx, sx, sy, 6, z)
    ctx.translate(sx, sy - z)
    ctx.rotate(Math.sin(time * 2.5) * 0.35 - 0.6)
    ctx.fillStyle = '#e9edff'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(10, -6, 20, -2)
    ctx.quadraticCurveTo(10, 4, 0, 0)
    ctx.fill()
    ctx.strokeStyle = '#9aa6e6'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(19, -2)
    ctx.stroke()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha *= 0.5 + Math.sin(time * 6) * 0.2
    const g = ctx.createRadialGradient(10, -2, 1, 10, -2, 18)
    g.addColorStop(0, '#dfe6ff')
    g.addColorStop(1, 'rgba(200,210,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-10, -22, 40, 40)
    ctx.restore()
}

/** A dropped coin: a small spinning gold disc with a glint. */
export function drawCoin(ctx: Ctx, coin: Coin, sx: number, sy: number, time: number) {
    const spin = Math.cos(time * 7 + coin.seed * 6)
    const w = Math.max(1.5, Math.abs(spin) * coin.size)
    ctx.save()
    if (coin.z < 6) shadow(ctx, sx, sy, coin.size * 0.7, coin.z)
    ctx.translate(sx, sy - coin.z)
    const g = ctx.createLinearGradient(-w, -coin.size, w, coin.size)
    g.addColorStop(0, '#fff1b8')
    g.addColorStop(0.5, '#f2c14e')
    g.addColorStop(1, '#a86f16')
    ctx.fillStyle = g
    ellipse(ctx, 0, 0, w, coin.size)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,80,10,0.6)'
    ctx.lineWidth = 1
    ctx.stroke()
    if (w > coin.size * 0.5) {
        ctx.strokeStyle = 'rgba(255,240,200,0.7)'
        ellipse(ctx, 0, 0, w * 0.55, coin.size * 0.55)
        ctx.stroke()
    }
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.35 + Math.max(0, spin) * 0.3
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, coin.size * 2.2)
    glow.addColorStop(0, '#ffe38a')
    glow.addColorStop(1, 'rgba(255,200,80,0)')
    ctx.fillStyle = glow
    ctx.fillRect(-coin.size * 2.2, -coin.size * 2.2, coin.size * 4.4, coin.size * 4.4)
    ctx.restore()
}
