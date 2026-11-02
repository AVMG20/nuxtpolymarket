import { describe, expect, it } from 'vitest'
import { RtReader, RtWriter } from '#shared/utils/rail-tycoon/bytes'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { decodeCommand, encodeCommand, RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RT_MAX_FRAME_BYTES, RT_MAX_SAVE_BYTES, RT_MAX_SNAPSHOT_FRAME_BYTES } from '#shared/utils/rail-tycoon/limits'
import {
    decodeClientMsg,
    decodeServerMsg,
    encodeClientMsg,
    encodeServerMsg,
    RT_ERROR_CODES,
    RT_PAUSE_REASONS,
    RT_PROTOCOL_BOUNDS,
    RT_PROTOCOL_VERSION,
    RT_ROLES,
    RT_UNLOAD_REASONS,
    RT_WORLD_STATUSES,
    RtClientTag,
    RtServerTag,
    type RtClientMsg,
    type RtServerMsg,
    type RtStampedCommand,
    type RtWorldSummary
} from '#shared/utils/rail-tycoon/protocol'
import { SeededRandom } from '#shared/utils/random'
import { RT_OWNER_NONE, RtOrderKind } from '#shared/utils/rail-tycoon/types'

const INVITE = '0123456789ABCDEF'
const GZIP = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6])

function cmd(...bytes: number[]): Uint8Array {
    return new Uint8Array(bytes)
}

function stamped(tick: number, company: number | null, command: Uint8Array): RtStampedCommand {
    return { tick, company, command }
}

const PENDING: RtStampedCommand[] = [
    stamped(100, 0, cmd(1, 2, 3)),
    stamped(100, null, cmd(9)),
    stamped(102, 7, cmd(4, 5, 6, 7, 8))
]

const WORLD: RtWorldSummary = {
    id: 'w-abc',
    name: 'Ærø Junction',
    status: 'open',
    isOwner: true,
    memberCount: 3,
    maxCompanies: 8,
    myCompanyId: 0,
    lastActiveAt: 1761782400123,
    inviteCode: INVITE
}

/** One sample of every server message, keyed by type so a new variant fails to compile until listed. */
const SAMPLES: { [K in RtServerMsg['type']]: Extract<RtServerMsg, { type: K }> } = {
    hello: { type: 'hello', version: RT_PROTOCOL_VERSION, buildId: 'b1d-2026-10-30' },
    worldList: { type: 'worldList', worlds: [WORLD, { ...WORLD, id: 'w-2', status: 'closed', isOwner: false, maxCompanies: null, myCompanyId: null }] },
    joined: { type: 'joined', worldId: 'w-abc' },
    opened: {
        type: 'opened', worldId: 'w-abc', role: 'player', owner: false, company: 2, inviteCode: INVITE,
        tick: 100, serverNow: 1761782400999, snapshot: GZIP, pending: PENDING
    },
    resync: { type: 'resync', worldId: 'w-abc', tick: 100, serverNow: 5, snapshot: GZIP, pending: PENDING },
    command: { type: 'command', tick: 4000000000, company: 5, command: cmd(1, 2, 3, 4) },
    allowance: { type: 'allowance', tick: 0xffffffff },
    paused: { type: 'paused', reason: 'joining' },
    resumed: { type: 'resumed' },
    hash: { type: 'hash', tick: 300, hash: 0xdeadbeef },
    result: { type: 'result', seq: 255, error: 9 },
    worldClosed: { type: 'worldClosed' },
    roomUnloaded: { type: 'roomUnloaded', reason: 'joinFailed' },
    worldDeleted: { type: 'worldDeleted', worldId: 'w-abc' },
    error: { type: 'error', code: 'worldBroken' },
    pong: { type: 'pong', echo: 123456789 }
}

/** Reads a frame by the layout in protocol.ts' header, independently of the encoder and decoder. */
function readStamped(r: RtReader): RtStampedCommand {
    const tick = r.u32()
    const company = r.u8()
    const command = r.bytes(r.varint()).slice()
    return { tick, company: company === RT_OWNER_NONE ? null : company, command }
}

function readSnapshotBody(r: RtReader) {
    const tick = r.u32()
    const serverNow = r.varint()
    const snapshot = r.bytes(r.varint()).slice()
    const count = r.varint()
    const pending: RtStampedCommand[] = []
    for (let i = 0; i < count; i++) pending.push(readStamped(r))
    return { tick, serverNow, snapshot, pending }
}

function readOpened(frame: Uint8Array) {
    const r = new RtReader(frame)
    expect(r.u8()).toBe(RtServerTag.opened)
    const role = RT_ROLES[r.u8()]
    const owner = r.u8() === 1
    const companyByte = r.u8()
    const worldId = r.str(32)
    const inviteCode = role === 'player' || owner ? r.str(16) : null
    const body = readSnapshotBody(r)
    r.end()
    return { type: 'opened', worldId, role, owner, company: companyByte === RT_OWNER_NONE ? null : companyByte, inviteCode, ...body }
}

function expectRefused(msg: unknown): void {
    expect(() => encodeServerMsg(msg as RtServerMsg)).toThrow(RangeError)
}

/** Seeded messages of every type, valid and invalid alike, drawn from values near each cap. */
function seededServerMsgs(seed: number, count: number): RtServerMsg[] {
    const rng = new SeededRandom(seed)
    const pick = <T>(list: readonly T[]): T => list[rng.randomInt(0, list.length - 1)]!
    const int = () => pick([0, 1, 7, 8, 255, 256, 0xffff, 0x10000, 0xffffffff, 2 ** 32, -1, 1.5, Number.NaN, rng.next()])
    const company = () => pick<number | null>([null, 0, 7, 8, 255, -1, rng.randomInt(0, 9)])
    const text = () => pick(['', 'w', 'x'.repeat(32), 'x'.repeat(33), '€'.repeat(11), 'a\uD800', INVITE, 'b'.repeat(64), 'b'.repeat(65)])
    const bytes = () => new Uint8Array(pick([0, 1, 3, RT_PROTOCOL_BOUNDS.commandBytes, RT_PROTOCOL_BOUNDS.commandBytes + 1]))
    const pending = () => Array.from({ length: rng.randomInt(0, 4) }, () => stamped(int(), company(), bytes()))
    const builders: (() => unknown)[] = [
        () => ({ type: 'hello', version: int(), buildId: text() }),
        () => ({ type: 'worldList', worlds: Array.from({ length: rng.randomInt(0, 3) }, () => ({ ...WORLD, id: text(), name: text(), status: pick(['open', 'closed', 'x']), isOwner: pick([true, false, 0]), memberCount: int(), maxCompanies: pick([null, int()]), myCompanyId: company(), lastActiveAt: int(), inviteCode: text() })) }),
        () => ({ type: 'joined', worldId: text() }),
        () => ({ type: 'opened', worldId: text(), role: pick(['player', 'spectator', 'owner']), owner: pick([true, false]), company: company(), inviteCode: pick([null, INVITE, text()]), tick: int(), serverNow: int(), snapshot: bytes(), pending: pending() }),
        () => ({ type: 'resync', worldId: text(), tick: int(), serverNow: int(), snapshot: bytes(), pending: pending() }),
        () => ({ type: 'command', tick: int(), company: company(), command: bytes() }),
        () => ({ type: 'allowance', tick: int() }),
        () => ({ type: 'paused', reason: pick([...RT_PAUSE_REASONS, 'x']) }),
        () => ({ type: 'hash', tick: int(), hash: int() }),
        () => ({ type: 'result', seq: int(), error: int() }),
        () => ({ type: 'roomUnloaded', reason: pick([...RT_UNLOAD_REASONS, 'x']) }),
        () => ({ type: 'worldDeleted', worldId: text() }),
        () => ({ type: 'error', code: pick([...RT_ERROR_CODES, 'x']) }),
        () => ({ type: 'pong', echo: int() }),
        () => ({ type: pick(['resumed', 'worldClosed', 'x', '', 'constructor', 'toString']) })
    ]
    return Array.from({ length: count }, () => pick(builders)() as RtServerMsg)
}

describe('encodeServerMsg', () => {
    it('gives every message a distinct tag at 0x80 or above, so no client frame is ever read as one', () => {
        const tags = Object.values(RtServerTag)
        expect(new Set(tags).size).toBe(tags.length)
        expect(tags.every(tag => tag >= 0x80 && tag <= 0xff)).toBe(true)
        expect(Object.keys(RtServerTag).sort()).toEqual(Object.keys(SAMPLES).sort())
    })

    it('encodes every server variant as its tag plus fields, within its frame cap', () => {
        for (const msg of Object.values(SAMPLES)) {
            const frame = encodeServerMsg(msg)
            expect(frame).toBeInstanceOf(Uint8Array)
            expect(frame[0]).toBe(RtServerTag[msg.type])
            const cap = msg.type === 'opened' || msg.type === 'resync' ? RT_PROTOCOL_BOUNDS.snapshotFrameBytes : RT_PROTOCOL_BOUNDS.serverFrameBytes
            expect(frame.length).toBeLessThanOrEqual(cap)
            // binary, never JSON
            expect(frame[0]).not.toBe('{'.charCodeAt(0))
            // deterministic
            expect(encodeServerMsg(msg)).toEqual(frame)
        }
    })

    it('writes the field-less messages as their tag alone', () => {
        expect(encodeServerMsg({ type: 'resumed' })).toEqual(new Uint8Array([RtServerTag.resumed]))
        expect(encodeServerMsg({ type: 'worldClosed' })).toEqual(new Uint8Array([RtServerTag.worldClosed]))
    })

    it('carries the protocol version as a u16 and the build id as a length-prefixed string', () => {
        const r = new RtReader(encodeServerMsg({ type: 'hello', version: RT_PROTOCOL_VERSION, buildId: 'abc-123' }))
        expect(r.u8()).toBe(RtServerTag.hello)
        expect(r.u16()).toBe(RT_PROTOCOL_VERSION)
        expect(r.str(64)).toBe('abc-123')
        r.end()
        const other = new RtReader(encodeServerMsg({ type: 'hello', version: 0xffff, buildId: 'x'.repeat(64) }))
        other.u8()
        expect(other.u16()).toBe(0xffff)
        expect(other.str(64)).toBe('x'.repeat(64))
    })

    it('stamps a command in exactly 6 bytes plus the command: tag, u32 tick, u8 company, then the bytes to the end', () => {
        for (const command of [cmd(7), cmd(1, 2, 3, 4, 5, 6, 7, 8), new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes).fill(0xab)]) {
            const frame = encodeServerMsg({ type: 'command', tick: 4000000000, company: 7, command })
            expect(frame.length).toBe(6 + command.length)
            const r = new RtReader(frame)
            expect(r.u8()).toBe(RtServerTag.command)
            expect(r.u32()).toBe(4000000000)
            expect(r.u8()).toBe(7)
            expect(r.bytes(r.remaining())).toEqual(command)
        }
        const server = encodeServerMsg({ type: 'command', tick: 1, company: null, command: cmd(42) })
        expect(Array.from(server)).toEqual([RtServerTag.command, 1, 0, 0, 0, RT_OWNER_NONE, 42])
    })

    it('round-trips an opened message with its pending list, with the invite code for a player', () => {
        const msg = SAMPLES.opened
        expect(readOpened(encodeServerMsg(msg))).toEqual({ ...msg, pending: PENDING.map(p => ({ ...p })) })
    })

    it('round-trips opened for an owner spectator with the code and for a plain spectator without it', () => {
        const owner = { ...SAMPLES.opened, role: 'spectator' as const, owner: true, company: null }
        expect(readOpened(encodeServerMsg(owner))).toEqual(owner)
        const spectator = { ...SAMPLES.opened, role: 'spectator' as const, owner: false, company: null, inviteCode: null, pending: [] }
        const frame = encodeServerMsg(spectator)
        expect(readOpened(frame)).toEqual(spectator)
        // the code's 16 characters appear nowhere in a spectator's frame
        expect(new TextDecoder().decode(frame)).not.toContain(INVITE)
    })

    it('carries the gzip snapshot opaquely and byte for byte', () => {
        const snapshot = new Uint8Array(70000)
        for (let i = 0; i < snapshot.length; i++) snapshot[i] = (i * 31 + 7) & 0xff
        const read = readOpened(encodeServerMsg({ ...SAMPLES.opened, snapshot, pending: [] }))
        expect(read.snapshot).toEqual(snapshot)
    })

    it('round-trips a resync answer with its world id and pending list', () => {
        const r = new RtReader(encodeServerMsg(SAMPLES.resync))
        expect(r.u8()).toBe(RtServerTag.resync)
        expect(r.str(32)).toBe('w-abc')
        expect(readSnapshotBody(r)).toEqual({ tick: 100, serverNow: 5, snapshot: GZIP, pending: PENDING })
        r.end()
    })

    it('carries each world in the list with its invite code', () => {
        const r = new RtReader(encodeServerMsg(SAMPLES.worldList))
        expect(r.u8()).toBe(RtServerTag.worldList)
        const worlds: RtWorldSummary[] = []
        for (let i = r.varint(); i > 0; i--) {
            const id = r.str(32)
            const name = r.str(32)
            const status = RT_WORLD_STATUSES[r.u8()]!
            const isOwner = r.u8() === 1
            const memberCount = r.u8()
            const max = r.u8()
            const mine = r.u8()
            const lastActiveAt = r.varint()
            const inviteCode = r.str(16)
            worlds.push({ id, name, status, isOwner, memberCount, maxCompanies: max === 0 ? null : max, myCompanyId: mine === RT_OWNER_NONE ? null : mine, lastActiveAt, inviteCode })
        }
        r.end()
        expect(worlds).toEqual(SAMPLES.worldList.worlds)
    })

    it('writes room-unloaded with each reason code and world-deleted with the world id', () => {
        RT_UNLOAD_REASONS.forEach((reason, index) => {
            expect(Array.from(encodeServerMsg({ type: 'roomUnloaded', reason }))).toEqual([RtServerTag.roomUnloaded, index])
        })
        expect(RT_UNLOAD_REASONS).toEqual(['conflict', 'error', 'joinFailed', 'idle'])
        const r = new RtReader(encodeServerMsg({ type: 'worldDeleted', worldId: 'w-gone' }))
        expect(r.u8()).toBe(RtServerTag.worldDeleted)
        expect(r.str(32)).toBe('w-gone')
        r.end()
    })

    it('writes each pause reason and error code as its list index', () => {
        RT_PAUSE_REASONS.forEach((reason, index) => {
            expect(Array.from(encodeServerMsg({ type: 'paused', reason }))).toEqual([RtServerTag.paused, index])
        })
        RT_ERROR_CODES.forEach((code, index) => {
            expect(Array.from(encodeServerMsg({ type: 'error', code }))).toEqual([RtServerTag.error, index])
        })
        for (const code of ['badRequest', 'tooSoon', 'busy', 'worldBroken'] as const) expect(RT_ERROR_CODES).toContain(code)
    })

    it('writes allowance, hash, result and pong as fixed little-endian fields', () => {
        expect(Array.from(encodeServerMsg({ type: 'allowance', tick: 0x01020304 }))).toEqual([RtServerTag.allowance, 4, 3, 2, 1])
        expect(Array.from(encodeServerMsg({ type: 'hash', tick: 1, hash: 0xdeadbeef }))).toEqual([RtServerTag.hash, 1, 0, 0, 0, 0xef, 0xbe, 0xad, 0xde])
        expect(Array.from(encodeServerMsg({ type: 'result', seq: 3, error: 0 }))).toEqual([RtServerTag.result, 3, 0])
        expect(Array.from(encodeServerMsg({ type: 'pong', echo: 0xffffffff }))).toEqual([RtServerTag.pong, 255, 255, 255, 255])
    })
})

describe('encodeServerMsg refuses what a client would refuse', () => {
    it('never sends the invite code to a plain spectator, and always to an owner or player', () => {
        expectRefused({ ...SAMPLES.opened, role: 'spectator', owner: false, company: null, inviteCode: INVITE })
        expectRefused({ ...SAMPLES.opened, inviteCode: null })
        expectRefused({ ...SAMPLES.opened, role: 'spectator', owner: true, company: null, inviteCode: null })
        expectRefused({ ...SAMPLES.opened, inviteCode: 'not-a-code-00000' })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, inviteCode: 'ILOU456789ABCDEF' }] })
    })

    it('ties the company to the role and bounds it by the company cap', () => {
        expectRefused({ ...SAMPLES.opened, company: null })
        expectRefused({ ...SAMPLES.opened, role: 'spectator', owner: true, company: 1 })
        expectRefused({ ...SAMPLES.opened, company: RT_PROTOCOL_BOUNDS.companies })
        expectRefused({ ...SAMPLES.command, company: RT_PROTOCOL_BOUNDS.companies })
        expectRefused({ ...SAMPLES.command, company: -1 })
        expectRefused({ ...SAMPLES.command, company: 1.5 })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, myCompanyId: 8 }] })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, memberCount: 9 }] })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, maxCompanies: 9 }] })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, maxCompanies: 0 }] })
    })

    it('caps every string and refuses empty or unrepresentable ones', () => {
        expectRefused({ type: 'joined', worldId: 'w'.repeat(33) })
        expectRefused({ type: 'joined', worldId: '' })
        expectRefused({ type: 'worldDeleted', worldId: 'w'.repeat(33) })
        expectRefused({ type: 'hello', version: 1, buildId: 'b'.repeat(65) })
        // 11 three-byte characters are 33 bytes though only 11 UTF-16 units
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, name: '€'.repeat(11) }] })
        expect(() => encodeServerMsg({ ...SAMPLES.worldList, worlds: [{ ...WORLD, name: '€'.repeat(10) }] })).not.toThrow()
        expectRefused({ type: 'joined', worldId: 'w\uD800' })
        expectRefused({ type: 'joined', worldId: '\uDC00w' })
    })

    it('keeps pending commands ascending and never before the snapshot tick', () => {
        expectRefused({ ...SAMPLES.opened, pending: [stamped(101, 0, cmd(1)), stamped(100, 0, cmd(1))] })
        expectRefused({ ...SAMPLES.opened, pending: [stamped(99, 0, cmd(1))] })
        expectRefused({ ...SAMPLES.resync, pending: [stamped(99, 0, cmd(1))] })
        const many = Array.from({ length: RT_PROTOCOL_BOUNDS.pending + 1 }, () => stamped(100, 0, cmd(1)))
        expectRefused({ ...SAMPLES.opened, pending: many })
        expect(() => encodeServerMsg({ ...SAMPLES.opened, pending: many.slice(1) })).not.toThrow()
    })

    it('bounds command and snapshot bytes', () => {
        expectRefused({ ...SAMPLES.command, command: new Uint8Array(0) })
        expectRefused({ ...SAMPLES.command, command: new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes + 1) })
        expectRefused({ ...SAMPLES.command, command: [1, 2, 3] })
        expectRefused({ ...SAMPLES.opened, pending: [stamped(100, 0, new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes + 1))] })
        expectRefused({ ...SAMPLES.opened, snapshot: new Uint8Array(0) })
        expectRefused({ ...SAMPLES.resync, snapshot: new Uint8Array(RT_MAX_SAVE_BYTES + 1) })
    })

    it('refuses an opened frame past the snapshot frame cap', () => {
        const pending = Array.from({ length: RT_PROTOCOL_BOUNDS.pending }, () => stamped(100, 0, new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes)))
        const msg = { ...SAMPLES.opened, snapshot: new Uint8Array(RT_MAX_SAVE_BYTES), pending }
        expect(() => encodeServerMsg(msg)).toThrow(/exceeds/)
        expect(RT_PROTOCOL_BOUNDS.snapshotFrameBytes).toBe(RT_MAX_SNAPSHOT_FRAME_BYTES)
    })

    it('bounds the world list', () => {
        const worlds = Array.from({ length: RT_PROTOCOL_BOUNDS.worldList }, (_, i) => ({ ...WORLD, id: `w${i}`.padEnd(32, 'x'), name: 'n'.repeat(32) }))
        expect(encodeServerMsg({ type: 'worldList', worlds }).length).toBeLessThanOrEqual(RT_PROTOCOL_BOUNDS.serverFrameBytes)
        expectRefused({ type: 'worldList', worlds: [...worlds, WORLD] })
    })

    it('refuses unknown types, enum values and out-of-range integers', () => {
        expectRefused({ type: 'nope' })
        expectRefused({ type: 'paused', reason: 'sleepy' })
        expectRefused({ type: 'roomUnloaded', reason: 'crash' })
        expectRefused({ type: 'error', code: 'teapot' })
        expectRefused({ ...SAMPLES.opened, role: 'owner' })
        expectRefused({ ...SAMPLES.opened, owner: 1 })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, status: 'deleted' }] })
        expectRefused({ type: 'hello', version: 0x10000, buildId: 'b' })
        expectRefused({ type: 'allowance', tick: 0x100000000 })
        expectRefused({ type: 'allowance', tick: -1 })
        expectRefused({ type: 'hash', tick: 1, hash: 2 ** 32 })
        expectRefused({ type: 'result', seq: 256, error: 0 })
        expectRefused({ type: 'result', seq: 0, error: -1 })
        expectRefused({ type: 'pong', echo: Number.NaN })
        expectRefused({ ...SAMPLES.opened, serverNow: -1 })
        expectRefused({ ...SAMPLES.worldList, worlds: [{ ...WORLD, lastActiveAt: 1.5 }] })
    })

    it('throws only RangeError for seeded random messages, and every frame it returns fits its cap', () => {
        let encoded = 0
        for (const msg of seededServerMsgs(99, 3000)) {
            let frame: Uint8Array | null = null
            try {
                frame = encodeServerMsg(msg)
            } catch (e) {
                expect(e).toBeInstanceOf(RangeError)
                continue
            }
            encoded++
            expect(frame[0]).toBe(RtServerTag[msg.type])
            const cap = msg.type === 'opened' || msg.type === 'resync' ? RT_PROTOCOL_BOUNDS.snapshotFrameBytes : RT_PROTOCOL_BOUNDS.serverFrameBytes
            expect(frame.length).toBeLessThanOrEqual(cap)
        }
        // the generator reaches both outcomes
        expect(encoded).toBeGreaterThan(100)
    })
})

/** A frame written field by field, bypassing the encoder's checks. */
function frame(tag: number, build: (w: RtWriter) => void = () => {}): Uint8Array {
    const w = new RtWriter()
    w.u8(tag)
    build(w)
    return w.finish()
}

function rawStr(w: RtWriter, data: number[] | Uint8Array): void {
    w.varint(data.length)
    w.bytes(Uint8Array.from(data))
}

/** The fuzz property: a frame decodes to null, or to a message that encodes back to exactly it. */
function expectNullOrCanonical(bytes: Uint8Array): RtServerMsg | null {
    const msg = decodeServerMsg(bytes)
    if (msg !== null) expect(encodeServerMsg(msg)).toEqual(bytes)
    return msg
}

/** A snapshot body whose fields each sit at or under their cap. */
function writeBody(w: RtWriter, snapshotBytes: number, pending: RtStampedCommand[]): void {
    w.u32(100)
    w.varint(5)
    w.varint(snapshotBytes)
    w.bytes(new Uint8Array(snapshotBytes))
    w.varint(pending.length)
    for (const p of pending) {
        w.u32(p.tick)
        w.u8(p.company ?? RT_OWNER_NONE)
        w.varint(p.command.length)
        w.bytes(p.command)
    }
}

const VARIANTS: RtServerMsg[] = [
    ...Object.values(SAMPLES),
    { ...SAMPLES.opened, role: 'spectator', owner: true, company: null },
    { ...SAMPLES.opened, role: 'spectator', owner: false, company: null, inviteCode: null, pending: [] },
    { ...SAMPLES.opened, role: 'player', owner: true, company: 7 },
    { ...SAMPLES.resync, tick: 0xffffffff, serverNow: Number.MAX_SAFE_INTEGER, pending: [stamped(0xffffffff, null, cmd(1))] },
    { type: 'hello', version: 0xffff, buildId: 'b'.repeat(64) },
    { type: 'joined', worldId: '﻿w' },
    { type: 'joined', worldId: '🚂'.repeat(8) },
    { type: 'worldDeleted', worldId: 'x'.repeat(32) },
    { type: 'worldList', worlds: [] },
    { type: 'worldList', worlds: [{ ...WORLD, memberCount: 0, maxCompanies: 1, myCompanyId: 7, lastActiveAt: 0 }] },
    { type: 'command', tick: 0, company: null, command: new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes).fill(7) },
    { type: 'result', seq: 0, error: 255 },
    { type: 'pong', echo: 0 },
    ...RT_PAUSE_REASONS.map(reason => ({ type: 'paused', reason }) as const),
    ...RT_UNLOAD_REASONS.map(reason => ({ type: 'roomUnloaded', reason }) as const),
    ...RT_ERROR_CODES.map(code => ({ type: 'error', code }) as const)
]

describe('decodeServerMsg', () => {
    it('round-trips every server variant: decode(encode(m)) deep-equals m', () => {
        for (const msg of VARIANTS) {
            expect(decodeServerMsg(encodeServerMsg(msg))).toEqual(msg)
        }
    })

    it('round-trips every message the seeded generator gets accepted', () => {
        let accepted = 0
        for (const seed of [99, 7, 2026]) {
            for (const msg of seededServerMsgs(seed, 3000)) {
                let bytes: Uint8Array
                try {
                    bytes = encodeServerMsg(msg)
                } catch {
                    continue
                }
                accepted++
                expect(decodeServerMsg(bytes)).toEqual(msg)
            }
        }
        expect(accepted).toBeGreaterThan(300)
    })

    it('returns the snapshot as a view into the frame and the commands as copies', () => {
        const bytes = encodeServerMsg(SAMPLES.opened)
        const msg = decodeServerMsg(bytes)
        if (msg?.type !== 'opened') throw new Error('expected opened')
        expect(msg.snapshot.buffer).toBe(bytes.buffer)
        expect(msg.snapshot.byteOffset).toBeGreaterThan(0)
        for (const p of msg.pending) expect(p.command.buffer).not.toBe(bytes.buffer)
        const command = decodeServerMsg(encodeServerMsg(SAMPLES.command))
        if (command?.type !== 'command') throw new Error('expected command')
        expect(command.command.byteOffset).toBe(0)
    })

    it('reads a frame that is a view into a larger buffer', () => {
        const bytes = encodeServerMsg(SAMPLES.resync)
        const outer = new Uint8Array(bytes.length + 20).fill(0xee)
        outer.set(bytes, 10)
        expect(decodeServerMsg(outer.subarray(10, 10 + bytes.length))).toEqual(SAMPLES.resync)
    })

    it('returns null for an empty frame, a client tag, an unknown tag or a non-byte input', () => {
        expect(decodeServerMsg(new Uint8Array(0))).toBeNull()
        for (let tag = 0; tag < 0x80; tag++) expect(decodeServerMsg(new Uint8Array([tag]))).toBeNull()
        for (let tag = 0x90; tag <= 0xff; tag++) expect(decodeServerMsg(new Uint8Array([tag]))).toBeNull()
        expect(decodeServerMsg([0x88] as unknown as Uint8Array)).toBeNull()
        expect(decodeServerMsg(null as unknown as Uint8Array)).toBeNull()
        expect(decodeServerMsg('\x88' as unknown as Uint8Array)).toBeNull()
        expect(decodeServerMsg(new Uint8Array([RtServerTag.resumed]))).toEqual({ type: 'resumed' })
    })

    it('enforces the snapshot frame cap even when every field is within its own cap', () => {
        const pending = Array.from({ length: RT_PROTOCOL_BOUNDS.pending }, (_, i) => stamped(100 + i, i % 8, new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes).fill(i & 0xff)))
        const probe = encodeServerMsg({ ...SAMPLES.resync, serverNow: 5, snapshot: new Uint8Array(RT_MAX_SAVE_BYTES - 16384), pending })
        const fit = RT_MAX_SAVE_BYTES - 16384 + RT_PROTOCOL_BOUNDS.snapshotFrameBytes - probe.length
        expect(fit).toBeLessThanOrEqual(RT_MAX_SAVE_BYTES)
        const atCap = encodeServerMsg({ ...SAMPLES.resync, serverNow: 5, snapshot: new Uint8Array(fit), pending })
        expect(atCap.length).toBe(RT_PROTOCOL_BOUNDS.snapshotFrameBytes)
        const decoded = decodeServerMsg(atCap)
        expect(decoded?.type).toBe('resync')
        // one more snapshot byte: still under the snapshot cap, but the frame is over
        const over = frame(RtServerTag.resync, w => {
            rawStr(w, new TextEncoder().encode('w-abc'))
            writeBody(w, fit + 1, pending)
        })
        expect(over.length).toBe(RT_PROTOCOL_BOUNDS.snapshotFrameBytes + 1)
        expect(decodeServerMsg(over)).toBeNull()
        // other messages are held to the smaller server frame cap
        const hello = frame(RtServerTag.hello, w => {
            w.u16(1)
            rawStr(w, [0x62])
            w.bytes(new Uint8Array(RT_PROTOCOL_BOUNDS.serverFrameBytes))
        })
        expect(decodeServerMsg(hello)).toBeNull()
    })

    it('refuses every string the encoder refuses: empty, over its cap, invalid or surrogate UTF-8, overlong length', () => {
        const joined = (data: number[]) => frame(RtServerTag.joined, w => rawStr(w, data))
        expect(decodeServerMsg(joined([0x77]))).toEqual({ type: 'joined', worldId: 'w' })
        expect(decodeServerMsg(joined([]))).toBeNull()
        expect(decodeServerMsg(joined(Array(33).fill(0x77)))).toBeNull()
        expect(decodeServerMsg(joined(Array(32).fill(0x77)))).not.toBeNull()
        // an encoded lone surrogate, a stray continuation byte, an overlong '/', a 0xff byte
        for (const data of [[0xed, 0xa0, 0x80], [0x80], [0xc0, 0xaf], [0x77, 0xff]]) {
            expect(decodeServerMsg(joined(data))).toBeNull()
        }
        // length 1 written in two bytes would re-encode as one
        expect(decodeServerMsg(new Uint8Array([RtServerTag.joined, 0x81, 0x00, 0x77]))).toBeNull()
        expect(decodeServerMsg(frame(RtServerTag.hello, w => {
            w.u16(1)
            rawStr(w, Array(65).fill(0x62))
        }))).toBeNull()
        expect(decodeServerMsg(frame(RtServerTag.hello, w => {
            w.u16(1)
            rawStr(w, [])
        }))).toBeNull()
        // 11 three-byte characters exceed a 32-byte world name
        const named = (name: string) => frame(RtServerTag.worldList, w => {
            w.varint(1)
            rawStr(w, [0x77])
            rawStr(w, new TextEncoder().encode(name))
            w.bytes(Uint8Array.from([0, 1, 1, 0, 0]))
            w.varint(0)
            rawStr(w, new TextEncoder().encode(INVITE))
        })
        expect(decodeServerMsg(named('€'.repeat(10)))).not.toBeNull()
        expect(decodeServerMsg(named('€'.repeat(11)))).toBeNull()
    })

    it('refuses an out-of-range enum, boolean or company byte', () => {
        expect(decodeServerMsg(new Uint8Array([RtServerTag.paused, RT_PAUSE_REASONS.length]))).toBeNull()
        expect(decodeServerMsg(new Uint8Array([RtServerTag.roomUnloaded, RT_UNLOAD_REASONS.length]))).toBeNull()
        expect(decodeServerMsg(new Uint8Array([RtServerTag.error, RT_ERROR_CODES.length]))).toBeNull()
        expect(decodeServerMsg(new Uint8Array([RtServerTag.error, 0xff]))).toBeNull()
        const command = (company: number) => new Uint8Array([RtServerTag.command, 1, 0, 0, 0, company, 42])
        expect(decodeServerMsg(command(7))).toEqual({ type: 'command', tick: 1, company: 7, command: cmd(42) })
        expect(decodeServerMsg(command(RT_OWNER_NONE))).toEqual({ type: 'command', tick: 1, company: null, command: cmd(42) })
        for (let company = RT_PROTOCOL_BOUNDS.companies; company < RT_OWNER_NONE; company++) {
            expect(decodeServerMsg(command(company))).toBeNull()
        }
        // opened header: role, owner, company
        const opened = encodeServerMsg(SAMPLES.opened)
        const patched = (offset: number, value: number) => {
            const copy = opened.slice()
            copy[offset] = value
            return decodeServerMsg(copy)
        }
        expect(patched(1, RT_ROLES.length)).toBeNull()
        expect(patched(2, 2)).toBeNull()
        expect(patched(3, RT_PROTOCOL_BOUNDS.companies)).toBeNull()
        // a player without a company, and (through role 0) a spectator with one
        expect(patched(3, RT_OWNER_NONE)).toBeNull()
        expect(patched(1, 0)).toBeNull()
    })

    it('refuses world list rows the encoder refuses, and a count past the cap before reading rows', () => {
        const list = encodeServerMsg({ type: 'worldList', worlds: [WORLD] })
        // tag, count, id (1 + 5), name (1 + 13 bytes), then status, isOwner, members, max, mine
        const at = 2 + 6 + 1 + new TextEncoder().encode(WORLD.name).length
        const patched = (offset: number, value: number) => {
            const copy = list.slice()
            copy[offset] = value
            return decodeServerMsg(copy)
        }
        expect(patched(at, 1)).not.toBeNull()
        expect(patched(at, 2)).toBeNull()
        expect(patched(at + 1, 2)).toBeNull()
        expect(patched(at + 2, RT_PROTOCOL_BOUNDS.companies + 1)).toBeNull()
        expect(patched(at + 3, 0)).toEqual({ type: 'worldList', worlds: [{ ...WORLD, maxCompanies: null }] })
        expect(patched(at + 3, RT_PROTOCOL_BOUNDS.companies + 1)).toBeNull()
        expect(patched(at + 4, RT_PROTOCOL_BOUNDS.companies)).toBeNull()
        // an invite code of the right length but outside the alphabet
        expect(patched(list.length - 1, 'I'.charCodeAt(0))).toBeNull()
        expect(decodeServerMsg(frame(RtServerTag.worldList, w => w.varint(RT_PROTOCOL_BOUNDS.worldList + 1)))).toBeNull()
        expect(decodeServerMsg(frame(RtServerTag.worldList, w => w.varint(Number.MAX_SAFE_INTEGER)))).toBeNull()
    })

    it('ties the invite code to the role and owner flag', () => {
        const ownerSpectator = encodeServerMsg({ ...SAMPLES.opened, role: 'spectator', owner: true, company: null })
        const plain = encodeServerMsg({ ...SAMPLES.opened, role: 'spectator', owner: false, company: null, inviteCode: null })
        expect(decodeServerMsg(ownerSpectator)).not.toBeNull()
        expect(decodeServerMsg(plain)).not.toBeNull()
        // flip the owner byte: a code where none may be, and none where one must be
        const noLongerOwner = ownerSpectator.slice()
        noLongerOwner[2] = 0
        expect(decodeServerMsg(noLongerOwner)).toBeNull()
        const nowOwner = plain.slice()
        nowOwner[2] = 1
        expect(decodeServerMsg(nowOwner)).toBeNull()
    })

    it('keeps pending ascending, at or after the snapshot tick, and within its caps', () => {
        const resync = (snapshotBytes: number, pending: RtStampedCommand[]) => decodeServerMsg(frame(RtServerTag.resync, w => {
            rawStr(w, [0x77])
            writeBody(w, snapshotBytes, pending)
        }))
        expect(resync(1, [stamped(100, 0, cmd(1)), stamped(100, 1, cmd(2)), stamped(101, null, cmd(3))])).not.toBeNull()
        expect(resync(1, [stamped(101, 0, cmd(1)), stamped(100, 0, cmd(1))])).toBeNull()
        expect(resync(1, [stamped(99, 0, cmd(1))])).toBeNull()
        expect(resync(1, [stamped(100, 8, cmd(1))])).toBeNull()
        expect(resync(1, [stamped(100, 0, new Uint8Array(0))])).toBeNull()
        expect(resync(1, [stamped(100, 0, new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes + 1))])).toBeNull()
        expect(resync(0, [])).toBeNull()
        const many = Array.from({ length: RT_PROTOCOL_BOUNDS.pending + 1 }, () => stamped(100, 0, cmd(1)))
        expect(resync(1, many.slice(1))).not.toBeNull()
        expect(resync(1, many)).toBeNull()
        // a huge declared count with nothing behind it
        expect(decodeServerMsg(frame(RtServerTag.resync, w => {
            rawStr(w, [0x77])
            w.u32(100)
            w.varint(5)
            rawStr(w, [1])
            w.varint(Number.MAX_SAFE_INTEGER)
        }))).toBeNull()
        // a snapshot length past the cap with no bytes behind it
        expect(decodeServerMsg(frame(RtServerTag.resync, w => {
            rawStr(w, [0x77])
            w.u32(100)
            w.varint(5)
            w.varint(RT_MAX_SAVE_BYTES + 1)
        }))).toBeNull()
    })

    it('bounds a stamped command message to 1 to the command cap', () => {
        const command = (length: number) => frame(RtServerTag.command, w => {
            w.u32(1)
            w.u8(0)
            w.bytes(new Uint8Array(length))
        })
        expect(decodeServerMsg(command(0))).toBeNull()
        expect(decodeServerMsg(command(RT_PROTOCOL_BOUNDS.commandBytes))).not.toBeNull()
        expect(decodeServerMsg(command(RT_PROTOCOL_BOUNDS.commandBytes + 1))).toBeNull()
    })

    it('refuses trailing bytes and overlong numbers', () => {
        for (const msg of VARIANTS) {
            if (msg.type === 'command') continue
            const bytes = encodeServerMsg(msg)
            const longer = new Uint8Array(bytes.length + 1)
            longer.set(bytes)
            expect(decodeServerMsg(longer)).toBeNull()
        }
        // serverNow 5 written in two bytes
        const overlong = frame(RtServerTag.resync, w => {
            rawStr(w, [0x77])
            w.u32(100)
            w.bytes(Uint8Array.from([0x85, 0x00]))
            rawStr(w, [1])
            w.varint(0)
        })
        expect(decodeServerMsg(overlong)).toBeNull()
    })

    it('yields null or a canonical message for a frame cut at every offset', () => {
        for (const msg of VARIANTS) {
            const bytes = encodeServerMsg(msg)
            for (let n = 0; n < bytes.length; n++) {
                const cut = expectNullOrCanonical(bytes.subarray(0, n))
                // only a command, whose bytes run to the frame end, survives a cut
                if (cut !== null) expect(cut.type === 'command' || (n === 1 && bytes.length === 1)).toBe(true)
            }
        }
    })

    it('yields null or a canonical message for seeded byte flips of every message type', () => {
        const rng = new SeededRandom(87)
        let accepted = 0
        let refused = 0
        for (const msg of VARIANTS) {
            const bytes = encodeServerMsg(msg)
            for (let i = 0; i < 300; i++) {
                const copy = bytes.slice()
                const flips = rng.randomInt(1, 3)
                for (let f = 0; f < flips; f++) {
                    const at = rng.randomInt(0, copy.length - 1)
                    copy[at] = rng.randomRatio(1, 2) ? copy[at]! ^ (1 << rng.randomInt(0, 7)) : rng.randomInt(0, 255)
                }
                if (expectNullOrCanonical(copy) === null) refused++
                else accepted++
            }
        }
        expect(accepted).toBeGreaterThan(0)
        expect(refused).toBeGreaterThan(0)
    })

    it('yields null or a canonical message for seeded garbage behind every server tag', () => {
        const rng = new SeededRandom(870)
        const tags = Object.values(RtServerTag)
        for (let i = 0; i < 20000; i++) {
            const garbage = new Uint8Array(rng.randomInt(1, 48))
            garbage[0] = tags[rng.randomInt(0, tags.length - 1)]!
            for (let j = 1; j < garbage.length; j++) garbage[j] = rng.randomInt(0, 255)
            expectNullOrCanonical(garbage)
        }
    })
})

/* ------------------------------------------------------------------------------------------
 * Client messages: the anti-cheat boundary, so most cases below are hand-built
 * hostile frames rather than round trips.
 * ---------------------------------------------------------------------------------------- */

const BUILD_RAIL: RtCommand = { kind: RtCommandKind.buildRail, tile: 1234, piece: 2 }

const COMMANDS: RtCommand[] = [
    BUILD_RAIL,
    { kind: RtCommandKind.demolishArea, tile: 0, endTile: 65535 },
    { kind: RtCommandKind.buyVehicle, depot: 77, model: 3, wagons: [1, 2, 3] },
    {
        kind: RtCommandKind.setOrders,
        vehicle: 3,
        orders: Array.from({ length: RT_CATALOG.caps.maxOrders }, (_, i) => ({ kind: RtOrderKind.gotoStation, target: i, flags: 0 }))
    },
    { kind: RtCommandKind.startStop, vehicle: 9, stopped: true },
    { kind: RtCommandKind.changeLoan, steps: -3 },
    { kind: RtCommandKind.renameCompany, name: 'Ærø Rail' }
]

/** One sample of every client message, keyed by type so a new variant fails to compile until listed. */
const CLIENT_SAMPLES: { [K in RtClientMsg['type']]: Extract<RtClientMsg, { type: K }> } = {
    list: { type: 'list' },
    create: { type: 'create', name: 'Ærø Junction', side: 128, maxCompanies: 4, sharing: true },
    join: { type: 'join', inviteCode: INVITE },
    open: { type: 'open', worldId: 'w-abc', inviteCode: INVITE },
    loaded: { type: 'loaded', worldId: 'w-abc' },
    command: { type: 'command', seq: 17, command: BUILD_RAIL },
    stop: { type: 'stop', worldId: 'w-abc' },
    delete: { type: 'delete', worldId: 'w-abc' },
    resync: { type: 'resync', worldId: 'w-abc' },
    ping: { type: 'ping', value: 0xdeadbeef }
}

const CLIENT_VARIANTS: RtClientMsg[] = [
    ...Object.values(CLIENT_SAMPLES),
    { type: 'create', name: 'x', side: 64, maxCompanies: 2, sharing: false },
    { type: 'create', name: '€'.repeat(10) + 'ab', side: 256, maxCompanies: 8, sharing: true },
    { type: 'open', worldId: 'w-abc', inviteCode: null },
    { type: 'open', worldId: '🚂'.repeat(8), inviteCode: null },
    { type: 'stop', worldId: 'x'.repeat(32) },
    { type: 'ping', value: 0 },
    ...COMMANDS.map((command, i) => ({ type: 'command', seq: i === 0 ? 0 : 255 - i, command }) as const)
]

const CREATE_BASE = CLIENT_SAMPLES.create

/** A create frame written field by field, so every field can be pushed out of range. */
function createFrame(fields: { name?: number[] | Uint8Array, side?: number, max?: number, sharing?: number } = {}): Uint8Array {
    return frame(RtClientTag.create, w => {
        rawStr(w, fields.name ?? new TextEncoder().encode(CREATE_BASE.name))
        w.u16(fields.side ?? CREATE_BASE.side)
        w.u8(fields.max ?? CREATE_BASE.maxCompanies)
        w.u8(fields.sharing ?? 1)
    })
}

/** A command frame around raw command bytes, bypassing encodeCommand's checks. */
function commandFrame(seq: number, command: number[] | Uint8Array): Uint8Array {
    return frame(RtClientTag.command, w => {
        w.u8(seq)
        w.bytes(Uint8Array.from(command))
    })
}

/** The fuzz property: a frame decodes to null, or to a message that encodes back to exactly it. */
function expectClientNullOrCanonical(bytes: Uint8Array): RtClientMsg | null {
    const msg = decodeClientMsg(bytes)
    if (msg !== null) expect(encodeClientMsg(msg)).toEqual(bytes)
    return msg
}

function expectClientRefused(msg: unknown): void {
    expect(() => encodeClientMsg(msg as RtClientMsg)).toThrow(RangeError)
}

describe('encodeClientMsg', () => {
    it('gives every client message a distinct tag from 0x01 to 0x7f', () => {
        const tags = Object.values(RtClientTag)
        expect(new Set(tags).size).toBe(tags.length)
        expect(tags.every(tag => tag >= 0x01 && tag < 0x80)).toBe(true)
        expect(Object.keys(RtClientTag).sort()).toEqual(Object.keys(CLIENT_SAMPLES).sort())
    })

    it('encodes every client variant as its tag plus fields, within the client frame cap', () => {
        for (const msg of CLIENT_VARIANTS) {
            const bytes = encodeClientMsg(msg)
            expect(bytes[0]).toBe(RtClientTag[msg.type])
            expect(bytes.length).toBeLessThanOrEqual(RT_MAX_FRAME_BYTES)
            expect(encodeClientMsg(msg)).toEqual(bytes)
        }
        expect(Array.from(encodeClientMsg({ type: 'list' }))).toEqual([RtClientTag.list])
    })

    it('writes a command message as the command bytes plus 2: tag and sequence number', () => {
        for (const command of COMMANDS) {
            const bytes = encodeClientMsg({ type: 'command', seq: 200, command })
            const encoded = encodeCommand(command)
            expect(bytes.length).toBe(encoded.length + 2)
            expect(Array.from(bytes)).toEqual([RtClientTag.command, 200, ...encoded])
        }
    })

    it('writes create as name, u16 side, u8 max companies and u8 sharing, on and off', () => {
        for (const sharing of [true, false]) {
            const bytes = encodeClientMsg({ type: 'create', name: 'Rails', side: 256, maxCompanies: 8, sharing })
            expect(Array.from(bytes)).toEqual([RtClientTag.create, 5, ...new TextEncoder().encode('Rails'), 0, 1, 8, sharing ? 1 : 0])
        }
    })

    it('writes open with a presence byte before the optional invite code', () => {
        const withCode = encodeClientMsg({ type: 'open', worldId: 'w', inviteCode: INVITE })
        expect(Array.from(withCode)).toEqual([RtClientTag.open, 1, 0x77, 1, 16, ...new TextEncoder().encode(INVITE)])
        expect(Array.from(encodeClientMsg({ type: 'open', worldId: 'w', inviteCode: null }))).toEqual([RtClientTag.open, 1, 0x77, 0])
        expect(Array.from(encodeClientMsg({ type: 'ping', value: 0x01020304 }))).toEqual([RtClientTag.ping, 4, 3, 2, 1])
    })

    it('refuses create settings outside 64/128/256, 2 to 8 companies and a boolean sharing', () => {
        for (const side of [0, 63, 100, 512, 65536, 128.5]) expectClientRefused({ ...CREATE_BASE, side })
        for (const maxCompanies of [0, 1, 9, 255, 2.5, Number.NaN]) expectClientRefused({ ...CREATE_BASE, maxCompanies })
        for (const sharing of [0, 1, 'yes', null]) expectClientRefused({ ...CREATE_BASE, sharing })
    })

    it('refuses a world name that is empty, over 32 bytes, unrepresentable, controlled or padded', () => {
        for (const name of ['', 'x'.repeat(33), '€'.repeat(11), 'a\uD800', 'a\u0007b', 'a\u0085b', ' lead', 'trail ', 42]) {
            expectClientRefused({ ...CREATE_BASE, name })
        }
        expect(() => encodeClientMsg({ ...CREATE_BASE, name: 'x'.repeat(32) })).not.toThrow()
    })

    it('refuses bad invite codes, world ids, sequence numbers, ping values and unknown types', () => {
        for (const inviteCode of ['', '0123456789ABCDE', '0123456789ABCDEFG', '0123456789abcdef', 'ILOU456789ABCDEF', null]) {
            expectClientRefused({ type: 'join', inviteCode })
        }
        expectClientRefused({ type: 'open', worldId: 'w', inviteCode: 'ILOU456789ABCDEF' })
        for (const worldId of ['', 'w'.repeat(33), 'w\uD800']) {
            for (const type of ['open', 'loaded', 'stop', 'delete', 'resync']) expectClientRefused({ type, worldId, inviteCode: null })
        }
        for (const seq of [-1, 256, 1.5]) expectClientRefused({ type: 'command', seq, command: BUILD_RAIL })
        for (const value of [-1, 2 ** 32, Number.NaN]) expectClientRefused({ type: 'ping', value })
        for (const type of ['nope', '', 'constructor', 'toString', 'hello', 'pong']) expectClientRefused({ type })
    })

    it('refuses foundCompany, which only the server issues, and any command decodeCommand refuses', () => {
        expectClientRefused({ type: 'command', seq: 0, command: { kind: RtCommandKind.foundCompany, name: 'Mine', colour: 1 } })
        expectClientRefused({ type: 'command', seq: 0, command: { ...BUILD_RAIL, piece: 99 } })
        expectClientRefused({ type: 'command', seq: 0, command: { ...BUILD_RAIL, tile: 256 * 256 } })
        expectClientRefused({ type: 'command', seq: 0, command: { kind: 99 } })
        expectClientRefused({ type: 'command', seq: 0, command: null })
    })
})

describe('decodeClientMsg', () => {
    it('round-trips every client variant: decode(encode(m)) deep-equals m', () => {
        for (const msg of CLIENT_VARIANTS) expect(decodeClientMsg(encodeClientMsg(msg))).toEqual(msg)
    })

    it('round-trips create with sharing on and off', () => {
        for (const sharing of [true, false]) {
            const msg = { ...CREATE_BASE, sharing }
            expect(decodeClientMsg(encodeClientMsg(msg))).toEqual(msg)
        }
        expect(decodeClientMsg(createFrame({ sharing: 0 }))).toEqual({ ...CREATE_BASE, sharing: false })
    })

    it('reads a frame that is a view into a larger buffer', () => {
        const bytes = encodeClientMsg(CLIENT_SAMPLES.command)
        const outer = new Uint8Array(bytes.length + 20).fill(0xee)
        outer.set(bytes, 10)
        expect(decodeClientMsg(outer.subarray(10, 10 + bytes.length))).toEqual(CLIENT_SAMPLES.command)
    })

    it('refuses a client frame that carries foundCompany, though the command codec accepts it', () => {
        const found = encodeCommand({ kind: RtCommandKind.foundCompany, name: 'Mine', colour: 1 })
        expect(decodeCommand(found)).not.toBeNull()
        expect(decodeClientMsg(commandFrame(0, found))).toBeNull()
        expect(decodeClientMsg(commandFrame(255, found))).toBeNull()
    })

    it('refuses create with side 100 or max companies 9, and every other out-of-range setting', () => {
        expect(decodeClientMsg(createFrame())).toEqual(CREATE_BASE)
        expect(decodeClientMsg(createFrame({ side: 100 }))).toBeNull()
        expect(decodeClientMsg(createFrame({ max: 9 }))).toBeNull()
        for (const side of [0, 63, 65, 127, 129, 255, 257, 512, 0xffff]) expect(decodeClientMsg(createFrame({ side }))).toBeNull()
        for (const max of [0, 1, 9, 255]) expect(decodeClientMsg(createFrame({ max }))).toBeNull()
        for (const side of [64, 128, 256]) expect(decodeClientMsg(createFrame({ side }))).not.toBeNull()
        for (const max of [2, 8]) expect(decodeClientMsg(createFrame({ max }))).not.toBeNull()
        for (const sharing of [2, 0x80, 0xff]) expect(decodeClientMsg(createFrame({ sharing }))).toBeNull()
    })

    it('refuses a world name that is empty, over 32 bytes, invalid UTF-8, controlled or padded', () => {
        const name = (text: string) => new TextEncoder().encode(text)
        expect(decodeClientMsg(createFrame({ name: name('x'.repeat(32)) }))).not.toBeNull()
        expect(decodeClientMsg(createFrame({ name: name('€'.repeat(10) + 'ab') }))).not.toBeNull()
        expect(decodeClientMsg(createFrame({ name: [] }))).toBeNull()
        expect(decodeClientMsg(createFrame({ name: name('x'.repeat(33)) }))).toBeNull()
        expect(decodeClientMsg(createFrame({ name: name('€'.repeat(11)) }))).toBeNull()
        // an encoded lone surrogate, a stray continuation byte, an overlong '/', a 0xff byte, a cut 3-byte character
        for (const data of [[0xed, 0xa0, 0x80], [0x80], [0xc0, 0xaf], [0x77, 0xff], [0x77, 0xe2, 0x82]]) {
            expect(decodeClientMsg(createFrame({ name: data }))).toBeNull()
        }
        for (const text of ['a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', ' x', 'x ', '﻿x', ' x']) {
            expect(decodeClientMsg(createFrame({ name: name(text) }))).toBeNull()
        }
    })

    it('checks a string length against its cap and the bytes present before reading it', () => {
        const open = (build: (w: RtWriter) => void) => decodeClientMsg(frame(RtClientTag.open, build))
        // a huge declared length with nothing behind it
        expect(open(w => w.varint(Number.MAX_SAFE_INTEGER))).toBeNull()
        expect(open(w => w.varint(1e9))).toBeNull()
        expect(open(w => w.varint(33))).toBeNull()
        // within the cap but longer than the frame
        expect(open(w => {
            w.varint(32)
            w.bytes(new Uint8Array(5).fill(0x77))
        })).toBeNull()
        // 33 real bytes, one over the world id cap
        expect(open(w => {
            rawStr(w, Array(33).fill(0x77))
            w.u8(0)
        })).toBeNull()
        // length 1 written in two bytes would re-encode as one
        expect(decodeClientMsg(new Uint8Array([RtClientTag.loaded, 0x81, 0x00, 0x77]))).toBeNull()
        expect(decodeClientMsg(new Uint8Array([RtClientTag.loaded, 0x01, 0x77]))).toEqual({ type: 'loaded', worldId: 'w' })
        // a varint that never ends
        expect(decodeClientMsg(new Uint8Array([RtClientTag.stop, ...Array(12).fill(0xff)]))).toBeNull()
    })

    it('refuses a bad open presence byte and a malformed invite code', () => {
        const code = new TextEncoder().encode(INVITE)
        const open = (flag: number, invite?: number[] | Uint8Array) => decodeClientMsg(frame(RtClientTag.open, w => {
            rawStr(w, [0x77])
            w.u8(flag)
            if (invite) rawStr(w, invite)
        }))
        expect(open(1, code)).toEqual({ type: 'open', worldId: 'w', inviteCode: INVITE })
        expect(open(0)).toEqual({ type: 'open', worldId: 'w', inviteCode: null })
        expect(open(2, code)).toBeNull()
        expect(open(0xff, code)).toBeNull()
        expect(open(1)).toBeNull()
        // a code where the flag says none is trailing bytes
        expect(open(0, code)).toBeNull()
        const join = (text: string) => decodeClientMsg(frame(RtClientTag.join, w => rawStr(w, new TextEncoder().encode(text))))
        expect(join(INVITE)).toEqual({ type: 'join', inviteCode: INVITE })
        for (const bad of ['', '0123456789ABCDE', '0123456789ABCDEF0', '0123456789abcdef', 'ILOU456789ABCDEF', '0123456789ABCDE€']) {
            expect(join(bad)).toBeNull()
            expect(open(1, new TextEncoder().encode(bad))).toBeNull()
        }
    })

    it('refuses an embedded command the command codec refuses', () => {
        const valid = encodeCommand(BUILD_RAIL)
        expect(decodeClientMsg(commandFrame(1, valid))).toEqual({ type: 'command', seq: 1, command: BUILD_RAIL })
        const hostile: number[][] = [
            // no command at all, an unknown kind, a kind byte alone
            [], [200], [RtCommandKind.buildRail],
            // a piece out of range, a tile past the largest map
            [RtCommandKind.buildRail, 0, 0, 0, 0, 99],
            [RtCommandKind.buildRail, 0, 0, 1, 0, 0],
            // a stopped byte other than 0 or 1
            [RtCommandKind.startStop, 1, 0, 2],
            // one order more than the cap, with nothing behind the count
            [RtCommandKind.setOrders, 1, 0, RT_CATALOG.caps.maxOrders + 1],
            // a rename longer than a company name
            [RtCommandKind.renameCompany, 33, ...Array(33).fill(0x61)],
            // a valid command with a byte behind it
            [...valid, 0]
        ]
        for (const bytes of hostile) expect(decodeClientMsg(commandFrame(1, bytes))).toBeNull()
        // past the command cap, even when the head is a valid command
        const long = new Uint8Array(RT_PROTOCOL_BOUNDS.commandBytes + 1)
        long.set(valid)
        expect(decodeClientMsg(commandFrame(1, long))).toBeNull()
    })

    it('returns null for an empty frame, a server tag, an unknown tag or a non-byte input', () => {
        expect(decodeClientMsg(new Uint8Array(0))).toBeNull()
        const clientTags = new Set<number>(Object.values(RtClientTag))
        for (let tag = 0; tag <= 0xff; tag++) {
            if (!clientTags.has(tag)) expect(decodeClientMsg(new Uint8Array([tag, 0, 0, 0, 0]))).toBeNull()
        }
        expect(decodeClientMsg([RtClientTag.list] as unknown as Uint8Array)).toBeNull()
        expect(decodeClientMsg(null as unknown as Uint8Array)).toBeNull()
        expect(decodeClientMsg('\x01' as unknown as Uint8Array)).toBeNull()
        expect(decodeClientMsg(new Uint8Array([RtClientTag.list]).buffer as unknown as Uint8Array)).toBeNull()
        expect(decodeClientMsg(new Uint8Array([RtClientTag.list]))).toEqual({ type: 'list' })
        // the two directions never read each other's frames
        for (const msg of CLIENT_VARIANTS) expect(decodeServerMsg(encodeClientMsg(msg))).toBeNull()
        for (const msg of VARIANTS) expect(decodeClientMsg(encodeServerMsg(msg))).toBeNull()
    })

    it('refuses a frame past the client cap before parsing it', () => {
        const big = new Uint8Array(RT_MAX_FRAME_BYTES + 1)
        big[0] = RtClientTag.command
        expect(decodeClientMsg(big)).toBeNull()
        expect(RT_PROTOCOL_BOUNDS.clientFrameBytes).toBe(RT_MAX_FRAME_BYTES)
    })

    it('refuses trailing bytes on every variant', () => {
        for (const msg of CLIENT_VARIANTS) {
            const bytes = encodeClientMsg(msg)
            for (const extra of [0, 1, 0xff]) {
                const longer = new Uint8Array(bytes.length + 1)
                longer.set(bytes)
                longer[bytes.length] = extra
                expect(decodeClientMsg(longer)).toBeNull()
            }
        }
    })

    it('refuses every variant cut short at every offset', () => {
        for (const msg of CLIENT_VARIANTS) {
            const bytes = encodeClientMsg(msg)
            for (let n = 0; n < bytes.length; n++) expect(decodeClientMsg(bytes.subarray(0, n))).toBeNull()
        }
    })

    it('never throws on 1000 seeded random byte arrays, and accepts only canonical frames', () => {
        const rng = new SeededRandom(99)
        for (let i = 0; i < 1000; i++) {
            const bytes = new Uint8Array(rng.randomInt(0, 64))
            for (let j = 0; j < bytes.length; j++) bytes[j] = rng.randomInt(0, 255)
            expectClientNullOrCanonical(bytes)
        }
    })

    it('yields null or a canonical message for seeded garbage behind every client tag', () => {
        const rng = new SeededRandom(85)
        const tags = Object.values(RtClientTag)
        let accepted = 0
        for (let i = 0; i < 20000; i++) {
            const garbage = new Uint8Array(rng.randomInt(1, 48))
            garbage[0] = tags[rng.randomInt(0, tags.length - 1)]!
            for (let j = 1; j < garbage.length; j++) garbage[j] = rng.randomInt(0, 255)
            if (expectClientNullOrCanonical(garbage) !== null) accepted++
        }
        expect(accepted).toBeGreaterThan(0)
    })

    it('yields null or a canonical message for seeded byte flips of every client variant, and never foundCompany', () => {
        const rng = new SeededRandom(850)
        let accepted = 0
        let refused = 0
        for (const msg of CLIENT_VARIANTS) {
            const bytes = encodeClientMsg(msg)
            for (let i = 0; i < 300; i++) {
                const copy = bytes.slice()
                const flips = rng.randomInt(1, 3)
                for (let f = 0; f < flips; f++) {
                    const at = rng.randomInt(0, copy.length - 1)
                    copy[at] = rng.randomRatio(1, 2) ? copy[at]! ^ (1 << rng.randomInt(0, 7)) : rng.randomInt(0, 255)
                }
                const decoded = expectClientNullOrCanonical(copy)
                if (decoded === null) {
                    refused++
                } else {
                    accepted++
                    if (decoded.type === 'command') expect(decoded.command.kind).not.toBe(RtCommandKind.foundCompany)
                }
            }
        }
        expect(accepted).toBeGreaterThan(0)
        expect(refused).toBeGreaterThan(0)
    })

    it('encodes seeded hostile messages to a frame the decoder accepts, or throws only RangeError', () => {
        const rng = new SeededRandom(84)
        const pick = <T>(list: readonly T[]): T => list[rng.randomInt(0, list.length - 1)]!
        const int = () => pick([0, 1, 2, 8, 9, 64, 100, 128, 255, 256, 0xffff, 2 ** 32, -1, 1.5, Number.NaN])
        const text = () => pick(['', 'w', 'x'.repeat(32), 'x'.repeat(33), '€'.repeat(11), 'a\uD800', ' a', 'a\u0001', INVITE, 'ILOU456789ABCDEF'])
        const builders: (() => unknown)[] = [
            () => ({ type: 'create', name: text(), side: int(), maxCompanies: int(), sharing: pick([true, false, 1, null]) }),
            () => ({ type: 'join', inviteCode: pick([text(), null]) }),
            () => ({ type: 'open', worldId: text(), inviteCode: pick([null, text()]) }),
            () => ({ type: pick(['loaded', 'stop', 'delete', 'resync']), worldId: text() }),
            () => ({ type: 'command', seq: int(), command: pick([...COMMANDS, { ...BUILD_RAIL, piece: int() }, { kind: RtCommandKind.changeLoan, steps: int() }]) }),
            () => ({ type: 'ping', value: int() }),
            () => ({ type: pick(['list', 'x', 'constructor', 'hello']) })
        ]
        let encoded = 0
        for (let i = 0; i < 3000; i++) {
            const msg = pick(builders)() as RtClientMsg
            let bytes: Uint8Array
            try {
                bytes = encodeClientMsg(msg)
            } catch (e) {
                expect(e).toBeInstanceOf(RangeError)
                continue
            }
            encoded++
            expect(decodeClientMsg(bytes)).toEqual(msg)
        }
        expect(encoded).toBeGreaterThan(100)
    })
})
