import * as THREE from 'three'
import { canvas, finish } from './canvas'
import { TRACK_ADS, type TrackAd } from './ads'

/** Signage painted at load: the ads in each of their formats, the number plate's mini ad, the gantry banners, the corner chevrons and the jump warnings. */

type Ctx = CanvasRenderingContext2D

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

let emojiOk: boolean | null = null

/** Colour emoji render as colour; a missing emoji font falls back to a grey box or glyph. */
function colorEmojiSupported() {
    if (emojiOk !== null) return emojiOk
    const [, ctx] = canvas(32, 32)
    ctx.font = `24px ${EMOJI_FONT}`
    ctx.textBaseline = 'middle'
    ctx.fillText('🚀', 2, 16)
    const d = ctx.getImageData(0, 0, 32, 32).data
    emojiOk = false
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! > 0 && (Math.abs(d[i]! - d[i + 1]!) > 30 || Math.abs(d[i + 1]! - d[i + 2]!) > 30)) {
            emojiOk = true
            break
        }
    }
    return emojiOk
}

/** Whether the ad's mark can be drawn here. */
const showsIcon = (ad: TrackAd) => ad.icon !== '' && colorEmojiSupported()

function paintBackground(ctx: Ctx, ad: TrackAd, x: number, y: number, w: number, h: number) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h)
    g.addColorStop(0, ad.bg[0])
    g.addColorStop(1, ad.bg[1])
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
}

/** A soft glow of the accent behind the mark. */
function paintHalo(ctx: Ctx, ad: TrackAd, x: number, y: number, r: number) {
    const halo = ctx.createRadialGradient(x, y, r * 0.08, x, y, r)
    halo.addColorStop(0, ad.col + '66')
    halo.addColorStop(1, ad.col + '00')
    ctx.fillStyle = halo
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

function paintIcon(ctx: Ctx, ad: TrackAd, x: number, y: number, size: number) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${size}px ${EMOJI_FONT}`
    ctx.fillText(ad.icon, x, y)
}

/** The title in the accent with its glow, shrunk until it fits `maxW`. */
function paintTitle(ctx: Ctx, ad: TrackAd, x: number, y: number, size: number, minSize: number, maxW: number, blur: number) {
    ctx.font = `900 ${size}px system-ui, sans-serif`
    while (ctx.measureText(ad.title).width > maxW && size > minSize) {
        size -= 2
        ctx.font = `900 ${size}px system-ui, sans-serif`
    }
    ctx.shadowColor = ad.col
    ctx.shadowBlur = blur
    ctx.fillStyle = ad.col
    ctx.fillText(ad.title, x, y)
    ctx.shadowBlur = 0
}

/** A 2:1 board: mark on the left, title, tagline and the site line on the right. */
export function billboardTexture(ad: TrackAd) {
    const [c, ctx] = canvas(512, 256)
    paintBackground(ctx, ad, 0, 0, 512, 256)
    const icon = showsIcon(ad)
    if (icon) {
        paintHalo(ctx, ad, 100, 128, 130)
        paintIcon(ctx, ad, 100, 136, 110)
    }
    // Without an icon the text takes the whole board.
    const left = icon ? 196 : 40
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    paintTitle(ctx, ad, left, 112, 64, 30, icon ? 300 : 440, 22)
    ctx.font = '700 24px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(ad.sub, left + 2, 172)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText('NOW ON POLYNUX', left + 2, 214)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, 506, 250)
    return finish(c)
}

/** An 8:1 strip for the hoardings on the walls and the banners over the road; it tiles end to end. */
export function stripTexture(ad: TrackAd) {
    const W = 1024
    const H = 128
    const [c, ctx] = canvas(W, H)
    paintBackground(ctx, ad, 0, 0, W, H)
    ctx.fillStyle = ad.col
    ctx.fillRect(0, 0, W, 6)
    ctx.fillRect(0, H - 6, W, 6)
    const icon = showsIcon(ad)
    if (icon) {
        paintHalo(ctx, ad, 80, H / 2, 70)
        paintIcon(ctx, ad, 80, H / 2 + 4, 76)
    }
    const left = icon ? 150 : 40
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    paintTitle(ctx, ad, left, H / 2 + 2, 76, 40, 470, 16)
    const titleEnd = left + ctx.measureText(ad.title).width
    ctx.font = '800 34px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'right'
    ctx.fillText(ad.sub, W - 40, H / 2 + 2, Math.max(120, W - 80 - titleEnd))
    return finish(c)
}

/** A feather flag's 1:4 cloth: mark at the top, the title reading up the flag. */
export function flagTexture(ad: TrackAd) {
    const W = 128
    const H = 512
    const [c, ctx] = canvas(W, H)
    paintBackground(ctx, ad, 0, 0, W, H)
    ctx.fillStyle = ad.col
    ctx.fillRect(W - 10, 0, 10, H)
    const icon = showsIcon(ad)
    if (icon) {
        paintHalo(ctx, ad, W / 2, 70, 64)
        paintIcon(ctx, ad, W / 2, 74, 70)
    }
    ctx.save()
    ctx.translate(W / 2, icon ? 316 : H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    paintTitle(ctx, ad, 0, 0, 64, 26, icon ? 330 : 470, 12)
    ctx.restore()
    return finish(c)
}

/** The rear plate: a generic panel carrying a random ad instead of a registration. */
export function plateTexture() {
    const W = 520
    const H = 120
    const [c, ctx] = canvas(W, H)
    // Cosmetic, so Math.random.
    const ad = TRACK_ADS[Math.floor(Math.random() * TRACK_ADS.length)]!
    ctx.fillStyle = '#0b0b0e'
    ctx.fillRect(0, 0, W, H)
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, ad.bg[0])
    g.addColorStop(1, ad.bg[1])
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(8, 8, W - 16, H - 16, 12)
    ctx.fill()
    ctx.strokeStyle = ad.col + 'aa'
    ctx.lineWidth = 3
    ctx.stroke()
    const icon = showsIcon(ad)
    if (icon) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(8, 8, 120, H - 16)
        ctx.clip()
        paintHalo(ctx, ad, 62, H / 2, 60)
        ctx.restore()
        paintIcon(ctx, ad, 62, H / 2 + 4, 62)
    }
    const left = icon ? 116 : 30
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    paintTitle(ctx, ad, left, 50, 50, 24, W - left - 26, 14)
    ctx.font = '700 19px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(ad.sub, left + 2, 88)
    return finish(c)
}

/** A neon banner for the start gantry. */
export function bannerTexture(title: string, sub: string) {
    const [c, ctx] = canvas(1024, 256)
    ctx.fillStyle = '#0b0614'
    ctx.fillRect(0, 0, 1024, 256)
    ctx.strokeStyle = '#ff2bd6'
    ctx.lineWidth = 10
    ctx.strokeRect(10, 10, 1004, 236)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#ff2bd6'
    ctx.shadowBlur = 24
    ctx.fillStyle = '#ffffff'
    ctx.font = 'italic 900 120px system-ui, sans-serif'
    ctx.fillText(title, 512, 110)
    ctx.shadowColor = '#3df2ff'
    ctx.fillStyle = '#9ff8ff'
    ctx.font = '800 46px system-ui, sans-serif'
    ctx.fillText(sub, 512, 200)
    return finish(c)
}

/** Board colour for each corner grade, gentle to hairpin. */
export const CORNER_SIGN_COLOURS = ['#ffd23d', '#ff8a1f', '#ff2b3a'] as const

/** A corner board with `count` chevrons pointing right; the left-hand boards flip it in their UVs. */
export function cornerSignTexture(count: 1 | 2 | 3) {
    const W = 256
    const H = 192
    const [c, ctx] = canvas(W, H)
    const col = CORNER_SIGN_COLOURS[count - 1]!
    ctx.fillStyle = '#121216'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = col
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, W - 8, H - 8)
    const step = 56
    const width = 70
    const x0 = W / 2 - ((count - 1) * step + width) / 2
    ctx.fillStyle = col
    ctx.shadowColor = col
    ctx.shadowBlur = 10
    for (let k = 0; k < count; k++) {
        const x = x0 + k * step
        ctx.beginPath()
        ctx.moveTo(x, 30)
        ctx.lineTo(x + 34, 30)
        ctx.lineTo(x + width, H / 2)
        ctx.lineTo(x + 34, H - 30)
        ctx.lineTo(x, H - 30)
        ctx.lineTo(x + width - 34, H / 2)
        ctx.closePath()
        ctx.fill()
    }
    return finish(c)
}

/** Yellow road paint, a touch see-through so the asphalt shows in it. */
const ROAD_PAINT = 'rgba(255, 210, 61, 0.92)'

/** A road-paint tile, across the road and along it, repeating along the road. */
function paintTile(w: number, h: number, paint: (ctx: Ctx) => void) {
    const [c, ctx] = canvas(w, h)
    ctx.fillStyle = ROAD_PAINT
    ctx.strokeStyle = ROAD_PAINT
    paint(ctx)
    const t = finish(c)
    t.wrapT = THREE.RepeatWrapping
    return t
}

/** One arrow pointing up the road, the top of the canvas being further along. */
export const jumpArrowTexture = () => paintTile(256, 256, (ctx) => {
    ctx.lineWidth = 30
    ctx.lineJoin = 'miter'
    ctx.beginPath()
    ctx.moveTo(56, 200)
    ctx.lineTo(128, 80)
    ctx.lineTo(200, 200)
    ctx.stroke()
})

/** The wall board ahead of a jump: a car leaving a ramp, over the word. */
export function jumpSignTexture() {
    const W = 256
    const H = 192
    const [c, ctx] = canvas(W, H)
    const col = CORNER_SIGN_COLOURS[0]
    ctx.fillStyle = '#121216'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = col
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, W - 8, H - 8)
    ctx.fillStyle = col
    ctx.shadowColor = col
    ctx.shadowBlur = 10
    // The ramp.
    ctx.beginPath()
    ctx.moveTo(30, 132)
    ctx.lineTo(120, 132)
    ctx.lineTo(120, 100)
    ctx.closePath()
    ctx.fill()
    // The car in the air, nose up, and its flight.
    ctx.save()
    ctx.translate(176, 72)
    ctx.rotate(-0.3)
    ctx.beginPath()
    ctx.roundRect(-34, -12, 68, 24, 8)
    ctx.fill()
    ctx.restore()
    ctx.setLineDash([10, 8])
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(124, 96)
    ctx.quadraticCurveTo(140, 70, 150, 80)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 38px system-ui, sans-serif'
    ctx.fillText('JUMP', W / 2, 162)
    return finish(c)
}
