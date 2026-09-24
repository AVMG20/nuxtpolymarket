/**
 * Procedural art. Every model in the game is painted here with Canvas2D (gradients,
 * rim light, ambient occlusion) and uploaded once as a texture at 2x resolution.
 */
import { CanvasSource, Texture } from 'pixi.js'

const RES = 2
type Ctx = CanvasRenderingContext2D

export const FONT = '"Lilita One", "Arial Black", sans-serif'

function paint(w: number, h: number, draw: (c: Ctx) => void, res = RES): Texture {
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(w * res)
  cv.height = Math.ceil(h * res)
  const c = cv.getContext('2d')!
  c.scale(res, res)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  draw(c)
  return new Texture({ source: new CanvasSource({ resource: cv, resolution: res }) })
}

function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1)
  for (const [o, col] of stops) g.addColorStop(o, col)
  return g
}

function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][], x1 = x, y1 = y) {
  const g = c.createRadialGradient(x, y, r0, x1, y1, r1)
  for (const [o, col] of stops) g.addColorStop(o, col)
  return g
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

/** Tiny deterministic PRNG so the art is the same on every load. */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- plane

export const PLANE_W = 300
export const PLANE_H = 170
/** Point on the plane canvas used as the sprite origin (fuselage centre). */
export const PLANE_PIVOT = { x: 150, y: 92 }
/** Nose (propeller hub) in plane canvas space. */
export const PLANE_NOSE = { x: 264, y: 89 }
/** Wheel bottom in plane canvas space. */
export const PLANE_WHEEL_Y = 156

/** Main wheel and tail wheel (taildragger gear) in plane canvas space. */
export const MAIN_WHEEL = { x: 204, y: 144, r: 12 }
export const TAIL_WHEEL = { x: 44, y: 108, r: 4.6 }

/** Pilot head centre in plane canvas space (open cockpit, mid fuselage). */
export const PILOT = { x: 150, y: 37 }
/** Hero-asset resolution for the plane parts. */
const PLANE_RES = 3
const OUT = 'rgba(70,10,20,.75)'

/**
 * Hero plane: a chunky glossy racing monoplane rendered like a 3D toy. Every surface is
 * painted flat first (base colour + decals), then lit with the same stack of overlays so
 * decals wrap around the form: sky light on top, core shadow, sky-blue bounce light on
 * the belly, soft edge roll-off, broad highlight and a crisp specular streak.
 */
function planeBody(): Texture {
  return paint(PLANE_W, PLANE_H, (c) => {
    type Path = () => void
    const clipTo = (path: Path, fn: () => void) => {
      c.save()
      path()
      c.clip()
      fn()
      c.restore()
    }
    const cover = (style: string | CanvasGradient) => {
      c.fillStyle = style
      c.fillRect(0, 0, PLANE_W, PLANE_H)
    }
    /** Inner edge roll-off: a wide stroke of the silhouette, kept inside the shape. */
    const rolloff = (path: Path, col: string, w: number) =>
      clipTo(path, () => {
        path()
        c.strokeStyle = col
        c.lineWidth = w
        c.stroke()
      })
    const silhouette = (path: Path, w = 1.3, col = OUT) => {
      path()
      c.strokeStyle = col
      c.lineWidth = w
      c.stroke()
    }
    const ellipseGlow = (x: number, y: number, rx: number, ry: number, col: string) => {
      c.save()
      c.translate(x, y)
      c.scale(1, ry / rx)
      c.fillStyle = rad(c, 0, 0, 0, rx, [[0, col], [1, col.replace(/[\d.]+\)$/, '0)')]])
      c.beginPath()
      c.arc(0, 0, rx, 0, Math.PI * 2)
      c.fill()
      c.restore()
    }
    const specular = (x: number, y: number, rx: number, ry: number, a = 0.9, rot = 0) => {
      c.fillStyle = `rgba(255,255,255,${a})`
      c.beginPath()
      c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
      c.fill()
    }

    // ================================================================ tail fin (behind the body)
    const fin: Path = () => {
      c.beginPath()
      c.moveTo(52, 84)
      c.bezierCurveTo(42, 66, 30, 40, 38, 24)
      c.bezierCurveTo(46, 12, 66, 16, 74, 34)
      c.bezierCurveTo(80, 50, 86, 64, 100, 76)
      c.closePath()
    }
    fin()
    c.fillStyle = '#e2232c'
    c.fill()
    clipTo(fin, () => {
      // decals: white and navy bands across the fin
      c.fillStyle = '#fff4e4'
      c.save()
      c.translate(56, 40)
      c.rotate(-0.28)
      c.fillRect(-40, -3, 80, 7)
      c.fillStyle = '#1f3f7a'
      c.fillRect(-40, 4, 80, 4)
      c.restore()
      cover(lin(c, 30, 0, 100, 0, [[0, 'rgba(50,0,15,.45)'], [0.55, 'rgba(0,0,0,0)'], [1, 'rgba(255,255,255,.18)']]))
      cover(lin(c, 0, 14, 0, 86, [[0, 'rgba(255,255,255,.25)'], [0.4, 'rgba(0,0,0,0)'], [1, 'rgba(40,0,10,.35)']]))
      specular(58, 30, 3, 12, 0.55, -0.45)
    })
    rolloff(fin, 'rgba(60,0,15,.35)', 5)
    silhouette(fin)

    // ================================================================ fuselage
    const body: Path = () => {
      c.beginPath()
      c.moveTo(44, 78)
      c.bezierCurveTo(92, 66, 132, 56, 182, 56)
      c.bezierCurveTo(226, 56, 254, 66, 260, 86)
      c.bezierCurveTo(264, 104, 248, 118, 214, 121)
      c.bezierCurveTo(160, 127, 98, 118, 44, 99)
      c.quadraticCurveTo(34, 89, 44, 78)
      c.closePath()
    }
    body()
    c.fillStyle = '#e2232c'
    c.fill()
    clipTo(body, () => {
      // --- decals (painted flat, shaded below)
      // cream swoosh with gold and navy pinstripes
      c.fillStyle = '#fff4e4'
      c.beginPath()
      c.moveTo(56, 94)
      c.bezierCurveTo(120, 100, 190, 97, 262, 88)
      c.lineTo(262, 98)
      c.bezierCurveTo(190, 109, 120, 110, 50, 101)
      c.closePath()
      c.fill()
      c.strokeStyle = '#f2b32a'
      c.lineWidth = 1.8
      c.beginPath()
      c.moveTo(56, 91.5)
      c.bezierCurveTo(120, 97.5, 190, 94.5, 262, 85.5)
      c.stroke()
      c.strokeStyle = '#1f3f7a'
      c.lineWidth = 2.2
      c.beginPath()
      c.moveTo(50, 103.5)
      c.bezierCurveTo(120, 112.5, 190, 111.5, 262, 100.5)
      c.stroke()
      // chrome cowling ring
      c.fillStyle = lin(c, 0, 56, 0, 124, [[0, '#ffffff'], [0.22, '#cfd8e1'], [0.5, '#6f7c8a'], [0.66, '#9aa7b4'], [0.85, '#e3e9ef'], [1, '#56616d']])
      c.fillRect(226, 50, 16, 80)
      c.fillStyle = 'rgba(30,40,50,.7)'
      c.fillRect(226, 50, 1.4, 80)
      c.fillRect(240.6, 50, 1.4, 80)
      c.fillStyle = 'rgba(255,255,255,.8)'
      for (let y = 62; y < 120; y += 7) c.fillRect(233.4, y, 1.3, 1.3)
      // number badge
      c.fillStyle = '#fff4e4'
      c.beginPath()
      c.arc(112, 82, 9, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#1f3f7a'
      c.lineWidth = 2
      c.stroke()
      c.font = `10px ${FONT}`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillStyle = '#1f3f7a'
      c.fillText('A2', 112, 82.6)
      c.textAlign = 'start'
      c.textBaseline = 'alphabetic'
      // panel seams
      c.strokeStyle = 'rgba(80,0,15,.35)'
      c.lineWidth = 0.9
      for (const x of [92, 190]) {
        c.beginPath()
        c.moveTo(x, 50)
        c.quadraticCurveTo(x + 4, 90, x, 130)
        c.stroke()
      }

      // --- lighting
      // sky light on top, core shadow low, darker toward the tail
      cover(lin(c, 0, 56, 0, 126, [
        [0, 'rgba(255,255,255,.42)'],
        [0.2, 'rgba(255,255,255,.06)'],
        [0.5, 'rgba(0,0,0,0)'],
        [0.78, 'rgba(70,0,25,.36)'],
        [1, 'rgba(40,0,20,.5)']
      ]))
      cover(lin(c, 40, 0, 150, 0, [[0, 'rgba(50,0,20,.4)'], [1, 'rgba(50,0,20,0)']]))
      // broad soft highlight and crisp specular streaks
      ellipseGlow(192, 70, 78, 18, 'rgba(255,236,226,.5)')
      specular(196, 62.6, 42, 2.1, 0.85, -0.03)
      specular(222, 64, 9, 1.4, 1, 0.12)
      specular(254, 76, 2, 5, 0.6, -0.5)
      // cool bounce light from the sea along the belly
      c.save()
      c.beginPath()
      c.rect(0, 108, PLANE_W, 30)
      c.clip()
      body()
      c.strokeStyle = 'rgba(130,200,255,.5)'
      c.lineWidth = 7
      c.stroke()
      c.restore()
    })
    rolloff(body, 'rgba(60,0,20,.32)', 6)

    // exhaust stubs
    for (const [ex, ey] of [[218, 100], [214, 106], [210, 112]] as const) {
      c.fillStyle = lin(c, 0, ey - 2.5, 0, ey + 2.5, [[0, '#9a8676'], [1, '#2e211a']])
      c.beginPath()
      c.ellipse(ex, ey, 6, 2.4, -0.15, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#140c08'
      c.beginPath()
      c.ellipse(ex - 5, ey + 0.6, 1.6, 1.8, -0.15, 0, Math.PI * 2)
      c.fill()
    }
    silhouette(body, 1.4)

    // ================================================================ pilot (3/4 view chibi)
    const hx = PILOT.x
    const hy = PILOT.y
    // cockpit well
    c.fillStyle = lin(c, 0, 53, 0, 62, [[0, '#2a070b'], [1, '#5a1218']])
    c.beginPath()
    c.ellipse(150, 58, 19, 4.6, 0, 0, Math.PI * 2)
    c.fill()
    // leather jacket shoulders
    const torso: Path = () => {
      c.beginPath()
      c.moveTo(131, 61)
      c.quadraticCurveTo(132, 47, 150, 46)
      c.quadraticCurveTo(168, 47, 169, 61)
      c.closePath()
    }
    torso()
    c.fillStyle = rad(c, 158, 50, 1, 20, [[0, '#c68b52'], [0.6, '#8f5a2e'], [1, '#5e3616']])
    c.fill()
    // head group is drawn 1.28x (chibi proportions), anchored at the neck
    c.save()
    c.translate(hx, hy + 12)
    c.scale(1.28, 1.28)
    c.translate(-hx, -(hy + 12))
    // face
    const face: Path = () => {
      c.beginPath()
      c.moveTo(hx - 11, hy - 2)
      c.bezierCurveTo(hx - 12, hy + 8, hx - 6, hy + 14, hx + 2, hy + 14)
      c.bezierCurveTo(hx + 10, hy + 14, hx + 14.5, hy + 8, hx + 14.5, hy)
      c.bezierCurveTo(hx + 14.5, hy - 10, hx + 6, hy - 15, hx - 1, hy - 15)
      c.bezierCurveTo(hx - 8, hy - 15, hx - 11, hy - 10, hx - 11, hy - 2)
      c.closePath()
    }
    face()
    c.fillStyle = rad(c, hx + 6, hy - 4, 1, 22, [[0, '#ffe6d2'], [0.45, '#ffcfa8'], [1, '#e99a6c']])
    c.fill()
    clipTo(face, () => {
      ellipseGlow(hx + 8, hy + 5.5, 4, 2.6, 'rgba(255,110,100,.45)')
      ellipseGlow(hx - 5, hy + 5, 3.4, 2.4, 'rgba(255,110,100,.35)')
    })
    rolloff(face, 'rgba(170,80,50,.35)', 3)
    // nose (3/4, on the right edge)
    c.fillStyle = rad(c, hx + 14.5, hy + 2, 0.3, 3.4, [[0, '#ffe2cc'], [1, '#f0aa7c']])
    c.beginPath()
    c.ellipse(hx + 14.6, hy + 2.6, 2.6, 2.3, 0, 0, Math.PI * 2)
    c.fill()
    // grin with teeth
    c.beginPath()
    c.moveTo(hx + 1.6, hy + 6.8)
    c.quadraticCurveTo(hx + 8, hy + 14.6, hx + 13.6, hy + 6.2)
    c.quadraticCurveTo(hx + 8, hy + 8.6, hx + 1.6, hy + 6.8)
    c.closePath()
    c.fillStyle = '#6e1a1c'
    c.fill()
    c.save()
    c.clip()
    c.fillStyle = '#ffffff'
    c.fillRect(hx + 2, hy + 7, 12, 2.4)
    c.fillStyle = '#ff7f86'
    c.beginPath()
    c.ellipse(hx + 8.5, hy + 12, 3, 1.8, 0, 0, Math.PI * 2)
    c.fill()
    c.restore()
    // eyes: near eye larger, far eye foreshortened
    const eye = (x: number, y: number, rx: number, ry: number) => {
      c.fillStyle = '#ffffff'
      c.beginPath()
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = rad(c, x + rx * 0.25, y + ry * 0.1, 0.2, ry * 0.8, [[0, '#6b4a2a'], [1, '#2a1a0e']])
      c.beginPath()
      c.ellipse(x + rx * 0.28, y + ry * 0.12, rx * 0.66, ry * 0.68, 0, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#ffffff'
      c.beginPath()
      c.arc(x + rx * 0.5, y - ry * 0.3, rx * 0.28, 0, Math.PI * 2)
      c.fill()
      c.beginPath()
      c.arc(x + rx * 0.05, y + ry * 0.35, rx * 0.13, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = 'rgba(60,30,15,.7)'
      c.lineWidth = 0.6
      c.beginPath()
      c.ellipse(x, y, rx, ry, 0, Math.PI * 1.2, Math.PI * 1.8)
      c.stroke()
    }
    eye(hx + 3.5, hy + 0.6, 3.1, 3.9)
    eye(hx + 11.2, hy + 0.2, 2.2, 3.5)
    // brows
    c.strokeStyle = '#7a3f18'
    c.lineWidth = 1.3
    c.beginPath()
    c.moveTo(hx + 0.6, hy - 4.6)
    c.quadraticCurveTo(hx + 3.4, hy - 7.6, hx + 6.4, hy - 5.6)
    c.moveTo(hx + 9.4, hy - 5.4)
    c.quadraticCurveTo(hx + 11.4, hy - 7.2, hx + 13.4, hy - 5.2)
    c.stroke()
    silhouette(face, 1, 'rgba(120,55,30,.75)')
    // leather helmet over the top and back of the head
    const helmet: Path = () => {
      c.beginPath()
      c.moveTo(hx - 13, hy + 5)
      c.bezierCurveTo(hx - 16, hy - 14, hx - 4, hy - 21, hx + 4, hy - 20)
      c.bezierCurveTo(hx + 13, hy - 19, hx + 17, hy - 12, hx + 15.5, hy - 6.5)
      c.quadraticCurveTo(hx + 5, hy - 10, hx - 4, hy - 6)
      c.quadraticCurveTo(hx - 7.5, hy - 2, hx - 7.5, hy + 6)
      c.quadraticCurveTo(hx - 10, hy + 9, hx - 13, hy + 5)
      c.closePath()
    }
    helmet()
    c.fillStyle = rad(c, hx + 3, hy - 16, 1, 22, [[0, '#dca36a'], [0.5, '#a8692f'], [1, '#6a3d18']])
    c.fill()
    clipTo(helmet, () => {
      c.strokeStyle = 'rgba(255,225,180,.55)'
      c.setLineDash([1.6, 1.8])
      c.lineWidth = 0.9
      c.beginPath()
      c.moveTo(hx - 9, hy + 2)
      c.bezierCurveTo(hx - 11, hy - 12, hx - 2, hy - 18, hx + 8, hy - 17)
      c.stroke()
      c.setLineDash([])
      specular(hx + 1, hy - 17, 6, 1.6, 0.45, -0.2)
    })
    rolloff(helmet, 'rgba(60,25,5,.35)', 3)
    silhouette(helmet, 1, 'rgba(60,25,8,.8)')
    // ear flap with buckle and chin strap
    c.fillStyle = rad(c, hx - 8, hy + 1, 0.5, 9, [[0, '#b57a42'], [1, '#6a3d18']])
    c.beginPath()
    c.ellipse(hx - 8.5, hy + 3, 3.8, 6.2, 0.1, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = 'rgba(60,25,8,.8)'
    c.lineWidth = 0.9
    c.stroke()
    c.fillStyle = '#f2c94c'
    c.fillRect(hx - 9.6, hy + 6.2, 2.4, 1.8)
    c.strokeStyle = '#5a3414'
    c.lineWidth = 1.1
    c.beginPath()
    c.moveTo(hx - 7, hy + 8)
    c.quadraticCurveTo(hx - 2, hy + 14.5, hx + 5, hy + 14.2)
    c.stroke()
    // hair tuft under the helmet
    c.fillStyle = '#e07b30'
    for (const [tx, ty, a] of [[hx + 11, hy - 6.5, 0.4], [hx + 13.5, hy - 5.5, 0.9], [hx + 8.5, hy - 7, 0]] as const) {
      c.save()
      c.translate(tx, ty)
      c.rotate(a)
      c.beginPath()
      c.moveTo(-1.6, 0)
      c.quadraticCurveTo(0, 4.2, 1.8, 0.4)
      c.closePath()
      c.fill()
      c.restore()
    }
    // goggles pushed up on the helmet (3/4: far lens smaller)
    c.strokeStyle = '#3e2410'
    c.lineWidth = 2.6
    c.beginPath()
    c.moveTo(hx - 12, hy - 5)
    c.quadraticCurveTo(hx - 2, hy - 14, hx + 16, hy - 11)
    c.stroke()
    const lens = (x: number, y: number, r: number) => {
      c.fillStyle = lin(c, x - r, y - r, x + r, y + r, [[0, '#fff1b0'], [0.5, '#e0a93a'], [1, '#8a5a12']])
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = rad(c, x - r * 0.3, y - r * 0.35, 0.3, r, [[0, '#e8fbff'], [0.4, '#7fd3f5'], [1, '#1f6fa8']])
      c.beginPath()
      c.arc(x, y, r * 0.74, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,.9)'
      c.lineWidth = 0.9
      c.beginPath()
      c.arc(x, y, r * 0.5, Math.PI * 1.1, Math.PI * 1.6)
      c.stroke()
      c.strokeStyle = 'rgba(60,35,5,.85)'
      c.lineWidth = 0.8
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.stroke()
    }
    lens(hx + 4.5, hy - 12.2, 5)
    lens(hx + 13.2, hy - 11, 3.9)
    c.restore()
    // fur collar
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      const fx = 137 + t * 26
      const fy = 51 - Math.sin(t * Math.PI) * 2.4
      c.fillStyle = rad(c, fx - 0.8, fy - 1, 0.3, 4.2, [[0, '#ffffff'], [0.7, '#f1e6d2'], [1, '#c9b89a']])
      c.beginPath()
      c.arc(fx, fy, 3.6, 0, Math.PI * 2)
      c.fill()
    }
    // cockpit rim in front of him
    c.strokeStyle = lin(c, 130, 0, 170, 0, [[0, '#3e220e'], [0.5, '#a5723f'], [1, '#3e220e']])
    c.lineWidth = 3.6
    c.beginPath()
    c.ellipse(150, 58, 19, 4.4, 0, Math.PI * 1.02, Math.PI * 1.98, true)
    c.stroke()
    // curved windscreen
    const glass: Path = () => {
      c.beginPath()
      c.moveTo(168, 58)
      c.quadraticCurveTo(169, 45, 177, 44)
      c.lineTo(182, 57)
      c.closePath()
    }
    glass()
    c.fillStyle = lin(c, 168, 44, 182, 58, [[0, 'rgba(235,252,255,.85)'], [1, 'rgba(110,190,235,.45)']])
    c.fill()
    specular(173, 50, 1, 4.5, 0.9, 0.3)
    silhouette(glass, 1.1, 'rgba(40,50,60,.85)')

    // ================================================================ horizontal stabiliser
    const stab: Path = () => {
      c.beginPath()
      c.moveTo(22, 92)
      c.bezierCurveTo(30, 85, 70, 84, 92, 88)
      c.bezierCurveTo(98, 90, 97, 95, 90, 96)
      c.bezierCurveTo(70, 99, 32, 98, 22, 92)
      c.closePath()
    }
    stab()
    c.fillStyle = '#e2232c'
    c.fill()
    clipTo(stab, () => {
      c.fillStyle = '#fff4e4'
      c.fillRect(20, 80, 10, 20)
      cover(lin(c, 0, 84, 0, 99, [[0, 'rgba(255,255,255,.4)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(50,0,20,.4)']]))
      specular(60, 86.4, 22, 1, 0.8)
    })
    silhouette(stab, 1.2)

    // ================================================================ landing gear (taildragger)
    const mw = MAIN_WHEEL
    const tw = TAIL_WHEEL
    const tyre = (x: number, y: number, r: number, far: boolean) => {
      c.fillStyle = rad(c, x - r * 0.3, y - r * 0.3, 1, r * 1.2, far ? [[0, '#3a3f46'], [1, '#050506']] : [[0, '#5a6069'], [0.6, '#22252b'], [1, '#08090b']])
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fill()
      if (far) return
      c.strokeStyle = 'rgba(255,255,255,.28)'
      c.lineWidth = 1.2
      c.beginPath()
      c.arc(x, y, r * 0.8, Math.PI * 1.1, Math.PI * 1.6)
      c.stroke()
      // red hub cap with a chrome centre
      c.fillStyle = rad(c, x - 1.5, y - 1.5, 0.5, r * 0.55, [[0, '#ff8a7a'], [1, '#a3121b']])
      c.beginPath()
      c.arc(x, y, r * 0.5, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = lin(c, 0, y - 2, 0, y + 2, [[0, '#ffffff'], [1, '#8a939c']])
      c.beginPath()
      c.arc(x, y, r * 0.2, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = OUT
      c.lineWidth = 1.2
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.stroke()
    }
    const leg = (x0: number, y0: number, x1: number, y1: number, w: number) => {
      c.strokeStyle = 'rgba(40,45,55,.9)'
      c.lineWidth = w + 1.4
      c.beginPath()
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
      c.stroke()
      c.strokeStyle = lin(c, x0 - w, 0, x0 + w, 0, [[0, '#8793a0'], [0.5, '#f4f7fa'], [1, '#7a8693']])
      c.lineWidth = w
      c.beginPath()
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
      c.stroke()
    }
    // far main wheel (slightly behind and darker), then the legs and the near wheel
    tyre(mw.x - 5, mw.y - 1.5, mw.r * 0.92, true)
    leg(194, 112, mw.x - 1, mw.y, 3.6)
    leg(214, 114, mw.x + 1, mw.y, 2.6)
    tyre(mw.x, mw.y, mw.r, false)
    // tail wheel on a small fork
    leg(56, 98, tw.x, tw.y, 2.2)
    tyre(tw.x, tw.y, tw.r, false)

    // ================================================================ low wing (near side, in front)
    const wing: Path = () => {
      c.beginPath()
      c.moveTo(114, 110)
      c.bezierCurveTo(138, 99, 190, 97, 210, 102)
      c.bezierCurveTo(221, 105, 221, 116, 208, 119)
      c.bezierCurveTo(180, 124, 138, 121, 114, 114)
      c.quadraticCurveTo(110, 112, 114, 110)
      c.closePath()
    }
    // soft contact shadow of the wing on the fuselage
    clipTo(body, () => ellipseGlow(166, 110, 58, 9, 'rgba(60,0,20,.35)'))
    wing()
    c.fillStyle = '#f5ecdc'
    c.fill()
    clipTo(wing, () => {
      c.fillStyle = '#e2232c'
      c.fillRect(186, 90, 40, 40)
      c.fillStyle = '#1f3f7a'
      c.fillRect(182, 90, 3, 40)
      cover(lin(c, 0, 98, 0, 122, [[0, 'rgba(255,255,255,.55)'], [0.35, 'rgba(255,255,255,0)'], [0.7, 'rgba(60,20,20,.18)'], [1, 'rgba(40,10,20,.42)']]))
      specular(170, 101.2, 34, 1.5, 0.9, -0.02)
      specular(212, 106, 1.8, 4, 0.7, -0.3)
      // wing roundel
      for (const [r, col] of [[5.6, '#1f3f7a'], [3.9, '#fff4e4'], [2.1, '#e2232c']] as const) {
        c.fillStyle = col
        c.beginPath()
        c.ellipse(150, 110, r * 1.5, r * 0.75, 0, 0, Math.PI * 2)
        c.fill()
      }
    })
    rolloff(wing, 'rgba(90,60,40,.3)', 3.5)
    silhouette(wing, 1.2, 'rgba(90,40,30,.8)')
  }, PLANE_RES)
}

function spinner(): Texture {
  return paint(32, 40, (c) => {
    const cone = () => {
      c.beginPath()
      c.moveTo(1, 4)
      c.bezierCurveTo(18, 5, 29, 14, 30, 20)
      c.bezierCurveTo(29, 26, 18, 35, 1, 36)
      c.closePath()
    }
    cone()
    c.fillStyle = '#e2232c'
    c.fill()
    c.save()
    cone()
    c.clip()
    c.fillStyle = '#fff4e4'
    c.fillRect(0, 0, 5, 40)
    c.fillStyle = lin(c, 0, 4, 0, 36, [[0, 'rgba(255,255,255,.45)'], [0.35, 'rgba(0,0,0,0)'], [1, 'rgba(50,0,20,.5)']])
    c.fillRect(0, 0, 32, 40)
    c.fillStyle = 'rgba(255,255,255,.9)'
    c.beginPath()
    c.ellipse(13, 11.5, 9, 1.8, 0.2, 0, Math.PI * 2)
    c.fill()
    cone()
    c.strokeStyle = 'rgba(60,0,20,.35)'
    c.lineWidth = 4
    c.stroke()
    c.restore()
    cone()
    c.strokeStyle = OUT
    c.lineWidth = 1.3
    c.stroke()
  }, PLANE_RES)
}

function propDisc(): Texture {
  return paint(26, 96, (c) => {
    c.fillStyle = rad(c, 13, 48, 2, 48, [
      [0, 'rgba(255,255,255,.55)'],
      [0.6, 'rgba(200,210,220,.28)'],
      [0.92, 'rgba(160,170,180,.18)'],
      [1, 'rgba(160,170,180,0)']
    ])
    c.save()
    c.scale(0.27, 1)
    c.beginPath()
    c.arc(13 / 0.27, 48, 47, 0, Math.PI * 2)
    c.restore()
    c.fill()
  })
}

function propBlade(): Texture {
  return paint(14, 100, (c) => {
    const blade = (y0: number, y1: number) => {
      const m = y0 + (y1 - y0) * 0.45
      c.beginPath()
      c.moveTo(7, y0)
      c.quadraticCurveTo(13.5, m, 8.4, y1)
      c.lineTo(5.6, y1)
      c.quadraticCurveTo(0.5, m, 7, y0)
      c.closePath()
    }
    for (const [y0, y1] of [[2, 48], [98, 52]] as const) {
      blade(y0, y1)
      c.fillStyle = lin(c, 0, 0, 14, 0, [[0, '#3c4550'], [0.45, '#c9d2dc'], [0.6, '#8d99a6'], [1, '#2c333b']])
      c.fill()
      c.save()
      blade(y0, y1)
      c.clip()
      c.fillStyle = '#ffd24a'
      c.fillRect(0, y0 < y1 ? y0 - 1 : y0 - 7, 14, 8)
      c.fillStyle = '#e2232c'
      c.fillRect(0, y0 < y1 ? y0 + 7 : y0 - 10, 14, 3)
      c.restore()
      blade(y0, y1)
      c.strokeStyle = 'rgba(20,25,30,.6)'
      c.lineWidth = 0.9
      c.stroke()
    }
  }, PLANE_RES)
}

function scarf(): Texture {
  return paint(70, 24, (c) => {
    c.fillStyle = lin(c, 0, 0, 70, 0, [[0, '#fff3c4'], [0.6, '#ffd24a'], [1, '#f4a51c']])
    c.beginPath()
    c.moveTo(70, 6)
    c.bezierCurveTo(50, 2, 30, 14, 4, 6)
    c.lineTo(0, 12)
    c.lineTo(8, 14)
    c.lineTo(2, 20)
    c.bezierCurveTo(30, 22, 50, 14, 70, 16)
    c.closePath()
    c.fill()
    c.strokeStyle = 'rgba(150,80,0,.4)'
    c.lineWidth = 1
    c.stroke()
  })
}

// ---------------------------------------------------------------- carrier

export const CARRIER_W = 1200
export const CARRIER_H = 380
/** Deck surface y in carrier canvas space. */
export const CARRIER_DECK_Y = 196
/** Waterline y in carrier canvas space. */
export const CARRIER_WATER_Y = 360

function carrier(): Texture {
  return paint(CARRIER_W, CARRIER_H, (c) => {
    const D = CARRIER_DECK_Y
    // island superstructure (behind deck edge)
    const tx = 130
    c.fillStyle = lin(c, tx, 0, tx + 150, 0, [[0, '#6f7c89'], [0.5, '#98a5b1'], [1, '#56626e']])
    c.beginPath()
    c.moveTo(tx, D)
    c.lineTo(tx + 10, D - 70)
    c.lineTo(tx + 140, D - 70)
    c.lineTo(tx + 160, D)
    c.closePath()
    c.fill()
    c.fillStyle = lin(c, 0, D - 110, 0, D - 70, [[0, '#a7b3be'], [1, '#6f7c89']])
    c.beginPath()
    c.moveTo(tx + 20, D - 70)
    c.lineTo(tx + 26, D - 108)
    c.lineTo(tx + 128, D - 108)
    c.lineTo(tx + 134, D - 70)
    c.closePath()
    c.fill()
    // bridge windows (warm glow)
    for (let i = 0; i < 8; i++) {
      c.fillStyle = lin(c, 0, D - 100, 0, D - 90, [[0, '#fff3c0'], [1, '#f0a940']])
      c.fillRect(tx + 32 + i * 12, D - 100, 8, 8)
    }
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 9; i++) {
        c.fillStyle = 'rgba(20,32,44,.8)'
        c.fillRect(tx + 22 + i * 13, D - 58 + r * 20, 8, 6)
      }
    // mast
    c.strokeStyle = '#4e5a66'
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(tx + 78, D - 108)
    c.lineTo(tx + 78, D - 175)
    c.stroke()
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(tx + 58, D - 150)
    c.lineTo(tx + 98, D - 150)
    c.moveTo(tx + 64, D - 132)
    c.lineTo(tx + 92, D - 132)
    c.stroke()
    // number plate on island
    c.font = `34px ${FONT}`
    c.fillStyle = '#f4f7fa'
    c.strokeStyle = '#26303a'
    c.lineWidth = 3
    c.strokeText('02', tx + 58, D - 18)
    c.fillText('02', tx + 58, D - 18)

    // hull
    const W = CARRIER_W
    c.beginPath()
    c.moveTo(20, D)
    c.lineTo(W - 20, D)
    c.bezierCurveTo(W - 40, D + 60, W - 120, CARRIER_WATER_Y - 40, W - 170, CARRIER_WATER_Y + 12)
    c.lineTo(52, CARRIER_WATER_Y + 12)
    c.lineTo(34, D + 30)
    c.closePath()
    c.fillStyle = lin(c, 0, D, 0, CARRIER_H, [
      [0, '#a9b4be'],
      [0.12, '#7f8c98'],
      [0.6, '#5a6672'],
      [1, '#343d46']
    ])
    c.fill()
    c.save()
    c.clip()
    // boot-topping (red antifouling) below waterline
    c.fillStyle = lin(c, 0, CARRIER_WATER_Y - 12, 0, CARRIER_WATER_Y + 12, [[0, '#c0282f'], [1, '#6a0c10']])
    c.fillRect(0, CARRIER_WATER_Y - 12, W, 30)
    c.fillStyle = '#1e242a'
    c.fillRect(0, CARRIER_WATER_Y - 15, W, 3)
    // water-darkened lower hull
    c.fillStyle = lin(c, 0, CARRIER_WATER_Y - 70, 0, CARRIER_WATER_Y - 12, [[0, 'rgba(10,30,50,0)'], [1, 'rgba(10,30,50,.35)']])
    c.fillRect(0, CARRIER_WATER_Y - 70, W, 58)
    // portholes + hangar opening
    c.fillStyle = 'rgba(25,32,40,.85)'
    for (let i = 0; i < 34; i++) {
      c.beginPath()
      c.arc(90 + i * 30, D + 44, 3, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = lin(c, 0, D + 70, 0, D + 120, [[0, '#1c232a'], [1, '#39434d']])
    c.fillRect(420, D + 70, 260, 46)
    c.fillStyle = 'rgba(255,210,120,.5)'
    for (let i = 0; i < 6; i++) c.fillRect(434 + i * 42, D + 78, 22, 4)
    // hull number
    c.font = `60px ${FONT}`
    c.fillStyle = 'rgba(244,247,250,.92)'
    c.fillText('02', W - 290, D + 110)
    // top rim light
    c.fillStyle = 'rgba(255,255,255,.35)'
    c.fillRect(0, D, W, 3)
    // weathering streaks
    const r = prng(9)
    c.strokeStyle = 'rgba(40,30,20,.12)'
    c.lineWidth = 2
    for (let i = 0; i < 40; i++) {
      const x = r() * W
      c.beginPath()
      c.moveTo(x, D + 20 + r() * 30)
      c.lineTo(x + 2, D + 80 + r() * 100)
      c.stroke()
    }
    c.restore()

    // flight deck slab
    c.fillStyle = lin(c, 0, D - 12, 0, D + 6, [[0, '#4b545d'], [1, '#2b3238']])
    c.beginPath()
    c.moveTo(0, D - 10)
    c.lineTo(W, D - 10)
    c.lineTo(W - 10, D + 6)
    c.lineTo(14, D + 6)
    c.closePath()
    c.fill()
    // deck markings
    c.fillStyle = '#f7f7f2'
    for (let x = 340; x < W - 60; x += 46) c.fillRect(x, D - 6, 24, 2.5)
    c.fillStyle = '#ffcc2e'
    c.fillRect(300, D - 10, W - 330, 1.6)
    // deck lights
    for (let x = 320; x < W - 40; x += 58) {
      c.fillStyle = rad(c, x, D - 10, 0, 6, [[0, 'rgba(255,255,220,1)'], [1, 'rgba(255,200,80,0)']])
      c.beginPath()
      c.arc(x, D - 10, 6, 0, Math.PI * 2)
      c.fill()
    }
    // safety nets
    c.strokeStyle = 'rgba(30,36,40,.8)'
    c.lineWidth = 1
    for (let x = 10; x < W - 30; x += 8) {
      c.beginPath()
      c.moveTo(x, D + 6)
      c.lineTo(x + 5, D + 13)
      c.stroke()
    }
  })
}

function radar(): Texture {
  return paint(60, 18, (c) => {
    c.fillStyle = lin(c, 0, 0, 0, 18, [[0, '#dfe6ec'], [1, '#6a7682']])
    rrect(c, 0, 0, 60, 10, 4)
    c.fill()
    c.fillStyle = '#4e5a66'
    c.fillRect(27, 9, 6, 9)
  })
}


// ---------------------------------------------------------------- foliage & rocks

type Rnd = () => number

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function mixHex(a: string, b: string, t: number) {
  const A = hexRgb(a)
  const B = hexRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${A.map((v, i) => Math.round(v + (B[i]! - v) * k)).join(',')})`
}

/** Pointed leaf path (base at x,y) along angle `ang`. */
function leafPath(c: Ctx, x: number, y: number, len: number, wid: number, ang: number) {
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const P = (u: number, v: number) => [x + u * ca - v * sa, y + u * sa + v * ca] as const
  const [mx1, my1] = P(len * 0.45, -wid)
  const [ex, ey] = P(len, 0)
  const [mx2, my2] = P(len * 0.45, wid)
  c.beginPath()
  c.moveTo(x, y)
  c.quadraticCurveTo(mx1, my1, ex, ey)
  c.quadraticCurveTo(mx2, my2, x, y)
  c.closePath()
}

/** Tropical bush: dark core, three layers of pointed leaves fanning up and out, lit from the upper right. */
function tropicalBush(c: Ctx, rnd: Rnd, x: number, y: number, size: number, flowers = false) {
  c.fillStyle = 'rgba(30,20,8,.3)'
  c.beginPath()
  c.ellipse(x + size * 0.12, y + 1, size * 1.3, size * 0.26, 0, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#1b4520'
  c.beginPath()
  c.ellipse(x, y - size * 0.32, size * 0.8, size * 0.42, 0, 0, Math.PI * 2)
  c.fill()
  const layers: { dark: string; light: string; n: number; len: number; arc: number; lift: number }[] = [
    { dark: '#173f1c', light: '#2d6c2c', n: 15, len: 1.0, arc: 1.0, lift: 0.1 },
    { dark: '#2a6d2c', light: '#4c9c3e', n: 12, len: 0.82, arc: 0.82, lift: 0.22 },
    { dark: '#43933a', light: '#8fd865', n: 9, len: 0.62, arc: 0.62, lift: 0.34 }
  ]
  const L = { x: 0.62, y: -0.78 }
  for (const ly of layers)
    for (let i = 0; i < ly.n; i++) {
      const t = i / (ly.n - 1)
      const ang = -Math.PI / 2 + (t - 0.5) * (Math.PI - 0.35) * ly.arc + (rnd() - 0.5) * 0.22
      const len = size * ly.len * (0.72 + rnd() * 0.4) * (0.82 + 0.25 * Math.sin(t * Math.PI))
      const ox = x + (rnd() - 0.5) * size * 0.45
      const oy = y - size * ly.lift
      const lit = (Math.cos(ang) * L.x + Math.sin(ang) * L.y + 1) / 2
      const tipX = ox + Math.cos(ang) * len
      const tipY = oy + Math.sin(ang) * len
      c.fillStyle = lin(c, ox, oy, tipX, tipY, [[0, ly.dark], [1, mixHex(ly.dark, ly.light, 0.35 + lit * 0.65)]])
      leafPath(c, ox, oy, len, len * 0.2, ang)
      c.fill()
      c.strokeStyle = 'rgba(255,255,230,.18)'
      c.lineWidth = 0.7
      c.beginPath()
      c.moveTo(ox, oy)
      c.lineTo(ox + Math.cos(ang) * len * 0.85, oy + Math.sin(ang) * len * 0.85)
      c.stroke()
    }
  if (flowers)
    for (let f = 0; f < 3 + Math.floor(rnd() * 3); f++) {
      const fx = x + (rnd() - 0.5) * size * 1.3
      const fy = y - size * (0.35 + rnd() * 0.45)
      const r = size * 0.1 + rnd() * 1.5
      const col = rnd() < 0.5 ? '#ff4d6d' : '#ff8fb1'
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + f
        c.fillStyle = col
        c.beginPath()
        c.ellipse(fx + Math.cos(a) * r * 0.7, fy + Math.sin(a) * r * 0.7, r * 0.75, r * 0.45, a, 0, Math.PI * 2)
        c.fill()
      }
      c.fillStyle = '#ffe066'
      c.beginPath()
      c.arc(fx, fy, r * 0.35, 0, Math.PI * 2)
      c.fill()
    }
}

/** Fern: arching fronds with leaflets that shrink toward the tip. */
function fern(c: Ctx, rnd: Rnd, x: number, y: number, size: number) {
  const n = 6
  for (let f = 0; f < n; f++) {
    const ang = -Math.PI / 2 + (f / (n - 1) - 0.5) * 2.3 + (rnd() - 0.5) * 0.15
    const len = size * (0.8 + rnd() * 0.35)
    const cx = x + Math.cos(ang) * len * 0.55
    const cy = y - len * 0.75
    const ex = x + Math.cos(ang) * len * 1.05
    const ey = y + Math.sin(ang) * len * 0.35 - len * 0.05
    const lit = Math.cos(ang) > 0
    c.strokeStyle = '#2c6a2a'
    c.lineWidth = 1.2
    c.beginPath()
    c.moveTo(x, y)
    c.quadraticCurveTo(cx, cy, ex, ey)
    c.stroke()
    for (let t = 0.12; t < 0.98; t += 0.075) {
      const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * ex
      const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * ey
      const tx = 2 * (1 - t) * (cx - x) + 2 * t * (ex - cx)
      const ty = 2 * (1 - t) * (cy - y) + 2 * t * (ey - cy)
      const ta = Math.atan2(ty, tx)
      const ll = size * 0.26 * (1 - t * 0.75)
      c.fillStyle = lit ? (t < 0.5 ? '#4fa844' : '#86d15e') : t < 0.5 ? '#2f7a31' : '#4c9a40'
      for (const side of [-1, 1]) {
        leafPath(c, px, py, ll, ll * 0.28, ta + side * 1.15)
        c.fill()
      }
    }
  }
}

/** Faceted low-poly boulder lit from the upper right, with moss and cracks. */
function boulder(c: Ctx, rnd: Rnd, x: number, y: number, w: number, h: number, moss = true) {
  const n = 7 + Math.floor(rnd() * 3)
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI
    const rr = i === 0 || i === n - 1 ? 1 : 0.78 + rnd() * 0.3
    pts.push([x + Math.cos(a) * w * rr, y + Math.sin(a) * h * rr])
  }
  pts[0]![1] = y
  pts[n - 1]![1] = y
  // contact shadow
  c.fillStyle = 'rgba(30,20,8,.35)'
  c.beginPath()
  c.ellipse(x + w * 0.15, y + 1.5, w * 1.2, h * 0.16 + 2, 0, 0, Math.PI * 2)
  c.fill()
  const q: [number, number] = [x - w * 0.12 + (rnd() - 0.5) * w * 0.15, y - h * 0.5]
  const light = '#e4d7bf'
  const mid = '#a4917a'
  const dark = '#4f4234'
  const L = { x: 0.6, y: -0.8 }
  // front face (faces the viewer): mid tone, darker at the base
  c.fillStyle = lin(c, 0, q[1], 0, y, [[0, mid], [1, dark]])
  c.beginPath()
  c.moveTo(pts[0]![0], pts[0]![1])
  c.lineTo(q[0], q[1])
  c.lineTo(pts[n - 1]![0], pts[n - 1]![1])
  c.closePath()
  c.fill()
  // facets around the top
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = pts[i]!
    const [bx, by] = pts[i + 1]!
    const mx = (ax + bx) / 2 - q[0]
    const my = (ay + by) / 2 - q[1]
    const len = Math.hypot(mx, my) || 1
    const b = (mx / len) * L.x + (my / len) * L.y
    c.fillStyle = b > 0 ? mixHex(mid, light, b) : mixHex(mid, dark, -b * 0.9)
    c.beginPath()
    c.moveTo(q[0], q[1])
    c.lineTo(ax, ay)
    c.lineTo(bx, by)
    c.closePath()
    c.fill()
    c.strokeStyle = 'rgba(255,250,235,.16)'
    c.lineWidth = 0.8
    c.beginPath()
    c.moveTo(q[0], q[1])
    c.lineTo(ax, ay)
    c.stroke()
  }
  // outline, moss, cracks (clipped to the stone)
  c.save()
  c.beginPath()
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
  c.closePath()
  c.strokeStyle = 'rgba(40,30,20,.55)'
  c.lineWidth = 1.2
  c.stroke()
  c.clip()
  if (moss)
    for (let k = 0; k < 4; k++) {
      const i = 1 + Math.floor(rnd() * (n - 2))
      const [px, py] = pts[i]!
      c.fillStyle = k % 2 ? 'rgba(96,160,64,.8)' : 'rgba(62,120,50,.8)'
      c.beginPath()
      c.ellipse(px + (rnd() - 0.5) * 6, py + 2, w * 0.18 + rnd() * 3, h * 0.1 + 1.5, 0, 0, Math.PI * 2)
      c.fill()
    }
  c.strokeStyle = 'rgba(40,28,18,.55)'
  c.lineWidth = 1
  for (let k = 0; k < 2; k++) {
    let cx = x + (rnd() - 0.3) * w * 0.8
    let cy = y - h * (0.5 + rnd() * 0.4)
    c.beginPath()
    c.moveTo(cx, cy)
    for (let s2 = 0; s2 < 3; s2++) {
      cx += (rnd() - 0.5) * w * 0.25
      cy += h * 0.18
      c.lineTo(cx, cy)
    }
    c.stroke()
  }
  c.restore()
}

function pebbles(c: Ctx, rnd: Rnd, x: number, y: number, spread: number) {
  for (let i = 0; i < 4; i++) {
    const px = x + (rnd() - 0.5) * spread
    const r = 2 + rnd() * 3
    c.fillStyle = rad(c, px - r * 0.3, y - r * 0.6, 0.5, r * 1.4, [[0, '#e8dcc6'], [1, '#7a6a55']])
    c.beginPath()
    c.ellipse(px, y - r * 0.4, r * 1.2, r * 0.8, 0, 0, Math.PI * 2)
    c.fill()
  }
}

// ---------------------------------------------------------------- island

export const ISLAND_W = 1400
export const ISLAND_H = 460
/** Runway surface y in island canvas space. */
export const ISLAND_RUNWAY_Y = 318
export const ISLAND_RUNWAY_X0 = 250
export const ISLAND_RUNWAY_X1 = 1180
export const ISLAND_WATER_Y = 400

function island(): Texture {
  return paint(ISLAND_W, ISLAND_H, (c) => {
    const R = ISLAND_RUNWAY_Y
    const W = ISLAND_W
    const rnd = prng(42)
    // cliff / rock mass
    c.beginPath()
    c.moveTo(0, ISLAND_WATER_Y + 30)
    c.bezierCurveTo(20, ISLAND_WATER_Y - 6, 50, R + 30, 100, R + 8)
    c.lineTo(W - 100, R + 8)
    c.bezierCurveTo(W - 50, R + 30, W - 20, ISLAND_WATER_Y - 6, W, ISLAND_WATER_Y + 30)
    c.lineTo(W, ISLAND_H)
    c.lineTo(0, ISLAND_H)
    c.closePath()
    c.fillStyle = lin(c, 0, R, 0, ISLAND_H, [[0, '#b58a5a'], [0.35, '#8c6440'], [0.7, '#5d4029'], [1, '#3a2718']])
    c.fill()
    c.save()
    c.clip()
    // rock strata
    for (let i = 0; i < 60; i++) {
      const x = rnd() * W
      const y = R + 16 + rnd() * 70
      c.fillStyle = `rgba(${rnd() < 0.5 ? '255,230,190' : '40,24,12'},${0.08 + rnd() * 0.1})`
      c.beginPath()
      c.ellipse(x, y, 30 + rnd() * 70, 6 + rnd() * 10, 0, 0, Math.PI * 2)
      c.fill()
    }
    // sand beach sloping into the water
    c.fillStyle = lin(c, 0, ISLAND_WATER_Y - 34, 0, ISLAND_WATER_Y, [[0, '#ffe7a8'], [1, '#e2b862']])
    c.beginPath()
    c.moveTo(0, ISLAND_WATER_Y + 4)
    c.bezierCurveTo(200, ISLAND_WATER_Y - 24, 500, ISLAND_WATER_Y - 34, 700, ISLAND_WATER_Y - 32)
    c.bezierCurveTo(900, ISLAND_WATER_Y - 34, 1200, ISLAND_WATER_Y - 24, W, ISLAND_WATER_Y + 4)
    c.lineTo(W, ISLAND_H)
    c.lineTo(0, ISLAND_H)
    c.closePath()
    c.fill()
    // submerged base: sea colour over everything below the waterline
    c.fillStyle = lin(c, 0, ISLAND_WATER_Y, 0, ISLAND_H, [[0, 'rgba(40,150,200,.75)'], [0.4, 'rgba(14,90,150,.95)'], [1, 'rgba(8,60,110,1)']])
    c.fillRect(0, ISLAND_WATER_Y, W, ISLAND_H - ISLAND_WATER_Y)
    // fade the submerged base out so it melts into the sea on tall screens
    c.save()
    c.globalCompositeOperation = 'destination-out'
    c.fillStyle = lin(c, 0, ISLAND_WATER_Y + 10, 0, ISLAND_H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']])
    c.fillRect(0, ISLAND_WATER_Y + 10, W, ISLAND_H - ISLAND_WATER_Y - 10)
    c.restore()
    c.fillStyle = 'rgba(255,255,255,.75)'
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W
      c.beginPath()
      c.ellipse(x, ISLAND_WATER_Y + 2 + rnd() * 6, 6 + rnd() * 18, 1.5 + rnd() * 2, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()

    // grass plateau
    c.beginPath()
    c.moveTo(88, R + 24)
    c.bezierCurveTo(92, R - 8, 120, R - 16, 170, R - 14)
    c.lineTo(W - 170, R - 14)
    c.bezierCurveTo(W - 120, R - 16, W - 92, R - 8, W - 88, R + 24)
    c.bezierCurveTo(W - 300, R + 42, 300, R + 42, 88, R + 24)
    c.fillStyle = lin(c, 0, R - 16, 0, R + 36, [[0, '#9be15d'], [0.5, '#4cae3a'], [1, '#2a7a2a']])
    c.fill()
    // grass blades along the lip and a soft light band
    c.fillStyle = lin(c, 0, R - 14, 0, R - 4, [[0, 'rgba(230,255,180,.55)'], [1, 'rgba(230,255,180,0)']])
    c.fillRect(110, R - 14, W - 220, 10)
    c.lineWidth = 1.4
    for (let i = 0; i < 420; i++) {
      const x = 96 + rnd() * (W - 192)
      const y = R + 14 + rnd() * 18
      const hgt = 4 + rnd() * 7
      c.strokeStyle = rnd() < 0.55 ? 'rgba(40,120,40,.7)' : 'rgba(170,235,110,.7)'
      c.beginPath()
      c.moveTo(x, y)
      c.quadraticCurveTo(x + (rnd() - 0.5) * 4, y - hgt * 0.6, x + (rnd() - 0.5) * 6, y - hgt)
      c.stroke()
    }

    // foliage at the palm bases on the plateau, clear of the runway
    tropicalBush(c, rnd, 122, R + 26, 26, true)
    fern(c, rnd, 186, R + 28, 22)
    boulder(c, rnd, 232, R + 28, 14, 11)
    tropicalBush(c, rnd, 1238, R + 26, 24)
    fern(c, rnd, 1272, R + 28, 20)

    // rock-and-foliage groups on the beach, drawn after the grass so the lip never cuts them off
    const beachTop = (x: number) => ISLAND_WATER_Y + 4 - 36 * Math.sin((Math.PI * x) / W)
    const groups: [number, 'a' | 'b' | 'c'][] = [
      [70, 'b'], [230, 'a'], [420, 'c'], [610, 'a'], [800, 'b'], [990, 'c'], [1160, 'a'], [1330, 'b']
    ]
    for (const [gx, kind] of groups) {
      const gy = Math.min(beachTop(gx) + 3, ISLAND_WATER_Y - 4)
      if (kind === 'a') {
        tropicalBush(c, rnd, gx - 22, gy - 2, 30 + rnd() * 8, rnd() < 0.6)
        boulder(c, rnd, gx + 20, gy, 26 + rnd() * 8, 22 + rnd() * 6)
        fern(c, rnd, gx + 50, gy + 2, 18)
        pebbles(c, rnd, gx, gy + 3, 70)
      } else if (kind === 'b') {
        boulder(c, rnd, gx, gy, 38 + rnd() * 8, 30 + rnd() * 6)
        boulder(c, rnd, gx + 42, gy + 2, 16, 12, false)
        fern(c, rnd, gx - 38, gy + 2, 24)
        pebbles(c, rnd, gx + 10, gy + 4, 90)
      } else {
        tropicalBush(c, rnd, gx, gy - 2, 34 + rnd() * 6, true)
        fern(c, rnd, gx + 40, gy + 2, 22)
        boulder(c, rnd, gx - 42, gy + 2, 18, 14)
      }
    }

    // runway
    const x0 = ISLAND_RUNWAY_X0
    const x1 = ISLAND_RUNWAY_X1
    c.fillStyle = lin(c, 0, R - 8, 0, R + 10, [[0, '#6e747b'], [0.4, '#4a5057'], [1, '#2c3035']])
    c.beginPath()
    c.moveTo(x0, R - 8)
    c.lineTo(x1, R - 8)
    c.lineTo(x1 + 14, R + 8)
    c.lineTo(x0 - 14, R + 8)
    c.closePath()
    c.fill()
    c.fillStyle = '#f7f7f2'
    for (let x = x0 + 40; x < x1 - 40; x += 60) c.fillRect(x, R - 2, 34, 2.6)
    // threshold stripes
    for (let i = 0; i < 5; i++) c.fillRect(x0 + 6 + i * 7, R - 7, 4, 13)
    // runway edge lights
    for (let x = x0; x <= x1; x += 62) {
      c.fillStyle = rad(c, x, R - 8, 0, 7, [[0, 'rgba(255,255,230,1)'], [1, 'rgba(255,180,60,0)']])
      c.beginPath()
      c.arc(x, R - 8, 7, 0, Math.PI * 2)
      c.fill()
    }

    // hangar
    const hx = 980
    c.fillStyle = lin(c, 0, R - 110, 0, R - 10, [[0, '#f3efe6'], [1, '#b9b1a2']])
    c.beginPath()
    c.moveTo(hx, R - 12)
    c.lineTo(hx, R - 70)
    c.quadraticCurveTo(hx + 80, R - 130, hx + 160, R - 70)
    c.lineTo(hx + 160, R - 12)
    c.closePath()
    c.fill()
    c.fillStyle = lin(c, 0, R - 80, 0, R - 12, [[0, '#384048'], [1, '#1c2126']])
    c.fillRect(hx + 34, R - 64, 92, 52)
    c.fillStyle = '#d61d26'
    c.beginPath()
    c.moveTo(hx - 4, R - 68)
    c.quadraticCurveTo(hx + 80, R - 138, hx + 164, R - 68)
    c.lineTo(hx + 156, R - 64)
    c.quadraticCurveTo(hx + 80, R - 124, hx + 4, R - 64)
    c.closePath()
    c.fill()
    c.font = `20px ${FONT}`
    c.fillStyle = '#d61d26'
    c.fillText('AVIA', hx + 56, R - 70)

    // control tower
    const cx = 330
    c.fillStyle = lin(c, cx, 0, cx + 40, 0, [[0, '#f6f2ea'], [1, '#bdb5a5']])
    c.fillRect(cx, R - 120, 34, 108)
    c.fillStyle = '#d61d26'
    for (let i = 0; i < 3; i++) c.fillRect(cx, R - 100 + i * 30, 34, 10)
    c.fillStyle = lin(c, 0, R - 150, 0, R - 120, [[0, '#bff0ff'], [1, '#3a8fc0']])
    rrect(c, cx - 10, R - 150, 54, 30, 6)
    c.fill()
    c.fillStyle = '#2b3238'
    c.fillRect(cx - 14, R - 156, 62, 8)
    c.fillRect(cx - 12, R - 122, 58, 4)
  })
}

function palm(): Texture {
  return paint(180, 260, (c) => {
    // trunk
    c.lineWidth = 14
    c.strokeStyle = lin(c, 80, 0, 110, 0, [[0, '#6b4424'], [0.5, '#a8743f'], [1, '#5a371b']])
    c.beginPath()
    c.moveTo(96, 258)
    c.bezierCurveTo(104, 200, 80, 120, 92, 60)
    c.stroke()
    c.strokeStyle = 'rgba(60,30,10,.5)'
    c.lineWidth = 2
    for (let i = 0; i < 14; i++) {
      const t = i / 14
      const y = 250 - t * 185
      const x = 96 + Math.sin(t * 3) * -8
      c.beginPath()
      c.moveTo(x - 7, y)
      c.lineTo(x + 7, y - 4)
      c.stroke()
    }
    // fronds
    const frond = (ang: number, len: number) => {
      c.save()
      c.translate(92, 60)
      c.rotate(ang)
      c.fillStyle = lin(c, 0, -10, 0, 12, [[0, '#8fe06a'], [0.5, '#3c9e34'], [1, '#1f6a22']])
      c.beginPath()
      c.moveTo(0, 0)
      c.quadraticCurveTo(len * 0.5, -22, len, 10)
      c.quadraticCurveTo(len * 0.5, -4, 0, 6)
      c.closePath()
      c.fill()
      c.strokeStyle = 'rgba(20,70,20,.6)'
      c.lineWidth = 1.2
      c.beginPath()
      c.moveTo(0, 2)
      c.quadraticCurveTo(len * 0.5, -12, len, 10)
      c.stroke()
      c.restore()
    }
    for (const [a, l] of [
      [-2.6, 80], [-2.1, 88], [-1.5, 70], [-0.9, 88], [-0.4, 82], [0.3, 76], [2.9, 74], [0.9, 60]
    ] as const)
      frond(a, l)
    // coconuts
    for (const [x, y] of [[86, 66], [96, 68], [91, 72]] as const) {
      c.fillStyle = rad(c, x - 1, y - 1, 0, 6, [[0, '#8a5a30'], [1, '#3a2210']])
      c.beginPath()
      c.arc(x, y, 5, 0, Math.PI * 2)
      c.fill()
    }
  })
}

function flag(): Texture {
  return paint(64, 40, (c) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        c.fillStyle = (x + y) % 2 ? '#111' : '#fff'
        c.fillRect(x * 10 + 2, y * 9 + 2, 10, 9)
      }
    c.strokeStyle = 'rgba(0,0,0,.3)'
    c.strokeRect(2, 2, 60, 36)
  })
}

// ---------------------------------------------------------------- sky, clouds, backdrop

function sky(): Texture {
  return paint(4, 540, (c) => {
    c.fillStyle = lin(c, 0, 0, 0, 540, [
      [0, '#0d3f86'],
      [0.35, '#2f7fd0'],
      [0.62, '#79bdf0'],
      [0.8, '#c9e6f7'],
      [0.93, '#ffe9c9'],
      [1, '#ffd8a8']
    ])
    c.fillRect(0, 0, 4, 540)
  })
}

/** Base line of a cloud texture (for sprite anchoring). */
export const CLOUD_BASE = 0.8

function cloud(seed: number, w: number, h: number): Texture {
  // padded canvas: the puffs can grow well past w x h and must never be clipped
  return paint(w + h, h * 1.6, (c) => {
    c.translate(h / 2, h * 0.6)
    const r = prng(seed)
    const blobs: [number, number, number][] = []
    const n = 9 + Math.floor(r() * 6)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const x = w * 0.12 + t * w * 0.76 + (r() - 0.5) * w * 0.08
      const bulge = Math.sin(t * Math.PI)
      const rr = h * (0.18 + bulge * 0.22 + r() * 0.1)
      const y = h * 0.72 - rr * 0.55 - bulge * h * 0.12
      blobs.push([x, y, rr])
    }
    // underside shadow body
    for (const [x, y, rr] of blobs) {
      c.fillStyle = rad(c, x, y + rr * 0.3, rr * 0.2, rr * 1.05, [
        [0, 'rgba(196,214,236,1)'],
        [0.85, 'rgba(176,198,226,1)'],
        [1, 'rgba(176,198,226,0)']
      ])
      c.beginPath()
      c.arc(x, y + rr * 0.3, rr * 1.05, 0, Math.PI * 2)
      c.fill()
    }
    // lit tops
    for (const [x, y, rr] of blobs) {
      c.fillStyle = rad(c, x - rr * 0.25, y - rr * 0.35, rr * 0.1, rr * 0.95, [
        [0, 'rgba(255,255,255,1)'],
        [0.7, 'rgba(250,252,255,.95)'],
        [1, 'rgba(240,246,255,0)']
      ])
      c.beginPath()
      c.arc(x, y - rr * 0.05, rr * 0.92, 0, Math.PI * 2)
      c.fill()
    }
    // flat base
    c.globalCompositeOperation = 'destination-out'
    c.fillStyle = lin(c, 0, h * 0.74, 0, h, [[0, 'rgba(0,0,0,0)'], [0.4, 'rgba(0,0,0,1)']])
    c.fillRect(-h / 2, h * 0.74, w + h, h)
  })
}

/** Seamless ridge line: integer wave counts over the texture width so both ends match. */
function makeRidge(W: number, base: number, waves: [number, number][], seed: number) {
  const r = prng(seed)
  const ph = waves.map(() => r() * Math.PI * 2)
  return (x: number) => base - waves.reduce((acc, [k, a], i) => acc + a * (0.5 + 0.5 * Math.sin((2 * Math.PI * k * x) / W + ph[i]!)), 0)
}

// Backdrop: soft, flat 2D silhouettes in hazy blue/teal (like distant scenery seen through
// sea air). Every shape in a layer is filled with the same vertical gradient, so trees,
// huts and boats melt into their hills instead of adding detail and contrast.

/** Silhouette palm: tapered curved trunk and drooping blade fronds (current fill style). */
function palmShape(c: Ctx, rnd: Rnd, x: number, y: number, h: number, lean: number) {
  const topX = x + lean * h * 0.38
  const topY = y - h
  const cx = x + lean * h * 0.02
  const cy = y - h * 0.55
  const w0 = h * 0.045
  const w1 = h * 0.022
  c.beginPath()
  c.moveTo(x - w0, y + 2)
  c.quadraticCurveTo(cx - (w0 + w1) / 2, cy, topX - w1, topY)
  c.lineTo(topX + w1, topY)
  c.quadraticCurveTo(cx + (w0 + w1) / 2, cy, x + w0, y + 2)
  c.closePath()
  c.fill()
  const n = 7
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * Math.PI * 1.7 + (rnd() - 0.5) * 0.2
    const len = h * (0.4 + rnd() * 0.12)
    const ex = topX + Math.cos(ang) * len
    const ey = topY + Math.sin(ang) * len * 0.6 + len * 0.45
    const mx = topX + Math.cos(ang) * len * 0.55
    const my = topY + Math.sin(ang) * len * 0.55 - len * 0.15
    // blade: offset the spine on both sides by a width that swells and tapers
    const side = (sgn: number) => {
      const pts: [number, number][] = []
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const px = (1 - t) * (1 - t) * topX + 2 * (1 - t) * t * mx + t * t * ex
        const py = (1 - t) * (1 - t) * topY + 2 * (1 - t) * t * my + t * t * ey
        const tx = 2 * (1 - t) * (mx - topX) + 2 * t * (ex - mx)
        const ty = 2 * (1 - t) * (my - topY) + 2 * t * (ey - my)
        const l = Math.hypot(tx, ty) || 1
        const w = h * 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (sgn > 0 ? 1 : 0.6)
        pts.push([px - (ty / l) * w * sgn, py + (tx / l) * w * sgn])
      }
      return pts
    }
    const a = side(1)
    const b = side(-1).reverse()
    c.beginPath()
    ;[...a, ...b].forEach(([px, py], k) => (k ? c.lineTo(px, py) : c.moveTo(px, py)))
    c.closePath()
    c.fill()
  }
}

function roundTree(c: Ctx, rnd: Rnd, x: number, y: number, h: number) {
  c.fillRect(x - h * 0.035, y - h * 0.5, h * 0.07, h * 0.52)
  const n = 4 + Math.floor(rnd() * 3)
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI
    c.beginPath()
    c.arc(x + Math.cos(a) * h * 0.22, y - h * 0.6 + Math.sin(a) * h * 0.2, h * (0.2 + rnd() * 0.08), 0, Math.PI * 2)
    c.fill()
  }
  c.beginPath()
  c.arc(x, y - h * 0.66, h * 0.26, 0, Math.PI * 2)
  c.fill()
}

function lighthouseShape(c: Ctx, x: number, y: number, h: number) {
  c.beginPath()
  c.moveTo(x - h * 0.11, y)
  c.lineTo(x - h * 0.07, y - h * 0.78)
  c.lineTo(x + h * 0.07, y - h * 0.78)
  c.lineTo(x + h * 0.11, y)
  c.closePath()
  c.fill()
  c.fillRect(x - h * 0.12, y - h * 0.82, h * 0.24, h * 0.05) // gallery
  c.fillRect(x - h * 0.06, y - h * 0.94, h * 0.12, h * 0.12) // lamp room
  c.beginPath()
  c.moveTo(x - h * 0.09, y - h * 0.93)
  c.lineTo(x, y - h * 1.04)
  c.lineTo(x + h * 0.09, y - h * 0.93)
  c.closePath()
  c.fill()
}

function hutShape(c: Ctx, x: number, y: number, s: number) {
  c.fillRect(x - s * 0.45, y - s * 0.5, s * 0.08, s * 0.5)
  c.fillRect(x + s * 0.37, y - s * 0.5, s * 0.08, s * 0.5)
  c.fillRect(x - s * 0.5, y - s * 0.95, s, s * 0.5)
  c.beginPath()
  c.moveTo(x - s * 0.75, y - s * 0.9)
  c.lineTo(x, y - s * 1.55)
  c.lineTo(x + s * 0.75, y - s * 0.9)
  c.closePath()
  c.fill()
}

function sailboatShape(c: Ctx, x: number, y: number, s: number) {
  c.beginPath()
  c.moveTo(x - s * 0.6, y - s * 0.18)
  c.lineTo(x + s * 0.6, y - s * 0.18)
  c.lineTo(x + s * 0.42, y)
  c.lineTo(x - s * 0.45, y)
  c.closePath()
  c.fill()
  c.fillRect(x - s * 0.02, y - s * 1.25, s * 0.04, s * 1.1)
  c.beginPath()
  c.moveTo(x + s * 0.04, y - s * 1.2)
  c.lineTo(x + s * 0.5, y - s * 0.26)
  c.lineTo(x + s * 0.04, y - s * 0.26)
  c.closePath()
  c.fill()
  c.beginPath()
  c.moveTo(x - s * 0.04, y - s * 1.0)
  c.lineTo(x - s * 0.36, y - s * 0.26)
  c.lineTo(x - s * 0.04, y - s * 0.26)
  c.closePath()
  c.fill()
}

type Wrap = (fn: (dx: number) => void) => void

/** A flat, softly graded silhouette layer; `draw` adds the landforms and scenery. */
function flatLayer(W: number, H: number, top: string, bottom: string, seed: number, draw: (c: Ctx, r: Rnd, wrap: Wrap) => void): Texture {
  return paint(W, H, (c) => {
    const r = prng(seed)
    const g = lin(c, 0, 0, 0, H, [[0, top], [1, bottom]])
    c.fillStyle = g
    c.strokeStyle = g
    // every shape is also drawn one tile width left and right, so the strip loops seamlessly
    const wrap: Wrap = (fn) => [-W, 0, W].forEach(fn)
    draw(c, r, wrap)
    // soft haze where the land meets the sea
    c.globalCompositeOperation = 'source-atop'
    c.fillStyle = lin(c, 0, H * 0.5, 0, H, [[0, 'rgba(214,230,242,0)'], [1, 'rgba(214,230,242,.45)']])
    c.fillRect(0, 0, W, H)
  })
}

const landPath = (c: Ctx, W: number, H: number, ridge: (x: number) => number) => {
  c.beginPath()
  c.moveTo(0, H)
  for (let x = 0; x <= W; x += 4) c.lineTo(x, ridge(x))
  c.lineTo(W, H)
  c.closePath()
  c.fill()
}

/** Far: soft mountain range with a volcano trailing a lazy smoke plume. */
function farRange(): Texture {
  const W = 2600
  const H = 330
  return flatLayer(W, H, '#8fb0d8', '#b6cfe8', 61, (c, r, wrap) => {
    const ridge = makeRidge(W, 310, [[2, 60], [3, 55], [7, 30], [13, 10]], 61)
    landPath(c, W, H, ridge)
    // volcano: broad cone with a flat crater
    const vx = 1500
    const vb = ridge(vx) + 30
    const crater = 118
    wrap((dx) => {
      c.beginPath()
      c.moveTo(vx + dx - 260, vb)
      c.quadraticCurveTo(vx + dx - 90, vb - 120, vx + dx - 34, crater)
      c.lineTo(vx + dx + 30, crater + 2)
      c.quadraticCurveTo(vx + dx + 100, vb - 120, vx + dx + 270, vb)
      c.closePath()
      c.fill()
    })
    // smoke: many feathered puffs that rise, grow, drift away from the sun and fade out
    wrap((dx) => {
      for (let i = 0; i < 28; i++) {
        const t = i / 27
        const px = vx + dx - 2 - t * 200 + Math.sin(t * 7) * 9
        const py = crater - 6 - t * 64
        const pr = 10 + t * 40
        c.fillStyle = rad(c, px, py, 0, pr, [[0, `rgba(234,241,250,${0.3 - t * 0.24})`], [0.6, `rgba(234,241,250,${0.16 - t * 0.13})`], [1, 'rgba(234,241,250,0)']])
        c.beginPath()
        c.arc(px, py, pr, 0, Math.PI * 2)
        c.fill()
      }
    })
  })
}

/** Mid: rolling hills with scattered palms and round trees. */
function midHills(): Texture {
  const W = 2200
  const H = 200
  return flatLayer(W, H, '#6f9eb8', '#9cc0d3', 71, (c, r, wrap) => {
    const ridge = makeRidge(W, 185, [[2, 45], [5, 32], [9, 12]], 71)
    landPath(c, W, H, ridge)
    const at = (x: number) => ridge(((x % W) + W) % W) + 4
    for (let i = 0; i < 26; i++) {
      const x = r() * W
      const h = 22 + r() * 16
      const seed = r() * 1e9
      wrap((dx) => roundTree(c, prng(seed), x + dx, at(x), h))
    }
    for (let i = 0; i < 10; i++) {
      const gx = r() * W
      const count = 1 + Math.floor(r() * 3)
      for (let k = 0; k < count; k++) {
        const x = gx + k * 13 + (r() - 0.5) * 8
        const h = 34 + r() * 18
        const lean = (r() - 0.5) * 0.8 + (k - (count - 1) / 2) * 0.3
        const seed = r() * 1e9
        wrap((dx) => palmShape(c, prng(seed), x + dx, at(x), h, lean))
      }
    }
  })
}

/** Near: separate low islets (palm groups, a lighthouse, stilt huts) with sailboats in between. */
function nearIslets(): Texture {
  const W = 3000
  const H = 170
  return flatLayer(W, H, '#4a8a8c', '#86b3b8', 81, (c, r, wrap) => {
    const base = H - 4
    const isles: { x: number; w: number; h: number; extra: 'lighthouse' | 'huts' | null }[] = [
      { x: 320, w: 560, h: 64, extra: 'lighthouse' },
      { x: 1150, w: 320, h: 40, extra: null },
      { x: 1850, w: 700, h: 76, extra: 'huts' },
      { x: 2650, w: 420, h: 52, extra: null }
    ]
    for (const is of isles) {
      const seed = r() * 1e9
      wrap((dx) => {
        const rr = prng(seed)
        const cx = is.x + dx
        const x0 = cx - is.w / 2
        // gentle mound with a small secondary hump
        c.beginPath()
        c.moveTo(x0, base + 4)
        for (let t = 0; t <= 1.0001; t += 0.02) {
          const bump = Math.pow(Math.sin(Math.PI * t), 0.7) + 0.25 * Math.sin(Math.PI * t * 3) * Math.sin(Math.PI * t)
          c.lineTo(x0 + is.w * t, base - is.h * bump)
        }
        c.lineTo(x0 + is.w, base + 4)
        c.closePath()
        c.fill()
        const ground = (x: number) => {
          const t = Math.max(0, Math.min(1, (x - x0) / is.w))
          return base - is.h * (Math.pow(Math.sin(Math.PI * t), 0.7) + 0.25 * Math.sin(Math.PI * t * 3) * Math.sin(Math.PI * t)) + 3
        }
        const palms = 3 + Math.floor(is.w / 160)
        for (let i = 0; i < palms; i++) {
          const x = x0 + is.w * (0.12 + (i / Math.max(1, palms - 1)) * 0.76) + (rr() - 0.5) * 24
          palmShape(c, rr, x, ground(x), 48 + rr() * 34, (rr() - 0.5) * 0.9)
        }
        for (let i = 0; i < 4; i++) {
          const x = x0 + is.w * (0.2 + rr() * 0.6)
          roundTree(c, rr, x, ground(x), 26 + rr() * 12)
        }
        if (is.extra === 'lighthouse') lighthouseShape(c, cx + is.w * 0.3, ground(cx + is.w * 0.3), 70)
        if (is.extra === 'huts') {
          hutShape(c, cx - is.w * 0.36, ground(cx - is.w * 0.36), 22)
          hutShape(c, cx - is.w * 0.27, ground(cx - is.w * 0.27), 18)
        }
      })
    }
    // sailboats on the horizon between the islets
    for (const [x, s] of [[760, 26], [1480, 20], [2260, 30], [2900, 18]] as const) wrap((dx) => sailboatShape(c, x + dx, base + 2, s))
  })
}

// ---------------------------------------------------------------- collectibles

export const TOKEN = 128

/**
 * Floating value tokens: big glossy numerals (no coin), like values hanging in the air.
 * Adders read "+N" in cool white, multipliers "×N" in warm gold-white. The soft coloured
 * halo is a separate additive sprite in the scene.
 */
function valueToken(text: string, size: number, fill: [string, string, string], edge: string): Texture {
  return paint(TOKEN, TOKEN, (c) => {
    const m = TOKEN / 2
    c.font = `${size}px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    // soft drop shadow for depth
    c.save()
    c.shadowColor = 'rgba(0,20,60,.55)'
    c.shadowBlur = 8
    c.shadowOffsetY = 4
    c.fillStyle = edge
    c.fillText(text, m, m + 3)
    c.restore()
    // dark edge, then the glossy face
    c.lineWidth = 6
    c.strokeStyle = edge
    c.strokeText(text, m, m + 3)
    c.fillStyle = lin(c, 0, m - size / 2, 0, m + size / 2, [[0, fill[0]], [0.55, fill[1]], [1, fill[2]]])
    c.fillText(text, m, m + 3)
    // glossy top sheen clipped to the glyphs
    c.save()
    c.globalCompositeOperation = 'source-atop'
    c.fillStyle = lin(c, 0, m - size / 2, 0, m, [[0, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']])
    c.fillRect(0, m - size / 2, TOKEN, size / 2)
    c.restore()
  })
}

function adder(v: number): Texture {
  return valueToken(`+${v}`, v >= 10 ? 58 : v >= 5 ? 64 : 60, ['#ffffff', '#eaf6ff', '#a9d8ff'], 'rgba(14,40,96,.9)')
}

function multiplier(v: number): Texture {
  return valueToken(`×${v}`, 60 + (v - 2) * 3, ['#fffdf0', '#ffe28a', '#f5a524'], 'rgba(90,40,0,.9)')
}

function starPath(c: Ctx, x: number, y: number, r0: number, r1: number, n: number) {
  c.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 ? r1 : r0
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  c.closePath()
}

// ---------------------------------------------------------------- booster gear (physical objects)

type BoosterKind = 'nitro' | 'laser' | 'magnet' | 'buoy'
const GEAR_OUT = 'rgba(16,24,40,.85)'

/** N₂O tank: glossy blue cylinder, chrome cap and nozzle, label band. Drawn horizontal, nozzle to the left. */
function drawNitro(c: Ctx) {
  const body = () => rrect(c, -30, -15, 58, 30, 13)
  body()
  c.fillStyle = lin(c, 0, -15, 0, 15, [[0, '#9fe4ff'], [0.25, '#3aa8f0'], [0.6, '#1467c4'], [1, '#08326e']])
  c.fill()
  c.save()
  body()
  c.clip()
  c.fillStyle = lin(c, 0, -6, 0, 7, [[0, '#ffffff'], [1, '#d9e6f2']])
  c.fillRect(-10, -15, 20, 30)
  c.font = `11px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = '#0f4c9a'
  c.save()
  c.translate(0, 0.5)
  c.rotate(-Math.PI / 2)
  c.fillText('N₂O', 0, 0)
  c.restore()
  c.fillStyle = 'rgba(255,255,255,.8)'
  c.fillRect(-26, -10, 52, 2.4)
  c.fillStyle = 'rgba(0,20,60,.35)'
  c.fillRect(-30, 8, 60, 8)
  c.restore()
  body()
  c.strokeStyle = GEAR_OUT
  c.lineWidth = 2
  c.stroke()
  // chrome cap + red valve (right), nozzle (left)
  c.fillStyle = lin(c, 0, -9, 0, 9, [[0, '#ffffff'], [0.5, '#9aa7b4'], [1, '#56616d']])
  rrect(c, 26, -9, 10, 18, 3)
  c.fill()
  c.stroke()
  c.fillStyle = rad(c, 40, -2, 0.5, 6, [[0, '#ff9a8a'], [1, '#b0121b']])
  c.beginPath()
  c.arc(40, 0, 5, 0, Math.PI * 2)
  c.fill()
  c.stroke()
  c.fillStyle = lin(c, 0, -7, 0, 7, [[0, '#e6ecf2'], [1, '#56616d']])
  c.beginPath()
  c.moveTo(-30, -6)
  c.lineTo(-40, -8)
  c.lineTo(-40, 8)
  c.lineTo(-30, 6)
  c.closePath()
  c.fill()
  c.stroke()
}

/** Sci-fi laser cannon pointing right: white body, teal trim, glowing emitter. */
function drawLaser(c: Ctx) {
  // mount
  c.fillStyle = lin(c, 0, 8, 0, 22, [[0, '#9aa7b4'], [1, '#3a4450']])
  c.beginPath()
  c.moveTo(-16, 8)
  c.lineTo(-6, 22)
  c.lineTo(6, 22)
  c.lineTo(2, 8)
  c.closePath()
  c.fill()
  c.strokeStyle = GEAR_OUT
  c.lineWidth = 1.8
  c.stroke()
  // barrel
  c.fillStyle = lin(c, 0, -6, 0, 6, [[0, '#6b7785'], [0.5, '#2a323c'], [1, '#12171d']])
  rrect(c, 12, -6, 30, 12, 4)
  c.fill()
  c.stroke()
  c.fillStyle = '#12d9a0'
  c.fillRect(20, -6, 3, 12)
  c.fillRect(28, -6, 3, 12)
  // body capsule
  const body = () => rrect(c, -36, -13, 54, 26, 13)
  body()
  c.fillStyle = lin(c, 0, -13, 0, 13, [[0, '#ffffff'], [0.45, '#dfe7ef'], [1, '#7f8c9a']])
  c.fill()
  c.save()
  body()
  c.clip()
  c.fillStyle = lin(c, 0, -3, 0, 5, [[0, '#3dffc4'], [1, '#0a9a74']])
  c.fillRect(-36, -2, 54, 5)
  c.fillStyle = 'rgba(255,255,255,.9)'
  c.fillRect(-28, -10, 36, 2.2)
  c.restore()
  body()
  c.stroke()
  // fin
  c.fillStyle = lin(c, 0, -24, 0, -12, [[0, '#3dffc4'], [1, '#0a8a68']])
  c.beginPath()
  c.moveTo(-28, -12)
  c.lineTo(-20, -24)
  c.lineTo(-8, -24)
  c.lineTo(-12, -12)
  c.closePath()
  c.fill()
  c.stroke()
  // energy cells
  for (const x of [-26, -18, -10]) {
    c.fillStyle = rad(c, x, 7, 0, 3, [[0, '#eafff7'], [1, '#12d9a0']])
    c.beginPath()
    c.arc(x, 7, 2.4, 0, Math.PI * 2)
    c.fill()
  }
  // emitter ring + glow
  c.fillStyle = lin(c, 0, -8, 0, 8, [[0, '#9dffe0'], [1, '#0a8a68']])
  rrect(c, 40, -8, 6, 16, 2)
  c.fill()
  c.stroke()
  c.fillStyle = rad(c, 48, 0, 0, 12, [[0, 'rgba(234,255,247,1)'], [0.35, 'rgba(41,255,176,.8)'], [1, 'rgba(41,255,176,0)']])
  c.beginPath()
  c.arc(48, 0, 12, 0, Math.PI * 2)
  c.fill()
}

/** Horseshoe magnet opening downward: glossy red body, chrome pole tips. */
function drawMagnet(c: Ctx) {
  const R = 30
  const r = 13
  const leg = 20
  const shape = () => {
    c.beginPath()
    c.arc(0, 0, R, Math.PI, 0)
    c.lineTo(R, leg)
    c.lineTo(r, leg)
    c.lineTo(r, 0)
    c.arc(0, 0, r, 0, Math.PI, true)
    c.lineTo(-r, leg)
    c.lineTo(-R, leg)
    c.closePath()
  }
  shape()
  c.fillStyle = lin(c, -R, -R, R, R, [[0, '#ff9a8a'], [0.35, '#e8222c'], [0.8, '#9c0f18'], [1, '#6a0810']])
  c.fill()
  c.save()
  shape()
  c.clip()
  c.fillStyle = lin(c, 0, leg - 10, 0, leg, [[0, '#ffffff'], [0.5, '#b7c2cd'], [1, '#5a6572']])
  c.fillRect(-R - 2, leg - 10, R * 2 + 4, 12)
  c.strokeStyle = 'rgba(255,255,255,.75)'
  c.lineWidth = 3
  c.beginPath()
  c.arc(0, 0, (R + r) / 2 + 3, Math.PI * 1.15, Math.PI * 1.55)
  c.stroke()
  c.restore()
  shape()
  c.strokeStyle = GEAR_OUT
  c.lineWidth = 2
  c.stroke()
}

/** Life buoy: red/white torus with rope loops. */
function drawBuoy(c: Ctx) {
  const R = 30
  const r = 15
  const ring = () => {
    c.beginPath()
    c.arc(0, 0, R, 0, Math.PI * 2)
    c.arc(0, 0, r, 0, Math.PI * 2, true)
  }
  for (let i = 0; i < 8; i++) {
    c.beginPath()
    c.moveTo(Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r)
    c.arc(0, 0, R, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2)
    c.arc(0, 0, r, ((i + 1) / 8) * Math.PI * 2, (i / 8) * Math.PI * 2, true)
    c.closePath()
    c.fillStyle = i % 2 ? '#fbf7f0' : '#e8222c'
    c.fill()
  }
  // torus shading: light upper-left, shadow lower-right, darker inner edge
  c.save()
  ring()
  c.clip('evenodd')
  c.fillStyle = lin(c, -R, -R, R, R, [[0, 'rgba(255,255,255,.35)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(40,0,10,.45)']])
  c.fillRect(-R, -R, R * 2, R * 2)
  c.strokeStyle = 'rgba(40,0,10,.35)'
  c.lineWidth = 5
  c.beginPath()
  c.arc(0, 0, r + 1, 0, Math.PI * 2)
  c.stroke()
  c.strokeStyle = 'rgba(255,255,255,.8)'
  c.lineWidth = 3
  c.beginPath()
  c.arc(0, 0, (R + r) / 2 + 3, Math.PI * 1.1, Math.PI * 1.45)
  c.stroke()
  c.restore()
  // rope loops
  c.strokeStyle = '#d9c29a'
  c.lineWidth = 2.4
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2
    c.beginPath()
    c.arc(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), 7, a - 1.2, a + 1.2)
    c.stroke()
  }
  ring()
  c.strokeStyle = GEAR_OUT
  c.lineWidth = 2
  c.stroke()
}

const GEAR_DRAW: Record<BoosterKind, (c: Ctx) => void> = { nitro: drawNitro, laser: drawLaser, magnet: drawMagnet, buoy: drawBuoy }

/** The bare object, for mounting on the plane. */
function gear(kind: BoosterKind): Texture {
  return paint(TOKEN, TOKEN, (c) => {
    c.translate(TOKEN / 2, TOKEN / 2)
    GEAR_DRAW[kind](c)
  }, 3)
}

/** Sky pickup: the object floating inside a glossy bubble. */
function boosterPickup(kind: BoosterKind): Texture {
  return paint(TOKEN, TOKEN, (c) => {
    const m = TOKEN / 2
    const R = 56
    // bubble body (behind the object)
    c.fillStyle = rad(c, m, m, R * 0.3, R, [[0, 'rgba(190,235,255,.12)'], [0.85, 'rgba(160,220,255,.28)'], [1, 'rgba(210,240,255,.65)']])
    c.beginPath()
    c.arc(m, m, R, 0, Math.PI * 2)
    c.fill()
    c.save()
    c.translate(m, m + (kind === 'magnet' ? 4 : 0))
    c.scale(0.9, 0.9)
    GEAR_DRAW[kind](c)
    c.restore()
    // front highlights
    c.strokeStyle = 'rgba(255,255,255,.85)'
    c.lineWidth = 2
    c.beginPath()
    c.arc(m, m, R - 1, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = 'rgba(255,255,255,.75)'
    c.beginPath()
    c.ellipse(m - 22, m - 32, 16, 7, -0.6, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,.35)'
    c.beginPath()
    c.ellipse(m + 30, m + 30, 7, 3, -0.6, 0, Math.PI * 2)
    c.fill()
  }, 3)
}

// ---------------------------------------------------------------- rocket

export const ROCKET_W = 160
export const ROCKET_H = 56

function rocket(): Texture {
  return paint(ROCKET_W, ROCKET_H, (c) => {
    const y = ROCKET_H / 2
    // fins (back)
    c.fillStyle = lin(c, 0, 0, 0, ROCKET_H, [[0, '#ff6b5e'], [1, '#7a0a10']])
    c.beginPath()
    c.moveTo(118, y - 8)
    c.lineTo(150, y - 26)
    c.lineTo(156, y - 26)
    c.lineTo(148, y - 6)
    c.closePath()
    c.moveTo(118, y + 8)
    c.lineTo(150, y + 26)
    c.lineTo(156, y + 26)
    c.lineTo(148, y + 6)
    c.closePath()
    c.fill()
    // body
    c.fillStyle = lin(c, 0, y - 12, 0, y + 12, [
      [0, '#ffffff'],
      [0.35, '#e9eef3'],
      [0.7, '#9aa6b2'],
      [1, '#4a5561']
    ])
    rrect(c, 34, y - 12, 118, 24, 6)
    c.fill()
    // stripes
    c.fillStyle = '#e0242c'
    c.fillRect(70, y - 12, 8, 24)
    c.fillRect(84, y - 12, 4, 24)
    c.fillStyle = '#ffcc2e'
    for (let i = 0; i < 4; i++) c.fillRect(100 + i * 10, y - 12, 5, 24)
    // warhead
    c.fillStyle = lin(c, 0, y - 12, 0, y + 12, [[0, '#ff8a78'], [0.5, '#e0242c'], [1, '#6a0810']])
    c.beginPath()
    c.moveTo(36, y - 12)
    c.quadraticCurveTo(4, y - 6, 2, y)
    c.quadraticCurveTo(4, y + 6, 36, y + 12)
    c.closePath()
    c.fill()
    // nozzle
    c.fillStyle = lin(c, 0, y - 10, 0, y + 10, [[0, '#8d9aa7'], [1, '#1d2329']])
    c.fillRect(150, y - 9, 8, 18)
    // specular
    c.fillStyle = 'rgba(255,255,255,.7)'
    c.fillRect(38, y - 9, 108, 2.2)
    // center fin
    c.fillStyle = '#9c1018'
    c.fillRect(124, y - 2, 30, 4)
  })
}

function flame(): Texture {
  return paint(120, 48, (c) => {
    const y = 24
    c.fillStyle = lin(c, 0, 0, 120, 0, [
      [0, 'rgba(255,255,255,1)'],
      [0.12, 'rgba(255,240,140,1)'],
      [0.4, 'rgba(255,140,20,.9)'],
      [0.75, 'rgba(255,50,0,.45)'],
      [1, 'rgba(255,0,0,0)']
    ])
    c.beginPath()
    c.moveTo(0, y - 9)
    c.quadraticCurveTo(60, y - 18, 120, y)
    c.quadraticCurveTo(60, y + 18, 0, y + 9)
    c.closePath()
    c.fill()
  })
}

// ---------------------------------------------------------------- fx sprites

function glow(): Texture {
  return paint(128, 128, (c) => {
    c.fillStyle = rad(c, 64, 64, 0, 64, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,.55)'],
      [0.6, 'rgba(255,255,255,.12)'],
      [1, 'rgba(255,255,255,0)']
    ])
    c.fillRect(0, 0, 128, 128)
  })
}

function dot(): Texture {
  return paint(32, 32, (c) => {
    c.fillStyle = rad(c, 16, 16, 0, 16, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']])
    c.fillRect(0, 0, 32, 32)
  })
}

function spark(): Texture {
  return paint(64, 64, (c) => {
    c.fillStyle = rad(c, 32, 32, 0, 30, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])
    c.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const r = i % 2 ? 6 : 31
      c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r)
    }
    c.closePath()
    c.fill()
  })
}

function smoke(): Texture {
  return paint(96, 96, (c) => {
    const r = prng(5)
    for (let i = 0; i < 7; i++) {
      const x = 48 + (r() - 0.5) * 34
      const y = 48 + (r() - 0.5) * 34
      const rr = 18 + r() * 14
      c.fillStyle = rad(c, x, y, 0, rr, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']])
      c.beginPath()
      c.arc(x, y, rr, 0, Math.PI * 2)
      c.fill()
    }
  })
}

function fireball(): Texture {
  return paint(128, 128, (c) => {
    const r = prng(21)
    // several overlapping hot blobs make an irregular, billowing flame puff
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2
      const d = r() * 26
      const x = 64 + Math.cos(a) * d
      const y = 64 + Math.sin(a) * d
      const rr = 22 + r() * 22
      c.fillStyle = rad(c, x, y, 0, rr, [
        [0, 'rgba(255,250,220,.95)'],
        [0.3, 'rgba(255,214,90,.9)'],
        [0.6, 'rgba(255,120,20,.75)'],
        [0.85, 'rgba(190,40,10,.35)'],
        [1, 'rgba(120,20,0,0)']
      ])
      c.beginPath()
      c.arc(x, y, rr, 0, Math.PI * 2)
      c.fill()
    }
  })
}

function debris(): Texture {
  return paint(16, 10, (c) => {
    c.fillStyle = '#2b2622'
    c.beginPath()
    c.moveTo(0, 4)
    c.lineTo(9, 0)
    c.lineTo(16, 5)
    c.lineTo(7, 10)
    c.closePath()
    c.fill()
    c.fillStyle = 'rgba(255,255,255,.35)'
    c.fillRect(4, 2, 6, 1.5)
  })
}

function ring(): Texture {
  return paint(128, 128, (c) => {
    c.strokeStyle = rad(c, 64, 64, 40, 62, [[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])
    c.lineWidth = 16
    c.beginPath()
    c.arc(64, 64, 52, 0, Math.PI * 2)
    c.stroke()
  })
}

function shield(): Texture {
  return paint(260, 200, (c) => {
    c.fillStyle = rad(c, 130, 100, 40, 128, [
      [0, 'rgba(120,220,255,0)'],
      [0.72, 'rgba(120,220,255,.12)'],
      [0.9, 'rgba(160,240,255,.55)'],
      [1, 'rgba(160,240,255,0)']
    ])
    c.save()
    c.scale(1, 200 / 260)
    c.beginPath()
    c.arc(130, 130, 128, 0, Math.PI * 2)
    c.restore()
    c.fill()
    c.fillStyle = 'rgba(255,255,255,.35)'
    c.beginPath()
    c.ellipse(100, 44, 60, 12, -0.25, 0, Math.PI * 2)
    c.fill()
  })
}

function beam(): Texture {
  return paint(64, 24, (c) => {
    c.fillStyle = lin(c, 0, 0, 0, 24, [
      [0, 'rgba(41,255,176,0)'],
      [0.35, 'rgba(41,255,176,.8)'],
      [0.5, 'rgba(255,255,255,1)'],
      [0.65, 'rgba(41,255,176,.8)'],
      [1, 'rgba(41,255,176,0)']
    ])
    c.fillRect(0, 0, 64, 24)
  })
}

function coin(): Texture {
  return paint(64, 64, (c) => {
    c.fillStyle = lin(c, 0, 4, 0, 60, [[0, '#fff3b0'], [0.5, '#f2b32a'], [1, '#8a4a00']])
    c.beginPath()
    c.arc(32, 32, 28, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = rad(c, 26, 24, 2, 24, [[0, '#fff8d0'], [0.6, '#ffc93a'], [1, '#c77c00']])
    c.beginPath()
    c.arc(32, 32, 21, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#b36b00'
    starPath(c, 32, 33, 12, 5, 5)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,.6)'
    c.beginPath()
    c.ellipse(24, 18, 9, 4, -0.5, 0, Math.PI * 2)
    c.fill()
  })
}

function confetti(): Texture {
  return paint(14, 8, (c) => {
    c.fillStyle = '#fff'
    c.fillRect(0, 0, 14, 8)
  })
}

function droplet(): Texture {
  return paint(24, 36, (c) => {
    c.fillStyle = rad(c, 10, 22, 1, 14, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(200,240,255,.9)'], [1, 'rgba(120,200,240,0)']])
    c.beginPath()
    c.moveTo(12, 0)
    c.quadraticCurveTo(24, 22, 12, 34)
    c.quadraticCurveTo(0, 22, 12, 0)
    c.fill()
  })
}

function warning(): Texture {
  return paint(64, 60, (c) => {
    c.fillStyle = lin(c, 0, 0, 0, 60, [[0, '#ffe05a'], [1, '#ff8a00']])
    c.beginPath()
    c.moveTo(32, 3)
    c.lineTo(61, 56)
    c.lineTo(3, 56)
    c.closePath()
    c.fill()
    c.strokeStyle = '#6a2a00'
    c.lineWidth = 4
    c.stroke()
    c.font = `38px ${FONT}`
    c.fillStyle = '#6a0f00'
    c.textAlign = 'center'
    c.fillText('!', 32, 51)
  })
}

function gull(frame: number): Texture {
  return paint(40, 20, (c) => {
    c.strokeStyle = '#f8fbff'
    c.lineWidth = 2.6
    c.beginPath()
    const up = frame === 0 ? -8 : 6
    c.moveTo(2, 10 + up)
    c.quadraticCurveTo(12, 4 + up * 0.3, 20, 11)
    c.quadraticCurveTo(28, 4 + up * 0.3, 38, 10 + up)
    c.stroke()
    c.fillStyle = '#e8eef4'
    c.beginPath()
    c.ellipse(20, 12, 4, 2.5, 0, 0, Math.PI * 2)
    c.fill()
  })
}

function rays(): Texture {
  return paint(512, 512, (c) => {
    c.translate(256, 256)
    for (let i = 0; i < 16; i++) {
      c.rotate((Math.PI * 2) / 16)
      c.fillStyle = lin(c, 0, 0, 256, 0, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']])
      c.beginPath()
      c.moveTo(0, 0)
      c.lineTo(256, -26)
      c.lineTo(256, 26)
      c.closePath()
      c.fill()
    }
  })
}

/** Spiky starburst behind high-value tokens: thin rays of uneven length from a bright core. */
function burst(): Texture {
  return paint(256, 256, (c) => {
    const r = prng(99)
    const m = 128
    c.translate(m, m)
    const n = 34
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.08
      const len = (i % 2 ? 0.55 : 0.8) * 124 * (0.75 + r() * 0.25)
      const w = 2.2 + r() * 3
      c.save()
      c.rotate(a)
      c.fillStyle = lin(c, 0, 0, len, 0, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']])
      c.beginPath()
      c.moveTo(6, -w)
      c.lineTo(len, 0)
      c.lineTo(6, w)
      c.closePath()
      c.fill()
      c.restore()
    }
    c.fillStyle = rad(c, 0, 0, 0, 46, [[0, 'rgba(255,255,255,.95)'], [0.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']])
    c.beginPath()
    c.arc(0, 0, 46, 0, Math.PI * 2)
    c.fill()
  })
}

function wake(): Texture {
  return paint(256, 40, (c) => {
    const r = prng(77)
    for (let i = 0; i < 80; i++) {
      const x = r() * 256
      const y = 20 + (r() - 0.5) * 24 * (x / 256)
      c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`
      c.beginPath()
      c.ellipse(x, y, 4 + r() * 10, 1 + r() * 2.5, 0, 0, Math.PI * 2)
      c.fill()
    }
  })
}

// ---------------------------------------------------------------- registry

export interface Art {
  plane: Texture
  propDisc: Texture
  propBlade: Texture
  spinner: Texture
  scarf: Texture
  carrier: Texture
  radar: Texture
  island: Texture
  palm: Texture
  flag: Texture
  sky: Texture
  clouds: Texture[]
  hillsFar: Texture
  hillsMid: Texture
  hillsNear: Texture
  adders: Record<number, Texture>
  multipliers: Record<number, Texture>
  boosters: Record<'nitro' | 'laser' | 'magnet' | 'buoy', Texture>
  gear: Record<'nitro' | 'laser' | 'magnet' | 'buoy', Texture>
  rocket: Texture
  flame: Texture
  glow: Texture
  dot: Texture
  spark: Texture
  smoke: Texture
  fireball: Texture
  debris: Texture
  ring: Texture
  shield: Texture
  beam: Texture
  coin: Texture
  confetti: Texture
  droplet: Texture
  warning: Texture
  gull: Texture[]
  rays: Texture
  burst: Texture
  wake: Texture
}

export async function buildArt(): Promise<Art> {
  try {
    await Promise.all([document.fonts.load(`40px "Lilita One"`), document.fonts.load(`800 20px Nunito`)])
  } catch {
    /* fall back to system fonts */
  }
  return {
    plane: planeBody(),
    propDisc: propDisc(),
    propBlade: propBlade(),
    spinner: spinner(),
    scarf: scarf(),
    carrier: carrier(),
    radar: radar(),
    island: island(),
    palm: palm(),
    flag: flag(),
    sky: sky(),
    clouds: [cloud(1, 520, 200), cloud(2, 380, 160), cloud(3, 680, 240), cloud(4, 300, 130), cloud(5, 460, 190)],
    hillsFar: farRange(),
    hillsMid: midHills(),
    hillsNear: nearIslets(),
    adders: { 1: adder(1), 2: adder(2), 5: adder(5), 10: adder(10) },
    multipliers: { 2: multiplier(2), 3: multiplier(3), 4: multiplier(4), 5: multiplier(5) },
    boosters: { nitro: boosterPickup('nitro'), laser: boosterPickup('laser'), magnet: boosterPickup('magnet'), buoy: boosterPickup('buoy') },
    gear: { nitro: gear('nitro'), laser: gear('laser'), magnet: gear('magnet'), buoy: gear('buoy') },
    rocket: rocket(),
    flame: flame(),
    glow: glow(),
    dot: dot(),
    spark: spark(),
    smoke: smoke(),
    fireball: fireball(),
    debris: debris(),
    ring: ring(),
    shield: shield(),
    beam: beam(),
    coin: coin(),
    confetti: confetti(),
    droplet: droplet(),
    warning: warning(),
    gull: [gull(0), gull(1)],
    rays: rays(),
    burst: burst(),
    wake: wake()
  }
}
