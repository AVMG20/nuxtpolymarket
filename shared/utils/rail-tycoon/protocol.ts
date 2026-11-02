/**
 * Rail Tycoon's binary socket protocol (goal 12). Every frame is one u8 tag followed by fixed
 * little-endian fields (bytes.ts); strings are varint-length-prefixed UTF-8 under a cap, lists are a
 * varint count under a cap. Never JSON. Tags are fixed for protocol version 1 and only ever added.
 *
 * Client to server (W84, encodeClientMsg), tags 0x01 to 0x7f (0x00 is never a tag):
 *   list          no fields: the worlds the user owns or has joined
 *   create        str world name (no control characters, no outer whitespace), u16 map side
 *                 (64, 128 or 256), u8 max companies (2 to 8), u8 sharing (0 or 1, Q19b; AR-75)
 *   join          str invite code (exactly the shape rtCreateWorld generates)
 *   open          str world id, u8 has invite (0 or 1), then str invite code when it is 1 (AR-25)
 *   loaded        str world id: the client finished decoding that world's snapshot
 *   command       u8 sequence number (the server's result echoes it), then encodeCommand bytes to
 *                 the frame end: the command plus 2 bytes. foundCompany is the server's alone (AR-2).
 *   stop, delete  str world id (owner only; the hub checks)
 *   resync        str world id: ask for a fresh snapshot of the open world
 *   ping          u32 value, echoed by pong
 *
 * Server to client (W86, encodeServerMsg), tags 0x80 and up so a client frame echoed back is never
 * mistaken for one (client tags, W84, stay below 0x80):
 *   hello         u16 protocol version, str build id (AR-34)
 *   worldList     varint count, then per world: str id, str name, u8 status, u8 owner, u8 members,
 *                 u8 max companies (0 = unset), u8 my company (255 = none), varint last active ms,
 *                 str invite code (AR-64)
 *   joined        str world id: the world a create or a join made the user a member of
 *   opened        u8 role, u8 owner, u8 company (255 = none), str world id, str invite code only when
 *                 the role is player or owner is 1 (AR-64), then the snapshot body
 *   resync        str world id, then the snapshot body
 *     snapshot body: u32 tick, varint server now ms (display only), varint length + gzip bytes
 *                    (opaque, AR-79), varint count + pending stamped commands (AR-3), each
 *                    u32 tick, u8 company, varint length + command bytes, ticks ascending and at or
 *                    after the snapshot tick (AR-103)
 *   command       u32 tick, u8 company (255 = server-issued), then the command bytes to the frame end
 *   allowance     u32 tick the client may step up to
 *   paused        u8 reason;  resumed: no fields (AR-104)
 *   hash          u32 tick, u32 world hash
 *   result        u8 client sequence number, u8 applyCommand error code (to the sender only)
 *   worldClosed   no fields;  roomUnloaded: u8 reason (AR-36);  worldDeleted: str world id (AR-36)
 *   error         u8 error code;  pong: u32 echo of the ping's value
 *
 * Each encoder refuses (RangeError) any message its decoder would refuse, so neither side sends a
 * frame the other drops. Each decoder (W85, W87) mirrors every one of those checks and returns null
 * for any frame it refuses; whatever it accepts re-encodes to the same bytes (varints and strings
 * must be canonical). decodeClientMsg is the anti-cheat boundary: a hand-built frame gets no further
 * than one the chooser and the tools could send. This file imports no compression module: the
 * client imports it.
 */

import { clampUtf8, RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CATALOG } from './catalog'
import { decodeCommand, encodeCommand, RtCommandKind, type RtCommand } from './commands'
import {
    isRtInviteCode,
    RT_INVITE_CODE_LENGTH,
    RT_MAX_FRAME_BYTES,
    RT_MAX_SAVE_BYTES,
    RT_MAX_SNAPSHOT_FRAME_BYTES
} from './limits'
import { RT_MAP_SIDES } from './map'
import { RT_OWNER_NONE } from './types'

/** Wire protocol version; hello carries it and a client with another one stops as outdated (AR-34). */
export const RT_PROTOCOL_VERSION = 1

/** Every cap the codecs enforce, one place for both directions. */
export const RT_PROTOCOL_BOUNDS = Object.freeze({
    /** Largest client frame (W85). */
    clientFrameBytes: RT_MAX_FRAME_BYTES,
    /** Largest server frame other than opened and resync. */
    serverFrameBytes: 8192,
    /** Largest opened or resync frame. */
    snapshotFrameBytes: RT_MAX_SNAPSHOT_FRAME_BYTES,
    /** Largest compressed snapshot. */
    snapshotBytes: RT_MAX_SAVE_BYTES,
    /** UTF-8 bytes of a world id. */
    worldIdBytes: 32,
    /** UTF-8 bytes of a world or company name. */
    nameBytes: RT_CATALOG.caps.maxNameBytes,
    /** Characters of an invite code (always exactly this many). */
    inviteCodeBytes: RT_INVITE_CODE_LENGTH,
    /** UTF-8 bytes of the deploy's build id. */
    buildIdBytes: 64,
    /** Worlds in one world list, the registry's list limit. */
    worldList: 50,
    /** Bytes of one encoded command (setOrders with RT_CATALOG maxOrders orders is the largest). */
    commandBytes: 1024,
    /** Stamped commands in one snapshot's pending list. */
    pending: 1024,
    /** Companies in a world; a company byte is below this or RT_OWNER_NONE. */
    companies: RT_CATALOG.caps.maxCompanies,
    /** The fewest companies a created world may allow (Q5a). */
    minCompanies: 2
})

/** Client message tags. Fixed for version 1; a new message takes a new tag below 0x80. */
export const RtClientTag = Object.freeze({
    list: 0x01,
    create: 0x02,
    join: 0x03,
    open: 0x04,
    loaded: 0x05,
    command: 0x06,
    stop: 0x07,
    delete: 0x08,
    resync: 0x09,
    ping: 0x0a
} as const)
export type RtClientTag = typeof RtClientTag[keyof typeof RtClientTag]

export type RtClientMsg =
    | { type: 'list' }
    | {
        type: 'create'
        name: string
        /** Map side in tiles: 64, 128 or 256. */
        side: number
        /** 2 to 8. */
        maxCompanies: number
        /** Infrastructure sharing (Q19b). */
        sharing: boolean
    }
    | { type: 'join', inviteCode: string }
    /** An invite code lets a stranger spectate (AR-25); null for a world the user already belongs to. */
    | { type: 'open', worldId: string, inviteCode: string | null }
    | { type: 'loaded', worldId: string }
    | {
        type: 'command'
        /** Echoed by the server's result; the client wraps it at 256. */
        seq: number
        /** Any command but foundCompany, which only the server issues (AR-2). */
        command: RtCommand
    }
    | { type: 'stop', worldId: string }
    | { type: 'delete', worldId: string }
    | { type: 'resync', worldId: string }
    | { type: 'ping', value: number }

/** Server message tags. Fixed for version 1; a new message takes a new tag. */
export const RtServerTag = Object.freeze({
    hello: 0x80,
    worldList: 0x81,
    joined: 0x82,
    opened: 0x83,
    resync: 0x84,
    command: 0x85,
    allowance: 0x86,
    paused: 0x87,
    resumed: 0x88,
    hash: 0x89,
    result: 0x8a,
    worldClosed: 0x8b,
    roomUnloaded: 0x8c,
    worldDeleted: 0x8d,
    error: 0x8e,
    pong: 0x8f
} as const)
export type RtServerTag = typeof RtServerTag[keyof typeof RtServerTag]

/*
 * Enumerations travel as their index in these lists, so a list is append-only: reordering or removing
 * an entry changes the meaning of bytes already on the wire.
 */

/** A peer's role in an opened world. A player has a company; a spectator has none. */
export const RT_ROLES = Object.freeze(['spectator', 'player'] as const)
export type RtRole = typeof RT_ROLES[number]

export const RT_WORLD_STATUSES = Object.freeze(['open', 'closed'] as const)
export type RtWireWorldStatus = typeof RT_WORLD_STATUSES[number]

/** Why the room stopped ticking (AR-104): no player attached, a join pause, or the owner's stop. */
export const RT_PAUSE_REASONS = Object.freeze(['noPlayers', 'joining', 'closed'] as const)
export type RtPauseReason = typeof RT_PAUSE_REASONS[number]

/** Why a room unloaded under its peers (AR-36): a foreign 409, a step exception or refused write, a failed live join, idleness. */
export const RT_UNLOAD_REASONS = Object.freeze(['conflict', 'error', 'joinFailed', 'idle'] as const)
export type RtUnloadReason = typeof RT_UNLOAD_REASONS[number]

/** Request-level refusals the hub and room answer with (goals 13 and 20). */
export const RT_ERROR_CODES = Object.freeze([
    /** A frame failed to decode (AR-87). */
    'badRequest',
    /** A cooldown is running: open, resync, create or invite lookups (AR-82, AR-99, AR-109). */
    'tooSoon',
    /** The process is at a cap: pending creates, live rooms, a chain wait timed out (AR-99, AR-110, AR-119). */
    'busy',
    /** The world's room failed too often and is refused until restart (AR-61). */
    'worldBroken',
    /** Not found or not allowed; the two are one code so a stranger learns nothing (AR-25). */
    'noAccess',
    /** The world has its maximum number of companies. */
    'worldFull',
    /** The world is closed: no commands, no joins. */
    'worldClosed',
    /** Only a player (a member with a company in an open world) may send commands. */
    'notPlayer',
    /** Only the owner may stop or delete. */
    'notOwner',
    /** The user is at an owned or open-world cap (RT_MAX_OPEN_WORLDS, RT_MAX_WORLDS_PER_OWNER). */
    'atCap',
    /** The invite code matches no world. */
    'badInvite',
    /** The per-peer command rate was exceeded (RT_ROOM_CMD_RATE). */
    'rateLimited'
] as const)
export type RtErrorCode = typeof RT_ERROR_CODES[number]

/** A command stamped by the room: the tick it executes at, the acting company, its encoded bytes. */
export interface RtStampedCommand {
    tick: number
    /** The acting company, or null for a command the server issues itself (a live join's foundCompany). */
    company: number | null
    /** encodeCommand bytes (goal 08), carried as-is. */
    command: Uint8Array
}

/** One row of the chooser's list; every member sees the invite code (AR-64). */
export interface RtWorldSummary {
    id: string
    name: string
    status: RtWireWorldStatus
    isOwner: boolean
    memberCount: number
    maxCompanies: number | null
    /** The receiving user's company, or null when they own the world without one. */
    myCompanyId: number | null
    /** Milliseconds since the epoch. */
    lastActiveAt: number
    inviteCode: string
}

/** A world captured at a tick boundary with every command stamped for that tick or later (AR-103). */
export interface RtSnapshotBody {
    /** world.tick when the snapshot was encoded. */
    tick: number
    /** The server's clock in ms, for display only; never fed to the simulation. */
    serverNow: number
    /** gzip of encodeWorld, opaque here (AR-79). */
    snapshot: Uint8Array
    /** Ascending by tick, stamp order within a tick. */
    pending: readonly RtStampedCommand[]
}

export type RtServerMsg =
    | { type: 'hello', version: number, buildId: string }
    | { type: 'worldList', worlds: readonly RtWorldSummary[] }
    | { type: 'joined', worldId: string }
    | ({
        type: 'opened'
        worldId: string
        role: RtRole
        /** The receiver owns the world (shows stop and delete). */
        owner: boolean
        /** The receiver's company: set exactly for a player. */
        company: number | null
        /** Set exactly when the role is player or owner is true (AR-64). */
        inviteCode: string | null
    } & RtSnapshotBody)
    | ({ type: 'resync', worldId: string } & RtSnapshotBody)
    | ({ type: 'command' } & RtStampedCommand)
    | { type: 'allowance', tick: number }
    | { type: 'paused', reason: RtPauseReason }
    | { type: 'resumed' }
    | { type: 'hash', tick: number, hash: number }
    | {
        type: 'result'
        /** The sequence number the client gave the command. */
        seq: number
        /** applyCommand's error code (goal 08). */
        error: number
    }
    | { type: 'worldClosed' }
    | { type: 'roomUnloaded', reason: RtUnloadReason }
    | { type: 'worldDeleted', worldId: string }
    | { type: 'error', code: RtErrorCode }
    | { type: 'pong', echo: number }

// a lone surrogate encodes as U+FFFD and would not survive a round trip
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function refuse(what: string): never {
    throw new RangeError(`protocol: ${what}`)
}

function writeStr(w: RtWriter, text: string, maxBytes: number, what: string): void {
    if (typeof text !== 'string' || text.length === 0) refuse(`${what} must be a non-empty string`)
    if (LONE_SURROGATE.test(text)) refuse(`${what} holds a lone surrogate`)
    if (clampUtf8(text, maxBytes) !== text) refuse(`${what} exceeds ${maxBytes} bytes`)
    w.str(text)
}

function writeEnum<T extends string>(w: RtWriter, list: readonly T[], value: T, what: string): void {
    const index = list.indexOf(value)
    if (index < 0) refuse(`unknown ${what} ${String(value)}`)
    w.u8(index)
}

function writeBool(w: RtWriter, value: boolean, what: string): void {
    if (typeof value !== 'boolean') refuse(`${what} must be a boolean`)
    w.u8(value ? 1 : 0)
}

/** A company byte: an id below the company cap, or RT_OWNER_NONE for null. */
function writeCompany(w: RtWriter, company: number | null, what: string): void {
    if (company === null) {
        w.u8(RT_OWNER_NONE)
        return
    }
    if (!Number.isInteger(company) || company < 0 || company >= RT_PROTOCOL_BOUNDS.companies) {
        refuse(`${what} out of range: ${company}`)
    }
    w.u8(company)
}

function checkBytes(data: Uint8Array, maxBytes: number, what: string): void {
    if (!(data instanceof Uint8Array)) refuse(`${what} must be a Uint8Array`)
    if (data.length === 0 || data.length > maxBytes) refuse(`${what} of ${data.length} bytes is outside 1 to ${maxBytes}`)
}

function writeStamped(w: RtWriter, stamped: RtStampedCommand, minTick: number): void {
    w.u32(stamped.tick)
    if (stamped.tick < minTick) refuse(`pending command for tick ${stamped.tick} before tick ${minTick}`)
    writeCompany(w, stamped.company, 'command company')
    checkBytes(stamped.command, RT_PROTOCOL_BOUNDS.commandBytes, 'command')
    w.varint(stamped.command.length)
    w.bytes(stamped.command)
}

function writeSnapshotBody(w: RtWriter, body: RtSnapshotBody): void {
    w.u32(body.tick)
    w.varint(body.serverNow)
    checkBytes(body.snapshot, RT_PROTOCOL_BOUNDS.snapshotBytes, 'snapshot')
    w.varint(body.snapshot.length)
    w.bytes(body.snapshot)
    if (body.pending.length > RT_PROTOCOL_BOUNDS.pending) refuse(`${body.pending.length} pending commands exceed ${RT_PROTOCOL_BOUNDS.pending}`)
    w.varint(body.pending.length)
    // ascending ticks, never before the snapshot's own tick (AR-103)
    let minTick = body.tick
    for (const stamped of body.pending) {
        writeStamped(w, stamped, minTick)
        minTick = stamped.tick
    }
}

function writeWorldSummary(w: RtWriter, world: RtWorldSummary): void {
    writeStr(w, world.id, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
    writeStr(w, world.name, RT_PROTOCOL_BOUNDS.nameBytes, 'world name')
    writeEnum(w, RT_WORLD_STATUSES, world.status, 'world status')
    writeBool(w, world.isOwner, 'isOwner')
    if (!Number.isInteger(world.memberCount) || world.memberCount < 0 || world.memberCount > RT_PROTOCOL_BOUNDS.companies) {
        refuse(`member count out of range: ${world.memberCount}`)
    }
    w.u8(world.memberCount)
    if (world.maxCompanies === null) {
        w.u8(0)
    } else {
        if (!Number.isInteger(world.maxCompanies) || world.maxCompanies < 1 || world.maxCompanies > RT_PROTOCOL_BOUNDS.companies) {
            refuse(`max companies out of range: ${world.maxCompanies}`)
        }
        w.u8(world.maxCompanies)
    }
    writeCompany(w, world.myCompanyId, 'my company')
    w.varint(world.lastActiveAt)
    if (!isRtInviteCode(world.inviteCode)) refuse('world list invite code has the wrong shape')
    w.str(world.inviteCode)
}

function writeOpened(w: RtWriter, msg: Extract<RtServerMsg, { type: 'opened' }>): void {
    writeEnum(w, RT_ROLES, msg.role, 'role')
    writeBool(w, msg.owner, 'owner')
    if ((msg.role === 'player') !== (msg.company !== null)) refuse('a player has a company and a spectator none')
    writeCompany(w, msg.company, 'company')
    writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
    // the code goes to an owner or a player only; a spectator's frame has no field for it (AR-64)
    const invited = msg.role === 'player' || msg.owner
    if (invited !== (msg.inviteCode !== null)) refuse('the invite code goes exactly to an owner or a player')
    if (msg.inviteCode !== null) {
        if (!isRtInviteCode(msg.inviteCode)) refuse('opened invite code has the wrong shape')
        w.str(msg.inviteCode)
    }
    writeSnapshotBody(w, msg)
}

/** The frame cap for a server message. */
function frameCap(type: RtServerMsg['type']): number {
    return type === 'opened' || type === 'resync' ? RT_PROTOCOL_BOUNDS.snapshotFrameBytes : RT_PROTOCOL_BOUNDS.serverFrameBytes
}

/** One server frame. Throws RangeError for a message the protocol cannot carry. */
export function encodeServerMsg(msg: RtServerMsg): Uint8Array {
    // own keys only, so 'constructor' or 'toString' never reads an inherited member
    if (!Object.prototype.hasOwnProperty.call(RtServerTag, msg.type)) {
        refuse(`unknown server message ${String((msg as { type: unknown }).type)}`)
    }
    const tag = RtServerTag[msg.type]
    const w = new RtWriter()
    w.u8(tag)
    switch (msg.type) {
        case 'hello':
            w.u16(msg.version)
            writeStr(w, msg.buildId, RT_PROTOCOL_BOUNDS.buildIdBytes, 'build id')
            break
        case 'worldList':
            if (msg.worlds.length > RT_PROTOCOL_BOUNDS.worldList) refuse(`${msg.worlds.length} worlds exceed ${RT_PROTOCOL_BOUNDS.worldList}`)
            w.varint(msg.worlds.length)
            for (const world of msg.worlds) writeWorldSummary(w, world)
            break
        case 'joined':
            writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            break
        case 'opened':
            writeOpened(w, msg)
            break
        case 'resync':
            writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            writeSnapshotBody(w, msg)
            break
        case 'command':
            // 6 bytes plus the command: no length prefix, the command runs to the end of the frame
            w.u32(msg.tick)
            writeCompany(w, msg.company, 'command company')
            checkBytes(msg.command, RT_PROTOCOL_BOUNDS.commandBytes, 'command')
            w.bytes(msg.command)
            break
        case 'allowance':
            w.u32(msg.tick)
            break
        case 'paused':
            writeEnum(w, RT_PAUSE_REASONS, msg.reason, 'pause reason')
            break
        case 'hash':
            w.u32(msg.tick)
            w.u32(msg.hash)
            break
        case 'result':
            w.u8(msg.seq)
            w.u8(msg.error)
            break
        case 'roomUnloaded':
            writeEnum(w, RT_UNLOAD_REASONS, msg.reason, 'unload reason')
            break
        case 'worldDeleted':
            writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            break
        case 'error':
            writeEnum(w, RT_ERROR_CODES, msg.code, 'error code')
            break
        case 'pong':
            w.u32(msg.echo)
            break
        case 'resumed':
        case 'worldClosed':
            break
        default: {
            const unknown: never = msg
            refuse(`unhandled server message ${String(unknown)}`)
        }
    }
    const cap = frameCap(msg.type)
    if (w.length > cap) refuse(`${msg.type} frame of ${w.length} bytes exceeds ${cap}`)
    return w.finish()
}

// C0 and C1 controls, the characters rtCleanCompanyName drops from a company name
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/

/** Why a world name cannot travel, or null. The byte cap and UTF-8 checks are the string codec's. */
function worldNameProblem(name: string): string | null {
    if (CONTROL_CHAR.test(name)) return 'world name holds a control character'
    if (name.trim() !== name) return 'world name has outer whitespace'
    return null
}

/** Why create settings cannot travel, or null (AR-75): the same bounds as checkSettings in world.ts. */
function createSettingsProblem(side: number, maxCompanies: number): string | null {
    if (!RT_MAP_SIDES.includes(side)) return `map side must be ${RT_MAP_SIDES.join(', ')}: ${side}`
    const { minCompanies, companies } = RT_PROTOCOL_BOUNDS
    if (!Number.isInteger(maxCompanies) || maxCompanies < minCompanies || maxCompanies > companies) {
        return `max companies must be ${minCompanies} to ${companies}: ${maxCompanies}`
    }
    return null
}

/**
 * One client frame. Throws RangeError for a message decodeClientMsg would refuse: an unknown type,
 * a string over its cap, empty or holding a lone surrogate, a bad invite code, create settings out
 * of range, a sequence number outside a u8, or a command encodeCommand refuses or that is
 * foundCompany.
 */
export function encodeClientMsg(msg: RtClientMsg): Uint8Array {
    if (!Object.prototype.hasOwnProperty.call(RtClientTag, msg.type)) {
        refuse(`unknown client message ${String((msg as { type: unknown }).type)}`)
    }
    const w = new RtWriter()
    w.u8(RtClientTag[msg.type])
    switch (msg.type) {
        case 'list':
            break
        case 'create': {
            writeStr(w, msg.name, RT_PROTOCOL_BOUNDS.nameBytes, 'world name')
            const problem = worldNameProblem(msg.name) ?? createSettingsProblem(msg.side, msg.maxCompanies)
            if (problem !== null) refuse(problem)
            w.u16(msg.side)
            w.u8(msg.maxCompanies)
            writeBool(w, msg.sharing, 'sharing')
            break
        }
        case 'join':
            if (!isRtInviteCode(msg.inviteCode)) refuse('join invite code has the wrong shape')
            w.str(msg.inviteCode)
            break
        case 'open':
            writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            if (msg.inviteCode === null) {
                w.u8(0)
            } else {
                if (!isRtInviteCode(msg.inviteCode)) refuse('open invite code has the wrong shape')
                w.u8(1)
                w.str(msg.inviteCode)
            }
            break
        case 'command': {
            w.u8(msg.seq)
            const command = msg.command
            if (typeof command !== 'object' || command === null) refuse('command must be an object')
            if (command.kind === RtCommandKind.foundCompany) refuse('foundCompany is issued by the server only')
            // encodeCommand throws RangeError for anything decodeCommand would refuse
            const bytes = encodeCommand(command)
            checkBytes(bytes, RT_PROTOCOL_BOUNDS.commandBytes, 'command')
            w.bytes(bytes)
            break
        }
        case 'loaded':
        case 'stop':
        case 'delete':
        case 'resync':
            writeStr(w, msg.worldId, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            break
        case 'ping':
            w.u32(msg.value)
            break
        default: {
            const unknown: never = msg
            refuse(`unhandled client message ${String(unknown)}`)
        }
    }
    if (w.length > RT_PROTOCOL_BOUNDS.clientFrameBytes) refuse(`${msg.type} frame of ${w.length} bytes exceeds ${RT_PROTOCOL_BOUNDS.clientFrameBytes}`)
    return w.finish()
}

/*
 * Decoding (W87). Each reader below throws RtBadData and nothing else; decodeServerMsg turns that
 * into null. Every count is checked against its cap before a loop runs on it, and the reader's own
 * short-read check bounds every byte run by the bytes actually present.
 */

// keeps a leading U+FEFF, which the default decoder strips and the encoder writes
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const TAG_TYPES: ReadonlyMap<number, RtServerMsg['type']> = new Map(
    (Object.keys(RtServerTag) as RtServerMsg['type'][]).map(type => [RtServerTag[type], type])
)

function bad(what: string): never {
    throw new RtBadData(`protocol: ${what}`)
}

/** Bytes RtWriter.varint spends on value. */
function varintLength(value: number): number {
    let length = 1
    for (let rest = value; rest >= 0x80; rest = Math.floor(rest / 0x80)) length++
    return length
}

/** A varint in its shortest form only: an overlong one would re-encode to other bytes. */
function readVarint(r: RtReader): number {
    const before = r.remaining()
    const value = r.varint()
    if (before - r.remaining() !== varintLength(value)) bad('overlong varint')
    return value
}

function readStr(r: RtReader, maxBytes: number, what: string): string {
    const length = readVarint(r)
    if (length === 0 || length > maxBytes) bad(`${what} of ${length} bytes is outside 1 to ${maxBytes}`)
    const data = r.bytes(length)
    try {
        // fatal also refuses an encoded surrogate, so no lone surrogate gets through
        return STRICT_UTF8.decode(data)
    } catch {
        bad(`${what} is not valid utf-8`)
    }
}

function readEnum<T extends string>(r: RtReader, list: readonly T[], what: string): T {
    const index = r.u8()
    if (index >= list.length) bad(`unknown ${what} ${index}`)
    return list[index]!
}

function readBool(r: RtReader, what: string): boolean {
    const value = r.u8()
    if (value > 1) bad(`${what} byte ${value} is not a boolean`)
    return value === 1
}

function readCompany(r: RtReader, what: string): number | null {
    const value = r.u8()
    if (value === RT_OWNER_NONE) return null
    if (value >= RT_PROTOCOL_BOUNDS.companies) bad(`${what} out of range: ${value}`)
    return value
}

function readInviteCode(r: RtReader, what: string): string {
    const code = readStr(r, RT_PROTOCOL_BOUNDS.inviteCodeBytes, what)
    if (!isRtInviteCode(code)) bad(`${what} has the wrong shape`)
    return code
}

/** A run of 1 to maxBytes bytes after a varint length, as a view into the frame. */
function readSizedBytes(r: RtReader, maxBytes: number, what: string): Uint8Array {
    const length = readVarint(r)
    if (length === 0 || length > maxBytes) bad(`${what} of ${length} bytes is outside 1 to ${maxBytes}`)
    return r.bytes(length)
}

function readStamped(r: RtReader, minTick: number): RtStampedCommand {
    const tick = r.u32()
    if (tick < minTick) bad(`pending command for tick ${tick} before tick ${minTick}`)
    const company = readCompany(r, 'command company')
    // a copy, so a queued command does not pin the multi-megabyte snapshot frame
    const command = readSizedBytes(r, RT_PROTOCOL_BOUNDS.commandBytes, 'command').slice()
    return { tick, company, command }
}

function readSnapshotBody(r: RtReader): RtSnapshotBody {
    const tick = r.u32()
    const serverNow = readVarint(r)
    // a view into the frame, handed to decodeWorld after gunzip without a copy
    const snapshot = readSizedBytes(r, RT_PROTOCOL_BOUNDS.snapshotBytes, 'snapshot')
    const count = readVarint(r)
    if (count > RT_PROTOCOL_BOUNDS.pending) bad(`${count} pending commands exceed ${RT_PROTOCOL_BOUNDS.pending}`)
    const pending: RtStampedCommand[] = []
    let minTick = tick
    for (let i = 0; i < count; i++) {
        const stamped = readStamped(r, minTick)
        pending.push(stamped)
        minTick = stamped.tick
    }
    return { tick, serverNow, snapshot, pending }
}

function readWorldSummary(r: RtReader): RtWorldSummary {
    const id = readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
    const name = readStr(r, RT_PROTOCOL_BOUNDS.nameBytes, 'world name')
    const status = readEnum(r, RT_WORLD_STATUSES, 'world status')
    const isOwner = readBool(r, 'isOwner')
    const memberCount = r.u8()
    if (memberCount > RT_PROTOCOL_BOUNDS.companies) bad(`member count out of range: ${memberCount}`)
    const max = r.u8()
    if (max > RT_PROTOCOL_BOUNDS.companies) bad(`max companies out of range: ${max}`)
    const myCompanyId = readCompany(r, 'my company')
    const lastActiveAt = readVarint(r)
    const inviteCode = readInviteCode(r, 'world list invite code')
    return { id, name, status, isOwner, memberCount, maxCompanies: max === 0 ? null : max, myCompanyId, lastActiveAt, inviteCode }
}

function readOpened(r: RtReader): Extract<RtServerMsg, { type: 'opened' }> {
    const role = readEnum(r, RT_ROLES, 'role')
    const owner = readBool(r, 'owner')
    const company = readCompany(r, 'company')
    if ((role === 'player') !== (company !== null)) bad('a player has a company and a spectator none')
    const worldId = readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
    // present exactly for an owner or a player (AR-64); a spectator's frame has no field for it
    const inviteCode = role === 'player' || owner ? readInviteCode(r, 'opened invite code') : null
    return { type: 'opened', worldId, role, owner, company, inviteCode, ...readSnapshotBody(r) }
}

function readServerMsg(r: RtReader, type: RtServerMsg['type']): RtServerMsg {
    switch (type) {
        case 'hello': {
            const version = r.u16()
            return { type, version, buildId: readStr(r, RT_PROTOCOL_BOUNDS.buildIdBytes, 'build id') }
        }
        case 'worldList': {
            const count = readVarint(r)
            if (count > RT_PROTOCOL_BOUNDS.worldList) bad(`${count} worlds exceed ${RT_PROTOCOL_BOUNDS.worldList}`)
            const worlds: RtWorldSummary[] = []
            for (let i = 0; i < count; i++) worlds.push(readWorldSummary(r))
            return { type, worlds }
        }
        case 'joined':
            return { type, worldId: readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id') }
        case 'opened':
            return readOpened(r)
        case 'resync': {
            const worldId = readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
            return { type, worldId, ...readSnapshotBody(r) }
        }
        case 'command': {
            const tick = r.u32()
            const company = readCompany(r, 'command company')
            const length = r.remaining()
            if (length === 0 || length > RT_PROTOCOL_BOUNDS.commandBytes) {
                bad(`command of ${length} bytes is outside 1 to ${RT_PROTOCOL_BOUNDS.commandBytes}`)
            }
            return { type, tick, company, command: r.bytes(length).slice() }
        }
        case 'allowance':
            return { type, tick: r.u32() }
        case 'paused':
            return { type, reason: readEnum(r, RT_PAUSE_REASONS, 'pause reason') }
        case 'hash': {
            const tick = r.u32()
            return { type, tick, hash: r.u32() }
        }
        case 'result': {
            const seq = r.u8()
            return { type, seq, error: r.u8() }
        }
        case 'roomUnloaded':
            return { type, reason: readEnum(r, RT_UNLOAD_REASONS, 'unload reason') }
        case 'worldDeleted':
            return { type, worldId: readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id') }
        case 'error':
            return { type, code: readEnum(r, RT_ERROR_CODES, 'error code') }
        case 'pong':
            return { type, echo: r.u32() }
        case 'resumed':
        case 'worldClosed':
            return { type }
        default: {
            const unknown: never = type
            return bad(`unhandled server message ${String(unknown)}`)
        }
    }
}

/**
 * One server frame read defensively, or null for anything encodeServerMsg would not have written:
 * an oversized frame (checked before any parsing), a client or unknown tag, a field out of range,
 * a non-canonical number or string, a short frame or trailing bytes. Never throws. An opened or
 * resync snapshot is a view into `bytes` (no copy); command bytes are copies.
 */
export function decodeServerMsg(bytes: Uint8Array): RtServerMsg | null {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null
    const type = TAG_TYPES.get(bytes[0]!)
    if (type === undefined) return null
    if (bytes.length > frameCap(type)) return null
    const r = new RtReader(bytes)
    try {
        r.u8()
        const msg = readServerMsg(r, type)
        r.end()
        return msg
    } catch (e) {
        if (e instanceof RtBadData) return null
        throw e
    }
}

/*
 * Client decoding (W85), the anti-cheat boundary: the hub runs every inbound frame through it, so it
 * holds every field to what encodeClientMsg would write. Strings are length-checked against their
 * cap before any byte is read, and a command is bounded by the bytes actually left in the frame.
 */

const CLIENT_TAG_TYPES: ReadonlyMap<number, RtClientMsg['type']> = new Map(
    (Object.keys(RtClientTag) as RtClientMsg['type'][]).map(type => [RtClientTag[type], type])
)

function readWorldId(r: RtReader): string {
    return readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
}

function readCreate(r: RtReader): Extract<RtClientMsg, { type: 'create' }> {
    const name = readStr(r, RT_PROTOCOL_BOUNDS.nameBytes, 'world name')
    const side = r.u16()
    const maxCompanies = r.u8()
    const problem = worldNameProblem(name) ?? createSettingsProblem(side, maxCompanies)
    if (problem !== null) bad(problem)
    return { type: 'create', name, side, maxCompanies, sharing: readBool(r, 'sharing') }
}

function readClientCommand(r: RtReader): Extract<RtClientMsg, { type: 'command' }> {
    const seq = r.u8()
    const length = r.remaining()
    if (length === 0 || length > RT_PROTOCOL_BOUNDS.commandBytes) {
        bad(`command of ${length} bytes is outside 1 to ${RT_PROTOCOL_BOUNDS.commandBytes}`)
    }
    // without a map side: the room holds the line and area shapes to its own side (applyCommand)
    const command = decodeCommand(r.bytes(length))
    if (command === null) bad('command does not decode')
    if (command.kind === RtCommandKind.foundCompany) bad('foundCompany is issued by the server only')
    return { type: 'command', seq, command }
}

function readClientMsg(r: RtReader, type: RtClientMsg['type']): RtClientMsg {
    switch (type) {
        case 'list':
            return { type }
        case 'create':
            return readCreate(r)
        case 'join':
            return { type, inviteCode: readInviteCode(r, 'join invite code') }
        case 'open': {
            const worldId = readWorldId(r)
            const inviteCode = readBool(r, 'has invite') ? readInviteCode(r, 'open invite code') : null
            return { type, worldId, inviteCode }
        }
        case 'command':
            return readClientCommand(r)
        case 'loaded':
        case 'stop':
        case 'delete':
        case 'resync':
            return { type, worldId: readWorldId(r) }
        case 'ping':
            return { type, value: r.u32() }
        default: {
            const unknown: never = type
            return bad(`unhandled client message ${String(unknown)}`)
        }
    }
}

/**
 * One client frame read as hostile, or null for anything encodeClientMsg would not have written:
 * a frame over the client cap (checked before any parsing), a server or unknown tag, a field out of
 * range, a non-canonical number or string, invalid UTF-8, a short frame, trailing bytes, a command
 * decodeCommand refuses, or foundCompany (AR-2). Never throws. Whatever it returns re-encodes to
 * exactly `bytes`.
 */
export function decodeClientMsg(bytes: Uint8Array): RtClientMsg | null {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null
    if (bytes.length > RT_PROTOCOL_BOUNDS.clientFrameBytes) return null
    const type = CLIENT_TAG_TYPES.get(bytes[0]!)
    if (type === undefined) return null
    const r = new RtReader(bytes)
    try {
        r.u8()
        const msg = readClientMsg(r, type)
        r.end()
        return msg
    } catch (e) {
        if (e instanceof RtBadData) return null
        throw e
    }
}
