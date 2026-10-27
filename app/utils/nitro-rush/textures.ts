import * as THREE from 'three'

/**
 * Every texture in Nitro Rush is painted on a canvas at load. No image files.
 * Randomness here is purely cosmetic, so Math.random is fine.
 */

/** World length one tile of the road texture covers. */
export const ROAD_TILE_LENGTH = 14
/** World length one tile of the wet-patch mask covers; long, so its repeat never reads. */
export const PUDDLE_TILE_LENGTH = 90

function canvas(w: number, h: number) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return [c, c.getContext('2d')!] as const
}

function finish(c: HTMLCanvasElement, srgb = true) {
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.needsUpdate = true
    return t
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Blotchy value noise, drawn as many soft blobs. Good enough for stains and puddles. */
function blobs(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rMin: number, rMax: number, color: (a: number) => string) {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * w
        const y = Math.random() * h
        const r = rand(rMin, rMax)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const a = rand(0.15, 0.6)
        g.addColorStop(0, color(a))
        g.addColorStop(1, color(0))
        ctx.fillStyle = g
        // Draw wrapped copies so the tile has no seam.
        for (const dx of [-w, 0, w]) {
            for (const dy of [-h, 0, h]) {
                ctx.save()
                ctx.translate(dx, dy)
                ctx.fillRect(x - r, y - r, r * 2, r * 2)
                ctx.restore()
            }
        }
    }
}

/** A height canvas turned into a tangent-space normal map. */
function normalFromHeight(src: HTMLCanvasElement, strength: number) {
    const w = src.width
    const h = src.height
    const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data
    const [c, ctx] = canvas(w, h)
    const out = ctx.createImageData(w, h)
    const hAt = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength
            const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength
            const len = Math.hypot(dx, dy, 1)
            const i = (y * w + x) * 4
            out.data[i] = (-dx / len * 0.5 + 0.5) * 255
            out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255
            out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255
            out.data[i + 3] = 255
        }
    }
    ctx.putImageData(out, 0, 0)
    return finish(c, false)
}

/**
 * Track asphalt across the full width: aggregate, a rubbered-in groove, worn
 * edge lines. Colour, normal and a roughness map, plus a long-tiling wet mask.
 */
export function roadTextures(halfWidth: number) {
    const W = 512
    const H = 512
    const toPx = (x: number) => (x + halfWidth) / (halfWidth * 2) * W
    const [base, b] = canvas(W, H)
    const [height, hc] = canvas(W, H)
    const [rough, r] = canvas(W, H)

    b.fillStyle = '#2a2a2e'
    b.fillRect(0, 0, W, H)
    hc.fillStyle = '#808080'
    hc.fillRect(0, 0, W, H)
    r.fillStyle = '#b4b4b4'
    r.fillRect(0, 0, W, H)
    // Aggregate: speckles in colour, bumps in the height map.
    for (let i = 0; i < 26000; i++) {
        const x = Math.random() * W
        const y = Math.random() * H
        const v = rand(22, 70)
        b.fillStyle = `rgb(${v},${v},${v + 3})`
        b.fillRect(x, y, 1.5, 1.5)
        const hv = rand(90, 200)
        hc.fillStyle = `rgb(${hv},${hv},${hv})`
        hc.fillRect(x, y, 1.6, 1.6)
    }
    blobs(b, W, H, 40, 20, 80, a => `rgba(10,10,12,${a * 0.5})`)
    // Rubber laid down in a wide band either side of the middle, darker and smoother than the rest.
    for (const [x, half] of [[-halfWidth * 0.3, 70], [halfWidth * 0.25, 90]] as const) {
        const px = toPx(x)
        const g = b.createLinearGradient(px - half, 0, px + half, 0)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(0.5, 'rgba(8,8,10,0.4)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        b.fillStyle = g
        b.fillRect(px - half, 0, half * 2, H)
        const gr = r.createLinearGradient(px - half, 0, px + half, 0)
        gr.addColorStop(0, 'rgba(0,0,0,0)')
        gr.addColorStop(0.5, 'rgba(40,40,40,0.5)')
        gr.addColorStop(1, 'rgba(0,0,0,0)')
        r.fillStyle = gr
        r.fillRect(px - half, 0, half * 2, H)
    }
    // Solid white track limits.
    for (const x of [-halfWidth + 0.35, halfWidth - 0.35]) {
        b.fillStyle = '#e4e2da'
        b.fillRect(toPx(x) - 5, 0, 10, H)
        r.fillStyle = '#8c8c8c'
        r.fillRect(toPx(x) - 5, 0, 10, H)
        hc.fillStyle = '#a8a8a8'
        hc.fillRect(toPx(x) - 5, 0, 10, H)
    }
    // Wear: knock specks out of the paint.
    for (let i = 0; i < 1600; i++) {
        const v = rand(30, 60)
        b.fillStyle = `rgba(${v},${v},${v},0.8)`
        b.fillRect(Math.random() * W, Math.random() * H, rand(1, 3), rand(1, 3))
    }
    // Cracks and tar seams.
    b.strokeStyle = 'rgba(6,6,8,0.7)'
    for (let i = 0; i < 7; i++) {
        b.lineWidth = rand(0.8, 2)
        b.beginPath()
        let x = Math.random() * W
        let y = Math.random() * H
        b.moveTo(x, y)
        for (let k = 0; k < 8; k++) {
            x += rand(-18, 18)
            y += rand(6, 26)
            b.lineTo(x, y)
        }
        b.stroke()
    }

    const map = finish(base)
    const normal = normalFromHeight(height, 2.2)
    const roughMap = finish(rough, false)

    // Wet mask: white is standing water. Tiles long, so puddles don't repeat visibly.
    const [wet, wc] = canvas(256, 512)
    wc.fillStyle = '#4a4a4a'
    wc.fillRect(0, 0, 256, 512)
    blobs(wc, 256, 512, 70, 8, 46, a => `rgba(255,255,255,${a})`)
    blobs(wc, 256, 512, 30, 10, 40, a => `rgba(0,0,0,${a * 0.6})`)
    const wetMask = finish(wet, false)

    for (const t of [map, normal, roughMap, wetMask]) {
        t.wrapS = THREE.RepeatWrapping
        t.wrapT = THREE.RepeatWrapping
    }
    return { map, normal, rough: roughMap, wet: wetMask }
}

/** Broom-finished concrete for barriers and pavements. */
export function concreteTexture(tone = 120) {
    const [c, ctx] = canvas(256, 256)
    ctx.fillStyle = `rgb(${tone},${tone},${tone - 4})`
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 9000; i++) {
        const v = tone + rand(-28, 22)
        ctx.fillStyle = `rgba(${v},${v},${v - 4},0.7)`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4)
    }
    blobs(ctx, 256, 256, 18, 10, 60, a => `rgba(40,38,34,${a * 0.35})`)
    const t = finish(c)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    return t
}

export type FacadeKind = 'office' | 'glass' | 'residential' | 'brick'

/**
 * A facade tile: colour, emissive (lit windows only) and roughness. One tile
 * is FACADE_TILE world units square; materials repeat it across the building.
 */
export const FACADE_TILE = 12

export function facadeTextures(kind: FacadeKind) {
    const S = 512
    const [col, cc] = canvas(S, S)
    const [emi, ec] = canvas(S, S)
    const [rgh, rc] = canvas(S, S)
    ec.fillStyle = '#000'
    ec.fillRect(0, 0, S, S)

    const floors = kind === 'residential' || kind === 'brick' ? 4 : 3
    const bays = kind === 'glass' ? 6 : 4
    const fh = S / floors
    const bw = S / bays
    const warm = ['#ffd9a0', '#ffc77a', '#ffe7c2', '#fff2dc']
    const cool = ['#cfe6ff', '#e6f2ff', '#bcd8ff']
    const lights = kind === 'office' || kind === 'glass' ? [...cool, ...cool, ...warm] : [...warm, ...warm, '#ffb070']

    const wall = { office: '#5e5d5a', glass: '#0d141c', residential: '#8a7f72', brick: '#5a3328' }[kind]
    cc.fillStyle = wall
    cc.fillRect(0, 0, S, S)
    rc.fillStyle = kind === 'glass' ? '#262626' : '#d0d0d0'
    rc.fillRect(0, 0, S, S)
    for (let i = 0; i < 5000; i++) {
        const v = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'
        cc.fillStyle = v
        cc.fillRect(Math.random() * S, Math.random() * S, 2, 2)
    }
    if (kind === 'brick') {
        cc.strokeStyle = 'rgba(30,18,14,0.6)'
        cc.lineWidth = 1
        for (let y = 0; y < S; y += 8) {
            cc.beginPath()
            cc.moveTo(0, y)
            cc.lineTo(S, y)
            cc.stroke()
        }
    }

    for (let f = 0; f < floors; f++) {
        // Whole floors go dark together, like real towers at night.
        const floorLit = Math.random() < 0.55
        for (let bay = 0; bay < bays; bay++) {
            const inset = kind === 'glass' ? 3 : bw * 0.16
            const top = kind === 'glass' ? 3 : fh * 0.2
            const x = bay * bw + inset
            const y = f * fh + top
            const w = bw - inset * 2
            const h = fh - top - (kind === 'glass' ? 3 : fh * 0.14)
            const lit = floorLit ? Math.random() < 0.7 : Math.random() < 0.08
            // Glass pane: dark reflective, or a lit room with a little depth.
            const glass = cc.createLinearGradient(x, y, x, y + h)
            glass.addColorStop(0, '#1a2430')
            glass.addColorStop(1, '#0a0e14')
            cc.fillStyle = glass
            cc.fillRect(x, y, w, h)
            rc.fillStyle = '#141414'
            rc.fillRect(x, y, w, h)
            if (lit) {
                const c = lights[Math.floor(Math.random() * lights.length)]!
                const room = ec.createLinearGradient(x, y, x, y + h)
                const k = rand(0.35, 1)
                room.addColorStop(0, c)
                room.addColorStop(0.75, c)
                room.addColorStop(1, '#3a2a1a')
                ec.globalAlpha = k
                ec.fillStyle = room
                ec.fillRect(x, y, w, h)
                // Blinds or curtains part-way down some windows.
                if (Math.random() < 0.4) {
                    ec.globalAlpha = 1
                    ec.fillStyle = 'rgba(0,0,0,0.7)'
                    ec.fillRect(x, y, w, h * rand(0.15, 0.6))
                }
                // A silhouette or furniture block now and then.
                if (Math.random() < 0.3) {
                    ec.fillStyle = 'rgba(0,0,0,0.6)'
                    ec.fillRect(x + w * rand(0.1, 0.6), y + h * 0.45, w * rand(0.15, 0.3), h * 0.55)
                }
                ec.globalAlpha = 1
                cc.globalAlpha = 0.6 * k
                cc.fillStyle = c
                cc.fillRect(x, y, w, h)
                cc.globalAlpha = 1
            }
            // Mullions and frames.
            cc.fillStyle = kind === 'glass' ? '#2a3440' : '#3a3936'
            cc.fillRect(x, y, w, 2)
            cc.fillRect(x, y + h - 2, w, 2)
            if (kind !== 'glass') cc.fillRect(x + w / 2 - 1, y, 2, h)
            ec.fillStyle = '#000'
            if (kind !== 'glass') ec.fillRect(x + w / 2 - 1, y, 2, h)
        }
        // Balconies and slab edges.
        if (kind === 'residential') {
            cc.fillStyle = '#6f665c'
            cc.fillRect(0, f * fh + fh - 10, S, 10)
            cc.fillStyle = 'rgba(20,20,20,0.6)'
            for (let x = 0; x < S; x += 6) cc.fillRect(x, f * fh + fh - 30, 2, 20)
        } else if (kind === 'office') {
            cc.fillStyle = '#4e4d4a'
            cc.fillRect(0, f * fh, S, fh * 0.12)
        }
    }
    const map = finish(col)
    const emissiveMap = finish(emi)
    const roughnessMap = finish(rgh, false)
    for (const t of [map, emissiveMap, roughnessMap]) {
        t.wrapS = THREE.RepeatWrapping
        t.wrapT = THREE.RepeatWrapping
    }
    return { map, emissiveMap, roughnessMap }
}

/**
 * Billboards advertising the rest of Polynux. Each is a themed gradient, a
 * big emoji mark and the game's tagline.
 */
export const BILLBOARD_ADS = [
    { bg: ['#140a24', '#3a0f5a'], icon: '🎰', title: 'POLYNUX', sub: 'PLAY. WIN. REPEAT.', col: '#ff3db8' },
    { bg: ['#06061a', '#1b1050'], icon: '🚀', title: 'VOID RUNNER', sub: 'THE DEEP IS CALLING', col: '#a98bff' },
    { bg: ['#1a1000', '#4a2c00'], icon: '⚔️', title: 'HERO QUEST', sub: 'YOUR PARTY AWAITS', col: '#ffc233' },
    { bg: ['#0e1a00', '#264a00'], icon: '🐛', title: 'COLONY', sub: 'GROW THE HIVE', col: '#a6ff4d' },
    { bg: ['#001a0e', '#00402a'], icon: '🌱', title: 'XENO', sub: 'HARVEST THE UNKNOWN', col: '#3dffb0' },
    { bg: ['#001428', '#003a66'], icon: '🏴‍☠️', title: 'PIRATE RAID', sub: 'SIX MINUTES OF PLUNDER', col: '#4dc3ff' },
    { bg: ['#14140a', '#3a3a14'], icon: '🏰', title: 'PATHWARDEN', sub: 'HOLD THE ROAD', col: '#e8e070' },
    { bg: ['#1a0004', '#4a000c'], icon: '🧟', title: 'CALL OF XENO', sub: 'SURVIVE THE NIGHT', col: '#ff4d5e' },
    { bg: ['#000a00', '#002a10'], icon: '💻', title: 'HACK OPS', sub: 'ACCESS GRANTED', col: '#33ff66' },
    { bg: ['#0a1420', '#1f3a5a'], icon: '🏙️', title: 'POLYTOWN', sub: 'BUILD YOUR CITY', col: '#7fd4ff' },
    { bg: ['#2a0018', '#5a0a3a'], icon: '🍬', title: 'CANDY MADNESS', sub: 'SWEET MULTIPLIERS', col: '#ff8ad8' },
    { bg: ['#1a0a00', '#4a1a00'], icon: '💣', title: 'FIRE IN THE HOLE', sub: 'DIG DEEP. BLOW UP.', col: '#ff7a1a' },
    { bg: ['#0a0614', '#24123a'], icon: '📖', title: 'BOOK OF SHADOWS', sub: 'TURN THE PAGE', col: '#c79bff' },
    { bg: ['#1a1400', '#3a3000'], icon: '⛏️', title: 'GOLD MINER', sub: 'STRIKE IT RICH', col: '#ffd84d' },
    { bg: ['#000e1a', '#00304a'], icon: '🛡️', title: 'FIREWALL', sub: '30 WAVES. ONE CORE.', col: '#33e0ff' },
    { bg: ['#0a0020', '#24006a'], icon: '🔷', title: 'SHAPEZZ', sub: 'GEOMETRY MAYHEM', col: '#6af0ff' },
    { bg: ['#140a00', '#3a2400'], icon: '🎲', title: 'DICE', sub: 'ROLL THE ODDS', col: '#ffb84d' },
    { bg: ['#001a14', '#00402e'], icon: '🃏', title: 'LIVE BLACKJACK', sub: 'BEAT THE DEALER', col: '#4dffc8' },
    { bg: ['#1a0a14', '#3a1430'], icon: '🐴', title: 'NEIGHCASSO DERBY', sub: 'PAINT THE FINISH', col: '#ff9ad0' },
    { bg: ['#14001a', '#38004a'], icon: '💎', title: 'GEM EXCHANGE', sub: 'TRADE UP', col: '#d07bff' },
    { bg: ['#001a1a', '#003a3a'], icon: '⚡', title: 'NITRO ENERGY', sub: 'ZERO SUGAR · ALL RUSH', col: '#33f0ff' },
    { bg: ['#0e0e14', '#24243a'], icon: '🏦', title: 'POLYNUX BANK', sub: 'YOUR COINS, SAFE', col: '#c8d4ff' }
] as const

let emojiOk: boolean | null = null

/** Colour emoji render as colour; a missing emoji font falls back to a grey box or glyph. */
function colorEmojiSupported() {
    if (emojiOk !== null) return emojiOk
    const [, ctx] = canvas(32, 32)
    ctx.font = '24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
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

export function billboardTexture(i: number) {
    const [c, ctx] = canvas(512, 256)
    const ad = BILLBOARD_ADS[i % BILLBOARD_ADS.length]!
    const g = ctx.createLinearGradient(0, 0, 512, 256)
    g.addColorStop(0, ad.bg[0])
    g.addColorStop(1, ad.bg[1])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 256)
    // Soft halo behind the mark.
    const halo = ctx.createRadialGradient(100, 128, 10, 100, 128, 130)
    halo.addColorStop(0, ad.col + '66')
    halo.addColorStop(1, ad.col + '00')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, 260, 256)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const icon = colorEmojiSupported()
    if (icon) {
        ctx.font = '110px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
        ctx.fillText(ad.icon, 100, 136)
    }
    // Without an icon the text takes the whole board.
    const left = icon ? 196 : 40
    const maxW = icon ? 300 : 440
    ctx.textAlign = 'left'
    const title = ad.title
    let size = 64
    ctx.font = `900 ${size}px system-ui, sans-serif`
    while (ctx.measureText(title).width > maxW && size > 30) {
        size -= 2
        ctx.font = `900 ${size}px system-ui, sans-serif`
    }
    ctx.shadowColor = ad.col
    ctx.shadowBlur = 22
    ctx.fillStyle = ad.col
    ctx.fillText(title, left, 112)
    ctx.shadowBlur = 0
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

/** A plate for the back of a car; a few carry vanity plates from around Polynux. */
const VANITY = ['V01D', 'H3RO', 'XENO 1', 'GEMS', 'LIMBO', 'D1CE', 'BLKJAK', 'HACKR', 'C0LONY', 'SHAPEZ', 'PIRAT3', 'NITRO']

export function plateTexture() {
    const [c, ctx] = canvas(256, 64)
    ctx.fillStyle = '#f0e9c8'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#1a3aa8'
    ctx.fillRect(0, 0, 26, 64)
    ctx.fillStyle = '#111'
    ctx.font = '700 42px "Arial Narrow", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const L = 'ABCDEFGHJKLMNPRSTVXZ'
    const letter = () => L[Math.floor(Math.random() * L.length)]
    const text = Math.random() < 0.4
        ? VANITY[Math.floor(Math.random() * VANITY.length)]!
        : `${letter()}${letter()}-${Math.floor(rand(100, 999))}-${letter()}`
    ctx.fillText(text, 140, 34)
    return finish(c)
}

/** A far skyline strip, drawn beyond the fog so it never pops. */
export function skylineTexture() {
    const W = 2048
    const H = 256
    const [c, ctx] = canvas(W, H)
    ctx.clearRect(0, 0, W, H)
    let x = 0
    while (x < W) {
        const w = 20 + Math.random() * 70
        const h = 40 + Math.random() * 190
        ctx.fillStyle = '#07080c'
        ctx.fillRect(x, H - h, w, h)
        for (let i = 0; i < h / 7; i++) {
            if (Math.random() < 0.22) {
                ctx.fillStyle = Math.random() < 0.6 ? 'rgba(255,205,150,0.55)' : 'rgba(190,220,255,0.45)'
                ctx.fillRect(x + 3 + Math.random() * (w - 8), H - h + 4 + i * 7, 2, 2)
            }
        }
        if (Math.random() < 0.2) {
            ctx.fillStyle = '#ff2b3a'
            ctx.fillRect(x + w / 2 - 1, H - h - 2, 3, 3)
        }
        x += w + Math.random() * 6
    }
    return finish(c)
}

/** Soft white disc, alpha only in the falloff. Used for every additive glow. */
export function radialTexture() {
    const [c, ctx] = canvas(128, 128)
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    return finish(c, false)
}

/** A soft dark footprint to ground vehicles on the road. */
export function shadowTexture() {
    const [c, ctx] = canvas(128, 256)
    const g = ctx.createRadialGradient(64, 128, 10, 64, 128, 128)
    g.addColorStop(0, 'rgba(0,0,0,0.95)')
    g.addColorStop(0.5, 'rgba(0,0,0,0.7)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.save()
    ctx.scale(1, 1)
    ctx.fillRect(0, 0, 128, 256)
    ctx.restore()
    return finish(c, false)
}

/** Red and white kerb blocks; one tile is two blocks along the track. */
export function kerbTexture() {
    const [c, ctx] = canvas(64, 128)
    ctx.fillStyle = '#d8d4cc'
    ctx.fillRect(0, 0, 64, 128)
    ctx.fillStyle = '#c4141e'
    ctx.fillRect(0, 0, 64, 64)
    for (let i = 0; i < 900; i++) {
        const v = rand(0, 40)
        ctx.fillStyle = `rgba(${v},${v},${v},0.25)`
        ctx.fillRect(Math.random() * 64, Math.random() * 128, 1.5, 1.5)
    }
    const t = finish(c)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    return t
}

/** The chequered start and finish line, eight squares across. */
export function checkerTexture() {
    const [c, ctx] = canvas(256, 64)
    ctx.fillStyle = '#e8e8e4'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#111114'
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 2; y++) {
            if ((x + y) % 2) ctx.fillRect(x * 32, y * 32, 32, 32)
        }
    }
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
