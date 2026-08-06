import { describe, it, expect } from 'vitest'
import { normaliseCategory, prefixesForLabel, GENERAL_LABEL } from '../../shared/utils/analytics-categories'

describe('normaliseCategory', () => {
    it('collapses every blackjack variant to a single label', () => {
        const variants = [
            'blackjack',
            'live-blackjack',
            'live-blackjack:side:perfectPairs',
            'live-blackjack:side:twentyOnePlusThree',
            'live-blackjack:double',
            'live-blackjack:split',
            'live-blackjack:insurance',
            'live-blackjack:recovery'
        ]
        for (const raw of variants) {
            expect(normaliseCategory(raw)).toBe('Blackjack')
        }
    })

    it('strips everything after the first colon', () => {
        expect(normaliseCategory('shapezz:workshop')).toBe('Shapezz')
        expect(normaliseCategory('shapezz:weapon')).toBe('Shapezz')
    })

    it('is case-insensitive on the prefix', () => {
        expect(normaliseCategory('HackOps')).toBe('HackOps')
    })

    it('maps null to General', () => {
        expect(normaliseCategory(null)).toBe(GENERAL_LABEL)
    })

    it('maps every known category to its display label', () => {
        expect(normaliseCategory('gems')).toBe('Gems')
        expect(normaliseCategory('gem market')).toBe('Gems')
        expect(normaliseCategory('gem exchange')).toBe('Gems')
        expect(normaliseCategory('bookofshadows')).toBe('Book of Shadows')
        expect(normaliseCategory('fireinthehole')).toBe('Fire in the Hole')
        expect(normaliseCategory('candymadness')).toBe('Candy Madness')
        expect(normaliseCategory('magichands')).toBe('Magic Hands')
        expect(normaliseCategory('xenoslot')).toBe('Xeno Slot')
        expect(normaliseCategory('aethergates')).toBe('Aethergates')
        expect(normaliseCategory('roulette')).toBe('Roulette')
        expect(normaliseCategory('casino-holdem')).toBe('Casino Hold\'em')
        expect(normaliseCategory('three-card-poker')).toBe('Three Card Poker')
        expect(normaliseCategory('baccarat')).toBe('Baccarat')
    })

    it('falls back to a readable Title Case for unrecognised categories', () => {
        expect(() => normaliseCategory('some-new-game')).not.toThrow()
        expect(normaliseCategory('some-new-game')).toBe('Some New Game')
        expect(normaliseCategory('mystery')).toBe('Mystery')
    })
})

describe('prefixesForLabel', () => {
    it('round-trips every alias back to its raw prefixes', () => {
        const rawPrefixes = [
            'blackjack', 'live-blackjack', 'lootbox', 'gems', 'gem market', 'gem exchange',
            'miner', 'xeno', 'pirates', 'hackops', 'rakeback', 'colony', 'dice', 'limbo',
            'bank', 'shapezz', 'wheel', 'xenoslot', 'aethergates', 'bookofshadows',
            'fireinthehole', 'candymadness', 'magichands', 'spinata', 'roulette',
            'casino-holdem', 'three-card-poker', 'baccarat'
        ]
        for (const prefix of rawPrefixes) {
            const label = normaliseCategory(prefix)
            expect(prefixesForLabel(label)).toContain(prefix)
        }
    })

    it('groups all blackjack prefixes under one label', () => {
        expect(prefixesForLabel('Blackjack').sort()).toEqual(['blackjack', 'live-blackjack'])
    })

    it('groups every gem-related raw category under Gems', () => {
        expect(prefixesForLabel('Gems').sort()).toEqual(['gem exchange', 'gem market', 'gems'])
    })

    it('never throws for an unknown label', () => {
        expect(() => prefixesForLabel('Not A Real Label')).not.toThrow()
        expect(prefixesForLabel('Not A Real Label')).toEqual(['not a real label'])
    })
})
