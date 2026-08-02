import gsap from 'gsap'
import type { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { chipStack } from '#shared/utils/live-blackjack/chips'
import { LB_TIMERS } from '#shared/utils/live-blackjack/rules'
import type { LbAction, LbHand, LbTableState } from '#shared/utils/live-blackjack/types'
import formatNumber from '~/utils/format-number'
import { CARD_W, cardKey, type LbTextures } from './art'

type Pixi = typeof import('pixi.js')

export const STAGE_W = 1600
export const STAGE_H = 1000

const FELT = 0x0f5132
const FELT_EDGE = 0x0a3a24
const RAIL = 0x3b2416
const GOLD = 0xd9b167

const DEALER_POS = { x: 800, y: 196 }
// Shoe and tray sit at mid-height: the top corners belong to the scoreboard and
// the shoe/count readouts, which are DOM panels layered over this canvas.
const SHOE_POS = { x: 1462, y: 344 }
const DISCARD_POS = { x: 138, y: 344 }
const RACK_Y = 902

const SEAT_LAYOUT = [
    { x: 252, y: 536 },
    { x: 526, y: 586 },
    { x: 800, y: 610 },
    { x: 1074, y: 586 },
    { x: 1348, y: 536 }
] as const

const SEAT_WIDTH = 272
const HAND_Y_OFFSET = -76
const BET_Y_OFFSET = 92
const PLATE_Y_OFFSET = 156

interface CardTarget {
    id: string
    key: string | null
    x: number
    y: number
    rotation: number
    scale: number
    order: number
}

interface LiveCard {
    sprite: Sprite
    key: string | null
    x: number
    y: number
    rotation: number
    scale: number
}

export interface LbSceneCallbacks {
    onSit: (seat: number) => void
    onChip: (value: number) => void
}

/** Colour-coded so a glance across the table tells you what someone did. */
const ACTION_FLASH: Record<LbAction, { text: string, color: number }> = {
    hit: { text: 'HIT', color: 0x2563eb },
    stand: { text: 'STAND', color: 0x475569 },
    double: { text: 'DOUBLE', color: 0x15803d },
    split: { text: 'SPLIT', color: 0x7c3aed },
    surrender: { text: 'SURRENDER', color: 0xb45309 }
}

const label = (PIXI: Pixi, text: string, size: number, color: number, weight: '400' | '600' | '700' | '800' = '600') =>
    new PIXI.Text({
        text,
        style: {
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill: color
        }
    })

export class LiveBlackjackScene {
    private felt: Container
    private cardLayer: Container
    private chipLayer: Container
    private uiLayer: Container
    private rackLayer: Container
    private flashLayer: Container

    private cards = new Map<string, LiveCard>()
    private seatNodes: SeatNode[] = []
    private rackChips: { value: number, sprite: Sprite, glow: Graphics }[] = []
    private dealerScore: Container
    private dealerScoreText!: Text
    private timerArc: Graphics
    private phaseText: Text

    private state: LbTableState | null = null
    private balance = 0
    private dealtOrder = 0
    /** serverNow - clientNow, so countdowns stay honest on a drifting clock. */
    private clockSkew = 0

    constructor(
        private PIXI: Pixi,
        private app: Application,
        private tex: LbTextures,
        private callbacks: LbSceneCallbacks
    ) {
        this.felt = new PIXI.Container()
        this.chipLayer = new PIXI.Container()
        this.cardLayer = new PIXI.Container()
        this.uiLayer = new PIXI.Container()
        this.rackLayer = new PIXI.Container()
        // Above everything: seat badges are rebuilt on every snapshot and would
        // otherwise be drawn over the flash mid-animation.
        this.flashLayer = new PIXI.Container()
        app.stage.addChild(
            this.felt, this.chipLayer, this.cardLayer, this.uiLayer, this.rackLayer, this.flashLayer
        )

        this.drawTable()
        this.seatNodes = SEAT_LAYOUT.map((pos, i) => new SeatNode(PIXI, this.uiLayer, this.chipLayer, i, pos, callbacks))

        this.dealerScore = this.buildDealerBadge()
        this.dealerScore.position.set(DEALER_POS.x, DEALER_POS.y + 118)
        this.uiLayer.addChild(this.dealerScore)

        this.timerArc = new PIXI.Graphics()
        this.uiLayer.addChild(this.timerArc)

        this.phaseText = label(PIXI, '', 26, 0xf7f3e8, '700')
        this.phaseText.anchor.set(0.5)
        this.phaseText.position.set(DEALER_POS.x, 362)
        this.uiLayer.addChild(this.phaseText)

        this.buildRack()
        app.ticker.add(this.tick)
    }

    // ─── static table art ──────────────────────────────────────────────────

    private drawTable() {
        const g = new this.PIXI.Graphics()

        g.roundRect(0, 0, STAGE_W, STAGE_H, 0).fill(0x120c08)
        g.roundRect(24, 34, STAGE_W - 48, 800, 190).fill(RAIL)
        g.roundRect(24, 34, STAGE_W - 48, 800, 190).stroke({ width: 3, color: 0x1c1109 })
        g.roundRect(46, 56, STAGE_W - 92, 756, 172).fill(FELT_EDGE)
        g.roundRect(54, 64, STAGE_W - 108, 740, 166).fill(FELT)

        // Dealer arc and the payout legend that sits on every real table.
        g.arc(DEALER_POS.x, 40, 470, 0.18 * Math.PI, 0.82 * Math.PI)
        g.stroke({ width: 3, color: GOLD, alpha: 0.35 })
        g.arc(DEALER_POS.x, 40, 486, 0.19 * Math.PI, 0.81 * Math.PI)
        g.stroke({ width: 1.5, color: GOLD, alpha: 0.2 })

        for (const seat of SEAT_LAYOUT) {
            g.circle(seat.x, seat.y + BET_Y_OFFSET, 48).stroke({ width: 2.5, color: GOLD, alpha: 0.4 })
            g.circle(seat.x, seat.y + BET_Y_OFFSET, 41).stroke({ width: 1, color: GOLD, alpha: 0.22 })
        }

        // Shoe and discard tray, so the count has somewhere to visibly live.
        g.roundRect(SHOE_POS.x - 52, SHOE_POS.y - 44, 104, 88, 10).fill(0x24160e).stroke({ width: 2, color: GOLD, alpha: 0.5 })
        g.roundRect(DISCARD_POS.x - 52, DISCARD_POS.y - 44, 104, 88, 10).fill(0x1b1009).stroke({ width: 2, color: GOLD, alpha: 0.3 })

        this.felt.addChild(g)

        const rules = label(this.PIXI, 'BLACKJACK PAYS 3 TO 2', 22, GOLD, '700')
        rules.anchor.set(0.5)
        rules.alpha = 0.75
        rules.position.set(DEALER_POS.x, 396)
        this.felt.addChild(rules)

        const stands = label(this.PIXI, 'Dealer must stand on all 17  ·  Insurance pays 2 to 1', 16, 0xe8dcc0, '600')
        stands.anchor.set(0.5)
        stands.alpha = 0.5
        stands.position.set(DEALER_POS.x, 424)
        this.felt.addChild(stands)

        const shoeLabel = label(this.PIXI, 'SHOE', 13, GOLD, '700')
        shoeLabel.anchor.set(0.5)
        shoeLabel.alpha = 0.7
        shoeLabel.position.set(SHOE_POS.x, SHOE_POS.y + 58)
        this.felt.addChild(shoeLabel)

        const discardLabel = label(this.PIXI, 'DISCARD', 13, GOLD, '700')
        discardLabel.anchor.set(0.5)
        discardLabel.alpha = 0.55
        discardLabel.position.set(DISCARD_POS.x, DISCARD_POS.y + 58)
        this.felt.addChild(discardLabel)
    }

    private buildDealerBadge(): Container {
        const box = new this.PIXI.Container()
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-40, -18, 80, 36, 18).fill({ color: 0x0b0806, alpha: 0.85 })
        bg.roundRect(-40, -18, 80, 36, 18).stroke({ width: 1.5, color: GOLD, alpha: 0.55 })
        box.addChild(bg)
        this.dealerScoreText = label(this.PIXI, '', 20, 0xf7f3e8, '700')
        this.dealerScoreText.anchor.set(0.5)
        box.addChild(this.dealerScoreText)
        box.visible = false
        return box
    }

    // ─── chip rack ─────────────────────────────────────────────────────────

    private buildRack() {
        const plate = new this.PIXI.Graphics()
        plate.roundRect(STAGE_W / 2 - 430, RACK_Y - 62, 860, 124, 62).fill({ color: 0x1b1109, alpha: 0.92 })
        plate.roundRect(STAGE_W / 2 - 430, RACK_Y - 62, 860, 124, 62).stroke({ width: 2, color: GOLD, alpha: 0.35 })
        this.rackLayer.addChild(plate)
    }

    /** The rack window depends on the player's bankroll, so it is rebuilt on change. */
    private syncRack(values: number[], enabled: boolean) {
        const same = this.rackChips.length === values.length
            && this.rackChips.every((c, i) => c.value === values[i])

        if (!same) {
            for (const chip of this.rackChips) {
                chip.sprite.destroy()
                chip.glow.destroy()
            }
            this.rackChips = []

            const gap = 112
            const startX = STAGE_W / 2 - ((values.length - 1) * gap) / 2
            for (let i = 0; i < values.length; i++) {
                const value = values[i]!
                const glow = new this.PIXI.Graphics()
                glow.circle(0, 0, 54).fill({ color: GOLD, alpha: 0.28 })
                glow.position.set(startX + i * gap, RACK_Y)
                glow.visible = false
                this.rackLayer.addChild(glow)

                const sprite = new this.PIXI.Sprite(this.tex.chip.get(value)!)
                sprite.anchor.set(0.5)
                sprite.position.set(startX + i * gap, RACK_Y)
                sprite.eventMode = 'static'
                sprite.cursor = 'pointer'
                sprite.on('pointerover', () => {
                    if (sprite.alpha < 0.9) return
                    glow.visible = true
                    gsap.to(sprite.scale, { x: 1.12, y: 1.12, duration: 0.16 })
                })
                sprite.on('pointerout', () => {
                    glow.visible = false
                    gsap.to(sprite.scale, { x: 1, y: 1, duration: 0.16 })
                })
                sprite.on('pointerdown', () => {
                    if (sprite.alpha < 0.9) return
                    gsap.fromTo(sprite.scale, { x: 0.86, y: 0.86 }, { x: 1.12, y: 1.12, duration: 0.24, ease: 'back.out(3)' })
                    this.callbacks.onChip(value)
                })
                this.rackLayer.addChild(sprite)
                this.rackChips.push({ value, sprite, glow })
            }
        }

        for (const chip of this.rackChips) {
            const affordable = enabled && chip.value <= this.balance
            chip.sprite.alpha = affordable ? 1 : 0.32
            chip.sprite.cursor = affordable ? 'pointer' : 'default'
            if (!affordable) chip.glow.visible = false
        }
    }

    // ─── per-frame timer ring ──────────────────────────────────────────────

    private tick = () => {
        const state = this.state
        this.timerArc.clear()
        if (!state?.phaseEndsAt) return

        const total = state.phase === 'betting'
            ? LB_TIMERS.betting
            : state.phase === 'insurance'
                ? LB_TIMERS.insurance
                : state.phase === 'playing' ? LB_TIMERS.turn : 0
        if (!total) return
        const left = Math.max(0, state.phaseEndsAt - (Date.now() + this.clockSkew))
        const frac = Math.max(0, Math.min(1, left / total))
        if (frac <= 0) return

        const seat = state.activeSeat !== null ? SEAT_LAYOUT[state.activeSeat] : null
        const center = seat
            ? { x: seat.x, y: seat.y + BET_Y_OFFSET }
            : { x: DEALER_POS.x, y: 362 }
        const radius = seat ? 62 : 210
        const color = frac < 0.28 ? 0xef4444 : GOLD

        this.timerArc.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
        this.timerArc.stroke({ width: seat ? 6 : 4, color, alpha: 0.9, cap: 'round' })
    }

    // ─── state application ─────────────────────────────────────────────────

    update(state: LbTableState, youId: string | null, balance: number, rack: number[]) {
        this.clockSkew = state.now - Date.now()
        if (this.state?.roundId !== state.roundId) this.dealtOrder = 0
        this.state = state
        this.balance = balance

        this.phaseText.text = state.message
        this.dealerScore.visible = state.dealer.cards.length > 0
        this.dealerScoreText.text = `${state.dealer.score}${state.dealer.soft ? '/S' : ''}`

        const targets: CardTarget[] = []
        this.layoutDealer(state, targets)
        for (let i = 0; i < this.seatNodes.length; i++) {
            const node = this.seatNodes[i]!
            node.update(state, state.seats[i] ?? null, youId, this.tex)
            this.layoutSeat(state, i, targets)
        }
        this.syncCards(targets)

        // The rail only earns its space while you can actually place chips; the
        // rest of the time the action controls take it over.
        const betting = state.phase === 'betting'
        const seated = state.seats.find(s => s?.userId === youId)
        const canBet = betting && !!seated && !seated.away
        this.rackLayer.visible = canBet
        this.syncRack(rack, canBet)
    }

    private layoutDealer(state: LbTableState, out: CardTarget[]) {
        const cards = state.dealer.cards
        const gap = 46
        const width = cards.length ? CARD_W + (cards.length - 1) * gap : 0
        const startX = DEALER_POS.x - width / 2 + CARD_W / 2
        cards.forEach((card, i) => {
            out.push({
                id: card.id,
                key: card.hidden || !card.rank || !card.suit ? null : cardKey(card.rank, card.suit),
                x: startX + i * gap,
                y: DEALER_POS.y,
                rotation: 0,
                scale: 1,
                order: i
            })
        })
    }

    private layoutSeat(state: LbTableState, index: number, out: CardTarget[]) {
        const seat = state.seats[index]
        if (!seat?.hands.length) return
        const pos = SEAT_LAYOUT[index]!
        const hands = seat.hands
        const scale = hands.length === 1 ? 0.92 : hands.length === 2 ? 0.66 : 0.48
        const slot = SEAT_WIDTH / hands.length

        hands.forEach((hand, h) => {
            const centerX = pos.x + (h - (hands.length - 1) / 2) * slot
            const gap = 30 * scale
            const width = CARD_W * scale + (hand.cards.length - 1) * gap
            const startX = centerX - width / 2 + (CARD_W * scale) / 2
            hand.cards.forEach((card, i) => {
                out.push({
                    id: card.id,
                    key: card.hidden || !card.rank || !card.suit ? null : cardKey(card.rank, card.suit),
                    x: startX + i * gap,
                    y: pos.y + HAND_Y_OFFSET - i * 4 * scale,
                    rotation: (i - (hand.cards.length - 1) / 2) * 0.026,
                    scale,
                    order: 10 + index + h * 5 + i * 5
                })
            })
        })
    }

    private syncCards(targets: CardTarget[]) {
        const seen = new Set<string>()

        for (const target of targets) {
            seen.add(target.id)
            const existing = this.cards.get(target.id)

            if (!existing) {
                const texture = target.key ? this.tex.card.get(target.key)! : this.tex.back
                const sprite = new this.PIXI.Sprite(texture)
                sprite.anchor.set(0.5)
                sprite.position.set(SHOE_POS.x, SHOE_POS.y)
                sprite.scale.set(target.scale)
                sprite.rotation = -0.5
                this.cardLayer.addChild(sprite)
                this.cards.set(target.id, { sprite, ...target })

                // Only the opening deal is staggered; a mid-turn hit should land
                // the instant the player asked for it.
                const delay = this.state?.phase === 'dealing'
                    ? Math.min(0.55, this.dealtOrder++ * 0.1)
                    : 0
                gsap.to(sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.42,
                    delay,
                    ease: 'power2.out'
                })
                continue
            }

            // Hole card turning over: squash to nothing, swap face, spring back.
            if (existing.key !== target.key) {
                existing.key = target.key
                const texture = target.key ? this.tex.card.get(target.key)! : this.tex.back
                gsap.to(existing.sprite.scale, {
                    x: 0,
                    duration: 0.16,
                    ease: 'power1.in',
                    onComplete: () => {
                        existing.sprite.texture = texture
                        gsap.to(existing.sprite.scale, { x: target.scale, duration: 0.2, ease: 'back.out(2)' })
                    }
                })
            }

            if (existing.x !== target.x || existing.y !== target.y || existing.scale !== target.scale) {
                gsap.to(existing.sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.26,
                    ease: 'power2.out'
                })
                if (existing.scale !== target.scale) {
                    gsap.to(existing.sprite.scale, { x: target.scale, y: target.scale, duration: 0.26 })
                }
            }
            Object.assign(existing, target)
        }

        for (const [id, live] of this.cards.entries()) {
            if (seen.has(id)) continue
            this.cards.delete(id)
            gsap.to(live.sprite, {
                x: DISCARD_POS.x,
                y: DISCARD_POS.y,
                rotation: 0.4,
                duration: 0.4,
                ease: 'power2.in',
                onComplete: () => live.sprite.destroy()
            })
            gsap.to(live.sprite.scale, { x: 0.55, y: 0.55, duration: 0.4 })
        }
    }

    /**
     * Stamp what a player just did over their hand. Fires for every seat, so the
     * table can follow each other's decisions rather than only seeing the cards
     * that result from them.
     */
    flashAction(seatIndex: number, action: LbAction) {
        const pos = SEAT_LAYOUT[seatIndex]
        const style = ACTION_FLASH[action]
        if (!pos || !style) return

        const box = new this.PIXI.Container()
        const text = label(this.PIXI, style.text, 19, 0xffffff, '800')
        text.anchor.set(0.5)
        const w = text.width + 30
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -18, w, 36, 18).fill(style.color)
        bg.roundRect(-w / 2, -18, w, 36, 18).stroke({ width: 2, color: 0xffffff, alpha: 0.7 })
        box.addChild(bg, text)
        box.position.set(pos.x, pos.y + 32)
        box.scale.set(0.4)
        this.flashLayer.addChild(box)

        gsap.timeline({ onComplete: () => box.destroy({ children: true }) })
            .to(box.scale, { x: 1, y: 1, duration: 0.24, ease: 'back.out(3)' })
            .to(box, { y: pos.y - 4, duration: 1.1, ease: 'power1.out' }, 0)
            .to(box, { alpha: 0, duration: 0.32 }, 0.86)
    }

    destroy() {
        this.app.ticker.remove(this.tick)
        gsap.killTweensOf([...this.cards.values()].map(c => c.sprite))
        this.cards.clear()
    }
}

/** Everything anchored to one seat: nameplate, chips, per-hand badges. */
class SeatNode {
    private plate: Container
    private nameText: Text
    private netText: Text
    private sitPrompt: Container
    private badges: Container[] = []
    private chipSprites: Sprite[] = []
    private ring: Graphics

    constructor(
        private PIXI: Pixi,
        private uiLayer: Container,
        private chipLayer: Container,
        private index: number,
        private pos: { readonly x: number, readonly y: number },
        callbacks: LbSceneCallbacks
    ) {
        this.ring = new PIXI.Graphics()
        this.ring.circle(pos.x, pos.y + BET_Y_OFFSET, 56).stroke({ width: 4, color: GOLD, alpha: 0.9 })
        this.ring.visible = false
        uiLayer.addChild(this.ring)

        this.plate = new PIXI.Container()
        const bg = new PIXI.Graphics()
        bg.roundRect(-116, -25, 232, 50, 12).fill({ color: 0x0b0806, alpha: 0.86 })
        bg.roundRect(-116, -25, 232, 50, 12).stroke({ width: 1.5, color: GOLD, alpha: 0.4 })
        this.plate.addChild(bg)

        this.nameText = label(PIXI, '', 19, 0xf7f3e8, '700')
        this.nameText.anchor.set(0.5)
        this.nameText.position.set(0, -9)
        this.plate.addChild(this.nameText)

        this.netText = label(PIXI, '', 16, 0x94a3b8, '700')
        this.netText.anchor.set(0.5)
        this.netText.position.set(0, 12)
        this.plate.addChild(this.netText)

        this.plate.position.set(pos.x, pos.y + PLATE_Y_OFFSET)
        this.plate.visible = false
        uiLayer.addChild(this.plate)

        this.sitPrompt = new PIXI.Container()
        const seatG = new PIXI.Graphics()
        seatG.circle(0, 0, 44).fill({ color: 0x000000, alpha: 0.32 })
        seatG.circle(0, 0, 44).stroke({ width: 2.5, color: 0xf7f3e8, alpha: 0.55 })
        this.sitPrompt.addChild(seatG)
        const sitText = label(PIXI, 'SIT', 18, 0xf7f3e8, '800')
        sitText.anchor.set(0.5)
        this.sitPrompt.addChild(sitText)
        this.sitPrompt.position.set(pos.x, pos.y + BET_Y_OFFSET)
        this.sitPrompt.eventMode = 'static'
        this.sitPrompt.cursor = 'pointer'
        this.sitPrompt.on('pointerdown', () => callbacks.onSit(index))
        this.sitPrompt.on('pointerover', () => gsap.to(this.sitPrompt.scale, { x: 1.1, y: 1.1, duration: 0.15 }))
        this.sitPrompt.on('pointerout', () => gsap.to(this.sitPrompt.scale, { x: 1, y: 1, duration: 0.15 }))
        uiLayer.addChild(this.sitPrompt)
    }

    update(state: LbTableState, seat: LbTableState['seats'][number], youId: string | null, tex: LbTextures) {
        this.sitPrompt.visible = !seat && !state.seats.some(s => s?.userId === youId)
        this.plate.visible = !!seat
        this.ring.visible = state.activeSeat === this.index

        for (const badge of this.badges) badge.destroy({ children: true })
        this.badges = []
        for (const chip of this.chipSprites) chip.destroy()
        this.chipSprites = []

        if (!seat) return

        const isYou = seat.userId === youId
        this.nameText.text = seat.name.length > 15 ? `${seat.name.slice(0, 14)}…` : seat.name
        this.nameText.style.fill = isYou ? GOLD : seat.connected ? 0xf7f3e8 : 0x64748b

        const net = seat.sessionNet
        this.netText.text = seat.away && !seat.hands.length
            ? 'sitting out'
            : net === 0 ? '—' : `${net > 0 ? '+' : '−'}${formatNumber(Math.abs(net))}`
        this.netText.style.fill = net > 0 ? 0x4ade80 : net < 0 ? 0xf87171 : 0x94a3b8

        const stakeSpots: { x: number, amount: number }[] = []
        if (seat.hands.length) {
            const slot = SEAT_WIDTH / seat.hands.length
            seat.hands.forEach((hand, h) => {
                const x = this.pos.x + (h - (seat.hands.length - 1) / 2) * slot
                stakeSpots.push({ x, amount: hand.doubled ? hand.bet * 2 : hand.bet })
                this.addHandBadge(hand, x, state)
            })
        } else if (seat.pendingBet > 0) {
            stakeSpots.push({ x: this.pos.x, amount: seat.pendingBet })
        }

        for (const spot of stakeSpots) this.addChips(spot.x, spot.amount, tex)
        if (seat.insurance > 0) this.addInsuranceBadge(seat.insurance)
    }

    private addHandBadge(hand: LbHand, x: number, state: LbTableState) {
        const done = hand.net !== undefined && state.phase === 'payout'
        const text = done
            ? `${hand.net! > 0 ? '+' : hand.net! < 0 ? '−' : ''}${formatNumber(Math.abs(hand.net!))}`
            : hand.status === 'busted'
                ? 'BUST'
                : hand.status === 'blackjack'
                    ? 'BLACKJACK'
                    : hand.status === 'surrendered'
                        ? 'SURRENDER'
                        : `${hand.score}${hand.soft ? '/S' : ''}`

        const tone = done
            ? (hand.net! > 0 ? 0x16a34a : hand.net! < 0 ? 0xb91c1c : 0x475569)
            : hand.status === 'busted'
? 0xb91c1c
                : hand.status === 'blackjack'
? 0xb08d2a
                    : 0x0b0806

        const box = new this.PIXI.Container()
        const value = label(this.PIXI, text, 17, 0xf7f3e8, '800')
        value.anchor.set(0.5)
        const w = Math.max(58, value.width + 22)
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -15, w, 30, 15).fill({ color: tone, alpha: 0.94 })
        bg.roundRect(-w / 2, -15, w, 30, 15).stroke({ width: 1.4, color: GOLD, alpha: 0.5 })
        box.addChild(bg, value)
        box.position.set(x, this.pos.y + 32)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addInsuranceBadge(amount: number) {
        const box = new this.PIXI.Container()
        const value = label(this.PIXI, `INS ${formatNumber(amount)}`, 14, 0x0b0806, '800')
        value.anchor.set(0.5)
        const w = value.width + 18
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -12, w, 24, 12).fill(0xd9b167)
        box.addChild(bg, value)
        box.position.set(this.pos.x, this.pos.y + PLATE_Y_OFFSET - 46)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addChips(x: number, amount: number, tex: LbTextures) {
        if (amount <= 0) return
        const stack = chipStack(amount, 9)
        stack.forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(0.62)
            sprite.position.set(x + (i % 2 ? 2 : -2), this.pos.y + BET_Y_OFFSET - i * 7)
            this.chipLayer.addChild(sprite)
            this.chipSprites.push(sprite)
        })

        const total = label(this.PIXI, formatNumber(amount), 16, 0xf7f3e8, '800')
        total.anchor.set(0.5)
        total.position.set(x, this.pos.y + BET_Y_OFFSET + 34)
        const box = new this.PIXI.Container()
        const bg = new this.PIXI.Graphics()
        const w = total.width + 16
        bg.roundRect(x - w / 2, this.pos.y + BET_Y_OFFSET + 22, w, 24, 12).fill({ color: 0x0b0806, alpha: 0.8 })
        box.addChild(bg, total)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }
}
