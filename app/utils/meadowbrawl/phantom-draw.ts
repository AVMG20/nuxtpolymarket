// Painted spectral allies: solid, faceted equipment above translucent soul cloth.
// All poses use the simulation's attack clock, including its 55% release point.
import type { Phantom } from './engine'
import { Paint } from './character-draw'
import { clamp, lerp } from './geometry'
import { GROUND_YS } from './types'

type Ctx = CanvasRenderingContext2D

/** Shared by the nocked arrow and the projectile so the release stays continuous. */
export function drawSpectralArrow(ctx: Ctx, flying: boolean, t: number) {
    const p = new Paint(ctx, c => c, '#518d9b')
    if (flying) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const trail = ctx.createLinearGradient(-48, 0, 14, 0)
        trail.addColorStop(0, 'rgba(100,224,200,0)')
        trail.addColorStop(0.75, 'rgba(128,240,219,0.3)')
        trail.addColorStop(1, 'rgba(222,255,243,0.8)')
        ctx.fillStyle = trail
        ctx.beginPath()
        ctx.moveTo(-48, 0)
        ctx.quadraticCurveTo(-12, -6, 16, 0)
        ctx.quadraticCurveTo(-12, 6, -48, 0)
        ctx.fill()
        for (let i = 0; i < 3; i++) {
            const x = -18 - i * 10
            const y = Math.sin(t * 22 + i * 2) * (1 + i)
            p.line([[x - 5, y], [x, y]], 'rgba(192,255,240,0.6)', 1)
        }
        ctx.restore()
    }
    p.line([[-17, 0], [10, 0]], '#3d737d', 2.8)
    p.line([[-17, -0.5], [10, -0.5]], '#ecfff8', 1)
    p.shape([[-12, -0.5], [-20, -5], [-18, -1], [-14, 1]], '#b6e7d9', false)
    p.shape([[-12, 0.5], [-20, 5], [-18, 1], [-14, -1]], '#6fbda9', false)
    p.shape([[17, 0], [7, -4], [9, 0], [7, 4]], '#d9fff2')
    p.line([[9, 0], [16, 0]], '#ffffff', 1)
}

function soulCloth(ctx: Ctx, p: Paint, ph: Phantom, t: number, archer: boolean) {
    const sway = Math.sin(t * 3.7 + ph.slot) * 3 - clamp(ph.vx * 0.025, -5, 5)
    const cloth = ctx.createLinearGradient(0, -33, 0, 14)
    cloth.addColorStop(0, archer ? '#345c61' : '#354c71')
    cloth.addColorStop(0.55, archer ? 'rgba(86,161,146,0.75)' : 'rgba(104,161,207,0.75)')
    cloth.addColorStop(1, 'rgba(143,229,240,0)')
    ctx.fillStyle = cloth
    ctx.beginPath()
    ctx.moveTo(-10, -35)
    ctx.bezierCurveTo(-19, -19, -16 + sway, -3, -22 + sway, 12)
    ctx.quadraticCurveTo(-9 + sway, 5, -7, -5)
    ctx.quadraticCurveTo(-7 + sway, 8, -1 + sway, 15)
    ctx.quadraticCurveTo(10 + sway, 3, 8, -6)
    ctx.quadraticCurveTo(15, 3, 21 + sway, 7)
    ctx.quadraticCurveTo(13, -14, 10, -35)
    ctx.closePath()
    ctx.fill()
    p.line([[-9, -32], [-13, -16], [-13 + sway, -3]], archer ? '#8ec8b5' : '#8eb8dc', 1.2)
    p.line([[8, -31], [11, -16], [13 + sway, -5]], '#609ea9', 1)
    // Separate ribbons dissolve at different heights instead of forming a solid skirt.
    for (let i = 0; i < 3; i++) {
        const x = -6 + i * 6
        ctx.save()
        ctx.globalAlpha *= 0.35
        ctx.strokeStyle = archer ? '#c5ffe1' : '#bfedff'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(x, -12)
        ctx.bezierCurveTo(x - 4, -3, x + sway + 6, 5, x + sway, 13 + i * 2)
        ctx.stroke()
        ctx.restore()
    }
}

function warriorBody(ctx: Ctx, p: Paint, dir: number, t: number) {
    // Articulated tassets, overlapping cuirass, and a silver central ridge.
    p.shape([[-9, -22], [9, -22], [12, -10], [4, -7], [0, -12], [-5, -7], [-12, -11]], '#354d70')
    for (const side of [-1, 1]) {
        p.shape([[side * 2, -20], [side * 9, -21], [side * 10, -12], [side * 4, -10]], '#749bb9')
        p.line([[side * 4, -18], [side * 8, -18]], '#c0e5ed')
        p.line([[side * 4, -15], [side * 8, -15]], '#435e81')
    }
    p.shape([[-10, -35], [-5, -38], [6, -38], [11, -33], [8, -23], [0, -19], [-9, -24]], '#7ba6bd')
    p.shape([[0, -36], [9, -33], [7, -25], [0, -21]], '#3f6383', false)
    p.shape([[-8, -33], [-2, -36], [-1, -23], [-6, -26]], '#b8dfe7', false)
    p.line([[-8, -34], [0, -37], [8, -34]], '#e3f9ff', 1.3)
    p.line([[0, -35], [0, -23]], '#c5f0ff', 1.3)
    p.gem(0, -29, 3.5, '#76e0ff')
    p.line([[-8, -22], [0, -20], [8, -22]], '#a5c8d7', 2)
    for (const side of [-1, 1]) {
        p.shape([[side * 6, -36], [side * 12, -39], [side * 17, -33], [side * 14, -28], [side * 8, -30]], side < 0 ? '#aed3df' : '#5b819e')
        p.line([[side * 9, -35], [side * 13, -36], [side * 15, -33]], '#e1f8ff', 1.1)
        p.shape([[side * 11, -29], [side * 15, -29], [side * 15, -23], [side * 11, -24]], '#4f718d')
        p.rivet(side * 12, -32, '#d1f2ff')
    }
    // Closed greathelm with cheek plates, dark eye slit, and an ethereal crest.
    p.shape([[-8, -47], [-4, -52], [4, -52], [9, -47], [8, -37], [2, -34], [-7, -38]], '#94bdcf')
    p.shape([[1, -50], [7, -46], [6, -38], [2, -35], [0, -39]], '#416786', false)
    p.line([[-7, -47], [-3, -50], [1, -50]], '#e3f8ff', 1.3)
    p.shape([[-5 + dir, -45], [6 + dir, -44], [6 + dir, -41], [-5 + dir, -42]], '#152b43', false)
    p.line([[-3 + dir * 2, -43.5], [dir * 2, -43]], '#c5ffff', 1.4)
    p.line([[2 + dir * 2, -43], [4 + dir * 2, -43.5]], '#c5ffff', 1.4)
    p.line([[1, -49], [2, -39]], '#ceeef4', 1.3)
    p.line([[-4, -39], [-1, -38]], '#3c5d7b')
    p.shape([[-2, -51], [-3, -57], [1, -61], [4, -55], [3, -51]], '#8fd6ee')
    p.line([[0, -53], [0, -57], [2, -59]], '#e0fcff')
    ctx.save()
    ctx.globalAlpha *= 0.45
    p.line([[-1, -56], [-6, -55], [-11 - Math.sin(t * 5) * 2, -51]], '#9ddcff', 2)
    ctx.restore()
}

function shield(ctx: Ctx, p: Paint, dir: number, brace: number) {
    ctx.save()
    ctx.translate(-dir * 13, -24 + brace * 2)
    ctx.rotate(-dir * (0.12 + brace * 0.12))
    p.shape([[-9, -10], [0, -14], [9, -10], [8, 3], [0, 13], [-8, 3]], '#a9cedb')
    p.shape([[-6.5, -8], [0, -11], [6.5, -8], [5.5, 2], [0, 9], [-5.5, 2]], '#315776')
    p.shape([[0, -10], [6, -7], [5, 2], [0, 8]], '#4e829b', false)
    p.line([[-7, -8], [-6, 2], [0, 10]], '#e1fbff', 1.2)
    p.line([[0, -9], [0, 7]], '#96cedd', 1.3)
    p.line([[-5, -3], [5, -3]], '#96cedd', 1.3)
    p.gem(0, -2, 4, '#a1f2ff')
    for (const x of [-7, 7]) p.rivet(x, -7, '#e1faff')
    ctx.restore()
}

function sword(ctx: Ctx, p: Paint, ph: Phantom, progress: number) {
    const sweep = !ph.attack ? -0.85 : progress < 0.35
        ? lerp(-0.85, -1.4, progress / 0.35)
        : progress < 0.68 ? lerp(-1.4, 1.05, (progress - 0.35) / 0.33)
            : lerp(1.05, -0.85, (progress - 0.68) / 0.32)
    const angle = ph.facing + sweep
    const dir = Math.cos(ph.facing) < 0 ? -1 : 1
    const hx = Math.cos(ph.facing) * 12
    const hy = -27 + Math.sin(ph.facing) * 4
    p.line([[dir * 11, -30], [hx, hy]], '#355571', 5)
    p.line([[dir * 11, -31], [hx, hy - 1]], '#b3dae6', 2)
    ctx.save()
    ctx.translate(hx, hy)
    ctx.rotate(Math.atan2(Math.sin(angle) * GROUND_YS, Math.cos(angle)))
    p.line([[-3, 0], [8, 0]], '#304862', 4)
    for (let i = 0; i < 3; i++) p.line([[i * 2, -1.5], [i * 2 + 1, 1.5]], '#9dbcca')
    p.gem(-4, 0, 3, '#9ae7fa')
    p.shape([[8, -3], [33, -3.2], [43, 0], [33, 3.2], [8, 3]], '#88d2ea')
    p.shape([[9, -2.5], [33, -2.5], [42, 0], [9, 0]], '#e1faff', false)
    p.line([[10, 0], [36, 0]], '#4b96b7', 0.8)
    for (let i = 0; i < 3; i++) {
        const x = 15 + i * 6
        p.line([[x, -1.5], [x + 2, 0], [x, 1.5]], '#f3ffff', 0.8)
    }
    p.shape([[6, -2], [5, -7], [8, -8], [10, -3], [10, 3], [8, 8], [5, 7], [6, 2]], '#9fbfcc')
    p.gem(8, 0, 2.2, '#e5ffff')
    ctx.restore()
}

function archerBody(ctx: Ctx, p: Paint, dir: number) {
    // A visible bundle of fletched arrows behind a leather-and-silver quiver.
    ctx.save()
    ctx.translate(-dir * 9, -29)
    ctx.rotate(-dir * 0.35)
    p.shape([[-4, -5], [4, -5], [3, 14], [-3, 15]], '#395c61')
    p.line([[-3, -3], [3, -3]], '#a6cbbb', 2)
    p.line([[-2, 1], [-2, 11]], '#729b8f')
    for (let i = 0; i < 3; i++) {
        const x = -3 + i * 3
        const y = -15 - i % 2 * 3
        p.line([[x, 0], [x, y]], '#bddfcf', 1.2)
        p.shape([[x, y + 5], [x - 2, y + 2], [x - 2, y - 3], [x, y]], '#c7ffe3', false)
        p.shape([[x, y + 5], [x + 2, y + 2], [x + 2, y - 3], [x, y]], '#78b8a6', false)
    }
    ctx.restore()
    p.shape([[-8, -32], [7, -33], [9, -23], [7, -12], [1, -8], [-2, -14], [-9, -12]], '#426e69')
    p.shape([[-6, -30], [-1, -32], [0, -15], [-6, -11]], '#80b6a3', false)
    p.line([[5, -28], [5, -17], [2, -13]], '#9bd6ba')
    p.line([[-7, -32], [7, -21]], '#293f47', 4)
    p.line([[-7, -33], [7, -22]], '#a5bc9f', 1.2)
    p.line([[-8, -21], [7, -22]], '#263e48', 4)
    p.gem(1, -21, 2.6, '#b7efd0')
    p.shape([[-10, -36], [-3, -40], [5, -39], [11, -33], [7, -28], [0, -31], [-9, -28], [-14, -31]], '#76a598')
    p.line([[-12, -32], [-8, -30], [0, -33], [8, -30]], '#c1e9ca', 1.2)
    p.gem(1, -33, 2.3, '#e1ffe7')
    // Deep hood cavity and layered folds keep the eyes readable through the glow.
    p.shape([[-9, -40], [-8, -48], [-3, -54], [3, -55], [9, -47], [10, -38], [5, -34], [-4, -35]], '#5a938b')
    p.shape([[-6, -43], [-3, -49], [2, -50], [6, -45], [6, -39], [1, -36], [-5, -39]], '#18393f')
    p.shape([[-9, -40], [-8, -48], [-3, -54], [0, -52], [-5, -44], [-5, -37]], '#a0d1bb', false)
    p.line([[2, -52], [8, -46], [8, -39], [4, -36]], '#b2e6cf', 1.1)
    p.line([[-3 + dir, -43], [dir, -42.6]], '#d4ffe8', 1.5)
    p.line([[2 + dir, -42.6], [4 + dir, -43]], '#d4ffe8', 1.4)
    p.shape([[-4, -39], [1, -40], [6, -39], [2, -35]], '#55877e', false)
}

function bow(ctx: Ctx, p: Paint, ph: Phantom, progress: number, t: number) {
    const drawing = ph.attack && !ph.attack.fired
    const draw = drawing ? clamp(progress / 0.55, 0, 1) : 0
    const release = ph.attack?.fired ? Math.exp(-(progress - 0.55) * 16) : 0
    const angle = Math.atan2(Math.sin(ph.facing) * GROUND_YS, Math.cos(ph.facing))
    ctx.save()
    ctx.translate(Math.cos(ph.facing) * 10, -27 + Math.sin(ph.facing) * 4)
    ctx.rotate(angle)
    // The forward hand grips the riser; the rear hand tracks the nocking point.
    p.line([[-8, 5], [-1, 2], [10, 0]], '#395c61', 5)
    p.line([[-8, 4], [-1, 1], [10, -1]], '#9acaba', 1.6)
    p.line([[-6, -5], [-12 - draw * 6, -8], [-draw * 13, 0]], '#49776c', 4)
    p.line([[-12 - draw * 6, -8], [-draw * 13, 0]], '#a3cebd', 1.5)
    // Recurved limbs flex inward under tension, with pale metal tips.
    for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(11, 0)
        ctx.bezierCurveTo(16, side * 8, 9 - draw * 2, side * 12, 4 - draw * 2, side * 19)
        ctx.quadraticCurveTo(1 - draw * 2, side * 24, 7 - draw * 2, side * 23)
        ctx.strokeStyle = '#233f49'
        ctx.lineWidth = 5
        ctx.stroke()
        ctx.strokeStyle = '#83bda6'
        ctx.lineWidth = 3
        ctx.stroke()
        p.line([[5 - draw * 2, side * 19], [3 - draw * 2, side * 22], [7 - draw * 2, side * 23]], '#dbffe5', 1.6)
        p.line([[12, side * 7], [10, side * 11]], '#d4ead0', 1.2)
    }
    const stringX = drawing ? -draw * 13 : Math.sin((progress - 0.55) * 90) * 3 * release
    p.line([[7 - draw * 2, -23], [stringX, 0], [7 - draw * 2, 23]], '#d9ffed', 0.9)
    p.line([[11, -3], [11, 3]], '#304c51', 4)
    p.gem(11, 0, 2.6, '#ceffe4')
    p.oval(-draw * 13, 0, 2.3, 2.3, '#b6ded0')
    if (drawing) {
        ctx.save()
        ctx.translate(4 - draw * 4, 0)
        drawSpectralArrow(ctx, false, t)
        ctx.restore()
    }
    ctx.restore()
}

export function drawPhantom(ctx: Ctx, ph: Phantom, sx: number, sy: number, t: number) {
    if (ph.born <= 0) return
    const archer = ph.kind === 'archer'
    const dir = Math.cos(ph.facing) < 0 ? -1 : 1
    const progress = ph.attack ? clamp(ph.attack.t / ph.attack.dur, 0, 1) : 0
    const exertion = ph.attack ? Math.sin(progress * Math.PI) : 0
    const hover = 6 + Math.sin(t * 2.2 + ph.slot * 1.3) * 2
    const bob = ph.moving && !ph.attack ? Math.abs(Math.sin(ph.anim)) * 1.5 : 0
    ctx.save()
    ctx.translate(sx + Math.cos(ph.facing) * exertion * 2, sy - hover - bob)
    ctx.globalAlpha *= ph.born * 0.9
    const appear = 0.88 + ph.born * 0.12
    ctx.scale(appear, appear)
    ctx.lineJoin = 'round'
    const p = new Paint(ctx, c => c, archer ? '#27494e' : '#2c4863')
    soulCloth(ctx, p, ph, t, archer)
    // Weapons aimed upstage pass behind the torso; downstage weapons overlap it.
    const weapon = () => archer ? bow(ctx, p, ph, progress, t) : sword(ctx, p, ph, progress)
    if (Math.sin(ph.facing) < -0.25) weapon()
    if (archer) archerBody(ctx, p, dir)
    else warriorBody(ctx, p, dir, t)
    if (!archer) shield(ctx, p, dir, exertion)
    if (Math.sin(ph.facing) >= -0.25) weapon()
    // A few deterministic motes orbit the silhouette without spawning new particles.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
        const phase = (t * 0.45 + i * 0.25 + ph.slot * 0.13) % 1
        const x = Math.sin(t * 1.8 + i * 2.4 + ph.slot) * (15 + i * 2)
        ctx.globalAlpha = ph.born * Math.sin(phase * Math.PI) * 0.65
        p.gem(x, 6 - phase * 57, 0.9 + i % 2 * 0.4, archer ? '#baffdc' : '#b2eaff')
    }
    ctx.restore()
    ctx.restore()
}
