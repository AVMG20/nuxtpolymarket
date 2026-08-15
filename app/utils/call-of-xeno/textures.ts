// Call of Xeno — procedural textures.
//
// Drawn once into an offscreen canvas at load time. Keeps the game asset-free
// while giving the flat low-poly geometry enough surface detail that walls,
// floors and signage read as different materials instead of one grey mass.

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

/** Grated metal deck plating with a bolt at each corner of every tile. */
export function makeFloorTexture(base: string, line: string, accent: string, repeat = 10) {
    const { element, ctx } = canvas(256)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 256, 256)

    // Subtle noise so large flat areas do not band.
    for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }

    ctx.strokeStyle = line
    ctx.lineWidth = 3
    ctx.strokeRect(1.5, 1.5, 253, 253)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(128, 0)
    ctx.lineTo(128, 256)
    ctx.moveTo(0, 128)
    ctx.lineTo(256, 128)
    ctx.stroke()

    ctx.fillStyle = accent
    for (const [x, y] of [[16, 16], [240, 16], [16, 240], [240, 240]]) {
        ctx.beginPath()
        ctx.arc(x!, y!, 4, 0, Math.PI * 2)
        ctx.fill()
    }

    return finish(element, repeat, repeat)
}

/** Riveted bulkhead panelling with a painted hazard stripe along the base. */
export function makeWallTexture(base: string, panel: string, accent: string) {
    const { element, ctx } = canvas(256)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 256, 256)

    ctx.fillStyle = panel
    ctx.fillRect(10, 10, 108, 236)
    ctx.fillRect(138, 10, 108, 236)

    for (let i = 0; i < 2200; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 1)
    }

    ctx.fillStyle = accent
    for (let y = 26; y < 246; y += 40) {
        ctx.beginPath()
        ctx.arc(20, y, 2.6, 0, Math.PI * 2)
        ctx.arc(236, y, 2.6, 0, Math.PI * 2)
        ctx.fill()
    }

    ctx.fillStyle = accent
    ctx.globalAlpha = 0.5
    ctx.fillRect(0, 236, 256, 8)
    ctx.globalAlpha = 1

    return finish(element, 4, 2)
}

/** Dark ceiling plating with recessed vents. */
export function makeCeilingTexture(base: string, vent: string) {
    const { element, ctx } = canvas(128)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = vent
    for (let y = 18; y < 118; y += 14) ctx.fillRect(18, y, 92, 5)
    return finish(element, 8, 8)
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
export function makeHazardTexture(dark = '#1c1e22', light = '#d8a02a') {
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
