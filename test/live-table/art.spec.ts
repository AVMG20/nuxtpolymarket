import { describe, expect, it } from 'vitest'
import { LB_CHIPS } from '#shared/utils/live-blackjack/chips'
import type { LbRank, LbSuit } from '#shared/utils/live-blackjack/types'
import { cardBack, cardFace, chip, chipStack, chipsFor } from '../../app/utils/live-table/art'

const RANKS: LbRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: LbSuit[] = ['hearts', 'diamonds', 'clubs', 'spades']

function isValidSvg(markup: string) {
    return markup.startsWith('<svg') && markup.endsWith('</svg>') && markup.includes('viewBox')
}

describe('cardFace', () => {
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            it(`renders a non-empty, valid card for ${rank} of ${suit}`, () => {
                const svg = cardFace(rank, suit)
                expect(isValidSvg(svg)).toBe(true)
                expect(svg.length).toBeGreaterThan(0)
            })
        }
    }
})

describe('cardBack', () => {
    it('renders a non-empty, valid card back', () => {
        const svg = cardBack()
        expect(isValidSvg(svg)).toBe(true)
        expect(svg.length).toBeGreaterThan(0)
    })

    it('gives every card back a distinct clip-path id', () => {
        const a = cardBack()
        const b = cardBack()
        const idOf = (svg: string) => svg.match(/id="(ltbk[a-z0-9]+)"/)?.[1]
        expect(idOf(a)).toBeDefined()
        expect(idOf(a)).not.toBe(idOf(b))
    })
})

describe('chip', () => {
    for (const def of LB_CHIPS) {
        it(`renders a non-empty, valid chip for ${def.label}`, () => {
            const svg = chip(def.value)
            expect(isValidSvg(svg)).toBe(true)
            expect(svg).toContain(`>${def.label}<`)
        })
    }

    it('falls back rather than throwing for a value off the ladder', () => {
        expect(() => chip(7)).not.toThrow()
        expect(isValidSvg(chip(7))).toBe(true)
    })
})

describe('chipsFor', () => {
    it('breaks an amount down into chips that sum back to it', () => {
        for (const amount of [1, 7, 130, 1250, 999_999]) {
            const stack = chipsFor(amount, 100)
            const sum = stack.reduce((total, c) => total + c.value, 0)
            expect(sum).toBe(amount)
        }
    })

    it('orders chips largest first', () => {
        const stack = chipsFor(1250, 100)
        for (let i = 1; i < stack.length; i++) {
            expect(stack[i - 1]!.value).toBeGreaterThanOrEqual(stack[i]!.value)
        }
    })

    it('does not throw for an amount beyond the top of the ladder', () => {
        expect(() => chipsFor(Number.MAX_SAFE_INTEGER)).not.toThrow()
        expect(() => chipsFor(0)).not.toThrow()
    })
})

describe('chipStack', () => {
    it('renders a wrapping div sized for the requested chip count', () => {
        const svg = chipStack(1250, { size: 56, max: 8 })
        expect(svg.startsWith('<div class="lt-stack"')).toBe(true)
        expect(svg).toContain('width:56px')
    })

    it('does not throw for an out-of-ladder or oversized amount', () => {
        expect(() => chipStack(7)).not.toThrow()
        expect(() => chipStack(Number.MAX_SAFE_INTEGER)).not.toThrow()
    })

    it('defaults to the larger bet-spot chip size', () => {
        const svg = chipStack(5)
        expect(svg).toContain('width:56px')
    })
})
