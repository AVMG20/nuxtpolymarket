import { Application, Container, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js'
import { buildArt, type Art, FONT, CLOUD_BASE, CARRIER_W, CARRIER_DECK_Y, CARRIER_WATER_Y, ISLAND_RUNWAY_X1, ISLAND_RUNWAY_Y, ROCKET_W } from './art'
import { Ocean } from './ocean'
import { Particles, Tweens, ease, lerp, clamp, smooth } from './fx'
import { Plane, PLANE_SCALE, PLANE_WHEEL_OFFSET, GROUND_OFFSET, GROUND_PITCH } from './plane'
import {
  buildScript,
  samplePath,
  type FlightScript,
  type ScriptedEvent,
  HORIZON,
  WATER,
  DECK_Y,
  PLANE_DECK_Y,
  LIFTOFF_X,
  SPACING,
  ISLAND_TOP
} from './flight'
import type { AviaBooster as Booster, AviaRoundOutcome as RoundOutcome } from '#shared/utils/gamelogic/aviamasters'
import { sfx } from './audio'

const H = 1080
const BASE_SPEED = 470
const CARRIER_X = -560
/** Camera parallax of the backdrop strips (1 = moves with the world). */
const HILLS_PARALLAX = { far: 0.03, mid: 0.07, near: 0.14 }
/** How much lower the plane origin sits when resting on both wheels (nose up) vs. level. */
const GROUND_DROP = PLANE_WHEEL_OFFSET - GROUND_OFFSET

export interface SceneHooks {
  /** Counter Balance changed (bet units). */
  onCounter(counter: number, kind: 'add' | 'mul' | 'rocket' | 'blocked' | 'booster', value?: number): void
  onBoosters(active: Booster[]): void
  onPhase(phase: 'takeoff' | 'flight' | 'landing' | 'splash' | 'landed' | 'sunk'): void
}

interface CloudSprite {
  s: Sprite
  f: number
  base: number
  drift: number
}

interface Token {
  se: ScriptedEvent | null
  view: Container
  sprite: Sprite
  glow: Sprite
  rays: Sprite | null
  x: number
  y: number
  homeY: number
  phase: number
  done: boolean
  base: number
}

interface Rocket {
  se: ScriptedEvent
  view: Container
  flame: Sprite
  warn: Sprite
  shown: boolean
  done: boolean
}

type FlightState = 'idle' | 'flying' | 'sinking' | 'rolling' | 'done'

/** Event labels (BLOCKED!, booster names, SAVED!…): same size and flat look as the value pop-ups. */
const LABEL: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 30,
  fill: '#ffffff',
  stroke: { color: '#1a1030', width: 5, join: 'round' },
  align: 'center'
}
/** Small text is rasterised above screen density so it stays crisp when scaled and moving. */
const TEXT_RES = Math.min(4, (window.devicePixelRatio || 1) * 2)

export class GameScene {
  readonly app = new Application()
  private initialised = false
  private destroyed = false
  private art!: Art
  private hooks!: SceneHooks
  private getSpeed: () => number = () => 1

  // layers
  private root = new Container()
  private skyLayer = new Container()
  private sky!: Sprite
  private sunGlow!: Sprite
  private sunRays!: Sprite
  private sunDisc!: Sprite
  private flares: Sprite[] = []
  // hills are strips of plain sprites looped horizontally (a TilingSprite also wraps
  // vertically and bleeds its bottom row into a thin line along its top edge)
  private hills = new Container()
  private hillsFar = new Container()
  private hillsMid = new Container()
  private hillsNear = new Container()
  private ocean = new Ocean()
  private cloudsBack = new Container()
  private cloudsFront = new Container()
  private clouds: CloudSprite[] = []
  private gulls: { s: Sprite; x: number; y: number; ph: number; v: number }[] = []
  private world = new Container()
  private worldBack = new Container()
  private worldItems = new Container()
  private worldFront = new Container()
  private labels = new Container()
  private screenFx = new Container()
  private flash!: Sprite
  private fx = new Particles()
  private fxFront = new Particles()
  private screenParticles = new Particles()
  private tweens = new Tweens()
  private uiTweens = new Tweens()

  // world objects
  private carrier!: Container
  private radar!: Sprite
  private island!: Container
  private palms: Sprite[] = []
  private flag!: Sprite
  private plane!: Plane
  private tokens: Token[] = []
  private rockets: Rocket[] = []
  private beams: { s: Sprite; life: number }[] = []
  /** Value/hit pop-ups stacked above the plane (newest at the bottom). */
  private popFeed = new Container()
  /** Current amount riding above the plane (bet when parked, winnings in flight). */
  private moneyTag!: Text
  private pops: { t: Text; age: number; y: number }[] = []

  // view
  private scale = 1
  /** Height (CSS px) of the control deck at the bottom of the screen. */
  private bottomInset = 0
  private viewW = 1920
  private viewH = H
  private topY = 0
  private camX = 0
  private shake = 0
  private time = 0

  // flight
  private state: FlightState = 'idle'
  private script: (FlightScript & { tangents: number[] }) | null = null
  private outcome: RoundOutcome | null = null
  private planeX = 0
  private nextEvent = 0
  private touched = false
  private nextSplash = 0
  private collectedBoosters = new Set<Booster>()
  private boosterKey = ''
  private resolveRound: (() => void) | null = null
  private phase: string = ''
  private smokeTimer = 0
  /** Keep the take-off attitude after lift-off until the flight path takes over. */
  private holdPitch = true

  /** Resolves false when the scene was destroyed while it was still loading. */
  async init(host: HTMLElement, hooks: SceneHooks, getSpeed: () => number): Promise<boolean> {
    this.hooks = hooks
    this.getSpeed = getSpeed
    await this.app.init({
      resizeTo: host,
      antialias: true,
      background: '#0d3f86',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
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
    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 1 / 20)))
    return true
  }

  /** Tears down the renderer; safe to call mid-load or mid-flight. */
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    const resolve = this.resolveRound
    this.resolveRound = null
    resolve?.()
    // Pixi's init is async: destroying before it resolves throws, so init() finishes the job.
    if (this.initialised) this.app.destroy(true, { children: true, texture: true })
  }

  // ------------------------------------------------------------------ build

  private build() {
    const a = this.art
    this.app.stage.addChild(this.root)

    // sky + sun
    this.sky = new Sprite(a.sky)
    this.sunGlow = new Sprite(a.glow)
    this.sunGlow.anchor.set(0.5)
    this.sunGlow.tint = 0xfff1c4
    this.sunGlow.blendMode = 'add'
    this.sunGlow.scale.set(7)
    this.sunGlow.alpha = 0.75
    this.sunRays = new Sprite(a.rays)
    this.sunRays.anchor.set(0.5)
    this.sunRays.blendMode = 'add'
    this.sunRays.alpha = 0.22
    this.sunRays.scale.set(2.4)
    this.sunDisc = new Sprite(a.glow)
    this.sunDisc.anchor.set(0.5)
    this.sunDisc.scale.set(1.3)
    this.sunDisc.tint = 0xffffff
    this.sunDisc.blendMode = 'add'
    for (let i = 0; i < 4; i++) {
      const f = new Sprite(a.glow)
      f.anchor.set(0.5)
      f.blendMode = 'add'
      f.alpha = 0.06
      f.tint = [0xffd9a0, 0x9fe0ff, 0xffb0e0, 0xfff3b0][i]!
      f.scale.set(0.4 + i * 0.35)
      this.flares.push(f)
    }
    for (const [strip, tex] of [[this.hillsFar, a.hillsFar], [this.hillsMid, a.hillsMid], [this.hillsNear, a.hillsNear]] as const)
      for (let i = 0; i < 3; i++) {
        const hs = new Sprite(tex)
        hs.x = i * tex.width
        strip.addChild(hs)
      }
    this.skyLayer.addChild(this.sky, this.sunGlow, this.sunRays, this.sunDisc)
    this.hills.addChild(this.hillsFar, this.hillsMid, this.hillsNear)

    // clouds
    const mk = (layer: Container, n: number, f: number, sc: [number, number], y: [number, number], alpha: number) => {
      for (let i = 0; i < n; i++) {
        const s = new Sprite(a.clouds[(i * 3 + Math.floor(f * 10)) % a.clouds.length])
        s.anchor.set(0.5, CLOUD_BASE)
        const k = sc[0] + Math.random() * (sc[1] - sc[0])
        s.scale.set(k * (Math.random() < 0.5 ? -1 : 1), k)
        s.alpha = alpha
        s.y = y[0] + Math.random() * (y[1] - y[0])
        layer.addChild(s)
        this.clouds.push({ s, f, base: Math.random() * 4000, drift: 6 + Math.random() * 10 })
      }
    }
    mk(this.cloudsBack, 7, 0.08, [0.35, 0.55], [80, 380], 0.8)
    mk(this.cloudsBack, 6, 0.3, [0.7, 1.05], [60, 520], 0.95)

    for (let i = 0; i < 6; i++) {
      const s = new Sprite(a.gull[0])
      s.anchor.set(0.5)
      s.scale.set(0.8 + Math.random() * 0.4)
      this.gulls.push({ s, x: Math.random() * 1600, y: 220 + Math.random() * 180, ph: Math.random() * 6, v: 30 + Math.random() * 25 })
      this.cloudsBack.addChild(s)
    }

    // carrier
    this.carrier = new Container()
    const hull = new Sprite(a.carrier)
    this.carrier.addChild(hull)
    this.radar = new Sprite(a.radar)
    this.radar.anchor.set(0.5, 1)
    this.radar.position.set(208, CARRIER_DECK_Y - 172)
    this.carrier.addChild(this.radar)
    this.carrier.position.set(CARRIER_X, DECK_Y + 10 - CARRIER_DECK_Y)
    const wake = new Sprite(a.wake)
    wake.anchor.set(0, 0.5)
    wake.position.set(CARRIER_W - 200, CARRIER_WATER_Y)
    wake.scale.set(1.2, 1)
    wake.alpha = 0.8
    this.carrier.addChild(wake)
    const wake2 = new Sprite(a.wake)
    wake2.anchor.set(1, 0.5)
    wake2.position.set(60, CARRIER_WATER_Y)
    wake2.scale.set(-2.2, 1.2)
    wake2.alpha = 0.7
    this.carrier.addChild(wake2)
    const foam = new Sprite(a.wake)
    foam.anchor.set(0, 0.5)
    foam.position.set(40, CARRIER_WATER_Y + 8)
    foam.scale.set((CARRIER_W - 200) / 256, 0.6)
    foam.alpha = 0.85
    this.carrier.addChild(foam)

    // island (placed per round)
    this.island = new Container()
    this.island.visible = false
    const shore = new Sprite(a.wake)
    shore.anchor.set(0.5)
    shore.scale.set(6, 1.2)
    shore.position.set(700, 404)
    shore.alpha = 0.8
    this.island.addChild(new Sprite(a.island), shore)
    for (const [x, sc] of [[150, 1.0], [212, 0.82], [1300, 1.05]] as const) {
      const p = new Sprite(a.palm)
      p.anchor.set(0.53, 1)
      p.scale.set(sc)
      p.position.set(x, ISLAND_RUNWAY_Y + 30)
      this.palms.push(p)
      this.island.addChild(p)
    }
    const pole = new Sprite(Texture.WHITE)
    pole.tint = 0xe8e8e8
    pole.width = 5
    pole.height = 150
    pole.position.set(ISLAND_RUNWAY_X1 + 16, ISLAND_RUNWAY_Y - 148)
    // the flag flies to the left of its pole (over the runway), away from the palm
    this.flag = new Sprite(a.flag)
    this.flag.anchor.set(1, 0)
    this.flag.position.set(ISLAND_RUNWAY_X1 + 17, ISLAND_RUNWAY_Y - 146)
    this.island.addChild(pole, this.flag)

    this.plane = new Plane(a)
    this.moneyTag = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: 26, fill: '#ffe066', stroke: { color: '#3a1e00', width: 5, join: 'round' } },
      resolution: TEXT_RES
    })
    this.moneyTag.anchor.set(0.5, 1)
    this.moneyTag.visible = false

    this.worldBack.addChild(this.island, this.carrier)
    this.world.addChild(this.worldBack, this.fx.view, this.worldItems, this.plane.view, this.fxFront.view, this.worldFront, this.moneyTag, this.popFeed, this.labels)

    this.flash = new Sprite(Texture.WHITE)
    this.flash.alpha = 0
    this.screenFx.addChild(this.screenParticles.view, this.flash)

    this.root.addChild(this.skyLayer, this.cloudsBack, this.ocean.mesh, this.hills, this.world, this.cloudsFront, ...this.flares, this.screenFx)
    this.parkPlane()
  }

  private layout(w: number, h: number) {
    // Everything is authored in a 1080-high world. Landscape fits that height; portrait
    // fits ~900 world units across and parks the sea line just above the stacked controls.
    const portrait = h > w
    this.scale = portrait ? w / 720 : Math.min(h / H, w / 980)
    // in portrait the world sits on top of the control deck (the sea may run a little under it)
    const bottom = portrait ? h - Math.max(0, this.bottomInset - 30) : h
    this.viewW = w / this.scale
    this.viewH = h / this.scale
    this.topY = H - bottom / this.scale
    this.root.scale.set(this.scale)
    this.root.y = 0
    this.root.pivot.y = this.topY
    this.sky.position.set(0, this.topY)
    this.sky.width = this.viewW
    this.sky.height = HORIZON + 40 - this.topY
    // Each strip stands on the row of the perspective sea that scrolls at the strip's own
    // parallax speed (a sea row at depth z moves at 1/z of the camera; the sea line under
    // the plane is z = 1), so land and water slide together instead of past each other.
    for (const [strip, tex, f] of [
      [this.hillsFar, this.art.hillsFar, HILLS_PARALLAX.far],
      [this.hillsMid, this.art.hillsMid, HILLS_PARALLAX.mid],
      [this.hillsNear, this.art.hillsNear, HILLS_PARALLAX.near]
    ] as const)
      strip.y = HORIZON + f * (WATER - HORIZON) + 4 - tex.height
    this.ocean.mesh.position.set(0, HORIZON)
    this.ocean.layout(this.viewW, this.topY + this.viewH - HORIZON, WATER - HORIZON)
    this.flash.position.set(0, this.topY)
    this.flash.width = this.viewW
    this.flash.height = this.viewH
    const sunX = this.viewW * 0.8
    const sunY = Math.max(this.topY + 150, 170)
    for (const s of [this.sunGlow, this.sunRays, this.sunDisc]) s.position.set(sunX, sunY)
  }

  /** Game art as data URLs, so the HTML UI (rules, booster badges) shows the same models. */
  icons(): Record<string, string> {
    const a = this.art
    const url = (t: Texture) => (t.source.resource as HTMLCanvasElement).toDataURL()
    const out: Record<string, string> = { rocket: url(a.rocket), plane: url(a.plane) }
    for (const v of [1, 2, 5, 10]) out[`add${v}`] = url(a.adders[v]!)
    for (const v of [2, 3, 4, 5]) out[`mul${v}`] = url(a.multipliers[v]!)
    for (const b of ['nitro', 'laser', 'magnet', 'buoy'] as const) out[b] = url(a.boosters[b])
    return out
  }

  /** Tells the scene how much of the screen bottom the controls cover. */
  setBottomInset(px: number) {
    if (Math.abs(px - this.bottomInset) < 1) return
    this.bottomInset = px
    this.layout(this.app.screen.width, this.app.screen.height)
  }

  /** Screen position (CSS px) of a world point — used by the UI for fly-to effects. */
  toScreen(x: number, y: number) {
    return { x: (x - this.camX) * this.scale, y: (y - this.topY) * this.scale }
  }

  // ------------------------------------------------------------------ round control

  private parkPlane() {
    this.planeX = 0
    this.plane.view.position.set(0, PLANE_DECK_Y + GROUND_DROP)
    this.plane.view.rotation = GROUND_PITCH
    this.plane.view.alpha = 1
    this.plane.throttle = 0.12
    this.plane.nitro = this.plane.laser = this.plane.magnet = this.plane.buoyOn = false
    this.camX = this.planeX - this.viewW * 0.3
  }

  /** Clears the previous round behind a soft sky-coloured fade. */
  async reset() {
    if (this.state === 'idle' && this.planeX === 0 && !this.island.visible) return
    this.flash.tint = 0xdcecfa
    const from = this.flash.alpha
    await new Promise<void>((r) => this.uiTweens.add(0.3, (k) => (this.flash.alpha = lerp(from, 0.85, k)), { ease: ease.inOutCubic, done: r }))
    this.clearRound()
    this.parkPlane()
    this.uiTweens.add(0.5, (k) => (this.flash.alpha = 0.85 * (1 - k)), { ease: ease.inOutCubic })
  }

  private clearRound() {
    for (const t of this.tokens) t.view.destroy({ children: true })
    for (const r of this.rockets) r.view.destroy({ children: true })
    for (const b of this.beams) b.s.destroy()
    this.labels.removeChildren().forEach((c) => c.destroy())
    this.popFeed.removeChildren().forEach((c) => c.destroy())
    this.pops = []
    this.tokens = []
    this.rockets = []
    this.beams = []
    this.fx.clear()
    this.fxFront.clear()
    this.screenParticles.clear()
    this.tweens.clear()
    this.island.visible = false
    this.state = 'idle'
    this.script = null
    this.outcome = null
    this.collectedBoosters.clear()
    this.emitBoosters([])
  }

  /** Plays a predetermined round; resolves when the plane has stopped or sunk. */
  async play(outcome: RoundOutcome, startMoney: string): Promise<void> {
    await this.reset()
    this.setMoney(startMoney)
    this.outcome = outcome
    this.script = buildScript(outcome)
    this.nextEvent = 0
    this.touched = false
    this.nextSplash = 0
    this.holdPitch = true
    this.state = 'flying'
    this.phase = ''
    this.island.visible = true
    this.island.position.set(this.script.islandX, ISLAND_TOP)
    this.spawnItems()
    this.setPhase('takeoff')
    sfx.engineStart()
    sfx.takeoff()
    return new Promise<void>((r) => (this.resolveRound = r))
  }

  private setPhase(p: 'takeoff' | 'flight' | 'landing' | 'splash' | 'landed' | 'sunk') {
    if (this.phase === p) return
    this.phase = p
    this.hooks.onPhase(p)
  }

  private spawnItems() {
    const s = this.script!
    const a = this.art
    for (const se of s.events) {
      const ev = se.ev
      if (ev.kind === 'rocket') this.rockets.push(this.makeRocket(se))
      else {
        const tex = ev.kind === 'add' ? a.adders[ev.value]! : ev.kind === 'mul' ? a.multipliers[ev.value]! : a.boosters[ev.booster]
        const big = (ev.kind === 'add' && ev.value >= 10) || (ev.kind === 'mul' && ev.value >= 3)
        const t = this.makeToken(tex, se.x, se.y, ev.kind, big)
        t.se = se
        if (se.magnet) {
          // magnetised items float off the line and get pulled in
          const off = se.y > 400 ? -190 : 190
          t.homeY = t.y = se.y + off
        }
        this.tokens.push(t)
      }
    }
    // decoys the plane flies past
    for (let i = 0; i < s.events.length - 1; i++) {
      if (Math.random() > 0.7) continue
      const x = s.events[i]!.x + SPACING / 2 + (Math.random() - 0.5) * 120
      const py = samplePath(s, x, s.tangents).y
      const up = py > 380 ? true : py < 300 ? false : Math.random() < 0.5
      const y = clamp(py + (up ? -1 : 1) * (200 + Math.random() * 70), 230, 640)
      if (Math.abs(y - py) < 170) continue
      const r = Math.random()
      const kind = r < 0.55 ? 'add' : r < 0.9 ? 'mul' : 'booster'
      const value = kind === 'add' ? [1, 2, 5, 10][Math.floor(Math.random() * 3.3)]! : [2, 3, 4, 5][Math.floor(Math.random() * 3.2)]!
      const tex = kind === 'add' ? a.adders[value]! : kind === 'mul' ? a.multipliers[value]! : a.boosters[(['nitro', 'laser', 'magnet', 'buoy'] as const)[Math.floor(Math.random() * 4)]!]
      const big = (kind === 'add' && value >= 10) || (kind === 'mul' && value >= 3)
      this.tokens.push(this.makeToken(tex, x, y, kind, big))
    }
  }

  /** Floating value (glowing numeral) or booster (object in a bubble). */
  private makeToken(tex: Texture, x: number, y: number, kind: 'add' | 'mul' | 'booster', big = false): Token {
    const view = new Container()
    const glow = new Sprite(this.art.glow)
    glow.anchor.set(0.5)
    glow.blendMode = 'add'
    glow.tint = kind === 'add' ? 0x6fc8ff : kind === 'mul' ? 0xffc03a : 0x9fe8ff
    glow.scale.set(kind === 'booster' ? 1.5 : 1.25)
    glow.alpha = 0.55
    // high values get a spiky starburst behind them
    let rays: Sprite | null = null
    if (big) {
      rays = new Sprite(this.art.burst)
      rays.anchor.set(0.5)
      rays.tint = kind === 'mul' ? 0xffa21a : 0x2f8cff
      rays.scale.set(0.74)
      rays.rotation = Math.random() * Math.PI
      view.addChild(rays)
    }
    const sprite = new Sprite(tex)
    sprite.anchor.set(0.5)
    sprite.scale.set(kind === 'booster' ? 0.72 : 0.9)
    view.addChild(glow, sprite)
    view.position.set(x, y)
    this.worldItems.addChild(view)
    return { se: null, view, sprite, glow, rays, x, y, homeY: y, phase: Math.random() * 6, done: false, base: sprite.scale.x }
  }

  private makeRocket(se: ScriptedEvent): Rocket {
    const view = new Container()
    const flame = new Sprite(this.art.flame)
    flame.anchor.set(0, 0.5)
    flame.position.set(ROCKET_W / 2 - 4, 0)
    flame.blendMode = 'add'
    const glow = new Sprite(this.art.glow)
    glow.anchor.set(0.5)
    glow.tint = 0xff7a2a
    glow.blendMode = 'add'
    glow.position.set(ROCKET_W / 2 + 10, 0)
    glow.alpha = 0.7
    const body = new Sprite(this.art.rocket)
    body.anchor.set(0.5)
    view.addChild(glow, flame, body)
    view.scale.set(0.8)
    view.visible = false
    const warn = new Sprite(this.art.warning)
    warn.anchor.set(1, 0.5)
    warn.visible = false
    this.worldItems.addChild(view)
    this.worldFront.addChild(warn)
    return { se, view, flame, warn, shown: false, done: false }
  }

  // ------------------------------------------------------------------ update

  private update(dt: number) {
    this.time += dt
    const speed = this.getSpeed()
    const nitroBoost = this.plane.nitro ? 1.35 : 1
    const gdt = dt * speed * (this.state === 'flying' ? nitroBoost : 1)

    if (this.state === 'flying' || this.state === 'rolling') this.advance(gdt)
    else if (this.state === 'idle') {
      this.plane.throttle = 0.12
      this.plane.view.y = PLANE_DECK_Y + GROUND_DROP
      this.plane.airborne = 0
    }

    this.plane.update(gdt)
    this.updateItems(gdt)
    this.fx.update(gdt)
    this.fxFront.update(gdt)
    this.screenParticles.update(dt)
    this.tweens.update(gdt)
    this.uiTweens.update(dt)
    this.updatePops(dt)
    this.updateCamera(dt)
    this.updateAmbient(dt)
  }

  private speedFactor(x: number) {
    const s = this.script!
    if (x < LIFTOFF_X) return 0.3 + 0.7 * smooth(clamp(x / LIFTOFF_X, 0, 1))
    if (s.touchdownX !== null && x > s.touchdownX) {
      const k = clamp((x - s.touchdownX) / (s.stopX - s.touchdownX), 0, 1)
      return Math.max(0.03, Math.pow(1 - k, 0.8))
    }
    return 1
  }

  /** 1 = resting on both wheels, 0 = tail up (flying or fast on the main wheels). */
  private groundness(x: number) {
    const s = this.script!
    // take-off: roll in the nose-up stance, then rotate straight into the climb; the climb
    // angle matches the ground stance, so the tail never lifts on the deck
    if (x < LIFTOFF_X) return 1
    if (x < LIFTOFF_X + 220) return 1 - smooth((x - LIFTOFF_X) / 220)
    // landing: touch down on the main wheels, the tail settles as the plane slows
    if (s.touchdownX !== null && x >= s.touchdownX) return smooth(clamp((x - s.touchdownX) / ((s.stopX - s.touchdownX) * 0.7), 0, 1))
    return 0
  }

  private advance(gdt: number) {
    const s = this.script!
    const v = BASE_SPEED * this.speedFactor(this.planeX)
    this.planeX += v * gdt
    const { y, slope } = samplePath(s, this.planeX, s.tangents)
    // taildragger: on the ground the plane rests nose-up on main and tail wheel
    const g = this.groundness(this.planeX)
    this.plane.airborne = 1 - g
    this.plane.view.position.set(this.planeX, y + GROUND_DROP * g)
    let target = clamp(Math.atan(slope) * 0.9, -0.5, 0.8)
    // After lift-off the path starts almost flat; instead of dipping the nose back to level,
    // hold the take-off attitude until the path climbs steeper than it, or levels off/descends.
    if (this.holdPitch && this.planeX >= LIFTOFF_X) {
      if (target <= GROUND_PITCH || (this.planeX > LIFTOFF_X + 200 && slope >= 0)) this.holdPitch = false
      else target = GROUND_PITCH
    }
    target = lerp(target, GROUND_PITCH, g)
    this.plane.view.rotation += (target - this.plane.view.rotation) * Math.min(1, gdt * 8)
    this.plane.throttle = this.state === 'rolling' ? Math.max(0.12, this.speedFactor(this.planeX)) : clamp(0.4 + this.planeX / LIFTOFF_X, 0.4, 1)
    sfx.engineThrottle(this.plane.throttle * (this.plane.nitro ? 1.3 : 1))

    if (this.planeX > LIFTOFF_X && this.phase === 'takeoff') this.setPhase('flight')
    if (this.planeX > s.lastX + 200 && this.phase === 'flight') this.setPhase('landing')

    // exhaust + damage smoke
    this.smokeTimer -= gdt
    if (this.smokeTimer <= 0 && this.state === 'flying') {
      this.smokeTimer = this.plane.damaged > 0 ? 0.03 : 0.07
      const damaged = this.plane.damaged > 0
      this.fx.emit(this.art.smoke, {
        x: this.planeX - 110 * PLANE_SCALE,
        y: y + 12,
        vx: -60 - Math.random() * 40,
        vy: -10 - Math.random() * 20,
        life: damaged ? 1.4 : 0.8,
        scale: damaged ? 0.5 : 0.25,
        scaleEnd: damaged ? 1.4 : 0.8,
        alpha: damaged ? 0.75 : 0.35,
        tint: damaged ? 0x3a3a3a : 0xffffff,
        vr: 1
      })
    }

    // booster state
    const active: Booster[] = []
    for (const sp of s.boosterSpans) if (this.collectedBoosters.has(sp.booster) && this.planeX >= sp.from && this.planeX < sp.to) active.push(sp.booster)
    this.plane.nitro = active.includes('nitro')
    this.plane.laser = active.includes('laser')
    this.plane.magnet = active.includes('magnet')
    if (this.plane.buoyOn) active.push('buoy')
    this.emitBoosters(active)

    // events
    while (this.nextEvent < s.events.length) {
      const se = s.events[this.nextEvent]!
      if (se.ev.kind === 'rocket') break // rockets resolve in updateItems
      if (this.planeX < se.x - 70) break
      this.collect(se)
      this.nextEvent++
    }
    if (this.nextEvent < s.events.length && s.events[this.nextEvent]!.ev.kind === 'rocket') {
      const r = this.rockets.find((r) => r.se === s.events[this.nextEvent])
      if (r?.done) this.nextEvent++
    }

    // touching the sea: sink, Life Buoy bounce, or Safe Landing skim
    while (this.nextSplash < s.splashes.length && this.planeX >= s.splashes[this.nextSplash]!.x) {
      const sp = s.splashes[this.nextSplash++]!
      if (sp.type === 'sink') {
        this.splash(false)
        return
      }
      if (sp.type === 'rescue') this.splash(true)
      else this.skim()
    }
    if (s.touchdownX !== null && !this.touched && this.planeX >= s.touchdownX) {
      this.touched = true
      this.touchdown()
    }
    if (this.state === 'rolling' && this.planeX >= s.stopX - 4) {
      this.state = 'done'
      this.plane.throttle = 0.12
      sfx.engineStop()
      this.setPhase('landed')
      this.tweens.add(0.3, () => {}, { done: () => this.finish() })
    }
  }

  private finish() {
    const r = this.resolveRound
    this.resolveRound = null
    r?.()
  }

  private emitBoosters(active: Booster[]) {
    const key = active.join(',')
    if (key === this.boosterKey) return
    this.boosterKey = key
    this.hooks.onBoosters(active)
  }

  // ------------------------------------------------------------------ event resolution

  private collect(se: ScriptedEvent) {
    const ev = se.ev
    const tok = this.tokens.find((t) => t.se === se)
    const px = this.planeX + 60
    const py = this.plane.view.y
    if (tok) {
      tok.done = true
      const v = tok.view
      this.tweens.add(0.35, (k) => {
        v.scale.set(1 + k * 0.8)
        v.alpha = 1 - k
      }, { ease: ease.outCubic, done: () => (v.visible = false) })
    }
    const tint = ev.kind === 'booster' ? 0x7fe0ff : ev.kind === 'mul' ? 0xffd54a : 0x9dff7a
    this.fxFront.burst(this.art.spark, ev.kind === 'mul' ? 26 : 16, { x: px, y: py, life: 0.6, scale: 0.55, scaleEnd: 0.1, alpha: 1, tint, blend: 'add', drag: 3 }, { speed: [220, 620] })
    this.fxFront.emit(this.art.ring, { x: px, y: py, life: 0.45, scale: 0.4, scaleEnd: 2.6, alpha: 0.9, tint, blend: 'add' })
    this.fxFront.emit(this.art.glow, { x: px, y: py, life: 0.3, scale: 1.5, scaleEnd: 3.2, alpha: 0.9, tint, blend: 'add' })

    if (ev.kind === 'add') {
      this.pop(`+${ev.value}`, 'add')
      sfx.collect(ev.value, false)
      this.hooks.onCounter(ev.counter, 'add', ev.value)
    } else if (ev.kind === 'mul') {
      this.pop(`×${ev.value}`, 'mul')
      sfx.collect(ev.value, true)
      this.shake = Math.max(this.shake, 6)
      this.hooks.onCounter(ev.counter, 'mul', ev.value)
    } else if (ev.kind === 'booster') {
      this.collectedBoosters.add(ev.booster)
      if (ev.booster === 'buoy') this.plane.buoyOn = true
      const names = { nitro: 'NITRO!', laser: 'LASER GUN!', magnet: 'MAGNET!', buoy: 'LIFE BUOY!' }
      this.label(names[ev.booster], px, py - 80, '#8fe8ff')
      sfx.booster()
      if (ev.booster === 'magnet') sfx.magnet()
      this.hooks.onCounter(ev.counter, 'booster')
    }
    if (ev.kind !== 'rocket' && ev.counter >= 1000) {
      this.label('MAX WIN!', px + 40, py - 150, '#ffe066')
      this.flashScreen(0xfff2b0, 0.25)
    }
  }

  private rocketResolve(r: Rocket, how: 'hit' | 'nitro' | 'laser', at: { x: number; y: number }) {
    r.done = true
    r.view.visible = false
    r.warn.visible = false
    const ev = r.se.ev
    this.explode(at.x, at.y, how === 'hit' ? 1.35 : 0.7, how === 'hit' ? BASE_SPEED : 0)
    if (how === 'hit') {
      this.plane.hit()
      this.pop('/2', 'hit')
      sfx.halve()
      this.shake = Math.max(this.shake, 22)
      this.flashScreen(0xffb070, 0.1)
      this.hooks.onCounter(ev.counter, 'rocket')
    } else {
      this.label('BLOCKED!', at.x, at.y - 90, '#8fe8ff')
      if (how === 'nitro') sfx.shield()
      this.shake = Math.max(this.shake, 8)
      this.hooks.onCounter(ev.counter, 'blocked')
    }
  }

  private updateItems(gdt: number) {
    const t = this.time
    for (const tok of this.tokens) {
      if (tok.done) continue
      tok.phase += gdt
      let x = tok.x
      let y = tok.homeY + Math.sin(tok.phase * 2.4) * 8
      if (tok.se?.magnet) {
        const d = tok.se.x - this.planeX
        if (d < 480) {
          const k = ease.inCubic(clamp(1 - (d - 60) / 420, 0, 1))
          x = lerp(tok.x, this.planeX + 60, k)
          y = lerp(y, this.plane.view.y, k)
          if (Math.random() < 0.5)
            this.fx.emit(this.art.dot, { x, y, vx: (this.planeX - x) * 2, vy: (this.plane.view.y - y) * 2, life: 0.3, scale: 0.6, alpha: 0.8, tint: 0xff6a7a, blend: 'add' })
        }
      }
      tok.view.position.set(x, y)
      tok.sprite.scale.set(tok.base * (1 + Math.sin(tok.phase * 3) * 0.04))
      tok.glow.alpha = 0.45 + Math.sin(tok.phase * 4) * 0.15
      if (tok.rays) {
        tok.rays.rotation += gdt * 0.5
        tok.rays.scale.set(0.74 * (1 + Math.sin(tok.phase * 5) * 0.08))
        tok.rays.alpha = 0.85 + Math.sin(tok.phase * 7) * 0.15
      }
    }

    for (const r of this.rockets) {
      if (r.done || this.state !== 'flying') continue
      const se = r.se
      const d = se.x - this.planeX
      const arrive = (dd: number) => ({ x: se.x + dd * 1.15, y: se.y + dd * 0.24 })
      if (d > 1500) continue
      if (d > 900) {
        // incoming warning pinned to the right screen edge
        r.warn.visible = true
        r.warn.position.set(this.camX + this.viewW - 24, clamp(se.y, 120, 900))
        r.warn.scale.set(0.9 + Math.sin(t * 16) * 0.12)
        r.warn.alpha = 0.6 + Math.sin(t * 16) * 0.4
        continue
      }
      r.warn.visible = false
      if (!r.shown) {
        r.shown = true
        r.view.visible = true
        sfx.rocketIncoming()
      }
      const p = arrive(Math.max(d, 0))
      r.view.position.set(p.x, p.y)
      r.view.rotation = Math.atan2(0.24, 1.15)
      r.flame.scale.set(0.9 + Math.random() * 0.5, 0.8 + Math.random() * 0.4)
      if (Math.random() < 0.9) {
        const c = Math.cos(r.view.rotation)
        const s = Math.sin(r.view.rotation)
        const tx = p.x + c * ROCKET_W * 0.4
        const ty = p.y + s * ROCKET_W * 0.4
        this.fx.emit(this.art.smoke, { x: tx, y: ty, vx: 30, vy: 10, life: 0.9, scale: 0.3, scaleEnd: 1.1, alpha: 0.55, tint: 0xdcdcdc, vr: 0.6 })
        this.fx.emit(this.art.dot, { x: tx, y: ty, vx: 80, vy: 20, life: 0.25, scale: 1, alpha: 1, tint: 0xffa040, blend: 'add' })
      }
      const plane = { x: this.planeX + 40, y: this.plane.view.y }
      if (se.laser && d <= 420) {
        this.fireLaser(p)
        sfx.laser()
        this.rocketResolve(r, 'laser', p)
      } else if (se.nitro && d <= 110) {
        this.rocketResolve(r, 'nitro', { x: plane.x + 100, y: (plane.y + p.y) / 2 })
        this.fxFront.emit(this.art.shield, { x: plane.x + 10, y: plane.y, life: 0.4, scale: 1.2, scaleEnd: 1.6, alpha: 1, blend: 'add' })
      } else if (d <= 40) {
        this.rocketResolve(r, 'hit', plane)
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!
      b.life -= gdt
      b.s.alpha = Math.max(0, b.life / 0.25)
      b.s.scale.y = 0.6 + Math.random() * 0.8
      if (b.life <= 0) {
        b.s.destroy()
        this.beams.splice(i, 1)
      }
    }
  }

  private fireLaser(target: { x: number; y: number }) {
    const n = this.plane.laserMuzzle()
    const x0 = this.planeX + n.x
    const y0 = this.plane.view.y + n.y
    const dx = target.x - x0
    const dy = target.y - y0
    const s = new Sprite(this.art.beam)
    s.anchor.set(0, 0.5)
    s.position.set(x0, y0)
    s.width = Math.hypot(dx, dy)
    s.rotation = Math.atan2(dy, dx)
    s.blendMode = 'add'
    this.fxFront.view.parent!.addChild(s)
    this.beams.push({ s, life: 0.25 })
    this.fxFront.emit(this.art.glow, { x: x0, y: y0, life: 0.25, scale: 0.8, scaleEnd: 1.4, alpha: 1, tint: 0x29ffb0, blend: 'add' })
  }

  /** `vx` lets the fireball travel with whatever blew up (e.g. the plane). */
  private explode(x: number, y: number, size: number, vx = 0) {
    sfx.explosion(size)
    const a = this.art
    // brief white-hot core
    this.fxFront.emit(a.glow, { x, y, life: 0.16, scale: 1.1 * size, scaleEnd: 2 * size, alpha: 1, tint: 0xfff4d0, blend: 'add' })
    // billowing fireballs
    const puffs = Math.round(13 * size)
    for (let i = 0; i < puffs; i++) {
      const ang = Math.random() * Math.PI * 2
      const d = Math.random() * 26 * size
      const v = 40 + Math.random() * 170
      this.fxFront.emit(a.fireball, {
        x: x + Math.cos(ang) * d,
        y: y + Math.sin(ang) * d,
        vx: vx * (0.55 + Math.random() * 0.3) + Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 40,
        drag: 3,
        life: 0.4 + Math.random() * 0.35,
        scale: (0.3 + Math.random() * 0.25) * size,
        scaleEnd: (0.85 + Math.random() * 0.5) * size,
        alpha: 1,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 2
      })
    }
    // sparks and glowing embers that fall
    this.fxFront.burst(a.spark, Math.round(12 * size), { x, y, life: 0.55, scale: 0.35, scaleEnd: 0.05, tint: 0xffd070, blend: 'add', drag: 2, ay: 300 }, { speed: [260, 640] })
    this.fxFront.burst(a.dot, Math.round(16 * size), { x, y, life: 1.1, scale: 0.35, scaleEnd: 0.15, tint: 0xff8a2a, blend: 'add', drag: 1.2, ay: 700 }, { speed: [150, 520] })
    // shrapnel
    this.fxFront.burst(a.debris, Math.round(8 * size), { x, y, life: 1.2, scale: 1, scaleEnd: 0.8, alpha: 1, alphaEnd: 0.3, drag: 0.6, ay: 900, vr: 12 }, { speed: [200, 520] })
    // dark smoke billows up as the fire dies
    this.tweens.add(0.12, () => {}, {
      ease: ease.linear,
      done: () =>
        this.fx.burst(a.smoke, Math.round(10 * size), { x: x + vx * 0.08, y, vx: vx * 0.35, life: 1.9, scale: 0.45 * size, scaleEnd: 2.1 * size, alpha: 0.7, tint: 0x3d3834, drag: 2.5, ay: -70 }, { speed: [40, 180] })
    })
  }

  private splash(saved: boolean) {
    const x = this.planeX + 40
    const y = WATER
    const a = this.art
    sfx.splash()
    this.shake = Math.max(this.shake, saved ? 12 : 26)
    this.fxFront.burst(a.droplet, saved ? 40 : 70, { x, y, life: 1.3, scale: 0.9, scaleEnd: 0.4, alpha: 1, ay: 1300, drag: 0.4, tint: 0xe6f7ff }, { speed: [300, 1000], angle: [-Math.PI * 0.92, -Math.PI * 0.08] })
    this.fx.burst(a.smoke, 18, { x, y: y - 10, life: 1.6, scale: 0.7, scaleEnd: 2.4, alpha: 0.85, tint: 0xf4fbff, drag: 2, ay: -20 }, { speed: [80, 320], angle: [-Math.PI, 0] })
    for (let i = 0; i < 3; i++) {
      const ring = new Sprite(a.ring)
      ring.anchor.set(0.5)
      ring.position.set(x, y + 6)
      ring.alpha = 0
      this.fx.view.addChild(ring)
      this.tweens.add(1.6, (k) => {
        ring.scale.set(0.5 + k * 4, (0.5 + k * 4) * 0.22)
        ring.alpha = (1 - k) * 0.9
      }, { delay: i * 0.25, ease: ease.outCubic, done: () => ring.destroy() })
    }
    if (saved) {
      this.plane.buoyOn = false
      this.label('SAVED!', x, y - 220, '#ffcf40')
      this.fxFront.emit(a.boosters.buoy, { x, y: y - 40, life: 0.8, scale: 0.6, scaleEnd: 2.2, alpha: 1 })
      this.fxFront.emit(a.ring, { x, y: y - 40, life: 0.6, scale: 0.6, scaleEnd: 3.5, alpha: 1, tint: 0xffcf40, blend: 'add' })
      sfx.booster()
      return
    }
    // sink
    this.state = 'sinking'
    sfx.engineStop()
    this.setPhase('splash')
    const p = this.plane.view
    const y0 = p.y
    const r0 = p.rotation
    this.tweens.add(2.2, (k) => {
      p.y = y0 + k * 150
      p.rotation = r0 + k * 0.5
      p.alpha = 1 - k
      p.x = this.planeX + k * 60
      this.plane.throttle = 0.12 * (1 - k)
    }, { ease: ease.outCubic })
    let bubbles = 0
    this.tweens.add(2.2, () => {
      if (bubbles++ % 3 === 0)
        this.fx.emit(a.dot, { x: x + (Math.random() - 0.5) * 80, y: y + 10, vy: -50, life: 0.6, scale: 0.4 + Math.random() * 0.4, alpha: 0.9, tint: 0xe6f7ff })
    }, { ease: ease.linear })
    sfx.lose()
    this.tweens.add(1.4, () => {}, { done: () => {
      this.state = 'done'
      this.setPhase('sunk')
      this.moneyTag.visible = false
      this.finish()
    } })
  }

  /** Safe Landing: the plane skims off the water instead of going in. */
  private skim() {
    const x = this.planeX + 40
    const a = this.art
    sfx.splash()
    sfx.shield()
    this.shake = Math.max(this.shake, 8)
    this.fxFront.burst(a.droplet, 34, { x, y: WATER, life: 1.1, scale: 0.7, scaleEnd: 0.3, ay: 1300, drag: 0.4, tint: 0xe6f7ff }, { speed: [250, 700], angle: [-Math.PI * 0.85, -Math.PI * 0.35] })
    this.fxFront.emit(a.shield, { x, y: this.plane.view.y, life: 0.5, scale: 1.1, scaleEnd: 1.6, alpha: 1, blend: 'add' })
    this.label('SAFE!', x, WATER - 220, '#7fe8ff')
  }

  private touchdown() {
    this.state = 'rolling'
    sfx.touchdown()
    this.shake = Math.max(this.shake, 10)
    const x = this.planeX + 30
    const y = this.plane.view.y + 60
    this.fx.burst(this.art.smoke, 14, { x, y, life: 1.2, scale: 0.4, scaleEnd: 1.4, alpha: 0.8, tint: 0xe9dcc6, drag: 2.5, ay: -30 }, { speed: [60, 260], angle: [-Math.PI, 0] })
    this.fxFront.burst(this.art.dot, 12, { x, y, life: 0.5, scale: 0.4, tint: 0xffe0a0, blend: 'add', ay: 600 }, { speed: [100, 400], angle: [-Math.PI * 0.9, -Math.PI * 0.4] })
  }

  // ------------------------------------------------------------------ fx helpers

  /** Updates the amount above the plane with a small bump. */
  setMoney(text: string) {
    const changed = this.moneyTag.text !== text || !this.moneyTag.visible
    this.moneyTag.text = text
    this.moneyTag.visible = true
    if (changed) this.uiTweens.add(0.3, (k) => this.moneyTag.scale.set(1.2 - 0.2 * k), { ease: ease.outBack })
  }

  /** Shows the bet above the parked plane (ignored while a round is on screen). */
  setIdleMoney(text: string) {
    if (this.state === 'idle' && !this.island.visible) this.setMoney(text)
  }

  /**
   * Compact pop-up above the plane: flat coloured text with a clean dark outline. It pops
   * in, pushes older pops up the stack, and is either fully shown or gone (no fading).
   */
  private pop(text: string, kind: 'add' | 'mul' | 'hit') {
    const palette = {
      add: { fill: '#4be36a', edge: '#0d3a14' },
      mul: { fill: '#ffc42e', edge: '#4a2300' },
      hit: { fill: '#ff4545', edge: '#4a0808' }
    }[kind]
    const t = new Text({
      text,
      style: { fontFamily: FONT, fontSize: 30, fill: palette.fill, stroke: { color: palette.edge, width: 5, join: 'round' } },
      // rasterise well above screen density: the world is scaled and moves on sub-pixels,
      // which would otherwise soften this small text
      resolution: TEXT_RES
    })
    t.anchor.set(0.5, 1)
    t.scale.set(0.2)
    this.popFeed.addChild(t)
    this.pops.unshift({ t, age: 0, y: 0 })
    // keep at most four on screen
    while (this.pops.length > 4) this.pops.pop()!.t.destroy()
  }

  private updatePops(dt: number) {
    const LINE = 28
    const LIFE = 1.8
    // money just above the pilot's helmet, tilting with the plane (nose-up on the ground);
    // the pop stack sits right above it at the same anchor and stays upright
    const r = this.plane.view.rotation
    const above = (d: number) => ({ x: this.plane.view.x + d * Math.sin(r), y: this.plane.view.y - d * Math.cos(r) })
    const tagAt = above(76)
    this.moneyTag.position.set(tagAt.x, tagAt.y)
    this.moneyTag.rotation = r
    const stackAt = above(this.moneyTag.visible ? 106 : 80)
    this.popFeed.position.set(stackAt.x, stackAt.y)
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!
      p.age += dt
      if (p.age >= LIFE) {
        p.t.destroy()
        this.pops.splice(i, 1)
        continue
      }
      // slide into its slot (newest at the bottom); fully visible until it is removed
      const target = -i * LINE
      p.y += (target - p.y) * Math.min(1, dt * 14)
      p.t.y = p.y
      const k = Math.min(1, p.age / 0.22)
      p.t.scale.set(0.2 + 0.8 * ease.outBack(k))
    }
  }

  private label(text: string, x: number, y: number, color: string) {
    y = Math.max(y, 250)
    const t = new Text({ text, style: { ...LABEL, fill: color }, resolution: TEXT_RES })
    t.anchor.set(0.5)
    t.position.set(x, y)
    t.scale.set(0)
    this.labels.addChild(t)
    this.tweens.add(0.35, (k) => t.scale.set(k), { ease: ease.outBack })
    this.tweens.add(0.9, (k) => {
      t.y = y - k * 90
      t.alpha = 1 - k
    }, { delay: 0.45, ease: ease.inCubic, done: () => t.destroy() })
  }

  private flashScreen(tint: number, alpha: number) {
    this.flash.tint = tint
    this.uiTweens.add(0.35, (k) => (this.flash.alpha = alpha * (1 - k)))
  }

  // ------------------------------------------------------------------ camera & ambience

  private updateCamera(dt: number) {
    const s = this.script
    let lead = 0.3
    if (s && this.state !== 'idle') {
      const endStart = s.lastX + 100
      const endX = s.touchdownX ?? s.splashX ?? s.stopX
      const k = smooth(clamp((this.planeX - endStart) / Math.max(1, endX - endStart), 0, 1))
      lead = lerp(0.3, s.touchdownX !== null ? 0.28 : 0.42, k)
      // keep the island in frame while rolling out
      if (this.state === 'rolling' || (this.state === 'done' && s.touchdownX !== null)) lead = lerp(0.28, 0.5, clamp((this.planeX - s.touchdownX!) / 500, 0, 1))
    }
    const target = this.plane.view.x - this.viewW * lead
    this.camX += (target - this.camX) * Math.min(1, dt * (this.state === 'idle' ? 20 : 6))
    this.shake *= Math.exp(-dt * 6)
    const sx = (Math.random() - 0.5) * this.shake
    const sy = (Math.random() - 0.5) * this.shake
    this.world.position.set(-this.camX + sx, sy)
  }

  private updateAmbient(dt: number) {
    const t = this.time
    const cam = this.camX
    this.sunRays.rotation = t * 0.03
    this.sunGlow.alpha = 0.7 + Math.sin(t * 0.7) * 0.05
    // lens flares along the sun → screen centre axis
    const sx = this.sunDisc.x
    const sy = this.sunDisc.y
    const cx = this.viewW * 0.5
    const cy = this.topY + this.viewH * 0.5
    this.flares.forEach((f, i) => {
      const k = 0.4 + i * 0.35
      f.position.set(sx + (cx - sx) * k * 1.4, sy + (cy - sy) * k * 1.4)
    })
    const loop = (v: number, w: number) => -(((v % w) + w) % w)
    this.hillsFar.x = loop(cam * HILLS_PARALLAX.far, this.art.hillsFar.width)
    this.hillsMid.x = loop(cam * HILLS_PARALLAX.mid, this.art.hillsMid.width)
    this.hillsNear.x = loop(cam * HILLS_PARALLAX.near, this.art.hillsNear.width)
    this.ocean.update(t, cam, sx)

    const span = this.viewW + 1600
    for (const c of this.clouds) {
      let x = (c.base - cam * c.f - t * c.drift) % span
      if (x < 0) x += span
      c.s.x = x - 800
    }
    for (const g of this.gulls) {
      g.x -= g.v * dt
      let x = (g.x - cam * 0.4) % (this.viewW + 400)
      if (x < 0) x += this.viewW + 400
      g.s.x = x - 200
      g.s.y = g.y + Math.sin(t * 1.3 + g.ph) * 12
      g.s.texture = this.art.gull[Math.floor(t * 5 + g.ph) % 2]!
    }
    this.radar.scale.x = Math.cos(t * 2.5)
    for (const [i, p] of this.palms.entries()) p.skew.x = Math.sin(t * 1.3 + i) * 0.035
    this.flag.scale.x = 0.85 + Math.sin(t * 7) * 0.15
    this.flag.skew.y = Math.sin(t * 5) * 0.08
  }

  // ------------------------------------------------------------------ celebrations

  /** Coin shower + fireworks; tier 0 = small win … 4 = max win. */
  celebrate(tier: number) {
    const a = this.art
    const count = [18, 50, 110, 180, 260][tier]!
    const w = this.viewW
    for (let i = 0; i < count; i++) {
      this.uiTweens.add(0.001, () => {}, {
        delay: (i / count) * (1.2 + tier * 0.5),
        done: () => {
          this.screenParticles.emit(a.coin, {
            x: Math.random() * w,
            y: this.topY - 40,
            vx: (Math.random() - 0.5) * 200,
            vy: 200 + Math.random() * 400,
            ay: 900,
            life: 2.4,
            scale: 0.7 + Math.random() * 0.6,
            scaleEnd: 0.7,
            alpha: 1,
            alphaEnd: 1,
            vr: (Math.random() - 0.5) * 8,
            flutter: 6 + Math.random() * 8
          })
          if (i % 6 === 0) sfx.coin()
        }
      })
      if (i % 2 === 0)
        this.uiTweens.add(0.001, () => {}, {
          delay: (i / count) * (1.4 + tier * 0.5),
          done: () =>
            this.screenParticles.emit(a.confetti, {
              x: Math.random() * w,
              y: this.topY - 20,
              vx: (Math.random() - 0.5) * 300,
              vy: 100 + Math.random() * 200,
              ay: 260,
              drag: 1,
              life: 3,
              scale: 1 + Math.random(),
              alpha: 1,
              alphaEnd: 0.6,
              vr: (Math.random() - 0.5) * 10,
              tint: [0xff4d6d, 0xffd54a, 0x4dd8ff, 0x7dff8a, 0xc77dff][Math.floor(Math.random() * 5)],
              flutter: 10
            })
        })
    }
    const bursts = [2, 4, 7, 10, 14][tier]!
    for (let i = 0; i < bursts; i++) {
      this.uiTweens.add(0.001, () => {}, {
        delay: 0.2 + i * 0.35,
        done: () => {
          const x = this.camX + this.viewW * (0.15 + Math.random() * 0.7)
          const y = 150 + Math.random() * 300
          sfx.firework()
          const tint = [0xff4d6d, 0xffd54a, 0x4dd8ff, 0x7dff8a, 0xffffff][i % 5]
          this.fxFront.burst(a.spark, 50, { x, y, life: 1.3, scale: 0.5, scaleEnd: 0.05, tint, blend: 'add', drag: 1.8, ay: 180 }, { speed: [250, 520] })
          this.fxFront.emit(a.glow, { x, y, life: 0.5, scale: 2, scaleEnd: 4, alpha: 0.9, tint, blend: 'add' })
        }
      })
    }
    if (tier >= 2) this.flashScreen(0xfff2b0, 0.2)
  }
}

