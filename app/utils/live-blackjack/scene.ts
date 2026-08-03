import gsap from 'gsap'
import type { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { chipStack } from '#shared/utils/live-blackjack/chips'
import { LB_SIDE_BETS } from '#shared/utils/live-blackjack/sidebets'
import type {
    LbAction, LbBetSpot, LbHand, LbSideBetKey, LbTableState
} from '#shared/utils/live-blackjack/types'
import formatNumber from '~/utils/format-number'
import { CARD_H, CARD_W, cardKey, type LbTextures } from './art'

type Pixi = typeof import('pixi.js')

export const STAGE_W = 1600
export const STAGE_H = 1000

const FELT = 0x0f5132
const FELT_EDGE = 0x0a3a24
const RAIL = 0x3b2416
const GOLD = 0xd9b167

const DEALER_POS = { x: 800, y: 196 }
// The shoe is a side-on block of cards so the stack visibly drains toward the
// cut card; the discard tray opposite it fills by the same amount.
const SHOE_POS = { x: 1444, y: 268 }
const SHOE_STACK = { width: 96, height: 188 }
const DISCARD_POS = { x: 156, y: 268 }
// Pushed to the very bottom edge so the betting controls have a clear band
// between the seat nameplates and the chips.
const RACK_Y = 928

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
    alpha: number
}

interface LiveCard {
    sprite: Sprite
    key: string | null
    x: number
    y: number
    rotation: number
    scale: number
    alpha: number
    /**
     * The move currently in flight, cleared when it lands. gsap.isTweening()
     * cannot stand in for this: it reports false both in the frame a tween is
     * created and for the whole of a staggered deal's delay.
     */
    moving: gsap.core.Tween | null
}

export interface LbSceneCallbacks {
    onSit: (seat: number) => void
    /** A rack chip was picked up; it stays selected until another is chosen. */
    onChip: (value: number) => void
    onPlace: (spot: LbBetSpot, amount: number) => void
}

/** Short caps that fit inside a 28px spot. */
const SIDE_SPOT_LABELS: Record<LbSideBetKey, string> = {
    perfectPairs: 'PP',
    twentyOnePlusThree: '21+3'
}

/** Flanking the main circle, clear of it at r=28 and inside the seat's width. */
const SIDE_SPOT_X: Record<LbSideBetKey, number> = {
    perfectPairs: -96,
    twentyOnePlusThree: 96
}

const SIDE_SPOT_R = 28

/** Colour-coded so a glance across the table tells you what someone did. */
const ACTION_FLASH: Record<LbAction, { text: string, color: number }> = {
    hit: { text: 'HIT', color: 0x2563eb },
    stand: { text: 'STAND', color: 0x475569 },
    double: { text: 'DOUBLE', color: 0x15803d },
    split: { text: 'SPLIT', color: 0x7c3aed },
    surrender: { text: 'SURRENDER', color: 0xb45309 }
}

/**
 * Pixi nulls a destroyed object's transform, so any tween still pointing at one
 * writes into null on its next tick. Two tweens on the same sprite is the usual
 * way in — one finishes and destroys it while the other is still running — and a
 * hidden tab makes it certain, because the ticker stops while snapshots keep
 * arriving and the orphans all resume at once.
 */
function killAndDestroy(target: Container, options?: boolean | { children?: boolean }) {
    if (target.destroyed) return
    gsap.killTweensOf(target)
    gsap.killTweensOf(target.scale)
    gsap.killTweensOf(target.position)
    target.destroy(options)
}

/** A hidden tab gets no animation: nothing is watching, and every queued tween is a liability. */
const animating = () => typeof document === 'undefined' || !document.hidden

/** Hands share a seat's width, so more of them means smaller cards. */
function handScale(handCount: number): number {
    return handCount === 1 ? 0.92 : handCount === 2 ? 0.66 : 0.48
}

/** Width a fanned hand occupies, matching how layoutSeat places the cards. */
function handWidth(cardCount: number, scale: number): number {
    return CARD_W * scale + Math.max(0, cardCount - 1) * 30 * scale
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
    /** Sprites on their way to the discard tray, already out of `cards`. */
    private discarding = new Set<Sprite>()
    private seatNodes: SeatNode[] = []
    private rackChips: { value: number, sprite: Sprite, glow: Graphics }[] = []
    private dealerScore: Container
    private dealerScoreText!: Text
    private timerArc: Graphics
    private phaseText: Text
    private countdownText!: Text
    private shoeStack!: Graphics

    private state: LbTableState | null = null
    private balance = 0
    /** The chip the player has picked up, placed on whichever spot they click. */
    private selectedChip: number | null = null
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
        this.seatNodes = SEAT_LAYOUT.map((pos, i) =>
            new SeatNode(PIXI, this.uiLayer, this.chipLayer, i, pos, callbacks, spot => this.placeOnSpot(spot)))

        this.dealerScore = this.buildDealerBadge()
        this.dealerScore.position.set(DEALER_POS.x, DEALER_POS.y + 118)
        this.uiLayer.addChild(this.dealerScore)

        this.timerArc = new PIXI.Graphics()
        this.uiLayer.addChild(this.timerArc)

        this.phaseText = label(PIXI, '', 26, 0xf7f3e8, '700')
        this.phaseText.anchor.set(0.5)
        this.phaseText.position.set(DEALER_POS.x, 348)
        this.uiLayer.addChild(this.phaseText)

        // A shrinking ring alone is hard to read across the table; the seconds
        // are what players actually watch.
        this.countdownText = label(PIXI, '', 42, GOLD, '800')
        this.countdownText.anchor.set(0.5)
        this.countdownText.position.set(DEALER_POS.x, 394)
        this.countdownText.visible = false
        this.uiLayer.addChild(this.countdownText)

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

        // Empty trays; the card stacks inside them are redrawn as the shoe drains.
        for (const pos of [SHOE_POS, DISCARD_POS]) {
            g.roundRect(
                pos.x - SHOE_STACK.width / 2 - 8,
                pos.y - SHOE_STACK.height / 2 - 8,
                SHOE_STACK.width + 16,
                SHOE_STACK.height + 16,
                8
            ).fill(0x1b1009).stroke({ width: 2, color: GOLD, alpha: 0.45 })
        }

        this.felt.addChild(g)

        // Single legend line: the countdown now owns the space the second one had.
        const rules = label(this.PIXI, 'BLACKJACK PAYS 3 TO 2  ·  DEALER STANDS ON ALL 17', 19, GOLD, '700')
        rules.anchor.set(0.5)
        rules.alpha = 0.7
        rules.position.set(DEALER_POS.x, 432)
        this.felt.addChild(rules)

        const labelY = SHOE_POS.y + SHOE_STACK.height / 2 + 26
        const shoeLabel = label(this.PIXI, 'SHOE', 14, GOLD, '700')
        shoeLabel.anchor.set(0.5)
        shoeLabel.alpha = 0.75
        shoeLabel.position.set(SHOE_POS.x, labelY)
        this.felt.addChild(shoeLabel)

        const discardLabel = label(this.PIXI, 'DISCARD', 14, GOLD, '700')
        discardLabel.anchor.set(0.5)
        discardLabel.alpha = 0.6
        discardLabel.position.set(DISCARD_POS.x, labelY)
        this.felt.addChild(discardLabel)

        this.shoeStack = new this.PIXI.Graphics()
        this.uiLayer.addChild(this.shoeStack)
    }

    /**
     * The shoe drawn as the block of cards still in it, draining down to the red
     * cut card. The discard tray opposite grows by whatever has left the shoe.
     */
    private drawShoe(dealt: number, total: number, untilShuffle: number) {
        const g = this.shoeStack
        g.clear()

        const remaining = Math.max(0, total - dealt)
        const half = SHOE_STACK.width / 2
        const bottom = SHOE_POS.y + SHOE_STACK.height / 2

        const drawBlock = (x: number, cards: number, tint: number) => {
            const h = Math.round((cards / total) * SHOE_STACK.height)
            if (h <= 0) return
            g.roundRect(x - half, bottom - h, SHOE_STACK.width, h, 3).fill(tint)
            // One line per few cards reads as a stack rather than a solid slab.
            const step = SHOE_STACK.height / 42
            for (let y = bottom - h + step; y < bottom - 1; y += step) {
                g.moveTo(x - half + 4, y)
                g.lineTo(x + half - 4, y)
            }
            g.stroke({ width: 1, color: 0x000000, alpha: 0.22 })
        }

        drawBlock(SHOE_POS.x, remaining, 0x8f1230)
        drawBlock(DISCARD_POS.x, dealt, 0x4a3520)

        // Cut card: once the stack drains past it the shoe is reshuffled.
        const cutHeight = Math.round((Math.max(0, remaining - untilShuffle) / total) * SHOE_STACK.height)
        if (remaining > 0) {
            const y = bottom - cutHeight
            g.moveTo(SHOE_POS.x - half - 6, y)
            g.lineTo(SHOE_POS.x + half + 6, y)
            g.stroke({ width: 4, color: 0xf1c40f, alpha: 0.95 })
        }
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

    /**
     * Falls back to the smallest chip the player can cover, so the very first
     * click on a spot places something rather than doing nothing silently.
     */
    private placeOnSpot(spot: LbBetSpot) {
        const fallback = this.rackChips.find(c => c.value <= this.balance)?.value
        const amount = this.selectedChip ?? fallback
        if (!amount || amount > this.balance) return
        this.callbacks.onPlace(spot, amount)
    }

    private buildRack() {
        const plate = new this.PIXI.Graphics()
        plate.roundRect(STAGE_W / 2 - 430, RACK_Y - 54, 860, 108, 54).fill({ color: 0x1b1109, alpha: 0.92 })
        plate.roundRect(STAGE_W / 2 - 430, RACK_Y - 54, 860, 108, 54).stroke({ width: 2, color: GOLD, alpha: 0.35 })
        this.rackLayer.addChild(plate)
    }

    /** The rack window depends on the player's bankroll, so it is rebuilt on change. */
    private syncRack(values: number[], enabled: boolean) {
        const same = this.rackChips.length === values.length
            && this.rackChips.every((c, i) => c.value === values[i])

        if (!same) {
            for (const chip of this.rackChips) {
                killAndDestroy(chip.sprite)
                killAndDestroy(chip.glow)
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
                    // The selected chip keeps its glow after the pointer leaves.
                    glow.visible = this.selectedChip === value
                    gsap.to(sprite.scale, { x: this.selectedChip === value ? 1.12 : 1, y: this.selectedChip === value ? 1.12 : 1, duration: 0.16 })
                })
                sprite.on('pointerdown', () => {
                    if (sprite.alpha < 0.9) return
                    gsap.fromTo(sprite.scale, { x: 0.86, y: 0.86 }, { x: 1.12, y: 1.12, duration: 0.24, ease: 'back.out(3)' })
                    this.selectedChip = value
                    this.syncSelection()
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

        // A chip that fell out of the rack window, or off the end of the
        // bankroll, cannot stay picked up.
        if (this.selectedChip !== null
            && !this.rackChips.some(c => c.value === this.selectedChip && c.value <= this.balance)) {
            this.selectedChip = null
        }
        this.syncSelection()
    }

    private syncSelection() {
        for (const chip of this.rackChips) {
            const picked = chip.value === this.selectedChip
            chip.glow.visible = picked
            chip.sprite.scale.set(picked ? 1.12 : 1)
        }
    }

    // ─── per-frame timer ring ──────────────────────────────────────────────

    private tick = () => {
        const state = this.state
        this.timerArc.clear()
        this.countdownText.visible = false
        if (!state?.phaseEndsAt) return

        // The server sends how long the phase runs, so this no longer has to
        // keep its own copy of every timer.
        const total = state.phaseDuration ?? 0
        if (total <= 0 || state.phase === 'dealing') return
        const left = Math.max(0, state.phaseEndsAt - (Date.now() + this.clockSkew))
        const frac = Math.max(0, Math.min(1, left / total))
        if (frac <= 0) return

        const seconds = Math.ceil(left / 1000)
        this.countdownText.visible = true
        this.countdownText.text = String(seconds)
        this.countdownText.style.fill = seconds <= 5 ? 0xef4444 : GOLD
        // A last-seconds pulse, so a player looking at their cards still notices.
        const pulse = seconds <= 5 ? 1 + 0.08 * Math.sin(Date.now() / 90) : 1
        this.countdownText.scale.set(pulse)

        const seat = state.activeSeat !== null ? SEAT_LAYOUT[state.activeSeat] : null
        if (!seat) return
        const center = { x: seat.x, y: seat.y + BET_Y_OFFSET }
        const radius = 62
        const color = frac < 0.28 ? 0xef4444 : GOLD

        this.timerArc.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
        this.timerArc.stroke({ width: 6, color, alpha: 0.9, cap: 'round' })
    }

    // ─── state application ─────────────────────────────────────────────────

    update(state: LbTableState, youId: string | null, balance: number, rack: number[]) {
        this.clockSkew = state.now - Date.now()
        if (this.state?.roundId !== state.roundId) this.dealtOrder = 0
        this.state = state
        this.balance = balance

        this.drawShoe(state.shoe.dealt, state.shoe.total, state.shoe.untilShuffle)

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
        const canBet = betting && !!seated
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
                order: i,
                alpha: 1
            })
        })
    }

    private layoutSeat(state: LbTableState, index: number, out: CardTarget[]) {
        const seat = state.seats[index]
        if (!seat?.hands.length) return
        const pos = SEAT_LAYOUT[index]!
        const hands = seat.hands
        const scale = handScale(hands.length)
        const slot = SEAT_WIDTH / hands.length
        // With split hands it has to be obvious which one the buttons apply to,
        // so the hand in play keeps full colour and its siblings fade back.
        const activeHand = state.activeSeat === index ? state.activeHand : null
        const dimSiblings = activeHand !== null && hands.length > 1

        hands.forEach((hand, h) => {
            const centerX = pos.x + (h - (hands.length - 1) / 2) * slot
            const gap = 30 * scale
            const width = handWidth(hand.cards.length, scale)
            const startX = centerX - width / 2 + (CARD_W * scale) / 2
            hand.cards.forEach((card, i) => {
                out.push({
                    id: card.id,
                    key: card.hidden || !card.rank || !card.suit ? null : cardKey(card.rank, card.suit),
                    x: startX + i * gap,
                    y: pos.y + HAND_Y_OFFSET - i * 4 * scale,
                    rotation: (i - (hand.cards.length - 1) / 2) * 0.026,
                    scale,
                    order: 10 + index + h * 5 + i * 5,
                    alpha: dimSiblings && h !== activeHand ? 0.45 : 1
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
                sprite.alpha = target.alpha
                this.cardLayer.addChild(sprite)
                const card: LiveCard = { sprite, ...target, moving: null }
                this.cards.set(target.id, card)

                if (!animating()) {
                    sprite.position.set(target.x, target.y)
                    sprite.rotation = target.rotation
                    continue
                }

                // Only the opening deal is staggered; a mid-turn hit should land
                // the instant the player asked for it.
                const delay = this.state?.phase === 'dealing'
                    ? Math.min(0.55, this.dealtOrder++ * 0.1)
                    : 0
                card.moving = gsap.to(sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.42,
                    delay,
                    ease: 'power2.out',
                    overwrite: 'auto',
                    // A tween killed by a later one never completes, so the
                    // in-flight marker has to clear on both endings.
                    onComplete: () => { card.moving = null },
                    onInterrupt: () => { card.moving = null }
                })
                continue
            }

            // Hole card turning over: squash to nothing, swap face, spring back.
            if (existing.key !== target.key) {
                existing.key = target.key
                const texture = target.key ? this.tex.card.get(target.key)! : this.tex.back
                if (!animating()) {
                    existing.sprite.texture = texture
                } else {
                    gsap.to(existing.sprite.scale, {
                        x: 0,
                        duration: 0.16,
                        ease: 'power1.in',
                        onComplete: () => {
                            // The round can end mid-flip, taking the sprite with it.
                            if (existing.sprite.destroyed) return
                            existing.sprite.texture = texture
                            gsap.to(existing.sprite.scale, { x: target.scale, duration: 0.2, ease: 'back.out(2)' })
                        }
                    })
                }
            }

            if (existing.alpha !== target.alpha) {
                if (animating()) gsap.to(existing.sprite, { alpha: target.alpha, duration: 0.2 })
                else existing.sprite.alpha = target.alpha
            }

            // Compare against where the sprite actually is, not only against the
            // target it was last given: a tween that was interrupted — by a
            // round ending mid-deal, or by a reconnect swapping the state out
            // from under it — otherwise leaves the card stranded at the shoe it
            // spawned on, and nothing ever moves it again.
            const moved = existing.x !== target.x || existing.y !== target.y || existing.scale !== target.scale
            const stranded = !existing.moving
                && (Math.abs(existing.sprite.x - target.x) > 0.5 || Math.abs(existing.sprite.y - target.y) > 0.5)

            if (stranded || !animating()) {
                gsap.killTweensOf(existing.sprite)
                gsap.killTweensOf(existing.sprite.scale)
                existing.moving = null
                existing.sprite.position.set(target.x, target.y)
                existing.sprite.rotation = target.rotation
                existing.sprite.scale.set(target.scale)
                existing.sprite.alpha = target.alpha
            } else if (moved) {
                existing.moving = gsap.to(existing.sprite, {
                    x: target.x,
                    y: target.y,
                    rotation: target.rotation,
                    duration: 0.26,
                    ease: 'power2.out',
                    overwrite: 'auto',
                    onComplete: () => { existing.moving = null },
                    onInterrupt: () => { existing.moving = null }
                })
                if (existing.scale !== target.scale) {
                    gsap.to(existing.sprite.scale, { x: target.scale, y: target.scale, duration: 0.26 })
                }
            }
            const { moving } = existing
            Object.assign(existing, target, { moving })
        }

        for (const [id, live] of this.cards.entries()) {
            if (seen.has(id)) continue
            this.cards.delete(id)

            // Nobody is watching a hidden tab, and a discard that cannot finish
            // leaves the sprite on the felt with a tween still pointing at it.
            if (!animating()) {
                killAndDestroy(live.sprite)
                continue
            }

            this.discarding.add(live.sprite)
            gsap.to(live.sprite, {
                x: DISCARD_POS.x,
                y: DISCARD_POS.y,
                rotation: 0.4,
                duration: 0.4,
                ease: 'power2.in',
                overwrite: 'auto',
                // killAndDestroy takes the sibling scale tween below with it,
                // which is the one that used to outlive the sprite.
                onComplete: () => {
                    this.discarding.delete(live.sprite)
                    killAndDestroy(live.sprite)
                }
            })
            gsap.to(live.sprite.scale, { x: 0.55, y: 0.55, duration: 0.4 })
        }

        // Removal takes a card out of the map before animating it away, so a
        // discard tween that never finishes leaves a sprite nothing is tracking
        // — not the map, not the targets. Only a sweep of the layer reaches
        // those, and without it they sit on the felt for the rest of the session.
        const tracked = new Set([...this.cards.values()].map(c => c.sprite))
        for (const child of [...this.cardLayer.children]) {
            const sprite = child as Sprite
            if (tracked.has(sprite) || this.discarding.has(sprite)) continue
            killAndDestroy(sprite)
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

        gsap.timeline({ onComplete: () => killAndDestroy(box, { children: true }) })
            .to(box.scale, { x: 1, y: 1, duration: 0.24, ease: 'back.out(3)' })
            .to(box, { y: pos.y - 4, duration: 1.1, ease: 'power1.out' }, 0)
            .to(box, { alpha: 0, duration: 0.32 }, 0.86)
    }

    destroy() {
        this.app.ticker.remove(this.tick)
        // Cards on their way to the discard tray are already out of the map, so
        // the layer — not the map — is what holds every sprite still tweening.
        gsap.killTweensOf(this.cardLayer.children)
        this.cards.clear()
        this.discarding.clear()
    }
}

/** Everything anchored to one seat: nameplate, chips, per-hand badges. */
class SeatNode {
    private plate: Container
    private nameText: Text
    private netText: Text
    private streakBadge: Container
    private streakText: Text
    private sitPrompt: Container
    private badges: Container[] = []
    private chipSprites: Sprite[] = []
    private ring: Graphics
    private mainSpot!: Container
    private sideSpots: { key: LbSideBetKey, node: Container, ring: Graphics, x: number }[] = []
    /** Side bet results already announced, so the pop fires once and not every frame. */
    private popped = new Set<string>()
    private poppedRound = -1

    constructor(
        private PIXI: Pixi,
        private uiLayer: Container,
        private chipLayer: Container,
        private index: number,
        private pos: { readonly x: number, readonly y: number },
        callbacks: LbSceneCallbacks,
        onSpot: (spot: LbBetSpot) => void
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

        // Sits beside the name and only appears on a run of two or more.
        this.streakBadge = new PIXI.Container()
        const streakBg = new PIXI.Graphics()
        streakBg.roundRect(-19, -12, 38, 24, 12).fill(0xd97706)
        streakBg.roundRect(-19, -12, 38, 24, 12).stroke({ width: 1.5, color: 0xfde68a, alpha: 0.9 })
        this.streakText = label(PIXI, '', 14, 0xfffbeb, '800')
        this.streakText.anchor.set(0.5)
        this.streakBadge.addChild(streakBg, this.streakText)
        this.streakBadge.position.set(0, -9)
        this.streakBadge.visible = false
        this.plate.addChild(this.streakBadge)

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

        for (const key of LB_SIDE_BETS) {
            const x = pos.x + SIDE_SPOT_X[key]
            const y = pos.y + BET_Y_OFFSET
            const node = new PIXI.Container()

            const ring = new PIXI.Graphics()
            ring.circle(0, 0, SIDE_SPOT_R).fill({ color: 0x000000, alpha: 0.28 })
            ring.circle(0, 0, SIDE_SPOT_R).stroke({ width: 2, color: GOLD, alpha: 0.5 })
            const caption = label(PIXI, SIDE_SPOT_LABELS[key], 13, GOLD, '800')
            caption.anchor.set(0.5)
            node.addChild(ring, caption)
            node.position.set(x, y)
            node.visible = false
            node.on('pointerdown', () => onSpot(key))
            node.on('pointerover', () => gsap.to(node.scale, { x: 1.14, y: 1.14, duration: 0.14 }))
            node.on('pointerout', () => gsap.to(node.scale, { x: 1, y: 1, duration: 0.14 }))
            uiLayer.addChild(node)
            this.sideSpots.push({ key, node, ring, x })
        }

        // The main bet circle doubles as a drop target once you are seated.
        this.mainSpot = new PIXI.Container()
        const mainHit = new PIXI.Graphics()
        mainHit.circle(pos.x, pos.y + BET_Y_OFFSET, 56).fill({ color: 0xffffff, alpha: 0.001 })
        this.mainSpot.addChild(mainHit)
        this.mainSpot.visible = false
        this.mainSpot.on('pointerdown', () => onSpot('main'))
        uiLayer.addChild(this.mainSpot)
    }

    update(state: LbTableState, seat: LbTableState['seats'][number], youId: string | null, tex: LbTextures) {
        this.sitPrompt.visible = !seat && !state.seats.some(s => s?.userId === youId)
        this.plate.visible = !!seat
        this.ring.visible = state.activeSeat === this.index

        // Tweens have to die with their target. Pixi nulls a destroyed object's
        // transform, so a tween still holding one writes into null on its next
        // tick — and a backgrounded tab pauses the ticker while snapshots keep
        // arriving, so they pile up and all throw at once when it resumes.
        for (const badge of this.badges) killAndDestroy(badge, { children: true })
        this.badges = []
        for (const chip of this.chipSprites) killAndDestroy(chip)
        this.chipSprites = []

        if (!seat) {
            for (const spot of this.sideSpots) spot.node.visible = false
            this.mainSpot.visible = false
            return
        }

        const isYou = seat.userId === youId
        const streaking = seat.winStreak >= 2
        // A shorter name when the badge is showing keeps both inside the plate.
        const maxName = streaking ? 11 : 15
        this.nameText.text = seat.name.length > maxName ? `${seat.name.slice(0, maxName - 1)}…` : seat.name
        this.nameText.style.fill = isYou ? GOLD : seat.connected ? 0xf7f3e8 : 0x64748b

        this.streakBadge.visible = streaking
        if (streaking) {
            this.streakText.text = `W${seat.winStreak}`
            // Shifted off the centred name rather than a fixed offset, so it
            // tracks however wide that player's name renders.
            this.nameText.x = -20
            this.streakBadge.x = this.nameText.x + this.nameText.width / 2 + 24
        } else {
            this.nameText.x = 0
        }

        const net = seat.dailyNet
        this.netText.text = net === 0 ? '—' : `${net > 0 ? '+' : '−'}${formatNumber(Math.abs(net))}`
        this.netText.style.fill = net > 0 ? 0x4ade80 : net < 0 ? 0xf87171 : 0x94a3b8

        const stakeSpots: { x: number, amount: number }[] = []
        if (seat.hands.length) {
            const slot = SEAT_WIDTH / seat.hands.length
            const activeHand = state.activeSeat === this.index ? state.activeHand : null
            seat.hands.forEach((hand, h) => {
                const x = this.pos.x + (h - (seat.hands.length - 1) / 2) * slot
                stakeSpots.push({ x, amount: hand.doubled ? hand.bet * 2 : hand.bet })
                const active = activeHand === h && seat.hands.length > 1
                if (active) this.addActiveHandMarker(x, hand.cards.length, seat.hands.length)
                this.addHandBadge(hand, x, state, active)
            })
        } else if (seat.pendingBet > 0) {
            stakeSpots.push({ x: this.pos.x, amount: seat.pendingBet })
        }

        for (const spot of stakeSpots) this.addChips(spot.x, spot.amount, tex)
        if (seat.insurance > 0) this.addInsuranceBadge(seat.insurance)
        this.updateSideSpots(state, seat, isYou, tex)
    }

    /**
     * Side spots disappear the moment the hand splits: that is exactly when the
     * main stake fans out across the seat's width and would sit on top of them.
     * By then the side bets are long since decided, so nothing is lost.
     */
    private updateSideSpots(
        state: LbTableState,
        seat: NonNullable<LbTableState['seats'][number]>,
        isYou: boolean,
        tex: LbTextures
    ) {
        const split = seat.hands.length > 1
        const betting = state.phase === 'betting'
        if (state.roundId !== this.poppedRound) {
            this.popped.clear()
            this.poppedRound = state.roundId
        }

        for (const spot of this.sideSpots) {
            const stake = seat.pendingSide?.[spot.key] ?? 0
            const result = seat.sideResults?.find(r => r.key === spot.key) ?? null
            const show = !split && (betting || stake > 0)

            spot.node.visible = show
            spot.node.eventMode = isYou && betting ? 'static' : 'none'
            spot.node.cursor = isYou && betting ? 'pointer' : 'default'
            if (!show) continue

            spot.ring.tint = result?.payout ? 0x4ade80 : 0xffffff
            if (stake > 0) this.addChips(spot.x, stake, tex, 0.4)
            if (result && stake > 0) {
                // The badge is rebuilt on every snapshot, so the pop has to be
                // tied to the result rather than the rebuild or it restarts for
                // the whole payout phase.
                this.addSideResultBadge(spot.x, result, !this.popped.has(spot.key))
                this.popped.add(spot.key)
            }
        }

        this.mainSpot.visible = isYou && betting
        this.mainSpot.eventMode = isYou && betting ? 'static' : 'none'
        this.mainSpot.cursor = isYou && betting ? 'pointer' : 'default'
    }

    private addSideResultBadge(x: number, result: { payout: number, label: string | null }, pop: boolean) {
        const won = result.payout > 0
        const box = new this.PIXI.Container()
        const text = label(
            this.PIXI,
            won ? `+${formatNumber(result.payout)}` : 'no pair',
            won ? 15 : 12,
            won ? 0x052e16 : 0x94a3b8,
            '800'
        )
        text.anchor.set(0.5)
        const w = text.width + 16
        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -11, w, 22, 11).fill({ color: won ? 0x4ade80 : 0x0b0806, alpha: won ? 1 : 0.8 })
        box.addChild(bg, text)
        box.position.set(x, this.pos.y + BET_Y_OFFSET - 46)
        this.uiLayer.addChild(box)
        this.badges.push(box)

        if (won && pop) {
            gsap.fromTo(box.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.42, ease: 'back.out(2.4)' })
        }
    }

    /**
     * A lit frame around the hand currently being played. Without it, a player
     * holding three split hands has no way to tell which one the buttons act on.
     */
    private addActiveHandMarker(x: number, cardCount: number, handCount: number) {
        const scale = handScale(handCount)
        const w = handWidth(cardCount, scale) + 22
        const h = CARD_H * scale + 26
        const box = new this.PIXI.Graphics()
        box.roundRect(x - w / 2, this.pos.y + HAND_Y_OFFSET - h / 2, w, h, 12)
            .fill({ color: GOLD, alpha: 0.12 })
            .stroke({ width: 3, color: GOLD, alpha: 0.95 })
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addHandBadge(hand: LbHand, x: number, state: LbTableState, active = false) {
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
        bg.roundRect(-w / 2, -15, w, 30, 15).stroke({
            width: active ? 3 : 1.4,
            color: active ? 0xffffff : GOLD,
            alpha: active ? 0.95 : 0.5
        })
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

    private addChips(x: number, amount: number, tex: LbTextures, scale = 0.62) {
        if (amount <= 0) return
        const stack = chipStack(amount, 9)
        stack.forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(scale)
            sprite.position.set(x + (i % 2 ? 2 : -2), this.pos.y + BET_Y_OFFSET - i * 7 * (scale / 0.62))
            this.chipLayer.addChild(sprite)
            this.chipSprites.push(sprite)
        })

        const size = scale < 0.5 ? 13 : 16
        const total = label(this.PIXI, formatNumber(amount), size, 0xf7f3e8, '800')
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
