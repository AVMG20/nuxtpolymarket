// Call of Xeno — procedural textures.
//
// Drawn once into an offscreen canvas at load time. Keeps the game asset-free
// while giving the flat low-poly geometry enough surface detail to read as a
// real building: poured concrete, painted plaster, scuffed steel and timber.
//
// Everything here is deliberately desaturated and grubby. The palette comes in
// from the room theme, and these only add wear on top of it — no glow, no
// emissive trim, no colour that would not survive a grey day.

import * as THREE from 'three'

function canvas(size: number) {
    const element = document.createElement('canvas')
    element.width = size
    element.height = size
    return { element, ctx: element.getContext('2d')! }
}

function finish(element: HTMLCanvasElement, repeatX: number, repeatY: number) {
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return texture
}

/** Poured concrete in big slabs, with cast lines, stains and chipped edges. */
export function makeFloorTexture(base: string, line: string, accent: string, repeat = 6) {
    const { element, ctx } = canvas(256)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 256, 256)

    // Aggregate: fine speckle so a big slab never bands flat.
    for (let i = 0; i < 5200; i++) {
        const shade = Math.random()
        ctx.fillStyle = shade > 0.5
            ? `rgba(255,255,255,${Math.random() * 0.045})`
            : `rgba(0,0,0,${Math.random() * 0.07})`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }

    // Damp patches and old spills, blotted in with soft dark ellipses.
    for (let i = 0; i < 7; i++) {
        const x = Math.random() * 256
        const y = Math.random() * 256
        const r = 22 + Math.random() * 54
        const stain = ctx.createRadialGradient(x, y, 0, x, y, r)
        stain.addColorStop(0, `rgba(0,0,0,${0.05 + Math.random() * 0.09})`)
        stain.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = stain
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }

    // Cast joints between the slabs, cut once across each axis.
    ctx.strokeStyle = line
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(0, 128.5)
    ctx.lineTo(256, 128.5)
    ctx.moveTo(128.5, 0)
    ctx.lineTo(128.5, 256)
    ctx.stroke()
    ctx.globalAlpha = 1

    // A hairline crack wandering off one joint.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(128, 130)
    let cx = 128
    for (let y = 138; y < 250; y += 16) {
        cx += (Math.random() - 0.5) * 22
        ctx.lineTo(cx, y)
    }
    ctx.stroke()

    // Chipped corners, picked out a shade lighter than the slab.
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.22
    for (let i = 0; i < 14; i++) {
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 2 + Math.random() * 3)
    }
    ctx.globalAlpha = 1

    return finish(element, repeat, repeat)
}

/**
 * Painted plaster over block: a seam every half tile, scuff and soot toward
 * the floor, and enough patchy tone that a long wall does not read as a
 * single flat rectangle.
 */
export function makeWallTexture(base: string, panel: string, accent: string) {
    const { element, ctx } = canvas(256)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 256, 256)

    // Block courses, offset every other row.
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'
    ctx.lineWidth = 1
    for (let row = 0; row < 8; row++) {
        const y = row * 32 + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(256, y)
        ctx.stroke()
        const offset = row % 2 === 0 ? 0 : 32
        for (let x = offset; x < 256; x += 64) {
            ctx.beginPath()
            ctx.moveTo(x + 0.5, y)
            ctx.lineTo(x + 0.5, y + 32)
            ctx.stroke()
        }
    }

    // Patchy repaint: a few blocks a touch lighter than the rest.
    ctx.fillStyle = panel
    ctx.globalAlpha = 0.4
    for (let i = 0; i < 10; i++) {
        const row = Math.floor(Math.random() * 8)
        const col = Math.floor(Math.random() * 4)
        ctx.fillRect(col * 64 + (row % 2 ? 32 : 0) + 1, row * 32 + 1, 62, 30)
    }
    ctx.globalAlpha = 1

    // Grime and scuffing, heaviest along the skirting.
    for (let i = 0; i < 3200; i++) {
        const y = Math.random() * 256
        const weight = 0.03 + (y / 256) * 0.08
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * weight})`
        ctx.fillRect(Math.random() * 256, y, 3, 1)
    }
    const skirt = ctx.createLinearGradient(0, 200, 0, 256)
    skirt.addColorStop(0, 'rgba(0,0,0,0)')
    skirt.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = skirt
    ctx.fillRect(0, 200, 256, 56)

    // Bare block showing through where the paint has come away.
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.18
    for (let i = 0; i < 9; i++) {
        ctx.fillRect(Math.random() * 240, Math.random() * 240, 6 + Math.random() * 16, 4 + Math.random() * 10)
    }
    ctx.globalAlpha = 1

    return finish(element, 3, 1.5)
}

/** Board-marked concrete soffit, ribbed by the beams that carry it. */
export function makeCeilingTexture(base: string, vent: string) {
    const { element, ctx } = canvas(128)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 128, 128)

    ctx.fillStyle = vent
    ctx.globalAlpha = 0.7
    for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 128, 3)
    ctx.globalAlpha = 1

    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2)
    }
    return finish(element, 6, 6)
}

/** Riveted steel plate — decking, stair treads and machinery casings. */
export function makeMetalTexture(base = '#4a4d51', line = '#3a3d41', rivet = '#5e6266') {
    const { element, ctx } = canvas(128)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 128, 128)

    ctx.strokeStyle = line
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, 126, 126)

    ctx.fillStyle = rivet
    for (const [x, y] of [[10, 10], [118, 10], [10, 118], [118, 118]]) {
        ctx.beginPath()
        ctx.arc(x!, y!, 2.4, 0, Math.PI * 2)
        ctx.fill()
    }

    for (let i = 0; i < 700; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 1)
    }
    return finish(element, 4, 4)
}

/** Rough sawn timber, for the boards nailed across the windows. */
export function makePlankTexture() {
    const { element, ctx } = canvas(128)
    ctx.fillStyle = '#6d5738'
    ctx.fillRect(0, 0, 128, 128)

    // Grain: long streaks with the odd dark knot.
    for (let i = 0; i < 220; i++) {
        const y = Math.random() * 128
        ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.12})`
        ctx.lineWidth = 0.5 + Math.random() * 1.6
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.bezierCurveTo(42, y + (Math.random() - 0.5) * 6, 86, y + (Math.random() - 0.5) * 6, 128, y)
        ctx.stroke()
    }
    for (let i = 0; i < 3; i++) {
        const x = Math.random() * 128
        const y = Math.random() * 128
        ctx.fillStyle = 'rgba(40,26,12,0.55)'
        ctx.beginPath()
        ctx.ellipse(x, y, 5, 3, Math.random(), 0, Math.PI * 2)
        ctx.fill()
    }
    return finish(element, 1, 1)
}

/** Packed dirt and gravel for the ground outside the shell. */
export function makeDirtTexture() {
    const { element, ctx } = canvas(256)
    ctx.fillStyle = '#2b2823'
    ctx.fillRect(0, 0, 256, 256)

    for (let i = 0; i < 9000; i++) {
        const shade = Math.random()
        ctx.fillStyle = shade > 0.72
            ? `rgba(150,140,124,${Math.random() * 0.16})`
            : `rgba(0,0,0,${Math.random() * 0.2})`
        const size = 1 + Math.random() * 3
        ctx.fillRect(Math.random() * 256, Math.random() * 256, size, size)
    }
    for (let i = 0; i < 10; i++) {
        const x = Math.random() * 256
        const y = Math.random() * 256
        const r = 18 + Math.random() * 46
        const patch = ctx.createRadialGradient(x, y, 0, x, y, r)
        patch.addColorStop(0, `rgba(0,0,0,${0.08 + Math.random() * 0.12})`)
        patch.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = patch
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    return finish(element, 24, 24)
}

/**
 * A text panel — used for wall-buy price boards, perk signage and the
 * Pack-a-Punch marquee. Returns a transparent texture sized 512x256.
 */
export function makeSignTexture(opts: {
    title: string
    subtitle?: string
    color: string
    background?: string
    accent?: string
}) {
    const element = document.createElement('canvas')
    element.width = 512
    element.height = 256
    const ctx = element.getContext('2d')!

    if (opts.background) {
        ctx.fillStyle = opts.background
        ctx.fillRect(0, 0, 512, 256)
    }
    if (opts.accent) {
        ctx.strokeStyle = opts.accent
        ctx.lineWidth = 10
        ctx.strokeRect(5, 5, 502, 246)
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = opts.color
    ctx.font = 'bold 72px "Courier New", monospace'
    ctx.fillText(opts.title.toUpperCase(), 256, opts.subtitle ? 100 : 128, 470)

    if (opts.subtitle) {
        ctx.font = 'bold 56px "Courier New", monospace'
        ctx.fillStyle = opts.accent ?? opts.color
        ctx.fillText(opts.subtitle.toUpperCase(), 256, 180, 470)
    }

    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Soft round particle — smoke, blood, sparks, the muzzle glow. */
export function makeDotTexture() {
    const { element, ctx } = canvas(64)
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Four-spoke muzzle flash star. */
export function makeFlashTexture() {
    const { element, ctx } = canvas(128)
    ctx.translate(64, 64)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 60)
    gradient.addColorStop(0, 'rgba(255,255,235,1)')
    gradient.addColorStop(0.25, 'rgba(255,205,110,0.85)')
    gradient.addColorStop(1, 'rgba(255,150,40,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, 60, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = 'rgba(255,235,180,0.9)'
    for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2)
        ctx.beginPath()
        ctx.moveTo(0, -8)
        ctx.lineTo(62, 0)
        ctx.lineTo(0, 8)
        ctx.closePath()
        ctx.fill()
    }
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Diagonal hazard stripes for the barrier props. */
export function makeHazardTexture(dark = '#26241f', light = '#8f7434') {
    const { element, ctx } = canvas(128)
    ctx.fillStyle = dark
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = light
    ctx.save()
    ctx.translate(64, 64)
    ctx.rotate(-Math.PI / 4)
    for (let x = -180; x < 180; x += 32) ctx.fillRect(x, -180, 16, 360)
    ctx.restore()
    for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 2)
    }
    const texture = finish(element, 2, 1)
    return texture
}

/** Irregular splat used for both blood on the floor and scorch on the walls. */
export function makeSplatTexture(color: string) {
    const { element, ctx } = canvas(128)
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = color
    for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * 42
        const radius = 6 + Math.random() * 18
        ctx.globalAlpha = 0.35 + Math.random() * 0.5
        ctx.beginPath()
        ctx.arc(64 + Math.cos(angle) * dist, 64 + Math.sin(angle) * dist, radius, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.globalAlpha = 1
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}
