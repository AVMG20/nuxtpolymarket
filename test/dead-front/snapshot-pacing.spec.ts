import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DfMatch } from '#server/utils/dead-front/match'
import type { DfSnapshot } from '#shared/utils/dead-front/protocol'

// Snapshot pacing: a client that reads slower than the stream (a weak link, a
// busy tab) gets fewer frames instead of an ever longer queue, and no event a
// held-back frame carried is lost.

const profile = {
    unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
    perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
} as const

interface Client {
    snaps: DfSnapshot[]
    backlog: number
    cut: number
}

async function makeMatch(users: string[]) {
    const clients = new Map<string, Client>(users.map(u => [u, { snaps: [], backlog: 0, cut: 0 }]))
    const match = await DfMatch.create(users.map(u => ({ userId: u, name: u })), {
        send: (u, f) => {
            if (f.startsWith('{"t":"snap"')) clients.get(u)!.snaps.push(JSON.parse(f).s)
        },
        backlog: u => clients.get(u)!.backlog,
        cut: (u) => {
            clients.get(u)!.cut++
        },
        onPlayerGone: () => {},
        onFinished: () => {},
        loadProfile: async () => structuredClone(profile) as never,
        applyResult: async () => ({ perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] })
    })
    let seq = 0
    /** A movement report, with the snapshot tick read (`st`) when given. */
    const input = (u: string, st?: number) => match.handle(u, { t: 'in', seq: ++seq, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0, st })
    const chats = (c: Client) => c.snaps.flatMap(s => s.events).filter(e => e.k === 'chat').map(e => (e as { text: string }).text)
    return { match, clients, input, chats }
}

describe('snapshot pacing', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('streams every tick to a client that keeps reading', async () => {
        const { match, clients, input } = await makeMatch(['a', 'b'])
        const a = clients.get('a')!
        // the client reads each frame and reports it on its next input
        const tick = setInterval(() => input('a', a.snaps[a.snaps.length - 1]?.tick ?? 0), 50)
        const keepB = setInterval(() => input('b'), 50)
        vi.advanceTimersByTime(3000)
        clearInterval(tick)
        clearInterval(keepB)
        expect(a.snaps.length).toBeGreaterThanOrEqual(58)
        await match.finish()
    })

    it('holds a client that stopped reading to probes and carries the held events', async () => {
        const { match, clients, input, chats } = await makeMatch(['a', 'b'])
        const a = clients.get('a')!
        const b = clients.get('b')!
        let read = 0
        const report = setInterval(() => input('a', read), 50)
        const keepB = setInterval(() => input('b'), 50)
        let n = 0
        const talk = setInterval(() => match.sim.chat(1, `m${++n}`), 70)
        // reading along for a second
        for (let i = 0; i < 20; i++) {
            vi.advanceTimersByTime(50)
            read = a.snaps[a.snaps.length - 1]?.tick ?? 0
        }
        // then the client stalls for 3 s: it keeps reporting the last frame it read
        const before = a.snaps.length
        vi.advanceTimersByTime(3000)
        const held = a.snaps.length - before
        // a 750 ms grace, then a probe every 500 ms, not 60 frames
        expect(held).toBeLessThanOrEqual(15 + 7)
        expect(held).toBeGreaterThanOrEqual(15)
        // it reads again: the stream resumes at full rate
        for (let i = 0; i < 40; i++) {
            vi.advanceTimersByTime(50)
            read = a.snaps[a.snaps.length - 1]?.tick ?? 0
        }
        expect(a.snaps.length - before - held).toBeGreaterThanOrEqual(36)
        clearInterval(report)
        clearInterval(keepB)
        clearInterval(talk)
        vi.advanceTimersByTime(100)
        // every chat line arrived once and in order, as it did for the player who kept up
        expect(chats(a)).toEqual(chats(b))
        expect(chats(a).length).toBeGreaterThan(50)
        await match.finish()
    })

    it('never holds back a client that doesn\'t report what it read', async () => {
        const { match, clients, input } = await makeMatch(['a', 'b'])
        const keep = setInterval(() => {
            input('a')
            input('b')
        }, 50)
        vi.advanceTimersByTime(3000)
        clearInterval(keep)
        expect(clients.get('a')!.snaps.length).toBeGreaterThanOrEqual(58)
        await match.finish()
    })

    it('adds nothing to a socket with a backlog until it drains, then cuts it if it never does', async () => {
        const { match, clients, input, chats } = await makeMatch(['a', 'b'])
        const a = clients.get('a')!
        const b = clients.get('b')!
        const keep = setInterval(() => {
            input('a')
            input('b')
        }, 50)
        // nobody falls over the two minutes this takes
        match.sim.dev(0, { k: 'hold', on: true })
        vi.advanceTimersByTime(500)
        a.backlog = 200_000
        const before = a.snaps.length
        match.sim.chat(0, 'while full')
        vi.advanceTimersByTime(2000)
        expect(a.snaps.length).toBe(before)
        a.backlog = 0
        vi.advanceTimersByTime(100)
        expect(a.snaps.length).toBeGreaterThan(before)
        expect(chats(a)).toEqual(chats(b))
        expect(chats(a)).toContain('while full')
        // a socket that stays full (a sleeping phone) is cut so it reconnects and resyncs
        a.backlog = 200_000
        vi.advanceTimersByTime(119_000)
        expect(a.cut).toBe(0)
        vi.advanceTimersByTime(2000)
        expect(a.cut).toBe(1)
        clearInterval(keep)
        await match.finish()
    })

    it('ignores a read report from beyond the current tick (an older match on the same socket)', async () => {
        const { match, clients, input } = await makeMatch(['a', 'b'])
        const keep = setInterval(() => {
            input('a', 999_999)
            input('b')
        }, 50)
        vi.advanceTimersByTime(3000)
        clearInterval(keep)
        expect(clients.get('a')!.snaps.length).toBeGreaterThanOrEqual(58)
        await match.finish()
    })
})
