// The art gallery's shared ticker: every thumbnail on the page is one card in one
// requestAnimationFrame loop, redrawn only when its frame index changes and only while it
// is on screen. (The battle stage has its own fixed-timestep loop in canvas.ts.)

import { Surface } from './surface'
import { paintSurface } from './canvas'
import type { ArtAsset } from './catalog'

interface Card {
    asset: ArtAsset
    ctx: CanvasRenderingContext2D
    image: ImageData
    surface: Surface
    frame: number
    visible: boolean
    playing: boolean
}

const cards = new Set<Card>()
let raf = 0
let observer: IntersectionObserver | null = null
const byElement = new WeakMap<Element, Card>()

function draw(card: Card, f: number): void {
    card.surface.clear()
    card.asset.underlay?.(card.surface)
    card.asset.render(card.surface, f)
    paintSurface(card.ctx, card.surface, card.image)
    card.frame = f
}

function tick(now: number): void {
    raf = cards.size ? requestAnimationFrame(tick) : 0
    for (const card of cards) {
        if (!card.visible) continue
        const a = card.asset
        const n = a.frames
        let f = 0
        if (card.playing && n > 1) {
            const total = Math.floor(now / 1000 * a.fps)
            // one-shot clips rest a beat on their last frame before replaying
            f = a.loop ? total % n : Math.min(n - 1, total % (n + 6))
        }
        if (f !== card.frame) draw(card, f)
    }
}

export function registerCard(canvas: HTMLCanvasElement, asset: ArtAsset): () => void {
    canvas.width = asset.w
    canvas.height = asset.h
    const ctx = canvas.getContext('2d')!
    const card: Card = { asset, ctx, image: ctx.createImageData(asset.w, asset.h), surface: new Surface(asset.w, asset.h, 0, 0), frame: -1, visible: false, playing: true }
    cards.add(card)
    byElement.set(canvas, card)
    if (!observer) {
        observer = new IntersectionObserver((entries) => {
            for (const e of entries) { const c = byElement.get(e.target); if (c) c.visible = e.isIntersecting }
        }, { rootMargin: '200px' })
    }
    observer.observe(canvas)
    draw(card, 0)
    if (!raf) raf = requestAnimationFrame(tick)
    return () => {
        observer?.unobserve(canvas)
        cards.delete(card)
    }
}

/** Render every frame of `asset` side by side and download it as a PNG strip. */
export function downloadStrip(asset: ArtAsset): void {
    const c = document.createElement('canvas')
    c.width = asset.w * asset.frames
    c.height = asset.h
    const ctx = c.getContext('2d')!
    const frame = document.createElement('canvas')
    frame.width = asset.w
    frame.height = asset.h
    const fctx = frame.getContext('2d')!
    const image = fctx.createImageData(asset.w, asset.h)
    const s = new Surface(asset.w, asset.h, 0, 0)
    for (let f = 0; f < asset.frames; f++) {
        s.clear()
        asset.render(s, f)
        paintSurface(fctx, s, image)
        ctx.drawImage(frame, f * asset.w, 0)
    }
    c.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${asset.id.replace(/\//g, '__')}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
}
