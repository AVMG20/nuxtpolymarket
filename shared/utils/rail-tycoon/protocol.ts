/**
 * Rail Tycoon's binary socket protocol. Every frame is one u8 tag followed by fixed
 * little-endian fields (bytes.ts); strings are varint-length-prefixed UTF-8 under a cap, lists are a
 * varint count under a cap. Never JSON. Tags are fixed for protocol version 1 and only ever added.
 *
 * Client to server (encodeClientMsg), tags 0x01 to 0x7f (0x00 is never a tag):
 *   list          no fields: the worlds the user owns or has joined
 *   create        str world name (no control characters, no outer whitespace), u16 map side
 *                 (64, 128 or 256), u8 max companies (2 to 8), u8 sharing (0 or 1), u8 public (0 or 1)
 *   join          str invite code (exactly the shape rtCreateWorld generates)
 *   open          str world id, u8 has invite (0 or 1), then str invite code when it is 1, then the
 *                 part hashes the client already holds
 *     part hashes: varint count (at most RT_PROTOCOL_BOUNDS.parts), then 8 bytes per part (save.ts
 *                  rtPartHash as two u32), index 0 the entity part and 1 + c chunk c
 *   loaded        str world id: the client finished decoding that world's snapshot
 *   command       u8 sequence number (the server's result echoes it), then encodeCommand bytes to
 *                 the frame end: the command plus 2 bytes. foundCompany is the server's alone.
 *   stop, delete  str world id (owner only; the hub checks)
 *   resync        str world id, then the part hashes of the client's own world: ask for a fresh
 *                 snapshot of the open world, with only the parts that differ
 *   ping          u32 value, echoed by pong
 *
 * Server to client (encodeServerMsg), tags 0x80 and up so a client frame echoed back is never
 * mistaken for one (client tags stay below 0x80):
 *   hello         u16 protocol version, str build id
 *   worldList     varint count, then per world: str id, str name, u8 status, u8 owner, u8 members,
 *                 u8 max companies (0 = unset), u8 my company (255 = none), varint last active ms,
 *                 str invite code, u8 public
 *   joined       str world id: the world a create or a join made the user a member of
 *   opened        u8 role, u8 owner, u8 company (255 = none), str world id, str invite code only when
 *                 the role is player or owner is 1, then the snapshot head
 *   resync        str world id, then the snapshot head
 *     snapshot head: u32 tick, varint server now ms (display only), then the hashes of every part
 *                    of the world at that tick. The parts whose hash differs from what the client
 *                    offered follow as part frames, in ascending index, then snapshotEnd.
 *   part          u16 part index, u8 last fragment (0 or 1), varint length + gzip bytes (a
 *                 fragment of at most RT_PART_FRAGMENT_BYTES; a part's fragments join in order)
 *   snapshotEnd   u32 snapshot tick, varint count + pending stamped commands, each u32 tick,
 *                 u8 company, varint length + command bytes, ticks ascending and at or after the
 *                 snapshot tick
 *   command       u32 tick, u8 company (255 = server-issued), then the command bytes to the frame end
 *   allowance     u32 tick the client may step up to
 *   paused        u8 reason;  resumed: no fields
 *   hash          u32 tick, u32 world hash
 *   result        u8 client sequence number, u8 applyCommand error code (to the sender only)
 *   worldClosed   no fields;  roomUnloaded: u8 reason;  worldDeleted: str world id
 *   error         u8 error code;  pong: u32 echo of the ping's value
 *
 * Each encoder refuses (RangeError) any message its decoder would refuse, so neither side sends a
 * frame the other drops. Each decoder mirrors every one of those checks and returns null
 * for any frame it refuses; whatever it accepts re-encodes to the same bytes (varints and strings
 * must be canonical). decodeClientMsg is the anti-cheat boundary: a hand-built frame gets no further
 * than one the chooser and the tools could send. This file imports no compression module: the
 * client imports it.
 */

import { RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CATALOG } from './catalog'
import { decodeCommand, encodeCommand, RtCommandKind, type RtCommand } from './commands'
import {
    isRtInviteCode,
    RT_INVITE_CODE_LENGTH,
    RT_MAX_FRAME_BYTES,
    RT_MAX_SAVE_BYTES,
    RT_MAX_SNAPSHOT_FRAME_BYTES,
    RT_PART_FRAGMENT_BYTES
} from './limits'
import { RT_MAP_SIDES } from './map'
import { rtChunkCount } from './save'
import { RT_OWNER_NONE } from './types'

/** Wire protocol version; hello carries it and a client with another one stops as outdated. */
export const RT_PROTOCOL_VERSION = 1

/** Every code the socket is closed with; the 4xxx codes mirror the HTTP status they stand for. */
export const RtCloseCode = {
    normal: 1000,
    serverError: 1011,
    unauthorized: 4401,
    forbidden: 4403,
    /** A send backlog the client could not drain; it reconnects and reopens. */
    tooSlow: 4408,
    /** A newer socket of the same user took over. */
    replaced: 4409,
    serverFull: 4503
} as const

/** Every cap the codecs enforce, one place for both directions. */
export const RT_PROTOCOL_BOUNDS = Object.freeze({
    /** Largest client frame. */
    clientFrameBytes: RT_MAX_FRAME_BYTES,
    /** Largest server frame other than part and snapshotEnd. */
    serverFrameBytes: 8192,
    /** Largest part or snapshotEnd frame. */
    snapshotFrameBytes: RT_MAX_SNAPSHOT_FRAME_BYTES,
    /** Largest compressed snapshot, all its parts together. */
    snapshotBytes: RT_MAX_SAVE_BYTES,
    /** Compressed bytes in one part frame. */
    fragmentBytes: RT_PART_FRAGMENT_BYTES,
    /** Parts of the largest map: the entity part plus one per chunk. */
    parts: 1 + rtChunkCount(Math.max(...RT_MAP_SIDES)),
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
    /** The fewest companies a created world may allow. */
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
        /** Infrastructure sharing. */
        sharing: boolean
        /** Listed in the public lobby. */
        isPublic: boolean
    }
    | { type: 'join', inviteCode: string }
    /**
     * An invite code lets a stranger spectate; null for a world the user already belongs to. `have` is
     * the part hashes the client holds from an earlier visit; the server sends only the others.
     */
    | { type: 'open', worldId: string, inviteCode: string | null, have: readonly string[] }
    | { type: 'loaded', worldId: string }
    | {
        type: 'command'
        /** Echoed by the server's result; the client wraps it at 256. */
        seq: number
        /** Any command but foundCompany, which only the server issues. */
        command: RtCommand
    }
    | { type: 'stop', worldId: string }
    | { type: 'delete', worldId: string }
    /** `have` is the part hashes of the client's own world; the server sends only the others. */
    | { type: 'resync', worldId: string, have: readonly string[] }
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
    pong: 0x8f,
    part: 0x90,
    snapshotEnd: 0x91
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

/** Why the room stopped ticking: no player attached, a join pause, or the owner's stop. */
export const RT_PAUSE_REASONS = Object.freeze(['noPlayers', 'joining', 'closed'] as const)
export type RtPauseReason = typeof RT_PAUSE_REASONS[number]

/** Why a room unloaded under its peers: a foreign 409, a step exception or refused write, a failed live join, idleness. */
export const RT_UNLOAD_REASONS = Object.freeze(['conflict', 'error', 'joinFailed', 'idle'] as const)
export type RtUnloadReason = typeof RT_UNLOAD_REASONS[number]

/** Request-level refusals the hub and room answer with (goals 13 and 20). */
export const RT_ERROR_CODES = Object.freeze([
    /** A frame failed to decode. */
    'badRequest',
    /** A cooldown is running: open, resync, create or invite lookups. */
    'tooSoon',
    /** The process is at a cap: pending creates, live rooms, a chain wait timed out. */
    'busy',
    /** The world's room failed too often and is refused until restart. */
    'worldBroken',
    /** Not found or not allowed; the two are one code so a stranger learns nothing. */
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
    /** encodeCommand bytes, carried as-is. */
    command: Uint8Array
}

/** One row of the chooser's list; every member sees the invite code. */
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
    /** Listed in the public lobby while open. */
    isPublic: boolean
}

/** One world in the public lobby (GET /api/rail-tycoon/lobby); its invite code is listed, since anyone may join. */
export interface RtLobbyWorld {
    id: string
    name: string
    ownerName: string
    memberCount: number
    maxCompanies: number | null
    /** Milliseconds since the epoch. */
    lastActiveAt: number
    inviteCode: string
    avatar: string | null
}

/**
 * A world captured at a tick boundary: the hash of every part (save.ts encodeWorldParts). The parts
 * the client lacks follow as part frames, then snapshotEnd with every command stamped for that tick
 * or later.
 */
export interface RtSnapshotHead {
    /** world.tick when the snapshot was encoded. */
    tick: number
    /** The server's clock in ms, for display only; never fed to the simulation. */
    serverNow: number
    /** rtPartHash of each part at that tick: index 0 the entity part, 1 + c chunk c. */
    parts: readonly string[]
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
        /** Set exactly when the role is player or owner is true. */
        inviteCode: string | null
    } & RtSnapshotHead)
    | ({ type: 'resync', worldId: string } & RtSnapshotHead)
    /** A fragment of one gzipped part; `last` ends that part. */
    | { type: 'part', index: number, last: boolean, bytes: Uint8Array }
    | {
        type: 'snapshotEnd'
        /** The snapshot's tick, as its head gave it. */
        tick: number
        /** Ascending by tick, stamp order within a tick, none before the snapshot tick. */
        pending: readonly RtStampedCommand[]
    }
    | ({ type: 'command' } & RtStampedCommand)
    | { type: 'allowance', tick: number }
    | { type: 'paused', reason: RtPauseReason }
    | { type: 'resumed' }
    | { type: 'hash', tick: number, hash: number }
    | {
        type: 'result'
        /** The sequence number the client gave the command. */
        seq: number
        /** applyCommand's error code. */
        error: number
    }
    | { type: 'worldClosed' }
    | { type: 'roomUnloaded', reason: RtUnloadReason }
    | { type: 'worldDeleted', worldId: string }
    | { type: 'error', code: RtErrorCode }
    | { type: 'pong', echo: number }

// a lone surrogate encodes as U+FFFD and would not survive a round trip
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/*
 * Encoding. The encoders check only what the decoder cannot see, a value that would read back as a
 * different one (a lone surrogate, a non-boolean, company 255, no cap written as 0, a malformed part
 * hash, a misplaced invite field); every cap and range is the decoder's, and each encoder decodes
 * its own frame before handing it out.
 */

function refuse(what: string): never {
    throw new RangeError(`protocol: ${what}`)
}

function writeStr(w: RtWriter, text: string, what: string): void {
    if (typeof text !== 'string') refuse(`${what} must be a string`)
    if (LONE_SURROGATE.test(text)) refuse(`${what} holds a lone surrogate`)
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

/** A company byte: an id, or RT_OWNER_NONE for null; a number 255 would read back as none. */
function writeCompany(w: RtWriter, company: number | null, what: string): void {
    if (company === RT_OWNER_NONE) refuse(`${what} out of range: ${company}`)
    w.u8(company ?? RT_OWNER_NONE)
}

function writeBytes(w: RtWriter, data: Uint8Array, what: string): void {
    if (!(data instanceof Uint8Array)) refuse(`${what} must be a Uint8Array`)
    w.bytes(data)
}

/** A varint length, then the bytes. */
function writeSizedBytes(w: RtWriter, data: Uint8Array, what: string): void {
    if (!(data instanceof Uint8Array)) refuse(`${what} must be a Uint8Array`)
    w.varint(data.length)
    w.bytes(data)
}

function writeStamped(w: RtWriter, stamped: RtStampedCommand): void {
    w.u32(stamped.tick)
    writeCompany(w, stamped.company, 'command company')
    writeSizedBytes(w, stamped.command, 'command')
}

const PART_HASH = /^[0-9a-f]{16}$/

/** Part hashes: a varint count, then each as two u32 (high half first). */
function writeHashes(w: RtWriter, hashes: readonly string[], what: string): void {
    if (!Array.isArray(hashes)) refuse(`${what} must be an array`)
    w.varint(hashes.length)
    for (const hash of hashes) {
        if (typeof hash !== 'string' || !PART_HASH.test(hash)) refuse(`${what} entry is not a part hash`)
        w.u32(parseInt(hash.slice(0, 8), 16))
        w.u32(parseInt(hash.slice(8), 16))
    }
}

function writeSnapshotHead(w: RtWriter, head: RtSnapshotHead): void {
    w.u32(head.tick)
    w.varint(head.serverNow)
    writeHashes(w, head.parts, 'snapshot parts')
}

function writeSnapshotEnd(w: RtWriter, msg: Extract<RtServerMsg, { type: 'snapshotEnd' }>): void {
    w.u32(msg.tick)
    w.varint(msg.pending.length)
    for (const stamped of msg.pending) writeStamped(w, stamped)
}

function writePart(w: RtWriter, msg: Extract<RtServerMsg, { type: 'part' }>): void {
    w.u16(msg.index)
    writeBool(w, msg.last, 'last fragment')
    writeSizedBytes(w, msg.bytes, 'part fragment')
}

function writeWorldSummary(w: RtWriter, world: RtWorldSummary): void {
    writeStr(w, world.id, 'world id')
    writeStr(w, world.name, 'world name')
    writeEnum(w, RT_WORLD_STATUSES, world.status, 'world status')
    writeBool(w, world.isOwner, 'isOwner')
    w.u8(world.memberCount)
    // 0 is the byte for no cap, so a cap of 0 would read back as none
    if (world.maxCompanies === 0) refuse('max companies out of range: 0')
    w.u8(world.maxCompanies ?? 0)
    writeCompany(w, world.myCompanyId, 'my company')
    w.varint(world.lastActiveAt)
    writeStr(w, world.inviteCode, 'world list invite code')
    writeBool(w, world.isPublic, 'isPublic')
}

function writeOpened(w: RtWriter, msg: Extract<RtServerMsg, { type: 'opened' }>): void {
    writeEnum(w, RT_ROLES, msg.role, 'role')
    writeBool(w, msg.owner, 'owner')
    writeCompany(w, msg.company, 'company')
    writeStr(w, msg.worldId, 'world id')
    // the code goes to an owner or a player only; a spectator's frame has no field for it, so a
    // misplaced code would shift every field after it
    const invited = msg.role === 'player' || msg.owner
    if (invited !== (msg.inviteCode !== null)) refuse('the invite code goes exactly to an owner or a player')
    if (msg.inviteCode !== null) writeStr(w, msg.inviteCode, 'opened invite code')
    writeSnapshotHead(w, msg)
}

/** The frame cap for a server message. */
function frameCap(type: RtServerMsg['type']): number {
    return type === 'part' || type === 'snapshotEnd' ? RT_PROTOCOL_BOUNDS.snapshotFrameBytes : RT_PROTOCOL_BOUNDS.serverFrameBytes
}

/** One server frame. Throws RangeError for a message the protocol cannot carry: one decodeServerMsg refuses. */
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
            writeStr(w, msg.buildId, 'build id')
            break
        case 'worldList':
            w.varint(msg.worlds.length)
            for (const world of msg.worlds) writeWorldSummary(w, world)
            break
        case 'joined':
            writeStr(w, msg.worldId, 'world id')
            break
        case 'opened':
            writeOpened(w, msg)
            break
        case 'resync':
            writeStr(w, msg.worldId, 'world id')
            writeSnapshotHead(w, msg)
            break
        case 'part':
            writePart(w, msg)
            break
        case 'snapshotEnd':
            writeSnapshotEnd(w, msg)
            break
        case 'command':
            // 6 bytes plus the command: no length prefix, the command runs to the end of the frame
            w.u32(msg.tick)
            writeCompany(w, msg.company, 'command company')
            writeBytes(w, msg.command, 'command')
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
            writeStr(w, msg.worldId, 'world id')
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
    const bytes = w.finish()
    if (decodeServerMsg(bytes) === null) refuse(`${msg.type} frame of ${bytes.length} bytes does not decode`)
    return bytes
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

/** Why create settings cannot travel, or null: the same bounds as checkSettings in world.ts. */
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
        case 'create':
            writeStr(w, msg.name, 'world name')
            w.u16(msg.side)
            w.u8(msg.maxCompanies)
            writeBool(w, msg.sharing, 'sharing')
            writeBool(w, msg.isPublic, 'isPublic')
            break
        case 'join':
            writeStr(w, msg.inviteCode, 'join invite code')
            break
        case 'open':
            writeStr(w, msg.worldId, 'world id')
            writeBool(w, msg.inviteCode !== null, 'has invite')
            if (msg.inviteCode !== null) writeStr(w, msg.inviteCode, 'open invite code')
            writeHashes(w, msg.have, 'held parts')
            break
        case 'command':
            w.u8(msg.seq)
            if (typeof msg.command !== 'object' || msg.command === null) refuse('command must be an object')
            w.bytes(encodeCommand(msg.command))
            break
        case 'loaded':
        case 'stop':
        case 'delete':
            writeStr(w, msg.worldId, 'world id')
            break
        case 'resync':
            writeStr(w, msg.worldId, 'world id')
            writeHashes(w, msg.have, 'held parts')
            break
        case 'ping':
            w.u32(msg.value)
            break
        default: {
            const unknown: never = msg
            refuse(`unhandled client message ${String(unknown)}`)
        }
    }
    const bytes = w.finish()
    if (decodeClientMsg(bytes) === null) refuse(`${msg.type} frame of ${bytes.length} bytes does not decode`)
    return bytes
}

/*
 * Decoding. Each reader below throws RtBadData and nothing else; decodeServerMsg turns that
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

function hashHex(value: number): string {
    return value.toString(16).padStart(8, '0')
}

/** Part hashes as writeHashes wrote them, the count checked against the cap and the bytes left first. */
function readHashes(r: RtReader, what: string): string[] {
    const count = readVarint(r)
    if (count > RT_PROTOCOL_BOUNDS.parts) bad(`${count} ${what} exceed ${RT_PROTOCOL_BOUNDS.parts}`)
    if (count * 8 > r.remaining()) bad(`${count} ${what} but ${r.remaining()} bytes left`)
    const hashes: string[] = []
    for (let i = 0; i < count; i++) {
        const high = r.u32()
        hashes.push(hashHex(high) + hashHex(r.u32()))
    }
    return hashes
}

function readSnapshotHead(r: RtReader): RtSnapshotHead {
    const tick = r.u32()
    const serverNow = readVarint(r)
    const parts = readHashes(r, 'snapshot parts')
    if (parts.length === 0) bad('a snapshot has at least the entity part')
    return { tick, serverNow, parts }
}

function readSnapshotEnd(r: RtReader): Extract<RtServerMsg, { type: 'snapshotEnd' }> {
    const tick = r.u32()
    const count = readVarint(r)
    if (count > RT_PROTOCOL_BOUNDS.pending) bad(`${count} pending commands exceed ${RT_PROTOCOL_BOUNDS.pending}`)
    const pending: RtStampedCommand[] = []
    let minTick = tick
    for (let i = 0; i < count; i++) {
        const stamped = readStamped(r, minTick)
        pending.push(stamped)
        minTick = stamped.tick
    }
    return { type: 'snapshotEnd', tick, pending }
}

function readPart(r: RtReader): Extract<RtServerMsg, { type: 'part' }> {
    const index = r.u16()
    if (index >= RT_PROTOCOL_BOUNDS.parts) bad(`part index out of range: ${index}`)
    const last = readBool(r, 'last fragment')
    // a view into the frame; the client copies it into its part buffer
    return { type: 'part', index, last, bytes: readSizedBytes(r, RT_PROTOCOL_BOUNDS.fragmentBytes, 'part fragment') }
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
    const isPublic = readBool(r, 'isPublic')
    return { id, name, status, isOwner, memberCount, maxCompanies: max === 0 ? null : max, myCompanyId, lastActiveAt, inviteCode, isPublic }
}

function readOpened(r: RtReader): Extract<RtServerMsg, { type: 'opened' }> {
    const role = readEnum(r, RT_ROLES, 'role')
    const owner = readBool(r, 'owner')
    const company = readCompany(r, 'company')
    if ((role === 'player') !== (company !== null)) bad('a player has a company and a spectator none')
    const worldId = readStr(r, RT_PROTOCOL_BOUNDS.worldIdBytes, 'world id')
    // present exactly for an owner or a player; a spectator's frame has no field for it
    const inviteCode = role === 'player' || owner ? readInviteCode(r, 'opened invite code') : null
    return { type: 'opened', worldId, role, owner, company, inviteCode, ...readSnapshotHead(r) }
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
            return { type, worldId, ...readSnapshotHead(r) }
        }
        case 'part':
            return readPart(r)
        case 'snapshotEnd':
            return readSnapshotEnd(r)
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
 * a non-canonical number or string, a short frame or trailing bytes. Never throws. A part fragment
 * is a view into `bytes` (no copy); command bytes are copies.
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
 * Client decoding, the anti-cheat boundary: the hub runs every inbound frame through it, so it
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
    const sharing = readBool(r, 'sharing')
    return { type: 'create', name, side, maxCompanies, sharing, isPublic: readBool(r, 'isPublic') }
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
            return { type, worldId, inviteCode, have: readHashes(r, 'held parts') }
        }
        case 'command':
            return readClientCommand(r)
        case 'loaded':
        case 'stop':
        case 'delete':
            return { type, worldId: readWorldId(r) }
        case 'resync': {
            const worldId = readWorldId(r)
            return { type, worldId, have: readHashes(r, 'held parts') }
        }
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
 * decodeCommand refuses, or foundCompany. Never throws. Whatever it returns re-encodes to
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
