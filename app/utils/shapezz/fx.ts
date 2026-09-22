// Pre-rendered glow sprites. Canvas `shadowBlur` re-blurs every shape on every
// frame and was the single most expensive thing SHAPEZZ drew; stamping a
// cached radial gradient with drawImage costs about as much as a fillRect, so
// every bullet, spark and explosion can glow without a quality switch.

const SPRITE_SIZE = 96

const rgbCache = new Map<string, [number, number, number]>()

export function hexToRgb(hex: string): [number, number, number] {
    let rgb = rgbCache.get(hex)
    if (rgb) return rgb
    const value = hex.replace('#', '')
    const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value
    const number = parseInt(full.slice(0, 6), 16)
    rgb = [(number >> 16) & 255, (number >> 8) & 255, number & 255]
    rgbCache.set(hex, rgb)
    return rgb
}

const rgbaCache = new Map<string, string>()

/** `rgba()` string for a hex colour at a quantised alpha, cached so hot loops don't build strings. */
export function rgba(hex: string, alpha: number) {
    const quantised = Math.round(Math.max(0, Math.min(1, alpha)) * 20)
    const key = `${hex}|${quantised}`
    let value = rgbaCache.get(key)
    if (!value) {
        const [r, g, b] = hexToRgb(hex)
        value = `rgba(${r},${g},${b},${quantised / 20})`
        rgbaCache.set(key, value)
    }
    return value
}

/** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number) {
    const [r, g, b] = hexToRgb(hex)
    const target = amount > 0 ? 255 : 0
    const t = Math.abs(amount)
    const mix = (channel: number) => Math.round(channel + (target - channel) * t)
    return `#${[mix(r), mix(g), mix(b)].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function makeCanvas(size: number) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    return canvas
}

export class ShapezzSprites {
    private glows = new Map<string, HTMLCanvasElement>()
    private cores = new Map<string, HTMLCanvasElement>()
    private smoke: HTMLCanvasElement | null = null

    /** Soft halo: transparent edge, coloured body, no white core. Drawn additively. */
    glow(color: string) {
        let sprite = this.glows.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, rgba(color, 0.85))
        gradient.addColorStop(0.3, rgba(color, 0.45))
        gradient.addColorStop(0.65, rgba(color, 0.12))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.glows.set(color, sprite)
        return sprite
    }

    /** Hot plasma: white centre bleeding into the colour. For bullets and explosion cores. */
    core(color: string) {
        let sprite = this.cores.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(0.18, 'rgba(255,255,255,0.95)')
        gradient.addColorStop(0.32, rgba(color, 0.9))
        gradient.addColorStop(0.6, rgba(color, 0.25))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.cores.set(color, sprite)
        return sprite
    }

    /** Dark puff for explosion smoke, drawn with normal compositing. */
    smokePuff() {
        if (this.smoke) return this.smoke
        const sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, 'rgba(30,22,48,0.55)')
        gradient.addColorStop(0.55, 'rgba(18,14,32,0.3)')
        gradient.addColorStop(1, 'rgba(10,8,20,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.smoke = sprite
        return sprite
    }
}

/** Deterministic value noise in [-1, 1], used for smooth camera shake. */
export function smoothNoise(t: number, seed: number) {
    const i = Math.floor(t)
    const f = t - i
    const hash = (n: number) => {
        const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
        return (x - Math.floor(x)) * 2 - 1
    }
    const u = f * f * (3 - 2 * f)
    return hash(i) * (1 - u) + hash(i + 1) * u
}

export function easeOutBack(t: number) {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3)
}
