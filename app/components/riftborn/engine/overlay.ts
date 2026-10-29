/*
 * Screen-space layer on top of the world: vignettes, colour flashes,
 * centred announcements (streaks, GameApi.announce) and the boss banner.
 */
import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js'

interface Announcement {
    t: Text
    life: number
    max: number
    size: number
}

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif'

function hexCss(c: number): string {
    return '#' + c.toString(16).padStart(6, '0')
}

export class Overlay {
    readonly root = new Container()
    private readonly vignette: Sprite
    private readonly lowHp: Sprite
    private readonly flashSprite: Sprite
    private readonly ultEdge: Sprite
    private readonly white: Sprite
    /** 0..1 full-screen white-out for biome travel, driven by the game */
    whiteout = 0
    whiteColor = 0xffffff
    private stage: { title: Text, sub: Text, life: number, max: number } | null = null
    private readonly texts = new Container()
    private readonly anns: Announcement[] = []
    private banner: { root: Container, band: Graphics, title: Text, name: Text, life: number, max: number, color: number } | null = null
    private flashA = 0
    private lowHpA = 0
    private w = 1
    private h = 1
    ultGlow = 0
    ultColor = 0xffffff

    constructor(vignetteTex: Texture, redTex: Texture, whiteTex: Texture) {
        this.vignette = new Sprite(vignetteTex)
        this.lowHp = new Sprite(redTex)
        this.lowHp.alpha = 0
        this.ultEdge = new Sprite(whiteTex)
        this.ultEdge.alpha = 0
        this.ultEdge.blendMode = 'add'
        this.flashSprite = new Sprite(Texture.WHITE)
        this.flashSprite.alpha = 0
        this.white = new Sprite(Texture.WHITE)
        this.white.alpha = 0
        this.root.addChild(this.vignette, this.lowHp, this.ultEdge, this.flashSprite, this.white, this.texts)
    }

    setVignette(tex: Texture): void {
        this.vignette.texture = tex
    }

    /** Biome title card: small caption over the biome name */
    stageBanner(name: string, color: number, caption: string): void {
        this.stage?.title.destroy()
        this.stage?.sub.destroy()
        const res = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        const title = new Text({
            text: name.toUpperCase(),
            style: new TextStyle({ fontFamily: FONT, fontWeight: '900', fontSize: 64, fill: hexCss(color), stroke: { color: '#06030c', width: 8, join: 'round' }, dropShadow: { color: hexCss(color), blur: 26, distance: 0, alpha: 0.9, angle: 0 }, letterSpacing: 12 }),
            resolution: res
        })
        const sub = new Text({
            text: caption,
            style: new TextStyle({ fontFamily: FONT, fontWeight: '800', fontSize: 18, fill: '#ffffff', stroke: { color: '#06030c', width: 4, join: 'round' }, letterSpacing: 8 }),
            resolution: res
        })
        title.anchor.set(0.5)
        sub.anchor.set(0.5)
        this.texts.addChild(title, sub)
        this.stage = { title, sub, life: 0, max: 3 }
    }

    flash(color: number, alpha: number): void {
        if (alpha >= this.flashA) this.flashSprite.tint = color
        this.flashA = Math.min(0.85, Math.max(this.flashA, alpha))
    }

    announce(text: string, color = 0xffffff, size = 64): void {
        while (this.anns.length >= 3) {
            const old = this.anns.shift()!
            old.t.destroy()
        }
        const t = new Text({
            text,
            style: new TextStyle({
                fontFamily: FONT,
                fontWeight: '900',
                fontSize: size,
                fill: hexCss(color),
                stroke: { color: '#0a0612', width: Math.max(4, size / 8), join: 'round' },
                dropShadow: { color: hexCss(color), blur: 18, distance: 0, alpha: 0.75, angle: 0 },
                letterSpacing: Math.round(size / 18),
                align: 'center'
            }),
            resolution: Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        })
        t.anchor.set(0.5)
        this.texts.addChild(t)
        this.anns.push({ t, life: 0, max: 1.8, size })
    }

    bossBanner(name: string, final: boolean): void {
        if (this.banner) this.banner.root.destroy({ children: true })
        const color = final ? 0xff3fa4 : 0xff3a3a
        const root = new Container()
        const band = new Graphics()
        const title = new Text({
            text: final ? '⚠  THE RIFT OPENS  ⚠' : '⚠  WARNING  ⚠',
            style: new TextStyle({ fontFamily: FONT, fontWeight: '900', fontSize: 54, fill: hexCss(color), stroke: { color: '#12040a', width: 7, join: 'round' }, dropShadow: { color: hexCss(color), blur: 22, distance: 0, alpha: 0.9, angle: 0 }, letterSpacing: 10 }),
            resolution: Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        })
        const sub = new Text({
            text: name.toUpperCase(),
            style: new TextStyle({ fontFamily: FONT, fontWeight: '800', fontSize: 26, fill: '#ffffff', stroke: { color: '#12040a', width: 5, join: 'round' }, letterSpacing: 6 }),
            resolution: Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        })
        title.anchor.set(0.5)
        sub.anchor.set(0.5)
        root.addChild(band, title, sub)
        this.root.addChild(root)
        this.banner = { root, band, title, name: sub, life: 0, max: 3, color }
    }

    update(dt: number, w: number, h: number, hpFrac: number, time: number): void {
        this.w = w
        this.h = h
        this.vignette.width = w
        this.vignette.height = h
        this.lowHp.width = w
        this.lowHp.height = h
        this.ultEdge.width = w
        this.ultEdge.height = h
        this.flashSprite.width = w
        this.flashSprite.height = h

        this.flashA = Math.max(0, this.flashA - dt * 2.8)
        this.flashSprite.alpha = this.flashA
        this.white.width = w
        this.white.height = h
        this.white.tint = this.whiteColor
        this.white.alpha = Math.min(1, Math.max(0, this.whiteout))

        // Low health: red at the screen edges only, with a heartbeat that quickens toward 0
        const danger = hpFrac < 0.4 ? 1 - hpFrac / 0.4 : 0
        let target = 0
        if (danger > 0) {
            const bpm = 70 + danger * 70
            const ph = (time * bpm / 60) % 1
            const beat = Math.exp(-ph * 14) + 0.6 * Math.exp(-Math.max(0, ph - 0.2) * 14) * (ph > 0.2 ? 1 : 0)
            target = 0.25 + danger * 0.4 + beat * (0.15 + danger * 0.3)
        }
        this.lowHpA += (target - this.lowHpA) * Math.min(1, dt * 14)
        this.lowHp.alpha = Math.max(0, this.lowHpA)

        const st = this.stage
        if (st) {
            st.life += dt
            if (st.life >= st.max) {
                st.title.destroy()
                st.sub.destroy()
                this.stage = null
            } else {
                const t = st.life
                const a = t < 0.35 ? t / 0.35 : t > st.max - 0.6 ? (st.max - t) / 0.6 : 1
                const fit = Math.min(1, (w * 0.9) / Math.max(1, st.title.width / st.title.scale.x))
                st.title.scale.set(fit * (1.12 - 0.12 * Math.min(1, t / 0.5)))
                st.title.alpha = a
                st.title.position.set(w / 2, h * 0.36)
                st.sub.alpha = a * 0.85
                st.sub.position.set(w / 2, h * 0.36 - 52 * fit)
            }
        }

        this.ultEdge.tint = this.ultColor
        this.ultEdge.alpha = this.ultGlow * (0.12 + Math.sin(time * 4) * 0.05)

        let y = h * 0.3
        for (let i = this.anns.length - 1; i >= 0; i--) {
            const a = this.anns[i]!
            a.life += dt
            if (a.life >= a.max) {
                a.t.destroy()
                this.anns.splice(i, 1)
                continue
            }
            const t = a.life
            const pop = t < 0.18 ? 2.2 - 1.2 * easeOutBack(t / 0.18) : 1 + Math.max(0, 0.06 - (t - 0.18) * 0.1)
            const fit = Math.min(1, (w * 0.92) / Math.max(1, a.t.width / a.t.scale.x))
            a.t.scale.set(pop * fit)
            a.t.alpha = t < 0.1 ? t / 0.1 : t > a.max - 0.35 ? (a.max - t) / 0.35 : 1
            a.t.position.set(w / 2, y)
            y += a.size * 1.15 * fit
        }

        const b = this.banner
        if (b) {
            b.life += dt
            if (b.life >= b.max) {
                b.root.destroy({ children: true })
                this.banner = null
            } else {
                const t = b.life
                const open = t < 0.25 ? easeOutBack(t / 0.25) : t > b.max - 0.4 ? Math.max(0, (b.max - t) / 0.4) : 1
                const cy = h * 0.42
                const bh = 120 * open
                b.band.clear()
                b.band.rect(0, cy - bh / 2, w, bh).fill({ color: 0x000000, alpha: 0.6 })
                b.band.rect(0, cy - bh / 2, w, 3).fill({ color: b.color, alpha: 0.9 })
                b.band.rect(0, cy + bh / 2 - 3, w, 3).fill({ color: b.color, alpha: 0.9 })
                // Scrolling hazard stripes
                const off = (time * 120) % 60
                for (let x = -60 + off; x < w + 60; x += 60) {
                    b.band.poly([x, cy - bh / 2 + 3, x + 24, cy - bh / 2 + 3, x + 12, cy - bh / 2 + 15, x - 12, cy - bh / 2 + 15]).fill({ color: b.color, alpha: 0.35 })
                    b.band.poly([x, cy + bh / 2 - 15, x + 24, cy + bh / 2 - 15, x + 12, cy + bh / 2 - 3, x - 12, cy + bh / 2 - 3]).fill({ color: b.color, alpha: 0.35 })
                }
                const flicker = Math.sin(t * 22) > -0.3 ? 1 : 0.55
                const fit = Math.min(1, (w * 0.9) / Math.max(1, b.title.width / b.title.scale.x))
                b.title.scale.set(fit * (0.8 + 0.2 * open))
                b.title.alpha = open * flicker
                b.title.position.set(w / 2, cy - 14)
                b.name.alpha = open
                b.name.scale.set(Math.min(1, (w * 0.9) / Math.max(1, b.name.width / b.name.scale.x)))
                b.name.position.set(w / 2 + (1 - open) * 80, cy + 32)
            }
        }
    }

    get size(): { w: number, h: number } {
        return { w: this.w, h: this.h }
    }

    destroy(): void {
        for (const a of this.anns) a.t.destroy()
        this.anns.length = 0
        this.banner?.root.destroy({ children: true })
        this.banner = null
        this.stage = null
        this.root.destroy({ children: true })
    }
}

export function easeOutBack(t: number): number {
    const c1 = 1.70158
    const c3 = c1 + 1
    const x = Math.min(1, Math.max(0, t)) - 1
    return 1 + c3 * x * x * x + c1 * x * x
}
