/**
 * Every network, persistence and server limit of Rail Tycoon, one constant each.
 * RT_CATALOG holds only simulation constants; anything that bounds a socket, a room, a save or a
 * request lives here, and every step that needs one imports it from this file.
 */

/** Ticks between the tick a command is stamped and the tick it executes. */
export const RT_INPUT_DELAY = 3
/** Ticks between world-hash broadcasts (the original's default sync frequency). */
export const RT_HASH_EVERY = 100
/** Wall-clock interval between periodic checkpoints. */
export const RT_CHECKPOINT_MS = 120000
/** A room with no peers at all is unloaded after this long. */
export const RT_ROOM_IDLE_MS = 300000
/** Open worlds one owner may have. */
export const RT_MAX_OPEN_WORLDS = 5
/** Worlds one owner may have in total, open or closed. */
export const RT_MAX_WORLDS_PER_OWNER = 20
/** Live rooms per process. */
export const RT_MAX_LIVE_ROOMS = 20
/** Simulation milliseconds the whole process may spend per 27 ms tick, shared by all rooms. */
export const RT_STEP_BUDGET_MS = 10
/** Pause on join gives up on a slow joiner after 500 ticks of 27 ms (the original's max join time). */
export const RT_JOIN_LOAD_TIMEOUT_MS = 13500
/** Bound on a live join, from stamping foundCompany to the checkpoint that records the member. */
export const RT_LIVE_JOIN_TIMEOUT_MS = 10000
/** Join pauses are counted over this window. */
export const RT_JOIN_PAUSE_WINDOW_MS = 60000
/** Share of RT_JOIN_PAUSE_BUDGET_WINDOW_MS the world may spend paused for joins. */
export const RT_JOIN_PAUSE_SHARE_PERCENT = 10
export const RT_JOIN_PAUSE_BUDGET_WINDOW_MS = 600000
/** Steps a client runs back to back per animation frame while catching up. */
export const RT_CLIENT_STEPS_PER_FRAME = 20
/** A client this many ticks behind its frame allowance resyncs instead of replaying (60 s of play). */
export const RT_RESYNC_BEHIND_TICKS = 2220
/** Commands per second each peer may submit to a room, and the bucket's burst. */
export const RT_ROOM_CMD_RATE = 20
export const RT_ROOM_CMD_BURST = 40
/** Socket messages per second each connection may send, and the bucket's burst. */
export const RT_SOCKET_MSG_RATE = 60
export const RT_SOCKET_MSG_BURST = 120
/** Connected sockets per process. */
export const RT_MAX_PEERS = 200
/** Largest frame a client may send. */
export const RT_MAX_FRAME_BYTES = 4096
/** Largest compressed save: a world at every cap gzips to about 9.3 MB (Michael chose 16 MiB, 2026-10-31). */
export const RT_MAX_SAVE_BYTES = 16777216
/**
 * Largest part or snapshotEnd frame: a 1 MiB part fragment, or the pending commands (1024 of at most
 * 1 KiB), with room to spare. A snapshot travels as many of these, never as one frame.
 */
export const RT_MAX_SNAPSHOT_FRAME_BYTES = 2097152
/** Compressed bytes of a world part one part frame carries; a larger part is split over several. */
export const RT_PART_FRAGMENT_BYTES = 1048576
/** Bytes the socket may hold unsent before further frames wait in order, well under Bun's 16 MiB backpressure limit. */
export const RT_SOCKET_HIGH_WATER_BYTES = 4194304
/** Unsent backlog, waiting frames included, that closes a slow consumer: a whole snapshot plus 8 MiB fits. */
export const RT_BACKLOG_CLOSE_BYTES = 25165824
/** Largest decompressed save gunzip may produce. */
export const RT_GUNZIP_MAX_BYTES = 67108864
/** A world whose room unloads on an exception this often within RT_BROKEN_WINDOW_MS is treated as broken. */
export const RT_BROKEN_UNLOADS = 3
export const RT_BROKEN_WINDOW_MS = 600000
/** Per peer: the least time between two resync requests, and between two opens. */
export const RT_RESYNC_COOLDOWN_MS = 5000
export const RT_OPEN_COOLDOWN_MS = 2000
/** Per user: the least time between two world creations. */
export const RT_CREATE_COOLDOWN_MS = 10000
/** World creations in flight per process. */
export const RT_MAX_PENDING_CREATES = 4
/** Failed invite codes a user may present per minute. */
export const RT_INVITE_FAILS_PER_MINUTE = 10
/** Characters in an invite code: 16 Crockford base32 symbols, 80 bits. */
export const RT_INVITE_CODE_LENGTH = 16
/** Crockford base32: digits and capitals without I, L, O and U. */
export const RT_INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** True when `code` has exactly the shape rtCreateWorld generates. */
export function isRtInviteCode(code: unknown): code is string {
    if (typeof code !== 'string' || code.length !== RT_INVITE_CODE_LENGTH) return false
    for (const char of code) {
        if (!RT_INVITE_CODE_ALPHABET.includes(char)) return false
    }
    return true
}
/** The invite link's path (server/routes/rail-tycoon/invite/[code].get.ts). */
export function rtInvitePath(code: string): string {
    return `/rail-tycoon/invite/${code}`
}
/** Whether a world has no room for another member: every member runs a company (null: unknown cap, never full). */
export function rtWorldFull(maxCompanies: number | null, members: number): boolean {
    return maxCompanies !== null && members >= maxCompanies
}

/** Bound on one job in a world's serialized hub chain. */
export const RT_CHAIN_TIMEOUT_MS = 10000
