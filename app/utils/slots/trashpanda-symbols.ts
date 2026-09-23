// Trash Panda Heist's pixi-reels symbol class: sharp and motion-blurred
// textures, a landing squash, a win pulse with a coloured halo and a wobble
// for the wilds. The sticky free-spin wilds are separate symbol ids
// (wild2, wild3, …) so a pin can hold one on its cell between spins.
// Built at runtime because pixi.js, pixi-reels and gsap load lazily.

import type { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { TphSymbol } from '#shared/utils/gamelogic/trashpanda'
import { TPH_SYMBOLS, TPH_WILD_COLORS, type TphWildMult } from '~/utils/slots/trashpanda-art'

type PixiModule = typeof import('pixi.js')
type ReelsModule = typeof import('pixi-reels')
type Gsap = typeof import('gsap').gsap
type Tween = ReturnType<Gsap['to']>

/** Every id the reels can show. */
export type TphReelId = TphSymbol | `wild${TphWildMult}`

export interface TphSymbolTextures {
    sharp: Record<TphReelId, Texture>
    blur: Record<TphReelId, Texture>
    glow: Texture
}

export interface TphSymbolDeps {
    PIXI: PixiModule
    REELS: ReelsModule
    gsap: Gsap
    tex: TphSymbolTextures
    /** True while the base reels are in motion (new symbols show blurred). */
    reelsMoving: () => boolean
}

function hex(color: string): number {
    return Number.parseInt(color.slice(1), 16)
}

export function tphSymbolColor(id: string): number {
    const m = /^wild(\d+)$/.exec(id)
    if (m) return hex(TPH_WILD_COLORS[Number(m[1]) as TphWildMult] ?? '#facc15')
    return hex(TPH_SYMBOLS[id as TphSymbol]?.color ?? '#ffffff')
}

export function makeTphSymbols(d: TphSymbolDeps) {
    const { PIXI, REELS, gsap, tex } = d

    class TphReelSymbol extends REELS.ReelSymbol {
        body: Container = new PIXI.Container()
        halo: Sprite = new PIXI.Sprite(tex.glow)
        art: Sprite = new PIXI.Sprite()
        /** Opaque backing, only on pin overlays so the strip spinning underneath stays hidden. */
        plate: Graphics = new PIXI.Graphics()
        w = 1
        h = 1
        tweens: Tween[] = []

        constructor() {
            super()
            this.halo.anchor.set(0.5)
            this.halo.alpha = 0
            this.halo.blendMode = 'add'
            this.art.anchor.set(0.5)
            this.plate.visible = false
            this.body.addChild(this.plate, this.halo, this.art)
            this.view.addChild(this.body)
        }

        layout() {
            this.body.position.set(this.w / 2, this.h / 2)
            const t = this.art.texture
            if (t && t.width > 1) this.art.scale.set(Math.min(this.w / t.width, this.h / t.height) * 0.96)
            this.halo.width = this.w * 1.6
            this.halo.height = this.h * 1.6
            this.plate.clear()
            this.plate.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 14).fill({ color: 0x1a303e })
        }

        setArt(texture: Texture | undefined) {
            if (!texture || this.art.texture === texture) return
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

        get id(): TphReelId {
            return this.symbolId as TphReelId
        }

        onActivate(id: string) {
            this.view.alpha = 1
            this.plate.visible = false
            this.halo.tint = tphSymbolColor(id)
            const sym = id as TphReelId
            this.setArt(d.reelsMoving() ? tex.blur[sym] : tex.sharp[sym])
        }

        onDeactivate() {
            this.kill()
        }

        stopAnimation() {
            this.kill()
        }

        resize(w: number, h: number) {
            this.w = w
            this.h = h
            this.layout()
        }

        override onReelSpinStart() {
            this.setArt(tex.blur[this.id])
        }

        override onReelSpinEnd() {
            this.setArt(tex.sharp[this.id])
        }

        override onReelLanded() {
            this.setArt(tex.sharp[this.id])
            this.kill()
            this.track(gsap.fromTo(this.body.scale, { x: 1.06, y: 0.88 }, { x: 1, y: 1, duration: 0.34, ease: 'elastic.out(1.1, 0.45)' }))
        }

        /** Pin overlays are created mid-spin but stand still: never blurred. */
        showSharp() {
            this.plate.visible = true
            this.setArt(tex.sharp[this.id])
        }

        /** Quick elastic pop, e.g. when a sticky wild lands. */
        pop(from = 0.6) {
            this.kill()
            this.track(gsap.fromTo(this.body.scale, { x: from, y: from }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(3)' }))
        }

        playWin(): Promise<void> {
            const special = this.id.startsWith('wild') || this.id === 'safe' || this.id === 'bin' || this.id === 'boss'
            const scale = special ? 1.18 : 1.12
            this.kill()
            if (special) {
                this.track(gsap.fromTo(this.body, { rotation: -0.08 }, { rotation: 0.08, duration: 0.12, yoyo: true, repeat: 5, ease: 'sine.inOut', onComplete: () => { this.body.rotation = 0 } }))
            }
            return new Promise<void>((resolve) => {
                this.track(gsap.to(this.halo, { alpha: special ? 0.95 : 0.7, duration: 0.18, ease: 'power2.out' }))
                this.track(gsap.to(this.halo, { alpha: 0.3, duration: 0.5, delay: 0.18, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
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

    return { TphReelSymbol }
}
