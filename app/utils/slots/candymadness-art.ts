// Candy Madness artwork, drawn on 2D canvases at runtime. There are no image
// files: every candy, the lollipop scatter and the particle sprites are paths,
// gradients and highlights. The same canvases feed the Pixi reels (as
// textures) and the paytable (as data URLs).
//
// All drawing happens in a 100 x 100 design space that is scaled to the
// requested pixel size. Sparkle placement uses a seeded generator so a candy
// looks the same every time it is drawn.

import type { CandySymbol } from '#shared/utils/gamelogic/candymadness'

export interface CandyInfo {
  name: string
  /** Particle / glow tint. */
  color: number
  /** CSS accent for DOM elements (paytable swatches). */
  css: string
}

export const CANDY_INFO: Record<CandySymbol, CandyInfo> = {
  grape: { name: 'Grape Gumdrop', color: 0xb45cff, css: '#b45cff' },
  blue: { name: 'Blueberry Star', color: 0x46b6ff, css: '#46b6ff' },
  banana: { name: 'Lemon Slice', color: 0xffd23a, css: '#ffd23a' },
  green: { name: 'Mint Swirl', color: 0x3fe07e, css: '#3fe07e' },
  orange: { name: 'Orange Bonbon', color: 0xff9a2e, css: '#ff9a2e' },
  red: { name: 'Cherry Heart', color: 0xff3d6e, css: '#ff3d6e' },
  scatter: { name: 'Lollipop', color: 0xff6fd1, css: '#ff6fd1' }
}

type Ctx = CanvasRenderingContext2D

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][], x0 = x, y0 = y, r0 = 0) {
  const g = ctx.createRadialGradient(x0, y0, r0, x, y, r)
  for (const [o, c] of stops) g.addColorStop(o, c)
  return g
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const [o, c] of stops) g.addColorStop(o, c)
  return g
}

/** Soft contact shadow under a candy. */
function groundShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.save()
  ctx.fillStyle = radial(ctx, x, y, rx, [[0, 'rgba(30,0,40,0.42)'], [1, 'rgba(30,0,40,0)']])
  ctx.scale(1, ry / rx)
  ctx.beginPath()
  ctx.arc(x, y * rx / ry, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Glossy specular streak. */
function gloss(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, alpha = 0.85) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.fillStyle = linear(ctx, 0, -ry, 0, ry, [[0, `rgba(255,255,255,${alpha})`], [1, 'rgba(255,255,255,0)']])
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Four-point twinkle. */
function twinkle(ctx: Ctx, x: number, y: number, r: number, alpha = 1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = `rgba(255,255,255,${alpha})`
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.quadraticCurveTo(r * 0.14, -r * 0.14, r, 0)
  ctx.quadraticCurveTo(r * 0.14, r * 0.14, 0, r)
  ctx.quadraticCurveTo(-r * 0.14, r * 0.14, -r, 0)
  ctx.quadraticCurveTo(-r * 0.14, -r * 0.14, 0, -r)
  ctx.fill()
  ctx.restore()
}

/** Sugar crystals scattered inside the current clip. */
function sugar(ctx: Ctx, rand: () => number, count: number, box: [number, number, number, number], alpha = 0.55) {
  const [x, y, w, h] = box
  for (let i = 0; i < count; i++) {
    const px = x + rand() * w
    const py = y + rand() * h
    const r = 0.45 + rand() * 0.9
    dot(ctx, px, py, r, `rgba(255,255,255,${alpha * (0.4 + rand() * 0.6)})`)
    if (rand() < 0.35) dot(ctx, px + 0.5, py + 0.6, r * 0.8, `rgba(60,0,60,${alpha * 0.25})`)
  }
}

function withShadow(ctx: Ctx, color: string, blur: number, dy: number, draw: () => void) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.shadowOffsetY = dy
  draw()
  ctx.restore()
}

// --- candies -----------------------------------------------------------------

function gumdrop(ctx: Ctx) {
  const rand = seeded(11)
  groundShadow(ctx, 50, 86, 34, 6)
  const path = new Path2D()
  path.moveTo(15, 78)
  path.bezierCurveTo(12, 44, 30, 15, 50, 15)
  path.bezierCurveTo(70, 15, 88, 44, 85, 78)
  path.quadraticCurveTo(50, 90, 15, 78)
  path.closePath()
  withShadow(ctx, 'rgba(60,0,90,0.5)', 6, 3, () => {
    ctx.fillStyle = radial(ctx, 52, 55, 48, [[0, '#d99bff'], [0.45, '#a748f0'], [0.8, '#6d1bb8'], [1, '#43097a']], 38, 32, 2)
    ctx.fill(path)
  })
  ctx.save()
  ctx.clip(path)
  // bottom lip, a darker band
  ctx.fillStyle = linear(ctx, 0, 66, 0, 86, [[0, 'rgba(40,0,80,0)'], [1, 'rgba(40,0,80,0.55)']])
  ctx.fillRect(0, 60, 100, 30)
  sugar(ctx, rand, 150, [12, 12, 76, 76], 0.75)
  ctx.restore()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(50,0,90,0.55)'
  ctx.stroke(path)
  gloss(ctx, 38, 32, 12, 7, -0.6, 0.9)
  dot(ctx, 63, 28, 2.4, 'rgba(255,255,255,0.75)')
  twinkle(ctx, 70, 44, 4.5, 0.9)
}

function starPath(cx: number, cy: number, outer: number, inner: number, round: number) {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + i * Math.PI / 5
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  const p = new Path2D()
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = mid(pts[9]!, pts[0]!)
  p.moveTo(start[0], start[1])
  for (let i = 0; i < 10; i++) {
    const cur = pts[i]!
    const next = pts[(i + 1) % 10]!
    p.arcTo(cur[0], cur[1], next[0], next[1], i % 2 === 0 ? round : round * 0.6)
  }
  p.closePath()
  return p
}

function star(ctx: Ctx) {
  const rand = seeded(23)
  groundShadow(ctx, 50, 88, 32, 5)
  const outer = starPath(50, 53, 47, 23.5, 7)
  withShadow(ctx, 'rgba(0,30,110,0.55)', 6, 3, () => {
    ctx.fillStyle = radial(ctx, 55, 58, 46, [[0, '#bff0ff'], [0.35, '#5ec8ff'], [0.75, '#1f6fe0'], [1, '#12348f']], 40, 38, 2)
    ctx.fill(outer)
  })
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(8,30,100,0.6)'
  ctx.stroke(outer)
  // raised bevel
  const inner = starPath(50, 52, 30, 15, 4)
  ctx.fillStyle = radial(ctx, 48, 46, 26, [[0, 'rgba(255,255,255,0.55)'], [1, 'rgba(160,225,255,0.05)']])
  ctx.fill(inner)
  ctx.save()
  ctx.clip(outer)
  sugar(ctx, rand, 40, [10, 10, 80, 80], 0.5)
  ctx.restore()
  gloss(ctx, 37, 33, 9, 5, -0.9, 0.95)
  dot(ctx, 58, 30, 2, 'rgba(255,255,255,0.8)')
  twinkle(ctx, 70, 58, 4, 0.85)
}

function lemon(ctx: Ctx) {
  const rand = seeded(37)
  groundShadow(ctx, 50, 88, 33, 5)
  const cx = 50
  const cy = 51
  withShadow(ctx, 'rgba(120,70,0,0.5)', 6, 3, () => {
    ctx.fillStyle = radial(ctx, cx + 4, cy + 6, 40, [[0, '#ffe45a'], [0.7, '#ffb300'], [1, '#d77f00']], cx - 10, cy - 12, 2)
    ctx.beginPath()
    ctx.arc(cx, cy, 38, 0, Math.PI * 2)
    ctx.fill()
  })
  // pith ring
  ctx.fillStyle = '#fff4c4'
  ctx.beginPath()
  ctx.arc(cx, cy, 32.5, 0, Math.PI * 2)
  ctx.fill()
  // segments
  const n = 9
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + 0.07
    const a1 = ((i + 1) / n) * Math.PI * 2 - 0.07
    const p = new Path2D()
    p.moveTo(cx + Math.cos((a0 + a1) / 2) * 4, cy + Math.sin((a0 + a1) / 2) * 4)
    p.arc(cx, cy, 29.5, a0, a1)
    p.closePath()
    ctx.fillStyle = radial(ctx, cx, cy, 30, [[0, '#fff9b0'], [0.55, '#ffe23d'], [1, '#ffbf00']])
    ctx.fill(p)
  }
  dot(ctx, cx, cy, 3.2, '#fff8d8')
  // sugar coat
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, 38, 0, Math.PI * 2)
  ctx.clip()
  sugar(ctx, rand, 170, [12, 12, 76, 78], 0.8)
  // dome shading so it reads as a glossy drop, not a flat disc
  ctx.fillStyle = radial(ctx, cx - 8, cy - 10, 48, [[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(120,50,0,0.45)']])
  ctx.fillRect(0, 0, 100, 100)
  ctx.restore()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(150,80,0,0.6)'
  ctx.beginPath()
  ctx.arc(cx, cy, 38, 0, Math.PI * 2)
  ctx.stroke()
  gloss(ctx, 36, 30, 13, 6, -0.7, 0.8)
  twinkle(ctx, 68, 32, 4.5, 0.95)
}

function mint(ctx: Ctx) {
  groundShadow(ctx, 50, 88, 33, 5)
  const cx = 50
  const cy = 51
  const R = 38
  withShadow(ctx, 'rgba(0,70,30,0.5)', 6, 3, () => {
    ctx.fillStyle = '#f6fff9'
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  const n = 7
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const w = (Math.PI * 2 / n) * 0.5
    const p = new Path2D()
    p.moveTo(cx, cy)
    // curved pinwheel blade
    const ax = cx + Math.cos(a) * R * 1.1
    const ay = cy + Math.sin(a) * R * 1.1
    const bx = cx + Math.cos(a + w) * R * 1.1
    const by = cy + Math.sin(a + w) * R * 1.1
    const c1x = cx + Math.cos(a - 0.7) * R * 0.55
    const c1y = cy + Math.sin(a - 0.7) * R * 0.55
    const c2x = cx + Math.cos(a + w - 0.7) * R * 0.55
    const c2y = cy + Math.sin(a + w - 0.7) * R * 0.55
    p.quadraticCurveTo(c1x, c1y, ax, ay)
    p.lineTo(bx, by)
    p.quadraticCurveTo(c2x, c2y, cx, cy)
    ctx.fillStyle = i % 2 === 0 ? '#1fc765' : '#38e08a'
    ctx.fill(p)
  }
  // dome
  ctx.fillStyle = radial(ctx, cx + 6, cy + 8, R + 4, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(0,60,30,0.05)'], [1, 'rgba(0,70,35,0.55)']], cx - 12, cy - 14, 2)
  ctx.fillRect(0, 0, 100, 100)
  ctx.fillStyle = radial(ctx, cx - 12, cy - 14, 26, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']])
  ctx.fillRect(0, 0, 100, 100)
  ctx.restore()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(0,90,45,0.6)'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  // rim lip
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.beginPath()
  ctx.arc(cx, cy, R - 3, Math.PI * 1.05, Math.PI * 1.6)
  ctx.stroke()
  gloss(ctx, 37, 30, 12, 6, -0.65, 0.9)
  dot(ctx, 62, 27, 2, 'rgba(255,255,255,0.85)')
  twinkle(ctx, 71, 66, 4, 0.8)
}

function bonbon(ctx: Ctx) {
  const rand = seeded(53)
  groundShadow(ctx, 50, 84, 40, 5)
  const cy = 50
  // wrapper fans
  const wing = (dir: 1 | -1) => {
    const p = new Path2D()
    const bx = 50 + dir * 22
    p.moveTo(bx, cy - 5)
    p.quadraticCurveTo(50 + dir * 34, cy - 10, 50 + dir * 45, cy - 22)
    p.quadraticCurveTo(50 + dir * 40, cy - 11, 50 + dir * 47, cy - 6)
    p.quadraticCurveTo(50 + dir * 41, cy, 50 + dir * 47, cy + 6)
    p.quadraticCurveTo(50 + dir * 40, cy + 11, 50 + dir * 45, cy + 22)
    p.quadraticCurveTo(50 + dir * 34, cy + 10, bx, cy + 5)
    p.closePath()
    withShadow(ctx, 'rgba(120,40,0,0.45)', 4, 2, () => {
      ctx.fillStyle = linear(ctx, 50 + dir * 22, 0, 50 + dir * 47, 0, [[0, '#ff8a1e'], [0.5, '#ffc070'], [1, '#ff9a36']])
      ctx.fill(p)
    })
    ctx.strokeStyle = 'rgba(150,50,0,0.5)'
    ctx.lineWidth = 1.2
    ctx.stroke(p)
    // folds
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.1
    for (const k of [-12, 0, 12]) {
      ctx.beginPath()
      ctx.moveTo(50 + dir * 26, cy + k * 0.2)
      ctx.quadraticCurveTo(50 + dir * 36, cy + k * 0.6, 50 + dir * 43, cy + k * 1.2)
      ctx.stroke()
    }
  }
  wing(-1)
  wing(1)
  // twist knots
  for (const dir of [-1, 1]) {
    ctx.fillStyle = linear(ctx, 0, cy - 6, 0, cy + 6, [[0, '#ffd08a'], [1, '#d65f00']])
    ctx.beginPath()
    ctx.ellipse(50 + dir * 23.5, cy, 3.2, 6.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // ball
  withShadow(ctx, 'rgba(120,40,0,0.5)', 5, 2, () => {
    ctx.fillStyle = radial(ctx, 52, 54, 26, [[0, '#ffd7a0'], [0.4, '#ff9a2e'], [0.8, '#e0560b'], [1, '#9b3100']], 44, 42, 1)
    ctx.beginPath()
    ctx.arc(50, cy, 22, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.save()
  ctx.beginPath()
  ctx.arc(50, cy, 22, 0, Math.PI * 2)
  ctx.clip()
  // candy stripes across the ball
  ctx.strokeStyle = 'rgba(255,240,210,0.55)'
  ctx.lineWidth = 3
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath()
    ctx.moveTo(28 + i * 9, cy + 26)
    ctx.quadraticCurveTo(50 + i * 9, cy, 72 + i * 9, cy - 26)
    ctx.stroke()
  }
  sugar(ctx, rand, 26, [28, 28, 44, 44], 0.45)
  ctx.restore()
  ctx.strokeStyle = 'rgba(130,40,0,0.6)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(50, cy, 22, 0, Math.PI * 2)
  ctx.stroke()
  gloss(ctx, 43, 40, 9, 5, -0.6, 0.95)
  dot(ctx, 57, 38, 1.8, 'rgba(255,255,255,0.85)')
  twinkle(ctx, 80, 34, 3.6, 0.8)
}

function heartPath(cx: number, cy: number, s: number) {
  const p = new Path2D()
  p.moveTo(cx, cy + 30 * s)
  p.bezierCurveTo(cx - 8 * s, cy + 22 * s, cx - 38 * s, cy + 6 * s, cx - 38 * s, cy - 12 * s)
  p.bezierCurveTo(cx - 38 * s, cy - 28 * s, cx - 24 * s, cy - 36 * s, cx - 14 * s, cy - 36 * s)
  p.bezierCurveTo(cx - 5 * s, cy - 36 * s, cx, cy - 28 * s, cx, cy - 22 * s)
  p.bezierCurveTo(cx, cy - 28 * s, cx + 5 * s, cy - 36 * s, cx + 14 * s, cy - 36 * s)
  p.bezierCurveTo(cx + 24 * s, cy - 36 * s, cx + 38 * s, cy - 28 * s, cx + 38 * s, cy - 12 * s)
  p.bezierCurveTo(cx + 38 * s, cy + 6 * s, cx + 8 * s, cy + 22 * s, cx, cy + 30 * s)
  p.closePath()
  return p
}

function heart(ctx: Ctx) {
  const rand = seeded(71)
  groundShadow(ctx, 50, 88, 30, 5)
  const outer = heartPath(50, 54, 1.08)
  withShadow(ctx, 'rgba(120,0,30,0.55)', 7, 3, () => {
    ctx.fillStyle = '#ffd35a'
    ctx.fill(outer)
  })
  // gold rim
  ctx.fillStyle = linear(ctx, 0, 14, 0, 90, [[0, '#fff1a8'], [0.45, '#ffc93a'], [1, '#c77a00']])
  ctx.fill(outer)
  const body = heartPath(50, 54, 0.96)
  ctx.fillStyle = radial(ctx, 54, 58, 44, [[0, '#ffc2d0'], [0.35, '#ff4f75'], [0.75, '#d1123f'], [1, '#7a0022']], 36, 36, 2)
  ctx.fill(body)
  ctx.save()
  ctx.clip(body)
  sugar(ctx, rand, 30, [14, 14, 72, 72], 0.4)
  ctx.fillStyle = radial(ctx, 50, 40, 60, [[0.6, 'rgba(0,0,0,0)'], [1, 'rgba(90,0,20,0.5)']])
  ctx.fillRect(0, 0, 100, 100)
  ctx.restore()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = 'rgba(120,60,0,0.6)'
  ctx.stroke(outer)
  // lobe highlights
  gloss(ctx, 33, 31, 10, 6, -0.55, 0.95)
  gloss(ctx, 64, 28, 6, 3.5, 0.4, 0.6)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(22, 50)
  ctx.quadraticCurveTo(28, 64, 44, 74)
  ctx.stroke()
  twinkle(ctx, 72, 44, 5, 0.95)
  dot(ctx, 44, 26, 1.8, 'rgba(255,255,255,0.9)')
}

function lollipop(ctx: Ctx) {
  const cx = 50
  const cy = 41
  const R = 31
  // stick
  withShadow(ctx, 'rgba(60,0,60,0.45)', 4, 2, () => {
    ctx.fillStyle = linear(ctx, 46, 0, 54, 0, [[0, '#e9dff0'], [0.4, '#ffffff'], [1, '#cbbcd8']])
    ctx.beginPath()
    ctx.roundRect(46.5, cy + 16, 7, 45 - 4, 3)
    ctx.fill()
  })
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(46.5, cy + 16, 7, 41, 3)
  ctx.clip()
  ctx.strokeStyle = '#ff5fa8'
  ctx.lineWidth = 2.6
  for (let y = cy + 12; y < 100; y += 7) {
    ctx.beginPath()
    ctx.moveTo(44, y)
    ctx.lineTo(56, y + 5)
    ctx.stroke()
  }
  ctx.restore()
  // disc
  withShadow(ctx, 'rgba(120,0,90,0.55)', 8, 3, () => {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  const colors = ['#ff3d7f', '#ffb12e', '#ffe45a', '#3fe07e', '#46b6ff', '#b45cff']
  // rainbow spiral: six interleaved arms of an Archimedean spiral
  for (let arm = 0; arm < colors.length; arm++) {
    ctx.strokeStyle = colors[arm]!
    ctx.lineWidth = 6.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let t = 0; t <= 1.001; t += 0.01) {
      const a = t * Math.PI * 3.2 + (arm / colors.length) * Math.PI * 2
      const r = 2 + t * (R + 6)
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (t === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.fillStyle = radial(ctx, cx + 6, cy + 8, R + 4, [[0, 'rgba(255,255,255,0)'], [0.72, 'rgba(60,0,60,0.05)'], [1, 'rgba(70,0,70,0.5)']], cx - 10, cy - 12, 2)
  ctx.fillRect(0, 0, 100, 100)
  ctx.restore()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  gloss(ctx, cx - 11, cy - 14, 13, 7, -0.6, 0.95)
  dot(ctx, cx + 12, cy - 18, 2.2, 'rgba(255,255,255,0.9)')
  // bow
  const bowY = cy + R + 4
  ctx.fillStyle = linear(ctx, 0, bowY - 8, 0, bowY + 8, [[0, '#ff8cc6'], [1, '#e0277a']])
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx, bowY)
    ctx.quadraticCurveTo(cx + dir * 10, bowY - 12, cx + dir * 17, bowY - 5)
    ctx.quadraticCurveTo(cx + dir * 14, bowY, cx + dir * 17, bowY + 6)
    ctx.quadraticCurveTo(cx + dir * 10, bowY + 10, cx, bowY)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx, bowY + 1)
    ctx.lineTo(cx + dir * 9, bowY + 15)
    ctx.lineTo(cx + dir * 4, bowY + 14)
    ctx.closePath()
    ctx.fill()
  }
  dot(ctx, cx, bowY, 3.4, '#ffd1ea')
  twinkle(ctx, cx + 24, cy - 24, 5, 1)
  twinkle(ctx, cx - 26, cy + 18, 3.5, 0.9)
}

/** Golden sunburst drawn behind the lollipop (its own texture, so it can spin). */
function rays(ctx: Ctx) {
  const cx = 50
  const cy = 50
  ctx.fillStyle = radial(ctx, cx, cy, 50, [[0, 'rgba(255,230,140,0.9)'], [0.35, 'rgba(255,120,200,0.45)'], [1, 'rgba(255,120,200,0)']])
  ctx.fillRect(0, 0, 100, 100)
  const n = 14
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    ctx.fillStyle = radial(ctx, cx, cy, 50, [[0, 'rgba(255,245,200,0.75)'], [1, 'rgba(255,200,240,0)']])
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, 50, a - 0.09, a + 0.09)
    ctx.closePath()
    ctx.fill()
  }
}

const DRAW: Record<CandySymbol | 'rays', (ctx: Ctx) => void> = {
  grape: gumdrop,
  blue: star,
  banana: lemon,
  green: mint,
  orange: bonbon,
  red: heart,
  scatter: lollipop,
  rays
}

export type CandyArtKey = CandySymbol | 'rays'

/** A square canvas with the candy drawn edge to edge. */
export function drawCandyCanvas(key: CandyArtKey, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.scale(size / 100, size / 100)
  ctx.lineJoin = 'round'
  DRAW[key](ctx)
  return canvas
}

const urlCache = new Map<string, string>()

/** PNG data URL of a candy, for DOM use (paytable, feature cards). */
export function candyDataUrl(key: CandyArtKey, size = 128): string {
  if (!import.meta.client) return ''
  const k = `${key}:${size}`
  let url = urlCache.get(k)
  if (!url) {
    url = drawCandyCanvas(key, size).toDataURL('image/png')
    urlCache.set(k, url)
  }
  return url
}

// --- particle sprites ----------------------------------------------------------

export type ParticleKey = 'dot' | 'star' | 'sprinkle' | 'shard' | 'ring' | 'glow'

export function drawParticleCanvas(key: ParticleKey): HTMLCanvasElement {
  const size = key === 'ring' || key === 'glow' ? 128 : 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  switch (key) {
    case 'dot':
      ctx.fillStyle = radial(ctx, c, c, c, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']])
      ctx.fillRect(0, 0, size, size)
      break
    case 'glow':
      ctx.fillStyle = radial(ctx, c, c, c, [[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']])
      ctx.fillRect(0, 0, size, size)
      break
    case 'star':
      ctx.fillStyle = radial(ctx, c, c, c * 0.5, [[0, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']])
      ctx.fillRect(0, 0, size, size)
      twinkle(ctx, c, c, c * 0.95, 1)
      break
    case 'sprinkle':
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.roundRect(c - 18, c - 5, 36, 10, 5)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      break
    case 'shard': {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(c - 14, c + 10)
      ctx.lineTo(c - 4, c - 16)
      ctx.lineTo(c + 16, c - 6)
      ctx.lineTo(c + 8, c + 14)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath()
      ctx.moveTo(c + 16, c - 6)
      ctx.lineTo(c + 8, c + 14)
      ctx.lineTo(c - 2, c + 2)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'ring':
      ctx.strokeStyle = 'rgba(255,255,255,1)'
      ctx.lineWidth = 6
      ctx.shadowColor = 'rgba(255,255,255,0.9)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(c, c, c - 12, 0, Math.PI * 2)
      ctx.stroke()
      break
  }
  return canvas
}

/** Multiplier-spot colour by value: pink → orange → gold → mint → blue → violet → red. */
const SPOT_RAMP: Record<number, number> = {
  2: 0xff7ac0, 4: 0xff9a3c, 8: 0xffd23a, 16: 0xa6f04a, 32: 0x3fe0a0, 64: 0x3ad6ff,
  128: 0x4c8dff, 256: 0x9b6bff, 512: 0xe052ff, 1024: 0xff3d6e, 2048: 0xfff1a0
}

export function spotColor(value: number): number {
  return SPOT_RAMP[value] ?? 0xfff1a0
}

export function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
