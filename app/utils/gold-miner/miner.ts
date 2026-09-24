/**
 * The miner on the winch: a painted body, an IK arm that works the crank, and
 * the photo head with a jaw that drops to talk. Moods are read from the head's
 * motion and tint (a photo can't frown), and lines come out as a speech bubble
 * with a syllable-synced jaw and voice blips.
 */
import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { clamp, lerp } from '~/utils/polymasters/fx'
import { FONT, MINER, MINER_NECK, MINER_SHOULDER, PHOTO, type Art } from './art'
import { gmSfx } from './audio'

export type MinerMood = 'idle' | 'happy' | 'strain' | 'sad' | 'shock'

const ARM_UPPER = 60
const ARM_FORE = 58
/** Body scale; the head rides on top at its own scale for a chunky, big-headed look. */
export const MINER_BODY_SCALE = 0.6
const HEAD_SCALE = 0.39
const TEXT_RES = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * 1.5))

interface Speech {
    text: string
    /** Seconds the mouth keeps moving. */
    talk: number
    /** Seconds the bubble stays up. */
    life: number
    age: number
    view: Container
}

export class Miner {
    readonly root = new Container()
    private body: Sprite
    private arm = new Graphics()
    private head = new Container()
    private headTop: Sprite
    private jaw: Sprite
    private mouth: Sprite
    private hat: Sprite
    private lamp: Sprite
    private kerchief: Sprite
    private bubbleLayer: Container

    private mood: MinerMood = 'idle'
    private moodT = 0
    private hop = 0
    private time = 0
    private jawOpen = 0
    private speech: Speech | null = null
    private blipAcc = 0
    private lastLine = ''
    private readonly baseX: number
    private readonly baseY: number

    constructor(art: Art, x: number, y: number, bubbleLayer: Container) {
        this.baseX = x
        this.baseY = y
        this.bubbleLayer = bubbleLayer
        this.root.position.set(x, y)
        this.root.scale.set(MINER_BODY_SCALE)

        this.body = new Sprite(art.minerBody)
        this.body.anchor.set(0.5, 1)

        // Head pieces share the photo's pixel space; the container is anchored at the neck.
        this.mouth = new Sprite(art.head.mouth)
        this.headTop = new Sprite(art.head.top)
        this.jaw = new Sprite(art.head.jaw)
        for (const s of [this.mouth, this.headTop, this.jaw]) s.position.set(-PHOTO.neck.x, -PHOTO.neck.y)
        this.hat = new Sprite(art.hardHat)
        this.hat.anchor.set(0.5, 0.86)
        this.hat.position.set(PHOTO.crown.x - PHOTO.neck.x, PHOTO.crown.y - PHOTO.neck.y + 12)
        this.hat.rotation = -0.06
        this.lamp = new Sprite(art.glow)
        this.lamp.anchor.set(0.5)
        this.lamp.blendMode = 'add'
        this.lamp.tint = 0xfff0a0
        this.lamp.scale.set(1.6)
        this.lamp.position.set(this.hat.x, this.hat.y - 70)
        this.head.addChild(this.mouth, this.headTop, this.jaw, this.hat, this.lamp)
        this.head.scale.set(HEAD_SCALE)
        this.head.position.set(-MINER.w / 2 + MINER_NECK.x, -MINER.h + MINER_NECK.y)

        this.kerchief = new Sprite(art.kerchief)
        this.kerchief.anchor.set(0.5, 0.12)
        this.kerchief.scale.set(0.42)
        this.kerchief.position.set(this.head.x, this.head.y - 5)

        this.root.addChild(this.body, this.arm, this.head, this.kerchief)
    }

    /** World position of the top of the hat, for the speech bubble. */
    private headWorld() {
        const s = MINER_BODY_SCALE
        return {
            x: this.root.x + this.head.x * s,
            y: this.root.y + (this.head.y - (PHOTO.neck.y - PHOTO.crown.y) * this.head.scale.y) * s
        }
    }

    get handAnchor() {
        const s = MINER_BODY_SCALE
        return { x: this.root.x + (-MINER.w / 2 + MINER_SHOULDER.x - 40) * s, y: this.root.y + (-MINER.h + MINER_SHOULDER.y - 30) * s }
    }

    setMood(mood: MinerMood, secs: number) {
        this.mood = mood
        this.moodT = secs
    }

    cheer() {
        this.hop = 1
    }

    /** Says a line (or one picked from a list, never the same one twice running). */
    say(lines: string | string[], opts: { force?: boolean } = {}) {
        if (this.speech && !opts.force && this.speech.age < 0.8) return
        const pool = Array.isArray(lines) ? lines.filter(l => l !== this.lastLine) : [lines]
        // Cosmetic line choice.
        const text = pool[Math.floor(Math.random() * pool.length)] ?? (Array.isArray(lines) ? lines[0]! : lines)
        this.lastLine = text
        this.speech?.view.destroy({ children: true })

        const view = new Container()
        const label = new Text({
            text,
            style: { fontFamily: FONT, fontSize: 20, fill: '#3a2410', align: 'center', wordWrap: true, wordWrapWidth: 190 },
            resolution: TEXT_RES
        })
        label.anchor.set(0.5)
        const w = Math.max(70, label.width + 26)
        const h = label.height + 16
        const g = new Graphics()
        g.roundRect(-w / 2 + 3, -h / 2 + 4, w, h, 14).fill({ color: 0x000000, alpha: 0.25 })
        g.roundRect(-w / 2, -h / 2, w, h, 14).fill({ color: 0xfff8e6 }).stroke({ width: 3, color: 0x3a2410 })
        // Tail pointing back at the miner's mouth.
        g.moveTo(-w / 2 + 8, h / 2 - 12).lineTo(-w / 2 - 16, h / 2 + 10).lineTo(-w / 2 + 22, h / 2 - 2).closePath()
            .fill({ color: 0xfff8e6 }).stroke({ width: 3, color: 0x3a2410 })
        g.rect(-w / 2 + 4, h / 2 - 16, 22, 12).fill({ color: 0xfff8e6 })
        view.addChild(g, label)
        const at = this.headWorld()
        view.position.set(at.x + 38 + w / 2, at.y + 26)
        view.scale.set(0.2)
        this.bubbleLayer.addChild(view)
        const syllables = Math.max(2, Math.round(text.replace(/[^a-z]/gi, '').length / 2.6))
        this.speech = { text, talk: Math.min(2.4, syllables * 0.13), life: 1.4 + syllables * 0.13, age: 0, view }
        this.blipAcc = 0
    }

    update(dt: number, crank: { x: number, y: number } | null, restAt: { x: number, y: number }, throwing: boolean, strainPull: boolean) {
        this.time += dt
        if (this.moodT > 0) {
            this.moodT -= dt
            if (this.moodT <= 0) this.mood = 'idle'
        }
        if (this.mood === 'strain' && !strainPull) this.mood = 'idle'

        // Body: hop on a big haul, jitter when straining, breathe otherwise.
        this.hop = Math.max(0, this.hop - dt * 2.4)
        const hopY = this.hop > 0 ? -Math.sin((1 - this.hop) * Math.PI) * 18 : 0
        const strain = this.mood === 'strain'
        const breathe = Math.sin(this.time * 2.2) * 0.012
        this.root.position.set(this.baseX + (strain ? (Math.random() - 0.5) * 1.6 : 0), this.baseY + hopY)
        this.body.scale.set(1 + (this.hop > 0.6 ? 0.05 : 0), 1 + breathe - (this.hop > 0.6 ? 0.05 : 0))

        // Head: the mood lives in its motion and tint.
        const baseY = -MINER.h + MINER_NECK.y - breathe * 60
        let rot = Math.sin(this.time * 1.3) * 0.035
        let dy = 0
        let tint = 0xffffff
        let squash = 0
        if (this.mood === 'happy') {
            rot = Math.sin(this.time * 9) * 0.08
            dy = -Math.abs(Math.sin(this.time * 9)) * 3
            squash = Math.abs(Math.sin(this.time * 9)) * 0.03
        } else if (this.mood === 'strain') {
            rot = Math.sin(this.time * 34) * 0.035
            tint = 0xffb4a0
            squash = 0.04
        } else if (this.mood === 'sad') {
            rot = -0.12 + Math.sin(this.time * 1.5) * 0.02
            dy = 3
            tint = 0xd4dcf2
        } else if (this.mood === 'shock') {
            rot = Math.sin(this.time * 20) * 0.02
            dy = -4
            squash = -0.05
        }
        this.head.rotation = lerp(this.head.rotation, rot, Math.min(1, dt * 12))
        this.head.y = lerp(this.head.y, baseY + dy, Math.min(1, dt * 12))
        const hs = HEAD_SCALE
        this.head.scale.set(hs * (1 + squash), hs * (1 - squash))
        for (const s of [this.headTop, this.jaw]) s.tint = tint
        this.kerchief.y = this.head.y - 5

        // Jaw: syllables while talking, clenched when straining, agape when shocked.
        let open = 0
        if (this.speech && this.speech.age < this.speech.talk) {
            const k = this.speech.age * 7.5
            open = Math.max(0, Math.sin(k * Math.PI)) * (0.55 + 0.45 * Math.abs(Math.sin(k * 1.7)))
            this.blipAcc += dt
            if (this.blipAcc > 0.13) {
                this.blipAcc = 0
                gmSfx.voice(this.mood === 'sad' ? 0.8 : this.mood === 'happy' ? 1.2 : 1)
            }
        } else if (this.mood === 'shock') {
            open = 0.9
        } else if (this.mood === 'strain') {
            open = 0.25 + Math.abs(Math.sin(this.time * 18)) * 0.1
        } else if (this.mood === 'happy') {
            open = 0.35
        }
        this.jawOpen = lerp(this.jawOpen, open, Math.min(1, dt * 22))
        this.jaw.y = -PHOTO.neck.y + this.jawOpen * PHOTO.jawOpen
        this.lamp.alpha = 0.45 + Math.sin(this.time * 9) * 0.05

        // Speech bubble.
        if (this.speech) {
            const sp = this.speech
            sp.age += dt
            const pop = Math.min(1, sp.age / 0.18)
            const out = sp.age > sp.life - 0.2 ? Math.max(0, (sp.life - sp.age) / 0.2) : 1
            sp.view.scale.set((0.4 + 0.6 * (1 - (1 - pop) ** 3) + Math.sin(pop * Math.PI) * 0.08) * out)
            sp.view.alpha = out
            const at = this.headWorld()
            sp.view.y = at.y + 26 + Math.sin(this.time * 3) * 1.5
            if (sp.age >= sp.life) {
                sp.view.destroy({ children: true })
                this.speech = null
            }
        }

        // Arm: crank while reeling, wind up when throwing, otherwise rest on the frame.
        const target = throwing ? { x: this.baseX - 30, y: this.baseY - 150 } : crank ?? restAt
        this.drawArm(target)
    }

    /** Two-bone IK from the shoulder to a world-space target; sleeve, forearm and glove. */
    private drawArm(targetWorld: { x: number, y: number }) {
        const s = MINER_BODY_SCALE
        const root = this.root.position
        const t = { x: (targetWorld.x - root.x) / s, y: (targetWorld.y - root.y) / s }
        const sh = { x: -MINER.w / 2 + MINER_SHOULDER.x, y: -MINER.h + MINER_SHOULDER.y }
        const dx = t.x - sh.x
        const dy = t.y - sh.y
        const d = clamp(Math.hypot(dx, dy), Math.abs(ARM_UPPER - ARM_FORE) + 1, ARM_UPPER + ARM_FORE - 1)
        const base = Math.atan2(dy, dx)
        const alpha = Math.acos(clamp((ARM_UPPER ** 2 + d * d - ARM_FORE ** 2) / (2 * ARM_UPPER * d), -1, 1))
        const e1 = { x: sh.x + Math.cos(base + alpha) * ARM_UPPER, y: sh.y + Math.sin(base + alpha) * ARM_UPPER }
        const e2 = { x: sh.x + Math.cos(base - alpha) * ARM_UPPER, y: sh.y + Math.sin(base - alpha) * ARM_UPPER }
        const elbow = e1.y > e2.y ? e1 : e2
        const hand = { x: sh.x + Math.cos(base) * d, y: sh.y + Math.sin(base) * d }
        const g = this.arm
        g.clear()
        g.moveTo(sh.x, sh.y).lineTo(elbow.x, elbow.y).stroke({ width: 22, color: 0x2a150a, cap: 'round' })
        g.moveTo(sh.x, sh.y).lineTo(elbow.x, elbow.y).stroke({ width: 17, color: 0xc8352a, cap: 'round' })
        g.moveTo(elbow.x, elbow.y).lineTo(hand.x, hand.y).stroke({ width: 17, color: 0x2a150a, cap: 'round' })
        g.moveTo(elbow.x, elbow.y).lineTo(hand.x, hand.y).stroke({ width: 13, color: 0xf0c0a0, cap: 'round' })
        const cx = lerp(elbow.x, hand.x, 0.15)
        const cy = lerp(elbow.y, hand.y, 0.15)
        g.circle(cx, cy, 9).fill({ color: 0xa82a20 }).stroke({ width: 2.5, color: 0x2a150a })
        g.circle(hand.x, hand.y, 10).fill({ color: 0x8a5a30 }).stroke({ width: 3, color: 0x2a150a })
        g.circle(hand.x - 3, hand.y - 3, 3).fill({ color: 0xc08a58 })
    }
}

/** What the miner says, by occasion. */
export const LINES = {
    start: ['Let\'s get digging!', 'Gold, here I come!', 'Time to strike it rich!', 'Stand back, I\'m a professional.'],
    rich: ['Look at all that gold!', 'Mother lode, baby!', 'Jackpot vein!'],
    thin: ['Slim pickings...', 'Hmm, this looks tight.', 'Every nugget counts!'],
    bigGold: ['Ka-ching!', 'Now we\'re talking!', 'Look at that beauty!', 'Heavy... but worth it!'],
    gold: ['Nice!', 'Shiny!', 'In the bag!', 'Easy money.'],
    diamond: ['Diamonds!!', 'Ooh, sparkly!', 'Jackpot!'],
    rock: ['Just a rock...', 'Not again...', 'Who ordered rocks?', 'Ugh.'],
    junk: ['Eh, it\'s something.', 'Spooky.'],
    heavy: ['Hnnngh!', 'So... heavy...', 'Come on!'],
    bagCash: ['Cash money!', 'Lucky bag!'],
    strength: ['I feel STRONG!', 'Power up!'],
    dynamiteGain: ['More dynamite!', 'Kaboom supplies!'],
    blast: ['Fire in the hole!', 'Boom!', 'Bye bye!'],
    tnt: ['Whoa!', 'Yikes!', 'My ears!'],
    goal: ['Goal reached!', 'That\'s the target!', 'We made it!'],
    hurry: ['Hurry up!', 'Clock\'s ticking!'],
    attract: ['Press start, partner!', 'Gold won\'t dig itself!', 'Feeling lucky?']
}
