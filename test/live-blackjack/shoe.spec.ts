import { describe, expect, it } from 'vitest'
import { Shoe } from '#server/utils/live-blackjack/shoe'
import { LB_RULES } from '#shared/utils/live-blackjack/rules'

describe('Shoe', () => {
    it('holds a full six-deck shoe', () => {
        const shoe = new Shoe()
        expect(shoe.decks).toBe(6)
        expect(shoe.total).toBe(312)
        expect(shoe.remaining).toBe(312)
        expect(shoe.dealt).toBe(0)
    })

    it('contains exactly six of every card', () => {
        const shoe = new Shoe()
        const seen = new Map<string, number>()
        for (let i = 0; i < 312; i++) {
            const card = shoe.draw()
            const key = `${card.rank}-${card.suit}`
            seen.set(key, (seen.get(key) ?? 0) + 1)
        }
        expect(seen.size).toBe(52)
        expect([...seen.values()].every(count => count === 6)).toBe(true)
    })

    it('deals off the top rather than reshuffling per hand', () => {
        const shoe = new Shoe()
        for (let i = 1; i <= 40; i++) {
            shoe.draw()
            expect(shoe.dealt).toBe(i)
            expect(shoe.remaining).toBe(312 - i)
        }
    })

    it('only asks for a shuffle once the cut card is reached', () => {
        const shoe = new Shoe()
        const cutAt = Math.round(312 * LB_RULES.penetration)
        for (let i = 0; i < cutAt - 1; i++) {
            shoe.draw()
            expect(shoe.needsShuffle).toBe(false)
        }
        shoe.draw()
        expect(shoe.needsShuffle).toBe(true)
        // The reserve behind the cut card is what lets the current round finish.
        expect(shoe.remaining).toBeGreaterThan(0)
    })

    it('counts down to the cut card, not to the last card', () => {
        const shoe = new Shoe()
        expect(shoe.untilShuffle).toBe(234)
        for (let i = 0; i < 100; i++) shoe.draw()
        expect(shoe.untilShuffle).toBe(134)
    })

    it('refills and resets the counter on shuffle', () => {
        const shoe = new Shoe()
        for (let i = 0; i < 250; i++) shoe.draw()
        shoe.shuffle()
        expect(shoe.dealt).toBe(0)
        expect(shoe.remaining).toBe(312)
        expect(shoe.needsShuffle).toBe(false)
    })

    it('marks a hole card hidden and leaves every other card face up', () => {
        const shoe = new Shoe()
        expect(shoe.draw().hidden).toBeUndefined()
        expect(shoe.draw(true).hidden).toBe(true)
    })

    it('refuses to deal past the last card instead of quietly reshuffling', () => {
        const shoe = new Shoe()
        for (let i = 0; i < 312; i++) shoe.draw()
        expect(shoe.remaining).toBe(0)
        // A silent reshuffle here would leave the table broadcasting a running
        // count for a deck that no longer exists.
        expect(() => shoe.draw()).toThrow(/empty shoe/)
    })

    it('gives every card a distinct id so the client can track it', () => {
        const shoe = new Shoe()
        const ids = new Set<string>()
        for (let i = 0; i < 312; i++) ids.add(shoe.draw().id)
        expect(ids.size).toBe(312)
    })

    it('does not deal the same order twice', () => {
        const order = (shoe: Shoe) =>
            Array.from({ length: 40 }, () => {
                const card = shoe.draw()
                return `${card.rank}${card.suit}`
            }).join()
        expect(order(new Shoe())).not.toBe(order(new Shoe()))
    })
})
