/*
 * Procedural art for everything the engine draws itself: particles, glows,
 * projectiles, pickups, allies, heroes, plus the canvas-made floor and
 * vignette. Enemy art comes from the content side (EnemyDef.draw).
 */
import type { Graphics } from 'pixi.js'
import type { AtlasBaker } from './atlas'
import { bakeHeroes } from './hero'

function soft(g: Graphics, x: number, y: number, r: number, color = 0xffffff, steps = 14, peak = 1): void {
    const a = 1 - Math.pow(1 - Math.min(0.99, peak), 1 / steps)
    for (let i = 0; i < steps; i++) {
        const t = 1 - i / steps
        g.circle(x, y, Math.max(0.5, r * t)).fill({ color, alpha: a })
    }
}

function softEllipse(g: Graphics, x: number, y: number, rx: number, ry: number, color = 0xffffff, steps = 10, peak = 1): void {
    const a = 1 - Math.pow(1 - Math.min(0.99, peak), 1 / steps)
    for (let i = 0; i < steps; i++) {
        const t = 1 - i / steps
        g.ellipse(x, y, Math.max(0.5, rx * t), Math.max(0.5, ry * t)).fill({ color, alpha: a })
    }
}

// ─── Particles and generic FX (baked first so they share the first page) ──

function bakeFx(atlas: AtlasBaker): void {
    atlas.add('p.dot', 24, 24, g => {
        soft(g, 0, 0, 12, 0xffffff, 10, 0.95)
        g.circle(0, 0, 4).fill(0xffffff)
    })
    atlas.add('p.spark', 36, 10, g => {
        softEllipse(g, 0, 0, 18, 5, 0xffffff, 8, 0.9)
        g.ellipse(0, 0, 12, 1.6).fill(0xffffff)
    })
    atlas.add('p.flame', 26, 26, g => {
        soft(g, 0, 2, 12, 0xffffff, 10, 0.85)
        g.poly([0, -12, 6, 0, 0, 7, -6, 0]).fill({ color: 0xffffff, alpha: 0.8 })
    })
    atlas.add('p.star', 26, 26, g => {
        soft(g, 0, 0, 9, 0xffffff, 6, 0.6)
        g.star(0, 0, 4, 12, 2.5).fill(0xffffff)
    })
    atlas.add('p.ring', 34, 34, g => {
        g.circle(0, 0, 14).stroke({ width: 3, color: 0xffffff })
        g.circle(0, 0, 14).stroke({ width: 7, color: 0xffffff, alpha: 0.25 })
    })
    atlas.add('p.shard', 14, 18, g => {
        g.poly([0, -8, 5, 0, 0, 8, -5, 0]).fill(0xffffff)
    })
    atlas.add('p.smoke', 40, 40, g => soft(g, 0, 0, 20, 0xffffff, 12, 0.55))
    atlas.add('p.square', 8, 8, g => g.rect(-3, -3, 6, 6).fill(0xffffff))
    atlas.add('glow', 128, 128, g => soft(g, 0, 0, 64, 0xffffff, 26, 0.9))
    atlas.add('ring', 256, 256, g => {
        g.circle(0, 0, 118).stroke({ width: 4, color: 0xffffff })
        g.circle(0, 0, 116).stroke({ width: 12, color: 0xffffff, alpha: 0.25 })
        g.circle(0, 0, 112).stroke({ width: 20, color: 0xffffff, alpha: 0.12 })
    })
    atlas.add('ringSoft', 256, 256, g => {
        for (let i = 0; i < 12; i++) {
            g.circle(0, 0, 120 - i * 2.5).stroke({ width: 3, color: 0xffffff, alpha: 0.05 + i * 0.012 })
        }
        g.circle(0, 0, 122).stroke({ width: 2.5, color: 0xffffff, alpha: 0.9 })
    })
    atlas.add('disc', 128, 128, g => {
        soft(g, 0, 0, 64, 0xffffff, 16, 0.6)
        g.circle(0, 0, 60).stroke({ width: 3, color: 0xffffff, alpha: 0.7 })
    })
    atlas.add('slash', 200, 200, g => {
        // Thick crescent, widest in the middle, facing +x
        const pts: number[] = []
        const n = 28
        for (let i = 0; i <= n; i++) {
            const t = i / n
            const a = -1.15 + t * 2.3
            const r = 96
            pts.push(Math.cos(a) * r, Math.sin(a) * r)
        }
        for (let i = n; i >= 0; i--) {
            const t = i / n
            const a = -1.15 + t * 2.3
            const w = Math.sin(t * Math.PI) * 30
            const r = 96 - w
            pts.push(Math.cos(a) * r, Math.sin(a) * r)
        }
        g.poly(pts).fill({ color: 0xffffff, alpha: 0.35 })
        const inner: number[] = []
        for (let i = 0; i <= n; i++) {
            const t = i / n
            const a = -1.05 + t * 2.1
            inner.push(Math.cos(a) * 95, Math.sin(a) * 95)
        }
        for (let i = n; i >= 0; i--) {
            const t = i / n
            const a = -1.05 + t * 2.1
            const w = Math.sin(t * Math.PI) * 13
            inner.push(Math.cos(a) * (95 - w), Math.sin(a) * (95 - w))
        }
        g.poly(inner).fill(0xffffff)
    })
    atlas.add('shadow', 64, 32, g => softEllipse(g, 0, 0, 30, 13, 0x000000, 8, 0.55))
    atlas.add('runeRing', 256, 256, g => {
        g.circle(0, 0, 120).stroke({ width: 2, color: 0xffffff, alpha: 0.9 })
        g.circle(0, 0, 100).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 })
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            const cx = Math.cos(a) * 110
            const cy = Math.sin(a) * 110
            g.moveTo(cx - 5, cy - 6).lineTo(cx + 5, cy + 6).stroke({ width: 2, color: 0xffffff })
            g.moveTo(cx + 5, cy - 6).lineTo(cx, cy).stroke({ width: 2, color: 0xffffff })
            g.circle(cx, cy, 2).fill(0xffffff)
        }
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            const b = a + Math.PI * 2 / 3
            g.moveTo(Math.cos(a) * 100, Math.sin(a) * 100).lineTo(Math.cos(b) * 100, Math.sin(b) * 100).stroke({ width: 1.2, color: 0xffffff, alpha: 0.5 })
        }
    })
    atlas.add('beam', 64, 32, g => {
        softEllipse(g, 0, 0, 32, 16, 0xffffff, 8, 0.6)
        g.rect(-32, -4, 64, 8).fill(0xffffff)
    })
}

// ─── Projectiles ─────────────────────────────────────────────────────────

function bakeProjectiles(atlas: AtlasBaker): void {
    atlas.add('arrow', 44, 12, g => {
        g.rect(-18, -1.2, 30, 2.4).fill(0xc8a070)
        g.poly([12, -5, 21, 0, 12, 5]).fill(0xe8f4ff)
        g.poly([-20, -5, -13, -1, -13, 1, -20, 5, -16, 0]).fill(0x7fe0a0)
    })
    atlas.add('windArrow', 64, 22, g => {
        softEllipse(g, -4, 0, 30, 9, 0x9fffd0, 8, 0.6)
        g.poly([-26, -2, 20, -2, 30, 0, 20, 2, -26, 2]).fill(0xeafff4)
        g.poly([16, -8, 31, 0, 16, 8, 20, 0]).fill(0xffffff)
        g.poly([-28, -8, -18, -2, -18, 2, -28, 8, -23, 0]).fill(0x8fffc8)
    })
    atlas.add('dagger', 32, 12, g => {
        g.poly([-4, -3.5, 13, -1.5, 16, 0, 13, 1.5, -4, 3.5]).fill(0xe6eef8)
        g.poly([-4, -1, 14, 0, -4, 1]).fill(0xffffff)
        g.rect(-7, -5, 3, 10).fill(0xb08a3a)
        g.rect(-14, -1.8, 7, 3.6).fill(0x5a3a20)
    })
    atlas.add('fireball', 44, 44, g => {
        soft(g, 0, 0, 22, 0xff5a10, 12, 0.8)
        g.circle(0, 0, 11).fill(0xff8a2a)
        g.circle(1, -1, 8).fill(0xffc24a)
        g.circle(2, -2, 4.5).fill(0xfff3c0)
    })
    atlas.add('comet', 72, 72, g => {
        soft(g, 0, 0, 36, 0xff3a00, 14, 0.85)
        g.circle(0, 0, 18).fill(0xff6a1a)
        g.circle(2, -1, 13).fill(0xffa030)
        g.circle(3, -2, 8).fill(0xffe9a0)
        g.circle(4, -3, 4).fill(0xffffff)
    })
    atlas.add('skull', 30, 30, g => {
        soft(g, 0, 0, 15, 0xb06bff, 8, 0.6)
        g.circle(0, -1, 8).fill(0xeee6ff)
        g.roundRect(-5, 3, 10, 6, 2).fill(0xeee6ff)
        g.circle(-3, -1, 2.4).fill(0x3a1060)
        g.circle(3, -1, 2.4).fill(0x3a1060)
        g.circle(-3, -1, 1).fill(0xe0a0ff)
        g.circle(3, -1, 1).fill(0xe0a0ff)
        g.rect(-3, 6, 1.2, 3).fill(0x3a1060)
        g.rect(0, 6, 1.2, 3).fill(0x3a1060)
    })
    atlas.add('voidOrb', 40, 40, g => {
        soft(g, 0, 0, 20, 0xff3fa4, 12, 0.85)
        g.circle(0, 0, 10).fill(0x1a0520)
        g.circle(0, 0, 10).stroke({ width: 2.5, color: 0xff7ac8 })
        g.circle(-3, -3, 2.5).fill({ color: 0xffd0ec, alpha: 0.9 })
    })
    atlas.add('boomerang', 40, 40, g => {
        g.moveTo(-14, -12).quadraticCurveTo(10, -10, 14, 12).quadraticCurveTo(4, -2, -14, -12).fill(0xd8e6ff)
        g.moveTo(-14, -12).quadraticCurveTo(10, -10, 14, 12).stroke({ width: 1.5, color: 0x8fb0ff })
        g.circle(-2, -4, 2).fill(0xffffff)
    })
    atlas.add('glaive', 56, 56, g => {
        soft(g, 0, 0, 26, 0x9fb8ff, 10, 0.55)
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2
            const c = Math.cos(a)
            const s = Math.sin(a)
            const rot = (x: number, y: number) => [x * c - y * s, x * s + y * c]
            const p = [...rot(0, -4), ...rot(22, -10), ...rot(14, 2), ...rot(0, 4)]
            g.poly(p).fill(0xeaf0ff)
        }
        g.circle(0, 0, 6).fill(0x2a2050)
        g.circle(0, 0, 3).fill(0xc0d0ff)
    })
    atlas.add('bolt', 30, 14, g => {
        softEllipse(g, 0, 0, 15, 7, 0x7ff0ff, 6, 0.7)
        g.ellipse(2, 0, 9, 3).fill(0xffffff)
    })
    atlas.add('bloodBolt', 34, 16, g => {
        softEllipse(g, 0, 0, 17, 8, 0xff2050, 6, 0.8)
        g.poly([-8, 0, 0, -4, 12, 0, 0, 4]).fill(0xffd0d8)
    })
    atlas.add('mine', 30, 30, g => {
        g.circle(0, 0, 11).fill(0x2a2438)
        g.circle(0, 0, 11).stroke({ width: 2, color: 0xffb347 })
        g.circle(0, 0, 4).fill(0xffd27a)
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4
            g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6).lineTo(Math.cos(a) * 10, Math.sin(a) * 10).stroke({ width: 1.5, color: 0xffb347 })
        }
    })
    atlas.add('mineEvo', 34, 34, g => {
        soft(g, 0, 0, 17, 0x6a7bff, 8, 0.6)
        g.circle(0, 0, 11).fill(0x161430)
        g.circle(0, 0, 11).stroke({ width: 2, color: 0x9aa8ff })
        g.circle(0, 0, 5).fill(0xffffff)
    })
    atlas.add('meteor', 60, 60, g => {
        soft(g, 0, 0, 30, 0xff7a20, 12, 0.7)
        g.circle(0, 0, 14).fill(0x5a2a1a)
        g.circle(-3, -3, 10).fill(0x8a3a1a)
        g.circle(4, 3, 3).fill(0x3a1a10)
        g.circle(-5, 2, 2).fill(0x3a1a10)
        g.circle(-4, -5, 4).fill({ color: 0xffb060, alpha: 0.8 })
    })
    atlas.add('crescentWave', 40, 72, g => {
        g.moveTo(-8, -32).quadraticCurveTo(22, 0, -8, 32).quadraticCurveTo(8, 0, -8, -32).fill(0xffffff)
        g.moveTo(-14, -30).quadraticCurveTo(18, 0, -14, 30).quadraticCurveTo(0, 0, -14, -30).fill({ color: 0xffffff, alpha: 0.35 })
    })
    atlas.add('iceShard', 26, 10, g => {
        g.poly([-12, 0, -2, -4, 12, 0, -2, 4]).fill(0xdff6ff)
        g.poly([-6, 0, 0, -1.5, 9, 0, 0, 1.5]).fill(0xffffff)
    })
    atlas.add('ember', 16, 16, g => {
        soft(g, 0, 0, 8, 0xff7a20, 6, 0.8)
        g.circle(0, 0, 3).fill(0xffe0a0)
    })
    atlas.add('blackHole', 128, 128, g => {
        for (let i = 0; i < 10; i++) {
            g.circle(0, 0, 60 - i * 3).stroke({ width: 4, color: 0xff3fa4, alpha: 0.05 + i * 0.03 })
        }
        g.circle(0, 0, 30).fill(0x000000)
        g.circle(0, 0, 30).stroke({ width: 3, color: 0xffb0dd })
    })
    // Enemy shots, tinted at runtime
    atlas.add('shot.orb', 24, 24, g => {
        soft(g, 0, 0, 12, 0xffffff, 8, 0.7)
        g.circle(0, 0, 5.5).fill(0xffffff)
    })
    atlas.add('shot.arrow', 30, 10, g => {
        g.rect(-12, -1, 20, 2).fill(0xffffff)
        g.poly([8, -4, 15, 0, 8, 4]).fill(0xffffff)
    })
    atlas.add('shot.spike', 26, 12, g => {
        softEllipse(g, 0, 0, 13, 6, 0xffffff, 5, 0.5)
        g.poly([-10, -4, 12, 0, -10, 4, -6, 0]).fill(0xffffff)
    })
    atlas.add('shot.fire', 26, 26, g => {
        soft(g, 0, 0, 13, 0xffffff, 8, 0.75)
        g.circle(0, 0, 5).fill(0xffffff)
    })
}

// ─── Pickups ─────────────────────────────────────────────────────────────

export const GEM_TIERS = [
    { min: 0, color: 0x52b8ff, size: 13 },
    { min: 3, color: 0x58f08a, size: 15 },
    { min: 10, color: 0xff4f6a, size: 17 },
    { min: 30, color: 0xc06bff, size: 20 },
    { min: 100, color: 0xffd54f, size: 24 }
] as const

function shade(color: number, f: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)))
    const gg = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)))
    const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)))
    return (r << 16) | (gg << 8) | b
}

function bakePickups(atlas: AtlasBaker): void {
    GEM_TIERS.forEach((t, i) => {
        const s = t.size
        atlas.add(`gem.${i}`, s * 2 + 6, s * 2 + 6, g => {
            soft(g, 0, 0, s, t.color, 10, 0.5)
            const h = s * 0.66
            const w = s * 0.44
            const m = h * 0.18
            // Outline, then four facets and a crown
            g.poly([0, -h - 1.5, w + 1.5, -m, 0, h + 1.5, -w - 1.5, -m]).fill(shade(t.color, 0.3))
            g.poly([0, -h, w, -m, 0, h, -w, -m]).fill(shade(t.color, 0.75))
            g.poly([0, -h, w, -m, 0, -m * 0.2]).fill(shade(t.color, 1.35))
            g.poly([0, -h, -w, -m, 0, -m * 0.2]).fill(shade(t.color, 1.05))
            g.poly([-w, -m, 0, -m * 0.2, 0, h]).fill(shade(t.color, 0.8))
            g.poly([w, -m, 0, -m * 0.2, 0, h]).fill(shade(t.color, 0.6))
            g.poly([-w * 0.5, -h * 0.55, -w * 0.15, -h * 0.75, -w * 0.05, -m * 0.6]).fill({ color: 0xffffff, alpha: 0.85 })
            g.circle(w * 0.25, h * 0.35, Math.max(0.8, s * 0.06)).fill({ color: 0xffffff, alpha: 0.6 })
            if (i >= 3) g.star(0, -m * 0.2, 4, s * 0.5, s * 0.08).fill({ color: 0xffffff, alpha: 0.5 })
        })
    })
    atlas.add('shard', 34, 38, g => {
        soft(g, 0, 0, 17, 0xff5ec4, 10, 0.65)
        g.poly([0, -15, 8.5, -3, 5, 14, -5, 14, -8.5, -3]).fill(0x5a0a3a)
        g.poly([0, -13, 7, -3, 4, 12, -4, 12, -7, -3]).fill(0xc2338a)
        g.poly([0, -13, 7, -3, 0, 2]).fill(0xff9ad8)
        g.poly([0, -13, -7, -3, 0, 2]).fill(0xff5ec4)
        g.poly([0, 2, 4, 12, -4, 12]).fill(0x9a1a6a)
        g.poly([-1, -11, 2, -5, -1, -3]).fill(0xffffff)
        g.star(6, -9, 4, 4, 0.8).fill({ color: 0xffffff, alpha: 0.9 })
    })
    atlas.add('food', 40, 40, g => {
        soft(g, 0, 0, 19, 0xff6060, 10, 0.45)
        g.ellipse(2, 2, 12, 11).fill(0x5a2010)
        g.ellipse(1, 0.5, 11, 10).fill(0xb8502a)
        g.ellipse(0, -1, 9.5, 8.5).fill(0xd8703a)
        g.ellipse(-3, -4, 4, 2.6).fill({ color: 0xffc090, alpha: 0.85 })
        g.roundRect(-16, 6, 12, 4.5, 2).fill(0xf3e9d6)
        g.circle(-16, 5.5, 3.2).fill(0xfffaf0)
        g.circle(-16, 10.5, 3.2).fill(0xfffaf0)
        g.roundRect(-16, 6, 12, 4.5, 2).stroke({ width: 1, color: 0x8a7a60 })
    })
    atlas.add('magnet', 40, 40, g => {
        soft(g, 0, 0, 20, 0x5aa8ff, 10, 0.55)
        g.moveTo(-10.5, 0).arc(0, 0, 10.5, Math.PI, 0, false).stroke({ width: 9, color: 0x3a0a10 })
        g.moveTo(-10.5, 0).arc(0, 0, 10.5, Math.PI, 0, false).stroke({ width: 7, color: 0xe03a3a })
        g.moveTo(-9.5, -4).arc(0, -1, 10.5, Math.PI * 1.1, Math.PI * 1.45, false).stroke({ width: 2, color: 0xff9a9a })
        g.rect(-14, 0, 7, 8).fill(0xe03a3a)
        g.rect(7, 0, 7, 8).fill(0x3a6ae0)
        g.rect(-14, 6, 7, 5).fill(0xe8e8f0)
        g.rect(7, 6, 7, 5).fill(0xe8e8f0)
        g.moveTo(-17, 14).lineTo(-13, 18).stroke({ width: 1.5, color: 0x9fd0ff })
        g.moveTo(17, 14).lineTo(13, 18).stroke({ width: 1.5, color: 0x9fd0ff })
    })
    atlas.add('bomb', 40, 40, g => {
        soft(g, 0, 0, 20, 0xffa040, 10, 0.5)
        g.circle(0, 3, 12.5).fill(0x0a0810)
        g.circle(0, 3, 11).fill(0x2a2638)
        g.circle(-4, -1, 4).fill({ color: 0x8080a0, alpha: 0.7 })
        g.circle(-5, -2, 1.6).fill({ color: 0xffffff, alpha: 0.8 })
        g.roundRect(-3.5, -12, 7, 6, 1.5).fill(0x50505e)
        g.moveTo(0, -12).quadraticCurveTo(4, -17, 9, -15).stroke({ width: 1.8, color: 0xc8a070 })
        soft(g, 10, -15, 6, 0xffc040, 5, 0.8)
        g.star(10, -15, 5, 4.5, 1.6).fill(0xfff0a0)
    })
    const chest = (key: string, w: number, h: number, wood: number, trim: number, glowCol: number, gem: number) => {
        atlas.add(key, w + 26, h + 26, g => {
            soft(g, 0, 2, Math.max(w, h) * 0.72, glowCol, 12, 0.55)
            const x = -w / 2
            const y = -h / 2
            const lidH = h * 0.42
            // Body
            g.roundRect(x - 1.5, y + lidH - 2, w + 3, h - lidH + 3.5, 4).fill(0x14080a)
            g.roundRect(x, y + lidH - 0.5, w, h - lidH, 3).fill(wood)
            for (let k = 1; k < 4; k++) g.rect(x + 2, y + lidH + ((h - lidH) * k) / 4, w - 4, 0.8).fill({ color: 0x000000, alpha: 0.25 })
            // Lid: rounded top
            g.moveTo(x - 1.5, y + lidH).lineTo(x - 1.5, y + lidH * 0.45).quadraticCurveTo(0, y - lidH * 0.35, x + w + 1.5, y + lidH * 0.45).lineTo(x + w + 1.5, y + lidH).closePath().fill(0x14080a)
            g.moveTo(x, y + lidH).lineTo(x, y + lidH * 0.5).quadraticCurveTo(0, y - lidH * 0.25, x + w, y + lidH * 0.5).lineTo(x + w, y + lidH).closePath().fill(shade(wood, 1.25))
            g.moveTo(x + 3, y + lidH * 0.45).quadraticCurveTo(0, y - lidH * 0.05, x + w - 3, y + lidH * 0.45).stroke({ width: 1.5, color: shade(wood, 1.6), alpha: 0.7 })
            // Bands and rim
            g.rect(x, y + lidH - 2, w, 3.5).fill(trim)
            g.rect(x + w * 0.16, y + lidH * 0.2, w * 0.09, h - lidH * 0.2).fill(trim)
            g.rect(x + w * 0.75, y + lidH * 0.2, w * 0.09, h - lidH * 0.2).fill(trim)
            g.rect(x + w * 0.16, y + lidH * 0.2, w * 0.03, h - lidH * 0.2).fill({ color: 0xffffff, alpha: 0.35 })
            g.rect(x + w * 0.75, y + lidH * 0.2, w * 0.03, h - lidH * 0.2).fill({ color: 0xffffff, alpha: 0.35 })
            for (const cx of [x + 2.5, x + w - 2.5]) {
                g.circle(cx, y + h - 3, 1.6).fill(trim)
                g.circle(cx, y + lidH + 3, 1.6).fill(trim)
            }
            // Lock with a gem
            g.roundRect(-w * 0.12, y + lidH - 5, w * 0.24, h * 0.3, 2.5).fill(shade(trim, 0.7))
            g.roundRect(-w * 0.1, y + lidH - 4, w * 0.2, h * 0.27, 2).fill(trim)
            g.circle(0, y + lidH + 1, w * 0.055).fill(gem)
            g.circle(-w * 0.02, y + lidH, w * 0.022).fill(0xffffff)
            // Light leaking from the seam
            g.rect(x + 2, y + lidH - 0.5, w - 4, 1).fill({ color: 0xfff3b0, alpha: 0.9 })
        })
    }
    chest('chest', 40, 32, 0x8a5030, 0xf5c451, 0xffd54f, 0x52b8ff)
    chest('chestBoss', 54, 42, 0x4a1e5a, 0xffe27a, 0xff6ad5, 0xff3fa4)
}


// ─── Ability, weapon extras and decals ───────────────────────────────────

function bakeAbilityArt(atlas: AtlasBaker): void {
    atlas.add('impact', 96, 96, g => {
        soft(g, 0, 0, 30, 0xffffff, 10, 0.7)
        const pts: number[] = []
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2
            const r = i % 2 ? 14 : i % 4 ? 34 : 46
            pts.push(Math.cos(a) * r, Math.sin(a) * r)
        }
        g.poly(pts).fill({ color: 0xffffff, alpha: 0.9 })
        g.circle(0, 0, 10).fill(0xffffff)
    })
    atlas.add('turret', 44, 44, g => {
        g.circle(0, 0, 15).fill(0x0c1a18)
        g.circle(0, 0, 13.5).fill(0x2a4a46)
        g.circle(0, 0, 13.5).stroke({ width: 1.5, color: 0x7fffd4, alpha: 0.8 })
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            g.circle(Math.cos(a) * 10.5, Math.sin(a) * 10.5, 1.3).fill(0x9fffe0)
        }
        g.roundRect(0, -3.5, 20, 7, 2).fill(0x0c1a18)
        g.roundRect(1, -2.5, 18, 5, 1.5).fill(0x5a8a84)
        g.rect(15, -2.5, 4, 5).fill(0x7fffd4)
        g.circle(0, 0, 7).fill(0x3a6a64)
        g.circle(0, 0, 4).fill(0x7fffd4)
        g.circle(-1, -1, 1.6).fill(0xffffff)
    })
    const totem = (key: string, glowCol: number, core: number) => atlas.add(key, 40, 64, g => {
        soft(g, 0, -20, 16, glowCol, 8, 0.6)
        g.poly([-11, 26, 11, 26, 8, 20, -8, 20]).fill(0x1a1420)
        g.roundRect(-7, -14, 14, 36, 3).fill(0x14101c)
        g.roundRect(-5.5, -12, 11, 33, 2.5).fill(0x4a3a5a)
        g.rect(-5.5, -4, 11, 2).fill(core)
        g.rect(-5.5, 6, 11, 2).fill(core)
        g.poly([-9, -14, 0, -24, 9, -14]).fill(0x14101c)
        g.poly([-7, -15, 0, -22, 7, -15]).fill(0x6a5a7a)
        g.circle(0, -24, 5.5).fill(core)
        g.circle(0, -24, 2.8).fill(0xffffff)
    })
    totem('totem', 0x63c7ff, 0x9fe6ff)
    totem('totemEvo', 0xfff27a, 0xfff6c0)
    const shieldTex = (key: string, rim: number, face: number) => atlas.add(key, 40, 44, g => {
        soft(g, 0, 0, 18, rim, 8, 0.45)
        g.moveTo(0, -17).lineTo(13, -11).quadraticCurveTo(13, 8, 0, 17).quadraticCurveTo(-13, 8, -13, -11).closePath().fill(0x1a1208)
        g.moveTo(0, -15).lineTo(11, -10).quadraticCurveTo(11, 7, 0, 15).quadraticCurveTo(-11, 7, -11, -10).closePath().fill(face)
        g.moveTo(0, -15).lineTo(11, -10).quadraticCurveTo(11, 7, 0, 15).quadraticCurveTo(-11, 7, -11, -10).closePath().stroke({ width: 2, color: rim })
        g.rect(-1.2, -13, 2.4, 26).fill(rim)
        g.rect(-9, -4, 18, 2.4).fill(rim)
        g.circle(0, -3, 3).fill(0xffffff)
    })
    shieldTex('aegis', 0xffd54f, 0x3a5a9a)
    shieldTex('aegisEvo', 0xfff6d0, 0xd8b040)
    atlas.add('clock', 256, 256, g => {
        g.circle(0, 0, 122).stroke({ width: 3, color: 0xffffff, alpha: 0.9 })
        g.circle(0, 0, 112).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 })
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            const r0 = i % 3 ? 100 : 92
            g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * 110, Math.sin(a) * 110).stroke({ width: i % 3 ? 2 : 4, color: 0xffffff })
        }
        for (let i = 0; i < 60; i++) {
            const a = (i / 60) * Math.PI * 2
            g.circle(Math.cos(a) * 117, Math.sin(a) * 117, 1).fill({ color: 0xffffff, alpha: 0.7 })
        }
        g.circle(0, 0, 60).stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 })
    })
    atlas.add('clockHand', 200, 200, g => {
        g.moveTo(0, 0).lineTo(0, -88).stroke({ width: 3, color: 0xffffff, cap: 'round' })
        g.moveTo(0, 0).lineTo(52, 0).stroke({ width: 5, color: 0xffffff, cap: 'round' })
        g.circle(0, 0, 7).fill(0xffffff)
    })
    atlas.add('frostSigil', 200, 200, g => {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            const c = Math.cos(a)
            const sn = Math.sin(a)
            g.moveTo(0, 0).lineTo(c * 92, sn * 92).stroke({ width: 3, color: 0xffffff, alpha: 0.9 })
            for (const d of [40, 66]) {
                const bx = c * d
                const by = sn * d
                for (const s2 of [-1, 1]) {
                    const b = a + s2 * 0.7
                    g.moveTo(bx, by).lineTo(bx + Math.cos(b) * 18, by + Math.sin(b) * 18).stroke({ width: 2, color: 0xffffff, alpha: 0.8 })
                }
            }
        }
        g.circle(0, 0, 16).stroke({ width: 2, color: 0xffffff })
    })
    atlas.add('crack', 96, 40, g => {
        const pts: [number, number][] = [[-46, 2], [-30, -4], [-18, 3], [-4, -5], [8, 4], [22, -3], [34, 5], [46, -1]]
        g.moveTo(pts[0]![0], pts[0]![1])
        for (const [x, y] of pts.slice(1)) g.lineTo(x, y)
        g.stroke({ width: 5, color: 0xffffff, alpha: 0.4, join: 'round' })
        g.moveTo(pts[0]![0], pts[0]![1])
        for (const [x, y] of pts.slice(1)) g.lineTo(x, y)
        g.stroke({ width: 2, color: 0xffffff, join: 'round' })
        g.moveTo(-18, 3).lineTo(-12, 14).stroke({ width: 1.5, color: 0xffffff })
        g.moveTo(8, 4).lineTo(12, -12).stroke({ width: 1.5, color: 0xffffff })
        g.moveTo(34, 5).lineTo(30, 16).stroke({ width: 1.5, color: 0xffffff })
    })
    // Ground decals (tinted at runtime)
    atlas.add('scorch', 128, 128, g => {
        softEllipse(g, 0, 0, 62, 58, 0xffffff, 14, 0.85)
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + (i % 3) * 0.3
            const r = 40 + (i % 4) * 7
            g.circle(Math.cos(a) * r, Math.sin(a) * r, 9 + (i % 3) * 3).fill({ color: 0xffffff, alpha: 0.22 })
        }
    })
    atlas.add('splat', 64, 64, g => {
        g.circle(0, 0, 14).fill({ color: 0xffffff, alpha: 0.8 })
        const n = 9
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + (i % 2) * 0.4
            const r = 16 + (i % 3) * 6
            g.circle(Math.cos(a) * r, Math.sin(a) * r, 2.5 + (i % 3) * 1.5).fill({ color: 0xffffff, alpha: 0.75 })
            g.moveTo(0, 0).lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9).stroke({ width: 3, color: 0xffffff, alpha: 0.6 })
        }
    })
    atlas.add('decal.crack', 96, 96, g => {
        for (let k = 0; k < 7; k++) {
            let a = (k / 7) * Math.PI * 2 + (k % 2) * 0.3
            let x = 0
            let y = 0
            g.moveTo(0, 0)
            for (let j = 0; j < 4; j++) {
                a += ((j * 7 + k * 3) % 5 - 2) * 0.18
                x += Math.cos(a) * 11
                y += Math.sin(a) * 11
                g.lineTo(x, y)
            }
            g.stroke({ width: 2.2 - k * 0.1, color: 0xffffff, join: 'round' })
        }
    })
}

// ─── Floor decorations ───────────────────────────────────────────────────

function bakeDecor(atlas: AtlasBaker): void {
    atlas.add('deco.circle', 160, 160, g => {
        g.circle(0, 0, 74).stroke({ width: 2.5, color: 0xffffff, alpha: 0.9 })
        g.circle(0, 0, 64).stroke({ width: 1.2, color: 0xffffff, alpha: 0.6 })
        g.circle(0, 0, 30).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 })
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2
            const b = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2
            g.moveTo(Math.cos(a) * 64, Math.sin(a) * 64).lineTo(Math.cos(b) * 64, Math.sin(b) * 64).stroke({ width: 1.4, color: 0xffffff, alpha: 0.7 })
        }
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2
            const cx = Math.cos(a) * 69
            const cy = Math.sin(a) * 69
            g.moveTo(cx - 3, cy - 3).lineTo(cx + 3, cy + 3).stroke({ width: 1.5, color: 0xffffff })
            g.moveTo(cx + 3, cy - 3).lineTo(cx, cy).stroke({ width: 1.5, color: 0xffffff })
        }
    })
    atlas.add('deco.crystal', 64, 72, g => {
        soft(g, 0, 18, 26, 0xffffff, 8, 0.35)
        const cr = (x: number, y: number, h: number, w: number, lean: number) => {
            g.poly([x, y, x + w + lean, y - h * 0.8, x + lean, y - h, x - w + lean, y - h * 0.8]).fill(0x8a7aa8)
            g.poly([x, y, x + lean, y - h, x - w + lean, y - h * 0.8]).fill(0xd8d0ff)
            g.poly([x, y, x + w + lean, y - h * 0.8, x + lean, y - h]).fill(0xffffff)
        }
        g.ellipse(0, 24, 20, 6).fill({ color: 0x000000, alpha: 0.5 })
        cr(-10, 24, 26, 6, -5)
        cr(9, 24, 22, 5, 5)
        cr(0, 26, 42, 8, 0)
        cr(-3, 26, 16, 5, -9)
    })
    atlas.add('deco.bones', 64, 40, g => {
        const bone = (x1: number, y1: number, x2: number, y2: number) => {
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 3, color: 0xcfc4ac, cap: 'round' })
            g.circle(x1, y1, 2.6).fill(0xcfc4ac)
            g.circle(x2, y2, 2.6).fill(0xcfc4ac)
        }
        bone(-22, 8, 2, 2)
        bone(-6, 12, 18, 6)
        bone(6, -2, 24, 10)
        g.circle(-8, -6, 7).fill(0xd8ccb4)
        g.roundRect(-12, -2, 8, 5, 1.5).fill(0xd8ccb4)
        g.circle(-10.5, -7, 2).fill(0x1a1018)
        g.circle(-5.5, -7, 2).fill(0x1a1018)
    })
    atlas.add('deco.rubble', 72, 48, g => {
        const rock = (x: number, y: number, r: number, c: number) => {
            g.ellipse(x, y + r * 0.5, r * 1.1, r * 0.45).fill({ color: 0x000000, alpha: 0.4 })
            g.poly([x - r, y, x - r * 0.4, y - r * 0.8, x + r * 0.6, y - r * 0.7, x + r, y + r * 0.1, x + r * 0.3, y + r * 0.5, x - r * 0.6, y + r * 0.45]).fill(c)
            g.poly([x - r * 0.4, y - r * 0.8, x + r * 0.6, y - r * 0.7, x + r * 0.2, y - r * 0.2, x - r * 0.5, y - r * 0.15]).fill(shade(c, 1.35))
        }
        rock(-16, 6, 11, 0x3a3448)
        rock(10, 2, 14, 0x443e54)
        rock(24, 12, 6, 0x3a3448)
        rock(-2, 14, 5, 0x4a4460)
    })
    atlas.add('deco.pillar', 72, 120, g => {
        g.ellipse(0, 46, 30, 10).fill({ color: 0x000000, alpha: 0.5 })
        g.roundRect(-24, 32, 48, 14, 3).fill(0x2a2438)
        g.roundRect(-18, -30, 36, 66, 3).fill(0x3a3450)
        g.rect(-18, -30, 10, 66).fill(0x2e2842)
        g.rect(10, -30, 5, 66).fill(0x4a4462)
        g.poly([-18, -30, -10, -48, 4, -40, 12, -52, 18, -30]).fill(0x3a3450)
        g.rect(-7, -6, 14, 3).fill({ color: 0xb08aff, alpha: 0.8 })
        g.rect(-7, 6, 14, 3).fill({ color: 0xb08aff, alpha: 0.6 })
    })
}

// Biome dressing: lava pools, ember vents, ice spires, snow drifts,
// mushrooms, storm pylons and void tears. Glowing parts are baked white so
// the additive layer can tint them per biome.
function bakeBiomeDecor(atlas: AtlasBaker): void {
    atlas.add('deco.lava', 150, 90, g => {
        const blob = (rx: number, ry: number, k: number) => {
            const pts: number[] = []
            for (let i = 0; i < 14; i++) {
                const a = (i / 14) * Math.PI * 2
                const w = 1 + Math.sin(a * 3 + k) * 0.12 + Math.cos(a * 5 + k * 2) * 0.08
                pts.push(Math.cos(a) * rx * w, Math.sin(a) * ry * w)
            }
            return pts
        }
        g.poly(blob(68, 38, 0)).fill(0x1a0805)
        g.poly(blob(60, 32, 1)).fill(0x3a120a)
        g.poly(blob(50, 25, 2)).fill(0xc8340c)
        g.poly(blob(40, 19, 3)).fill(0xff6a1a)
        g.poly(blob(26, 11, 4)).fill(0xffb040)
        g.poly(blob(12, 5, 5)).fill(0xffe8a0)
        for (let i = 0; i < 5; i++) {
            const a = i * 1.3
            g.ellipse(Math.cos(a) * 30, Math.sin(a) * 14, 7, 3.5).fill({ color: 0x2a0c06, alpha: 0.8 })
        }
    })
    atlas.add('deco.vent', 72, 60, g => {
        g.ellipse(0, 14, 32, 11).fill({ color: 0x000000, alpha: 0.5 })
        g.poly([-30, 14, -18, -6, -8, -12, 8, -12, 18, -6, 30, 14]).fill(0x2a1812)
        g.poly([-18, -6, -8, -12, 8, -12, 18, -6, 6, -2, -6, -2]).fill(0x4a2a1e)
        g.ellipse(0, -9, 10, 4).fill(0xff7a20)
        g.ellipse(0, -9, 5, 2).fill(0xffe0a0)
    })
    atlas.add('deco.ice', 80, 100, g => {
        g.ellipse(0, 38, 30, 9).fill({ color: 0x000000, alpha: 0.35 })
        const spike = (x: number, h: number, w: number, lean: number) => {
            g.poly([x - w, 40, x + lean, 40 - h, x + w, 40]).fill(0x5a90c0)
            g.poly([x - w, 40, x + lean, 40 - h, x, 40]).fill(0xbfe6ff)
            g.poly([x + lean * 0.9, 40 - h * 0.9, x + lean, 40 - h, x + w * 0.3, 40 - h * 0.5]).fill(0xffffff)
        }
        spike(-18, 34, 8, -6)
        spike(16, 42, 9, 5)
        spike(0, 72, 11, 1)
        spike(-6, 24, 6, -3)
        spike(24, 20, 5, 6)
    })
    atlas.add('deco.snow', 120, 54, g => {
        g.ellipse(0, 10, 54, 16).fill({ color: 0x7aa0c8, alpha: 0.35 })
        g.ellipse(-14, 4, 34, 13).fill(0xd8ecff)
        g.ellipse(18, 6, 30, 11).fill(0xe8f4ff)
        g.ellipse(-4, 0, 22, 9).fill(0xffffff)
        g.ellipse(26, 2, 10, 4).fill(0xffffff)
    })
    atlas.add('deco.shroom', 90, 90, g => {
        const m = (x: number, y: number, r: number, h: number) => {
            g.ellipse(x, y + 2, r * 0.8, r * 0.25).fill({ color: 0x000000, alpha: 0.45 })
            g.roundRect(x - r * 0.18, y - h, r * 0.36, h, r * 0.15).fill(0x8a9a90)
            g.ellipse(x, y - h, r, r * 0.55).fill(0x1a2a26)
            g.ellipse(x, y - h - r * 0.12, r * 0.9, r * 0.42).fill(0x24403a)
        }
        m(-20, 34, 14, 24)
        m(14, 36, 11, 18)
        m(-2, 30, 20, 40)
        m(26, 26, 7, 12)
    })
    atlas.add('deco.shroomCap', 90, 90, g => {
        const c = (x: number, y: number, r: number, h: number) => {
            g.ellipse(x, y - h - r * 0.12, r * 0.86, r * 0.38).fill({ color: 0xffffff, alpha: 0.75 })
            for (let i = 0; i < 3; i++) g.circle(x + (i - 1) * r * 0.45, y - h - r * 0.2, r * 0.12).fill(0xffffff)
        }
        c(-20, 34, 14, 24)
        c(14, 36, 11, 18)
        c(-2, 30, 20, 40)
        c(26, 26, 7, 12)
    })
    atlas.add('deco.pylon', 60, 140, g => {
        g.ellipse(0, 60, 24, 8).fill({ color: 0x000000, alpha: 0.5 })
        g.poly([-16, 60, -6, -40, 6, -40, 16, 60]).fill(0x2a3040)
        g.poly([-6, -40, 6, -40, 3, 60, -3, 60]).fill(0x3a4458)
        for (let i = 0; i < 4; i++) g.roundRect(-11 + i, -24 + i * 18, 22 - i * 2, 5, 2).fill(0x6a7a98)
        g.circle(0, -48, 9).fill(0x8ab0d8)
        g.circle(0, -48, 5).fill(0xffffff)
    })
    atlas.add('deco.tear', 70, 140, g => {
        const pts = [0, -62, 7, -36, 4, -14, 11, 8, 5, 30, 8, 62, 0, 40, -6, 18, -3, -6, -9, -30]
        g.poly(pts).fill({ color: 0xffffff, alpha: 0.35 })
        g.poly(pts.map((v, i) => i % 2 === 0 ? v * 0.45 : v * 0.92)).fill({ color: 0xffffff, alpha: 0.9 })
    })
}

// ─── Allies ──────────────────────────────────────────────────────────────

function bakeAllies(atlas: AtlasBaker): void {
    atlas.add('skeleton', 36, 40, g => {
        const bone = 0xe8e0cc
        g.rect(-5, 6, 3, 12).fill(bone)
        g.rect(2, 6, 3, 12).fill(bone)
        g.roundRect(-7, -4, 14, 12, 3).fill(bone)
        g.rect(-6, -1, 12, 1.5).fill(0x6a5a4a)
        g.rect(-6, 3, 12, 1.5).fill(0x6a5a4a)
        g.circle(0, -11, 8).fill(bone)
        g.circle(-3, -11, 2.3).fill(0x2a1040)
        g.circle(3.5, -11, 2.3).fill(0x2a1040)
        g.circle(-3, -11, 1).fill(0xd080ff)
        g.circle(3.5, -11, 1).fill(0xd080ff)
        g.moveTo(8, -6).lineTo(16, -16).stroke({ width: 2.5, color: 0xa8a8b8 })
    })
    atlas.add('wraith', 44, 48, g => {
        soft(g, 0, 0, 22, 0x9a5aff, 10, 0.6)
        g.moveTo(-10, -6).quadraticCurveTo(0, -24, 10, -6).lineTo(12, 14).lineTo(6, 8).lineTo(2, 16).lineTo(-3, 9).lineTo(-8, 16).lineTo(-12, 12).closePath().fill({ color: 0xd8c0ff, alpha: 0.85 })
        g.circle(-3.5, -8, 2.5).fill(0x2a0a50)
        g.circle(3.5, -8, 2.5).fill(0x2a0a50)
        g.circle(-3.5, -8, 1.1).fill(0xffffff)
        g.circle(3.5, -8, 1.1).fill(0xffffff)
    })
}

export function bakeEngineArt(atlas: AtlasBaker): void {
    bakeFx(atlas)
    bakeProjectiles(atlas)
    bakePickups(atlas)
    bakeAllies(atlas)
    bakeAbilityArt(atlas)
    bakeDecor(atlas)
    bakeBiomeDecor(atlas)
    bakeHeroes(atlas)
}

// ─── Canvas art: floor, vignette ─────────────────────────────────────────

function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

/** Seamless rune-carved stone floor tile. */
export function makeFloorCanvas(size = 512): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = size
    cv.height = size
    const ctx = cv.getContext('2d')!
    const rnd = lcg(1337)
    ctx.fillStyle = '#100d18'
    ctx.fillRect(0, 0, size, size)

    // Draw a callback at every wrapped offset so the tile is seamless
    const wrap = (fn: (ox: number, oy: number) => void) => {
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) fn(ox, oy)
        }
    }

    // Stone slabs: rows of offset blocks
    const rows = 8
    const rowH = size / rows
    for (let r = 0; r < rows; r++) {
        const cols = 4 + Math.floor(rnd() * 3)
        const colW = size / cols
        const shift = rnd() * colW
        for (let c = 0; c < cols; c++) {
            const x = c * colW + shift
            const y = r * rowH
            const tone = 22 + Math.floor(rnd() * 12)
            const hue = rnd() < 0.15 ? 6 : 0
            const fill = `rgb(${tone + hue},${tone - 3},${tone + 10 + hue})`
            const w = colW - 3
            const h = rowH - 3
            wrap((ox, oy) => {
                const X = x + ox + 1.5
                const Y = y + oy + 1.5
                const grad = ctx.createLinearGradient(X, Y, X + w, Y + h)
                grad.addColorStop(0, `rgb(${tone + hue + 8},${tone + 4},${tone + 20 + hue})`)
                grad.addColorStop(1, fill)
                ctx.fillStyle = grad
                ctx.fillRect(X, Y, w, h)
                // Bevel: lit top-left, shaded bottom-right
                ctx.fillStyle = 'rgba(200,180,255,0.07)'
                ctx.fillRect(X, Y, w, 2)
                ctx.fillRect(X, Y, 2, h)
                ctx.fillStyle = 'rgba(0,0,0,0.35)'
                ctx.fillRect(X, Y + h - 2, w, 2.5)
                ctx.fillRect(X + w - 2, Y, 2.5, h)
            })
            // Chipped corners and speckles
            for (let k = 0; k < 10; k++) {
                const px = x + rnd() * w
                const py = y + rnd() * h
                const light = rnd() < 0.4
                const sw = 1.5 + rnd() * 2
                const sh = 1.5 + rnd() * 2
                wrap((ox, oy) => {
                    ctx.fillStyle = light ? 'rgba(220,200,255,0.06)' : 'rgba(0,0,0,0.22)'
                    ctx.fillRect(px + ox, py + oy, sw, sh)
                })
            }
            // Inner wear blotches
            for (let k = 0; k < 3; k++) {
                const bx = x + rnd() * w
                const by = y + rnd() * h
                const br = 6 + rnd() * 16
                const dark = rnd() < 0.5
                wrap((ox, oy) => {
                    const grad = ctx.createRadialGradient(bx + ox, by + oy, 0, bx + ox, by + oy, br)
                    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,255,0.04)')
                    grad.addColorStop(1, 'rgba(0,0,0,0)')
                    ctx.fillStyle = grad
                    ctx.fillRect(bx + ox - br, by + oy - br, br * 2, br * 2)
                })
            }
        }
    }

    // Cracks
    ctx.lineCap = 'round'
    for (let i = 0; i < 14; i++) {
        let x = rnd() * size
        let y = rnd() * size
        let a = rnd() * Math.PI * 2
        const pts: [number, number][] = [[x, y]]
        const n = 3 + Math.floor(rnd() * 5)
        for (let k = 0; k < n; k++) {
            a += (rnd() - 0.5) * 1.4
            const l = 6 + rnd() * 14
            x += Math.cos(a) * l
            y += Math.sin(a) * l
            pts.push([x, y])
        }
        wrap((ox, oy) => {
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'
            ctx.lineWidth = 1.3
            ctx.beginPath()
            pts.forEach(([px, py], j) => j === 0 ? ctx.moveTo(px + ox, py + oy) : ctx.lineTo(px + ox, py + oy))
            ctx.stroke()
        })
    }

    // Faint glowing runes
    const runeColors = ['rgba(140,90,255,', 'rgba(90,200,255,', 'rgba(255,80,170,']
    for (let i = 0; i < 7; i++) {
        const cx = rnd() * size
        const cy = rnd() * size
        const rr = 7 + rnd() * 9
        const col = runeColors[Math.floor(rnd() * runeColors.length)]!
        const strokes: [number, number, number, number][] = []
        const m = 2 + Math.floor(rnd() * 3)
        for (let k = 0; k < m; k++) {
            const a1 = rnd() * Math.PI * 2
            const a2 = a1 + Math.PI * (0.5 + rnd())
            strokes.push([Math.cos(a1) * rr, Math.sin(a1) * rr, Math.cos(a2) * rr * 0.6, Math.sin(a2) * rr * 0.6])
        }
        const circle = rnd() < 0.6
        wrap((ox, oy) => {
            const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rr * 2.6)
            grad.addColorStop(0, col + '0.12)')
            grad.addColorStop(1, col + '0)')
            ctx.fillStyle = grad
            ctx.fillRect(cx + ox - rr * 3, cy + oy - rr * 3, rr * 6, rr * 6)
            ctx.strokeStyle = col + '0.4)'
            ctx.lineWidth = 1.4
            if (circle) {
                ctx.beginPath()
                ctx.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2)
                ctx.stroke()
            }
            for (const [x1, y1, x2, y2] of strokes) {
                ctx.beginPath()
                ctx.moveTo(cx + ox + x1, cy + oy + y1)
                ctx.lineTo(cx + ox + x2, cy + oy + y2)
                ctx.stroke()
            }
        })
    }

    // Moss and lichen in the grout
    for (let i = 0; i < 40; i++) {
        const mx = rnd() * size
        const my = Math.round(rnd() * rows) * rowH + (rnd() - 0.5) * 4
        const mr = 3 + rnd() * 9
        const teal = rnd() < 0.6
        wrap((ox, oy) => {
            const grad = ctx.createRadialGradient(mx + ox, my + oy, 0, mx + ox, my + oy, mr)
            grad.addColorStop(0, teal ? 'rgba(40,90,80,0.5)' : 'rgba(70,40,100,0.45)')
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = grad
            ctx.fillRect(mx + ox - mr, my + oy - mr, mr * 2, mr * 2)
        })
    }

    // Faint glowing veins of rift energy along a few cracks
    for (let i = 0; i < 3; i++) {
        let x = rnd() * size
        let y = rnd() * size
        let a = rnd() * Math.PI * 2
        const pts: [number, number][] = [[x, y]]
        for (let k = 0; k < 8; k++) {
            a += (rnd() - 0.5) * 1.1
            x += Math.cos(a) * (8 + rnd() * 12)
            y += Math.sin(a) * (8 + rnd() * 12)
            pts.push([x, y])
        }
        const col = rnd() < 0.5 ? '150,90,255' : '255,70,170'
        wrap((ox, oy) => {
            for (const [wd, al] of [[6, 0.04], [2.5, 0.09], [1, 0.26]] as const) {
                ctx.strokeStyle = `rgba(${col},${al})`
                ctx.lineWidth = wd
                ctx.beginPath()
                pts.forEach(([px, py], j) => j === 0 ? ctx.moveTo(px + ox, py + oy) : ctx.lineTo(px + ox, py + oy))
                ctx.stroke()
            }
        })
    }

    // Grain
    const img = ctx.getImageData(0, 0, size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
        const n = (rnd() - 0.5) * 10
        d[i] = Math.max(0, Math.min(255, d[i]! + n))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n))
    }
    ctx.putImageData(img, 0, 0)
    return cv
}

/** Low-frequency dark/light patches laid over the floor to hide the repeat. */
export function makePatchCanvas(size = 256): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = size
    cv.height = size
    const ctx = cv.getContext('2d')!
    const rnd = lcg(4242)
    ctx.clearRect(0, 0, size, size)
    for (let i = 0; i < 26; i++) {
        const x = rnd() * size
        const y = rnd() * size
        const r = 20 + rnd() * 60
        const tint = rnd()
        const col = tint < 0.6 ? 'rgba(0,0,0,' : tint < 0.8 ? 'rgba(90,40,160,' : 'rgba(30,90,140,'
        const a = tint < 0.6 ? 0.35 : 0.12
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) {
                const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
                grad.addColorStop(0, col + a + ')')
                grad.addColorStop(1, col + '0)')
                ctx.fillStyle = grad
                ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2)
            }
        }
    }
    return cv
}

export function makeVignetteCanvas(rgb: string, inner = 0.45, alpha = 0.85): HTMLCanvasElement {
    const size = 256
    const cv = document.createElement('canvas')
    cv.width = size
    cv.height = size
    const ctx = cv.getContext('2d')!
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size * 0.72)
    grad.addColorStop(0, `rgba(${rgb},0)`)
    grad.addColorStop(1, `rgba(${rgb},${alpha})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    return cv
}
