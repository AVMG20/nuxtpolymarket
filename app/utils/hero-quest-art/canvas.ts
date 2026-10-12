// Browser glue: an indexed Surface → a display canvas, and the fixed-timestep loop.
//
// The logical frame is converted to RGBA through a preallocated palette LUT into one reused
// ImageData, put on an offscreen canvas at logical resolution, then drawn to the display at
// the largest integer scale that fits — imageSmoothingEnabled off, CSS image-rendering:
// pixelated — so pixels stay crisp at any window size. Nothing here allocates per frame.

import { PALETTE_RGB } from './palette'
import type { Surface } from './surface'

/** Palette index → packed RGBA in the platform's byte order (little-endian ABGR). */
const LUT = (() => {
    const out = new Uint32Array(256)
    for (let i = 0; i < PALETTE_RGB.length; i++) {
        if (i === 0) { out[i] = 0; continue }
        const rgb = PALETTE_RGB[i]!
        const r = (rgb >> 16) & 255
        const g = (rgb >> 8) & 255
        const b = rgb & 255
        out[i] = (255 << 24 | b << 16 | g << 8 | r) >>> 0
    }
    return out
})()

export class Presenter {
    readonly w: number
    readonly h: number
    private readonly logical: HTMLCanvasElement
    private readonly lctx: CanvasRenderingContext2D
    private readonly image: ImageData
    private readonly pixels: Uint32Array
    private display: HTMLCanvasElement
    private dctx: CanvasRenderingContext2D
    scale = 1

    constructor(display: HTMLCanvasElement, w: number, h: number) {
        this.w = w
        this.h = h
        this.logical = document.createElement('canvas')
        this.logical.width = w
        this.logical.height = h
        this.lctx = this.logical.getContext('2d')!
        this.image = this.lctx.createImageData(w, h)
        this.pixels = new Uint32Array(this.image.data.buffer)
        this.display = display
        this.dctx = display.getContext('2d')!
        display.style.imageRendering = 'pixelated'
        this.fit(w, h, 1)
    }

    /**
     * Size the display canvas to the largest integer multiple of the logical frame that fits
     * (cssW × cssH) CSS pixels. Returns the CSS size the canvas should be shown at.
     */
    fit(cssW: number, cssH: number, dpr: number): { width: number, height: number } {
        const s = Math.max(1, Math.floor(Math.min(cssW * dpr / this.w, cssH * dpr / this.h)))
        this.scale = s
        this.display.width = this.w * s
        this.display.height = this.h * s
        this.dctx.imageSmoothingEnabled = false
        return { width: this.w * s / dpr, height: this.h * s / dpr }
    }

    present(src: Surface): void {
        const n = this.w * this.h
        const d = src.data
        const p = this.pixels
        for (let i = 0; i < n; i++) p[i] = LUT[d[i]!]!
        this.lctx.putImageData(this.image, 0, 0)
        this.dctx.imageSmoothingEnabled = false
        this.dctx.clearRect(0, 0, this.display.width, this.display.height)
        this.dctx.drawImage(this.logical, 0, 0, this.w * this.scale, this.h * this.scale)
    }
}

/**
 * Fixed 60 Hz simulation with rAF rendering. `update(dt)` runs in whole steps (at most 15 per
 * frame, so a backgrounded tab doesn't spiral); `render()` runs once per animation frame.
 * Returns a stop function.
 */
export function startLoop(update: (dt: number) => void, render: () => void): () => void {
    const STEP = 1 / 60
    let last = performance.now()
    let acc = 0
    let raf = 0
    const tick = (now: number): void => {
        raf = requestAnimationFrame(tick)
        let dt = (now - last) / 1000
        last = now
        if (dt > 0.25) dt = 0.25
        acc += dt
        let steps = 0
        while (acc >= STEP && steps < 15) {
            update(STEP)
            acc -= STEP
            steps++
        }
        if (steps === 15) acc = 0
        render()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
}

/** Write `src` into `image` (same size) and put it on `ctx` at the origin. */
export function paintSurface(ctx: CanvasRenderingContext2D, src: Surface, image: ImageData): void {
    const p = new Uint32Array(image.data.buffer)
    const d = src.data
    for (let i = 0; i < d.length; i++) p[i] = LUT[d[i]!]!
    ctx.putImageData(image, 0, 0)
}
