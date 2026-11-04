/*
 * The arsenal: 17 weapons, each with 8 levels and an evolution. Weapons
 * only talk to the game through Ctx.
 */
import { randomFloat } from '#shared/utils/random'
import { CRIT } from './core'
import type { Ctx, EnemyRt, Projectile, WeaponDef, WeaponInst, WMods, WStats } from './core'

const TAU = Math.PI * 2

function B(s: Partial<WStats>): WStats {
    return { damage: 10, cooldown: 1, area: 1, amount: 1, pierce: 1, speed: 500, duration: 1, chain: 0, knock: 60, extra: 0, ...s }
}

function aimAngle(ctx: Ctx): number {
    const d = ctx.aimDir()
    return Math.atan2(d.y, d.x)
}

function rnd(min: number, max: number): number {
    return min + randomFloat() * (max - min)
}

function turnToward(cur: number, want: number, maxStep: number): number {
    let d = want - cur
    d = Math.atan2(Math.sin(d), Math.cos(d))
    return cur + Math.max(-maxStep, Math.min(maxStep, d))
}

/** The n nearest distinct enemies within range. */
function nearestN(ctx: Ctx, x: number, y: number, n: number, range: number): EnemyRt[] {
    const out: { e: EnemyRt, d: number }[] = []
    const r2 = range * range
    for (const e of ctx.enemies) {
        if (e.dead || e.untargetable) continue
        const d = (e.x - x) ** 2 + (e.y - y) ** 2
        if (d < r2) out.push({ e, d })
    }
    out.sort((a, b) => a.d - b.d)
    return out.slice(0, n).map(o => o.e)
}

function ricochet(range: number) {
    return (p: Projectile, e: EnemyRt, ctx: Ctx) => {
        if (p.pierce <= 0) return
        const next = ctx.nearest(e.x, e.y, range, o => o === e || p.hitIds.includes(o.uid))
        if (!next) return
        const sp = Math.hypot(p.vx, p.vy) || 600
        const a = Math.atan2(next.y - p.y, next.x - p.x)
        p.vx = Math.cos(a) * sp
        p.vy = Math.sin(a) * sp
        p.life = Math.max(p.life, 0.6)
    }
}

// ─── Great Cleaver (Knight) ──────────────────────────────────────────────

function cleave(ctx: Ctx, w: WeaponInst, s: WStats, a: number): void {
    const p = ctx.player
    const evo = w.evolved
    const R = (evo ? 150 : 112) * s.area
    let hits = 0
    ctx.query(p.x, p.y, R, e => {
        const dx = e.x - p.x
        const dy = e.y - p.y
        if (!evo) {
            const d = Math.atan2(dy, dx) - a
            const diff = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
            if (diff > 1.1 && Math.hypot(dx, dy) > e.radius + p.radius + 8) return
        }
        const r = ctx.hit(e, s.damage, { knock: s.knock, sx: p.x, sy: p.y, weapon: w, color: 0xfff0c0 })
        if (r) {
            hits++
            ctx.fx.burst(e.x, e.y, { count: 4, color: 0xffe9a0, tex: 'p.spark', speed: 420, angle: Math.atan2(dy, dx), spread: 0.9, life: 0.25, size: 7 })
        }
    })
    const col = evo ? 0xffd54f : 0xfff3d0
    if (evo) {
        ctx.fx.sprite('slash', p.x, p.y, { life: 0.24, color: col, size0: R * 1.3, size1: R * 2.25, rot: a, vrot: 10, follow: p })
        ctx.fx.sprite('slash', p.x, p.y, { life: 0.24, color: col, size0: R * 1.3, size1: R * 2.25, rot: a + Math.PI, vrot: 10, follow: p })
        ctx.fx.ring(p.x, p.y, col, R * 0.3, R * 1.05, 0.3, 0.9)
        for (let i = 0; i < 8; i++) {
            const b = a + (i / 8) * TAU
            ctx.projectile({
                x: p.x + Math.cos(b) * 30,
                y: p.y + Math.sin(b) * 30,
                vx: Math.cos(b) * 620,
                vy: Math.sin(b) * 620,
                tex: 'crescentWave',
                radius: 22 * Math.sqrt(s.area),
                scale: Math.sqrt(s.area),
                damage: s.damage * 0.5,
                pierce: 1e9,
                life: 0.5,
                color: 0xffe27a,
                additive: true,
                weapon: w,
                hit: { knock: s.knock * 0.4 },
                trail: { color: 0xffd54f, rate: 30, tex: 'p.spark', size: 6, life: 0.2 }
            })
        }
        ctx.flash(0xffd54f, 0.04)
    } else {
        const cx = Math.cos(a)
        const cy = Math.sin(a)
        ctx.fx.sprite('slash', p.x + cx * 8, p.y + cy * 8, { life: 0.18, color: col, size0: R * 1.55, size1: R * 2.1, rot: a - 0.55, vrot: 6, follow: p })
    }
    ctx.play('swing', { pitch: 0.85 + randomFloat() * 0.25, volume: 0.75 }, 0.05)
    if (hits >= 5) ctx.shake(0.06)
}

const cleaver: WeaponDef = {
    id: 'cleaver',
    name: 'Great Cleaver',
    icon: 'i-lucide-axe',
    color: 0xf5c451,
    description: 'Cleaves an arc where you aim. Heavy knockback.',
    classWeapon: 'knight',
    usesAmount: true,
    amountLabel: 'swing',
    base: B({ damage: 24, cooldown: 1.2, amount: 1, knock: 340 }),
    levels: [
        { damage: 0.3 },
        { amount: 1 },
        { area: 0.2, damage: 0.1 },
        { damage: 0.3 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.4, area: 0.2 }
    ],
    evo: {
        id: 'dawnbreaker',
        name: 'Dawnbreaker',
        icon: 'i-lucide-sun',
        color: 0xffd54f,
        description: 'Full-circle swings that fire 8 crescents.',
        passive: 'vitality',
        bonus: { damage: 0.7, area: 0.25 }
    },
    fire(ctx, w, s) {
        const base = aimAngle(ctx)
        const offs = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI * 0.75, Math.PI * 0.75, -Math.PI / 4]
        for (let i = 0; i < s.amount; i++) {
            const a = base + offs[i % offs.length]!
            ctx.schedule(i * 0.1, () => cleave(ctx, w, s, a))
        }
    }
}

// ─── Longbow (Ranger) ────────────────────────────────────────────────────

const longbow: WeaponDef = {
    id: 'longbow',
    name: 'Longbow',
    icon: 'i-lucide-bow-arrow',
    color: 0x5fe08a,
    description: 'Piercing arrows where you aim.',
    classWeapon: 'ranger',
    usesAmount: true,
    amountLabel: 'arrow',
    base: B({ damage: 15, cooldown: 0.8, amount: 1, pierce: 2, speed: 920, duration: 1.1, knock: 70 }),
    levels: [
        { amount: 1 },
        { pierce: 1, damage: 0.2 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.3 },
        { pierce: 2, speed: 0.15 },
        { amount: 1, damage: 0.3 }
    ],
    evo: {
        id: 'galeforce',
        name: 'Galeforce',
        icon: 'i-lucide-wind',
        color: 0x9fffd0,
        description: 'Arrows pierce everything and split in two on hit.',
        passive: 'projSpeed',
        bonus: { damage: 0.5, cooldown: 0.25, amount: 1 }
    },
    fire(ctx, w, s) {
        const p = ctx.player
        const a0 = aimAngle(ctx)
        const n = s.amount
        const evo = w.evolved
        for (let i = 0; i < n; i++) {
            const a = a0 + (i - (n - 1) / 2) * (evo ? 0.08 : 0.11)
            const c = Math.cos(a)
            const sn = Math.sin(a)
            ctx.projectile({
                x: p.x + c * 14,
                y: p.y + sn * 14 - 6,
                vx: c * s.speed,
                vy: sn * s.speed,
                tex: evo ? 'windArrow' : 'arrow',
                radius: evo ? 12 : 8,
                damage: s.damage,
                pierce: evo ? 1e9 : s.pierce,
                life: s.duration,
                weapon: w,
                hit: { knock: s.knock },
                trail: evo ? { color: 0x9fffd0, rate: 45, tex: 'p.spark', size: 6, life: 0.25 } : { color: 0xd8ffe0, rate: 16, tex: 'p.dot', size: 3, life: 0.16 },
                data: { split: evo ? 1 : 0 },
                onHit: evo
                    ? (pr, e, c2) => {
                        if (!pr.data.split) return
                        pr.data.split = 0
                        const base = Math.atan2(pr.vy, pr.vx)
                        for (const off of [-0.35, 0.35]) {
                            const b = base + off
                            c2.projectile({
                                x: pr.x,
                                y: pr.y,
                                vx: Math.cos(b) * s.speed * 0.9,
                                vy: Math.sin(b) * s.speed * 0.9,
                                tex: 'windArrow',
                                scale: 0.7,
                                radius: 9,
                                damage: s.damage * 0.55,
                                pierce: 3,
                                life: 0.45,
                                weapon: w,
                                hit: { knock: s.knock * 0.5 },
                                data: { skip: e.uid }
                            }).hitIds.push(e.uid)
                        }
                    }
                    : undefined
            })
        }
        ctx.play('arrow', { pitch: 0.95 + randomFloat() * 0.15, volume: 0.6 }, 0.04)
    }
}

// ─── Fireball (Pyromancer) ───────────────────────────────────────────────

function fireballBoom(ctx: Ctx, w: WeaponInst, s: WStats, x: number, y: number): void {
    const evo = w.evolved
    const r = 58 * s.area * (evo ? 1.6 : 1)
    ctx.explode(x, y, r, s.damage, {
        weapon: w,
        burn: s.damage * (0.22 + s.extra),
        burnT: 3 * s.duration,
        knock: s.knock,
        visual: 'fire',
        sfx: true,
        shake: evo ? 0.16 : 0.06
    })
    if (!evo) return
    ctx.zone({ x, y, radius: r * 0.75, life: 3 * s.duration, tick: 0.4, damage: s.damage * 0.16, color: 0xff5a10, kind: 'fire', weapon: w, hit: { burn: s.damage * 0.12, burnT: 2 } })
    for (let i = 0; i < 4; i++) {
        const a = randomFloat() * TAU
        const sp = rnd(200, 340)
        ctx.projectile({
            x,
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            tex: 'ember',
            radius: 0,
            damage: 0,
            noCollide: true,
            life: rnd(0.35, 0.55),
            weapon: w,
            additive: true,
            trail: { color: 0xff8a30, rate: 50, tex: 'p.flame', size: 7, life: 0.3 },
            onEnd: (pr, c) => c.explode(pr.x, pr.y, 34 * s.area, s.damage * 0.4, { weapon: w, burn: s.damage * 0.1, burnT: 2, visual: 'fire', knock: 60 })
        })
    }
}

const fireball: WeaponDef = {
    id: 'fireball',
    name: 'Fireball',
    icon: 'i-lucide-flame',
    color: 0xff6a2b,
    description: 'Fireballs that explode and burn.',
    classWeapon: 'pyromancer',
    usesAmount: true,
    amountLabel: 'fireball',
    extraLabel: v => `+${Math.round(v * 100)}% burn`,
    base: B({ damage: 20, cooldown: 1.15, amount: 1, speed: 480, duration: 1, knock: 130, extra: 0 }),
    levels: [
        { damage: 0.25 },
        { amount: 1 },
        { area: 0.25 },
        { extra: 0.15, damage: 0.15 },
        { amount: 1 },
        { cooldown: 0.15 },
        { damage: 0.4, area: 0.25 }
    ],
    evo: {
        id: 'hellfireComet',
        name: 'Hellfire Comet',
        icon: 'i-lucide-flame-kindling',
        color: 0xff3a00,
        description: 'Bigger blasts, burning embers and fire pools.',
        passive: 'area',
        bonus: { damage: 0.6, extra: 0.1 }
    },
    fire(ctx, w, s) {
        const p = ctx.player
        const evo = w.evolved
        const targets = nearestN(ctx, p.x, p.y, s.amount, 560)
        const aim = aimAngle(ctx)
        for (let i = 0; i < s.amount; i++) {
            const t = targets[i % Math.max(1, targets.length)]
            const a = t && i < targets.length ? Math.atan2(t.y - p.y, t.x - p.x) : aim + (i - (s.amount - 1) / 2) * 0.3
            ctx.projectile({
                x: p.x,
                y: p.y - 8,
                vx: Math.cos(a) * s.speed,
                vy: Math.sin(a) * s.speed,
                tex: evo ? 'comet' : 'fireball',
                radius: evo ? 18 : 12,
                damage: 0,
                pierce: 1,
                life: 1.5,
                weapon: w,
                glow: 0xff6a1a,
                glowSize: evo ? 120 : 70,
                spin: 4,
                faceVel: false,
                trail: { color: 0xff7a20, rate: evo ? 80 : 45, tex: 'p.flame', size: evo ? 15 : 10, life: 0.35 },
                onEnd: pr => fireballBoom(ctx, w, s, pr.x, pr.y)
            })
        }
        ctx.play('fire', { pitch: 0.9 + randomFloat() * 0.2, volume: 0.7 }, 0.06)
    }
}

// ─── Chain Lightning (Stormcaller) ───────────────────────────────────────

function lightningJump(ctx: Ctx, w: WeaponInst, s: WStats, target: EnemyRt, fromX: number, fromY: number, dmg: number, left: number, hitThis: number[], depth: number): void {
    const evo = w.evolved
    let cur: EnemyRt | null = target
    if (cur.dead || cur.untargetable) cur = ctx.nearest(target.x, target.y, 160 * s.area, e => hitThis.includes(e.uid))
    if (!cur) return
    const col = evo ? 0xfff27a : 0x63c7ff
    ctx.fx.lightning(fromX, fromY, cur.x, cur.y, col, evo ? 4 : 3, 0.22)
    const res = ctx.hit(cur, dmg, { weapon: w, knock: s.knock, sx: fromX, sy: fromY, stun: evo ? 0.35 : 0.06, color: 0xbfefff })
    hitThis.push(cur.uid)
    ctx.fx.burst(cur.x, cur.y, { count: 5, color: 0x9fe6ff, tex: 'p.spark', speed: 340, life: 0.22, size: 5 })
    if (evo) {
        ctx.fx.lightning(cur.x + rnd(-40, 40), cur.y - 360, cur.x, cur.y, 0xfff27a, 5, 0.25, 1.4)
        ctx.explode(cur.x, cur.y, 50 * s.area, dmg * 0.5, { weapon: w, stun: 0.3, visual: 'plain', color: 0xfff27a, chained: true, knock: 60 })
    }
    let remaining = left - 1
    if ((res & CRIT) && ctx.cls.id === 'stormcaller') remaining++
    if (remaining <= 0 || depth > 30) return
    const x = cur.x
    const y = cur.y
    const next = ctx.nearest(x, y, 165 * s.area, e => hitThis.includes(e.uid))
    if (!next) return
    ctx.schedule(0.035, () => lightningJump(ctx, w, s, next, x, y, dmg * 0.93, remaining, hitThis, depth + 1))
}

const chainLightning: WeaponDef = {
    id: 'chainLightning',
    name: 'Chain Lightning',
    icon: 'i-lucide-zap',
    color: 0x63c7ff,
    description: 'Lightning that jumps between enemies.',
    classWeapon: 'stormcaller',
    usesAmount: true,
    amountLabel: 'bolt',
    chainLabel: 'jump',
    base: B({ damage: 17, cooldown: 1.05, amount: 1, chain: 3, knock: 40 }),
    levels: [
        { chain: 1 },
        { damage: 0.25 },
        { amount: 1 },
        { chain: 2 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.4, chain: 2 }
    ],
    evo: {
        id: 'stormWrath',
        name: 'Wrath of the Storm',
        icon: 'i-lucide-cloud-lightning',
        color: 0xfff27a,
        description: '+6 jumps, and a sky bolt on every hit.',
        passive: 'crit',
        bonus: { damage: 0.5, chain: 6, amount: 1 }
    },
    fire(ctx, w, s) {
        const p = ctx.player
        const struck: number[] = []
        let any = false
        for (let b = 0; b < s.amount; b++) {
            const first = ctx.nearest(p.x, p.y, 470, e => struck.includes(e.uid)) ?? ctx.nearest(p.x, p.y, 470)
            if (!first) break
            any = true
            struck.push(first.uid)
            ctx.schedule(b * 0.09, () => lightningJump(ctx, w, s, first, ctx.player.x, ctx.player.y - 20, s.damage, s.chain + 1, [...struck.filter(u => u !== first.uid)], 0))
        }
        if (any) ctx.play('zap', { pitch: 0.9 + randomFloat() * 0.3, volume: 0.75 }, 0.05)
        else w.timer = 0.2
    }
}

// ─── Soul Skulls (Necromancer) ───────────────────────────────────────────

const soulSkulls: WeaponDef = {
    id: 'soulSkulls',
    name: 'Soul Skulls',
    icon: 'i-lucide-skull',
    color: 0xb06bff,
    description: 'Homing skulls.',
    classWeapon: 'necromancer',
    usesAmount: true,
    amountLabel: 'skull',
    base: B({ damage: 15, cooldown: 1.4, amount: 2, pierce: 1, speed: 360, duration: 3, knock: 90 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { pierce: 1 },
        { amount: 1 },
        { duration: 0.25, speed: 0.2 },
        { cooldown: 0.15 },
        { amount: 2, damage: 0.3 }
    ],
    evo: {
        id: 'legion',
        name: 'Legion of Souls',
        icon: 'i-lucide-ghost',
        color: 0xd08aff,
        description: 'Skulls pierce everything and last longer.',
        passive: 'duration',
        bonus: { damage: 0.4, amount: 2, duration: 0.5 }
    },
    fire(ctx, w, s) {
        const p = ctx.player
        const evo = w.evolved
        const targets = nearestN(ctx, p.x, p.y, s.amount, 600)
        for (let i = 0; i < s.amount; i++) {
            const a = (i / s.amount) * TAU + ctx.time * 2
            ctx.projectile({
                x: p.x + Math.cos(a) * 18,
                y: p.y + Math.sin(a) * 18 - 10,
                vx: Math.cos(a) * s.speed * 0.7,
                vy: Math.sin(a) * s.speed * 0.7,
                tex: 'skull',
                radius: 11,
                scale: evo ? 1.25 : 1,
                damage: s.damage,
                pierce: evo ? 1e9 : s.pierce,
                rehit: evo ? 0.6 : 0,
                life: s.duration,
                weapon: w,
                faceVel: false,
                homing: evo ? 8 : 5.5,
                target: targets[i] ?? null,
                hit: { knock: s.knock },
                trail: { color: evo ? 0xd08aff : 0xb06bff, rate: evo ? 40 : 22, tex: 'p.smoke', size: evo ? 10 : 7, life: 0.4 },
                data: { spd: s.speed },
                onHit: evo ? pr => { pr.target = null } : undefined
            })
        }
        ctx.play('summon', { volume: 0.35, pitch: 1.4 }, 0.1)
    }
}

// ─── Void Orbs (Voidwalker) ──────────────────────────────────────────────

const voidOrbs: WeaponDef = {
    id: 'voidOrbs',
    name: 'Void Orbs',
    icon: 'i-lucide-orbit',
    color: 0xff3fa4,
    description: 'Orbs circle you and damage on contact.',
    classWeapon: 'voidwalker',
    usesAmount: true,
    amountLabel: 'orb',
    base: B({ damage: 12, cooldown: 0, amount: 2, speed: 1, knock: 150 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { area: 0.2 },
        { amount: 1 },
        { speed: 0.25, damage: 0.1 },
        { amount: 1 },
        { damage: 0.4 }
    ],
    evo: {
        id: 'eventHorizon',
        name: 'Event Horizon',
        icon: 'i-lucide-atom',
        color: 0xff7ac8,
        description: 'A second orb ring. Orbs pull enemies in and pulse.',
        passive: 'haste',
        bonus: { damage: 0.5, area: 0.15 }
    },
    tick(ctx, w, s, dt) {
        const st = w.st
        const evo = w.evolved
        const inner = Math.max(1, Math.round(s.amount))
        const want = evo ? inner * 2 : inner
        if (!st.orbs || st.count !== want || st.evo !== evo) {
            for (const o of (st.orbs ?? []) as Projectile[]) o.alive = false
            const orbs: Projectile[] = []
            for (let i = 0; i < want; i++) {
                const ring = evo && i >= inner ? 1 : 0
                const idx = ring ? i - inner : i
                orbs.push(ctx.projectile({
                    x: ctx.player.x,
                    y: ctx.player.y,
                    vx: 0,
                    vy: 0,
                    tex: 'voidOrb',
                    radius: 14,
                    damage: s.damage,
                    pierce: 1e9,
                    rehit: 0.45,
                    life: 1e9,
                    weapon: w,
                    glow: 0xff3fa4,
                    glowSize: 60,
                    faceVel: false,
                    spin: 3,
                    hit: { knock: s.knock },
                    data: { idx, n: inner, ring },
                    update: (o, c) => {
                        const pl = c.player
                        const ang = (o.data.ring ? -1 : 1) * (st.t ?? 0) + (o.data.idx! / o.data.n!) * TAU + (o.data.ring ? 0.4 : 0)
                        const R = st.R * (o.data.ring ? 1.75 : 1)
                        o.x = pl.x + Math.cos(ang) * R
                        o.y = pl.y + Math.sin(ang) * R - 6
                    }
                }))
            }
            st.orbs = orbs
            st.count = want
            st.evo = evo
        }
        st.t = (st.t ?? 0) + dt * 3.1 * s.speed
        st.R = 86 * s.area
        const size = Math.sqrt(s.area) * (evo ? 1.3 : 1)
        for (const o of st.orbs as Projectile[]) {
            o.damage = s.damage
            o.radius = 14 * size
            o.scale = size
            o.hit.knock = s.knock
            if (evo) ctx.pull(o.x, o.y, 120 * s.area, 140, dt)
        }
        if (evo) {
            st.pulse = (st.pulse ?? 1.5) - dt
            if (st.pulse <= 0) {
                st.pulse = 1.6
                for (const o of st.orbs as Projectile[]) {
                    ctx.explode(o.x, o.y, 58 * s.area, s.damage * 0.7, { weapon: w, visual: 'void', knock: 80, silent: true })
                }
                ctx.play('explosion', { volume: 0.35, pitch: 1.5 }, 0.2)
            }
        }
    },
    cleanup(_ctx, w) {
        for (const o of (w.st.orbs ?? []) as Projectile[]) o.alive = false
        w.st.orbs = null
    }
}

// ─── Throwing Daggers ────────────────────────────────────────────────────

const daggers: WeaponDef = {
    id: 'daggers',
    name: 'Throwing Daggers',
    icon: 'i-lucide-swords',
    color: 0xc8d6e8,
    description: 'Rapid knives where you aim.',
    usesAmount: true,
    amountLabel: 'dagger',
    base: B({ damage: 9, cooldown: 0.6, amount: 1, pierce: 1, speed: 820, duration: 0.7, knock: 40 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { amount: 1 },
        { pierce: 1 },
        { amount: 1 },
        { cooldown: 0.15 },
        { amount: 1, damage: 0.4 }
    ],
    evo: {
        id: 'thousandEdges',
        name: 'Thousand Edges',
        icon: 'i-lucide-sparkles',
        color: 0xe8f0ff,
        description: 'Blades ricochet. +20% crit chance.',
        passive: 'amount',
        bonus: { damage: 0.5, amount: 3, pierce: 2 }
    },
    fire(ctx, w, s) {
        const n = s.amount
        const evo = w.evolved
        for (let i = 0; i < n; i++) {
            ctx.schedule(i * (evo ? 0.035 : 0.055), () => {
                const p = ctx.player
                const a = aimAngle(ctx) + rnd(-0.08, 0.08) * (evo ? 2 : 1)
                ctx.projectile({
                    x: p.x,
                    y: p.y - 6,
                    vx: Math.cos(a) * s.speed,
                    vy: Math.sin(a) * s.speed,
                    tex: 'dagger',
                    radius: 7,
                    scale: evo ? 1.2 : 1,
                    damage: s.damage,
                    pierce: s.pierce,
                    life: s.duration,
                    weapon: w,
                    hit: { knock: s.knock, critBonus: evo ? 0.2 : 0 },
                    glow: evo ? 0xbfd8ff : undefined,
                    glowSize: 30,
                    trail: evo ? { color: 0xc8e4ff, rate: 30, tex: 'p.spark', size: 4, life: 0.15 } : undefined,
                    onHit: evo ? ricochet(260) : undefined
                })
                ctx.play('shoot', { pitch: 1.35 + randomFloat() * 0.25, volume: 0.3 }, 0.04)
            })
        }
    }
}

// ─── Holy Aura ───────────────────────────────────────────────────────────

const holyAura: WeaponDef = {
    id: 'holyAura',
    name: 'Sanctified Aura',
    icon: 'i-lucide-sun-dim',
    color: 0xffd54f,
    description: 'Damages and slows enemies near you.',
    usesAmount: false,
    extraLabel: v => `+${Math.round(v * 100)}% slow`,
    base: B({ damage: 6, cooldown: 0.45, area: 1, knock: 25, extra: 0 }),
    levels: [
        { area: 0.2 },
        { damage: 0.3 },
        { cooldown: 0.15 },
        { area: 0.2 },
        { damage: 0.3 },
        { area: 0.15, extra: 0.15 },
        { damage: 0.5 }
    ],
    evo: {
        id: 'seraphHalo',
        name: "Seraph's Halo",
        icon: 'i-lucide-sun',
        color: 0xfff2b0,
        description: 'Bigger aura that burns. Kills inside heal you.',
        passive: 'regen',
        bonus: { damage: 0.6, area: 0.15 }
    },
    tick(ctx, w, s, dt) {
        const st = w.st
        const p = ctx.player
        const evo = w.evolved
        if (!st.disc) {
            st.disc = ctx.makeSprite('disc', 'decalAdd')
            st.ring = ctx.makeSprite('ringSoft', 'decalAdd')
            st.rune = ctx.makeSprite('runeRing', 'decalAdd')
        }
        const R = 78 * s.area * (evo ? 1.35 : 1)
        st.pulse = Math.max(0, (st.pulse ?? 0) - dt * 4)
        const col = evo ? 0xfff2b0 : 0xffd54f
        const pulse = st.pulse as number
        const disc = st.disc
        disc.position.set(p.x, p.y)
        disc.tint = col
        disc.alpha = 0.13 + pulse * 0.12
        disc.scale.set(((R * 2) / 128) * (1 + pulse * 0.04))
        const ring = st.ring
        ring.position.set(p.x, p.y)
        ring.tint = col
        ring.alpha = 0.45 + pulse * 0.3
        ring.rotation += dt * 0.6
        ring.scale.set(R / 122)
        const rune = st.rune
        rune.visible = evo
        if (evo) {
            rune.position.set(p.x, p.y)
            rune.tint = 0xffe9a0
            rune.alpha = 0.55
            rune.rotation -= dt * 0.7
            rune.scale.set(R / 120)
        }
        st.t = (st.t ?? 0) - dt
        if (st.t > 0) return
        st.t = s.cooldown
        st.pulse = 1
        ctx.query(p.x, p.y, R, e => {
            ctx.hit(e, s.damage, {
                weapon: w,
                slow: Math.min(0.8, 0.3 + s.extra),
                slowT: 0.6,
                knock: s.knock,
                sx: p.x,
                sy: p.y,
                silent: true,
                burn: evo ? s.damage * 0.6 : 0,
                burnT: evo ? 1.5 : 0,
                color: col,
                onKill: evo ? () => ctx.heal(0.5) : undefined
            })
        })
        ctx.fx.burst(p.x, p.y, { count: evo ? 7 : 4, color: col, tex: 'p.star', speed: 50, jitter: R * 0.7, life: 0.6, size: 7 })
    },
    cleanup(ctx, w) {
        for (const k of ['disc', 'ring', 'rune']) {
            if (w.st[k]) ctx.freeSprite(w.st[k])
            w.st[k] = null
        }
    }
}

// ─── Moonblade (boomerang) ───────────────────────────────────────────────

const boomerang: WeaponDef = {
    id: 'boomerang',
    name: 'Moonblade',
    icon: 'i-lucide-moon',
    color: 0xb8c8ff,
    description: 'A blade that flies out and returns.',
    usesAmount: true,
    amountLabel: 'blade',
    base: B({ damage: 15, cooldown: 1.6, amount: 1, speed: 560, duration: 1, knock: 110 }),
    levels: [
        { damage: 0.25 },
        { amount: 1 },
        { area: 0.25 },
        { speed: 0.2, duration: 0.2 },
        { amount: 1 },
        { damage: 0.3 },
        { amount: 1, cooldown: 0.15 }
    ],
    evo: {
        id: 'eclipseGlaive',
        name: 'Eclipse Glaive',
        icon: 'i-lucide-moon-star',
        color: 0x9fb8ff,
        description: 'Huge glaives fly out in a spiral.',
        passive: 'speed',
        bonus: { damage: 0.6, amount: 2, area: 0.3 }
    },
    fire(ctx, w, s) {
        const a0 = aimAngle(ctx)
        const evo = w.evolved
        const n = s.amount
        for (let i = 0; i < n; i++) {
            const a = evo ? a0 + (i / n) * TAU : a0 + (i - (n - 1) / 2) * 0.38
            ctx.schedule(i * 0.07, () => {
                const p = ctx.player
                const size = Math.sqrt(s.area) * (evo ? 1.25 : 1)
                ctx.projectile({
                    x: p.x,
                    y: p.y - 6,
                    vx: Math.cos(a) * s.speed,
                    vy: Math.sin(a) * s.speed,
                    tex: evo ? 'glaive' : 'boomerang',
                    radius: 15 * size,
                    scale: size,
                    damage: s.damage,
                    pierce: 1e9,
                    rehit: 0.35,
                    life: 3.5,
                    weapon: w,
                    spin: evo ? 14 : 18,
                    faceVel: false,
                    glow: evo ? 0x9fb8ff : undefined,
                    glowSize: 70,
                    hit: { knock: s.knock },
                    trail: evo ? { color: 0xbfd0ff, rate: 45, tex: 'p.star', size: 6, life: 0.5 } : { color: 0xd8e6ff, rate: 14, tex: 'p.dot', size: 3, life: 0.2 },
                    data: { curl: evo ? 2.4 : 0, spd: s.speed, turn: 0.45 * s.duration, back: 0 },
                    update: (pr, c, dt) => {
                        const pl = c.player
                        if (pr.age < pr.data.turn!) {
                            const f = Math.exp(-dt * 3.2)
                            pr.vx *= f
                            pr.vy *= f
                        } else {
                            if (!pr.data.back) {
                                pr.data.back = 1
                                pr.hitMap?.clear()
                            }
                            const dx = pl.x - pr.x
                            const dy = pl.y - pr.y
                            const d = Math.hypot(dx, dy) || 1
                            pr.vx += (dx / d) * 2600 * dt
                            pr.vy += (dy / d) * 2600 * dt
                            const sp = Math.hypot(pr.vx, pr.vy)
                            const max = pr.data.spd! * 1.4
                            if (sp > max) {
                                pr.vx *= max / sp
                                pr.vy *= max / sp
                            }
                            if (d < 28) pr.alive = false
                        }
                        if (pr.data.curl) {
                            const ca = Math.cos(pr.data.curl * dt)
                            const sa = Math.sin(pr.data.curl * dt)
                            const vx = pr.vx * ca - pr.vy * sa
                            pr.vy = pr.vx * sa + pr.vy * ca
                            pr.vx = vx
                        }
                        pr.x += pr.vx * dt
                        pr.y += pr.vy * dt
                    }
                })
            })
        }
        ctx.play('swing', { pitch: 1.5, volume: 0.4 }, 0.08)
    }
}

// ─── Frost Nova ──────────────────────────────────────────────────────────

const frostNova: WeaponDef = {
    id: 'frostNova',
    name: 'Frost Nova',
    icon: 'i-lucide-snowflake',
    color: 0x9fe0ff,
    description: 'A frost ring that slows nearby enemies.',
    usesAmount: false,
    extraLabel: v => `+${v.toFixed(1)}s freeze`,
    base: B({ damage: 13, cooldown: 3, area: 1, duration: 1, knock: 170, extra: 0 }),
    levels: [
        { area: 0.2 },
        { damage: 0.3 },
        { extra: 1 },
        { cooldown: 0.15 },
        { area: 0.2 },
        { damage: 0.3 },
        { damage: 0.4, extra: 0.5 }
    ],
    evo: {
        id: 'absoluteZero',
        name: 'Absolute Zero',
        icon: 'i-lucide-snowflake',
        color: 0xdff6ff,
        description: 'Huge nova that freezes. Frozen enemies take triple damage.',
        passive: 'armor',
        bonus: { damage: 0.6, extra: 0.5, cooldown: 0.1 }
    },
    fire(ctx, w, s) {
        const p = ctx.player
        const evo = w.evolved
        const R = 150 * s.area * (evo ? 1.6 : 1)
        const x = p.x
        const y = p.y
        const hitSet = new Set<number>()
        const steps = 6
        for (let k = 1; k <= steps; k++) {
            ctx.schedule((k - 1) * 0.045, () => {
                const r = (R * k) / steps
                ctx.query(x, y, r, e => {
                    if (hitSet.has(e.uid)) return
                    hitSet.add(e.uid)
                    const frozen = e.freezeT > 0
                    ctx.hit(e, s.damage, {
                        weapon: w,
                        slow: 0.5,
                        slowT: 2 * s.duration,
                        freeze: evo ? 1.5 + s.extra : s.extra,
                        shatter: evo && frozen,
                        knock: s.knock,
                        sx: x,
                        sy: y,
                        color: 0xbfe8ff
                    })
                    ctx.fx.burst(e.x, e.y, { count: 3, color: 0xdff6ff, tex: 'p.shard', speed: 160, life: 0.4, size: 6 })
                })
            })
        }
        ctx.fx.ring(x, y, 0x9fe0ff, 20, R * 1.05, 0.32, 1)
        ctx.fx.ring(x, y, 0xffffff, 10, R * 0.85, 0.28, 0.6, true)
        ctx.fx.sprite('disc', x, y, { life: 0.35, color: 0x9fe0ff, size0: R * 0.6, size1: R * 2.1, a0: 0.35, a1: 0 })
        ctx.fx.burst(x, y, { count: evo ? 40 : 22, color: 0xdff6ff, tex: 'p.shard', speed: R * 3, life: 0.4, size: 8, drag: 4 })
        if (evo) {
            ctx.flash(0x9fe0ff, 0.1)
            ctx.shake(0.15)
        }
        ctx.play('frost', { volume: 0.8, pitch: evo ? 0.8 : 1 }, 0.1)
    }
}

// ─── Starfall (meteors) ──────────────────────────────────────────────────

function dropMeteor(ctx: Ctx, w: WeaponInst, s: WStats, tx: number, ty: number, scale = 1): void {
    const evo = w.evolved
    const R = 72 * s.area * (evo ? 1.3 : 1) * scale
    const fall = 0.55
    ctx.fx.sprite('disc', tx, ty, { life: fall, color: 0xff6a2a, size0: R * 0.4, size1: R * 2, a0: 0.15, a1: 0.55, easeOut: false })
    const sx = tx + 260
    const sy = ty - 560
    ctx.projectile({
        x: sx,
        y: sy,
        vx: (tx - sx) / fall,
        vy: (ty - sy) / fall,
        tex: 'meteor',
        radius: 0,
        damage: 0,
        life: fall,
        noCollide: true,
        scale: (evo ? 1.5 : 1.1) * scale,
        glow: 0xff7a20,
        glowSize: 120 * scale,
        faceVel: false,
        spin: 5,
        weapon: w,
        trail: { color: 0xff8a30, rate: 90, tex: 'p.flame', size: 14 * scale, life: 0.4 },
        onEnd: () => {
            ctx.explode(tx, ty, R, s.damage * scale, { weapon: w, burn: s.damage * 0.2, burnT: 2.5, knock: s.knock, sx: tx, sy: ty, visual: 'fire', sfx: true, shake: 0.2 * scale })
            ctx.fx.burst(tx, ty, { count: 10, color: 0x3a2018, tex: 'p.square', speed: 380, life: 0.6, size: 6, normal: true, gravity: 500, drag: 2 })
            if (!evo || scale < 1) return
            ctx.zone({ x: tx, y: ty, radius: R * 0.7, life: 3, tick: 0.4, damage: s.damage * 0.15, color: 0xff4a10, kind: 'magma', weapon: w, hit: { burn: s.damage * 0.1, burnT: 2 } })
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * TAU + rnd(0, 1)
                const d = rnd(70, 130) * s.area
                ctx.schedule(0.12 + i * 0.05, () => dropMeteor(ctx, w, s, tx + Math.cos(a) * d, ty + Math.sin(a) * d, 0.45))
            }
        }
    })
}

const meteor: WeaponDef = {
    id: 'meteor',
    name: 'Starfall',
    icon: 'i-lucide-star',
    color: 0xff8a30,
    description: 'Meteors fall on nearby enemies.',
    usesAmount: true,
    amountLabel: 'meteor',
    base: B({ damage: 36, cooldown: 2.4, amount: 1, area: 1, knock: 220 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { area: 0.25 },
        { amount: 1 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.5 }
    ],
    evo: {
        id: 'armageddon',
        name: 'Armageddon',
        icon: 'i-lucide-sparkles',
        color: 0xff4a10,
        description: 'Meteors split into showers and leave magma.',
        passive: 'luck',
        bonus: { damage: 0.5, amount: 2 }
    },
    fire(ctx, w, s) {
        for (let i = 0; i < s.amount; i++) {
            ctx.schedule(i * 0.16, () => {
                const pl = ctx.player
                const t = ctx.randomEnemy(pl.x, pl.y, Math.min(560, ctx.view.width * 0.55))
                const tx = t ? t.x + rnd(-15, 15) : pl.x + rnd(-260, 260)
                const ty = t ? t.y + rnd(-15, 15) : pl.y + rnd(-200, 200)
                dropMeteor(ctx, w, s, tx, ty)
            })
        }
        ctx.play('shootHeavy', { volume: 0.35, pitch: 0.8 }, 0.15)
    }
}

// ─── Prism Beam (laser) ──────────────────────────────────────────────────

const laser: WeaponDef = {
    id: 'laser',
    name: 'Prism Beam',
    icon: 'i-lucide-flashlight',
    color: 0xff5ad8,
    description: 'A beam that sweeps toward your aim.',
    usesAmount: true,
    amountLabel: 'beam',
    base: B({ damage: 7, cooldown: 2.4, amount: 1, area: 1, duration: 0.55, knock: 25 }),
    levels: [
        { damage: 0.25 },
        { duration: 0.3 },
        { amount: 1 },
        { area: 0.25 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.5 }
    ],
    evo: {
        id: 'solarLance',
        name: 'Solar Lance',
        icon: 'i-lucide-sun',
        color: 0xffd54f,
        description: '4 beams spin around you.',
        passive: 'might',
        bonus: { damage: 0.6, duration: 0.6 }
    },
    fire(ctx, w, s) {
        const evo = w.evolved
        const n = evo ? 4 : s.amount
        const base = aimAngle(ctx)
        const col = evo ? 0xffd54f : 0xff5ad8
        for (let i = 0; i < n; i++) {
            const off = evo ? (i / n) * TAU : (i - (n - 1) / 2) * 0.32
            ctx.projectile({
                x: ctx.player.x,
                y: ctx.player.y,
                vx: 0,
                vy: 0,
                tex: '',
                radius: 0,
                damage: 0,
                life: s.duration * (evo ? 1.6 : 1),
                noCollide: true,
                weapon: w,
                glow: col,
                glowSize: 46,
                data: { ang: base + off, tick: 0 },
                update: (pr, c, dt) => {
                    const pl = c.player
                    pr.x = pl.x
                    pr.y = pl.y - 8
                    if (evo) pr.data.ang! += dt * 1.9
                    else pr.data.ang = turnToward(pr.data.ang!, aimAngle(c) + off, dt * 2.4)
                    const ang = pr.data.ang!
                    const L = evo ? 540 * Math.sqrt(s.area) : 640 * Math.sqrt(s.area)
                    const width = 16 * s.area * (evo ? 1.8 : 1)
                    const cx = Math.cos(ang)
                    const cy = Math.sin(ang)
                    const k = Math.min(1, pr.age / 0.06, pr.life / 0.1)
                    c.fx.beam(pr.x + cx * 12, pr.y + cy * 12, pr.x + cx * L, pr.y + cy * L, col, width * k)
                    pr.data.tick! -= dt
                    if (pr.data.tick! > 0) return
                    pr.data.tick = 0.08
                    const stamp = new Set<number>()
                    for (let d = 0; d <= L; d += 50) {
                        c.query(pr.x + cx * d, pr.y + cy * d, 50, e => {
                            if (stamp.has(e.uid)) return
                            const t = Math.max(0, Math.min(L, (e.x - pr.x) * cx + (e.y - pr.y) * cy))
                            const px = pr.x + cx * t
                            const py = pr.y + cy * t
                            if (Math.hypot(e.x - px, e.y - py) > width / 2 + e.radius) return
                            stamp.add(e.uid)
                            c.hit(e, s.damage, { weapon: w, knock: s.knock, kx: cx, ky: cy, silent: true, color: col })
                            if (randomFloat() < 0.4) c.fx.burst(px, py, { count: 2, color: col, tex: 'p.spark', speed: 260, life: 0.2, size: 5 })
                        })
                    }
                }
            })
        }
        ctx.play('laser', { volume: 0.7, pitch: evo ? 0.8 : 1 }, 0.1)
    }
}

// ─── Rune Mines ──────────────────────────────────────────────────────────

const mines: WeaponDef = {
    id: 'mines',
    name: 'Rune Mines',
    icon: 'i-lucide-bomb',
    color: 0xffb347,
    description: 'Mines that explode when enemies step close.',
    usesAmount: true,
    amountLabel: 'mine',
    base: B({ damage: 30, cooldown: 1.9, amount: 1, area: 1, duration: 10, knock: 240 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { area: 0.25 },
        { amount: 1 },
        { cooldown: 0.15 },
        { damage: 0.3 },
        { amount: 2 }
    ],
    evo: {
        id: 'gravitonMines',
        name: 'Graviton Mines',
        icon: 'i-lucide-magnet',
        color: 0x9aa8ff,
        description: 'Mines pull enemies in before exploding.',
        passive: 'magnet',
        bonus: { damage: 0.6, area: 0.3, amount: 1 }
    },
    fire(ctx, w, s) {
        const evo = w.evolved
        for (let i = 0; i < s.amount; i++) {
            const p = ctx.player
            const a = randomFloat() * TAU
            const d = rnd(50, 180)
            const R = 66 * s.area * (evo ? 1.3 : 1)
            ctx.projectile({
                x: p.x + Math.cos(a) * d,
                y: p.y + Math.sin(a) * d,
                vx: 0,
                vy: 0,
                tex: evo ? 'mineEvo' : 'mine',
                radius: 0,
                damage: 0,
                life: s.duration,
                noCollide: true,
                faceVel: false,
                scale: 0.2,
                weapon: w,
                data: { trig: 0 },
                update: (m, c, dt) => {
                    m.scale = Math.min(1, m.scale + dt * 5)
                    if (m.age < 0.35) return
                    if (m.data.trig! > 0) {
                        m.data.trig! -= dt
                        if (evo) c.pull(m.x, m.y, R * 1.7, 520, dt)
                        m.scale = 1 + Math.sin(m.age * 40) * 0.15
                        if (m.data.trig! <= 0) m.alive = false
                        return
                    }
                    m.sprite.tint = Math.floor(m.age * 3) % 2 ? 0xffffff : 0xffa0a0
                    let near = false
                    c.query(m.x, m.y, 30, () => {
                        near = true
                        return true
                    })
                    if (near) {
                        m.data.trig = evo ? 0.45 : 0.06
                        if (evo) c.fx.ring(m.x, m.y, 0x9aa8ff, R * 1.7, 10, 0.45, 0.8, true)
                    }
                },
                onEnd: m => ctx.explode(m.x, m.y, R, s.damage, { weapon: w, knock: s.knock, sx: m.x, sy: m.y, visual: evo ? 'void' : 'fire', sfx: true, shake: evo ? 0.12 : 0.05, color: evo ? 0x9aa8ff : undefined })
            })
        }
    }
}

// ─── Ricochet Bolt ───────────────────────────────────────────────────────

const ricochetBolt: WeaponDef = {
    id: 'ricochet',
    name: 'Ricochet Bolt',
    icon: 'i-lucide-git-commit-horizontal',
    color: 0x7ff0ff,
    description: 'A bolt that bounces between enemies.',
    usesAmount: true,
    amountLabel: 'bolt',
    chainLabel: 'bounce',
    base: B({ damage: 13, cooldown: 1.2, amount: 1, chain: 3, speed: 760, knock: 50 }),
    levels: [
        { chain: 1 },
        { damage: 0.25 },
        { amount: 1 },
        { chain: 2 },
        { speed: 0.25, damage: 0.1 },
        { cooldown: 0.15 },
        { damage: 0.4, chain: 2 }
    ],
    evo: {
        id: 'bloodPrism',
        name: 'Blood Prism',
        icon: 'i-lucide-droplet',
        color: 0xff2050,
        description: '+8 bounces. Each bounce heals you.',
        passive: 'lifesteal',
        bonus: { damage: 0.5, chain: 8, amount: 1 }
    },
    fire(ctx, w, s) {
        const evo = w.evolved
        const used: number[] = []
        for (let i = 0; i < s.amount; i++) {
            ctx.schedule(i * 0.07, () => {
                const p = ctx.player
                const t = ctx.nearest(p.x, p.y, 540, e => used.includes(e.uid))
                if (t) used.push(t.uid)
                const a = t ? Math.atan2(t.y - p.y, t.x - p.x) : aimAngle(ctx)
                ctx.projectile({
                    x: p.x,
                    y: p.y - 8,
                    vx: Math.cos(a) * s.speed,
                    vy: Math.sin(a) * s.speed,
                    tex: evo ? 'bloodBolt' : 'bolt',
                    radius: 9,
                    damage: s.damage,
                    pierce: s.chain + 1,
                    life: 1.3,
                    weapon: w,
                    glow: evo ? 0xff2050 : 0x7ff0ff,
                    glowSize: 40,
                    additive: true,
                    hit: { knock: s.knock },
                    trail: { color: evo ? 0xff4060 : 0x7ff0ff, rate: 40, tex: 'p.spark', size: 4, life: 0.18 },
                    onHit: (pr, e, c) => {
                        ricochet(340)(pr, e, c)
                        if (evo) c.heal(0.25)
                        c.play('hit', { pitch: 1.6 + Math.min(1, pr.hitIds.length * 0.08), volume: 0.3 }, 0.03)
                    }
                })
                ctx.play('shoot', { pitch: 1.1, volume: 0.4 }, 0.05)
            })
        }
    }
}


// ─── Storm Totem ─────────────────────────────────────────────────────────

const stormTotem: WeaponDef = {
    id: 'stormTotem',
    name: 'Storm Totem',
    icon: 'i-lucide-tower-control',
    color: 0x8fd0ff,
    description: 'Places a totem that zaps nearby enemies.',
    usesAmount: true,
    amountLabel: 'totem',
    chainLabel: 'target',
    base: B({ damage: 14, cooldown: 5, amount: 1, area: 1, duration: 6, chain: 2, knock: 40 }),
    levels: [
        { damage: 0.25 },
        { chain: 1 },
        { amount: 1 },
        { duration: 0.3 },
        { cooldown: 0.15 },
        { chain: 1, damage: 0.2 },
        { amount: 1, damage: 0.3 }
    ],
    evo: {
        id: 'thunderSpire',
        name: 'Thunder Spire',
        icon: 'i-lucide-cloud-lightning',
        color: 0xfff27a,
        description: 'Zaps call a sky bolt that blasts an area.',
        passive: 'focus',
        bonus: { damage: 0.5, chain: 2, duration: 0.5 }
    },
    fire(ctx, w, s) {
        const evo = w.evolved
        for (let i = 0; i < s.amount; i++) {
            const p = ctx.player
            const a = randomFloat() * TAU
            const d = rnd(50, 120)
            const x = p.x + Math.cos(a) * d
            const y = p.y + Math.sin(a) * d
            const range = 270 * s.area
            ctx.fx.ring(x, y, 0x8fd0ff, 10, 70, 0.35, 1)
            ctx.projectile({
                x,
                y,
                vx: 0,
                vy: 0,
                tex: evo ? 'totemEvo' : 'totem',
                radius: 0,
                damage: 0,
                life: s.duration,
                noCollide: true,
                faceVel: false,
                scale: 0.2,
                weapon: w,
                glow: evo ? 0xfff27a : 0x63c7ff,
                glowSize: 70,
                data: { t: 0.2 },
                update: (t, c, dt) => {
                    t.scale = Math.min(1, t.scale + dt * 6)
                    t.data.t! -= dt
                    if (t.data.t! > 0) return
                    t.data.t = 0.6
                    const used: number[] = []
                    for (let k = 0; k <= s.chain; k++) {
                        const e = c.nearest(t.x, t.y, range, o => used.includes(o.uid))
                        if (!e) break
                        used.push(e.uid)
                        c.fx.lightning(t.x, t.y - 26, e.x, e.y, evo ? 0xfff27a : 0x9fe6ff, 3, 0.2)
                        c.hit(e, s.damage, { weapon: w, stun: 0.12, knock: s.knock, sx: t.x, sy: t.y, color: 0xbfefff })
                        if (evo) {
                            c.fx.lightning(e.x + rnd(-30, 30), e.y - 380, e.x, e.y, 0xfff27a, 4, 0.22, 1.3)
                            c.explode(e.x, e.y, 60 * s.area, s.damage * 0.6, { weapon: w, visual: 'plain', color: 0xfff27a, knock: 80, chained: true })
                        }
                    }
                    if (used.length) c.play('zap', { volume: 0.35, pitch: 1.3 + randomFloat() * 0.3 }, 0.08)
                },
                onEnd: t => ctx.fx.burst(t.x, t.y, { count: 10, color: 0x9fe6ff, tex: 'p.spark', speed: 240, life: 0.3, size: 6 })
            })
        }
    }
}

// ─── Plague Cloud ────────────────────────────────────────────────────────

function spreadPlague(ctx: Ctx, w: WeaponInst, s: WStats, e: EnemyRt, depth: number): void {
    if (randomFloat() < 0.35) plagueCloud(ctx, w, s, e.x, e.y, 0.55, depth + 1)
}

function plagueCloud(ctx: Ctx, w: WeaponInst, s: WStats, x: number, y: number, scale: number, depth: number): void {
    const evo = w.evolved
    const R = 72 * s.area * (evo ? 1.4 : 1) * scale
    ctx.zone({
        x,
        y,
        radius: R,
        life: s.duration * (scale < 1 ? 0.6 : 1),
        tick: 0.35,
        damage: s.damage,
        color: evo ? 0xc8ff3a : 0x8aff5a,
        kind: 'poison',
        weapon: w,
        hit: {
            slow: Math.min(0.7, 0.25 + s.extra),
            slowT: 0.5,
            noNumber: true,
            onKill: evo && depth < 2 ? (e: EnemyRt) => spreadPlague(ctx, w, s, e, depth) : undefined
        }
    })
}

const plague: WeaponDef = {
    id: 'plague',
    name: 'Plague Cloud',
    icon: 'i-lucide-biohazard',
    color: 0x8aff5a,
    description: 'Poison clouds that damage and slow.',
    usesAmount: true,
    amountLabel: 'cloud',
    extraLabel: v => `+${Math.round(v * 100)}% slow`,
    base: B({ damage: 6, cooldown: 3.2, amount: 1, area: 1, duration: 4, extra: 0 }),
    levels: [
        { damage: 0.25 },
        { area: 0.2 },
        { amount: 1 },
        { duration: 0.3 },
        { cooldown: 0.15 },
        { amount: 1 },
        { damage: 0.4, extra: 0.15 }
    ],
    evo: {
        id: 'pestilence',
        name: 'Pestilence',
        icon: 'i-lucide-skull',
        color: 0xc8ff3a,
        description: 'Bigger clouds. Kills inside spread new clouds.',
        passive: 'growth',
        bonus: { damage: 0.6, area: 0.25, duration: 0.3 }
    },
    fire(ctx, w, s) {
        for (let i = 0; i < s.amount; i++) {
            const p = ctx.player
            const e = ctx.randomEnemy(p.x, p.y, 460)
            const x = e ? e.x : p.x + rnd(-200, 200)
            const y = e ? e.y : p.y + rnd(-160, 160)
            plagueCloud(ctx, w, s, x, y, 1, 0)
            ctx.fx.burst(x, y, { count: 10, color: 0x8aff5a, tex: 'p.smoke', speed: 140, life: 0.6, size: 18, alpha: 0.6 })
        }
        ctx.play('summon', { volume: 0.25, pitch: 1.8 }, 0.2)
    }
}

// ─── Aegis Orbit ─────────────────────────────────────────────────────────

const aegis: WeaponDef = {
    id: 'aegis',
    name: 'Aegis Orbit',
    icon: 'i-lucide-shield-half',
    color: 0xffe9a0,
    description: 'Shields circle you, block enemy shots and knock enemies back.',
    usesAmount: true,
    amountLabel: 'shield',
    base: B({ damage: 10, cooldown: 0, amount: 2, speed: 1, area: 1, knock: 320 }),
    levels: [
        { amount: 1 },
        { damage: 0.25 },
        { area: 0.2 },
        { speed: 0.25 },
        { amount: 1 },
        { damage: 0.3 },
        { amount: 1, damage: 0.3 }
    ],
    evo: {
        id: 'bastion',
        name: 'Bastion',
        icon: 'i-lucide-castle',
        color: 0xfff6d0,
        description: 'Bigger shields. Blocked shots fire back as holy bolts.',
        passive: 'spellpower',
        bonus: { damage: 0.6, area: 0.2, amount: 1 }
    },
    tick(ctx, w, s, dt) {
        const st = w.st
        const evo = w.evolved
        const want = Math.max(1, Math.round(s.amount))
        if (!st.orbs || st.count !== want || st.evo !== evo) {
            for (const o of (st.orbs ?? []) as Projectile[]) o.alive = false
            const orbs: Projectile[] = []
            for (let i = 0; i < want; i++) {
                orbs.push(ctx.projectile({
                    x: ctx.player.x,
                    y: ctx.player.y,
                    vx: 0,
                    vy: 0,
                    tex: evo ? 'aegisEvo' : 'aegis',
                    radius: 18,
                    damage: s.damage,
                    pierce: 1e9,
                    rehit: 0.6,
                    life: 1e9,
                    weapon: w,
                    glow: evo ? 0xfff6d0 : 0xffd54f,
                    glowSize: 54,
                    faceVel: false,
                    hit: { knock: s.knock, color: 0xfff2b0 },
                    data: { idx: i, n: want },
                    update: (o, c) => {
                        const pl = c.player
                        const ang = (st.t ?? 0) + (o.data.idx! / o.data.n!) * TAU
                        o.x = pl.x + Math.cos(ang) * st.R
                        o.y = pl.y + Math.sin(ang) * st.R - 6
                        o.sprite.rotation = ang + Math.PI / 2
                    }
                }))
            }
            st.orbs = orbs
            st.count = want
            st.evo = evo
        }
        st.t = (st.t ?? 0) + dt * 2.2 * s.speed
        st.R = 62 * Math.sqrt(s.area) + 10
        const size = Math.sqrt(s.area) * (evo ? 1.3 : 1)
        for (const o of st.orbs as Projectile[]) {
            o.damage = s.damage
            o.radius = 18 * size
            o.scale = size
            o.hit.knock = s.knock
            const blocked = ctx.clearShots(o.x, o.y, 20 * size)
            if (blocked > 0) {
                ctx.fx.burst(o.x, o.y, { count: 6, color: 0xfff2b0, tex: 'p.spark', speed: 300, life: 0.2, size: 6 })
                ctx.play('hit', { volume: 0.4, pitch: 2 }, 0.05)
                if (evo) {
                    const e = ctx.nearest(o.x, o.y, 520)
                    if (e) {
                        const a = Math.atan2(e.y - o.y, e.x - o.x)
                        ctx.projectile({ x: o.x, y: o.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, tex: 'bolt', color: 0xfff2b0, radius: 9, damage: s.damage * 2.5, pierce: 3, life: 0.8, weapon: w, additive: true, trail: { color: 0xffe27a, rate: 40, tex: 'p.star', size: 5, life: 0.2 } })
                    }
                }
            }
        }
    },
    cleanup(_ctx, w) {
        for (const o of (w.st.orbs ?? []) as Projectile[]) o.alive = false
        w.st.orbs = null
    }
}

export const WEAPON_DEFS: Record<string, WeaponDef> = Object.fromEntries([
    cleaver,
    longbow,
    fireball,
    chainLightning,
    soulSkulls,
    voidOrbs,
    daggers,
    holyAura,
    boomerang,
    frostNova,
    meteor,
    laser,
    mines,
    ricochetBolt,
    stormTotem,
    plague,
    aegis
].map(d => [d.id, d]))

export const WEAPON_MAX_LEVEL = 8

export function emptyMods(): Required<WMods> {
    return { damage: 0, cooldown: 0, area: 0, amount: 0, pierce: 0, speed: 0, duration: 0, chain: 0, extra: 0 }
}

export function addMods(into: Required<WMods>, m: WMods, scale = 1): void {
    into.damage += (m.damage ?? 0) * scale
    into.cooldown += (m.cooldown ?? 0) * scale
    into.area += (m.area ?? 0) * scale
    into.speed += (m.speed ?? 0) * scale
    into.duration += (m.duration ?? 0) * scale
    into.extra += (m.extra ?? 0) * scale
    into.amount += m.amount ?? 0
    into.pierce += m.pierce ?? 0
    into.chain += m.chain ?? 0
}

export function weaponStats(ctx: Ctx, w: WeaponInst): WStats {
    const b = w.def.base
    const m = w.mods
    const s = ctx.stats
    return {
        damage: b.damage * (1 + m.damage) * s.might,
        cooldown: b.cooldown * Math.max(0.3, 1 - m.cooldown) * s.cooldown,
        area: b.area * (1 + m.area) * s.area,
        amount: Math.max(1, b.amount + m.amount + (w.def.usesAmount ? s.amount : 0)),
        pierce: b.pierce + m.pierce,
        speed: b.speed * (1 + m.speed) * (w.def.id === 'voidOrbs' || w.def.id === 'aegis' ? 1 : s.projSpeed),
        duration: b.duration * (1 + m.duration) * (w.def.id === 'laser' || w.def.id === 'boomerang' ? Math.sqrt(s.duration) : s.duration),
        chain: b.chain + m.chain,
        knock: b.knock,
        extra: b.extra + m.extra
    }
}

function pct(v: number): string {
    return `${Math.round(v * 100)}%`
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`
}

/** Card text for a set of level gains at a rarity scale. */
export function describeMods(def: WeaponDef, m: WMods, scale: number, bonusDamage: number): string {
    const parts: string[] = []
    const dmg = (m.damage ?? 0) * scale + bonusDamage
    if (dmg > 0) parts.push(`+${pct(dmg)} damage`)
    if (m.cooldown) parts.push(`-${pct(m.cooldown * scale)} cooldown`)
    if (m.area) parts.push(`+${pct(m.area * scale)} area`)
    if (m.amount) parts.push(`+${plural(m.amount, def.amountLabel ?? 'projectile')}`)
    if (m.pierce) parts.push(`+${m.pierce} pierce`)
    if (m.chain) parts.push(`+${plural(m.chain, def.chainLabel ?? 'chain')}`)
    if (m.speed) parts.push(`+${pct(m.speed * scale)} speed`)
    if (m.duration) parts.push(`+${pct(m.duration * scale)} duration`)
    if (m.extra && def.extraLabel) parts.push(def.extraLabel(m.extra * scale))
    return parts.join(', ')
}

export function isIntegerOnly(m: WMods): boolean {
    return !m.damage && !m.cooldown && !m.area && !m.speed && !m.duration && !m.extra
}
