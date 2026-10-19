import { DF_MAX_PLAYERS } from '#shared/utils/dead-front/constants'
import type { DfClientMsg, DfLobbyState, DfLobbySummary, DfServerMsg } from '#shared/utils/dead-front/protocol'
import type { DfMatchResult, DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { DfMatch } from './match'

// Sockets, lobbies and match routing. One socket per tab; a user opening a
// second tab replaces the first. The site has ~10 players, so lobbies are
// public, unranked and simple: create, join, ready, host starts.

export interface DfSocket {
    id: string
    send: (frame: string) => void
    close: (code?: number, reason?: string) => void
}

interface Conn {
    socket: DfSocket
    userId: string
    name: string
    /** Token bucket against message floods. */
    tokens: number
    tokensAt: number
    chatAt: number
}

interface LobbyMember {
    userId: string
    name: string
    ready: boolean
    /** Socket gone: they keep their place for `LOBBY_GRACE_MS`. */
    away?: boolean
}

interface Lobby {
    id: string
    members: LobbyMember[] // members[0] is the host
    state: 'lobby' | 'playing'
    match: DfMatch | null
    starting: boolean
    /** Rebuilt after a restart by a member who wasn't its host: the host takes the lead back when they return. */
    restoredHost?: string
}

export interface DfHubDeps {
    loadProfile: (userId: string) => Promise<DfProfileView>
    applyResult: (userId: string, result: DfMatchResult) => Promise<DfProgressReport>
}

export const DF_MAX_PEERS = 200
const MSG_RATE = 90 // per second
const MSG_BURST = 180
const MAX_FRAME = 16 * 1024
/** How long a dropped member keeps their place in a lobby (a deploy restart takes ~10 s). */
export const DF_LOBBY_GRACE_MS = 45_000

export class DfHub {
    private conns = new Map<string, Conn>() // socket id -> conn
    private users = new Map<string, Conn>() // user id -> current conn
    private lobbies = new Map<string, Lobby>()
    private userLobby = new Map<string, string>() // user id -> lobby id
    private awayTimers = new Map<string, ReturnType<typeof setTimeout>>() // user id -> lobby place expiry
    private lobbySeq = 0

    constructor(private readonly deps: DfHubDeps) {}

    get peerCount(): number {
        return this.conns.size
    }

    // ---------------------------------------------------------------- sockets

    open(socket: DfSocket, user: { id: string, name: string }): void {
        if (this.conns.size >= DF_MAX_PEERS) {
            socket.close(4503, 'Server full')
            return
        }
        const conn: Conn = { socket, userId: user.id, name: (user.name || 'Soldier').slice(0, 30), tokens: MSG_BURST, tokensAt: Date.now(), chatAt: 0 }
        const previous = this.users.get(user.id)
        this.conns.set(socket.id, conn)
        this.users.set(user.id, conn)
        if (previous && previous.socket.id !== socket.id) {
            this.conns.delete(previous.socket.id)
            try {
                previous.socket.close(4409, 'Opened in another tab')
            } catch {
                // already gone
            }
        }
        this.sendTo(conn, { t: 'hello', userId: conn.userId, name: conn.name })
        const lobby = this.lobbyOf(user.id)
        if (lobby) {
            this.comeBack(lobby, user.id)
            this.sendTo(conn, { t: 'lobby', lobby: this.lobbyState(lobby) })
            if (lobby.match?.has(user.id)) {
                lobby.match.reconnect(user.id)
                return
            }
        } else {
            // say so outright: a client that was in a lobby before a restart rebuilds it
            this.sendTo(conn, { t: 'lobby', lobby: null })
        }
        this.sendTo(conn, { t: 'lobbies', lobbies: this.summaries() })
    }

    close(socketId: string): void {
        const conn = this.conns.get(socketId)
        if (!conn) return
        this.conns.delete(socketId)
        if (this.users.get(conn.userId) !== conn) return // replaced by a newer tab
        this.users.delete(conn.userId)
        const lobby = this.lobbyOf(conn.userId)
        if (!lobby) return
        if (lobby.match?.has(conn.userId)) {
            lobby.match.disconnect(conn.userId)
            return
        }
        this.goAway(lobby, conn.userId)
    }

    /** A member's socket dropped outside a match: hold their place a while instead of dropping them. */
    private goAway(lobby: Lobby, userId: string): void {
        const m = lobby.members.find(x => x.userId === userId)
        if (!m) return
        m.away = true
        m.ready = false
        this.clearAway(userId)
        this.awayTimers.set(userId, setTimeout(() => {
            this.awayTimers.delete(userId)
            const l = this.lobbyOf(userId)
            if (l && l.members.find(x => x.userId === userId)?.away) this.removeMember(l, userId)
        }, DF_LOBBY_GRACE_MS))
        this.pushLobby(lobby)
    }

    private comeBack(lobby: Lobby, userId: string): void {
        this.clearAway(userId)
        const m = lobby.members.find(x => x.userId === userId)
        if (!m?.away) return
        m.away = false
        this.pushLobby(lobby)
    }

    private clearAway(userId: string): void {
        const t = this.awayTimers.get(userId)
        if (t) clearTimeout(t)
        this.awayTimers.delete(userId)
    }

    message(socketId: string, raw: string): void {
        const conn = this.conns.get(socketId)
        if (!conn || raw.length > MAX_FRAME) return
        const now = Date.now()
        conn.tokens = Math.min(MSG_BURST, conn.tokens + ((now - conn.tokensAt) / 1000) * MSG_RATE)
        conn.tokensAt = now
        if (conn.tokens < 1) return
        conn.tokens -= 1
        let msg: DfClientMsg
        try {
            msg = JSON.parse(raw) as DfClientMsg
        } catch {
            return
        }
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return
        try {
            this.route(conn, msg)
        } catch (e) {
            console.error('[dead-front] hub message failed', msg.t, e)
        }
    }

    private route(conn: Conn, msg: DfClientMsg): void {
        switch (msg.t) {
            case 'ping':
                this.sendTo(conn, { t: 'pong', at: typeof msg.at === 'number' ? msg.at : 0 })
                return
            case 'lobbies':
                this.sendTo(conn, { t: 'lobbies', lobbies: this.summaries() })
                return
            case 'create':
                this.create(conn)
                return
            case 'join':
                this.join(conn, String(msg.id))
                return
            case 'rejoin':
                this.rejoin(conn, String(msg.id), typeof msg.host === 'string' ? msg.host : null)
                return
            case 'leave':
                void this.leave(conn)
                return
            case 'ready':
                this.setReady(conn, msg.ready === true)
                return
            case 'start':
                void this.start(conn)
                return
            case 'chat':
                this.chat(conn, typeof msg.text === 'string' ? msg.text : '')
                return
        }
        const lobby = this.lobbyOf(conn.userId)
        if (lobby?.match?.has(conn.userId)) lobby.match.handle(conn.userId, msg)
    }

    // ---------------------------------------------------------------- lobbies

    private lobbyOf(userId: string): Lobby | undefined {
        const id = this.userLobby.get(userId)
        return id ? this.lobbies.get(id) : undefined
    }

    private create(conn: Conn): void {
        const current = this.lobbyOf(conn.userId)
        if (current?.state === 'playing') return
        if (current) this.removeMember(current, conn.userId)
        let id = ''
        do id = `${(++this.lobbySeq).toString(36)}${Date.now().toString(36).slice(-4)}`
        while (this.lobbies.has(id))
        const lobby: Lobby = { id, members: [{ userId: conn.userId, name: conn.name, ready: false }], state: 'lobby', match: null, starting: false }
        this.lobbies.set(id, lobby)
        this.userLobby.set(conn.userId, id)
        this.pushLobby(lobby)
        this.pushLobbies()
    }

    private join(conn: Conn, id: string): void {
        const lobby = this.lobbies.get(id)
        if (!lobby) return this.error(conn, 'That lobby is gone')
        if (lobby.state !== 'lobby' || lobby.starting) return this.error(conn, 'That squad is already in the field')
        if (lobby.members.some(m => m.userId === conn.userId)) return this.pushLobby(lobby)
        if (lobby.members.length >= DF_MAX_PLAYERS) return this.error(conn, 'That squad is full')
        const current = this.lobbyOf(conn.userId)
        if (current?.state === 'playing') return
        if (current) this.removeMember(current, conn.userId)
        lobby.members.push({ userId: conn.userId, name: conn.name, ready: false })
        this.userLobby.set(conn.userId, lobby.id)
        this.pushLobby(lobby)
        this.pushLobbies()
    }

    /**
     * Back after a reconnect that found no lobby (the server restarted and lost it):
     * the first member back rebuilds it under its old id, the rest join it, and the
     * old host takes the lead again when they arrive.
     */
    private rejoin(conn: Conn, id: string, host: string | null): void {
        if (this.lobbyOf(conn.userId)) return
        if (!/^[a-z0-9]{1,24}$/.test(id)) return
        const lobby = this.lobbies.get(id)
        if (!lobby) {
            const restored: Lobby = { id, members: [{ userId: conn.userId, name: conn.name, ready: false }], state: 'lobby', match: null, starting: false }
            if (host && host !== conn.userId) restored.restoredHost = host
            this.lobbies.set(id, restored)
            this.userLobby.set(conn.userId, id)
            this.pushLobby(restored)
            this.pushLobbies()
            return
        }
        if (lobby.state !== 'lobby' || lobby.starting || lobby.members.length >= DF_MAX_PLAYERS) {
            this.sendTo(conn, { t: 'lobby', lobby: null })
            return
        }
        const member: LobbyMember = { userId: conn.userId, name: conn.name, ready: false }
        if (lobby.restoredHost === conn.userId) {
            lobby.restoredHost = undefined
            lobby.members.unshift(member)
        } else {
            lobby.members.push(member)
        }
        this.userLobby.set(conn.userId, lobby.id)
        this.pushLobby(lobby)
        this.pushLobbies()
    }

    private async leave(conn: Conn): Promise<void> {
        const lobby = this.lobbyOf(conn.userId)
        if (!lobby) return
        if (lobby.match?.has(conn.userId)) {
            // The match writes their result, sends their end screen and calls onPlayerGone.
            await lobby.match.leave(conn.userId)
            return
        }
        this.removeMember(lobby, conn.userId)
    }

    private removeMember(lobby: Lobby, userId: string): void {
        this.clearAway(userId)
        const before = lobby.members.length
        lobby.members = lobby.members.filter(m => m.userId !== userId)
        if (this.userLobby.get(userId) === lobby.id) this.userLobby.delete(userId)
        if (lobby.members.length === before) return
        const conn = this.users.get(userId)
        if (conn) this.sendTo(conn, { t: 'lobby', lobby: null })
        if (!lobby.members.length && !lobby.match) {
            this.lobbies.delete(lobby.id)
        } else {
            this.pushLobby(lobby)
        }
        this.pushLobbies()
    }

    private setReady(conn: Conn, ready: boolean): void {
        const lobby = this.lobbyOf(conn.userId)
        if (!lobby || lobby.state !== 'lobby') return
        const m = lobby.members.find(x => x.userId === conn.userId)
        if (!m || m.ready === ready) return
        m.ready = ready
        this.pushLobby(lobby)
    }

    private async start(conn: Conn): Promise<void> {
        const lobby = this.lobbyOf(conn.userId)
        if (!lobby || lobby.state !== 'lobby' || lobby.starting) return
        const leader = this.leaderOf(lobby)
        if (leader?.userId !== conn.userId) return this.error(conn, 'Only the host can start')
        if (lobby.members.some(m => m !== leader && !m.ready && !m.away)) return this.error(conn, 'Everyone needs to be ready')
        // the host goes without anyone still reconnecting
        for (const m of lobby.members.filter(x => x.away)) this.removeMember(lobby, m.userId)
        lobby.starting = true
        const members = lobby.members.map(m => ({ userId: m.userId, name: m.name }))
        let match: DfMatch
        try {
            match = await DfMatch.create(members, {
                send: (userId, frame) => this.sendRaw(userId, frame),
                onPlayerGone: userId => this.onPlayerGone(lobby, userId),
                onFinished: m => this.onMatchFinished(lobby, m),
                onRound: () => this.pushLobbies(),
                loadProfile: this.deps.loadProfile,
                applyResult: this.deps.applyResult
            })
        } catch (e) {
            console.error('[dead-front] match start failed', e)
            lobby.starting = false
            this.error(conn, 'Could not start the match')
            return
        }
        lobby.starting = false
        lobby.state = 'playing'
        lobby.match = match
        for (const m of members) {
            // Anyone who dropped while profiles loaded is already in reconnect grace.
            if (this.users.has(m.userId)) match.sendStart(m.userId)
            else match.disconnect(m.userId)
        }
        this.pushLobby(lobby)
        this.pushLobbies()
    }

    private onPlayerGone(lobby: Lobby, userId: string): void {
        this.removeMember(lobby, userId)
    }

    private onMatchFinished(lobby: Lobby, match: DfMatch): void {
        if (lobby.match !== match) return
        lobby.match = null
        lobby.state = 'lobby'
        for (const m of lobby.members) m.ready = false
        // Members whose socket is gone don't wait around in the lobby.
        for (const m of [...lobby.members]) if (!this.users.has(m.userId)) this.removeMember(lobby, m.userId)
        if (!lobby.members.length) {
            this.lobbies.delete(lobby.id)
        } else {
            this.pushLobby(lobby)
        }
        this.pushLobbies()
    }

    private chat(conn: Conn, text: string): void {
        const now = Date.now()
        if (now - conn.chatAt < 400) return
        conn.chatAt = now
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200)
        if (!clean) return
        const lobby = this.lobbyOf(conn.userId)
        if (!lobby) return
        if (lobby.match?.has(conn.userId)) {
            lobby.match.handle(conn.userId, { t: 'chat', text: clean })
            return
        }
        for (const m of lobby.members) this.sendRaw(m.userId, JSON.stringify({ t: 'chat', name: conn.name, text: clean } satisfies DfServerMsg))
    }

    // ---------------------------------------------------------------- output

    /** Who leads: the host, or while the host is reconnecting the first member still here. */
    private leaderOf(lobby: Lobby): LobbyMember | undefined {
        return lobby.members.find(m => !m.away) ?? lobby.members[0]
    }

    private lobbyState(lobby: Lobby): DfLobbyState {
        const leader = this.leaderOf(lobby)
        return {
            id: lobby.id,
            members: lobby.members.map(m => ({ userId: m.userId, name: m.name, ready: m === leader || m.ready, host: m === leader, ...(m.away ? { away: true } : {}) })),
            state: lobby.state
        }
    }

    summaries(): DfLobbySummary[] {
        return [...this.lobbies.values()].filter(l => l.members.length).map(l => ({
            id: l.id,
            hostName: this.leaderOf(l)!.name,
            players: l.members.length,
            maxPlayers: DF_MAX_PLAYERS,
            state: l.state,
            round: l.match?.round ?? 0
        }))
    }

    private pushLobby(lobby: Lobby): void {
        const frame = JSON.stringify({ t: 'lobby', lobby: this.lobbyState(lobby) } satisfies DfServerMsg)
        for (const m of lobby.members) this.sendRaw(m.userId, frame)
    }

    /** Lobby list for everyone in the menus (not in a running match). */
    private pushLobbies(): void {
        const frame = JSON.stringify({ t: 'lobbies', lobbies: this.summaries() } satisfies DfServerMsg)
        for (const conn of this.users.values()) {
            const lobby = this.lobbyOf(conn.userId)
            if (lobby?.match?.has(conn.userId)) continue
            this.safeSend(conn, frame)
        }
    }

    private sendTo(conn: Conn, msg: DfServerMsg): void {
        this.safeSend(conn, JSON.stringify(msg))
    }

    private sendRaw(userId: string, frame: string): void {
        const conn = this.users.get(userId)
        if (conn) this.safeSend(conn, frame)
    }

    private safeSend(conn: Conn, frame: string): void {
        try {
            conn.socket.send(frame)
        } catch {
            // The close handler cleans up.
        }
    }

    private error(conn: Conn, message: string): void {
        this.sendTo(conn, { t: 'error', message })
    }
}

let hub: DfHub | null = null

/** The process-wide hub, created on first use. */
export function useDfHub(deps: () => DfHubDeps): DfHub {
    if (!hub) hub = new DfHub(deps())
    return hub
}
