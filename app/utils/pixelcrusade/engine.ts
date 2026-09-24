// Pixel Crusade engine: fixed 60 Hz simulation, pooled effects, rendered to a
// 256×144 logical canvas that is blitted to the display at an integer scale.

import { randomChance, randomInt } from '#shared/utils/random'
import { C, PALETTE, RAMPS, RAMP_ID, rgbIndex, ci, type RampName } from './palette'
import { LW, LH, GROUND, SpriteBuffer, rect, px, line, disc, ring, dither, drawText, drawNumber, textWidth } from './pixel'
import { drawHero, heroShadow, heroJump, heroTip, attackFrame, IMPACT_AT, ACCENT, type HeroPose } from './hero'
import { MONSTERS, drawMonster } from './monsters'
import { drawScenery, drawForeground } from './scenery'
import { ZONES, type MonsterKind, type MonsterPose, type MonsterInfo } from './types'
import {
    CLASSES, CLASS_BY_ID, UPGRADES, KILLS_PER_STAGE, BOSS_TIME, PRESTIGE_MIN_STAGE,
    emptyLevels, isBossStage, monsterHp, monsterGold, upgradeCostN, affordable,
    hitDamage, attackRate, critChance, critMult, specialMult, soulsFor, dps,
    type ClassId, type UpgradeId, type Levels, type HeroClass
} from './economy'

const STEP = 1 / 60
const HERO_X = 64
const RUN_SPEED = 72
const MON_SPEED = 46
const SAVE_KEY = 'pixelcrusade:v1'

export interface CrusadeSave {
    v: 1
    classId: ClassId
    unlocked: ClassId[]
    gold: number
    souls: number
    stage: number
    kills: number
    maxStage: number
    bestStage: number
    levels: Levels
    prestiges: number
    farming: boolean
}

export interface CrusadeSnapshot {
    classId: ClassId
    unlocked: ClassId[]
    gold: number
    souls: number
    stage: number
    kills: number
    maxStage: number
    bestStage: number
    levels: Levels
    prestiges: number
    farming: boolean
    boss: boolean
    zone: string
    hit: number
    dps: number
    rate: number
    crit: number
    critMult: number
    specialMult: number
    soulsOnPrestige: number
    canPrestige: boolean
}

function freshSave(): CrusadeSave {
    return {
        v: 1, classId: 'warrior', unlocked: ['warrior'], gold: 0, souls: 0, stage: 1, kills: 0,
        maxStage: 1, bestStage: 1, levels: emptyLevels(), prestiges: 0, farming: false
    }
}

function rnd(a: number, b: number): number {
    // cosmetic only (particle spread, jitter)
    return a + Math.random() * (b - a)
}

// ------------------------------------------------------------------ pools

const MAXP = 2600

class Particles {
    x = new Float32Array(MAXP)
    y = new Float32Array(MAXP)
    vx = new Float32Array(MAXP)
    vy = new Float32Array(MAXP)
    life = new Float32Array(MAXP)
    max = new Float32Array(MAXP)
    grav = new Float32Array(MAXP)
    drag = new Float32Array(MAXP)
    floor = new Float32Array(MAXP)
    color = new Int16Array(MAXP)
    ramp = new Int8Array(MAXP)
    size = new Uint8Array(MAXP)
    live = new Uint8Array(MAXP)
    cursor = 0

    spawn(x: number, y: number, vx: number, vy: number, life: number, ramp: number, color: number, size: number, grav: number, drag = 0, floor = 0): void {
        let i = this.cursor
        for (let n = 0; n < MAXP; n++) {
            if (!this.live[i]) break
            i = (i + 1) % MAXP
        }
        this.cursor = (i + 1) % MAXP
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy
        this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag
        this.floor[i] = floor; this.color[i] = color; this.ramp[i] = ramp; this.size[i] = size
        this.live[i] = 1
    }

    update(dt: number): void {
        for (let i = 0; i < MAXP; i++) {
            if (!this.live[i]) continue
            const l = this.life[i]! - dt
            if (l <= 0) { this.live[i] = 0; continue }
            this.life[i] = l
            let vx = this.vx[i]!
            let vy = this.vy[i]! + this.grav[i]! * dt
            const d = this.drag[i]!
            if (d > 0) { const k = Math.max(0, 1 - d * dt); vx *= k; vy *= k }
            let y = this.y[i]! + vy * dt
            const f = this.floor[i]!
            if (f > 0 && y > f) {
                y = f
                vy = -vy * 0.35
                vx *= 0.6
                if (Math.abs(vy) < 12) vy = 0
            }
            this.x[i] = this.x[i]! + vx * dt
            this.y[i] = y
            this.vx[i] = vx
            this.vy[i] = vy
        }
    }

    draw(ctx: CanvasRenderingContext2D, frame: number): void {
        for (let i = 0; i < MAXP; i++) {
            if (!this.live[i]) continue
            const age = 1 - this.life[i]! / this.max[i]!
            let idx = this.color[i]!
            if (idx < 0) {
                const r = RAMPS[this.ramp[i]!]!
                idx = r[Math.min(r.length - 1, Math.floor(age * r.length))]!
            } else if (age > 0.8 && (frame & 2)) continue
            ctx.fillStyle = PALETTE[idx]!
            const s = this.size[i]!
            ctx.fillRect(Math.round(this.x[i]!) - (s >> 1), Math.round(this.y[i]!) - (s >> 1), s, s)
        }
    }

    clear(): void {
        this.live.fill(0)
    }
}

const enum NumKind { Hit, Crit, Special, Gold, Tap }

class FloatNum {
    live = false
    x = 0
    y = 0
    vy = 0
    t = 0
    value = 0
    kind = NumKind.Hit
}

const enum ProjKind { Arrow, Bolt, Meteor, RainArrow, UpArrow }

class Projectile {
    live = false
    kind = ProjKind.Arrow
    x = 0
    y = 0
    vx = 0
    vy = 0
    delay = 0
    dmg = 0
    crit = false
    special = false
    targetY = 0
    t = 0
}

const enum FxKind { Ring, FloorWave, Impact, Beam, Slash, Pillar }

class Effect {
    live = false
    kind = FxKind.Ring
    x = 0
    y = 0
    t = 0
    dur = 0
    size = 0
    color = ''
    color2 = ''
}

class Coin {
    live = false
    x = 0
    y = 0
    vx = 0
    vy = 0
    t = 0
    floor = 0
    flying = false
    value = 0
}

function pool<T>(n: number, make: () => T): T[] {
    const a: T[] = []
    for (let i = 0; i < n; i++) a.push(make())
    return a
}

function take<T extends { live: boolean }>(arr: T[]): T | null {
    for (let i = 0; i < arr.length; i++) if (!arr[i]!.live) return arr[i]!
    return null
}

// ------------------------------------------------------------------ game

export class CrusadeGame {
    save: CrusadeSave = freshSave()

    private logical!: HTMLCanvasElement
    private ctx!: CanvasRenderingContext2D
    private display: HTMLCanvasElement | null = null
    private dctx: CanvasRenderingContext2D | null = null
    private scale = 1
    private sbHero!: SpriteBuffer
    private sbMon!: SpriteBuffer
    private raf = 0
    private last = 0
    private acc = 0
    private frame = 0
    private time = 0
    private saveTimer = 0

    // hero
    private hero: HeroPose = { t: 0, running: false, run: 0, attack: -1, special: false, hurt: 0, charge: 0 }
    private attackDur = 0.5
    private impactDone = false
    private charge = 0
    private heroFlash = 0
    private tapCd = 0

    // monster
    private mKind: MonsterKind = 'slime'
    private mInfo: MonsterInfo = { name: '', boss: false, w: 16, h: 16, hitY: 8, ramp: 'slime' }
    private mPose: MonsterPose = { t: 0, moving: true, walk: 0, attack: 0, hurt: 0 }
    private mX = LW + 40
    private mHp = 1
    private mMaxHp = 1
    private mTrail = 1
    private mAlive = false
    private mFlash = 0
    private mAtkTimer = 2
    private mStopX = 100
    private mGold = 1
    private bossTimer = 0
    private clearTimer = 0.4
    private mId = 0

    // world
    private scroll = 0
    private hitstop = 0
    private shakeT = 0
    private shakeAmp = 0
    private screenFlash = 0
    private screenFlashColor: string = C.white
    private slowmo = 0
    private banner = 0
    private bannerText = ''
    private bannerColor: string = C.gold2

    private particles = new Particles()
    private nums = pool(48, () => new FloatNum())
    private projs = pool(40, () => new Projectile())
    private fx = pool(40, () => new Effect())
    private coins = pool(60, () => new Coin())

    private shatterPending = false
    private shatterHitX = 0

    get cls(): HeroClass {
        return CLASS_BY_ID[this.save.classId]
    }

    // -------------------------------------------------------------- lifecycle

    mount(display: HTMLCanvasElement): void {
        this.logical = document.createElement('canvas')
        this.logical.width = LW
        this.logical.height = LH
        this.ctx = this.logical.getContext('2d')!
        this.ctx.imageSmoothingEnabled = false
        this.sbHero = new SpriteBuffer(64)
        this.sbMon = new SpriteBuffer(128)
        this.display = display
        this.dctx = display.getContext('2d')!
        this.load()
        this.spawnMonster()
        this.last = performance.now()
        const loop = (now: number): void => {
            this.raf = requestAnimationFrame(loop)
            this.tick(now)
        }
        this.raf = requestAnimationFrame(loop)
    }

    unmount(): void {
        cancelAnimationFrame(this.raf)
        this.persist()
    }

    /** Fit the display canvas to a box (CSS px) at the largest integer scale. */
    resize(cssW: number, cssH: number, dpr: number): { width: number, height: number } {
        if (!this.display) return { width: 0, height: 0 }
        const s = Math.max(1, Math.floor(Math.min(cssW * dpr / LW, cssH * dpr / LH)))
        this.scale = s
        this.display.width = LW * s
        this.display.height = LH * s
        this.dctx!.imageSmoothingEnabled = false
        return { width: LW * s / dpr, height: LH * s / dpr }
    }

    private tick(now: number): void {
        let dt = (now - this.last) / 1000
        this.last = now
        if (dt > 0.25) dt = 0.25
        this.acc += dt
        let steps = 0
        while (this.acc >= STEP && steps < 15) {
            this.update(STEP)
            this.acc -= STEP
            steps++
        }
        if (steps === 15) this.acc = 0
        this.render()
    }

    // -------------------------------------------------------------- persistence

    private load(): void {
        try {
            const raw = localStorage.getItem(SAVE_KEY)
            if (raw) {
                const s = JSON.parse(raw) as Partial<CrusadeSave>
                if (s.v === 1) this.save = { ...freshSave(), ...s, levels: { ...emptyLevels(), ...s.levels } }
            }
        } catch {
            // private mode or corrupt save: start fresh
        }
    }

    persist(): void {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.save))
        } catch {
            // storage unavailable
        }
    }

    reset(): void {
        this.save = freshSave()
        this.persist()
        this.softReset()
    }

    // -------------------------------------------------------------- actions (UI)

    snapshot(): CrusadeSnapshot {
        const s = this.save
        const c = this.cls
        return {
            classId: s.classId, unlocked: [...s.unlocked], gold: s.gold, souls: s.souls, stage: s.stage,
            kills: s.kills, maxStage: s.maxStage, bestStage: s.bestStage, levels: { ...s.levels },
            prestiges: s.prestiges, farming: s.farming, boss: isBossStage(s.stage),
            zone: ZONES[this.zoneIndex()]!.name,
            hit: hitDamage(c, s.levels, s.souls), dps: dps(c, s.levels, s.souls), rate: attackRate(c, s.levels),
            crit: critChance(c, s.levels), critMult: critMult(s.levels), specialMult: specialMult(c, s.levels),
            soulsOnPrestige: soulsFor(s.maxStage), canPrestige: s.maxStage >= PRESTIGE_MIN_STAGE
        }
    }

    /** Buy up to `qty` levels (Infinity = max affordable). Returns levels bought. */
    buy(id: UpgradeId, qty: number): number {
        const def = UPGRADES.find(u => u.id === id)!
        const lv = this.save.levels[id]
        const n = Math.min(qty, affordable(def, lv, this.save.gold))
        if (n <= 0) return 0
        this.save.gold -= upgradeCostN(def, lv, n)
        this.save.levels[id] = lv + n
        this.powerUp()
        return n
    }

    costOf(id: UpgradeId, qty: number): number {
        const def = UPGRADES.find(u => u.id === id)!
        return upgradeCostN(def, this.save.levels[id], qty)
    }

    fightBoss(): void {
        this.save.farming = false
    }

    prestige(next: ClassId): boolean {
        const s = this.save
        if (s.maxStage < PRESTIGE_MIN_STAGE) return false
        for (const c of CLASSES) {
            if (s.maxStage >= c.unlockStage && !s.unlocked.includes(c.id)) s.unlocked.push(c.id)
        }
        if (!s.unlocked.includes(next)) return false
        s.souls += soulsFor(s.maxStage)
        s.prestiges++
        s.classId = next
        s.gold = 0
        s.stage = 1
        s.kills = 0
        s.maxStage = 1
        s.levels = emptyLevels()
        s.farming = false
        this.persist()
        this.softReset()
        this.screenFlash = 1
        this.screenFlashColor = C.white
        this.spawnFx(FxKind.Pillar, HERO_X, GROUND, 0.9, 10, C.gold3, C.white)
        this.showBanner(CLASS_BY_ID[next].name.toUpperCase(), ACCENT[next])
        for (let i = 0; i < 60; i++) {
            this.particles.spawn(HERO_X + rnd(-8, 8), GROUND - rnd(0, 30), rnd(-20, 20), rnd(-90, -30), rnd(0.6, 1.4), RAMP_ID.holy, -1, 1, -20, 1)
        }
        return true
    }

    /** Players can switch between unlocked classes only through prestige; this previews it. */
    classUnlockedNext(): ClassId[] {
        const out: ClassId[] = []
        for (const c of CLASSES) {
            if (this.save.unlocked.includes(c.id) || this.save.maxStage >= c.unlockStage) out.push(c.id)
        }
        return out
    }

    tap(): void {
        if (!this.mAlive || this.tapCd > 0 || (this.mPose.moving && this.mX > LW - 10)) return
        this.tapCd = 0.09
        const c = this.cls
        const lv = this.save.levels
        const crit = randomChance(critChance(c, lv))
        const dmg = hitDamage(c, lv, this.save.souls) * 0.3 * (crit ? critMult(lv) : 1)
        const hy = GROUND - this.mInfo.hitY
        this.spawnFx(FxKind.Slash, this.mX + rnd(-4, 4), hy + rnd(-4, 4), 0.12, rnd(0, 3), C.white, ACCENT[c.id])
        this.damage(dmg, crit, false, true)
    }

    private softReset(): void {
        this.particles.clear()
        for (const n of this.nums) n.live = false
        for (const p of this.projs) p.live = false
        for (const c of this.coins) c.live = false
        for (const f of this.fx) f.live = false
        this.hero.attack = -1
        this.charge = 0
        this.mAlive = false
        this.clearTimer = 0.6
    }

    // -------------------------------------------------------------- helpers

    private zoneIndex(): number {
        return Math.floor((this.save.stage - 1) / 10) % ZONES.length
    }

    private shake(amp: number, t: number): void {
        if (amp >= this.shakeAmp || this.shakeT <= 0) { this.shakeAmp = amp; this.shakeT = t }
    }

    private showBanner(text: string, color: string): void {
        this.bannerText = text
        this.bannerColor = color
        this.banner = 1.8
    }

    private spawnNum(x: number, y: number, value: number, kind: NumKind): void {
        const n = take(this.nums)
        if (!n) return
        n.live = true
        n.x = x
        n.y = y
        n.vy = kind === NumKind.Crit || kind === NumKind.Special ? -70 : -48
        n.t = 0
        n.value = value
        n.kind = kind
    }

    private spawnFx(kind: FxKind, x: number, y: number, dur: number, size: number, color: string, color2: string): void {
        const f = take(this.fx)
        if (!f) return
        f.live = true
        f.kind = kind
        f.x = x
        f.y = y
        f.t = 0
        f.dur = dur
        f.size = size
        f.color = color
        f.color2 = color2
    }

    private burst(x: number, y: number, n: number, ramp: RampName, speed: number, dirX: number, grav = 260, size = 1, up = 0.6): void {
        const r = RAMP_ID[ramp]
        for (let i = 0; i < n; i++) {
            const a = rnd(-Math.PI, Math.PI)
            const s = rnd(speed * 0.3, speed)
            const vx = Math.cos(a) * s + dirX * speed * 0.6
            const vy = Math.sin(a) * s - speed * up
            this.particles.spawn(x, y, vx, vy, rnd(0.25, 0.6), r, -1, size, grav, 1.5, GROUND + rnd(1, 8))
        }
    }

    private powerUp(): void {
        const c = ACCENT[this.save.classId]
        for (let i = 0; i < 14; i++) {
            this.particles.spawn(HERO_X + rnd(-9, 9), GROUND - rnd(0, 6), rnd(-6, 6), rnd(-70, -35), rnd(0.4, 0.8), RAMP_ID.holy, -1, 1, -10, 0.5)
        }
        this.spawnFx(FxKind.Ring, HERO_X, GROUND - 12, 0.3, 14, c, C.white)
    }

    // -------------------------------------------------------------- monsters

    private spawnMonster(): void {
        const s = this.save
        const boss = isBossStage(s.stage)
        const zone = ZONES[this.zoneIndex()]!
        this.mKind = boss ? zone.boss : zone.monsters[randomInt(0, 2)]!
        this.mInfo = MONSTERS[this.mKind]
        this.mMaxHp = monsterHp(s.stage, boss)
        this.mHp = this.mMaxHp
        this.mTrail = this.mMaxHp
        this.mGold = monsterGold(s.stage, boss)
        this.mAlive = true
        this.mX = LW + 20 + this.mInfo.w / 2
        this.mStopX = HERO_X + 16 + Math.round(this.mInfo.w / 2)
        this.mPose.t = 0
        this.mPose.walk = 0
        this.mPose.moving = true
        this.mPose.attack = 0
        this.mPose.hurt = 0
        this.mAtkTimer = rnd(1.4, 2.2)
        this.mFlash = 0
        this.mId++
        this.bossTimer = BOSS_TIME
        if (boss) {
            this.showBanner(this.mInfo.name.toUpperCase(), C.red3)
            this.shake(1, 0.6)
        }
    }

    private inRange(): boolean {
        if (!this.mAlive) return false
        if (this.cls.ranged) return this.mX < LW - 24
        return this.mX <= this.mStopX + 10
    }

    private damage(dmg: number, crit: boolean, special: boolean, tap = false): void {
        if (!this.mAlive) return
        this.mHp -= dmg
        this.mPose.hurt = 1
        this.mFlash = tap ? 0.04 : 0.07
        const kb = this.mInfo.boss ? 1 : (special ? 8 : crit ? 5 : 3)
        this.mX = Math.min(this.mX + kb, LW - 10)
        const hy = GROUND - this.mInfo.hitY
        const hx = this.mX - (this.mInfo.w >> 2)
        this.spawnNum(this.mX + rnd(-6, 6), hy - this.mInfo.h * 0.4 - 4, dmg, special ? NumKind.Special : crit ? NumKind.Crit : tap ? NumKind.Tap : NumKind.Hit)
        const ramp: RampName = this.save.classId === 'mage' ? 'arcane' : this.save.classId === 'paladin' ? 'holy' : this.save.classId === 'ranger' ? 'nature' : 'spark'
        if (!tap) {
            this.hitstop = Math.max(this.hitstop, special ? 7 : crit ? 5 : 2)
            this.shake(special ? 3 : crit ? 2 : 1, special ? 0.35 : crit ? 0.18 : 0.08)
            this.spawnFx(FxKind.Impact, hx, hy, crit || special ? 0.2 : 0.13, crit || special ? 9 : 6, C.white, ACCENT[this.save.classId])
            this.burst(hx, hy, crit ? 18 : 10, ramp, crit ? 150 : 110, 1)
            this.burst(hx, hy, 6, this.mInfo.ramp, 90, 1)
        } else {
            this.hitstop = Math.max(this.hitstop, 1)
            this.burst(hx, hy, 4, ramp, 80, 1)
        }
        if (crit) this.screenFlash = Math.max(this.screenFlash, 0.25)
        if (this.mHp <= 0) this.kill(hx)
    }

    private kill(hitX: number): void {
        this.mAlive = false
        this.mHp = 0
        const boss = this.mInfo.boss
        this.shatterPending = true
        this.shatterHitX = hitX
        const cx = this.mX
        const cy = GROUND - this.mInfo.hitY
        this.spawnFx(FxKind.Ring, cx, cy, 0.35, boss ? 40 : 18, C.white, C.gold2)
        this.hitstop = Math.max(this.hitstop, boss ? 14 : 6)
        this.shake(boss ? 4 : 2, boss ? 0.8 : 0.25)
        if (boss) {
            this.slowmo = 1
            this.screenFlash = 1
            this.screenFlashColor = C.white
            this.spawnFx(FxKind.Ring, cx, cy, 0.7, 70, C.gold3, C.orange)
            this.showBanner('BOSS SLAIN', C.gold2)
        }
        // coins carry the reward; gold is credited as each one lands in the purse
        const n = boss ? 24 : Math.min(10, 3 + Math.floor(this.save.stage / 6))
        const share = this.mGold / n
        let leftover = 0
        for (let i = 0; i < n; i++) {
            const c = take(this.coins)
            if (!c) { leftover += share; continue }
            c.live = true
            c.x = cx + rnd(-4, 4)
            c.y = cy
            c.vx = rnd(-30, 70)
            c.vy = rnd(-150, -80)
            c.floor = GROUND + rnd(2, 10)
            c.t = rnd(-0.15, 0)
            c.flying = false
            c.value = share
        }
        if (leftover > 0) this.save.gold += leftover
        this.spawnNum(cx, cy - this.mInfo.h * 0.5 - 12, this.mGold, NumKind.Gold)

        const s = this.save
        if (boss) {
            s.stage++
            s.kills = 0
        } else {
            s.kills++
            if (s.kills >= KILLS_PER_STAGE) {
                s.kills = 0
                if (!(s.farming && isBossStage(s.stage + 1))) s.stage++
            }
        }
        if (s.stage > s.maxStage) s.maxStage = s.stage
        if (s.stage > s.bestStage) s.bestStage = s.stage
        this.clearTimer = boss ? 1.6 : 0.55
    }

    /** Break the last drawn monster frame into falling pixel chunks. */
    private shatter(): void {
        this.shatterPending = false
        this.mFlash = 0
        const sb = this.sbMon
        const data = sb.pixels()
        const size = sb.size
        const ox = Math.round(this.mX) - sb.ax
        const oy = GROUND - sb.ay
        const cx = this.mX
        const cy = GROUND - this.mInfo.hitY
        let count = 0
        for (let y = 0; y < size; y += 2) {
            for (let x = 0; x < size; x += 2) {
                const o = (y * size + x) * 4
                if (data[o + 3]! < 128) continue
                count++
            }
        }
        const step = count > 700 ? 2 : 1
        let k = 0
        for (let y = 0; y < size; y += 2) {
            for (let x = 0; x < size; x += 2) {
                const o = (y * size + x) * 4
                if (data[o + 3]! < 128) continue
                if (k++ % step) continue
                const idx = rgbIndex((data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!)
                const wx = ox + x
                const wy = oy + y
                const dx = wx - this.shatterHitX
                const dy = wy - cy
                const vx = dx * rnd(2, 5) + rnd(20, 70)
                const vy = dy * rnd(1.5, 4) - rnd(60, 150)
                this.particles.spawn(wx, wy, vx, vy, rnd(0.8, 1.7), 0, idx < 0 ? ci('ink') : idx, 2, 380, 0.4, GROUND + rnd(1, 9))
            }
        }
        this.burst(cx, cy, 20, this.mInfo.ramp, 130, 0.5)
        this.burst(cx, cy, 14, 'spark', 160, 0.3)
    }

    // -------------------------------------------------------------- attacks

    private startAttack(): void {
        const c = this.cls
        const rate = attackRate(c, this.save.levels)
        const special = this.charge >= c.specialEvery
        this.hero.attack = 0
        this.hero.special = special
        this.attackDur = special ? Math.max(0.6, 1.5 / rate) : Math.max(0.2, 1 / rate)
        this.impactDone = false
    }

    private impact(): void {
        const c = this.cls
        const lv = this.save.levels
        const special = this.hero.special
        const crit = randomChance(critChance(c, lv))
        const base = hitDamage(c, lv, this.save.souls) * (crit ? critMult(lv) : 1)
        const tipX = heroTip.x
        const tipY = heroTip.y
        if (special) {
            this.charge = 0
            const dmg = base * specialMult(c, lv)
            switch (c.id) {
                case 'warrior': this.groundSlam(dmg, crit); break
                case 'ranger': this.arrowRain(dmg, crit, tipX, tipY); break
                case 'mage': this.meteor(dmg, crit, tipX, tipY); break
                case 'paladin': this.judgement(dmg, crit); break
            }
            return
        }
        this.charge++
        if (c.id === 'ranger') {
            this.fire(ProjKind.Arrow, tipX, tipY, 330, 0, base, crit)
            this.burst(tipX, tipY, 3, 'steel', 40, 1, 0)
        } else if (c.id === 'mage') {
            this.fire(ProjKind.Bolt, tipX, tipY, 210, 0, base, crit)
            this.spawnFx(FxKind.Ring, tipX, tipY, 0.15, 6, C.cyan, C.white)
            this.burst(tipX, tipY, 8, 'arcane', 80, 0.8, 0)
        } else {
            this.damage(base, crit, false)
        }
    }

    private fire(kind: ProjKind, x: number, y: number, vx: number, vy: number, dmg: number, crit: boolean, delay = 0, special = false): Projectile | null {
        const p = take(this.projs)
        if (!p) {
            // pool exhausted: land the hit directly so no damage is lost
            this.damage(dmg, crit, special)
            return null
        }
        p.live = true
        p.kind = kind
        p.x = x
        p.y = y
        p.vx = vx
        p.vy = vy
        p.dmg = dmg
        p.crit = crit
        p.delay = delay
        p.special = special
        p.t = 0
        p.targetY = GROUND - this.mInfo.hitY
        return p
    }

    private groundSlam(dmg: number, crit: boolean): void {
        const x = HERO_X + 14
        this.spawnFx(FxKind.FloorWave, x, GROUND, 0.5, 90, C.white, C.gold2)
        this.spawnFx(FxKind.Impact, x, GROUND - 3, 0.25, 12, C.white, C.gold2)
        for (let i = 0; i < 40; i++) {
            const dir = i & 1 ? 1 : -1
            this.particles.spawn(x + rnd(-4, 4), GROUND - 1, dir * rnd(30, 170), rnd(-160, -40), rnd(0.4, 0.9), RAMP_ID.dust, -1, i % 3 === 0 ? 2 : 1, 420, 0.5, GROUND + rnd(1, 8))
        }
        this.burst(x, GROUND - 2, 16, 'spark', 140, 0.5)
        this.screenFlash = 0.5
        this.screenFlashColor = C.gold3
        this.damage(dmg, crit, true)
    }

    private arrowRain(dmg: number, crit: boolean, x: number, y: number): void {
        this.fire(ProjKind.UpArrow, x, y, 140, -330, 0, false)
        const n = 8
        for (let i = 0; i < n; i++) {
            const tx = this.mX + rnd(-10, 10) - (this.mInfo.w >> 2)
            const sx = tx - 70 + rnd(-10, 10)
            const p = this.fire(ProjKind.RainArrow, sx, -10 - rnd(0, 30), 0, 0, dmg / n, crit, 0.35 + i * 0.06, true)
            if (p) {
                const ty = GROUND - this.mInfo.hitY + rnd(-6, 6)
                const dy = ty - p.y
                const t = 0.32
                p.vx = (tx - sx) / t
                p.vy = dy / t
                p.targetY = ty
            }
        }
    }

    private meteor(dmg: number, crit: boolean, x: number, y: number): void {
        this.spawnFx(FxKind.Ring, x, y, 0.4, 16, C.cyan, C.purple2)
        this.burst(x, y, 20, 'arcane', 120, 0, 0)
        const tx = this.mX - (this.mInfo.w >> 2)
        const sx = tx + 90
        const sy = -30
        const ty = GROUND - Math.min(this.mInfo.hitY, 14)
        const p = this.fire(ProjKind.Meteor, sx, sy, 0, 0, dmg, crit, 0.12, true)
        if (p) {
            const t = 0.55
            p.vx = (tx - sx) / t
            p.vy = (ty - sy) / t
            p.targetY = ty
        }
    }

    private judgement(dmg: number, crit: boolean): void {
        const x = this.mX - (this.mInfo.w >> 3)
        this.spawnFx(FxKind.Beam, x, GROUND, 0.7, 14, C.gold3, C.white)
        this.spawnFx(FxKind.FloorWave, x, GROUND, 0.5, 60, C.white, C.gold2)
        this.spawnFx(FxKind.FloorWave, HERO_X + 14, GROUND, 0.35, 30, C.white, C.gold2)
        for (let i = 0; i < 40; i++) {
            this.particles.spawn(x + rnd(-8, 8), GROUND - rnd(0, 80), rnd(-15, 15), rnd(-120, -30), rnd(0.4, 1), RAMP_ID.holy, -1, i % 4 === 0 ? 2 : 1, -40, 1)
        }
        this.screenFlash = 0.8
        this.screenFlashColor = C.gold3
        this.damage(dmg, crit, true)
    }

    // -------------------------------------------------------------- update

    private update(dt: number): void {
        this.time += dt
        this.frame++
        this.saveTimer += dt
        if (this.saveTimer > 5) { this.saveTimer = 0; this.persist() }
        if (this.shakeT > 0) this.shakeT -= dt
        if (this.screenFlash > 0) this.screenFlash = Math.max(0, this.screenFlash - dt * 4)
        if (this.banner > 0) this.banner -= dt

        if (this.hitstop > 0) {
            this.hitstop--
            this.particles.update(dt * 0.3)
            return
        }
        if (this.shatterPending) this.shatter()
        if (this.slowmo > 0) {
            this.slowmo -= dt
            dt *= 0.35
        }

        const h = this.hero
        h.t += dt
        if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt * 5)
        if (this.heroFlash > 0) this.heroFlash -= dt
        if (this.mFlash > 0) this.mFlash -= dt
        if (this.tapCd > 0) this.tapCd -= dt
        h.charge = this.charge / this.cls.specialEvery

        // spawn the next foe after a kill
        if (!this.mAlive) {
            this.clearTimer -= dt
            if (this.clearTimer <= 0 && h.attack < 0) this.spawnMonster()
        }

        // monster approach
        const mp = this.mPose
        mp.t += dt
        if (mp.hurt > 0) mp.hurt = Math.max(0, mp.hurt - dt * 4)
        if (this.mTrail > this.mHp) this.mTrail = Math.max(this.mHp, this.mTrail - Math.max(this.mMaxHp * 0.6, this.mTrail - this.mHp) * dt * 2)
        const runUntil = this.cls.ranged ? LW - 40 : this.mStopX + 44
        h.running = !this.mAlive ? false : this.mX > runUntil && h.attack < 0
        if (!this.mAlive && this.clearTimer < 0.25) h.running = true
        if (h.running) {
            h.run += dt
            this.scroll += RUN_SPEED * dt
            if (Math.floor(h.run * 12) % 3 === 0 && (this.frame & 7) === 0) {
                this.particles.spawn(HERO_X - 3, GROUND - 1, rnd(-40, -20), rnd(-20, -5), 0.35, RAMP_ID.dust, -1, 1, 60, 1)
            }
        }
        if (this.mAlive) {
            if (this.mX > this.mStopX && mp.attack === 0) {
                mp.moving = true
                mp.walk += dt
                this.mX -= (MON_SPEED + (h.running ? RUN_SPEED : 0)) * dt
                if (this.mX < this.mStopX) this.mX = this.mStopX
            } else {
                mp.moving = false
            }
            // monster attacks when it reaches the hero
            if (mp.attack > 0) {
                const prev = mp.attack
                mp.attack += dt / (this.mInfo.boss ? 1.1 : 0.8)
                if (prev < 0.55 && mp.attack >= 0.55) this.monsterHits()
                if (mp.attack >= 1) { mp.attack = 0; this.mAtkTimer = rnd(2, 3.2) }
            } else if (!mp.moving && this.mX <= this.mStopX + 1) {
                this.mAtkTimer -= dt
                if (this.mAtkTimer <= 0) mp.attack = 0.001
            }
            if (isBossStage(this.save.stage) && !h.running) {
                this.bossTimer -= dt
                if (this.bossTimer <= 0) this.bossEscaped()
            }
        }

        // hero attack cycle
        if (h.attack < 0) {
            if (this.inRange()) this.startAttack()
        } else {
            const prev = h.attack
            h.attack += dt / this.attackDur
            const f = attackFrame(h.attack)
            if (!this.impactDone && h.attack >= IMPACT_AT) {
                this.impactDone = true
                if (this.mAlive) this.impact()
            }
            this.chargeFx(f, prev)
            if (h.attack >= 1) h.attack = -1
        }

        this.updateProjectiles(dt)
        this.updateCoins(dt)
        this.particles.update(dt)
        for (const n of this.nums) {
            if (!n.live) continue
            n.t += dt
            n.y += n.vy * dt
            n.vy *= Math.max(0, 1 - dt * 5)
            if (n.t > (n.kind === NumKind.Gold ? 1.1 : 0.85)) n.live = false
        }
        for (const f of this.fx) {
            if (!f.live) continue
            f.t += dt
            if (f.t >= f.dur) f.live = false
        }
    }

    private chargeFx(frame: number, prev: number): void {
        const id = this.save.classId
        const h = this.hero
        if (frame < 1 || frame > 2) return
        const tx = heroTip.x
        const ty = heroTip.y
        if (id === 'mage' || (h.special && id !== 'warrior')) {
            // sparks spiral in toward the focus
            if ((this.frame & 1) === 0) {
                const a = rnd(0, Math.PI * 2)
                const r = h.special ? 16 : 11
                const sx = tx + Math.cos(a) * r
                const sy = ty + Math.sin(a) * r
                const sp = h.special ? 70 : 55
                const tang = 30
                const vx = -Math.cos(a) * sp - Math.sin(a) * tang
                const vy = -Math.sin(a) * sp + Math.cos(a) * tang
                const ramp = id === 'mage' ? RAMP_ID.arcane : id === 'paladin' ? RAMP_ID.holy : RAMP_ID.nature
                this.particles.spawn(sx, sy, vx, vy, r / sp, ramp, -1, 1, 0, 0)
            }
        }
        if (h.special && id === 'warrior' && prev < 0.22 && h.attack >= 0.22) {
            // launch off the ground
            this.burst(HERO_X, GROUND - 1, 10, 'dust', 70, 0, 200)
        }
        if (h.special && id === 'paladin' && (this.frame & 3) === 0) {
            this.particles.spawn(HERO_X + rnd(-10, 10), GROUND - rnd(0, 4), 0, rnd(-60, -30), 0.6, RAMP_ID.holy, -1, 1, 0, 0)
        }
    }

    private monsterHits(): void {
        const h = this.hero
        h.hurt = 1
        this.heroFlash = 0.06
        this.shake(this.mInfo.boss ? 2 : 1, 0.12)
        this.burst(HERO_X + 6, GROUND - 14, 6, 'steel', 90, -1)
        this.burst(HERO_X + 6, GROUND - 14, 4, this.mInfo.ramp, 70, -1)
    }

    private bossEscaped(): void {
        const s = this.save
        this.mAlive = false
        // the boss vanishes in a puff of dust
        this.burst(this.mX, GROUND - this.mInfo.hitY, 40, 'dust', 120, 0.5)
        this.spawnFx(FxKind.Ring, this.mX, GROUND - this.mInfo.hitY, 0.4, 30, C.stone3, C.stone1)
        this.showBanner('BOSS ESCAPED', C.red3)
        s.stage = Math.max(1, s.stage - 1)
        s.kills = 0
        s.farming = true
        this.clearTimer = 1.2
    }

    private updateProjectiles(dt: number): void {
        for (const p of this.projs) {
            if (!p.live) continue
            if (p.delay > 0) { p.delay -= dt; continue }
            p.t += dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            const hitX = this.mX - (this.mInfo.w >> 2)
            switch (p.kind) {
                case ProjKind.UpArrow:
                    if (p.y < -20) p.live = false
                    break
                case ProjKind.Arrow:
                case ProjKind.Bolt:
                    if (p.kind === ProjKind.Bolt && (this.frame & 1) === 0) {
                        this.particles.spawn(p.x - 2, p.y + rnd(-1, 1), rnd(-30, -10), rnd(-10, 10), 0.3, RAMP_ID.arcane, -1, 1, 0, 1)
                    }
                    if (this.mAlive && p.x >= hitX) {
                        p.live = false
                        this.damage(p.dmg, p.crit, false)
                    } else if (p.x > LW + 10) {
                        p.live = false
                    }
                    break
                case ProjKind.RainArrow:
                    if (p.y >= p.targetY) {
                        p.live = false
                        if (this.mAlive) this.damage(p.dmg, p.crit, false)
                        else this.burst(p.x, GROUND - 1, 3, 'dust', 50, 0)
                    }
                    break
                case ProjKind.Meteor:
                    for (let i = 0; i < 3; i++) {
                        this.particles.spawn(p.x + rnd(-3, 3), p.y + rnd(-3, 3), rnd(10, 40), rnd(-40, -10), rnd(0.2, 0.5), RAMP_ID.fire, -1, i === 0 ? 2 : 1, -30, 1)
                    }
                    if ((this.frame & 3) === 0) this.particles.spawn(p.x, p.y, rnd(10, 20), rnd(-20, 0), 0.8, RAMP_ID.dust, -1, 2, -10, 1)
                    if (p.y >= p.targetY) {
                        p.live = false
                        this.explode(p.x, p.y)
                        if (this.mAlive) this.damage(p.dmg, p.crit, true)
                    }
                    break
            }
        }
    }

    private explode(x: number, y: number): void {
        this.spawnFx(FxKind.Ring, x, y, 0.45, 34, C.gold3, C.lava1)
        this.spawnFx(FxKind.Ring, x, y, 0.3, 20, C.white, C.orange)
        this.spawnFx(FxKind.FloorWave, x, GROUND, 0.5, 80, C.gold3, C.orange)
        this.spawnFx(FxKind.Impact, x, y, 0.25, 14, C.white, C.gold2)
        this.burst(x, y, 50, 'fire', 190, 0.3, 200, 1, 0.8)
        this.burst(x, y, 16, 'ember', 120, 0, 260, 2, 0.9)
        for (let i = 0; i < 14; i++) {
            this.particles.spawn(x + rnd(-10, 10), y + rnd(-6, 2), rnd(-20, 20), rnd(-40, -10), rnd(0.8, 1.4), RAMP_ID.dust, -1, 2, -15, 1)
        }
        this.screenFlash = 0.9
        this.screenFlashColor = C.gold3
        this.shake(4, 0.4)
    }

    private updateCoins(dt: number): void {
        for (const c of this.coins) {
            if (!c.live) continue
            c.t += dt
            if (c.t < 0) continue
            if (!c.flying) {
                c.vy += 420 * dt
                c.x += c.vx * dt
                c.y += c.vy * dt
                if (c.y > c.floor) {
                    c.y = c.floor
                    c.vy = -c.vy * 0.45
                    c.vx *= 0.6
                }
                if (c.t > 0.75) { c.flying = true; c.vx = rnd(-60, 60); c.vy = rnd(-120, -60) }
            } else {
                // home toward the purse in the top-left corner
                const dx = 8 - c.x
                const dy = 8 - c.y
                const d = Math.max(1, Math.hypot(dx, dy))
                const acc = 1600
                c.vx += dx / d * acc * dt
                c.vy += dy / d * acc * dt
                c.vx *= 1 - dt * 3
                c.vy *= 1 - dt * 3
                c.x += c.vx * dt
                c.y += c.vy * dt
                if (d < 6 || c.t > 3) {
                    c.live = false
                    this.save.gold += c.value
                    this.particles.spawn(8, 8, rnd(-30, 30), rnd(-30, 30), 0.25, RAMP_ID.holy, -1, 1, 0, 2)
                }
            }
        }
    }

    // -------------------------------------------------------------- render

    private render(): void {
        const g = this.ctx
        const zone = this.zoneIndex()
        let sx = 0
        let sy = 0
        if (this.shakeT > 0) {
            const a = this.shakeAmp
            // quantised shake: new offset every 2 ticks
            const k = Math.floor(this.time * 30)
            sx = ((k * 7919) % 3 - 1) * a
            sy = ((k * 104729) % 3 - 1) * Math.max(1, a - 1)
        }
        g.setTransform(1, 0, 0, 1, sx, sy)
        drawScenery(g, zone, this.scroll, this.time)

        // beams render behind the actors
        for (const f of this.fx) if (f.live && (f.kind === FxKind.Beam || f.kind === FxKind.Pillar)) this.drawFx(g, f)

        // monster
        if (this.mAlive || this.mFlash > 0) {
            const flash = this.mFlash > 0 ? (this.mFlash > 0.035 ? C.white : C.red3) : null
            const bossLow = this.mInfo.boss && this.mHp < this.mMaxHp * 0.3 && (this.frame & 16) ? C.red2 : null
            drawMonster(g, this.sbMon, this.mKind, this.mX, GROUND, this.mPose, flash, bossLow)
        }

        // hero
        const h = this.hero
        heroShadow(g, HERO_X, heroJump(this.save.classId, h))
        drawHero(g, this.sbHero, this.save.classId, HERO_X, GROUND, h, this.heroFlash > 0 ? C.white : null)

        this.drawProjectiles(g)
        this.particles.draw(g, this.frame)
        for (const f of this.fx) if (f.live && f.kind !== FxKind.Beam && f.kind !== FxKind.Pillar) this.drawFx(g, f)
        drawForeground(g, zone, this.scroll, this.time)
        this.drawCoins(g)
        this.drawNums(g)

        if (this.screenFlash > 0) {
            const lvl = Math.ceil(this.screenFlash * 2)
            if (lvl > 0) dither(g, -4, -4, LW + 8, LH + 8, this.screenFlashColor, Math.min(2, lvl))
        }

        g.setTransform(1, 0, 0, 1, 0, 0)
        this.drawHud(g)

        const d = this.dctx
        if (d && this.display) {
            d.imageSmoothingEnabled = false
            d.drawImage(this.logical, 0, 0, LW * this.scale, LH * this.scale)
        }
    }

    private drawProjectiles(g: CanvasRenderingContext2D): void {
        for (const p of this.projs) {
            if (!p.live || p.delay > 0) continue
            const x = Math.round(p.x)
            const y = Math.round(p.y)
            switch (p.kind) {
                case ProjKind.Arrow:
                case ProjKind.RainArrow:
                case ProjKind.UpArrow: {
                    const sp = Math.hypot(p.vx, p.vy) || 1
                    const dx = p.vx / sp
                    const dy = p.vy / sp
                    const bx = Math.round(x - dx * 9)
                    const by = Math.round(y - dy * 9)
                    line(g, bx, by, x, y, C.brown3)
                    px(g, x, y, C.white)
                    px(g, Math.round(x - dx), Math.round(y - dy), C.steel3)
                    px(g, bx, by - 1, C.red2)
                    px(g, bx - 1, by, C.red2)
                    // speed lines
                    px(g, Math.round(bx - dx * 4), Math.round(by - dy * 4), C.steel1)
                    px(g, Math.round(bx - dx * 8), Math.round(by - dy * 8), C.steel0)
                    break
                }
                case ProjKind.Bolt: {
                    const f = this.frame >> 2 & 1
                    disc(g, x - 3, y, 1, C.purple1)
                    disc(g, x, y, 2 + f, C.purple2)
                    disc(g, x, y, 1 + f, C.cyan)
                    rect(g, x - 1, y - 1, 2, 2, C.white)
                    px(g, x + 3 + f, y, C.white)
                    break
                }
                case ProjKind.Meteor: {
                    const f = this.frame >> 2 & 1
                    disc(g, x, y, 6 + f, C.red1)
                    disc(g, x, y, 5, C.lava1)
                    disc(g, x - 1, y - 1, 3 + f, C.orange)
                    disc(g, x - 1, y - 1, 2, C.gold2)
                    rect(g, x - 2, y - 2, 2, 2, C.gold3)
                    px(g, x - 2, y - 2, C.white)
                    // rocky crust
                    px(g, x + 4, y + 3, C.brown1); px(g, x + 5, y + 1, C.brown1); px(g, x + 2, y + 5, C.brown1)
                    break
                }
            }
        }
    }

    private drawFx(g: CanvasRenderingContext2D, f: Effect): void {
        const k = f.t / f.dur
        const x = Math.round(f.x)
        const y = Math.round(f.y)
        switch (f.kind) {
            case FxKind.Ring: {
                const r = Math.round(f.size * (1 - (1 - k) * (1 - k)))
                ring(g, x, y, r, k < 0.3 ? C.white : k < 0.6 ? f.color : f.color2)
                if (k < 0.5) ring(g, x, y, Math.max(0, r - 2), f.color)
                break
            }
            case FxKind.FloorWave: {
                const r = Math.round(f.size * (1 - (1 - k) * (1 - k)))
                const c = k < 0.4 ? f.color : f.color2
                const hgt = Math.max(1, Math.round((1 - k) * 6))
                for (let s = -1; s <= 1; s += 2) {
                    const wx = x + s * r
                    rect(g, wx - 1, y - hgt, 3, hgt, c)
                    px(g, wx, y - hgt - 1, C.white)
                    rect(g, Math.min(x, wx), y, Math.abs(wx - x), 1, k < 0.5 ? f.color2 : C.stone3)
                }
                break
            }
            case FxKind.Impact: {
                const fr = Math.floor(k * 4)
                if (fr === 0) {
                    disc(g, x, y, Math.round(f.size * 0.5), C.white)
                } else {
                    const len = Math.round(f.size * (0.6 + fr * 0.25))
                    const inner = fr * 2
                    const c = fr === 1 ? C.white : fr === 2 ? f.color2 : C.steel2
                    line(g, x - len, y, x - inner, y, c); line(g, x + inner, y, x + len, y, c)
                    line(g, x, y - len, x, y - inner, c); line(g, x, y + inner, x, y + len, c)
                    const d = Math.round(len * 0.6)
                    const di = Math.round(inner * 0.7)
                    line(g, x - d, y - d, x - di, y - di, c); line(g, x + di, y + di, x + d, y + d, c)
                    line(g, x + d, y - d, x + di, y - di, c); line(g, x - di, y + di, x - d, y + d, c)
                }
                break
            }
            case FxKind.Slash: {
                const len = 10 - Math.round(k * 4)
                const dir = f.size < 1.5 ? 1 : -1
                line(g, x - len, y - len * dir, x + len, y + len * dir, k < 0.5 ? C.white : f.color2, k < 0.4 ? 2 : 1)
                break
            }
            case FxKind.Beam:
            case FxKind.Pillar: {
                // column of light: grows fast, holds, then thins out
                const grow = Math.min(1, k * 6)
                const w = Math.round(f.size * grow * (k > 0.6 ? (1 - k) / 0.4 : 1))
                if (w <= 0) break
                const top = f.kind === FxKind.Beam ? 0 : y - 70
                rect(g, x - w, top, w * 2 + 1, y - top, f.color)
                rect(g, x - (w >> 1), top, w + 1, y - top, C.white)
                dither(g, x - w - 3, top, 3, y - top, f.color, 2)
                dither(g, x + w + 1, top, 3, y - top, f.color, 2)
                disc(g, x, y, w + 3, f.color)
                ellipseRing(g, x, y, w + 8 + Math.round(k * 16), 3, C.white)
                break
            }
        }
    }

    private drawCoins(g: CanvasRenderingContext2D): void {
        for (const c of this.coins) {
            if (!c.live || c.t < 0) continue
            const x = Math.round(c.x)
            const y = Math.round(c.y)
            // 4-frame spin
            const f = Math.floor(c.t * 14 + c.value) & 3
            const w = f === 0 ? 2 : f === 2 ? 0 : 1
            rect(g, x - w - 1, y - 2, w * 2 + 3, 5, C.gold0)
            rect(g, x - w, y - 2, w * 2 + 1, 4, C.gold2)
            px(g, x - w, y - 2, C.gold3)
            if (w === 2) px(g, x, y - 1, C.gold1)
        }
    }

    private drawNums(g: CanvasRenderingContext2D): void {
        for (const n of this.nums) {
            if (!n.live) continue
            const life = n.kind === NumKind.Gold ? 1.1 : 0.85
            if (n.t > life - 0.2 && (this.frame & 4)) continue
            const x = Math.round(n.x)
            const y = Math.round(n.y)
            switch (n.kind) {
                case NumKind.Hit: drawNumber(g, n.value, x, y, C.white, 1, 1, 2); break
                case NumKind.Tap: drawNumber(g, n.value, x, y, C.steel2, 1, 1, 1); break
                case NumKind.Crit: {
                    const pop = n.t < 0.08 ? 3 : 2
                    drawNumber(g, n.value, x, y - (pop - 2) * 3, n.t < 0.06 ? C.white : C.gold2, pop, 1, 2)
                    break
                }
                case NumKind.Special: {
                    const pop = n.t < 0.1 ? 3 : 2
                    const col = (this.frame >> 2) & 1 ? C.orange : C.gold3
                    drawNumber(g, n.value, x, y - (pop - 2) * 3, n.t < 0.06 ? C.white : col, pop, 1, 2, 0, C.red0)
                    break
                }
                case NumKind.Gold: drawNumber(g, n.value, x, y, C.gold3, 1, 1, 2, 43, C.gold0); break
            }
        }
    }

    private drawHud(g: CanvasRenderingContext2D): void {
        const s = this.save
        // purse
        rect(g, 3, 4, 7, 7, C.gold0)
        rect(g, 4, 4, 5, 6, C.gold2)
        rect(g, 5, 5, 2, 1, C.gold3)
        px(g, 4, 4, C.gold3)
        drawNumber(g, s.gold, 13, 5, C.gold3, 1, 0, 1)

        // stage + kill pips
        const boss = isBossStage(s.stage)
        const cx = LW >> 1
        drawText(g, 'STAGE', cx - 4, 4, C.haze, 1, 2)
        drawNumber(g, s.stage, cx, 4, C.white, 1, 0)
        if (boss) {
            const pulse = (this.frame >> 3) & 1
            drawText(g, 'BOSS', cx, 12, pulse ? C.red3 : C.red2, 1, 1)
            const w = 60
            const fill = Math.round(w * Math.max(0, this.bossTimer) / BOSS_TIME)
            rect(g, cx - w / 2 - 1, 19, w + 2, 4, C.ink)
            rect(g, cx - w / 2, 20, fill, 2, this.bossTimer < 8 && pulse ? C.white : C.red2)
            rect(g, cx - w / 2, 20, fill, 1, C.red3)
        } else {
            for (let i = 0; i < KILLS_PER_STAGE; i++) {
                const x = cx - KILLS_PER_STAGE * 3 + i * 6
                rect(g, x, 12, 4, 4, C.ink)
                rect(g, x + 1, 13, 2, 2, i < s.kills ? C.gold2 : C.night2)
            }
            if (s.farming) drawText(g, 'FARMING', cx, 19, C.steel2, 1, 1)
        }

        // zone name
        drawText(g, ZONES[this.zoneIndex()]!.name.toUpperCase(), LW - 4, 5, C.haze, 1, 2)

        // monster hp bar
        if (this.mAlive) {
            const info = this.mInfo
            const w = info.boss ? 50 : 26
            const x = Math.round(this.mX - w / 2)
            const y = Math.max(30, Math.min(GROUND - info.h, GROUND - info.hitY - (info.h >> 1)) - 10)
            rect(g, x - 1, y - 1, w + 2, 5, C.ink)
            rect(g, x, y, w, 3, C.red0)
            rect(g, x, y, Math.round(w * this.mTrail / this.mMaxHp), 3, C.gold3)
            const hw = Math.max(0, Math.round(w * this.mHp / this.mMaxHp))
            rect(g, x, y, hw, 3, C.red2)
            rect(g, x, y, hw, 1, C.red3)
            drawNumber(g, Math.max(0, Math.ceil(this.mHp)), this.mX, y - 7, C.steel3, 1, 1, 1)
            if (info.boss) drawText(g, info.name.toUpperCase(), this.mX, y - 14, C.red3, 1, 1)
        }

        // special charge pips under the hero
        const ev = this.cls.specialEvery
        const ready = this.charge >= ev
        const acc = ACCENT[s.classId]
        for (let i = 0; i < ev; i++) {
            const x = HERO_X - ev * 2 + i * 4
            rect(g, x, GROUND + 5, 3, 3, C.ink)
            const on = i < this.charge
            px(g, x + 1, GROUND + 6, on ? (ready && (this.frame & 8) ? C.white : acc) : C.stone2)
        }
        if (ready) drawText(g, this.cls.special.toUpperCase(), HERO_X, GROUND + 11, (this.frame & 8) ? C.white : acc, 1, 1)

        // centre banner
        if (this.banner > 0) {
            const k = this.banner
            const w = textWidth(this.bannerText, 2) + 16
            const slide = k > 1.6 ? Math.round((k - 1.6) * 200) : 0
            const y = 36
            rect(g, (LW - w) / 2 + slide, y - 3, w, 16, C.ink)
            rect(g, (LW - w) / 2 + slide, y - 3, w, 1, this.bannerColor)
            rect(g, (LW - w) / 2 + slide, y + 12, w, 1, this.bannerColor)
            drawText(g, this.bannerText, (LW >> 1) + slide, y, (this.frame & 4) && k > 1.5 ? C.white : this.bannerColor, 2, 1, 0)
        }
    }
}

function ellipseRing(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c: string): void {
    const steps = Math.max(12, rx * 2)
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        px(g, Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), c)
    }
}
