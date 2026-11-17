import { describe, expect, it } from 'vitest'
import type { CarPose } from '../../app/utils/nitro-rush/types'
import {
    NR_LIVE_BURST,
    NR_LIVE_DRIVING_MS,
    NR_LIVE_HANDOFF_MS,
    NR_LIVE_MAX_FRAME,
    NR_LIVE_MAX_PER_USER,
    NR_LIVE_ROOM_MAX,
    NrLiveHub,
    nrLiveTrackId,
    parseNrLiveMessage,
    takeNrLiveToken,
    type NrLiveSocket
} from '#server/utils/nitro-rush-live'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'
import { CARS } from '#shared/utils/nitro-rush/cars'
import { busyCounts, LiveGhosts, poseMessage } from '../../app/utils/nitro-rush/live'

const TRACK = TRACKS[0]!.id
const OTHER = TRACKS[1]!.id
const ID = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
const pose = (over: Record<string, unknown> = {}) => JSON.stringify({ t: 'pose', at: 1000, paint: 'cyan', car: 'og', pose: { ...ID, ...over } })

describe('live message validation', () => {
    it('accepts a sane pose and renormalizes its quaternion', () => {
        const msg = parseNrLiveMessage(JSON.stringify({ t: 'pose', at: 5, paint: 'lime', pose: { x: 1, y: 2, z: 3, qx: 0, qy: 0.7072, qz: 0, qw: 0.7072 } }))
        expect(msg?.t).toBe('pose')
        if (msg?.t !== 'pose') return
        expect(Math.hypot(msg.pose.qx, msg.pose.qy, msg.pose.qz, msg.pose.qw)).toBeCloseTo(1, 10)
        expect(msg.paint).toBe('lime')
    })

    it('rejects bad numbers, huge values and unnormalized quaternions', () => {
        expect(parseNrLiveMessage(pose({ x: 'NaN' }))).toBeNull()
        expect(parseNrLiveMessage(pose({ x: null }))).toBeNull()
        expect(parseNrLiveMessage(pose({ y: 1e9 }))).toBeNull()
        expect(parseNrLiveMessage(pose({ z: -60_000 }))).toBeNull()
        expect(parseNrLiveMessage(pose({ qw: 2 }))).toBeNull()
        expect(parseNrLiveMessage(pose({ qw: 0 }))).toBeNull()
        expect(parseNrLiveMessage(pose({ qx: 1, qw: 1 }))).toBeNull()
        // JSON can't carry NaN or Infinity, but the parse must hold if one sneaks in as 1e999.
        expect(parseNrLiveMessage('{"t":"pose","at":1,"paint":"cyan","pose":{"x":1e999,"y":0,"z":0,"qx":0,"qy":0,"qz":0,"qw":1}}')).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'pose', at: -1, paint: 'cyan', pose: ID }))).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'pose', paint: 'cyan', pose: ID }))).toBeNull()
    })

    it('rejects an unknown paint, an unknown type, garbage and oversized frames', () => {
        expect(parseNrLiveMessage(JSON.stringify({ t: 'pose', at: 1, paint: 'chrome', pose: ID }))).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'teleport' }))).toBeNull()
        expect(parseNrLiveMessage('not json')).toBeNull()
        expect(parseNrLiveMessage('null')).toBeNull()
        const big = JSON.stringify({ t: 'pose', at: 1, paint: 'cyan', pose: ID, pad: 'x'.repeat(NR_LIVE_MAX_FRAME) })
        expect(parseNrLiveMessage(big)).toBeNull()
    })

    it('keeps the car, and shows the first car for a missing or unknown one', () => {
        const car = (raw: unknown) => {
            const msg = parseNrLiveMessage(JSON.stringify({ t: 'pose', at: 1, paint: 'cyan', car: raw, pose: ID }))
            return msg?.t === 'pose' ? msg.car : null
        }
        expect(car('og')).toBe('og')
        expect(car(undefined)).toBe(CARS[0].id)
        expect(car('hovercraft')).toBe(CARS[0].id)
        expect(car({ id: 'og' })).toBe(CARS[0].id)
    })

    it('takes built-in tracks and bounded custom ids only', () => {
        expect(nrLiveTrackId(TRACK)).toBe(TRACK)
        expect(nrLiveTrackId('custom-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11')).toBe('custom-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11')
        expect(nrLiveTrackId('pub-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11')).toBe('pub-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11')
        expect(nrLiveTrackId('pub-<script>')).toBeNull()
        expect(nrLiveTrackId('nowhere')).toBeNull()
        expect(nrLiveTrackId(`custom-${'a'.repeat(80)}`)).toBeNull()
        expect(nrLiveTrackId('custom-<script>')).toBeNull()
        expect(nrLiveTrackId(42)).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'join', track: TRACK }))).toEqual({ t: 'join', track: TRACK })
        expect(parseNrLiveMessage(JSON.stringify({ t: 'join', track: 'nowhere' }))).toBeNull()
    })
})

describe('live rate limit', () => {
    it('allows a burst, then refills at the rate', () => {
        const bucket = { tokens: NR_LIVE_BURST, at: 0 }
        let passed = 0
        for (let i = 0; i < NR_LIVE_BURST * 2; i++) if (takeNrLiveToken(bucket, 0)) passed++
        expect(passed).toBe(NR_LIVE_BURST)
        expect(takeNrLiveToken(bucket, 50)).toBe(false)
        expect(takeNrLiveToken(bucket, 100)).toBe(true)
    })
})

function fakeSocket(id: string) {
    const sent: Record<string, unknown>[] = []
    const socket: NrLiveSocket & { sent: typeof sent, closed: number | null } = {
        id,
        sent,
        closed: null,
        send: frame => void sent.push(JSON.parse(frame)),
        close: (code) => {
            socket.closed = code ?? 0
        }
    }
    return socket
}

function setup() {
    const hub = new NrLiveHub()
    const connect = (id: string, userId: string, name = userId) => {
        const s = fakeSocket(id)
        hub.open(s, { id: userId, name }, 0)
        return s
    }
    return { hub, connect }
}

describe('live rooms', () => {
    it('relays a pose to the others on the same track, never back to the sender or to another track', () => {
        const { hub, connect } = setup()
        const a = connect('a', 'ua', 'Alice')
        const b = connect('b', 'ub', 'Bob')
        const c = connect('c', 'uc')
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('c', JSON.stringify({ t: 'join', track: OTHER }), 0)
        hub.message('a', pose({ x: 5 }), 10)
        expect(a.sent).toEqual([])
        expect(c.sent).toEqual([])
        expect(b.sent).toHaveLength(1)
        expect(b.sent[0]).toMatchObject({ t: 'pose', id: 'ua', name: 'Alice', paint: 'cyan', car: 'og', at: 1000, pose: { x: 5 } })
    })

    it('stamps the server-side name, whatever the client sends', () => {
        const { hub, connect } = setup()
        connect('a', 'ua', 'Alice')
        const b = connect('b', 'ub')
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('a', JSON.stringify({ t: 'pose', at: 1, paint: 'cyan', pose: ID, name: 'Admin', id: 'ub' }), 10)
        expect(b.sent[0]).toMatchObject({ id: 'ua', name: 'Alice' })
    })

    it('drops poses from a socket that has not joined a track', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const b = connect('b', 'ub')
        hub.message('b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('a', pose(), 10)
        expect(b.sent).toEqual([])
    })

    it('says a player is gone when they leave, switch track or close', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const b = connect('b', 'ub')
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('a', JSON.stringify({ t: 'join', track: OTHER }), 0)
        expect(b.sent).toEqual([{ t: 'gone', id: 'ua' }])
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('a', JSON.stringify({ t: 'leave' }), 0)
        expect(b.sent).toHaveLength(2)
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.close('a')
        expect(b.sent).toHaveLength(3)
        expect(hub.roomSize(TRACK)).toBe(1)
        expect(hub.peerCount).toBe(1)
        hub.close('b')
        expect(hub.roomSize(TRACK)).toBe(0)
    })

    it('counts one player with several tabs once, relays none of it back to them, and lets one tab drive', () => {
        const { hub, connect } = setup()
        const a1 = connect('a1', 'ua')
        const a2 = connect('a2', 'ua')
        const b = connect('b', 'ub')
        for (const id of ['a1', 'a2', 'b']) hub.message(id, JSON.stringify({ t: 'join', track: TRACK }), 0)
        expect(hub.roomSize(TRACK)).toBe(2)
        hub.message('a1', pose({ x: 1 }), 100)
        hub.message('a2', pose({ x: 2 }), 200)
        expect(a1.sent).toEqual([])
        expect(a2.sent).toEqual([])
        expect(b.sent.map(m => (m.pose as CarPose).x)).toEqual([1])
        // The first tab went quiet: the second takes over.
        hub.message('a2', pose({ x: 3 }), 100 + NR_LIVE_HANDOFF_MS)
        expect(b.sent.map(m => (m.pose as CarPose).x)).toEqual([1, 3])
        // Closing one tab doesn't make the player gone.
        hub.close('a1')
        expect(b.sent).toHaveLength(2)
        hub.close('a2')
        expect(b.sent.at(-1)).toEqual({ t: 'gone', id: 'ua' })
    })

    it('caps tabs per player and players per room', () => {
        const { hub, connect } = setup()
        const tabs = Array.from({ length: NR_LIVE_MAX_PER_USER + 1 }, (_, i) => connect(`t${i}`, 'same'))
        expect(tabs.at(-1)!.closed).toBe(4429)
        expect(tabs[0]!.closed).toBeNull()
        for (let i = 0; i < NR_LIVE_ROOM_MAX; i++) {
            connect(`p${i}`, `u${i}`)
            hub.message(`p${i}`, JSON.stringify({ t: 'join', track: TRACK }), 0)
        }
        const late = connect('late', 'ulate')
        hub.message('late', JSON.stringify({ t: 'join', track: TRACK }), 0)
        expect(late.sent).toEqual([{ t: 'full', track: TRACK }])
        expect(hub.roomSize(TRACK)).toBe(NR_LIVE_ROOM_MAX)
        // A player already in the room can still bring another tab.
        connect('p0b', 'u0')
        hub.message('p0b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        expect(hub.roomSize(TRACK)).toBe(NR_LIVE_ROOM_MAX)
    })

    it('drops a flood past the burst', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const b = connect('b', 'ub')
        hub.message('a', JSON.stringify({ t: 'join', track: TRACK }), 0)
        hub.message('b', JSON.stringify({ t: 'join', track: TRACK }), 0)
        for (let i = 0; i < 100; i++) hub.message('a', pose(), 0)
        expect(b.sent).toHaveLength(NR_LIVE_BURST - 1)
    })
})

const CUSTOM = 'custom-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11'
const PUB = 'pub-0b6f6c1e-8d1c-4c4e-9a59-2f7c3e0f9a11'
const join = (track: string) => JSON.stringify({ t: 'join', track })
const watchMsg = (on: boolean) => JSON.stringify({ t: 'watch', on })
const busyOf = (s: { sent: Record<string, unknown>[] }) => s.sent.filter(m => m.t === 'busy').map(m => m.tracks)

describe('live driving counts', () => {
    it('counts players who posed lately, not the ones merely in the room', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        connect('b', 'ub')
        hub.message('a', join(TRACK), 0)
        hub.message('b', join(TRACK), 0)
        expect(hub.busyCounts(0)).toEqual({})
        hub.message('a', pose(), 100)
        expect(hub.busyCounts(100)).toEqual({ [TRACK]: 1 })
    })

    it('stops counting a player once their last pose is too old', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        hub.message('a', join(TRACK), 0)
        hub.message('a', pose(), 1000)
        expect(hub.busyCounts(1000 + NR_LIVE_DRIVING_MS - 1)).toEqual({ [TRACK]: 1 })
        expect(hub.busyCounts(1000 + NR_LIVE_DRIVING_MS)).toEqual({})
    })

    it('counts a player with several tabs once', () => {
        const { hub, connect } = setup()
        connect('a1', 'ua')
        connect('a2', 'ua')
        hub.message('a1', join(TRACK), 0)
        hub.message('a2', join(TRACK), 0)
        hub.message('a1', pose(), 100)
        hub.message('a2', pose(), 100 + NR_LIVE_HANDOFF_MS)
        expect(hub.busyCounts(100 + NR_LIVE_HANDOFF_MS)).toEqual({ [TRACK]: 1 })
    })

    it('leaves private courses out and keeps published ones', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        connect('b', 'ub')
        hub.message('a', join(CUSTOM), 0)
        hub.message('b', join(PUB), 0)
        hub.message('a', pose(), 10)
        hub.message('b', pose(), 10)
        expect(hub.busyCounts(10)).toEqual({ [PUB]: 1 })
    })

    it('drops a player who left or closed', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        connect('b', 'ub')
        hub.message('a', join(TRACK), 0)
        hub.message('b', join(OTHER), 0)
        hub.message('a', pose(), 10)
        hub.message('b', pose(), 10)
        hub.message('a', JSON.stringify({ t: 'leave' }), 20)
        hub.close('b')
        expect(hub.busyCounts(20)).toEqual({})
    })
})

describe('live watchers', () => {
    it('accepts a boolean watch and drops anything else', () => {
        expect(parseNrLiveMessage(watchMsg(true))).toEqual({ t: 'watch', on: true })
        expect(parseNrLiveMessage(watchMsg(false))).toEqual({ t: 'watch', on: false })
        expect(parseNrLiveMessage(JSON.stringify({ t: 'watch' }))).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'watch', on: 'yes' }))).toBeNull()
        expect(parseNrLiveMessage(JSON.stringify({ t: 'watch', on: 1 }))).toBeNull()
    })

    it('ignores an invalid watch frame', () => {
        const { hub, connect } = setup()
        const w = connect('w', 'uw')
        hub.message('w', JSON.stringify({ t: 'watch', on: 'yes' }), 0)
        hub.message('w', JSON.stringify({ t: 'watch' }), 0)
        hub.tick(0)
        expect(w.sent).toEqual([])
    })

    it('sends the counts as soon as a socket starts watching', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const w = connect('w', 'uw')
        hub.message('a', join(TRACK), 0)
        hub.message('a', pose(), 10)
        hub.message('w', watchMsg(true), 20)
        expect(w.sent).toEqual([{ t: 'busy', tracks: { [TRACK]: 1 } }])
    })

    it('ticks only to watchers, and only when the counts changed', () => {
        const { hub, connect } = setup()
        const a = connect('a', 'ua')
        const w = connect('w', 'uw')
        const idle = connect('i', 'ui')
        hub.message('a', join(TRACK), 0)
        hub.message('w', watchMsg(true), 0)
        expect(busyOf(w)).toEqual([{}])
        hub.tick(10)
        expect(busyOf(w)).toHaveLength(1)
        hub.message('a', pose(), 100)
        hub.tick(200)
        expect(busyOf(w)).toEqual([{}, { [TRACK]: 1 }])
        hub.message('a', pose(), 300)
        hub.tick(400)
        expect(busyOf(w)).toHaveLength(2)
        hub.tick(300 + NR_LIVE_DRIVING_MS)
        expect(busyOf(w)).toEqual([{}, { [TRACK]: 1 }, {}])
        expect(busyOf(a)).toEqual([])
        expect(idle.sent).toEqual([])
    })

    it('tells the other watchers at once when a new watcher finds the counts changed', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const w1 = connect('w1', 'u1')
        const w2 = connect('w2', 'u2')
        hub.message('a', join(TRACK), 0)
        hub.message('w1', watchMsg(true), 0)
        hub.message('a', pose(), 10)
        hub.message('w2', watchMsg(true), 20)
        expect(busyOf(w1)).toEqual([{}, { [TRACK]: 1 }])
        expect(busyOf(w2)).toEqual([{ [TRACK]: 1 }])
        hub.tick(30)
        expect(busyOf(w1)).toHaveLength(2)
        expect(busyOf(w2)).toHaveLength(1)
    })

    it('stops sending once watching is off', () => {
        const { hub, connect } = setup()
        connect('a', 'ua')
        const w = connect('w', 'uw')
        hub.message('a', join(TRACK), 0)
        hub.message('w', watchMsg(true), 0)
        hub.message('w', watchMsg(false), 0)
        hub.message('a', pose(), 10)
        hub.tick(20)
        expect(busyOf(w)).toEqual([{}])
    })

    it('forgets a watcher that closed', () => {
        const { hub, connect } = setup()
        const sent: string[] = []
        const socket: NrLiveSocket = { id: 'w', send: f => void sent.push(f), close: () => {} }
        hub.open(socket, { id: 'uw', name: 'W' }, 0)
        connect('a', 'ua')
        hub.message('a', join(TRACK), 0)
        hub.message('w', watchMsg(true), 0)
        hub.close('w')
        hub.message('a', pose(), 10)
        hub.tick(20)
        expect(sent).toHaveLength(1)
    })

    it('does not count a tab in the menu as driving, so a player who just quit sees no one on their course', () => {
        const { hub, connect } = setup()
        const a = connect('a', 'ua')
        connect('b', 'ub')
        hub.message('a', join(TRACK), 0)
        hub.message('b', join(TRACK), 0)
        hub.message('a', pose(), 10)
        hub.message('a', watchMsg(true), 20)
        expect(busyOf(a)).toEqual([{}])
        hub.message('b', pose(), 30)
        hub.tick(40)
        expect(busyOf(a)).toEqual([{}, { [TRACK]: 1 }])
    })

    it('keeps watch frames under the rate limit', () => {
        const { hub, connect } = setup()
        const w = connect('w', 'uw')
        for (let i = 0; i < 100; i++) hub.message('w', watchMsg(true), 0)
        expect(busyOf(w)).toHaveLength(NR_LIVE_BURST)
    })
})

describe('live driving counts on the client', () => {
    it('keeps only whole counts above zero', () => {
        expect(busyCounts({ a: 2, b: 0, c: -1, d: 1.5, e: '3', f: null })).toEqual({ a: 2 })
        expect(busyCounts(null)).toEqual({})
        expect(busyCounts('x')).toEqual({})
    })
})

describe('live ghosts on the client', () => {
    it('sends the car and draws each racer in theirs', () => {
        const msg = poseMessage(ID, { paint: 'cyan', car: 'og' }, 1000)
        expect(msg).toMatchObject({ t: 'pose', paint: 'cyan', car: 'og' })
        const ghosts = new LiveGhosts()
        ghosts.push({ ...msg, id: 'ua', name: 'Alice' }, 1000)
        ghosts.push({ ...msg, id: 'ub', name: 'Bob', car: 'hovercraft' }, 1000)
        const cars = Object.fromEntries(ghosts.frames(1000).map(f => [f.label, f.car]))
        expect(cars).toEqual({ Alice: 'og', Bob: CARS[0].id })
    })
})
