import { Container, Graphics, Sprite } from 'pixi.js'
import { type Art, MAIN_WHEEL, PILOT, PLANE_NOSE, PLANE_PIVOT, PLANE_WHEEL_Y, TAIL_WHEEL } from './art'

export const PLANE_SCALE = 0.9

// Where the booster gear mounts (plane canvas space)
const LASER_POS = { x: 158, y: 130, scale: 0.52 }
const LASER_MUZZLE = { x: LASER_POS.x + 48 * LASER_POS.scale, y: LASER_POS.y }
const MAGNET_POS = { x: 224, y: 48, scale: 0.44 }
const MAGNET_POLES = { x: MAGNET_POS.x + 22 * MAGNET_POS.scale, y: MAGNET_POS.y }
const NITRO_POS = { x: 100, y: 114, scale: 0.52 }
const NITRO_NOZZLE = { x: NITRO_POS.x - 40 * NITRO_POS.scale, y: NITRO_POS.y }
const BUOY_ANCHOR = { x: 128, y: 118 }
const BUOY_ROPE = 46

const backOut = (t: number) => {
  const c1 = 1.9
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
/** Distance from the plane origin to the bottom of the wheels, in world units (level attitude). */
export const PLANE_WHEEL_OFFSET = (PLANE_WHEEL_Y - PLANE_PIVOT.y) * PLANE_SCALE

// Taildragger ground attitude: nose up until the tail wheel touches the ground too.
const mainContact = { x: MAIN_WHEEL.x - PLANE_PIVOT.x, y: MAIN_WHEEL.y + MAIN_WHEEL.r - PLANE_PIVOT.y }
const tailContact = { x: TAIL_WHEEL.x - PLANE_PIVOT.x, y: TAIL_WHEEL.y + TAIL_WHEEL.r - PLANE_PIVOT.y }
/** Nose-up rotation (radians, negative = nose up) when resting on both wheels. */
export const GROUND_PITCH = -Math.atan2(mainContact.y - tailContact.y, mainContact.x - tailContact.x)
/** Distance from the plane origin down to the ground when resting on both wheels. */
export const GROUND_OFFSET =
  (mainContact.x * Math.sin(GROUND_PITCH) + mainContact.y * Math.cos(GROUND_PITCH)) * PLANE_SCALE

/** The biplane rig: body, spinning prop, flapping scarf and booster attachments. */
export class Plane {
  readonly view = new Container()
  private rig = new Container()
  private body: Sprite
  private disc: Sprite
  private blade: Sprite
  private spinner: Sprite
  private scarf: Sprite
  private afterburner: Sprite
  private afterglow: Sprite
  private shield: Sprite
  private magnetRing: Sprite[]
  private laserGlow: Sprite
  // physical booster gear mounted on the plane
  private gear: Record<'nitro' | 'laser' | 'magnet' | 'buoy', { s: Sprite; k: number; base: number }>
  private rope = new Graphics()
  private hitFlash = 0
  private t = 0

  /** 0 = parked, 1 = full throttle. */
  throttle = 0
  nitro = false
  laser = false
  magnet = false
  buoyOn = false
  /** Seconds of damage smoke left. */
  damaged = 0
  /** 0 = standing on its wheels, 1 = flying (the idle bob only happens in the air). */
  airborne = 0

  constructor(private art: Art) {
    const P = PLANE_PIVOT
    this.view.addChild(this.rig)
    this.rig.scale.set(PLANE_SCALE)

    this.afterglow = new Sprite(art.glow)
    this.afterglow.anchor.set(0.5)
    this.afterglow.tint = 0x5ad8ff
    this.afterglow.blendMode = 'add'
    this.afterglow.position.set(NITRO_NOZZLE.x - P.x, NITRO_NOZZLE.y - P.y)
    this.afterburner = new Sprite(art.flame)
    this.afterburner.anchor.set(0, 0.5)
    this.afterburner.position.set(NITRO_NOZZLE.x + 2 - P.x, NITRO_NOZZLE.y - P.y)
    this.afterburner.scale.set(-1.3, 0.8)
    this.afterburner.tint = 0x8fe8ff
    this.afterburner.blendMode = 'add'

    this.scarf = new Sprite(art.scarf)
    this.scarf.anchor.set(1, 0.4)
    this.scarf.position.set(PILOT.x - 4 - P.x, PILOT.y + 11 - P.y)

    this.body = new Sprite(art.plane)
    this.body.anchor.set(P.x / art.plane.width, P.y / art.plane.height)

    this.disc = new Sprite(art.propDisc)
    this.disc.anchor.set(0.5)
    this.disc.position.set(PLANE_NOSE.x - P.x + 2, PLANE_NOSE.y - P.y)
    this.blade = new Sprite(art.propBlade)
    this.blade.anchor.set(0.5)
    this.blade.position.copyFrom(this.disc.position)
    this.spinner = new Sprite(art.spinner)
    this.spinner.anchor.set(0.05, 0.5)
    this.spinner.position.set(PLANE_NOSE.x - 3 - P.x, PLANE_NOSE.y - P.y)

    this.laserGlow = new Sprite(art.glow)
    this.laserGlow.anchor.set(0.5)
    this.laserGlow.tint = 0x29ffb0
    this.laserGlow.blendMode = 'add'
    this.laserGlow.position.set(LASER_MUZZLE.x - P.x, LASER_MUZZLE.y - P.y)
    this.laserGlow.scale.set(0.35)

    const mount = (kind: 'nitro' | 'laser' | 'magnet' | 'buoy', x: number, y: number, base: number, rot = 0) => {
      const sp = new Sprite(art.gear[kind])
      sp.anchor.set(0.5)
      sp.position.set(x - P.x, y - P.y)
      sp.rotation = rot
      sp.scale.set(0)
      return { s: sp, k: 0, base }
    }
    this.gear = {
      nitro: mount('nitro', NITRO_POS.x, NITRO_POS.y, NITRO_POS.scale),
      laser: mount('laser', LASER_POS.x, LASER_POS.y, LASER_POS.scale),
      // the horseshoe opens forward, poles facing the flight direction
      magnet: mount('magnet', MAGNET_POS.x, MAGNET_POS.y, MAGNET_POS.scale, -Math.PI / 2),
      buoy: mount('buoy', BUOY_ANCHOR.x, BUOY_ANCHOR.y + BUOY_ROPE, 0.7)
    }

    this.shield = new Sprite(art.shield)
    this.shield.anchor.set(0.5)
    this.shield.position.set(160 - P.x, 90 - P.y)
    this.shield.scale.set(1.25)
    this.shield.blendMode = 'add'

    this.magnetRing = [0, 1, 2].map(() => {
      const r = new Sprite(art.ring)
      r.anchor.set(0.5)
      r.tint = 0xff5a6a
      r.blendMode = 'add'
      return r
    })

    this.rig.addChild(this.rope, this.gear.buoy.s, this.afterglow, this.afterburner, this.scarf, this.body, this.gear.nitro.s, this.gear.laser.s)
    this.rig.addChild(this.gear.magnet.s, this.disc, this.blade, this.spinner, this.laserGlow, ...this.magnetRing, this.shield)
  }

  /** Offset (world units, from the plane origin) of the laser cannon's muzzle. */
  laserMuzzle() {
    const c = Math.cos(this.view.rotation)
    const s = Math.sin(this.view.rotation)
    const x = (LASER_MUZZLE.x - PLANE_PIVOT.x) * PLANE_SCALE
    const y = (LASER_MUZZLE.y - PLANE_PIVOT.y) * PLANE_SCALE
    return { x: x * c - y * s, y: x * s + y * c }
  }

  hit() {
    this.hitFlash = 1
    this.damaged = 2.5
  }

  update(dt: number) {
    this.t += dt
    const t = this.t
    // propeller: disc blur grows with throttle, blade strobes
    const spin = 8 + this.throttle * 60
    this.blade.scale.y = Math.cos(t * spin)
    this.blade.alpha = 1 - this.throttle * 0.55
    this.disc.alpha = 0.25 + this.throttle * 0.75
    this.disc.scale.set(1 + Math.sin(t * 80) * 0.03, 1)

    // scarf flutter
    this.scarf.skew.y = Math.sin(t * 14) * 0.12 * (0.3 + this.throttle)
    this.scarf.scale.set(0.85 + Math.sin(t * 9) * 0.08 * this.throttle, 1 + Math.sin(t * 17) * 0.1)

    // nitro afterburner
    const nitroK = this.nitro ? 1 : 0
    this.afterburner.alpha += (nitroK - this.afterburner.alpha) * Math.min(1, dt * 8)
    this.afterburner.scale.x = -1.4 - Math.random() * 0.6
    this.afterburner.scale.y = 1 + Math.random() * 0.3
    this.afterglow.alpha = this.afterburner.alpha * (0.7 + Math.random() * 0.3)
    this.afterglow.scale.set(1.3 + Math.random() * 0.2)
    this.shield.alpha += ((this.nitro ? 0.8 : 0) - this.shield.alpha) * Math.min(1, dt * 6)
    this.shield.scale.set(1.25 + Math.sin(t * 6) * 0.03)

    // booster gear pops in with a springy scale and eases out when it runs out
    const active = { nitro: this.nitro, laser: this.laser, magnet: this.magnet, buoy: this.buoyOn }
    for (const kind of ['nitro', 'laser', 'magnet', 'buoy'] as const) {
      const g = this.gear[kind]
      g.k += ((active[kind] ? 1 : 0) - g.k) * Math.min(1, dt * 7)
      const e = g.k < 0.001 ? 0 : backOut(g.k)
      g.s.scale.set(g.base * e)
      g.s.visible = g.k > 0.01
    }

    // laser emitter glow
    this.laserGlow.alpha = this.gear.laser.k * (0.55 + Math.sin(t * 10) * 0.3)

    // magnet field pulses out of the poles
    this.magnetRing.forEach((r, i) => {
      const k = (t * 0.9 + i / 3) % 1
      r.visible = this.gear.magnet.k > 0.05
      r.position.set(MAGNET_POLES.x + k * 40 - PLANE_PIVOT.x, MAGNET_POLES.y - PLANE_PIVOT.y)
      r.scale.set((0.4 + k * 1.6) * this.gear.magnet.k)
      r.alpha = (1 - k) * 0.6
    })

    // life buoy swings on its rope, trailing back in the airflow
    const bk = this.gear.buoy
    const swing = Math.sin(t * 2.4) * 0.22 + 0.35 * this.throttle
    const ax = BUOY_ANCHOR.x - PLANE_PIVOT.x
    const ay = BUOY_ANCHOR.y - PLANE_PIVOT.y
    const len = BUOY_ROPE * Math.max(0.05, bk.k)
    const bx = ax - Math.sin(swing) * len
    const by = ay + Math.cos(swing) * len
    bk.s.position.set(bx, by)
    bk.s.rotation = -swing * 0.8
    this.rope.clear()
    if (bk.k > 0.02) {
      const ropeTop = { x: bx + Math.sin(swing) * 21, y: by - Math.cos(swing) * 21 }
      this.rope.moveTo(ax, ay).quadraticCurveTo((ax + ropeTop.x) / 2 + 2, (ay + ropeTop.y) / 2, ropeTop.x, ropeTop.y)
      this.rope.stroke({ width: 1.6, color: 0xd9c29a, alpha: bk.k })
    }

    // hit flash (red tint) and wobble
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5)
      const k = this.hitFlash
      const g = Math.round(255 * (1 - k * 0.7))
      this.body.tint = (255 << 16) | (g << 8) | g
      this.rig.rotation = Math.sin(t * 40) * 0.12 * k
    } else {
      this.body.tint = 0xffffff
      this.rig.rotation = 0
    }
    if (this.damaged > 0) this.damaged -= dt

    // gentle bob in flight only; on the ground the wheels stay planted
    this.rig.y = Math.sin(t * 2.2) * 3 * this.throttle * this.airborne
  }
}
