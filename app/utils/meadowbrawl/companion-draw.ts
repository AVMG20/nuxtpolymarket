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
    ctx.fillStyle = `rgba(28,37,46,${0.22 * k})`
    ellipse(ctx, x, y, r * (1.6 - (1 - k) * 0.4), r * 0.55)
    ctx.fill()
    ctx.fillStyle = `rgba(23,31,38,${0.16 * k})`
    ellipse(ctx, x, y, r * k, r * 0.3 * k)
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
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.75
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
    // Counter the facing mirror so the key light stays on screen-left.
    const light = Math.cos(c.facing) < 0 ? -1 : 1
    // Tail of live coals, drawn first so the body overlaps it.
    ctx.save()
    ctx.translate(-12, -8 + bob)
    ctx.rotate(-0.5 + Math.sin(time * 3) * 0.15)
    const tail = ctx.createLinearGradient(-12 - light * 8, -6, -12 + light * 8, 6)
    tail.addColorStop(0, '#ffe1a0')
    tail.addColorStop(0.3, '#ef9b47')
    tail.addColorStop(0.65, '#d36330')
    tail.addColorStop(1, '#74443f')
    ctx.fillStyle = tail
    ctx.strokeStyle = '#503831'
    ctx.beginPath()
    ctx.moveTo(1, 1)
    ctx.bezierCurveTo(-5, -5, -11, -6, -16, -3)
    ctx.lineTo(-15, -5.5)
    ctx.quadraticCurveTo(-20, -4, -23, -5)
    ctx.quadraticCurveTo(-22, 0, -18, 3)
    ctx.lineTo(-20, 3)
    ctx.quadraticCurveTo(-14, 7, -9, 5)
    ctx.lineTo(-10, 6)
    ctx.quadraticCurveTo(-3, 5, 1, 1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff0c7'
    ctx.beginPath()
    ctx.moveTo(-23, -5)
    ctx.quadraticCurveTo(-20, -4, -15, -5.5)
    ctx.lineTo(-16, -3)
    ctx.lineTo(-12, -3.4)
    ctx.lineTo(-15, -0.8)
    ctx.lineTo(-11, 0.2)
    ctx.lineTo(-15, 1.6)
    ctx.lineTo(-13, 3.8)
    ctx.quadraticCurveTo(-20, 3, -23, -5)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#ffd194'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(-11, -2.7)
    ctx.quadraticCurveTo(-6, -2.8, -2, 0)
    ctx.moveTo(-12, 3.2)
    ctx.quadraticCurveTo(-7, 3.3, -4, 1.8)
    ctx.stroke()
    ctx.restore()
    // Tapered hocks and dark stockings, with the far pair in cool shade.
    for (let i = 0; i < 4; i++) {
        const near = i > 1
        const x = (i % 2 === 0 ? -6 : 5) + (near ? 3 : 0)
            + legSwing * (i === 0 || i === 3 ? 0.4 : -0.4)
        ctx.fillStyle = near ? '#d77b3d' : '#8e5140'
        ctx.strokeStyle = '#493738'
        ctx.beginPath()
        ctx.moveTo(x - 1.8, -9 + bob)
        ctx.lineTo(x + 2, -8 + bob)
        ctx.lineTo(x + 1, -2)
        ctx.quadraticCurveTo(x + 3.5, -1.5, x + 2.7, 0.8)
        ctx.lineTo(x - 1.7, 0.8)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = near ? '#55403e' : '#39333b'
        ctx.beginPath()
        ctx.moveTo(x - 1.6, -3.6)
        ctx.lineTo(x + 1.3, -3)
        ctx.lineTo(x + 1, -2)
        ctx.quadraticCurveTo(x + 3.5, -1.5, x + 2.7, 0.6)
        ctx.lineTo(x - 1.6, 0.6)
        ctx.closePath()
        ctx.fill()
        if (near) {
            ctx.strokeStyle = '#b89a80'
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(x, -0.6)
            ctx.lineTo(x, 0.2)
            ctx.moveTo(x + 1.3, -0.6)
            ctx.lineTo(x + 1.3, 0.2)
            ctx.stroke()
            ctx.lineWidth = 0.75
        }
    }
    // Body.
    const body = ctx.createLinearGradient(-9 * light, -20, 8 * light, -4)
    body.addColorStop(0, '#ffd08a')
    body.addColorStop(0.3, '#e99348')
    body.addColorStop(0.7, '#c46836')
    body.addColorStop(1, '#76504a')
    ctx.fillStyle = body
    ctx.strokeStyle = '#503831'
    ctx.beginPath()
    ctx.moveTo(-13, -11 + bob)
    ctx.bezierCurveTo(-13, -19 + bob, -2, -21 + bob, 7, -17 + bob)
    ctx.quadraticCurveTo(14, -16 + bob, 12, -9 + bob)
    ctx.quadraticCurveTo(5, -3 + bob, -5, -6 + bob)
    ctx.quadraticCurveTo(-11, -5 + bob, -13, -11 + bob)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#c9b6a4'
    ctx.beginPath()
    ctx.moveTo(-7, -9 + bob)
    ctx.quadraticCurveTo(3, -7 + bob, 9, -13 + bob)
    ctx.lineTo(10, -7 + bob)
    ctx.quadraticCurveTo(0, -3 + bob, -7, -9 + bob)
    ctx.fill()
    ctx.strokeStyle = '#ffdda4'
    ctx.lineWidth = 0.65
    ctx.beginPath()
    ctx.moveTo(-10, -15 + bob)
    ctx.quadraticCurveTo(-6, -18.5 + bob, 0, -17.5 + bob)
    ctx.stroke()
    // Pointed cream ruff breaks up the shoulder instead of reading as a bib.
    const ruff = ctx.createLinearGradient(3, -17, 10, -5)
    ruff.addColorStop(0, '#fff2d5')
    ruff.addColorStop(1, '#b5a99e')
    ctx.fillStyle = ruff
    ctx.strokeStyle = '#785e4f'
    ctx.beginPath()
    ctx.moveTo(5, -18 + bob)
    ctx.lineTo(12, -17 + bob)
    ctx.quadraticCurveTo(15, -12 + bob, 11, -8 + bob)
    ctx.lineTo(9, -5 + bob)
    ctx.lineTo(7.8, -7.5 + bob)
    ctx.lineTo(5, -6 + bob)
    ctx.lineTo(5.2, -9 + bob)
    ctx.lineTo(2.5, -8.5 + bob)
    ctx.lineTo(4, -12 + bob)
    ctx.lineTo(2.5, -13 + bob)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Head.
    const howl = c.howl > 0 ? -0.7 : 0
    ctx.save()
    ctx.translate(11, -17 + bob)
    ctx.rotate(howl)
    ctx.lineWidth = 0.75
    for (let i = 0; i < 2; i++) {
        const x = i * 6 - 3
        ctx.fillStyle = i === 0 ? '#b56842' : '#e79a55'
        ctx.strokeStyle = '#503831'
        ctx.beginPath()
        ctx.moveTo(x - 2.5, -3)
        ctx.lineTo(x, -12)
        ctx.quadraticCurveTo(x + 2.8, -9, x + 3, -3)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#63434a'
        ctx.beginPath()
        ctx.moveTo(x - 0.9, -5)
        ctx.lineTo(x, -10)
        ctx.lineTo(x + 1.8, -5)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#f6c28c'
        ctx.lineWidth = 0.55
        ctx.beginPath()
        ctx.moveTo(x - 1.7, -5.5)
        ctx.lineTo(x - 0.2, -10.5)
        ctx.stroke()
        ctx.lineWidth = 0.75
    }
    const face = ctx.createLinearGradient(-5 * light, -6, 6 * light, 5)
    face.addColorStop(0, '#ffcb81')
    face.addColorStop(0.5, '#e58a42')
    face.addColorStop(1, '#a35b3e')
    ctx.fillStyle = face
    ctx.strokeStyle = '#503831'
    ctx.beginPath()
    ctx.moveTo(-6, -3)
    ctx.quadraticCurveTo(-1, -7, 4, -4)
    ctx.quadraticCurveTo(5.5, -2.5, 6, -0.5)
    ctx.lineTo(8, 0.7)
    ctx.lineTo(7, 3)
    ctx.quadraticCurveTo(3, 6, -2, 5)
    ctx.lineTo(-5, 6)
    ctx.lineTo(-4.5, 3.8)
    ctx.lineTo(-7, 3)
    ctx.lineTo(-5.5, 1.2)
    ctx.lineTo(-7, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff0d4'
    ctx.beginPath()
    ctx.moveTo(-6, 0.4)
    ctx.quadraticCurveTo(-1, 2.5, 2, 0.8)
    ctx.quadraticCurveTo(4, -0.2, 7.6, 1)
    ctx.lineTo(6.5, 3.3)
    ctx.quadraticCurveTo(1.5, 5.4, -4.5, 4.5)
    ctx.lineTo(-3.8, 3)
    ctx.lineTo(-6, 2.3)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#372f35'
    ellipse(ctx, 7.1, 0.9, 1.35, 1.05)
    ctx.fill()
    ctx.fillStyle = '#ffe0a1'
    ellipse(ctx, 2, -1.2, 1.75, 1.8)
    ctx.fill()
    ctx.fillStyle = '#302c32'
    ellipse(ctx, 2.4, -1.1, 0.95, 1.35)
    ctx.fill()
    ctx.fillStyle = '#fff8e5'
    ellipse(ctx, 2.4 - light * 0.45, -1.8, 0.4, 0.45)
    ctx.fill()
    ellipse(ctx, 6.7, 0.45, 0.45, 0.25)
    ctx.fill()
    ctx.strokeStyle = '#513a36'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(0.1, -3)
    ctx.quadraticCurveTo(1.5, -4, 3.1, -3.4)
    ctx.moveTo(6.8, 2)
    ctx.quadraticCurveTo(5, 3.5, 3.5, 2.9)
    ctx.stroke()
    if (c.howl > 0) {
        ctx.fillStyle = '#4b303a'
        ellipse(ctx, 5.7, 3, 1.1, 1.3)
        ctx.fill()
        ctx.fillStyle = '#d9938e'
        ellipse(ctx, 5.7, 3.6, 0.65, 0.4)
        ctx.fill()
    }
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
    const light = Math.cos(c.facing) < 0 ? -1 : 1
    ctx.fillStyle = '#617e64'
    ctx.strokeStyle = '#344b43'
    ctx.beginPath()
    ctx.moveTo(-12, -7)
    ctx.lineTo(-16, -4)
    ctx.quadraticCurveTo(-13, -3, -11, -4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Pebbled feet and ivory claws sit below the overhanging shell lip.
    for (let i = 0; i < 4; i++) {
        const near = i > 1
        const x = (i % 2 === 0 ? -8.5 : 8.5) + (near ? (i === 2 ? 5 : -4) : 0)
            + step * (i === 0 || i === 3 ? 1 : -1)
        ctx.fillStyle = near ? '#9cab78' : '#5d7768'
        ctx.strokeStyle = '#344b43'
        ctx.beginPath()
        ctx.moveTo(x - 2.4, -7)
        ctx.quadraticCurveTo(x + 2.3, -8, x + 2.7, -3)
        ctx.lineTo(x + 2.4, 0.3)
        ctx.quadraticCurveTo(x, 1.8, x - 2.6, 0.2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = near ? '#d6d6a0' : '#91a087'
        ellipse(ctx, x - 0.8, -3.4, 0.8, 0.65)
        ctx.fill()
        ellipse(ctx, x + 1, -2.6, 0.65, 0.5)
        ctx.fill()
        ctx.strokeStyle = '#e4d6ab'
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(x - 1.2, -0.5)
        ctx.lineTo(x - 1.4, 0.4)
        ctx.moveTo(x + 0.5, -0.4)
        ctx.lineTo(x + 0.6, 0.5)
        ctx.stroke()
    }
    // Dark rim, domed scutes, then raised bevels on the sunward seams.
    ctx.fillStyle = '#445b50'
    ctx.strokeStyle = '#30453d'
    ctx.lineWidth = 0.85
    ellipse(ctx, 0, -9, 15, 7.5)
    ctx.fill()
    ctx.stroke()
    const shell = ctx.createRadialGradient(-6 * light, -18, 1, 0, -11, 19)
    shell.addColorStop(0, '#d5d49a')
    shell.addColorStop(0.35, '#98ac70')
    shell.addColorStop(0.7, '#617e5b')
    shell.addColorStop(1, '#344f49')
    ctx.fillStyle = shell
    ellipse(ctx, 0, -11, 15, 10)
    ctx.fill()
    ctx.stroke()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(220,222,163,0.3)'
    ctx.beginPath()
    ctx.moveTo(-13, -16)
    ctx.lineTo(-5, -18)
    ctx.lineTo(-6, -12)
    ctx.lineTo(-12, -9)
    ctx.closePath()
    ctx.moveTo(-5, -18)
    ctx.lineTo(0, -21)
    ctx.lineTo(6, -18)
    ctx.lineTo(0, -15)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(36,67,63,0.3)'
    ctx.beginPath()
    ctx.moveTo(0, -6)
    ctx.lineTo(6, -12)
    ctx.lineTo(12, -9)
    ctx.lineTo(9, -3)
    ctx.lineTo(0, -1)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#3e5946'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(-5, -18)
    ctx.lineTo(0, -20)
    ctx.lineTo(6, -18)
    ctx.lineTo(6, -12)
    ctx.lineTo(0, -8)
    ctx.lineTo(-6, -12)
    ctx.closePath()
    ctx.moveTo(-5, -18)
    ctx.lineTo(-13, -17)
    ctx.moveTo(6, -18)
    ctx.lineTo(13, -16)
    ctx.moveTo(-6, -12)
    ctx.lineTo(-12, -9)
    ctx.lineTo(-15, -11)
    ctx.moveTo(6, -12)
    ctx.lineTo(12, -9)
    ctx.lineTo(15, -11)
    ctx.moveTo(-12, -9)
    ctx.lineTo(-9, -3)
    ctx.moveTo(12, -9)
    ctx.lineTo(9, -3)
    ctx.moveTo(0, -8)
    ctx.lineTo(0, -1)
    ctx.stroke()
    ctx.strokeStyle = '#c2cf92'
    ctx.lineWidth = 0.65
    ctx.beginPath()
    ctx.moveTo(-4.5, -17.2)
    ctx.lineTo(0, -19.1)
    ctx.lineTo(5, -17.4)
    ctx.moveTo(-11.7, -8)
    ctx.lineTo(-6, -10.9)
    ctx.lineTo(-0.8, -7.5)
    ctx.moveTo(1, -7.5)
    ctx.lineTo(6.2, -10.9)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(220,222,166,0.4)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(-3.3, -15.7)
    ctx.lineTo(0, -17)
    ctx.lineTo(3.8, -15.7)
    ctx.moveTo(-3, -14)
    ctx.lineTo(0, -15.1)
    ctx.lineTo(3.5, -14)
    ctx.stroke()
    ctx.strokeStyle = '#b2b982'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(0, -11, 14, 8.4, 0, 0.13, Math.PI - 0.13)
    ctx.stroke()
    ctx.restore()
    // Moss cushions carry a tiny fern and the animated garden flower.
    for (let i = -1; i <= 1; i++) {
        const x = i * 5 - 3
        const y = -18.5 + Math.abs(i) * 1.5
        ctx.fillStyle = '#466e50'
        ellipse(ctx, x, y, 3.2, 1.7)
        ctx.fill()
        ctx.fillStyle = i === 0 ? '#b4c886' : '#8fab6b'
        ellipse(ctx, x - 0.6, y - 0.6, 2.5, 1.3)
        ctx.fill()
        ctx.strokeStyle = '#d3dca0'
        ctx.lineWidth = 0.55
        ctx.beginPath()
        ctx.moveTo(x - 1.7, y - 0.6)
        ctx.lineTo(x - 1.2, y - 1.4)
        ctx.moveTo(x + 0.2, y - 0.6)
        ctx.lineTo(x + 0.6, y - 1.1)
        ctx.stroke()
    }
    ctx.strokeStyle = '#4c7550'
    ctx.lineWidth = 0.65
    ctx.beginPath()
    ctx.moveTo(-5, -18)
    ctx.quadraticCurveTo(-7, -20.5, -6, -23)
    ctx.moveTo(3, -17)
    ctx.quadraticCurveTo(1.5, -18.5, 3, -20)
    ctx.stroke()
    ctx.fillStyle = '#97b776'
    ctx.beginPath()
    ctx.moveTo(-6, -19.5)
    ctx.quadraticCurveTo(-10, -19, -9, -21.8)
    ctx.quadraticCurveTo(-6.5, -21.5, -6, -19.5)
    ctx.moveTo(-6.5, -21)
    ctx.quadraticCurveTo(-4, -23.5, -3.7, -21.7)
    ctx.quadraticCurveTo(-4.5, -20.2, -6.5, -21)
    ctx.fill()
    for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + time * 0.5
        ctx.fillStyle = i < 2 ? '#ffe1d2' : '#d98a9d'
        ctx.strokeStyle = '#9b6374'
        ctx.lineWidth = 0.4
        ellipse(ctx, 3 + Math.cos(a) * 2.2, -20 + Math.sin(a) * 1.6, 1.4, 1.1)
        ctx.fill()
        ctx.stroke()
    }
    ctx.fillStyle = '#f8d27b'
    ellipse(ctx, 3, -20, 1.1, 0.9)
    ctx.fill()
    ctx.fillStyle = '#fff1ba'
    ellipse(ctx, 2.7, -20.3, 0.4, 0.3)
    ctx.fill()
    // Head details share the breathing transform so the face never slides.
    ctx.save()
    ctx.translate(15, -8 + Math.sin(time * 1.5) * 0.8)
    const skin = ctx.createLinearGradient(-4 * light, -5, 4 * light, 4)
    skin.addColorStop(0, '#d7d59b')
    skin.addColorStop(0.45, '#aaba80')
    skin.addColorStop(1, '#5e826c')
    ctx.fillStyle = skin
    ctx.strokeStyle = '#3a5346'
    ctx.lineWidth = 0.75
    ctx.beginPath()
    ctx.moveTo(-5, -1.8)
    ctx.bezierCurveTo(-4, -6, 3, -5.4, 4.8, -1.6)
    ctx.quadraticCurveTo(6.5, 0, 4.2, 2.2)
    ctx.quadraticCurveTo(0.6, 5.1, -4.5, 3)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#cfce9b'
    ellipse(ctx, 1.2, 2.1, 3, 1.1)
    ctx.fill()
    ctx.fillStyle = '#34463c'
    ellipse(ctx, 2, -1, 1.4, 1.5)
    ctx.fill()
    ctx.fillStyle = '#fff4d2'
    ellipse(ctx, 2 - light * 0.45, -1.6, 0.45, 0.5)
    ctx.fill()
    ctx.fillStyle = '#738d65'
    ellipse(ctx, -2, -2.5, 0.9, 0.6)
    ctx.fill()
    ellipse(ctx, -3.5, -1, 0.65, 0.5)
    ctx.fill()
    ctx.strokeStyle = '#4a6350'
    ctx.lineWidth = 0.55
    ctx.beginPath()
    ctx.moveTo(0.8, -3.2)
    ctx.quadraticCurveTo(2, -3.8, 3.1, -3.1)
    ctx.moveTo(4.8, 0.8)
    ctx.quadraticCurveTo(3, 2.5, 1.5, 1.5)
    ctx.moveTo(4.5, -0.6)
    ctx.lineTo(4.7, -0.5)
    ctx.stroke()
    ctx.restore()
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
    const light = Math.cos(c.facing) < 0 ? -1 : 1
    // A short barred fan remains tucked inside the body's ground footprint.
    ctx.fillStyle = '#77738f'
    ctx.strokeStyle = '#414354'
    ctx.beginPath()
    ctx.moveTo(-4, -8)
    ctx.lineTo(4, -8)
    ctx.lineTo(5, -0.8)
    ctx.quadraticCurveTo(3, 1, 1.7, -0.3)
    ctx.quadraticCurveTo(0, 1.5, -1.7, -0.3)
    ctx.quadraticCurveTo(-3, 1, -5, -0.8)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = '#c5bdd1'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(-4.5, -2)
    ctx.quadraticCurveTo(0, -0.7, 4.5, -2)
    ctx.moveTo(-4.2, -4.2)
    ctx.quadraticCurveTo(0, -3, 4.2, -4.2)
    ctx.stroke()
    // Scalloped primaries, barred vanes and a separate overlapping covert layer.
    for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(side * 5, -12)
        ctx.rotate(side * (0.3 - flap))
        ctx.scale(side, 1)
        const wing = ctx.createLinearGradient(side * light < 0 ? 18 : 0, -5, side * light < 0 ? 0 : 18, 6)
        wing.addColorStop(0, '#ddd4e0')
        wing.addColorStop(0.4, '#a9a2c0')
        wing.addColorStop(1, '#626780')
        ctx.fillStyle = wing
        ctx.strokeStyle = '#444555'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(6, -6, 15, -6, 20, 0)
        ctx.quadraticCurveTo(20, 1.3, 17, 1.2)
        ctx.quadraticCurveTo(19, 3.3, 14.7, 3)
        ctx.quadraticCurveTo(15.6, 5, 11.5, 4.5)
        ctx.quadraticCurveTo(11.5, 6, 8, 5.4)
        ctx.quadraticCurveTo(4, 7, 0, 6)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.save()
        ctx.clip()
        ctx.strokeStyle = '#626078'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(7, -3.5)
        ctx.quadraticCurveTo(10, 0, 9, 6)
        ctx.moveTo(12, -4)
        ctx.quadraticCurveTo(15, -1, 15, 4)
        ctx.stroke()
        ctx.strokeStyle = '#ece0e2'
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(8.4, -3.5)
        ctx.quadraticCurveTo(11.2, 0, 10.5, 6)
        ctx.moveTo(13.4, -4)
        ctx.quadraticCurveTo(16.4, -1, 16.4, 3)
        ctx.stroke()
        ctx.restore()
        ctx.strokeStyle = '#68687f'
        ctx.lineWidth = 0.55
        ctx.beginPath()
        for (let i = 0; i < 4; i++) {
            ctx.moveTo(3 + i * 1.4, -1.4)
            ctx.quadraticCurveTo(7 + i * 2, 1.8 - i, 8 + i * 3, 5.2 - i * 1.3)
        }
        ctx.stroke()
        ctx.fillStyle = side * light < 0 ? '#ccc4d8' : '#a7a2bf'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.quadraticCurveTo(7, -5.7, 13, -3.3)
        ctx.quadraticCurveTo(12, -0.5, 9.5, -0.8)
        ctx.quadraticCurveTo(8, 2, 6.3, 1)
        ctx.quadraticCurveTo(4.3, 3.5, 0, 3.8)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = '#f1e2de'
        ctx.lineWidth = 0.65
        ctx.beginPath()
        ctx.moveTo(2, -1.3)
        ctx.quadraticCurveTo(6.5, -4.1, 10.3, -3.6)
        ctx.stroke()
        ctx.restore()
    }
    // Body.
    const body = ctx.createLinearGradient(-7 * light, -22, 7 * light, -2)
    body.addColorStop(0, '#e6dce5')
    body.addColorStop(0.35, '#bcb4cd')
    body.addColorStop(0.7, '#9695b3')
    body.addColorStop(1, '#606d89')
    ctx.fillStyle = body
    ctx.strokeStyle = '#454657'
    ctx.lineWidth = 0.8
    ellipse(ctx, 0, -11, 8, 10)
    ctx.fill()
    ctx.stroke()
    const breast = ctx.createLinearGradient(-4 * light, -14, 4 * light, -2)
    breast.addColorStop(0, '#f9eddf')
    breast.addColorStop(0.6, '#d9d0df')
    breast.addColorStop(1, '#aaaac3')
    ctx.fillStyle = breast
    ctx.beginPath()
    ctx.moveTo(-5.6, -14)
    ctx.quadraticCurveTo(0, -16, 5.6, -14)
    ctx.quadraticCurveTo(6.5, -9, 3.5, -3.5)
    ctx.lineTo(2, -4.2)
    ctx.lineTo(0, -2)
    ctx.lineTo(-2, -4.2)
    ctx.lineTo(-3.5, -3.5)
    ctx.quadraticCurveTo(-6.5, -9, -5.6, -14)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#9790ad'
    ctx.lineWidth = 0.65
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
        const y = -11.5 + i * 2.7
        const x = 3.7 - i * 0.65
        ctx.moveTo(-x, y)
        ctx.quadraticCurveTo(-x + 0.7, y + 1.7, -x + 1.6, y + 0.6)
        ctx.moveTo(x - 1.6, y + 0.6)
        ctx.quadraticCurveTo(x - 0.7, y + 1.7, x, y)
    }
    ctx.stroke()
    // Tufts sit behind a dark heart-shaped facial ruff.
    for (const side of [-1, 1]) {
        ctx.fillStyle = side * light < 0 ? '#c6bbd0' : '#8b86a5'
        ctx.strokeStyle = '#454657'
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(side * 2, -22)
        ctx.lineTo(side * 7, -27)
        ctx.lineTo(side * 6.2, -23.8)
        ctx.lineTo(side * 7.5, -24.6)
        ctx.lineTo(side * 6.5, -19)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = '#f1e2de'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(side * 4, -22)
        ctx.lineTo(side * 6.2, -25.2)
        ctx.stroke()
    }
    ctx.fillStyle = '#77728e'
    ctx.strokeStyle = '#454657'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0, -22)
    ctx.bezierCurveTo(-7, -27, -11, -18, -5, -13.7)
    ctx.quadraticCurveTo(-2.5, -12, 0, -11.6)
    ctx.quadraticCurveTo(2.5, -12, 5, -13.7)
    ctx.bezierCurveTo(11, -18, 7, -27, 0, -22)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    const disc = ctx.createLinearGradient(-6 * light, -23, 6 * light, -12)
    disc.addColorStop(0, '#fff3df')
    disc.addColorStop(0.6, '#e8e0e8')
    disc.addColorStop(1, '#b5b7d0')
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.moveTo(0, -20.8)
    ctx.bezierCurveTo(-5.5, -26, -9.5, -18.7, -4.7, -14.7)
    ctx.quadraticCurveTo(-2.1, -13, 0, -12.6)
    ctx.quadraticCurveTo(2.1, -13, 4.7, -14.7)
    ctx.bezierCurveTo(9.5, -18.7, 5.5, -26, 0, -20.8)
    ctx.closePath()
    ctx.fill()
    for (const side of [-1, 1]) {
        ctx.strokeStyle = '#b4a8bd'
        ctx.lineWidth = 0.55
        ctx.beginPath()
        ctx.moveTo(side * 6.2, -19.5)
        ctx.quadraticCurveTo(side * 7.6, -16.5, side * 3, -14.4)
        ctx.stroke()
        ctx.fillStyle = '#70667c'
        ellipse(ctx, side * 3, -18.5, 2.65, 2.75)
        ctx.fill()
        ctx.fillStyle = '#e8bf7d'
        ellipse(ctx, side * 3, -18.4, 2.15, 2.25)
        ctx.fill()
        ctx.fillStyle = '#fae1aa'
        ellipse(ctx, side * 3 - light * 0.4, -19, 1.5, 1.4)
        ctx.fill()
        ctx.fillStyle = '#303344'
        ellipse(ctx, side * 3 + 0.15, -18.3, 1.25, 1.65)
        ctx.fill()
        ctx.fillStyle = '#fffaeb'
        ellipse(ctx, side * 3 - light * 0.45, -19.1, 0.6, 0.6)
        ctx.fill()
        ellipse(ctx, side * 3 + light * 0.6, -17.8, 0.25, 0.25)
        ctx.fill()
        ctx.strokeStyle = '#f9ecdd'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(side * 0.8, -20.7)
        ctx.quadraticCurveTo(side * 3.3, -22.2, side * 5.1, -21)
        ctx.stroke()
    }
    ctx.fillStyle = '#b99567'
    ctx.strokeStyle = '#5e5262'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(0, -17)
    ctx.lineTo(1.5, -15.8)
    ctx.lineTo(0, -13)
    ctx.lineTo(-1.5, -15.8)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = '#ffe3a8'
    ctx.beginPath()
    ctx.moveTo(-0.5 * light, -15.8)
    ctx.lineTo(0, -14.3)
    ctx.stroke()
    // Paired hooked toes, kept at the old body's baseline.
    for (const side of [-1, 1]) {
        ctx.strokeStyle = '#514954'
        ctx.lineWidth = 1.7
        ctx.beginPath()
        ctx.moveTo(side * 2.2, -2.1)
        ctx.quadraticCurveTo(side * 1.4, 0.6, side * 2.7, 0.4)
        ctx.moveTo(side * 3.7, -2.4)
        ctx.quadraticCurveTo(side * 3.1, 0.2, side * 4.2, -0.1)
        ctx.stroke()
        ctx.strokeStyle = '#d9c69f'
        ctx.lineWidth = 0.8
        ctx.stroke()
    }
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
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const vane = ctx.createLinearGradient(7, -4, 12, 2)
    vane.addColorStop(0, '#fff3df')
    vane.addColorStop(0.4, '#ded9ed')
    vane.addColorStop(1, '#8b91b7')
    ctx.fillStyle = vane
    ctx.strokeStyle = '#616781'
    ctx.lineWidth = 0.55
    ctx.beginPath()
    ctx.moveTo(2.3, -0.2)
    ctx.quadraticCurveTo(3.5, -2.3, 7, -3.2)
    ctx.lineTo(6.7, -2.3)
    ctx.lineTo(8.5, -3.5)
    ctx.quadraticCurveTo(14, -4.2, 20, -2)
    ctx.quadraticCurveTo(17, -1.8, 14.8, 0.1)
    ctx.lineTo(13.2, -0.2)
    ctx.lineTo(13.6, 0.7)
    ctx.quadraticCurveTo(10, 2, 6.5, 1)
    ctx.lineTo(7, 0.3)
    ctx.lineTo(5, 0.8)
    ctx.quadraticCurveTo(3, 0.6, 2.3, -0.2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,246,228,0.65)'
    ctx.beginPath()
    ctx.moveTo(3, -0.4)
    ctx.quadraticCurveTo(8, -3.8, 13, -3.2)
    ctx.lineTo(19, -2)
    ctx.quadraticCurveTo(9, -1.7, 3, -0.4)
    ctx.fill()
    ctx.strokeStyle = '#9391b5'
    ctx.lineWidth = 0.4
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
        const x = 4 + i * 2.2
        const width = Math.sin((x - 2) / 18 * Math.PI) * 2.1
        ctx.moveTo(x, -x * 0.11)
        ctx.lineTo(x + 2.2, -x * 0.11 - width)
        ctx.moveTo(x, -x * 0.11 + 0.3)
        ctx.lineTo(x + 1.6, -x * 0.11 + width * 0.65)
    }
    ctx.stroke()
    ctx.strokeStyle = '#6b718f'
    ctx.lineWidth = 0.85
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(9, -1.4, 19.4, -2)
    ctx.stroke()
    ctx.strokeStyle = '#fff5df'
    ctx.lineWidth = 0.45
    ctx.beginPath()
    ctx.moveTo(0, -0.3)
    ctx.quadraticCurveTo(9, -1.7, 19, -2.2)
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
    g.addColorStop(0, '#fff0b6')
    g.addColorStop(0.25, '#edc365')
    g.addColorStop(0.5, '#ba8538')
    g.addColorStop(0.75, '#8d653b')
    g.addColorStop(1, '#625041')
    ctx.fillStyle = g
    ellipse(ctx, 0, 0, w, coin.size)
    ctx.fill()
    ctx.strokeStyle = '#645037'
    ctx.lineWidth = 0.7
    ctx.stroke()
    // Thickness stays inside the original spinning ellipse, including edge-on.
    const edge = Math.min(w * 0.45, 0.65 + (1 - Math.abs(spin)) * 0.65)
    const faceX = -edge * 0.5
    const faceW = w - edge * 0.5
    ctx.strokeStyle = '#edc878'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(w * 0.8 - edge * 0.65, -coin.size * 0.6)
    ctx.lineTo(w * 0.8, -coin.size * 0.6)
    ctx.moveTo(w * 0.95 - edge * 0.8, -coin.size * 0.3)
    ctx.lineTo(w * 0.95, -coin.size * 0.3)
    ctx.moveTo(w * 0.95 - edge * 0.8, coin.size * 0.3)
    ctx.lineTo(w * 0.95, coin.size * 0.3)
    ctx.moveTo(w * 0.8 - edge * 0.65, coin.size * 0.6)
    ctx.lineTo(w * 0.8, coin.size * 0.6)
    ctx.stroke()
    const face = ctx.createLinearGradient(-w, -coin.size, w * 0.7, coin.size)
    face.addColorStop(0, '#ffe8a4')
    face.addColorStop(0.45, '#dca64a')
    face.addColorStop(1, '#b17c34')
    ctx.fillStyle = face
    ellipse(ctx, faceX, -coin.size * 0.04, faceW * 0.9, coin.size * 0.87)
    ctx.fill()
    ctx.strokeStyle = '#f9dc8e'
    ctx.lineWidth = 0.55
    ctx.stroke()
    if (w > coin.size * 0.5) {
        ctx.strokeStyle = '#ad7934'
        ctx.lineWidth = 0.5
        ellipse(ctx, faceX, 0, faceW * 0.67, coin.size * 0.65)
        ctx.stroke()
        // A recessed leaf stamp reads at 9px; no radial tick loop per drop.
        ctx.fillStyle = '#a47436'
        ctx.beginPath()
        ctx.moveTo(faceX - faceW * 0.27, coin.size * 0.22)
        ctx.quadraticCurveTo(faceX - faceW * 0.5, -coin.size * 0.2, faceX + faceW * 0.27, -coin.size * 0.43)
        ctx.quadraticCurveTo(faceX + faceW * 0.5, coin.size * 0.15, faceX - faceW * 0.27, coin.size * 0.22)
        ctx.fill()
        ctx.strokeStyle = '#ffe1a0'
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(faceX - faceW * 0.24, coin.size * 0.4)
        ctx.quadraticCurveTo(faceX - faceW * 0.05, 0, faceX + faceW * 0.18, -coin.size * 0.26)
        ctx.stroke()
    }
    ctx.strokeStyle = '#fff4ca'
    ctx.lineWidth = 0.85
    ctx.beginPath()
    ctx.ellipse(faceX, -coin.size * 0.04, faceW * 0.9, coin.size * 0.87, 0, Math.PI * 1.08, Math.PI * 1.6)
    ctx.stroke()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.35 + Math.max(0, spin) * 0.3
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, coin.size * 2.2)
    glow.addColorStop(0, '#ffe38a')
    glow.addColorStop(1, 'rgba(255,200,80,0)')
    ctx.fillStyle = glow
    ctx.fillRect(-coin.size * 2.2, -coin.size * 2.2, coin.size * 4.4, coin.size * 4.4)
    ctx.restore()
}
