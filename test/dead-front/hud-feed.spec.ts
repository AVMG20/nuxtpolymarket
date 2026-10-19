import { describe, expect, it } from 'vitest'
import { DF_HUD_FEED_MAX, DF_HUD_FEED_MS, dfHudFeedLine, dfHudPruneFeed, dfHudPushFeed } from '../../app/utils/dead-front/engine/hud'
import type { DfHudFeedContext, DfHudFeedItem } from '../../app/utils/dead-front/engine/hud'

const ctx: DfHudFeedContext = {
    me: 0,
    name: pid => ['Arno', 'Bea', 'Cas'][pid] ?? '?',
    color: pid => ['#111111', '#222222', '#333333'][pid] ?? '#000000',
    doorLabel: id => (id === 'nave' ? 'Chapel Nave' : null),
    weaponName: id => (id === 'kar98k' ? 'Kar98k' : id),
    powerupName: kind => (kind === 'insta' ? 'Insta-Kill' : kind)
}

describe('dfHudFeedLine', () => {
    it('names teammates and calls you "You"', () => {
        expect(dfHudFeedLine({ k: 'down', p: 1 }, ctx)).toMatchObject({ who: 'Bea', whoColor: '#222222', text: 'is down', tone: 'red' })
        expect(dfHudFeedLine({ k: 'down', p: 0 }, ctx)).toMatchObject({ who: 'You', text: 'are down' })
    })

    it('reads a revive as reviver then revived', () => {
        expect(dfHudFeedLine({ k: 'revived', p: 2, by: 1 }, ctx)).toMatchObject({ who: 'Bea', text: 'revived', target: 'Cas', targetColor: '#333333', tone: 'green' })
        expect(dfHudFeedLine({ k: 'revived', p: 2, by: 2 }, ctx)).toMatchObject({ who: 'Cas', text: 'got back up', target: null })
    })

    it('labels doors from the buy event and the power without an actor', () => {
        expect(dfHudFeedLine({ k: 'buy', p: 1, what: 'door:nave' }, ctx)).toMatchObject({ who: 'Bea', text: 'opened the Chapel Nave' })
        expect(dfHudFeedLine({ k: 'buy', p: 1, what: 'door:x' }, ctx)).toMatchObject({ text: 'opened a door' })
        expect(dfHudFeedLine({ k: 'power' }, ctx)).toMatchObject({ who: null, whoColor: null, text: 'The power is on', tone: 'blue' })
    })

    it('covers power-ups, Pack-a-Punch and the wonder weapon', () => {
        expect(dfHudFeedLine({ k: 'powerup', p: 1, kind: 'insta' }, ctx)?.text).toBe('grabbed Insta-Kill')
        expect(dfHudFeedLine({ k: 'pap', p: 0, weapon: 'kar98k', tier: 1 }, ctx)).toMatchObject({ who: 'You', text: 'packed the Kar98k', tone: 'gold' })
        expect(dfHudFeedLine({ k: 'buy', p: 2, what: 'weapon:wunder' }, ctx)?.text).toBe('claimed the wonder weapon')
        expect(dfHudFeedLine({ k: 'papReturn', p: 0, weapon: 'kar98k', tier: 1 }, ctx)).toMatchObject({ who: null, text: 'Pack-a-Punch returned your Kar98k', tone: 'gold' })
        expect(dfHudFeedLine({ k: 'papReturn', p: 1, weapon: 'kar98k', tier: 1 }, ctx)).toBeNull()
        expect(dfHudFeedLine({ k: 'box', what: 'move' }, ctx)).toMatchObject({ who: null, text: 'The mystery box moved' })
        expect(dfHudFeedLine({ k: 'box', what: 'open' }, ctx)).toBeNull()
    })

    it('ignores the noise', () => {
        expect(dfHudFeedLine({ k: 'buy', p: 1, what: 'weapon:mp18' }, ctx)).toBeNull()
        expect(dfHudFeedLine({ k: 'points', p: 1, amount: 10 }, ctx)).toBeNull()
        expect(dfHudFeedLine({ k: 'round', round: 3 }, ctx)).toBeNull()
        expect(dfHudFeedLine({ k: 'plank', b: 'w1', delta: 1 }, ctx)).toBeNull()
    })
})

describe('dfHudPushFeed', () => {
    const line = dfHudFeedLine({ k: 'power' }, ctx)!

    it('keeps the newest few lines with unique ids', () => {
        const feed: DfHudFeedItem[] = []
        for (let i = 0; i < DF_HUD_FEED_MAX + 3; i++) dfHudPushFeed(feed, line, 1000 + i)
        expect(feed).toHaveLength(DF_HUD_FEED_MAX)
        expect(new Set(feed.map(f => f.id)).size).toBe(DF_HUD_FEED_MAX)
        expect(feed.at(-1)!.born).toBe(1000 + DF_HUD_FEED_MAX + 2)
    })

    it('drops lines once they expire', () => {
        const feed: DfHudFeedItem[] = []
        dfHudPushFeed(feed, line, 0)
        dfHudPushFeed(feed, line, 100)
        dfHudPruneFeed(feed, DF_HUD_FEED_MS + 50)
        expect(feed.map(f => f.born)).toEqual([100])
        dfHudPushFeed(feed, line, DF_HUD_FEED_MS + 200)
        expect(feed.map(f => f.born)).toEqual([DF_HUD_FEED_MS + 200])
    })
})

describe('lightning rods in the feed', () => {
    it('counts thrown rods and speaks once for a reset', () => {
        expect(dfHudFeedLine({ k: 'rod', id: 'rod-1', p: 1, on: true, n: 2 }, ctx)!.text).toBe('Lightning rod thrown (2/3)')
        expect(dfHudFeedLine({ k: 'rod', id: 'rod-0', p: -1, on: false, n: 1 }, ctx)).toBeNull()
        expect(dfHudFeedLine({ k: 'rod', id: 'rod-1', p: -1, on: false, n: 0 }, ctx)!.text).toBe('The rods lost their charge')
    })
})
