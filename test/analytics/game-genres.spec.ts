import { describe, it, expect } from 'vitest'
import { GENRES, GENRE_LABELS, genreForLabel, genreForCategory, labelsForGenre } from '../../shared/utils/game-genres'
import { normaliseCategory } from '../../shared/utils/analytics-categories'

describe('genreForCategory', () => {
    it('puts every casino game in the casino bucket', () => {
        const raw = [
            'dice', 'limbo', 'wheel', 'magichands', 'xenoslot', 'candymadness',
            'aethergates', 'fireinthehole', 'bookofshadows', 'spinata', 'roulette',
            'baccarat', 'casino-holdem', 'three-card-poker', 'blackjack', 'live-blackjack'
        ]
        for (const category of raw) {
            expect(genreForCategory(category), category).toBe('casino')
        }
    })

    // The three game buckets mirror the sidebar groups in
    // `app/layouts/default.vue`; these lists are those groups.
    it('puts the idle games in the idle bucket', () => {
        // Lootboxes are the one addition: they drop on a timer rather than
        // being bought, so they count as idle emission rather than a wager.
        for (const category of ['miner', 'xeno', 'hackops', 'colony', 'polytown', 'town', 'lootbox']) {
            expect(genreForCategory(category), category).toBe('idle')
        }
    })

    it('puts the active games in the active bucket', () => {
        const sidebar = ['pathwarden', 'pirates', 'shapezz', 'call-of-xeno', 'voxel-arena', 'firewall', 'meadowbrawl', 'tcg']
        for (const category of [...sidebar, 'battler', 'storm-the-house']) {
            expect(genreForCategory(category), category).toBe('active')
        }
    })

    it('puts non-game money movement in the economy bucket', () => {
        for (const category of ['bank', 'gems', 'gem exchange', 'rakeback', 'prestige']) {
            expect(genreForCategory(category), category).toBe('economy')
        }
        expect(genreForCategory(null)).toBe('economy')
    })

    it('ignores everything after the first colon', () => {
        expect(genreForCategory('live-blackjack:side:perfectPairs')).toBe('casino')
        expect(genreForCategory('shapezz:workshop')).toBe('active')
        expect(genreForCategory('miner:lootbox')).toBe('idle')
        expect(genreForCategory('pathwarden:cashout')).toBe('active')
    })

    it('falls back to economy for an unknown category instead of throwing', () => {
        expect(() => genreForCategory('some-new-game')).not.toThrow()
        expect(genreForCategory('some-new-game')).toBe('economy')
    })
})

describe('genre tables', () => {
    it('labels every genre', () => {
        for (const genre of GENRES) {
            expect(GENRE_LABELS[genre]).toBeTruthy()
        }
    })

    it('round-trips each mapped label back to its own genre', () => {
        for (const genre of GENRES) {
            for (const label of labelsForGenre(genre)) {
                expect(genreForLabel(label), label).toBe(genre)
            }
        }
    })

    it('maps every label the category table can produce', () => {
        // Anything the analytics table names should be deliberately bucketed,
        // not silently swept into economy by the fallback.
        const mapped = new Set(GENRES.flatMap(labelsForGenre))
        const rawPrefixes = [
            'dice', 'limbo', 'wheel', 'magichands', 'xenoslot', 'candymadness',
            'aethergates', 'fireinthehole', 'bookofshadows', 'spinata', 'roulette',
            'baccarat', 'casino-holdem', 'three-card-poker', 'blackjack', 'live-blackjack',
            'lootbox', 'miner', 'colony', 'shapezz', 'xeno', 'hackops', 'polytown', 'town',
            'tcg', 'meadowbrawl', 'pathwarden', 'pirates', 'firewall', 'call-of-xeno',
            'battler', 'storm-the-house', 'voxel-arena', 'bank', 'gems', 'gem market',
            'gem exchange', 'rakeback', 'prestige', 'draft', 'assets'
        ]
        for (const prefix of rawPrefixes) {
            expect(mapped, prefix).toContain(normaliseCategory(prefix))
        }
    })
})
