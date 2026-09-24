import { Container, Sprite, type Texture } from 'pixi.js'

export interface ParticleOpts {
  x: number
  y: number
  vx?: number
  vy?: number
  ax?: number
  ay?: number
  drag?: number
  life: number
  scale?: number
  scaleEnd?: number
  alpha?: number
  alphaEnd?: number
  rot?: number
  vr?: number
  tint?: number
  blend?: 'normal' | 'add'
  /** Flip scale.x like a spinning coin / confetti. */
  flutter?: number
}

interface Particle extends Required<Omit<ParticleOpts, 'tint' | 'blend'>> {
  sprite: Sprite
  age: number
}

/** Pooled sprite particles, stepped by the scene clock. */
export class Particles {
  readonly view = new Container()
  private live: Particle[] = []
  private pool: Sprite[] = []

  emit(tex: Texture, o: ParticleOpts) {
    const s = this.pool.pop() ?? new Sprite()
    s.texture = tex
    s.anchor.set(0.5)
    s.tint = o.tint ?? 0xffffff
    s.blendMode = o.blend ?? 'normal'
    s.visible = true
    this.view.addChild(s)
    this.live.push({
      sprite: s,
      age: 0,
      x: o.x,
      y: o.y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      ax: o.ax ?? 0,
      ay: o.ay ?? 0,
      drag: o.drag ?? 0,
      life: o.life,
      scale: o.scale ?? 1,
      scaleEnd: o.scaleEnd ?? o.scale ?? 1,
      alpha: o.alpha ?? 1,
      alphaEnd: o.alphaEnd ?? 0,
      rot: o.rot ?? 0,
      vr: o.vr ?? 0,
      flutter: o.flutter ?? 0
    })
    this.place(this.live[this.live.length - 1]!, 0)
  }

  burst(tex: Texture, n: number, base: ParticleOpts, spread: { speed: [number, number]; angle?: [number, number] }) {
    const [a0, a1] = spread.angle ?? [0, Math.PI * 2]
    for (let i = 0; i < n; i++) {
      const a = a0 + Math.random() * (a1 - a0)
      const v = spread.speed[0] + Math.random() * (spread.speed[1] - spread.speed[0])
      this.emit(tex, {
        ...base,
        vx: (base.vx ?? 0) + Math.cos(a) * v,
        vy: (base.vy ?? 0) + Math.sin(a) * v,
        life: base.life * (0.7 + Math.random() * 0.6),
        rot: Math.random() * Math.PI * 2,
        vr: base.vr ?? (Math.random() - 0.5) * 6
      })
    }
  }

  private place(p: Particle, k: number) {
    const s = p.sprite
    s.position.set(p.x, p.y)
    const sc = p.scale + (p.scaleEnd - p.scale) * k
    s.scale.set(p.flutter ? sc * Math.cos(p.age * p.flutter) : sc, sc)
    s.alpha = p.alpha + (p.alphaEnd - p.alpha) * k
    s.rotation = p.rot
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!
      p.age += dt
      const k = p.age / p.life
      if (k >= 1) {
        p.sprite.visible = false
        this.view.removeChild(p.sprite)
        this.pool.push(p.sprite)
        this.live[i] = this.live[this.live.length - 1]!
        this.live.pop()
        continue
      }
      const d = Math.exp(-p.drag * dt)
      p.vx = (p.vx + p.ax * dt) * d
      p.vy = (p.vy + p.ay * dt) * d
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      this.place(p, k)
    }
  }

  clear() {
    for (const p of this.live) {
      p.sprite.visible = false
      this.view.removeChild(p.sprite)
      this.pool.push(p.sprite)
    }
    this.live.length = 0
  }
}

// ------------------------------------------------------------------ tweens

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.9
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  outElastic: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

interface Tween {
  t: number
  dur: number
  fn: (k: number) => void
  done?: () => void
  ease: (t: number) => number
  delay: number
}

export class Tweens {
  private list: Tween[] = []
  add(dur: number, fn: (k: number) => void, opts: { ease?: (t: number) => number; delay?: number; done?: () => void } = {}) {
    this.list.push({ t: 0, dur, fn, ease: opts.ease ?? ease.outCubic, delay: opts.delay ?? 0, done: opts.done })
  }

  wait(dur: number) {
    return new Promise<void>((resolve) => this.add(dur, () => {}, { done: resolve, ease: ease.linear }))
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i]!
      if (tw.delay > 0) {
        tw.delay -= dt
        continue
      }
      tw.t += dt
      const k = Math.min(1, tw.t / tw.dur)
      tw.fn(tw.ease(k))
      if (k >= 1) {
        this.list.splice(i, 1)
        tw.done?.()
      }
    }
  }

  clear() {
    this.list.length = 0
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const smooth = (t: number) => t * t * (3 - 2 * t)
