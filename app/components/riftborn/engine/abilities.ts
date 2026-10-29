/*
 * Castable abilities on Q / F / R. Slot 1 is open from the start, slot 2
 * opens at level 8 and slot 3 at level 18. Each ability has 5 levels; level
 * 5 adds its mastery. Abilities act through an AbilityCtx that stamps their
 * damage source, so they show up in the results breakdown.
 *
 * Always use the closure `ctx` inside projectile/zone callbacks: those
 * callbacks receive the plain game context, which carries no source.
 */
import { randomFloat } from '#shared/utils/random'
import type { AbilityCtx, AbilityDef, AbilityMods, AStats, EnemyRt, PlayerStats } from './core'

const TAU = Math.PI * 2

export const ABILITY_MAX_LEVEL = 5
export const ABILITY_KEYS = ['Q', 'F', 'R'] as const
/** Player level each slot opens at */
export const ABILITY_SLOT_LEVELS = [1, 8, 18] as const

function rnd(min: number, max: number): number {
    return min + randomFloat() * (max - min)
}

function nearestN(ctx: AbilityCtx, x: number, y: number, n: number, range: number, skip?: Set<number>): EnemyRt[] {
    const out: { e: EnemyRt, d: number }[] = []
    const r2 = range * range
    for (const e of ctx.enemies) {
        if (e.dead || e.untargetable || skip?.has(e.uid)) continue
        const d = (e.x - x) ** 2 + (e.y - y) ** 2
        if (d < r2) out.push({ e, d })
    }
    out.sort((a, b) => a.d - b.d)
    return out.slice(0, n).map(o => o.e)
}

function turnToward(cur: number, want: number, maxStep: number): number {
    let d = want - cur
    d = Math.atan2(Math.sin(d), Math.cos(d))
    return cur + Math.max(-maxStep, Math.min(maxStep, d))
}

function heroGhost(ctx: AbilityCtx, x: number, y: number, color: number, life: number, alpha: number, flip: boolean): void {
    ctx.fx.sprite(`hero.${ctx.cls.id}.w`, x, y - 4, { life, color, size0: 70, size1: 64, a0: alpha, a1: 0, flip })
}

// ─── Blink Strike ────────────────────────────────────────────────────────

const blink: AbilityDef = {
    id: 'blink',
    name: 'Blink Strike',
    icon: 'i-lucide-swords',
    color: 0x9fd8ff,
    description: 'Teleport toward the cursor and hit every enemy on the path.',
    mastery: 'Leaves a damaging rift along the path.',
    base: { damage: 48, cooldown: 6, radius: 330, duration: 3 },
    levels: [{ damage: 0.3 }, { cooldown: 0.15 }, { charges: 1 }, { damage: 0.4, radius: 0.2 }],
    cast(ctx, a, s) {
        const p = ctx.player
        const t = ctx.aimPoint(s.radius)
        let dx = t.x - p.x
        let dy = t.y - p.y
        let d = Math.hypot(dx, dy)
        if (d < 1) {
            dx = p.facing
            dy = 0
            d = 1
        }
        const len = Math.max(140, Math.min(s.radius, d))
        const nx = dx / d
        const ny = dy / d
        const ox = p.x
        const oy = p.y
        const ex = ox + nx * len
        const ey = oy + ny * len
        const hits = new Set<number>()
        const struck: EnemyRt[] = []
        for (let k = 0; k <= len; k += 36) {
            ctx.query(ox + nx * k, oy + ny * k, 48, e => {
                if (hits.has(e.uid)) return
                hits.add(e.uid)
                struck.push(e)
            })
        }
        for (let i = 0; i < 7; i++) {
            const f = i / 7
            heroGhost(ctx, ox + nx * len * f, oy + ny * len * f, a.def.color, 0.18 + f * 0.25, 0.2 + f * 0.45, nx < 0)
        }
        ctx.fx.lightning(ox, oy, ex, ey, 0xffffff, 3, 0.2, 0.25)
        ctx.fx.sprite('beam', (ox + ex) / 2, (oy + ey) / 2, { life: 0.3, color: a.def.color, size0: len, size1: len, a0: 0.9, a1: 0, rot: Math.atan2(ny, nx), aspect: 0.35 })
        ctx.fx.ring(ox, oy, a.def.color, 10, 70, 0.3, 0.9)
        ctx.teleport(ex, ey)
        ctx.grantIframes(0.4)
        ctx.fx.ring(ex, ey, 0xffffff, 10, 110, 0.35, 1)
        ctx.fx.burst(ex, ey, { count: 24, color: a.def.color, tex: 'p.spark', speed: 520, life: 0.35, size: 8 })
        const ang = Math.atan2(ny, nx)
        ctx.schedule(0.07, () => {
            for (const e of struck) {
                if (e.dead) continue
                ctx.hit(e, s.damage, { knock: 380, kx: -ny, ky: nx, color: a.def.color, critBonus: 0.15 })
                ctx.fx.sprite('slash', e.x, e.y, { life: 0.22, color: 0xffffff, size0: 40, size1: 90, rot: ang + Math.PI / 2 + rnd(-0.4, 0.4), a0: 1 })
                ctx.fx.burst(e.x, e.y, { count: 6, color: a.def.color, tex: 'p.spark', speed: 420, life: 0.25, size: 7, angle: ang, spread: 1.2 })
            }
            if (struck.length) {
                ctx.hitStop(0.05)
                ctx.shake(Math.min(0.45, 0.12 + struck.length * 0.02))
                ctx.play('crit', { volume: 0.6, pitch: 0.8 })
            }
        })
        if (s.mastery) {
            for (let k = 0; k <= 4; k++) {
                const f = k / 4
                ctx.zone({ x: ox + nx * len * f, y: oy + ny * len * f, radius: 46, life: s.duration, tick: 0.3, damage: s.damage * 0.12, color: a.def.color, kind: 'rift', hit: { slow: 0.4, slowT: 0.5 } })
            }
        }
        ctx.play('blink', { volume: 0.9 })
        ctx.shake(0.12)
        return true
    }
}

// ─── Glacial Nova ────────────────────────────────────────────────────────

function novaWave(ctx: AbilityCtx, s: AStats, R: number, dmg: number, shatter: boolean, color: number): void {
    const p = ctx.player
    const x = p.x
    const y = p.y
    const seen = new Set<number>()
    for (let k = 1; k <= 7; k++) {
        ctx.schedule((k - 1) * 0.035, () => {
            ctx.query(x, y, (R * k) / 7, e => {
                if (seen.has(e.uid)) return
                seen.add(e.uid)
                ctx.hit(e, dmg, { freeze: shatter ? 0 : s.duration, slow: 0.5, slowT: s.duration + 1.5, shatter, knock: 160, sx: x, sy: y, color })
                ctx.fx.burst(e.x, e.y, { count: 4, color: 0xdff6ff, tex: 'p.shard', speed: 200, life: 0.45, size: 7 })
            })
        })
    }
    ctx.fx.ring(x, y, color, 20, R * 1.05, 0.4, 1)
    ctx.fx.ring(x, y, 0xffffff, 10, R * 0.8, 0.3, 0.8, true)
    ctx.fx.sprite('disc', x, y, { life: 0.45, color: 0x5ab8ff, size0: R * 0.5, size1: R * 2.2, a0: 0.3, a1: 0 })
    ctx.fx.sprite('frostSigil', x, y, { life: 0.9, color: 0xbfe8ff, size0: R * 0.8, size1: R * 2.1, a0: 0.8, a1: 0, vrot: 1.5 })
    ctx.fx.burst(x, y, { count: 50, color: 0xdff6ff, tex: 'p.shard', speed: R * 3.6, life: 0.5, size: 9, drag: 3.5 })
    ctx.fx.burst(x, y, { count: 18, color: 0xffffff, tex: 'p.spark', speed: R * 4.5, life: 0.3, size: 9 })
    ctx.fx.scorch(x, y, R * 0.9, 0x9fe0ff, 4, 'frost')
}

const glacial: AbilityDef = {
    id: 'glacial',
    name: 'Glacial Nova',
    icon: 'i-lucide-snowflake',
    color: 0x9fe0ff,
    description: 'Freezes enemies around you.',
    mastery: 'A second wave shatters frozen enemies for triple damage.',
    base: { damage: 32, cooldown: 10, radius: 240, duration: 2 },
    levels: [{ radius: 0.15, damage: 0.2 }, { duration: 0.3 }, { cooldown: 0.15 }, { damage: 0.4, radius: 0.15 }],
    cast(ctx, a, s) {
        novaWave(ctx, s, s.radius, s.damage, false, a.def.color)
        if (s.mastery) ctx.schedule(0.55, () => novaWave(ctx, s, s.radius * 1.1, s.damage * 1.2, true, 0xffffff))
        ctx.flash(0x9fe0ff, 0.15)
        ctx.shake(0.3)
        ctx.play('nova', { volume: 0.9 })
        ctx.play('frost', { volume: 0.8, pitch: 0.7 })
        return true
    }
}

// ─── Meteor ──────────────────────────────────────────────────────────────

function dropMeteor(ctx: AbilityCtx, s: AStats, x: number, y: number, scale: number): void {
    const R = s.radius * scale
    const fall = 0.55 + scale * 0.15
    ctx.fx.sprite('disc', x, y, { life: fall, color: 0xff4a10, size0: R * 0.3, size1: R * 2.1, a0: 0.2, a1: 0.75, easeOut: false })
    ctx.fx.ring(x, y, 0xff6a2a, R, R * 0.92, fall, 0.9)
    ctx.fx.sprite('runeRing', x, y, { life: fall, color: 0xffa040, size0: R * 2.2, size1: R * 1.9, a0: 0.8, a1: 0.2, vrot: 2 })
    const sx = x + 300 * scale
    const sy = y - 760 * scale
    ctx.projectile({
        x: sx,
        y: sy,
        vx: (x - sx) / fall,
        vy: (y - sy) / fall,
        tex: 'meteor',
        scale: 2.6 * scale,
        radius: 0,
        damage: 0,
        life: fall,
        noCollide: true,
        glow: 0xff5a10,
        glowSize: 260 * scale,
        spin: 4,
        faceVel: false,
        trail: { color: 0xff7a20, rate: 120, tex: 'p.flame', size: 20 * scale, life: 0.45 },
        onEnd: () => {
            ctx.explode(x, y, R, s.damage * scale, { burn: s.damage * 0.12 * scale, burnT: 4, knock: 620, sx: x, sy: y, visual: 'fire', sfx: true, shake: 0.55 * scale })
            ctx.fx.ring(x, y, 0xfff0c0, R * 0.3, R * 1.5, 0.45, 1)
            ctx.fx.burst(x, y, { count: 26, color: 0x2a1610, tex: 'p.square', speed: 620, life: 0.8, size: 9, normal: true, gravity: 700 })
            ctx.fx.burst(x, y, { count: 10, color: 0x40302a, tex: 'p.smoke', speed: 160, life: 1.4, size: 30, normal: true, alpha: 0.5, grow: 2.4, drag: 2 })
            ctx.fx.scorch(x, y, R * 1.05, 0x000000, 7, 'burn')
            if (scale >= 1) {
                ctx.zone({ x, y, radius: R * 0.7, life: s.duration, tick: 0.35, damage: s.damage * 0.07, color: 0xff4a10, kind: 'magma', hit: { burn: s.damage * 0.05, burnT: 2 } })
                ctx.flash(0xff7a20, 0.25)
                ctx.hitStop(0.06)
            }
        }
    })
}

const meteor: AbilityDef = {
    id: 'meteor',
    name: 'Meteor',
    icon: 'i-lucide-flame',
    color: 0xff6a2b,
    description: 'Drops a meteor on the target. Leaves a burning crater.',
    mastery: '4 smaller meteors follow.',
    base: { damage: 130, cooldown: 11, radius: 150, duration: 3 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { charges: 1 }, { damage: 0.4, cooldown: 0.1 }],
    cast(ctx, a, s) {
        const t = ctx.aimPoint(620)
        dropMeteor(ctx, s, t.x, t.y, 1)
        if (s.mastery) {
            for (let i = 0; i < 4; i++) {
                const ang = (i / 4) * TAU + rnd(0, 1)
                const d = rnd(0.8, 1.3) * s.radius
                ctx.schedule(0.35 + i * 0.12, () => dropMeteor(ctx, s, t.x + Math.cos(ang) * d, t.y + Math.sin(ang) * d, 0.5))
            }
        }
        ctx.play('castHeavy', { volume: 0.9 })
        return true
    }
}

// ─── Chrono Field ────────────────────────────────────────────────────────

const chrono: AbilityDef = {
    id: 'chrono',
    name: 'Chrono Field',
    icon: 'i-lucide-hourglass',
    color: 0x8fd8ff,
    description: 'For 5 s, slows enemies 65% and their shots 80% in an area.',
    mastery: 'Enemies inside take 30% more damage.',
    base: { damage: 8, cooldown: 16, radius: 250, duration: 5 },
    levels: [{ radius: 0.15 }, { duration: 0.25 }, { cooldown: 0.15 }, { radius: 0.2, duration: 0.2 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const t = ctx.aimPoint(480)
        const R = s.radius
        ctx.chrono(t.x, t.y, R, s.duration, 0.65, 0.8, s.mastery ? 0.3 : 0)
        ctx.zone({ x: t.x, y: t.y, radius: R, life: s.duration, tick: 0.5, damage: s.damage, color: a.def.color, kind: 'holy', hit: { slow: 0.65, slowT: 0.6, noNumber: true } })
        ctx.fx.sprite('clock', t.x, t.y, { life: s.duration, color: a.def.color, size0: R * 2, size1: R * 2, a0: 0.75, a1: 0, vrot: -0.6, easeOut: false })
        ctx.fx.sprite('clockHand', t.x, t.y, { life: s.duration, color: 0xffffff, size0: R * 1.6, size1: R * 1.6, a0: 0.7, a1: 0, vrot: 2.2, easeOut: false })
        ctx.fx.ring(t.x, t.y, 0xffffff, R * 1.4, R, 0.4, 1)
        ctx.fx.burst(t.x, t.y, { count: 30, color: a.def.color, tex: 'p.star', speed: 160, jitter: R * 0.7, life: 1, size: 7 })
        a.activeT = s.duration
        ctx.play('timeSlow', { volume: 0.9 })
        ctx.flash(0x8fd8ff, 0.1)
        return true
    }
}

// ─── Gravity Well ────────────────────────────────────────────────────────

const gravity: AbilityDef = {
    id: 'gravity',
    name: 'Gravity Well',
    icon: 'i-lucide-orbit',
    color: 0xc06bff,
    description: 'Pulls enemies together, then implodes.',
    mastery: 'Pulls elites too and implodes twice.',
    base: { damage: 105, cooldown: 13, radius: 280, duration: 2.2 },
    levels: [{ damage: 0.3 }, { radius: 0.15 }, { cooldown: 0.15 }, { damage: 0.4, duration: 0.2 }],
    cast(ctx, a, s) {
        const t = ctx.aimPoint(500)
        const R = s.radius
        const color = a.def.color
        const implode = (x: number, y: number, mul: number) => {
            ctx.explode(x, y, R * 0.75, s.damage * mul, { knock: 700, sx: x, sy: y, visual: 'void', color, sfx: true, shake: 0.6 })
            ctx.fx.ring(x, y, 0xffffff, 30, R * 1.2, 0.45, 1)
            ctx.fx.ring(x, y, color, 20, R * 1.5, 0.6, 1)
            ctx.fx.burst(x, y, { count: 60, color: 0xe0b0ff, tex: 'p.spark', speed: 1000, life: 0.55, size: 10 })
            ctx.fx.scorch(x, y, R * 0.6, 0x000000, 6, 'void')
            ctx.flash(color, 0.3)
            ctx.hitStop(0.06)
        }
        ctx.zone({
            x: t.x,
            y: t.y,
            radius: R,
            life: s.duration,
            tick: 0.25,
            damage: s.damage * 0.04,
            color,
            kind: 'void',
            pull: 520,
            pullBosses: s.mastery,
            hit: { noNumber: true },
            onEnd: z => {
                implode(z.x, z.y, 1)
                if (s.mastery) ctx.schedule(0.45, () => implode(z.x, z.y, 0.8))
            }
        })
        ctx.fx.ring(t.x, t.y, color, R * 1.3, 20, 0.6, 0.9, true)
        ctx.play('gravity', { volume: 0.9 })
        ctx.shake(0.2)
        return true
    }
}

// ─── Holy Shield ─────────────────────────────────────────────────────────

const shield: AbilityDef = {
    id: 'shield',
    name: 'Holy Shield',
    icon: 'i-lucide-shield-plus',
    color: 0xffe27a,
    description: 'Absorbs damage for 6 s, then explodes.',
    mastery: 'Heals you for 30% of the damage absorbed.',
    base: { damage: 80, cooldown: 16, radius: 210, duration: 6 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { cooldown: 0.15 }, { damage: 0.4, duration: 0.2 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const hp = (20 + ctx.stats.maxHp * 0.3) * (1 + a.mods.damage * 0.5)
        a.activeT = s.duration
        ctx.shield(hp, s.duration, (broken, absorbed) => {
            a.activeT = 0
            const p = ctx.player
            const dmg = s.damage + absorbed * 2.5
            ctx.explode(p.x, p.y, s.radius, dmg, { knock: 650, sx: p.x, sy: p.y, visual: 'holy', stun: broken ? 1 : 0.4, shake: 0.45 })
            ctx.fx.ring(p.x, p.y, 0xffffff, 20, s.radius * 1.2, 0.4, 1)
            ctx.fx.burst(p.x, p.y, { count: 40, color: a.def.color, tex: 'p.shard', speed: 600, life: 0.6, size: 9 })
            ctx.flash(0xffe27a, 0.25)
            ctx.play('shieldBreak', { volume: 1 })
            if (s.mastery && absorbed > 0) ctx.heal(absorbed * 0.3, true)
        })
        const p = ctx.player
        ctx.fx.ring(p.x, p.y, a.def.color, 90, 30, 0.35, 1)
        ctx.fx.burst(p.x, p.y, { count: 24, color: a.def.color, tex: 'p.star', speed: 260, life: 0.6, size: 8 })
        ctx.play('shield', { volume: 0.9 })
        return true
    }
}

// ─── Blade Cyclone ───────────────────────────────────────────────────────

const cyclone: AbilityDef = {
    id: 'cyclone',
    name: 'Blade Cyclone',
    icon: 'i-lucide-tornado',
    color: 0xd8e6ff,
    description: 'Spin for 3 s, hitting everything around you. +25% move speed.',
    mastery: 'Throws blades outward while spinning.',
    base: { damage: 13, cooldown: 12, radius: 120, duration: 3 },
    levels: [{ damage: 0.3 }, { radius: 0.15 }, { duration: 0.25 }, { cooldown: 0.15, damage: 0.3 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        a.activeT = s.duration
        a.st.tick = 0
        a.st.fx = 0
        a.st.throw = 0
        a.st.spin = 0
        ctx.haste(s.duration, 1.25, 1, 0)
        ctx.play('castHeavy', { volume: 0.7, pitch: 1.3 })
        return true
    },
    tick(ctx, a, s, dt) {
        if (a.activeT <= 0) return
        const p = ctx.player
        const R = s.radius
        a.st.spin += dt * 16
        a.st.fx -= dt
        if (a.st.fx <= 0) {
            a.st.fx = 0.05
            ctx.fx.sprite('slash', p.x, p.y, { life: 0.16, color: a.def.color, size0: R * 1.9, size1: R * 2.3, rot: a.st.spin, vrot: 16, follow: p, a0: 0.85 })
            ctx.fx.sprite('slash', p.x, p.y, { life: 0.16, color: 0xffffff, size0: R * 1.5, size1: R * 1.9, rot: a.st.spin + Math.PI, vrot: 16, follow: p, a0: 0.6 })
            const ang = Math.random() * TAU
            ctx.fx.one(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R, 'p.spark', a.def.color, -Math.sin(ang) * 500, Math.cos(ang) * 500, 0.2, 7)
        }
        a.st.tick -= dt
        if (a.st.tick <= 0) {
            a.st.tick = 0.12
            let n = 0
            ctx.query(p.x, p.y, R, e => {
                n++
                ctx.hit(e, s.damage, { knock: 220, sx: p.x, sy: p.y, color: a.def.color, silent: n > 3 })
            })
            ctx.play('swing', { volume: 0.4, pitch: 1.4 + Math.random() * 0.3 }, 0.1)
        }
        if (s.mastery) {
            a.st.throw -= dt
            if (a.st.throw <= 0) {
                a.st.throw = 0.22
                const b = a.st.spin
                for (const off of [0, Math.PI]) {
                    ctx.projectile({ x: p.x, y: p.y, vx: Math.cos(b + off) * 620, vy: Math.sin(b + off) * 620, tex: 'glaive', scale: 0.7, radius: 14, damage: s.damage * 1.5, pierce: 6, life: 0.6, spin: 18, faceVel: false, additive: true, hit: { knock: 120 } })
                }
            }
        }
    }
}

// ─── Chain Nova ──────────────────────────────────────────────────────────

const chainNova: AbilityDef = {
    id: 'chainNova',
    name: 'Chain Nova',
    icon: 'i-lucide-zap',
    color: 0x63c7ff,
    description: 'Lightning strikes the 6 nearest enemies and stuns them.',
    mastery: 'Every strike arcs to 2 more enemies.',
    base: { damage: 62, cooldown: 7, radius: 440, duration: 0.8 },
    levels: [{ damage: 0.3 }, { cooldown: 0.15 }, { radius: 0.2 }, { damage: 0.4 }],
    cast(ctx, a, s) {
        const p = ctx.player
        const n = 6 + (s.level - 1) * 2
        const targets = nearestN(ctx, p.x, p.y, n, s.radius)
        if (!targets.length) return false
        const seen = new Set(targets.map(e => e.uid))
        targets.forEach((e, i) => {
            ctx.schedule(i * 0.03, () => {
                if (e.dead) return
                const pl = ctx.player
                ctx.fx.lightning(pl.x, pl.y - 18, e.x, e.y, 0x9fe6ff, 4, 0.28, 1.2)
                ctx.fx.lightning(e.x + rnd(-30, 30), e.y - 380, e.x, e.y, 0xffffff, 3, 0.22, 1.4)
                ctx.explode(e.x, e.y, 52, s.damage, { stun: s.duration, knock: 160, sx: pl.x, sy: pl.y, visual: 'plain', color: 0x9fe6ff })
                if (!s.mastery) return
                for (const o of nearestN(ctx, e.x, e.y, 2, 220, seen)) {
                    seen.add(o.uid)
                    ctx.schedule(0.08, () => {
                        if (o.dead) return
                        ctx.fx.lightning(e.x, e.y, o.x, o.y, 0xfff27a, 3, 0.22)
                        ctx.hit(o, s.damage * 0.6, { stun: s.duration * 0.5, color: 0xfff27a })
                    })
                }
            })
        })
        ctx.fx.ring(p.x, p.y, a.def.color, 10, 160, 0.35, 1)
        ctx.fx.burst(p.x, p.y, { count: 20, color: 0x9fe6ff, tex: 'p.spark', speed: 600, life: 0.3, size: 8 })
        ctx.flash(0x63c7ff, 0.12)
        ctx.shake(0.25)
        ctx.play('zap', { volume: 1, pitch: 0.7 })
        ctx.play('nova', { volume: 0.6, pitch: 1.3 })
        return true
    }
}

// ─── Sentry ──────────────────────────────────────────────────────────────

const sentry: AbilityDef = {
    id: 'sentry',
    name: 'Sentry',
    icon: 'i-lucide-radio-tower',
    color: 0x7fffd4,
    description: 'Deploys a turret that shoots nearby enemies for 10 s.',
    mastery: 'Turret shots pierce and explode.',
    base: { damage: 15, cooldown: 18, radius: 440, duration: 10 },
    levels: [{ damage: 0.3 }, { duration: 0.3 }, { charges: 1 }, { damage: 0.4, cooldown: 0.1 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const p = ctx.player
        const ang = randomFloat() * TAU
        const x = p.x + Math.cos(ang) * 30
        const y = p.y + Math.sin(ang) * 30
        a.activeT = Math.max(a.activeT, s.duration)
        const col = a.def.color
        ctx.fx.ring(x, y, col, 10, 90, 0.4, 1)
        ctx.fx.burst(x, y, { count: 16, color: col, tex: 'p.spark', speed: 300, life: 0.35, size: 7 })
        ctx.projectile({
            x,
            y,
            vx: 0,
            vy: 0,
            tex: 'turret',
            radius: 0,
            damage: 0,
            life: s.duration,
            noCollide: true,
            faceVel: false,
            scale: 0.1,
            glow: col,
            glowSize: 90,
            data: { cd: 0.3, ang: 0 },
            update: (t, _c, dt) => {
                t.scale = Math.min(1.15, t.scale + dt * 5)
                t.data.cd! -= dt
                const e = ctx.nearest(t.x, t.y, s.radius)
                if (e) {
                    t.data.ang = turnToward(t.data.ang!, Math.atan2(e.y - t.y, e.x - t.x), dt * 14)
                    t.sprite.rotation = t.data.ang!
                }
                if (t.data.cd! > 0 || !e) return
                t.data.cd = 0.15
                const b = t.data.ang!
                const mx = t.x + Math.cos(b) * 18
                const my = t.y + Math.sin(b) * 18
                ctx.fx.one(mx, my, 'p.dot', 0xffffff, 0, 0, 0.08, 18)
                ctx.projectile({
                    x: mx,
                    y: my,
                    vx: Math.cos(b) * 980,
                    vy: Math.sin(b) * 980,
                    tex: 'bolt',
                    radius: 9,
                    damage: s.damage,
                    pierce: s.mastery ? 3 : 1,
                    life: 0.7,
                    color: 0xc0fff0,
                    additive: true,
                    hit: { knock: 90 },
                    trail: { color: col, rate: 40, tex: 'p.spark', size: 4, life: 0.15 },
                    onHit: s.mastery ? (pr, en) => ctx.explode(en.x, en.y, 46, s.damage * 0.5, { visual: 'plain', color: col, knock: 80 }) : undefined
                })
                ctx.play('shoot', { volume: 0.25, pitch: 1.6 }, 0.06)
            },
            onEnd: t => {
                ctx.fx.ring(t.x, t.y, col, 10, 70, 0.3, 0.9)
                ctx.fx.burst(t.x, t.y, { count: 12, color: col, tex: 'p.square', speed: 260, life: 0.5, size: 6, gravity: 400 })
            }
        })
        ctx.play('turret', { volume: 0.8 })
        return true
    }
}

// ─── Orbital Laser ───────────────────────────────────────────────────────

function orbitalSweep(ctx: AbilityCtx, s: AStats, cx: number, cy: number, ang: number, color: number): void {
    const half = 230
    const px = Math.cos(ang)
    const py = Math.sin(ang)
    const x0 = cx - px * half
    const y0 = cy - py * half
    const warm = 0.35
    ctx.fx.ring(x0, y0, color, s.radius * 2, s.radius, warm, 0.9)
    ctx.projectile({
        x: x0,
        y: y0,
        vx: 0,
        vy: 0,
        tex: '',
        radius: 0,
        damage: 0,
        life: s.duration + warm,
        noCollide: true,
        glow: color,
        glowSize: s.radius * 5,
        data: { tick: 0, scorch: 0 },
        update: (b, _c, dt) => {
            if (b.age < warm) {
                ctx.fx.beam(b.x, b.y - 900, b.x, b.y, color, 3)
                return
            }
            const f = Math.min(1, (b.age - warm) / s.duration)
            b.x = x0 + px * half * 2 * f
            b.y = y0 + py * half * 2 * f
            const k = Math.min(1, (b.age - warm) / 0.08, b.life / 0.15)
            ctx.fx.beam(b.x, b.y - 900, b.x, b.y, color, s.radius * 0.9 * k)
            if (Math.random() < 0.8) ctx.fx.one(b.x + (Math.random() - 0.5) * s.radius, b.y, 'p.spark', 0xffffff, (Math.random() - 0.5) * 400, -200 - Math.random() * 300, 0.3, 8)
            b.data.scorch! -= dt
            if (b.data.scorch! <= 0) {
                b.data.scorch = 0.1
                ctx.fx.scorch(b.x, b.y, s.radius * 0.55, 0x000000, 4, 'burn')
            }
            b.data.tick! -= dt
            if (b.data.tick! > 0) return
            b.data.tick = 0.07
            ctx.query(b.x, b.y, s.radius, e => {
                ctx.hit(e, s.damage, { knock: 60, sx: b.x, sy: b.y, color, silent: true, burn: s.damage * 0.3, burnT: 1.5 })
            })
            ctx.shake(0.04)
        }
    })
}

const orbital: AbilityDef = {
    id: 'orbital',
    name: 'Orbital Laser',
    icon: 'i-lucide-satellite',
    color: 0xff5ad8,
    description: 'A sky laser sweeps across the target area.',
    mastery: 'Fires a second, crossing laser.',
    base: { damage: 17, cooldown: 12, radius: 62, duration: 1.6 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { duration: 0.25 }, { damage: 0.4, cooldown: 0.15 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const p = ctx.player
        const t = ctx.aimPoint(520)
        const ang = Math.atan2(t.y - p.y, t.x - p.x) + Math.PI / 2
        orbitalSweep(ctx, s, t.x, t.y, ang, a.def.color)
        if (s.mastery) orbitalSweep(ctx, s, t.x, t.y, ang + Math.PI / 2, 0xffd54f)
        a.activeT = s.duration + 0.35
        ctx.play('beam', { volume: 1 })
        ctx.flash(0xff5ad8, 0.1)
        return true
    }
}

// ─── Earthquake ──────────────────────────────────────────────────────────

function fissure(ctx: AbilityCtx, s: AStats, ang: number): void {
    const p = ctx.player
    const ox = p.x
    const oy = p.y
    const cx = Math.cos(ang)
    const cy = Math.sin(ang)
    const steps = Math.max(6, Math.round(s.radius / 46))
    const seen = new Set<number>()
    for (let i = 1; i <= steps; i++) {
        ctx.schedule(i * 0.035, () => {
            const d = i * 46
            const x = ox + cx * d + rnd(-8, 8)
            const y = oy + cy * d + rnd(-8, 8)
            ctx.query(x, y, 58, e => {
                if (seen.has(e.uid)) return
                seen.add(e.uid)
                const side = (e.x - x) * -cy + (e.y - y) * cx >= 0 ? 1 : -1
                ctx.hit(e, s.damage, { stun: s.duration, knock: 420, kx: -cy * side, ky: cx * side, color: 0xd8a070 })
            })
            ctx.fx.sprite('crack', x, y, { life: 0.9, color: 0xff9a40, size0: 90, size1: 110, rot: ang + rnd(-0.3, 0.3), a0: 1, a1: 0 })
            ctx.fx.sprite('glow', x, y, { life: 0.4, color: 0xff7a20, size0: 60, size1: 140, a0: 0.8, a1: 0 })
            ctx.fx.ring(x, y, 0xffc080, 10, 62, 0.25, 0.8)
            ctx.fx.scorch(x, y, 52, 0x000000, 6, 'crack', ang)
            ctx.fx.burst(x, y, { count: 9, color: 0x4a3426, tex: 'p.square', speed: 460, life: 0.7, size: 11, normal: true, gravity: 1000, angle: -Math.PI / 2, spread: 1.6 })
            ctx.fx.burst(x, y, { count: 3, color: 0x6a5446, tex: 'p.smoke', speed: 80, life: 0.9, size: 26, normal: true, alpha: 0.5, grow: 2 })
            ctx.fx.burst(x, y, { count: 4, color: 0xffa040, tex: 'p.spark', speed: 300, life: 0.25, size: 6 })
            if (i % 2 === 0) ctx.shake(0.08)
        })
    }
}

const quake: AbilityDef = {
    id: 'quake',
    name: 'Earthquake',
    icon: 'i-lucide-mountain',
    color: 0xd8a070,
    description: 'A fissure erupts toward the cursor and stuns for 1 s.',
    mastery: 'Splits into 3 fissures.',
    base: { damage: 58, cooldown: 9, radius: 500, duration: 1 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { cooldown: 0.15 }, { damage: 0.4, duration: 0.3 }],
    cast(ctx, _a, s) {
        const d = ctx.aimDir()
        const ang = Math.atan2(d.y, d.x)
        fissure(ctx, s, ang)
        if (s.mastery) {
            fissure(ctx, s, ang - 0.45)
            fissure(ctx, s, ang + 0.45)
        }
        ctx.play('quake', { volume: 1 })
        ctx.shake(0.35)
        return true
    }
}

// ─── Shadow Clones ───────────────────────────────────────────────────────

const clones: AbilityDef = {
    id: 'clones',
    name: 'Shadow Clones',
    icon: 'i-lucide-users',
    color: 0x9a6aff,
    description: 'Summons 3 clones that attack for 7 s.',
    mastery: 'Clones explode when they fade.',
    base: { damage: 24, cooldown: 18, radius: 120, duration: 7 },
    levels: [{ damage: 0.3 }, { charges: 1 }, { duration: 0.3 }, { charges: 1, damage: 0.3 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const p = ctx.player
        const n = 2 + s.charges
        for (let i = 0; i < n; i++) {
            const ang = (i / n) * TAU
            const x = p.x + Math.cos(ang) * 46
            const y = p.y + Math.sin(ang) * 46
            ctx.ally('shade', x, y, s.duration, {
                damage: s.damage,
                speed: 440,
                onEnd: s.mastery ? al => ctx.explode(al.x, al.y, s.radius, s.damage * 2, { visual: 'void', color: a.def.color, knock: 400, sx: al.x, sy: al.y, sfx: true }) : undefined
            })
            ctx.fx.burst(x, y, { count: 14, color: a.def.color, tex: 'p.smoke', speed: 180, life: 0.6, size: 14 })
        }
        a.activeT = s.duration
        ctx.fx.ring(p.x, p.y, a.def.color, 20, 140, 0.45, 1)
        ctx.play('summon', { volume: 0.9, pitch: 1.1 })
        return true
    }
}

// ─── Battle Cry ──────────────────────────────────────────────────────────

const battleCry: AbilityDef = {
    id: 'battleCry',
    name: 'Battle Cry',
    icon: 'i-lucide-megaphone',
    color: 0xff7a3a,
    description: 'For 6 s: +30% move speed, +40% fire rate, +20% crit chance. Knocks enemies back.',
    mastery: 'Also heals 20% of your max HP.',
    base: { damage: 26, cooldown: 20, radius: 250, duration: 6 },
    levels: [{ duration: 0.25 }, { radius: 0.2, damage: 0.3 }, { cooldown: 0.15 }, { duration: 0.3 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const p = ctx.player
        ctx.haste(s.duration, 1.3, 1.4, 0.2)
        a.activeT = s.duration
        ctx.explode(p.x, p.y, s.radius, s.damage, { knock: 900, sx: p.x, sy: p.y, visual: 'none', stun: 0.3 })
        for (let i = 0; i < 3; i++) ctx.schedule(i * 0.08, () => ctx.fx.ring(p.x, p.y, i === 1 ? 0xffffff : a.def.color, 20, s.radius * (1 + i * 0.2), 0.45, 1))
        ctx.fx.sprite('runeRing', p.x, p.y, { life: 0.8, color: 0xffb060, size0: 80, size1: s.radius * 2.4, a0: 1, a1: 0, vrot: 3 })
        ctx.fx.burst(p.x, p.y, { count: 40, color: a.def.color, tex: 'p.flame', speed: 520, life: 0.6, size: 14 })
        if (s.mastery) ctx.heal(ctx.stats.maxHp * 0.2, true)
        ctx.flash(0xff7a3a, 0.2)
        ctx.shake(0.4)
        ctx.play('castHeavy', { volume: 1, pitch: 0.8 })
        return true
    }
}

// ─── Blood Nova ──────────────────────────────────────────────────────────

const bloodNova: AbilityDef = {
    id: 'bloodNova',
    name: 'Blood Nova',
    icon: 'i-lucide-droplets',
    color: 0xff2050,
    description: 'Damages enemies around you and heals 1.5% max HP per enemy hit.',
    mastery: 'Leaves a pool that keeps draining.',
    base: { damage: 52, cooldown: 11, radius: 220, duration: 4 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { cooldown: 0.15 }, { damage: 0.4, radius: 0.1 }],
    cast(ctx, a, s) {
        const p = ctx.player
        const x = p.x
        const y = p.y
        const R = s.radius
        ctx.fx.ring(x, y, a.def.color, R * 1.2, 20, 0.25, 1, true)
        ctx.schedule(0.2, () => {
            let n = 0
            ctx.query(x, y, R, e => {
                n++
                ctx.hit(e, s.damage, { knock: 300, sx: x, sy: y, color: 0xff4060, silent: n > 4 })
                const pl = ctx.player
                for (let k = 0; k < 2; k++) ctx.fx.one(e.x, e.y, 'p.dot', 0xff2050, (pl.x - e.x) * 2.4 + (Math.random() - 0.5) * 80, (pl.y - e.y) * 2.4 + (Math.random() - 0.5) * 80, 0.42, 9)
            })
            ctx.heal(Math.min(ctx.stats.maxHp * 0.3, n * ctx.stats.maxHp * 0.015), true)
            ctx.fx.ring(x, y, 0xff6080, 20, R * 1.05, 0.35, 1)
            ctx.fx.sprite('disc', x, y, { life: 0.4, color: 0xff2050, size0: R * 0.5, size1: R * 2.2, a0: 0.55, a1: 0 })
            ctx.fx.burst(x, y, { count: 40, color: 0xff2050, tex: 'p.dot', speed: R * 3.5, life: 0.5, size: 8 })
            ctx.fx.scorch(x, y, R * 0.8, 0x5a0010, 6, 'blood')
            ctx.shake(0.3)
            ctx.play('nova', { volume: 0.9, pitch: 0.7 })
            if (s.mastery) {
                ctx.zone({ x, y, radius: R * 0.8, life: s.duration, tick: 0.4, damage: s.damage * 0.15, color: 0xff2050, kind: 'rift', hit: { noNumber: true }, onTick: () => ctx.heal(ctx.stats.maxHp * 0.004) })
            }
        })
        ctx.play('affixVamp', { volume: 0.8 })
        return true
    }
}

// ─── Dragon Breath ───────────────────────────────────────────────────────

const breath: AbilityDef = {
    id: 'breath',
    name: 'Dragon Breath',
    icon: 'i-lucide-flame-kindling',
    color: 0xff9a2a,
    description: 'Breathe fire where you aim for 2 s. Sets enemies ablaze.',
    mastery: 'Wider cone that leaves burning ground.',
    base: { damage: 10, cooldown: 10, radius: 250, duration: 2 },
    levels: [{ damage: 0.3 }, { radius: 0.2 }, { duration: 0.25 }, { damage: 0.4, cooldown: 0.15 }],
    active: a => a.activeT > 0,
    cast(ctx, a, s) {
        const d = ctx.aimDir()
        a.st.ang = Math.atan2(d.y, d.x)
        a.st.tick = 0
        a.st.zone = 0
        a.activeT = s.duration
        ctx.play('fire', { volume: 1, pitch: 0.6 })
        return true
    },
    tick(ctx, a, s, dt) {
        if (a.activeT <= 0) return
        const p = ctx.player
        const d = ctx.aimDir()
        a.st.ang = turnToward(a.st.ang, Math.atan2(d.y, d.x), dt * 5)
        const ang = a.st.ang as number
        const half = s.mastery ? 0.62 : 0.42
        const R = s.radius
        const mx = p.x + Math.cos(ang) * 16
        const my = p.y - 6 + Math.sin(ang) * 16
        for (let i = 0; i < 5; i++) {
            const b = ang + (Math.random() - 0.5) * half * 1.7
            const sp = R * (2.2 + Math.random() * 1.6)
            ctx.fx.one(mx, my, 'p.flame', i === 0 ? 0xffc060 : i % 2 ? 0xff4a10 : 0xff7a20, Math.cos(b) * sp, Math.sin(b) * sp, 0.32, 11 + Math.random() * 9, { grow: 2.1, drag: 2, alpha: 0.7 })
        }
        if (Math.random() < 0.5) {
            const b = ang + (Math.random() - 0.5) * half
            ctx.fx.one(mx, my, 'p.spark', 0xffe0a0, Math.cos(b) * R * 4, Math.sin(b) * R * 4, 0.25, 7)
        }
        if (Math.random() < 0.3) ctx.fx.one(mx, my, 'p.smoke', 0x302020, Math.cos(ang) * R * 1.6, Math.sin(ang) * R * 1.6 - 40, 0.8, 24, { normal: true, grow: 2.5, alpha: 0.35 })
        a.st.tick -= dt
        if (a.st.tick <= 0) {
            a.st.tick = 0.1
            ctx.query(p.x, p.y, R, e => {
                const da = Math.atan2(e.y - p.y, e.x - p.x) - ang
                if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > half + 0.1) return
                ctx.hit(e, s.damage, { burn: s.damage * 0.6, burnT: 2.5, knock: 90, sx: p.x, sy: p.y, silent: true, color: 0xffa040 })
            })
            ctx.play('fire', { volume: 0.35, pitch: 0.8 + Math.random() * 0.3 }, 0.15)
        }
        if (s.mastery) {
            a.st.zone -= dt
            if (a.st.zone <= 0) {
                a.st.zone = 0.35
                const zd = R * rnd(0.45, 0.8)
                ctx.zone({ x: p.x + Math.cos(ang) * zd, y: p.y + Math.sin(ang) * zd, radius: 52, life: 2.5, tick: 0.35, damage: s.damage * 0.5, color: 0xff5a10, kind: 'fire', hit: { burn: s.damage * 0.3, burnT: 1.5, noNumber: true } })
            }
        }
    }
}

export const ABILITY_DEFS: Record<string, AbilityDef> = Object.fromEntries([
    blink,
    glacial,
    meteor,
    chrono,
    gravity,
    shield,
    cyclone,
    chainNova,
    sentry,
    orbital,
    quake,
    clones,
    battleCry,
    bloodNova,
    breath
].map(d => [d.id, d]))

/** Abilities whose `charges` mod adds extra summons instead of extra casts */
export const COUNT_CHARGES = new Set(['clones'])

export function emptyAbilityMods(): Required<AbilityMods> {
    return { damage: 0, cooldown: 0, radius: 0, duration: 0, charges: 0 }
}

export function addAbilityMods(into: Required<AbilityMods>, m: AbilityMods, scale = 1): void {
    into.damage += (m.damage ?? 0) * scale
    into.cooldown += (m.cooldown ?? 0) * scale
    into.radius += (m.radius ?? 0) * scale
    into.duration += (m.duration ?? 0) * scale
    into.charges += m.charges ?? 0
}

/** Live numbers for an ability at a mod set, player stats and player level */
export function abilityStats(def: AbilityDef, level: number, mods: Required<AbilityMods>, st: PlayerStats, playerLevel: number): AStats {
    const lvl = 1 + 0.07 * Math.max(0, playerLevel - 1)
    return {
        damage: def.base.damage * (1 + mods.damage) * st.might * st.abilityPower * lvl,
        cooldown: Math.max(1.5, def.base.cooldown * Math.max(0.35, 1 - mods.cooldown) * Math.sqrt(st.cooldown) * st.abilityHaste),
        radius: def.base.radius * (1 + mods.radius) * Math.sqrt(st.area),
        duration: def.base.duration * (1 + mods.duration) * st.duration,
        charges: 1 + mods.charges,
        level,
        mastery: level >= ABILITY_MAX_LEVEL
    }
}

function num(v: number): string {
    return v >= 100 ? String(Math.round(v)) : v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString()
}

/** Card text: the effect for a new ability, the stat changes for a level-up */
export function describeAbility(def: AbilityDef, owned: { level: number, mods: Required<AbilityMods> } | null, scale: number, st: PlayerStats, playerLevel: number): string {
    if (!owned) {
        const s = abilityStats(def, 1, emptyAbilityMods(), st, playerLevel)
        return `${def.description} Cooldown ${num(s.cooldown)} s.`
    }
    const next = { ...owned.mods }
    addAbilityMods(next, def.levels[owned.level - 1] ?? {}, scale)
    const a = abilityStats(def, owned.level, owned.mods, st, playerLevel)
    const b = abilityStats(def, owned.level + 1, next, st, playerLevel)
    const parts: string[] = []
    if (b.damage > a.damage + 0.5) parts.push(`Damage ${num(a.damage)} → ${num(b.damage)}`)
    if (b.cooldown < a.cooldown - 0.05) parts.push(`Cooldown ${num(a.cooldown)} → ${num(b.cooldown)} s`)
    if (b.radius > a.radius + 1) parts.push(`+${Math.round((b.radius / a.radius - 1) * 100)}% area`)
    if (b.duration > a.duration + 0.05) parts.push(`Duration ${num(a.duration)} → ${num(b.duration)} s`)
    if (b.charges > a.charges) parts.push(COUNT_CHARGES.has(def.id) ? '+1 clone' : `Charges ${a.charges} → ${b.charges}`)
    if (def.id === 'chainNova') parts.push('+2 targets')
    if (b.mastery) parts.push(`Mastery: ${def.mastery}`)
    return parts.join(', ')
}
