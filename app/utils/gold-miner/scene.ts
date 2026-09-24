/**
 * Gold Miner stage: the winch, the miner, the swinging claw and everything
 * buried under the surface. The scene owns the level clock and the physics and
 * records every pull as a `GmGrab`; the server replays those against the same
 * rules (`#shared/utils/gamelogic/gold-miner`) before anything is paid.
 */
import { Application, Container, Graphics, Sprite, Text, type Texture, type TextStyleOptions } from 'pixi.js'
import {
    GM_CLAW_R,
    GM_EMPTY_REEL,
    GM_GROUND_Y,
    GM_H,
    GM_ITEMS,
    GM_LEVEL_MS,
    GM_MAX_DYNAMITE,
    GM_PIVOT,
    GM_ROPE_MIN,
    GM_SHOOT_SPEED,
    GM_SWING_MAX,
    GM_SWING_PERIOD_MS,
    GM_W,
    gmGenerateLevel,
    gmItemValue,
    gmMoleX,
    gmReelSpeed,
    gmTntBlast,
    type GmBagOutcome,
    type GmGrab,
    type GmItem,
    type GmKind,
    type GmLevel,
    type GmPerks
} from '#shared/utils/gamelogic/gold-miner'
import { Particles, Tweens, ease, clamp, lerp } from '~/utils/polymasters/fx'
import { BLEED_TOP, BLEED_X, FONT, THEMES, WINCH, buildArt, paintGround, paintSky, type Art } from './art'
import { gmSfx } from './audio'
import { LINES, Miner } from './miner'

export interface SceneHooks {
    /** Cash earned this level changed (already includes the new amount). */
    onEarned(earned: number, delta: number): void
    onDynamite(count: number): void
    onStrength(on: boolean): void
    /** Whole seconds left on the level clock. */
    onClock(secondsLeft: number): void
    onTimeUp(): void
    onBoardEmpty(): void
    /** Ask the server what's in a bag. Resolves null if it can't say. */
    revealBag(itemId: number): Promise<GmBagOutcome | null>
}

type ClawState = 'swing' | 'shoot' | 'reel'
type Mode = 'attract' | 'intro' | 'play' | 'ended'

interface ItemView {
    item: GmItem
    view: Container
    sprite: Sprite
    glow: Sprite | null
    rays: Sprite | null
    frames: Texture[] | null
    x: number
    y: number
    phase: number
}

interface Load {
    kind: GmKind | 'scrap'
    item: GmItem | null
    view: Container
    bag: Promise<GmBagOutcome | null> | null
}

const MINER_X = 716
const DRUM = { x: GM_PIVOT.x, y: GM_GROUND_Y + 2 - WINCH.h + WINCH.drumY }
const CRANK_R = 17
const CART = { x: 420, y: GM_GROUND_Y + 6 }
/** Where "+$" pop-ups fly: the money readout in the top-left of the HUD. */
const MONEY_TARGET = { x: 150, y: 46 }
const TEXT_RES = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * 1.5))

const POP: TextStyleOptions = {
    fontFamily: FONT,
    fontSize: 34,
    fill: '#ffe45c',
    stroke: { color: '#3a1a00', width: 6, join: 'round' },
    dropShadow: { color: '#000000', alpha: 0.45, blur: 4, distance: 3, angle: Math.PI / 2 },
    align: 'center'
}

const isGold = (k: GmKind) => k === 'goldS' || k === 'goldM' || k === 'goldL' || k === 'goldXL'
const isDiamond = (k: GmKind) => k === 'diamond' || k === 'moleDiamond'

export class GoldMinerScene {
    readonly app = new Application()
    private initialised = false
    private destroyed = false
    private art!: Art
    private hooks!: SceneHooks

    // layers
    private world = new Container()
    private skyLayer = new Container()
    private sky: Sprite | null = null
    private sunRays!: Sprite
    private cloudLayer = new Container()
    private birds = new Graphics()
    private ground: Sprite | null = null
    private propsBack = new Container()
    private itemLayer = new Container()
    private dust = new Particles()
    private rope = new Graphics()
    private clawRoot = new Container()
    private clawLoad = new Container()
    private jawL!: Sprite
    private jawR!: Sprite
    private surface = new Container()
    private drum!: Sprite
    private crank = new Graphics()
    private cart!: Sprite
    private miner!: Miner
    private dynamitePack = new Container()
    private fx = new Particles()
    private fxAdd = new Particles()
    private popLayer = new Container()
    private bubbleLayer = new Container()
    private flash = new Graphics()
    private vignette!: Sprite
    private danger!: Sprite
    private tweens = new Tweens()
    private clouds: { s: Sprite, v: number }[] = []
    private birdList: { x: number, y: number, v: number, ph: number }[] = []
    private lanternGlows: Sprite[] = []
    private cacti: Sprite[] = []

    // level
    private level: GmLevel | null = null
    private items: ItemView[] = []
    private gone = new Set<number>()
    private perks: GmPerks = { strength: false, clover: false, book: false, polish: false }
    private strong = false
    private dynamite = 0
    private earned = 0
    private grabs: GmGrab[] = []
    private theme = -1

    // claw
    private mode: Mode = 'attract'
    private claw: ClawState = 'swing'
    private swingPhase = 0
    private angle = 0
    private len = GM_ROPE_MIN
    private load: Load | null = null
    private jawOpen = 1
    private drumAngle = 0
    private clickAcc = 0
    private throwing = 0
    private hitStop = 0

    // clock
    private startAt = 0
    private lastSecond = -1
    private endFired = false
    private emptyFired = false
    private elapsedFallback = 0

    // feel
    private shake = 0
    private punch = 0
    private cartBounce = 0
    private time = 0
    private glintT = 0
    private chatterT = 6
    private attractTarget: ItemView | null = null
    private attractWait = 1.2

    // view
    private viewW = GM_W
    private viewH = GM_H

    async init(host: HTMLElement, hooks: SceneHooks): Promise<boolean> {
        this.hooks = hooks
        await this.app.init({
            resizeTo: host,
            antialias: true,
            background: '#1a0f08',
            // Never below native resolution on a standard screen; cap the cost on dense ones.
            resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
            autoDensity: true,
            preference: 'webgl'
        })
        this.initialised = true
        if (this.destroyed) {
            this.app.destroy(true, { children: true, texture: true })
            return false
        }
        host.appendChild(this.app.canvas)
        this.art = await buildArt()
        if (this.destroyed) return false
        this.build()
        this.layout(this.app.screen.width, this.app.screen.height)
        this.app.renderer.on('resize', (w: number, h: number) => this.layout(w, h))
        this.app.ticker.add(t => this.update(Math.min(t.deltaMS / 1000, 1 / 20)))
        return true
    }

    destroy() {
        if (this.destroyed) return
        this.destroyed = true
        if (this.initialised) this.app.destroy(true, { children: true, texture: true })
    }

    // ─── build ──────────────────────────────────────────────────────────────

    private build() {
        const a = this.art
        this.app.stage.addChild(this.world)

        this.sunRays = new Sprite(a.rays)
        this.sunRays.anchor.set(0.5)
        this.sunRays.blendMode = 'add'
        this.sunRays.position.set(250, 40)
        this.sunRays.scale.set(3.2)
        this.sunRays.alpha = 0.3
        this.world.addChild(this.skyLayer, this.sunRays, this.cloudLayer, this.birds)

        for (let i = 0; i < 7; i++) {
            const s = new Sprite(a.puff)
            s.anchor.set(0.5)
            s.alpha = 0.55
            s.scale.set(1.2 + Math.random() * 1.4, 0.55 + Math.random() * 0.3)
            s.position.set(Math.random() * (GM_W + 400) - 200, 20 + Math.random() * 90)
            this.cloudLayer.addChild(s)
            this.clouds.push({ s, v: 6 + Math.random() * 10 })
        }
        for (let i = 0; i < 4; i++) this.birdList.push({ x: Math.random() * GM_W, y: 30 + Math.random() * 60, v: 30 + Math.random() * 25, ph: Math.random() * 6 })

        // Surface set dressing.
        for (const x of [150, 1130]) {
            const c = new Sprite(a.cactus)
            c.anchor.set(0.5, 1)
            c.position.set(x, GM_GROUND_Y + 4)
            c.scale.set(x < 640 ? 0.9 : -0.8, x < 640 ? 0.9 : 0.8)
            this.propsBack.addChild(c)
            this.cacti.push(c)
        }
        const shaft = new Sprite(a.shaft)
        shaft.anchor.set(0.5, 1)
        shaft.position.set(965, GM_GROUND_Y + 8)
        shaft.scale.set(0.95)
        this.propsBack.addChild(shaft)
        this.cart = new Sprite(a.cart)
        this.cart.anchor.set(0.5, 1)
        this.cart.position.set(CART.x, CART.y)
        this.cart.scale.set(0.9)
        this.propsBack.addChild(this.cart)
        for (const x of [520, 842]) {
            const post = new Sprite(a.lantern)
            post.anchor.set(0.5, 1)
            post.position.set(x, GM_GROUND_Y + 4)
            post.scale.set(0.85)
            this.propsBack.addChild(post)
            const glow = new Sprite(a.glow)
            glow.anchor.set(0.5)
            glow.blendMode = 'add'
            glow.tint = 0xffc26a
            glow.position.set(x - 7, GM_GROUND_Y + 4 - 120 * 0.85 + 40 * 0.85)
            glow.scale.set(0.9)
            glow.alpha = 0.7
            this.propsBack.addChild(glow)
            this.lanternGlows.push(glow)
        }

        this.dust.view.blendMode = 'add'
        this.world.addChild(this.propsBack, this.itemLayer, this.dust.view)

        // Winch.
        const frame = new Sprite(a.winchFrame)
        frame.anchor.set(0.5, 1)
        frame.position.set(GM_PIVOT.x, GM_GROUND_Y + 2)
        this.drum = new Sprite(a.drum)
        this.drum.anchor.set(0.5)
        this.drum.position.set(DRUM.x, DRUM.y)
        this.surface.addChild(frame, this.drum, this.crank)

        this.dynamitePack.position.set(560, GM_GROUND_Y + 2)
        this.surface.addChild(this.dynamitePack)

        this.miner = new Miner(a, MINER_X, GM_GROUND_Y + 2, this.bubbleLayer)
        this.surface.addChild(this.miner.root)

        // Claw.
        const hub = new Sprite(a.clawHub)
        hub.anchor.set(0.5, 0.35)
        this.jawL = new Sprite(a.clawJaw)
        this.jawL.anchor.set(0.3, 0.12)
        this.jawL.position.set(-5, 4)
        this.jawR = new Sprite(a.clawJaw)
        this.jawR.anchor.set(0.3, 0.12)
        this.jawR.scale.x = -1
        this.jawR.position.set(5, 4)
        this.clawRoot.addChild(this.clawLoad, this.jawL, this.jawR, hub)

        this.fxAdd.view.blendMode = 'add'
        this.flash.rect(-BLEED_X, -BLEED_TOP, GM_W + BLEED_X * 2, GM_H + BLEED_TOP * 2).fill({ color: 0xffffff })
        this.flash.alpha = 0
        this.world.addChild(this.surface, this.rope, this.clawRoot, this.fx.view, this.fxAdd.view, this.popLayer, this.bubbleLayer, this.flash)

        // Screen-space grading: a soft vignette, and a red pulse when the clock runs low.
        this.vignette = new Sprite(a.vignette)
        this.danger = new Sprite(a.edgeGlow)
        this.danger.tint = 0xff2010
        this.danger.blendMode = 'add'
        this.danger.alpha = 0
        this.app.stage.addChild(this.vignette, this.danger)
        this.renderDynamite()
    }

    private layout(w: number, h: number) {
        this.viewW = w
        this.viewH = h
        const s = Math.min(w / GM_W, h / GM_H) * (1 + this.punch)
        this.world.scale.set(s)
        // Punch-zoom around the winch so the action stays put.
        const fx = GM_PIVOT.x
        const fy = GM_H * 0.45
        const base = Math.min(w / GM_W, h / GM_H)
        const ox = (w - GM_W * base) / 2
        const oy = (h - GM_H * base) / 2
        this.world.position.set(ox + fx * base - fx * s, oy + fy * base - fy * s)
        for (const v of [this.vignette, this.danger]) {
            if (!v) continue
            v.width = w
            v.height = h
        }
    }

    private setTheme(index: number) {
        if (index === this.theme) return
        this.theme = index
        const t = THEMES[index % THEMES.length]!
        const sky = new Sprite(paintSky(t, 11 + index))
        sky.position.set(-BLEED_X, -BLEED_TOP)
        const ground = new Sprite(paintGround(t, 3 + index))
        ground.position.set(-BLEED_X, GM_GROUND_Y - 6)
        const oldSky = this.sky
        const oldGround = this.ground
        this.sky = sky
        this.ground = ground
        this.skyLayer.addChild(sky)
        this.world.addChildAt(ground, this.world.getChildIndex(this.propsBack))
        const desert = t.name === 'Sunbaked Mesa' || t.name === 'Red Canyon'
        for (const c of this.cacti) c.visible = desert
        this.sunRays.visible = t.name !== 'Crystal Deep'
        this.sunRays.tint = t.name === 'Red Canyon' ? 0xffc890 : 0xfff4d0
        if (!oldSky) return
        sky.alpha = ground.alpha = 0
        this.tweens.add(0.9, (k) => {
            if (!sky.destroyed) sky.alpha = k
            if (!ground.destroyed) ground.alpha = k
        }, {
            done: () => {
                for (const old of [oldSky, oldGround]) if (old && !old.destroyed) old.destroy({ texture: true })
            }
        })
    }

    // ─── level control ──────────────────────────────────────────────────────

    /** Deals a level onto the board. Items pop in with a staggered bounce. */
    loadLevel(level: GmLevel, opts: { perks: GmPerks, dynamite: number }) {
        this.level = level
        this.perks = { ...opts.perks }
        this.strong = opts.perks.strength
        this.dynamite = opts.dynamite
        this.earned = 0
        this.grabs = []
        this.gone.clear()
        this.dropLoad()
        this.claw = 'swing'
        this.len = GM_ROPE_MIN
        this.endFired = false
        this.emptyFired = false
        this.lastSecond = -1
        this.setTheme(level.theme % THEMES.length)
        for (const v of this.items) v.view.destroy({ children: true })
        this.items = []
        const sorted = [...level.items].sort((a, b) => a.y - b.y)
        sorted.forEach((item, i) => {
            const view = this.makeItem(item)
            this.itemLayer.addChild(view.view)
            this.items.push(view)
            view.view.scale.set(0)
            this.tweens.add(0.55, k => view.view.scale.set(k), { ease: ease.outBack, delay: 0.1 + i * 0.025 })
        })
        this.renderDynamite()
    }

    private makeItem(item: GmItem): ItemView {
        const a = this.art
        const tex = a.items[item.kind]
        const frames = item.kind === 'mole' ? a.moleFrames : item.kind === 'moleDiamond' ? a.moleDiamondFrames : null
        const sprite = new Sprite(frames ? frames[0]! : tex[item.variant % tex.length]!)
        sprite.anchor.set(0.5)
        const view = new Container()
        const r = GM_ITEMS[item.kind].r
        let glow: Sprite | null = null
        let rays: Sprite | null = null
        // Precious things light the dirt around them.
        if (isGold(item.kind) || isDiamond(item.kind)) {
            glow = new Sprite(a.glow)
            glow.anchor.set(0.5)
            glow.blendMode = 'add'
            glow.tint = isDiamond(item.kind) ? 0x8fdcff : 0xffb43a
            glow.alpha = isDiamond(item.kind) ? 0.5 : 0.28
            glow.scale.set((r * 3.4) / 128)
            if (item.kind === 'moleDiamond') glow.position.set(12, 6)
            view.addChild(glow)
        }
        if (item.kind === 'diamond') {
            rays = new Sprite(a.rays)
            rays.anchor.set(0.5)
            rays.blendMode = 'add'
            rays.tint = 0xcff4ff
            rays.alpha = 0.35
            rays.scale.set(0.42)
            view.addChild(rays)
        }
        view.addChild(sprite)
        if (!frames && item.kind !== 'tnt' && item.kind !== 'bag' && item.kind !== 'diamond') sprite.rotation = item.rot * 0.6
        view.position.set(item.x, item.y)
        return { item, view, sprite, glow, rays, frames, x: item.x, y: item.y, phase: (item.id * 1.7) % 6.28 }
    }

    /** Starts the level clock `elapsedMs` in (negative while an intro is still running). */
    startPlay(elapsedMs: number) {
        this.mode = 'play'
        this.startAt = performance.now() - elapsedMs
        this.elapsedFallback = elapsedMs
        const vein = this.level?.vein
        this.miner.say(vein === 'rich' ? LINES.rich : vein === 'thin' ? LINES.thin : LINES.start, { force: true })
        if (vein === 'rich') this.miner.setMood('happy', 1.4)
    }

    /** Attract mode: the miner plays by himself behind the lobby. */
    setAttract() {
        this.mode = 'attract'
        this.loadLevel(gmGenerateLevel(Math.floor(Math.random() * 1e9), 1 + Math.floor(Math.random() * 6)), {
            perks: { strength: true, clover: false, book: false, polish: false },
            dynamite: 0
        })
        this.chatterT = 2.5
    }

    /** Stops the clock and hands back the report. */
    endPlay(): GmGrab[] {
        if (this.mode === 'play') this.mode = 'ended'
        if (this.load) {
            // Whatever was on the claw when the whistle blew is lost.
            const v = this.load.view
            this.load = null
            this.tweens.add(0.4, (k) => {
                v.alpha = 1 - k
                v.scale.set(1 + k * 0.3)
            }, { done: () => v.destroy({ children: true }) })
        }
        if (this.claw === 'shoot') this.claw = 'reel'
        return [...this.grabs]
    }

    /** Lets the store put words in the miner's mouth. */
    say(kind: keyof typeof LINES) {
        this.miner.say(LINES[kind], { force: true })
        if (kind === 'goal') {
            this.miner.setMood('happy', 1.2)
            this.miner.cheer()
        }
    }

    get levelEarned() {
        return this.earned
    }

    get elapsedMs() {
        return this.mode === 'play' || this.mode === 'ended' ? performance.now() - this.startAt : this.elapsedFallback
    }

    // ─── input ──────────────────────────────────────────────────────────────

    fire() {
        if (this.mode !== 'play' || this.claw !== 'swing' || this.elapsedMs < 0) return
        this.shoot()
    }

    private shoot() {
        this.claw = 'shoot'
        this.jawOpen = 1
        gmSfx.launch()
    }

    useDynamite() {
        if (this.mode !== 'play' || this.claw !== 'reel' || !this.load?.item || this.throwing > 0) return
        if (this.load.kind === 'scrap' || this.dynamite <= 0) return
        this.dynamite--
        this.hooks.onDynamite(this.dynamite)
        this.renderDynamite()
        this.throwing = 0.3
        gmSfx.fuse()
        this.miner.say(LINES.blast, { force: true })
        const stick = new Sprite(this.art.dynamite)
        stick.anchor.set(0.5)
        stick.scale.set(0.8)
        const from = this.miner.handAnchor
        this.world.addChild(stick)
        const load = this.load
        this.tweens.add(0.28, (k) => {
            const to = this.clawTip()
            stick.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 60)
            stick.rotation = k * 12
            this.fxAdd.emit(this.art.spark, { x: stick.x, y: stick.y - 10, life: 0.25, scale: 0.18, scaleEnd: 0, tint: 0xffc040 })
        }, {
            ease: ease.linear,
            done: () => {
                stick.destroy()
                if (this.load !== load || !load.item) return
                const at = Math.round(this.elapsedMs)
                if (this.mode !== 'play' || at > GM_LEVEL_MS) return
                this.grabs.push({ id: load.item.id, at, blown: true })
                const tip = this.clawTip()
                this.explode(tip.x, tip.y + GM_ITEMS[load.item.kind].r, 0.7)
                load.view.destroy({ children: true })
                this.load = null
                this.jawOpen = 1
                this.miner.setMood('happy', 0.6)
            }
        })
    }

    // ─── update ─────────────────────────────────────────────────────────────

    private update(dt: number) {
        this.time += dt
        this.tweens.update(dt)
        this.fx.update(dt)
        this.fxAdd.update(dt)
        this.dust.update(dt)
        this.updateClock()
        // Hit-stop: a heavy bite freezes the claw and the dirt for a beat.
        if (this.hitStop > 0) this.hitStop -= dt
        else {
            this.updateClaw(dt)
            this.updateItems(dt)
        }
        this.updateSurface(dt)
        this.updateAmbience(dt)
        this.drawRope()

        // Camera: punch-zoom and shake, both decaying.
        this.punch *= Math.exp(-dt * 6)
        if (this.shake > 0.01) this.shake *= Math.exp(-dt * 7)
        else this.shake = 0
        this.layout(this.viewW, this.viewH)
        if (this.shake) {
            const s = this.world.scale.x
            this.world.x += (Math.random() - 0.5) * this.shake * s
            this.world.y += (Math.random() - 0.5) * this.shake * s
        }
        if (this.flash.alpha > 0) this.flash.alpha = Math.max(0, this.flash.alpha - dt * 3)
    }

    private updateClock() {
        if (this.mode !== 'play') {
            this.danger.alpha = Math.max(0, this.danger.alpha - 0.05)
            return
        }
        const elapsed = this.elapsedMs
        const left = Math.max(0, Math.ceil((GM_LEVEL_MS - Math.max(0, elapsed)) / 1000))
        if (left !== this.lastSecond) {
            this.lastSecond = left
            this.hooks.onClock(left)
            if (elapsed >= 0 && left <= 10 && left > 0) gmSfx.tick(left <= 5)
            if (elapsed >= 0 && left === 10) this.miner.say(LINES.hurry)
        }
        const msLeft = GM_LEVEL_MS - elapsed
        this.danger.alpha = msLeft < 10_000 && elapsed >= 0 ? 0.3 + Math.sin(this.time * 7) * 0.2 : 0
        if (elapsed >= GM_LEVEL_MS && !this.endFired) {
            this.endFired = true
            gmSfx.timeUp()
            this.hooks.onTimeUp()
        }
    }

    private tipAt(len: number) {
        return { x: GM_PIVOT.x + Math.sin(this.angle) * len, y: GM_PIVOT.y + Math.cos(this.angle) * len }
    }

    private clawTip() {
        return this.tipAt(this.len)
    }

    private updateClaw(dt: number) {
        const prevLen = this.len
        if (this.claw === 'swing') {
            this.swingPhase += (dt * 1000 / GM_SWING_PERIOD_MS) * Math.PI * 2
            this.angle = Math.sin(this.swingPhase) * GM_SWING_MAX
            this.len = GM_ROPE_MIN
            this.jawOpen += (1 - this.jawOpen) * Math.min(1, dt * 10)
            if (this.mode === 'attract') this.attractAi(dt)
            if (this.mode === 'play' && !this.emptyFired && this.items.length === 0) {
                this.emptyFired = true
                this.hooks.onBoardEmpty()
            }
        } else if (this.claw === 'shoot') {
            // Sub-step so a fast claw on a slow frame can't tunnel through a diamond.
            const steps = Math.max(1, Math.ceil((GM_SHOOT_SPEED * dt) / 8))
            for (let i = 0; i < steps && this.claw === 'shoot'; i++) {
                this.len += (GM_SHOOT_SPEED * dt) / steps
                const tip = this.clawTip()
                const hit = this.hitTest(tip.x, tip.y)
                if (hit) this.hook(hit)
                else if (tip.x < -20 || tip.x > GM_W + 20 || tip.y > GM_H + 10) {
                    this.claw = 'reel'
                    gmSfx.miss()
                }
            }
            // Speed trail behind the flying claw.
            const tip = this.clawTip()
            this.fxAdd.emit(this.art.glow, { x: tip.x, y: tip.y, life: 0.22, scale: 0.16, scaleEnd: 0.05, alpha: 0.35, alphaEnd: 0, tint: 0xe8f0ff })
        } else {
            const kind = this.load ? (this.load.kind === 'scrap' ? 'tnt' : this.load.kind) : null
            const speed = this.mode === 'ended' && !this.load ? GM_EMPTY_REEL * 1.5 : gmReelSpeed(kind, this.strong)
            this.len -= speed * dt
            this.clickAcc += speed * dt
            if (this.clickAcc > 26) {
                this.clickAcc = 0
                gmSfx.click(kind ? 1 - speed / GM_EMPTY_REEL : 0)
            }
            // Heavy loads plough a little dust as they come up.
            if (kind && speed < 200 && Math.random() < dt * 20) {
                const tip = this.clawTip()
                this.fx.emit(this.art.puff, { x: tip.x + (Math.random() - 0.5) * 40, y: tip.y + 30, vy: -20, life: 0.8, scale: 0.12, scaleEnd: 0.35, alpha: 0.35, tint: 0xa88060, drag: 2 })
            }
            if (this.len <= GM_ROPE_MIN) {
                this.len = GM_ROPE_MIN
                this.claw = 'swing'
                if (this.load) this.collect()
            }
        }
        this.drumAngle += (this.len - prevLen) / WINCH.drumR
        this.clawRoot.position.copyFrom(this.clawTip())
        this.clawRoot.rotation = -this.angle
        const open = this.load ? clamp(0.1 + (this.load.item ? GM_ITEMS[this.load.item.kind].r / 90 : 0), 0, 0.8) : this.jawOpen
        this.jawL.rotation = 0.15 + open * 0.35
        this.jawR.rotation = -(0.15 + open * 0.35)
    }

    private attractAi(dt: number) {
        this.attractWait -= dt
        if (this.attractWait > 0) return
        if (!this.attractTarget || !this.items.includes(this.attractTarget)) {
            const valuable = this.items.filter(v => isGold(v.item.kind) || v.item.kind === 'diamond' || v.item.kind === 'bag')
            if (!valuable.length) {
                this.setAttract()
                this.attractWait = 1.5
                return
            }
            this.attractTarget = valuable[Math.floor(Math.random() * valuable.length)]!
        }
        const t = this.attractTarget
        const want = Math.atan2(t.x - GM_PIVOT.x, t.y - GM_PIVOT.y)
        if (Math.abs(want - this.angle) < 0.03) {
            this.shoot()
            this.attractTarget = null
            this.attractWait = 0.6 + Math.random() * 1.2
        }
    }

    private hitTest(x: number, y: number): ItemView | null {
        for (const v of this.items) {
            const r = GM_ITEMS[v.item.kind].r + GM_CLAW_R
            const dx = v.x - x
            const dy = v.y - y
            if (dx * dx + dy * dy <= r * r) return v
        }
        return null
    }

    private hook(v: ItemView) {
        this.claw = 'reel'
        this.items.splice(this.items.indexOf(v), 1)
        const kind = v.item.kind
        const tip = this.clawTip()
        this.dustBurst(tip.x, tip.y, kind)
        const heavy = GM_ITEMS[kind].pull < 200
        this.shake = Math.max(this.shake, heavy ? 7 : 2)
        if (heavy) {
            this.hitStop = 0.08
            this.punch = Math.max(this.punch, 0.012)
        }

        if (kind === 'tnt') {
            this.gone.add(v.item.id)
            this.detonate(v)
            return
        }
        gmSfx.hook(kind)
        v.glow?.destroy()
        v.rays?.destroy()
        v.view.position.set(0, GM_ITEMS[kind].r * 0.8 + 10)
        v.view.scale.set(1)
        this.clawLoad.addChild(v.view)
        this.gone.add(v.item.id)
        this.load = {
            kind,
            item: v.item,
            view: v.view,
            bag: kind === 'bag' && this.mode === 'play' ? this.hooks.revealBag(v.item.id).catch(() => null) : null
        }
        if (heavy) {
            this.miner.setMood('strain', 99)
            if (this.mode !== 'attract') this.miner.say(LINES.heavy)
        } else if (kind === 'rockS' || kind === 'rockL') {
            this.miner.setMood('sad', 1.2)
        }
    }

    private detonate(v: ItemView) {
        const level = this.level!
        this.explode(v.x, v.y, 1.2)
        this.miner.setMood('shock', 1.1)
        this.miner.say(LINES.tnt, { force: true })
        v.view.destroy({ children: true })
        const destroyed = new Set(gmTntBlast(level, v.item.id, this.gone))
        for (const id of destroyed) this.gone.add(id)
        for (const other of [...this.items]) {
            if (!destroyed.has(other.item.id)) continue
            this.items.splice(this.items.indexOf(other), 1)
            const delay = Math.hypot(other.x - v.x, other.y - v.y) / 900
            this.tweens.add(0.01, () => {}, {
                delay,
                done: () => {
                    if (other.item.kind === 'tnt') this.explode(other.x, other.y, 1)
                    else this.crumble(other)
                    other.view.destroy({ children: true })
                }
            })
        }
        const scrap = new Container()
        const s = new Sprite(this.art.chunk)
        s.anchor.set(0.5)
        s.tint = 0x3a2010
        s.scale.set(1.3)
        scrap.addChild(s)
        scrap.position.set(0, 12)
        this.clawLoad.addChild(scrap)
        this.load = { kind: 'scrap', item: v.item, view: scrap, bag: null }
    }

    private collect() {
        const load = this.load!
        this.load = null
        const at = Math.round(this.elapsedMs)
        const item = load.item!
        const inPlay = this.mode === 'play' && at <= GM_LEVEL_MS
        if (inPlay) this.grabs.push({ id: item.id, at })

        const pos = { x: GM_PIVOT.x, y: GM_PIVOT.y + 40 }
        const view = load.view
        this.world.addChild(view)
        view.position.copyFrom(pos)
        const valuable = load.kind !== 'scrap' && (isGold(item.kind) || isDiamond(item.kind))

        if (valuable) {
            // Loot arcs over into the mine cart, which bounces as it lands.
            const from = { ...pos }
            const to = { x: CART.x + (Math.random() - 0.5) * 30, y: CART.y - 62 }
            this.tweens.add(0.55, (k) => {
                view.x = lerp(from.x, to.x, k)
                view.y = lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 110
                view.scale.set(1 - k * 0.55)
                view.rotation = k * 4
            }, {
                ease: ease.inOutCubic,
                done: () => {
                    view.destroy({ children: true })
                    this.cartBounce = 1
                    gmSfx.click(0.1)
                    this.fxAdd.burst(this.art.spark, 8, { x: to.x, y: to.y, life: 0.5, scale: 0.28, scaleEnd: 0, tint: isDiamond(item.kind) ? 0xbff0ff : 0xffe070, ay: 300 }, { speed: [60, 200], angle: [-Math.PI, 0] })
                }
            })
        } else {
            this.tweens.add(0.45, (k) => {
                view.scale.set(1 + k * 0.35)
                view.alpha = 1 - k
                view.y = pos.y - k * 30
            }, { done: () => view.destroy({ children: true }) })
        }

        if (load.kind === 'scrap') {
            this.addEarned(GM_ITEMS.tnt.value, pos, inPlay)
            this.miner.setMood('sad', 0.8)
            return
        }
        if (item.kind === 'bag') {
            void this.openBag(load, pos, inPlay)
            return
        }
        const value = gmItemValue(item.kind, this.perks)
        this.addEarned(value, pos, inPlay)
        gmSfx.collect(value, item.kind)
        if (isDiamond(item.kind)) {
            this.miner.setMood('happy', 1.4)
            this.miner.cheer()
            this.miner.say(LINES.diamond)
            this.punch = Math.max(this.punch, 0.02)
            this.sparkleBurst(pos.x, pos.y, 0x9fe6ff, 28)
        } else if (value >= 250) {
            this.miner.setMood('happy', 1.2)
            this.miner.cheer()
            this.miner.say(LINES.bigGold)
            this.punch = Math.max(this.punch, 0.015)
            this.sparkleBurst(pos.x, pos.y, 0xffd24a, value >= 500 ? 30 : 18)
        } else if (value >= 50) {
            this.miner.setMood('happy', 0.7)
            if (Math.random() < 0.35) this.miner.say(LINES.gold)
            this.sparkleBurst(pos.x, pos.y, 0xffd24a, 10)
        } else if (item.kind === 'rockS' || item.kind === 'rockL') {
            this.miner.setMood('sad', 1)
            this.miner.say(LINES.rock)
        } else {
            this.miner.setMood('idle', 0.5)
            if (Math.random() < 0.5) this.miner.say(LINES.junk)
        }
    }

    private async openBag(load: Load, pos: { x: number, y: number }, inPlay: boolean) {
        const outcome = inPlay && load.bag
            ? await Promise.race([load.bag, new Promise<null>(r => setTimeout(() => r(null), 4000))])
            : this.mode === 'attract' ? { kind: 'cash' as const, amount: 50 + Math.floor(Math.random() * 400) } : null
        if (this.destroyed) return
        if (!outcome) {
            this.popText('?', pos.x, pos.y, '#ffffff')
            return
        }
        this.sparkleBurst(pos.x, pos.y, 0xfff0a0, 18)
        if (outcome.kind === 'cash') {
            this.addEarned(outcome.amount, pos, inPlay)
            gmSfx.bagReveal(outcome.amount >= 200)
            if (outcome.amount >= 200) {
                this.miner.setMood('happy', 1)
                this.miner.cheer()
                this.miner.say(LINES.bagCash)
            }
        } else if (outcome.kind === 'strength') {
            this.strong = true
            this.hooks.onStrength(true)
            gmSfx.powerUp()
            this.popText('STRENGTH!', pos.x, pos.y, '#7dff8a')
            this.miner.setMood('happy', 1.4)
            this.miner.cheer()
            this.miner.say(LINES.strength, { force: true })
        } else {
            this.dynamite = Math.min(GM_MAX_DYNAMITE, this.dynamite + 1)
            this.hooks.onDynamite(this.dynamite)
            this.renderDynamite()
            gmSfx.powerUp()
            this.popText('+1 DYNAMITE', pos.x, pos.y, '#ff8a6a')
            this.miner.setMood('happy', 1)
            this.miner.say(LINES.dynamiteGain, { force: true })
        }
    }

    private addEarned(value: number, pos: { x: number, y: number }, inPlay: boolean) {
        if (inPlay) {
            this.earned += value
            this.hooks.onEarned(this.earned, value)
        }
        this.popMoney(value, pos.x, pos.y)
    }

    private updateItems(dt: number) {
        const ms = this.mode === 'play' || this.mode === 'ended' ? Math.max(0, this.elapsedMs) : this.time * 1000
        for (const v of this.items) {
            if (v.item.mole) {
                const p = gmMoleX(v.item.mole, ms)
                v.x = p.x
                v.view.x = p.x
                v.view.scale.x = Math.abs(v.view.scale.x) * p.dir
                if (v.frames) v.sprite.texture = v.frames[Math.floor(this.time * 7) % 2]!
                v.view.y = v.y + (Math.floor(this.time * 7) % 2 ? -1.5 : 0)
            }
            if (v.glow) v.glow.alpha = (isDiamond(v.item.kind) ? 0.45 : 0.24) + Math.sin(this.time * 2 + v.phase) * 0.08
            if (v.rays) v.rays.rotation += dt * 0.6
            // Bags twitch now and then, as if something's alive in there.
            if (v.item.kind === 'bag') v.sprite.rotation = Math.sin(this.time * 14 + v.phase) * (Math.sin(this.time * 0.9 + v.phase) > 0.93 ? 0.12 : 0)
        }
        this.glintT -= dt
        if (this.glintT <= 0 && this.items.length) {
            this.glintT = 0.1 + Math.random() * 0.2
            const shiny = this.items.filter(v => isGold(v.item.kind) || v.item.kind === 'diamond')
            const v = shiny[Math.floor(Math.random() * shiny.length)]
            if (v) {
                const r = GM_ITEMS[v.item.kind].r
                this.fxAdd.emit(this.art.spark, {
                    x: v.x + (Math.random() - 0.5) * r,
                    y: v.y + (Math.random() - 0.7) * r * 0.8,
                    life: 0.55,
                    scale: 0.05,
                    scaleEnd: 0.32 + r / 200,
                    alpha: 1,
                    alphaEnd: 0,
                    vr: 2,
                    tint: v.item.kind === 'diamond' ? 0xcff4ff : 0xfff2b0
                })
            }
        }
    }

    // ─── surface: winch, miner, cart ────────────────────────────────────────

    private updateSurface(dt: number) {
        const handle = { x: DRUM.x + Math.cos(this.drumAngle) * CRANK_R, y: DRUM.y + Math.sin(this.drumAngle) * CRANK_R }
        this.drum.rotation = this.drumAngle
        this.crank.clear()
        this.crank.moveTo(DRUM.x, DRUM.y).lineTo(handle.x, handle.y).stroke({ width: 6, color: 0x2a1606, cap: 'round' })
        this.crank.moveTo(DRUM.x, DRUM.y).lineTo(handle.x, handle.y).stroke({ width: 3, color: 0x9aa0a8, cap: 'round' })
        this.crank.circle(handle.x, handle.y, 5).fill({ color: 0x7a3a18 }).stroke({ width: 2, color: 0x2a1606 })

        this.throwing = Math.max(0, this.throwing - dt)
        const reeling = this.claw === 'reel'
        const heavyLoad = !!this.load?.item && this.load.kind !== 'scrap' && GM_ITEMS[this.load.item.kind].pull < 200
        this.miner.update(dt, reeling ? handle : null, { x: DRUM.x + 30, y: DRUM.y + 8 }, this.throwing > 0, heavyLoad)

        // Cart squash when loot lands.
        this.cartBounce = Math.max(0, this.cartBounce - dt * 3)
        const b = Math.sin(this.cartBounce * Math.PI * 2) * this.cartBounce * 0.08
        this.cart.scale.set(0.9 * (1 + b), 0.9 * (1 - b))

        // The miner chats to himself behind the lobby.
        if (this.mode === 'attract') {
            this.chatterT -= dt
            if (this.chatterT <= 0) {
                this.chatterT = 7 + Math.random() * 5
                this.miner.say(LINES.attract)
            }
        }
    }

    private renderDynamite() {
        this.dynamitePack.removeChildren().forEach(c => c.destroy())
        for (let i = 0; i < this.dynamite; i++) {
            const s = new Sprite(this.art.dynamite)
            s.anchor.set(0.5, 1)
            s.scale.set(0.75)
            s.position.set(-(i % 5) * 11, -Math.floor(i / 5) * 10)
            s.rotation = (i % 2 ? 0.08 : -0.06)
            this.dynamitePack.addChild(s)
        }
    }

    // ─── rope ───────────────────────────────────────────────────────────────

    private drawRope() {
        const g = this.rope
        g.clear()
        const top = { x: DRUM.x, y: DRUM.y + WINCH.drumR - 2 }
        const tip = this.clawTip()
        g.moveTo(top.x, top.y).lineTo(GM_PIVOT.x, GM_PIVOT.y).lineTo(tip.x, tip.y).stroke({ width: 5, color: 0x2a1a0a, cap: 'round', join: 'round' })
        g.moveTo(top.x, top.y).lineTo(GM_PIVOT.x, GM_PIVOT.y).lineTo(tip.x, tip.y).stroke({ width: 2.6, color: 0xc9a26a, cap: 'round', join: 'round' })
        // Twist marks, so the rope reads as rope while it moves.
        const phase = this.drumAngle * WINCH.drumR
        for (let d = (phase % 9 + 9) % 9; d < this.len; d += 9) {
            const a = this.tipAt(d)
            const nx = Math.cos(this.angle)
            const ny = -Math.sin(this.angle)
            g.moveTo(a.x - nx * 1.6, a.y - ny * 1.6 - 1.5).lineTo(a.x + nx * 1.6, a.y + ny * 1.6 + 1.5)
        }
        g.stroke({ width: 1, color: 0x6a4a22, alpha: 0.8 })
        g.circle(GM_PIVOT.x, GM_PIVOT.y, 5).stroke({ width: 3, color: 0x3a3e46 })
    }

    // ─── ambience ───────────────────────────────────────────────────────────

    private updateAmbience(dt: number) {
        for (const c of this.clouds) {
            c.s.x += c.v * dt
            if (c.s.x > GM_W + 300) c.s.x = -300
        }
        this.sunRays.rotation += dt * 0.03
        this.sunRays.alpha = 0.26 + Math.sin(this.time * 0.7) * 0.05
        // Birds: little flapping Vs crossing the sky.
        const g = this.birds
        g.clear()
        for (const b of this.birdList) {
            b.x += b.v * dt
            if (b.x > GM_W + 40) {
                b.x = -40
                b.y = 30 + Math.random() * 60
            }
            const flap = Math.sin(this.time * 9 + b.ph) * 4
            const y = b.y + Math.sin(this.time * 1.3 + b.ph) * 4
            g.moveTo(b.x - 7, y - flap).quadraticCurveTo(b.x - 3, y - 2, b.x, y).quadraticCurveTo(b.x + 3, y - 2, b.x + 7, y - flap)
        }
        g.stroke({ width: 2, color: 0x2a2030, alpha: 0.7, cap: 'round' })
        for (const [i, lg] of this.lanternGlows.entries()) lg.alpha = 0.6 + Math.sin(this.time * 11 + i * 3) * 0.06 + Math.sin(this.time * 23 + i) * 0.04
        if (Math.random() < dt * 6) {
            this.dust.emit(this.art.glow, {
                x: Math.random() * GM_W,
                y: GM_GROUND_Y + 40 + Math.random() * (GM_H - GM_GROUND_Y - 40),
                vx: (Math.random() - 0.5) * 6,
                vy: -4 - Math.random() * 6,
                life: 4 + Math.random() * 3,
                scale: 0.02 + Math.random() * 0.03,
                alpha: 0.7,
                alphaEnd: 0,
                tint: 0xffe2a8
            })
        }
    }

    // ─── fx ─────────────────────────────────────────────────────────────────

    private dustBurst(x: number, y: number, kind: GmKind) {
        const tint = isGold(kind) ? 0xffd870 : kind === 'diamond' ? 0xbfefff : 0xc8a47a
        this.fx.burst(this.art.puff, 7, { x, y, life: 0.6, scale: 0.18, scaleEnd: 0.45, alpha: 0.6, tint, drag: 3 }, { speed: [40, 130] })
        this.fxAdd.burst(this.art.spark, kind.startsWith('rock') ? 10 : 5, { x, y, life: 0.3, scale: 0.25, scaleEnd: 0, tint: kind.startsWith('rock') ? 0xffc070 : 0xffffff }, { speed: [80, 240] })
        if (kind.startsWith('rock')) this.fx.burst(this.art.chunk, 6, { x, y, life: 0.6, scale: 0.6, scaleEnd: 0.3, ay: 800, tint: 0x8a847a }, { speed: [80, 220], angle: [-Math.PI, 0] })
    }

    private sparkleBurst(x: number, y: number, tint: number, n: number) {
        this.fxAdd.burst(this.art.spark, n, { x, y, life: 0.8, scale: 0.35, scaleEnd: 0, ay: 260, tint, drag: 1.5 }, { speed: [120, 380], angle: [-Math.PI * 0.95, -Math.PI * 0.05] })
        this.fxAdd.emit(this.art.glow, { x, y, life: 0.4, scale: 0.4, scaleEnd: 1.4, alpha: 0.8, alphaEnd: 0, tint })
    }

    private crumble(v: ItemView) {
        const kind = v.item.kind
        const tint = isGold(kind) ? 0xf2b43a : kind === 'diamond' ? 0x8fd9ff : kind.startsWith('rock') ? 0x8a847a : 0xd8ccb0
        this.fx.burst(this.art.chunk, 14, { x: v.x, y: v.y, life: 0.9, scale: 0.9, scaleEnd: 0.4, alpha: 1, alphaEnd: 0, ay: 700, tint, drag: 0.5 }, { speed: [120, 360] })
        this.fx.burst(this.art.puff, 6, { x: v.x, y: v.y, life: 0.9, scale: 0.3, scaleEnd: 0.9, alpha: 0.6, tint: 0x5a4a3a, drag: 2 }, { speed: [30, 90] })
    }

    private explode(x: number, y: number, size: number) {
        gmSfx.explosion(size)
        this.shake = Math.max(this.shake, 18 * size)
        this.punch = Math.max(this.punch, 0.03 * size)
        this.hitStop = Math.max(this.hitStop, 0.06)
        this.flash.alpha = Math.max(this.flash.alpha, 0.35 * size)
        const ring = new Sprite(this.art.ring)
        ring.anchor.set(0.5)
        ring.blendMode = 'add'
        ring.tint = 0xffc46a
        ring.position.set(x, y)
        this.world.addChild(ring)
        this.tweens.add(0.5, (k) => {
            ring.scale.set(0.2 + k * 2.2 * size)
            ring.alpha = 1 - k
        }, { done: () => ring.destroy() })
        this.fxAdd.emit(this.art.glow, { x, y, life: 0.5, scale: 1.2 * size, scaleEnd: 3 * size, alpha: 1, alphaEnd: 0, tint: 0xffe08a })
        this.fxAdd.burst(this.art.spark, 22, { x, y, life: 0.6, scale: 0.45, scaleEnd: 0, tint: 0xffb040, drag: 2 }, { speed: [200, 620] })
        this.fx.burst(this.art.puff, 16, { x, y, life: 1.6, scale: 0.5 * size, scaleEnd: 1.6 * size, alpha: 0.85, alphaEnd: 0, tint: 0x3a302a, vy: -30, drag: 2 }, { speed: [40, 220] })
        this.fx.burst(this.art.chunk, 20, { x, y, life: 1.1, scale: 0.9, scaleEnd: 0.5, alpha: 1, alphaEnd: 0.2, ay: 900, tint: 0x5a3a20, drag: 0.4 }, { speed: [200, 520] })
    }

    private popText(text: string, x: number, y: number, color: string) {
        const t = new Text({ text, style: { ...POP, fill: color }, resolution: TEXT_RES })
        t.anchor.set(0.5)
        t.position.set(x, y)
        this.popLayer.addChild(t)
        t.scale.set(0.3)
        this.tweens.add(0.35, k => t.scale.set(0.3 + k * 0.7), { ease: ease.outBack })
        this.tweens.add(0.9, (k) => {
            t.y = y - 20 - k * 50
            t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
        }, { delay: 0.5, done: () => t.destroy() })
    }

    /** "+$250" pops at the winch, then flies into the money readout. */
    private popMoney(value: number, x: number, y: number) {
        const color = value >= 500 ? '#ffe45c' : value >= 100 ? '#ffd24a' : '#e8d8b8'
        const t = new Text({ text: `+$${value.toLocaleString('en')}`, style: { ...POP, fill: color, fontSize: value >= 500 ? 42 : 34 }, resolution: TEXT_RES })
        t.anchor.set(0.5)
        t.position.set(x, y - 10)
        this.popLayer.addChild(t)
        t.scale.set(0.2)
        this.tweens.add(0.35, k => t.scale.set(0.2 + k * 0.9), { ease: ease.outBack })
        this.tweens.add(0.55, (k) => {
            const kk = ease.inCubic(k)
            t.x = lerp(x, MONEY_TARGET.x, kk)
            t.y = lerp(y - 40, MONEY_TARGET.y, kk) - Math.sin(k * Math.PI) * 50
            t.scale.set(1.1 - kk * 0.6)
            t.alpha = 1 - Math.max(0, kk - 0.8) * 5
        }, {
            delay: 0.55,
            ease: ease.linear,
            done: () => {
                this.fxAdd.burst(this.art.spark, 6, { x: MONEY_TARGET.x, y: MONEY_TARGET.y, life: 0.4, scale: 0.25, scaleEnd: 0, tint: 0xffe070 }, { speed: [60, 160] })
                t.destroy()
            }
        })
    }

    private dropLoad() {
        if (!this.load) return
        this.load.view.destroy({ children: true })
        this.load = null
    }

    /** Icons for the Vue overlays, painted from the same textures. */
    icon(kind: GmKind): string {
        const tex = this.art.items[kind][0]!
        const src = tex.source.resource as HTMLCanvasElement
        return src.toDataURL('image/png')
    }
}
