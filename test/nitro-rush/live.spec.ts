import { describe, expect, it } from 'vitest'
import { PAINTS } from '../../app/utils/nitro-rush/config'
import { blendPose, LIVE_DELAY_MS, LIVE_STALE_MS, LiveGhosts, poseMessage } from '../../app/utils/nitro-rush/live'
import type { CarPose } from '../../app/utils/nitro-rush/types'
import {
    NR_LIVE_BURST,
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

const TRACK = TRACKS[0]!.id
const OTHER = TRACKS[1]!.id
const ID = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
const pose = (over: Record<string, unknown> = {}) => JSON.stringify({ t: 'pose', at: 1000, paint: 'cyan', pose: { ...ID, ...over } })

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
        expect(b.sent[0]).toMatchObject({ t: 'pose', id: 'ua', name: 'Alice', paint: 'cyan', at: 1000, pose: { x: 5 } })
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

const at = (x: number, qy = 0): CarPose => {
    const l = Math.hypot(qy, 1)
    return { x, y: 0, z: 0, qx: 0, qy: qy / l, qz: 0, qw: 1 / l }
}

describe('live ghost buffer', () => {
    it('rounds the outgoing pose', () => {
        const m = poseMessage({ x: 1.23456, y: 0, z: -2.5, qx: 0.123456, qy: 0, qz: 0, qw: 0.99 }, 'cyan', 1234.7)
        expect(m).toEqual({ t: 'pose', at: 1235, paint: 'cyan', pose: { x: 1.23, y: 0, z: -2.5, qx: 0.1235, qy: 0, qz: 0, qw: 0.99 } })
    })

    it('slerps the short way round and stays normalized', () => {
        const out = { ...ID }
        const half = blendPose(at(0), { x: 10, y: 0, z: 0, qx: 0, qy: -1, qz: 0, qw: 0 }, 0.5, out)
        expect(half.x).toBe(5)
        expect(Math.hypot(half.qx, half.qy, half.qz, half.qw)).toBeCloseTo(1, 10)
        // Halfway from identity to 180° about y: 90° about y, either sign of the axis.
        expect(Math.abs(half.qy)).toBeCloseTo(Math.SQRT1_2, 6)
        expect(half.qw).toBeCloseTo(Math.SQRT1_2, 6)
    })

    it('draws a player behind their latest pose, blending between the two around it', () => {
        const g = new LiveGhosts()
        // Their clock runs 5000 ms behind ours, with a 50 ms trip.
        g.push({ id: 'u1', name: 'Bob', paint: 'lime', at: 0, pose: at(0) }, 5050)
        g.push({ id: 'u1', name: 'Bob', paint: 'lime', at: 100, pose: at(10) }, 5150)
        const [f] = g.frames(5050 + LIVE_DELAY_MS + 70)
        expect(f!.id).toBe('live:u1')
        expect(f!.label).toBe('Bob')
        expect(f!.color).toBe(PAINTS.find(p => p.id === 'lime')!.color)
        // Drawn LIVE_DELAY_MS behind, at their 70 ms: 70% of the way.
        expect(f!.pose.x).toBeCloseTo(7, 6)
    })

    it('holds the oldest pose before the buffer starts and coasts only a little past the newest', () => {
        const g = new LiveGhosts()
        g.push({ id: 'u1', name: 'B', paint: 'cyan', at: 0, pose: at(0) }, 1000)
        expect(g.frames(1000)[0]!.pose.x).toBe(0)
        g.push({ id: 'u1', name: 'B', paint: 'cyan', at: 100, pose: at(10) }, 1100)
        g.push({ id: 'u1', name: 'B', paint: 'cyan', at: 200, pose: at(20) }, 1200)
        // Far past the newest pose: 100 ms of coasting at 100 m/s, no more.
        expect(g.frames(1200 + LIVE_DELAY_MS + 1000)[0]!.pose.x).toBeCloseTo(30, 6)
    })

    it('drops players gone quiet, and on request', () => {
        const g = new LiveGhosts()
        g.push({ id: 'u1', name: 'A', paint: 'cyan', at: 0, pose: at(0) }, 0)
        g.push({ id: 'u2', name: 'B', paint: 'cyan', at: 0, pose: at(0) }, 2000)
        expect(g.frames(LIVE_STALE_MS + 1).map(f => f.id)).toEqual(['live:u2'])
        g.remove('u2')
        expect(g.count).toBe(0)
    })

    it('starts a player over when their clock jumps back (a reload)', () => {
        const g = new LiveGhosts()
        g.push({ id: 'u1', name: 'A', paint: 'cyan', at: 90_000, pose: at(0) }, 100_000)
        g.push({ id: 'u1', name: 'A', paint: 'cyan', at: 90_100, pose: at(10) }, 100_100)
        g.push({ id: 'u1', name: 'A', paint: 'cyan', at: 50, pose: at(500) }, 100_200)
        expect(g.frames(100_200 + LIVE_DELAY_MS)[0]!.pose.x).toBe(500)
    })
})
