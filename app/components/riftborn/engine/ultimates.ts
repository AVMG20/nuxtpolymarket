/*
 * Class ultimates, charged by kills and fired with E / right click.
 */
import { randomFloat } from '#shared/utils/random'
import type { Ctx } from './core'

const TAU = Math.PI * 2

function rnd(min: number, max: number): number {
    return min + randomFloat() * (max - min)
}

/** Up to n spread-out points where enemies are packed the tightest. */
function densest(ctx: Ctx, n: number, range: number, spacing: number): { x: number, y: number }[] {
    const p = ctx.player
    const cands: { x: number, y: number, score: number }[] = []
    const pool = ctx.enemies.filter(e => !e.dead && !e.untargetable && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < range * range)
    const samples = Math.min(70, pool.length)
    for (let i = 0; i < samples; i++) {
        const e = pool[Math.floor(randomFloat() * pool.length)]!
        let score = e.boss ? 30 : e.elite ? 8 : 0
        ctx.query(e.x, e.y, 120, () => {
            score++
        })
        cands.push({ x: e.x, y: e.y, score })
    }
    cands.sort((a, b) => b.score - a.score)
    const out: { x: number, y: number }[] = []
    for (const c of cands) {
        if (out.length >= n) break
        if (out.some(o => (o.x - c.x) ** 2 + (o.y - c.y) ** 2 < spacing * spacing)) continue
        out.push({ x: c.x, y: c.y })
    }
    while (out.length < n) {
        const a = randomFloat() * TAU
        const d = rnd(80, range * 0.8)
        out.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d })
    }
    return out
}

function judgement(ctx: Ctx): void {
    const p = ctx.player
    const x = p.x
    const y = p.y
    const R = Math.hypot(ctx.view.width, ctx.view.height) * 0.62
    const dmg = (90 + ctx.level * 15) * ctx.stats.might
    const hitSet = new Set<number>()
    const steps = 12
    for (let k = 1; k <= steps; k++) {
        ctx.schedule((k - 1) * 0.04, () => {
            const r = (R * k) / steps
            ctx.query(x, y, r, e => {
                if (hitSet.has(e.uid)) return
                hitSet.add(e.uid)
                ctx.hit(e, dmg, { stun: 2, knock: 700, sx: x, sy: y, color: 0xffd54f, silent: true })
                ctx.fx.burst(e.x, e.y, { count: 4, color: 0xffe27a, tex: 'p.spark', speed: 300, life: 0.3, size: 6 })
            })
        })
    }
    for (let i = 0; i < 3; i++) {
        ctx.schedule(i * 0.09, () => ctx.fx.ring(x, y, i === 1 ? 0xffffff : 0xffd54f, 30, R, 0.55, 1))
    }
    ctx.fx.ring(x, y, 0xfff2b0, 20, R * 0.5, 0.7, 0.8, true)
    ctx.fx.sprite('disc', x, y, { life: 0.5, color: 0xffd54f, size0: 60, size1: R * 1.4, a0: 0.6, a1: 0 })
    ctx.fx.sprite('runeRing', x, y, { life: 1.1, color: 0xffe27a, size0: 120, size1: 360, a0: 1, a1: 0, vrot: 2 })
    ctx.fx.burst(x, y, { count: 90, color: 0xffd54f, tex: 'p.star', speed: 900, life: 0.8, size: 9, drag: 2.5 })
    ctx.fx.burst(x, y, { count: 30, color: 0xfff6d0, tex: 'p.spark', speed: 1200, life: 0.5, size: 10 })
    ctx.flash(0xffd54f, 0.5)
    ctx.shake(0.85)
    ctx.hitStop(0.08)
    ctx.play('explosion', { volume: 1, pitch: 0.6 })
}

function arrowstorm(ctx: Ctx): void {
    const dur = 4
    const dmg = (14 + ctx.level * 2.2) * ctx.stats.might
    ctx.zone({ x: ctx.player.x, y: ctx.player.y, radius: 430, life: dur, tick: 99, damage: 0, color: 0x5fe08a, kind: 'storm', follow: true })
    for (let t = 0; t < dur; t += 0.04) {
        ctx.schedule(t, () => {
            for (let k = 0; k < 2; k++) {
                const p = ctx.player
                const e = ctx.randomEnemy(p.x, p.y, 440)
                const tx = e ? e.x + rnd(-12, 12) : p.x + rnd(-400, 400)
                const ty = e ? e.y + rnd(-12, 12) : p.y + rnd(-300, 300)
                const sx = tx - 70
                const sy = ty - 340
                const fall = 0.2
                ctx.projectile({
                    x: sx,
                    y: sy,
                    vx: (tx - sx) / fall,
                    vy: (ty - sy) / fall,
                    tex: 'arrow',
                    scale: 1.4,
                    radius: 0,
                    damage: 0,
                    life: fall,
                    noCollide: true,
                    trail: { color: 0xbfffd0, rate: 40, tex: 'p.spark', size: 4, life: 0.12 },
                    onEnd: () => {
                        ctx.explode(tx, ty, 36 * ctx.stats.area, dmg, { knock: 90, sx: tx, sy: ty, visual: 'none', silent: true })
                        ctx.fx.burst(tx, ty, { count: 4, color: 0x9fffc0, tex: 'p.spark', speed: 220, life: 0.25, size: 5 })
                        ctx.play('arrow', { volume: 0.3, pitch: 1.2 + randomFloat() * 0.4 }, 0.03)
                    }
                })
            }
        })
    }
    ctx.flash(0x5fe08a, 0.25)
    ctx.shake(0.3)
}

function meteorFall(ctx: Ctx): void {
    const pts = densest(ctx, 12, 560, 110)
    const dmg = (70 + ctx.level * 12) * ctx.stats.might
    const R = 125 * ctx.stats.area
    pts.forEach((pt, i) => {
        ctx.schedule(i * 0.12, () => {
            const fall = 0.6
            ctx.fx.sprite('disc', pt.x, pt.y, { life: fall, color: 0xff4a10, size0: R * 0.3, size1: R * 2.1, a0: 0.2, a1: 0.7, easeOut: false })
            ctx.fx.ring(pt.x, pt.y, 0xff6a2a, R, R * 0.95, fall, 0.8)
            const sx = pt.x + 320
            const sy = pt.y - 720
            ctx.projectile({
                x: sx,
                y: sy,
                vx: (pt.x - sx) / fall,
                vy: (pt.y - sy) / fall,
                tex: 'meteor',
                scale: 2.1,
                radius: 0,
                damage: 0,
                life: fall,
                noCollide: true,
                glow: 0xff5a10,
                glowSize: 220,
                spin: 4,
                faceVel: false,
                trail: { color: 0xff8a30, rate: 140, tex: 'p.flame', size: 22, life: 0.5 },
                onEnd: () => {
                    ctx.explode(pt.x, pt.y, R, dmg, { burn: dmg * 0.15, burnT: 4, knock: 500, sx: pt.x, sy: pt.y, visual: 'fire', sfx: true, shake: 0.4 })
                    ctx.fx.burst(pt.x, pt.y, { count: 16, color: 0x2a1610, tex: 'p.square', speed: 520, life: 0.7, size: 8, normal: true, gravity: 600 })
                    ctx.zone({ x: pt.x, y: pt.y, radius: R * 0.7, life: 3, tick: 0.35, damage: dmg * 0.08, color: 0xff4a10, kind: 'magma', hit: { burn: dmg * 0.06, burnT: 2 } })
                }
            })
        })
    })
    ctx.flash(0xff6a2b, 0.3)
}

function tempest(ctx: Ctx): void {
    const dur = 5
    const dmg = (24 + ctx.level * 4) * ctx.stats.might
    ctx.zone({ x: ctx.player.x, y: ctx.player.y, radius: 480, life: dur, tick: 99, damage: 0, color: 0x63c7ff, kind: 'storm', follow: true })
    for (let t = 0; t < dur; t += 0.06) {
        ctx.schedule(t, () => {
            const p = ctx.player
            const e = ctx.randomEnemy(p.x, p.y, 480)
            if (!e) return
            ctx.fx.lightning(e.x + rnd(-50, 50), e.y - 460, e.x, e.y, randomFloat() < 0.3 ? 0xfff27a : 0x63c7ff, 5, 0.22, 1.5)
            ctx.explode(e.x, e.y, 56 * ctx.stats.area, dmg, { stun: 0.4, knock: 120, sx: e.x, sy: e.y - 10, visual: 'plain', color: 0x9fe6ff, silent: true })
            ctx.play('zap', { volume: 0.5, pitch: 0.8 + randomFloat() * 0.6 }, 0.05)
            if (randomFloat() < 0.15) ctx.shake(0.08)
        })
    }
    ctx.flash(0x63c7ff, 0.35)
    ctx.shake(0.4)
}

function armyOfTheDead(ctx: Ctx): void {
    const p = ctx.player
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU
        ctx.schedule(i * 0.05, () => {
            const x = p.x + Math.cos(a) * 60
            const y = p.y + Math.sin(a) * 60
            ctx.ally('wraith', x, y, 8)
            ctx.fx.burst(x, y, { count: 12, color: 0xb06bff, tex: 'p.smoke', speed: 160, life: 0.6, size: 12 })
        })
    }
    ctx.fx.ring(p.x, p.y, 0xb06bff, 20, 240, 0.6, 1)
    ctx.fx.sprite('runeRing', p.x, p.y, { life: 1, color: 0xc77dff, size0: 100, size1: 300, a0: 1, a1: 0, vrot: -2 })
    ctx.flash(0x8a3aff, 0.3)
    ctx.shake(0.35)
    ctx.play('summon', { volume: 1, pitch: 0.8 })
}

function singularity(ctx: Ctx): void {
    const p = ctx.player
    const mouse = ctx.mouseWorld()
    let pt: { x: number, y: number }
    if (mouse && (mouse.x - p.x) ** 2 + (mouse.y - p.y) ** 2 < 600 * 600) pt = mouse
    else if (ctx.enemies.length) pt = densest(ctx, 1, 420, 0)[0]!
    else {
        const d = ctx.aimDir()
        pt = { x: p.x + d.x * 200, y: p.y + d.y * 200 }
    }
    const dmg = (130 + ctx.level * 22) * ctx.stats.might
    const R = 320 * Math.sqrt(ctx.stats.area)
    ctx.zone({
        x: pt.x,
        y: pt.y,
        radius: R,
        life: 2.4,
        tick: 0.25,
        damage: dmg * 0.06,
        color: 0xff3fa4,
        kind: 'void',
        pull: 420,
        hit: { silent: true },
        onEnd: z => {
            ctx.explode(z.x, z.y, R * 0.9, dmg, { knock: 800, sx: z.x, sy: z.y, visual: 'void', sfx: true, shake: 0.9 })
            ctx.fx.ring(z.x, z.y, 0xffffff, 40, R * 1.3, 0.5, 1)
            ctx.fx.ring(z.x, z.y, 0xff3fa4, 30, R * 1.6, 0.7, 1)
            ctx.fx.burst(z.x, z.y, { count: 80, color: 0xff7ac8, tex: 'p.spark', speed: 1100, life: 0.6, size: 10 })
            ctx.flash(0xff3fa4, 0.5)
            ctx.hitStop(0.07)
        }
    })
    ctx.fx.ring(pt.x, pt.y, 0xff3fa4, R * 1.2, 30, 0.5, 0.9, true)
    ctx.play('summon', { volume: 0.8, pitch: 0.5 })
    ctx.shake(0.3)
}

export function castUltimate(ctx: Ctx): void {
    switch (ctx.cls.id) {
        case 'knight': judgement(ctx)
            break
        case 'ranger': arrowstorm(ctx)
            break
        case 'pyromancer': meteorFall(ctx)
            break
        case 'stormcaller': tempest(ctx)
            break
        case 'necromancer': armyOfTheDead(ctx)
            break
        case 'voidwalker': singularity(ctx)
            break
    }
}
