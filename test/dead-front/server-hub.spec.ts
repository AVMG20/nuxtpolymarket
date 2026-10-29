import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DF_LOBBY_GRACE_MS, DfHub } from '#server/utils/dead-front/hub'
import type { DfSocket } from '#server/utils/dead-front/hub'
import type { DfServerMsg } from '#shared/utils/dead-front/protocol'
import type { DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'

const profile = (): DfProfileView => ({
    unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
    perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
})
const report: DfProgressReport = { perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] }

interface Fake extends DfSocket {
    inbox: DfServerMsg[]
    closed: number | null
    last: <T extends DfServerMsg['t']>(t: T) => Extract<DfServerMsg, { t: T }> | undefined
}

let seq = 0
function socket(): Fake {
    const inbox: DfServerMsg[] = []
    const s: Fake = {
        id: `s${++seq}`,
        inbox,
        closed: null,
        send: frame => inbox.push(JSON.parse(frame) as DfServerMsg),
        close: (code) => {
            s.closed = code ?? 1000
        },
        last: <T extends DfServerMsg['t']>(t: T) => [...inbox].reverse().find(m => m.t === t) as Extract<DfServerMsg, { t: T }> | undefined
    }
    return s
}

describe('DfHub', () => {
    let applied: string[]
    let hub: DfHub

    beforeEach(() => {
        vi.useFakeTimers()
        applied = []
        hub = new DfHub({
            loadProfile: async () => profile(),
            applyResult: async (userId) => {
                applied.push(userId)
                return report
            }
        })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    const send = (s: Fake, msg: object) => hub.message(s.id, JSON.stringify(msg))
    const flush = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }

    it('creates, joins, readies, starts and leaves', async () => {
        const a = socket()
        const b = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        hub.open(b, { id: 'ub', name: 'Bob' })
        send(a, { t: 'create' })
        const lobby = a.last('lobby')!.lobby!
        expect(lobby.members).toEqual([{ userId: 'ua', name: 'Alice', ready: true, host: true }])
        expect(b.last('lobbies')!.lobbies).toHaveLength(1)
        send(b, { t: 'join', id: lobby.id })
        expect(a.last('lobby')!.lobby!.members).toHaveLength(2)
        send(a, { t: 'start' })
        await flush()
        expect(a.last('error')?.message).toMatch(/ready/)
        send(b, { t: 'ready', ready: true })
        send(a, { t: 'start' })
        await flush()
        expect(a.last('start')?.start.you).toBe(0)
        expect(b.last('start')?.start.you).toBe(1)
        vi.advanceTimersByTime(120)
        expect(b.last('snap')).toBeDefined()
        expect(hub.summaries()[0]).toMatchObject({ state: 'playing', players: 2 })
        // A third player can't join a running match.
        const c = socket()
        hub.open(c, { id: 'uc', name: 'Cara' })
        send(c, { t: 'join', id: lobby.id })
        expect(c.last('error')).toBeDefined()
        // Bob leaves: his result is written once and he gets his end screen.
        send(b, { t: 'leave' })
        await flush()
        expect(applied).toEqual(['ub'])
        expect(b.last('end')).toBeDefined()
        expect(b.last('lobby')?.lobby).toBeNull()
        // Alice leaves too: the match ends, the lobby goes away.
        send(a, { t: 'leave' })
        await flush()
        expect(applied.sort()).toEqual(['ua', 'ub'])
        expect(hub.summaries()).toEqual([])
    })

    it('holds a dropped member\'s place in the lobby for a while', () => {
        const a = socket()
        const b = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        hub.open(b, { id: 'ub', name: 'Bob' })
        send(a, { t: 'create' })
        const id = a.last('lobby')!.lobby!.id
        send(b, { t: 'join', id })
        send(b, { t: 'ready', ready: true })
        hub.close(b.id)
        expect(a.last('lobby')!.lobby!.members[1]).toMatchObject({ userId: 'ub', away: true, ready: false })
        const b2 = socket()
        hub.open(b2, { id: 'ub', name: 'Bob' })
        expect(b2.last('lobby')!.lobby!.id).toBe(id)
        expect(a.last('lobby')!.lobby!.members[1]!.away).toBeUndefined()
        // gone for good: the place expires
        hub.close(b2.id)
        vi.advanceTimersByTime(DF_LOBBY_GRACE_MS + 10)
        expect(a.last('lobby')!.lobby!.members).toHaveLength(1)
    })

    it('lets the next member lead while the host is reconnecting', async () => {
        const a = socket()
        const b = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        hub.open(b, { id: 'ub', name: 'Bob' })
        send(a, { t: 'create' })
        send(b, { t: 'join', id: a.last('lobby')!.lobby!.id })
        hub.close(a.id)
        expect(b.last('lobby')!.lobby!.members.find(m => m.host)!.userId).toBe('ub')
        send(b, { t: 'start' })
        await flush()
        expect(b.last('start')).toBeDefined()
    })

    it('rebuilds a lobby a restart lost, with its old host in the lead', () => {
        const b = socket()
        hub.open(b, { id: 'ub', name: 'Bob' })
        expect(b.last('lobby')?.lobby).toBeNull()
        send(b, { t: 'rejoin', id: 'abc123', host: 'ua' })
        expect(b.last('lobby')!.lobby).toMatchObject({ id: 'abc123', state: 'lobby' })
        const a = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        send(a, { t: 'rejoin', id: 'abc123', host: 'ua' })
        expect(b.last('lobby')!.lobby!.members.map(m => [m.userId, m.host])).toEqual([['ua', true], ['ub', false]])
        // ids are checked
        const c = socket()
        hub.open(c, { id: 'uc', name: 'Cara' })
        send(c, { t: 'rejoin', id: '../nope' })
        expect(c.last('lobby')?.lobby).toBeNull()
    })

    it('hands the host to the next member', () => {
        const a = socket()
        const b = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        hub.open(b, { id: 'ub', name: 'Bob' })
        send(a, { t: 'create' })
        send(b, { t: 'join', id: a.last('lobby')!.lobby!.id })
        send(a, { t: 'leave' })
        expect(b.last('lobby')!.lobby!.members).toEqual([{ userId: 'ub', name: 'Bob', ready: true, host: true }])
    })

    it('replaces an older tab and resumes the match after a reconnect', async () => {
        const a = socket()
        hub.open(a, { id: 'ua', name: 'Alice' })
        send(a, { t: 'create' })
        send(a, { t: 'start' })
        await flush()
        expect(a.last('start')).toBeDefined()
        const a2 = socket()
        hub.open(a2, { id: 'ua', name: 'Alice' })
        expect(a.closed).toBe(4409)
        hub.close(a.id)
        expect(a2.last('start')).toBeDefined()
        vi.advanceTimersByTime(120)
        expect(a2.last('snap')).toBeDefined()
        // Dropping the socket keeps the player for the grace period, then writes the result.
        hub.close(a2.id)
        vi.advanceTimersByTime(16_000)
        await flush()
        expect(applied).toEqual(['ua'])
    })
})
