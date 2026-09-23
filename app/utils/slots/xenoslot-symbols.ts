// Xeno Slot's pixi-reels symbol classes: the base-game reel symbol (sharp and
// motion-blurred textures, landing squash, win pulse with a coloured halo)
// and the three Hold & Win pieces (coin, UFO collector, multiplier core).
// Built at runtime because pixi.js, pixi-reels and gsap load lazily.
//
// Every view keeps its art in a centred `body` container so scale tweens pop
// around the cell centre instead of the top-left corner.

import type { Container, Sprite, Text, Texture } from 'pixi.js'
import type { SlotSymbol } from '#shared/utils/gamelogic/xenoslot'
import { XENO_NUMBER_FONT, XENO_SYMBOLS, xenoCoinTier, type XenoCoinTier, type XenoCoreMult } from '~/utils/slots/xenoslot-art'

type PixiModule = typeof import('pixi.js')
type ReelsModule = typeof import('pixi-reels')
type Gsap = typeof import('gsap').gsap
type Tween = ReturnType<Gsap['to']>

export interface XenoSymbolTextures {
    sharp: Record<SlotSymbol, Texture>
    blur: Record<SlotSymbol, Texture>
    coin: Record<XenoCoinTier, Texture>
    ufo: Texture
    ufoOn: Texture
    core: Record<XenoCoreMult, Texture>
    glow: Texture
}

export interface XenoSymbolDeps {
    PIXI: PixiModule
    REELS: ReelsModule
    gsap: Gsap
    tex: XenoSymbolTextures
    /** True while the base reels are in motion (new symbols show blurred). */
    reelsMoving: () => boolean
    format: (value: number) => string
}

function hex(color: string): number {
    return Number.parseInt(color.slice(1), 16)
}

export function makeXenoSymbols(d: XenoSymbolDeps) {
    const { PIXI, REELS, gsap, tex } = d
    const Base = REELS.ReelSymbol

    /** Shared scaffolding: centred body, a halo behind the art, tween bookkeeping. */
    abstract class XenoSymbolBase extends Base {
        body: Container = new PIXI.Container()
        halo: Sprite = new PIXI.Sprite(tex.glow)
        art: Sprite = new PIXI.Sprite()
        w = 0
        h = 0
        tweens: Tween[] = []

        constructor(size: number) {
            super()
            this.w = size
            this.h = size
            this.halo.anchor.set(0.5)
            this.halo.alpha = 0
            this.halo.blendMode = 'add'
            this.art.anchor.set(0.5)
            this.body.addChild(this.halo, this.art)
            this.view.addChild(this.body)
            this.layout()
        }

        layout() {
            this.body.position.set(this.w / 2, this.h / 2)
            const t = this.art.texture
            if (t && t.width > 1) this.art.scale.set(Math.min(this.w / t.width, this.h / t.height) * this.artScale())
            this.halo.width = this.w * 1.7
            this.halo.height = this.h * 1.7
        }

        artScale() {
            return 0.96
        }

        setArt(texture: Texture) {
            if (this.art.texture === texture) return
            this.art.texture = texture
            this.layout()
        }

        kill() {
            for (const t of this.tweens) t.kill()
            this.tweens = []
            this.body.scale.set(1)
            this.body.rotation = 0
            this.halo.alpha = 0
        }

        track(t: Tween) {
            this.tweens.push(t)
            return t
        }

        resize(w: number, h: number) {
            this.w = w
            this.h = h
            this.layout()
        }

        stopAnimation() {
            this.kill()
        }

        onDeactivate() {
            this.kill()
        }

        /** Quick elastic pop, e.g. on landing or value change. */
        pop(from = 0.7) {
            this.kill()
            this.track(gsap.fromTo(this.body.scale, { x: from, y: from }, { x: 1, y: 1, duration: 0.42, ease: 'back.out(3)' }))
        }

        pulse(scale = 1.14, halo = 0.85): Promise<void> {
            this.kill()
            return new Promise<void>((resolve) => {
                this.track(gsap.to(this.halo, { alpha: halo, duration: 0.18, ease: 'power2.out' }))
                this.track(gsap.to(this.halo, { alpha: halo * 0.45, duration: 0.5, delay: 0.18, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
                this.track(gsap.to(this.body.scale, {
                    keyframes: [
                        { x: scale, y: scale, duration: 0.2, ease: 'back.out(3)' },
                        { x: 1, y: 1, duration: 0.25, ease: 'sine.inOut' },
                        { x: scale * 0.97, y: scale * 0.97, duration: 0.2, ease: 'sine.out' },
                        { x: 1, y: 1, duration: 0.3, ease: 'sine.inOut' }
                    ],
                    onComplete: () => resolve()
                }))
            })
        }
    }

    // Base-game reel symbol -----------------------------------------------

    class XenoReelSymbol extends XenoSymbolBase {
        constructor() {
            super(1)
        }

        override artScale() {
            return 0.94
        }

        onActivate(id: string) {
            this.view.alpha = 1
            const sym = id as SlotSymbol
            this.halo.tint = hex(XENO_SYMBOLS[sym]?.color ?? '#ffffff')
            this.setArt(d.reelsMoving() ? tex.blur[sym] : tex.sharp[sym])
        }

        override onReelSpinStart() {
            const sym = this.symbolId as SlotSymbol
            if (tex.blur[sym]) this.setArt(tex.blur[sym])
        }

        override onReelSpinEnd() {
            const sym = this.symbolId as SlotSymbol
            if (tex.sharp[sym]) this.setArt(tex.sharp[sym])
        }

        override onReelLanded() {
            const sym = this.symbolId as SlotSymbol
            if (tex.sharp[sym]) this.setArt(tex.sharp[sym])
            // Landing squash: a little overshoot like a weighted drum settling.
            this.kill()
            this.track(gsap.fromTo(this.body.scale, { x: 1.05, y: 0.9 }, { x: 1, y: 1, duration: 0.32, ease: 'elastic.out(1.1, 0.45)' }))
        }

        playWin() {
            const sym = this.symbolId as SlotSymbol
            const big = sym === 'wild' || sym === 'diamond' || sym === 'seven' || sym === 'bonus'
            const p = this.pulse(big ? 1.2 : 1.13, big ? 1 : 0.75)
            if (sym === 'wild' || sym === 'bonus') {
                this.track(gsap.fromTo(this.body, { rotation: -0.08 }, { rotation: 0.08, duration: 0.12, yoyo: true, repeat: 5, ease: 'sine.inOut', onComplete: () => { this.body.rotation = 0 } }))
            }
            return p
        }
    }

    // Hold & Win pieces ---------------------------------------------------

    function valueText(size: number, fill: number, stroke: number): Text {
        const t = new PIXI.Text({
            text: '',
            style: {
                fontFamily: `'${XENO_NUMBER_FONT}', system-ui, sans-serif`,
                fontSize: size,
                fontWeight: '700',
                fill,
                align: 'center',
                stroke: { color: stroke, width: Math.round(size * 0.24), join: 'round' },
                dropShadow: { color: 0x000000, alpha: 0.6, blur: 4, distance: 2, angle: Math.PI / 2 }
            }
        })
        t.anchor.set(0.5)
        return t
    }

    class XenoCoinSymbol extends XenoSymbolBase {
        label: Text
        tier: XenoCoinTier = 'bronze'

        constructor() {
            super(1)
            this.label = valueText(26, 0xffffff, 0x1a0b2e)
            this.body.addChild(this.label)
            this.halo.tint = 0xfacc15
        }

        override artScale() {
            return 0.88
        }

        override layout() {
            super.layout()
            this.fitLabel()
        }

        fitLabel() {
            if (!this.label) return
            this.label.scale.set(1)
            const max = this.w * 0.68
            if (this.label.width > max) this.label.scale.set(max / this.label.width)
        }

        onActivate() {
            this.view.alpha = 1
            this.tier = 'bronze'
            this.setArt(tex.coin.bronze)
            this.label.text = ''
        }

        override onDeactivate() {
            super.onDeactivate()
            this.label.text = ''
        }

        setValue(amount: number, mult?: number) {
            if (mult !== undefined) this.tier = xenoCoinTier(mult)
            this.setArt(tex.coin[this.tier])
            this.halo.tint = this.tier === 'xenium' ? 0x34d399 : this.tier === 'gold' ? 0xfacc15 : 0xe2e8f0
            this.label.text = d.format(amount)
            this.fitLabel()
        }

        playWin() {
            return this.pulse(1.12, 0.8)
        }
    }

    class XenoCollectorSymbol extends XenoSymbolBase {
        label: Text
        opened = false

        constructor() {
            super(1)
            this.label = valueText(22, 0xa7f3d0, 0x052e2b)
            this.body.addChild(this.label)
            this.halo.tint = 0x5eead4
        }

        override artScale() {
            return 1
        }

        override layout() {
            super.layout()
            if (this.label) this.label.position.set(0, this.h * 0.36)
        }

        onActivate() {
            this.view.alpha = 1
            this.opened = false
            this.setArt(tex.ufo)
            this.label.text = ''
            this.track(gsap.to(this.art, { y: -3, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
        }

        open() {
            if (this.opened) return
            this.opened = true
            this.setArt(tex.ufoOn)
            this.pop(0.85)
            this.track(gsap.to(this.halo, { alpha: 0.9, duration: 0.25 }))
        }

        setCollected(amount: number) {
            this.label.text = amount > 0 ? `+${d.format(amount)}` : ''
            if (this.label.width > this.w * 0.95) this.label.scale.set((this.w * 0.95) / (this.label.width / this.label.scale.x))
        }

        override kill() {
            super.kill()
            this.art.y = 0
            if (this.opened) this.halo.alpha = 0.9
        }

        playWin() {
            this.kill()
            return new Promise<void>((resolve) => {
                this.track(gsap.fromTo(this.body.scale, { x: 1.1, y: 1.1 }, { x: 1, y: 1, duration: 0.22, ease: 'power2.out', onComplete: () => resolve() }))
            })
        }
    }

    class XenoCoreSymbol extends XenoSymbolBase {
        constructor() {
            super(1)
        }

        override artScale() {
            return 0.9
        }

        onActivate() {
            this.view.alpha = 1
            this.setArt(tex.core[2])
            this.halo.tint = 0x22d3ee
        }

        setMult(mult: number) {
            const m = (mult >= 10 ? 10 : mult >= 5 ? 5 : 2) as XenoCoreMult
            this.setArt(tex.core[m])
            this.halo.tint = m === 10 ? 0xfacc15 : m === 5 ? 0xe879f9 : 0x22d3ee
            this.pop(0.5)
            this.track(gsap.to(this.halo, { alpha: 0.95, duration: 0.2 }))
            this.track(gsap.fromTo(this.body, { rotation: -Math.PI * 2 }, { rotation: 0, duration: 0.6, ease: 'back.out(1.6)' }))
        }

        playWin() {
            return this.pulse(1.18, 1)
        }
    }

    return { XenoReelSymbol, XenoCoinSymbol, XenoCollectorSymbol, XenoCoreSymbol }
}

export type XenoSymbolClasses = ReturnType<typeof makeXenoSymbols>
