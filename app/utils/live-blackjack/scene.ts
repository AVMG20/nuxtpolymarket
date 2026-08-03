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
// Tall enough that the middle seat's nameplate and side bet spots clear the
// action controls, which sit at a fixed percentage up from the bottom.
export const STAGE_H = 1120

const FELT = 0x0f5132
const FELT_EDGE = 0x0a3a24
const RAIL = 0x3b2416
const GOLD = 0xd9b167

const DEALER_POS = { x: 800, y: 196 }
/**
 * The shoe is a side-on block of cards, laid along the top rail so it drains
 * toward the cut card horizontally; the discard tray opposite fills by the same
 * amount. Both used to sit at mid-table height, where the outermost seats' cards
 * reached them.
 */
const SHOE_POS = { x: 1330, y: 140 }
const SHOE_STACK = { width: 188, height: 96 }
const DISCARD_POS = { x: 270, y: 140 }
// Below the discard tray and left of the dealer's fan, which is centred on
// DEALER_POS and grows both ways — seven cards reach x=606.
const DEALER_BANK_POS = { x: 400, y: 320 }
// Pushed to the very bottom edge so the betting controls have a clear band
// between the seat nameplates and the chips.
const RACK_Y = 1048

// 296 apart rather than 274: the felt has the room, and the extra 22 is what
// keeps one seat's side bet spots off the next seat's.
const SEAT_LAYOUT = [
    { x: 208, y: 546 },
    { x: 504, y: 604 },
    { x: 800, y: 630 },
    { x: 1096, y: 604 },
    { x: 1392, y: 546 }
] as const

const SEAT_WIDTH = 272
const HAND_Y_OFFSET = -100
/** Between the cards and the chips, clear of a full stack of either. */
const HAND_BADGE_Y = 0
const BET_Y_OFFSET = 106
/**
 * Split hands are drawn smaller, which frees a band above them. The stakes and
 * score badges rise into it so they are not crowding the side bet spots.
 */
const SPLIT_LIFT = 24
/** A taller stack than this reaches up into the hand's score badge. */
const MAX_STAKE_CHIPS = 8
// Dropped far enough to leave a clear row between the main stake's total and
// the plate, which is where a side bet's outcome goes.
const PLATE_Y_OFFSET = 226
/**
 * Side bet outcomes and insurance. Directly under the spot they belong to, and
 * below the split stakes' totals so a three-way split cannot reach them.
 */
const RESULT_Y_OFFSET = 180

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

/**
 * Flanking the main circle, clear of its ring at r=56 and of the neighbouring
 * seat, which sits 274 away.
 */
const SIDE_SPOT_X: Record<LbSideBetKey, number> = {
    perfectPairs: -96,
    twentyOnePlusThree: 96
}

const SIDE_SPOT_R = 28
/** Below the main circle's row, so each spot sits close to its own result. */
const SIDE_SPOT_Y_OFFSET = 134

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

/** Just inside the side bet spots, whose inner edge is 68 from the seat centre. */
const TIMER_R = 62

/**
 * Whose clock the current one actually is. Betting and insurance run a single
 * timer against everyone still to act, so the ring belongs on all of them —
 * without this the only seat that ever showed one was the player in turn.
 */
function waitingSeats(state: LbTableState): number[] {
    const seats = state.seats.filter(seat => !!seat)
    if (state.phase === 'playing') return state.activeSeat === null ? [] : [state.activeSeat]
    if (state.phase === 'betting') return seats.filter(s => s.pendingBet === 0).map(s => s.index)
    if (state.phase === 'insurance') {
        return seats.filter(s => s.hands.length && !s.insuranceDecided).map(s => s.index)
    }
    return []
}

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
    /** Bet spots live under the chips, the way a painted felt circle does. */
    private spotLayer: Container
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
    /** Rounds whose chips have already flown, so each settlement fires once. */
    private settledRound = -1
    private sideSettledRound = -1
    /** serverNow - clientNow, so countdowns stay honest on a drifting clock. */
    private clockSkew = 0

    constructor(
        private PIXI: Pixi,
        private app: Application,
        private tex: LbTextures,
        private callbacks: LbSceneCallbacks
    ) {
        this.felt = new PIXI.Container()
        this.spotLayer = new PIXI.Container()
        this.chipLayer = new PIXI.Container()
        this.cardLayer = new PIXI.Container()
        this.uiLayer = new PIXI.Container()
        this.rackLayer = new PIXI.Container()
        // Above everything: seat badges are rebuilt on every snapshot and would
        // otherwise be drawn over the flash mid-animation.
        this.flashLayer = new PIXI.Container()
        app.stage.addChild(
            this.felt, this.spotLayer, this.chipLayer, this.cardLayer,
            this.uiLayer, this.rackLayer, this.flashLayer
        )

        this.drawTable()
        this.seatNodes = SEAT_LAYOUT.map((pos, i) => new SeatNode(
            PIXI, this.uiLayer, this.chipLayer, this.spotLayer, i, pos, callbacks,
            spot => this.placeOnSpot(spot)
        ))

        this.dealerScore = this.buildDealerBadge()
        this.dealerScore.position.set(DEALER_POS.x, DEALER_POS.y + 118)
        this.uiLayer.addChild(this.dealerScore)

        // Under the chips: a split fans its stacks out across the ring, and a
        // gold stroke cutting through them reads as the chips being clipped.
        this.timerArc = new PIXI.Graphics()
        this.spotLayer.addChild(this.timerArc)

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
        g.roundRect(24, 34, STAGE_W - 48, 920, 190).fill(RAIL)
        g.roundRect(24, 34, STAGE_W - 48, 920, 190).stroke({ width: 3, color: 0x1c1109 })
        g.roundRect(46, 56, STAGE_W - 92, 876, 172).fill(FELT_EDGE)
        g.roundRect(54, 64, STAGE_W - 108, 860, 166).fill(FELT)

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
        // After the felt graphics is in the display list, or the tray it draws
        // would paint straight over the chips standing in it.
        this.drawDealerBank(g)

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
     * The house's chips. Purely decorative — it never grows or shrinks. It only
     * exists to give payouts somewhere to fly from and sweeps somewhere to go.
     */
    private drawDealerBank(g: Graphics) {
        const { x, y } = DEALER_BANK_POS
        // A shallow well the stacks stand in, rather than a panel behind them.
        g.ellipse(x, y + 34, 104, 20).fill({ color: 0x000000, alpha: 0.32 })
        g.roundRect(x - 104, y + 26, 208, 16, 8).fill(0x1b1009)
        g.roundRect(x - 104, y + 26, 208, 16, 8).stroke({ width: 2, color: GOLD, alpha: 0.4 })

        const stacks = [
            { value: 100, height: 7 },
            { value: 5_000, height: 11 },
            { value: 100_000, height: 9 },
            { value: 1_000, height: 5 }
        ]
        stacks.forEach((stack, s) => {
            const sx = x - 78 + s * 52
            for (let i = 0; i < stack.height; i++) {
                const sprite = new this.PIXI.Sprite(this.tex.chip.get(stack.value)!)
                sprite.anchor.set(0.5)
                sprite.scale.set(0.55)
                // Half a pixel of wobble per chip: a perfectly straight column
                // reads as one tall cylinder rather than chips.
                sprite.position.set(sx + (i % 2 ? 1 : -1), y + 28 - i * 8)
                this.felt.addChild(sprite)
            }
        })

        const caption = label(this.PIXI, 'HOUSE', 13, GOLD, '700')
        caption.anchor.set(0.5)
        caption.alpha = 0.6
        caption.position.set(x, y + 60)
        this.felt.addChild(caption)
    }

    /**
     * The shoe drawn as the block of cards still in it, draining down to the red
     * cut card. The discard tray opposite grows by whatever has left the shoe.
     */
    private drawShoe(dealt: number, total: number, untilShuffle: number) {
        const g = this.shoeStack
        g.clear()

        const remaining = Math.max(0, total - dealt)
        const half = SHOE_STACK.height / 2
        const step = SHOE_STACK.width / 42

        const drawBlock = (pos: { x: number, y: number }, cards: number, tint: number) => {
            const w = Math.round((cards / total) * SHOE_STACK.width)
            if (w <= 0) return
            const left = pos.x - SHOE_STACK.width / 2
            const top = pos.y - half
            g.roundRect(left, top, w, SHOE_STACK.height, 3).fill(tint)
            // One line per few cards reads as a stack rather than a solid slab.
            for (let x = left + step; x < left + w - 1; x += step) {
                g.moveTo(x, top + 4)
                g.lineTo(x, top + SHOE_STACK.height - 4)
            }
            g.stroke({ width: 1, color: 0x000000, alpha: 0.22 })
        }

        drawBlock(SHOE_POS, remaining, 0x8f1230)
        drawBlock(DISCARD_POS, dealt, 0x4a3520)

        // Cut card: once the stack drains past it the shoe is reshuffled.
        const cutWidth = Math.round((Math.max(0, remaining - untilShuffle) / total) * SHOE_STACK.width)
        if (remaining > 0) {
            const x = SHOE_POS.x - SHOE_STACK.width / 2 + cutWidth
            g.moveTo(x, SHOE_POS.y - half - 6)
            g.lineTo(x, SHOE_POS.y + half + 6)
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

        const color = frac < 0.28 ? 0xef4444 : GOLD
        for (const index of waitingSeats(state)) {
            const pos = SEAT_LAYOUT[index]!
            const y = pos.y + BET_Y_OFFSET
            // arc() would draw a line in from wherever the last one ended, so
            // every ring has to start its own subpath.
            this.timerArc.moveTo(pos.x, y - TIMER_R)
            this.timerArc.arc(pos.x, y, TIMER_R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
            this.timerArc.stroke({ width: 7, color, alpha: 0.95, cap: 'round' })
        }
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
        this.settleSideChips(state)
        this.settleChips(state)

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
     * Side bets are decided by the deal, not by how the hand plays, so the
     * house settles them right there — long before the main stake resolves.
     */
    private settleSideChips(state: LbTableState) {
        if (state.roundId === this.sideSettledRound) return
        if (!state.seats.some(seat => seat?.sideResults)) return
        this.sideSettledRound = state.roundId
        if (!animating()) return

        for (const seat of state.seats) {
            if (!seat?.sideResults) continue
            const pos = SEAT_LAYOUT[seat.index]!
            for (const side of seat.sideResults) {
                if (!side.stake) continue
                const spot = { x: pos.x + SIDE_SPOT_X[side.key], y: pos.y + SIDE_SPOT_Y_OFFSET }
                if (side.payout > 0) this.flyChips(DEALER_BANK_POS, spot, side.payout - side.stake)
                else this.flyChips(spot, DEALER_BANK_POS, side.stake)
            }
        }
    }

    /**
     * Chips crossing the felt at payout: the house pays winners, and sweeps the
     * losers. Fires once per round on the way into the payout phase.
     */
    private settleChips(state: LbTableState) {
        if (state.phase !== 'payout' || state.roundId === this.settledRound) return
        this.settledRound = state.roundId
        if (!animating()) return

        for (const seat of state.seats) {
            if (!seat) continue
            const pos = SEAT_LAYOUT[seat.index]!
            const lift = seat.hands.length > 1 ? SPLIT_LIFT : 0
            const main = { x: pos.x, y: pos.y + BET_Y_OFFSET - lift }

            // Winnings and losses are two separate journeys, not one netted
            // arrow: a player can lose one split hand and win another, and both
            // have to be seen to happen.
            let won = 0
            let lost = 0
            for (const hand of seat.hands) {
                if (hand.net === undefined || hand.net === 0) continue
                if (hand.net > 0) won += hand.net
                else lost -= hand.net
            }

            if (lost > 0) this.flyChips(main, DEALER_BANK_POS, lost)
            // Paid onto the main circle whatever it was won on, so there is one
            // place to look for money coming back.
            if (won > 0) this.flyChips(DEALER_BANK_POS, main, won)
        }
    }

    /**
     * The tween drives a plain object and the sprite is written from it, so no
     * tween ever holds the sprite's transform — the arc costs nothing in the
     * risk that two tweens on one chip would carry.
     */
    private flyChips(from: { x: number, y: number }, to: { x: number, y: number }, amount: number) {
        chipStack(amount, 7).forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(this.tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(0.62)
            sprite.position.set(from.x, from.y - i * 8)
            // Over the cards: a payout crossing the felt is the moment of the
            // round and should not be read through a hand of cards.
            this.flashLayer.addChild(sprite)

            const endX = to.x + (i % 2 ? 5 : -5)
            const endY = to.y - i * 8
            const flight = { t: 0 }
            gsap.to(flight, {
                t: 1,
                duration: 0.72,
                delay: i * 0.09,
                ease: 'power1.inOut',
                onUpdate: () => {
                    if (sprite.destroyed) return
                    sprite.x = from.x + (endX - from.x) * flight.t
                    sprite.y = from.y - i * 8 + (endY - (from.y - i * 8)) * flight.t
                        - Math.sin(flight.t * Math.PI) * 74
                    sprite.rotation = flight.t * 1.4
                },
                onComplete: () => killAndDestroy(sprite)
            })
        })
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
        box.position.set(pos.x, pos.y + HAND_BADGE_Y)
        box.scale.set(0.4)
        this.flashLayer.addChild(box)

        gsap.timeline({ onComplete: () => killAndDestroy(box, { children: true }) })
            .to(box.scale, { x: 1, y: 1, duration: 0.24, ease: 'back.out(3)' })
            .to(box, { y: pos.y + HAND_BADGE_Y - 36, duration: 1.1, ease: 'power1.out' }, 0)
            .to(box, { alpha: 0, duration: 0.32 }, 0.86)
    }

    destroy() {
        this.app.ticker.remove(this.tick)
        // Cards on their way to the discard tray, and chips mid-flight between
        // the house and a seat, are tracked by nothing but the layer they sit on.
        gsap.killTweensOf(this.cardLayer.children)
        gsap.killTweensOf(this.chipLayer.children)
        gsap.killTweensOf(this.flashLayer.children)
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
    private sideSpots: { key: LbSideBetKey, node: Container, x: number }[] = []
    /** Side bet results already announced, so the pop fires once and not every frame. */
    private popped = new Set<string>()
    private poppedRound = -1

    constructor(
        private PIXI: Pixi,
        private uiLayer: Container,
        private chipLayer: Container,
        private spotLayer: Container,
        private index: number,
        private pos: { readonly x: number, readonly y: number },
        callbacks: LbSceneCallbacks,
        onSpot: (spot: LbBetSpot) => void
    ) {
        this.ring = new PIXI.Graphics()
        this.ring.circle(pos.x, pos.y + BET_Y_OFFSET, 56).stroke({ width: 4, color: GOLD, alpha: 0.9 })
        this.ring.visible = false
        spotLayer.addChild(this.ring)

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
            const y = pos.y + SIDE_SPOT_Y_OFFSET
            const node = new PIXI.Container()

            const ring = new PIXI.Graphics()
            ring.circle(0, 0, SIDE_SPOT_R).fill({ color: 0x000000, alpha: 0.28 })
            ring.circle(0, 0, SIDE_SPOT_R).stroke({ width: 2, color: GOLD, alpha: 0.5 })
            const caption = label(PIXI, SIDE_SPOT_LABELS[key], 13, GOLD, '800')
            caption.anchor.set(0.5)
            node.addChild(ring, caption)
            node.position.set(x, y)
            // Painted on the felt, so it is always there — only the chips come
            // and go, exactly like the main bet circle beside it.
            node.on('pointerdown', () => onSpot(key))
            node.on('pointerover', () => gsap.to(node.scale, { x: 1.14, y: 1.14, duration: 0.14 }))
            node.on('pointerout', () => gsap.to(node.scale, { x: 1, y: 1, duration: 0.14 }))
            spotLayer.addChild(node)
            this.sideSpots.push({ key, node, x })
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
            for (const spot of this.sideSpots) spot.node.eventMode = 'none'
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

        const net = seat.sessionNet
        this.netText.text = net === 0 ? '—' : `${net > 0 ? '+' : '−'}${formatNumber(Math.abs(net))}`
        this.netText.style.fill = net > 0 ? 0x4ade80 : net < 0 ? 0xf87171 : 0x94a3b8

        const stakeSpots: { x: number, amount: number }[] = []
        const lift = seat.hands.length > 1 ? SPLIT_LIFT : 0
        if (seat.hands.length) {
            const slot = SEAT_WIDTH / seat.hands.length
            const activeHand = state.activeSeat === this.index ? state.activeHand : null
            seat.hands.forEach((hand, h) => {
                const x = this.pos.x + (h - (seat.hands.length - 1) / 2) * slot
                // Once settled the stack is what the hand returns, not what it
                // staked: a winning bet is paid beside itself, so 25K back on
                // 25K down stands as 50K. A losing one returns nothing and goes.
                const amount = hand.payout ?? (hand.doubled ? hand.bet * 2 : hand.bet)
                stakeSpots.push({ x, amount })
                const active = activeHand === h && seat.hands.length > 1
                if (active) this.addActiveHandMarker(x, hand.cards.length, seat.hands.length)
                this.addHandBadge(hand, x, state, active, lift)
            })
        } else if (seat.pendingBet > 0) {
            stakeSpots.push({ x: this.pos.x, amount: seat.pendingBet })
        }

        const betY = this.pos.y + BET_Y_OFFSET - lift
        for (const spot of stakeSpots) this.addChips(spot.x, betY, spot.amount, tex)
        if (seat.insurance > 0) this.addInsuranceBadge(seat.insurance)
        this.updateSideSpots(state, seat, isYou, tex)
    }

    /**
     * Both side bets are settled off the opening two cards, so the spot itself
     * has done its job the moment the deal lands: it clears away and leaves the
     * outcome badge behind. That is what lets the spots sit against the main
     * circle where they belong — a split fans out over ground they have already
     * given up, however many hands it makes.
     */
    private updateSideSpots(
        state: LbTableState,
        seat: NonNullable<LbTableState['seats'][number]>,
        isYou: boolean,
        tex: LbTextures
    ) {
        const betting = state.phase === 'betting'
        if (state.roundId !== this.poppedRound) {
            this.popped.clear()
            this.poppedRound = state.roundId
        }

        for (const spot of this.sideSpots) {
            const stake = seat.pendingSide?.[spot.key] ?? 0
            const result = seat.sideResults?.find(r => r.key === spot.key) ?? null

            spot.node.eventMode = isYou && betting ? 'static' : 'none'
            spot.node.cursor = isYou && betting ? 'pointer' : 'default'

            // Side bets are settled off the deal, so they are paid or taken
            // there and then: a loser's chips go and leave the bare spot, a
            // winner's grow to what the bet returns.
            const chips = result ? result.payout : stake
            if (chips > 0) {
                this.addChips(spot.x, this.pos.y + SIDE_SPOT_Y_OFFSET, chips, tex, 0.42, 6, this.spotLayer)
            }
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

    /**
     * Sits under its spot and outlives it, so it is the one thing left saying
     * what a side bet did once the spot itself has cleared.
     */
    private addSideResultBadge(
        x: number,
        result: { key: LbSideBetKey, payout: number },
        pop: boolean
    ) {
        const won = result.payout > 0
        const box = new this.PIXI.Container()
        // Which bet it was, in front of what it did — two spots side by side
        // both saying only "MISS" tell you nothing about which one lost.
        const tag = label(this.PIXI, SIDE_SPOT_LABELS[result.key], 11, won ? 0x14532d : 0x64748b, '800')
        const value = label(
            this.PIXI,
            won ? `+${formatNumber(result.payout)}` : 'MISS',
            won ? 15 : 12,
            won ? 0x052e16 : 0x94a3b8,
            '800'
        )
        tag.anchor.set(0, 0.5)
        value.anchor.set(0, 0.5)
        const w = tag.width + value.width + 24
        tag.position.set(-w / 2 + 9, 0)
        value.position.set(tag.x + tag.width + 6, 0)

        const bg = new this.PIXI.Graphics()
        bg.roundRect(-w / 2, -11, w, 22, 11).fill({ color: won ? 0x4ade80 : 0x0b0806, alpha: won ? 1 : 0.8 })
        box.addChild(bg, tag, value)
        box.position.set(x, this.pos.y + RESULT_Y_OFFSET)
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

    private addHandBadge(hand: LbHand, x: number, state: LbTableState, active = false, lift = 0) {
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
        box.position.set(x, this.pos.y + HAND_BADGE_Y - lift)
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
        // Centred between the two side bet result badges on the same row.
        box.position.set(this.pos.x, this.pos.y + RESULT_Y_OFFSET)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }

    private addChips(
        x: number,
        y: number,
        amount: number,
        tex: LbTextures,
        scale = 0.62,
        max = MAX_STAKE_CHIPS,
        layer = this.chipLayer
    ) {
        if (amount <= 0) return
        const stack = chipStack(amount, max)
        stack.forEach((chip, i) => {
            const sprite = new this.PIXI.Sprite(tex.chip.get(chip.value)!)
            sprite.anchor.set(0.5)
            sprite.scale.set(scale)
            sprite.position.set(x + (i % 2 ? 2 : -2), y - i * 7 * (scale / 0.62))
            layer.addChild(sprite)
            this.chipSprites.push(sprite)
        })

        // Side stakes are read off their own result badge, and a second label
        // under a small stack only crowds the nameplate row.
        if (scale < 0.5) return

        const total = label(this.PIXI, formatNumber(amount), 16, 0xf7f3e8, '800')
        total.anchor.set(0.5)
        total.position.set(x, y + 34)
        const box = new this.PIXI.Container()
        const bg = new this.PIXI.Graphics()
        const w = total.width + 16
        bg.roundRect(x - w / 2, y + 22, w, 24, 12).fill({ color: 0x0b0806, alpha: 0.8 })
        box.addChild(bg, total)
        this.uiLayer.addChild(box)
        this.badges.push(box)
    }
}
