import type { NavLayout } from '#shared/utils/nav-layout'

/*
 * Keeps one player's sidebar layout in step with the server.
 *
 * Edits are kept as a list of operations on top of the last layout the server
 * confirmed. The player always sees them applied. Saves run one at a time
 * with the revision they started from; when another tab or device saved in
 * between, the server answers with its layout and the unconfirmed operations
 * are replayed on top of it. Operations must therefore be absolute ("put X at
 * 3", "fold folder Y"), never relative toggles, so a replay can't undo them.
 *
 * No save is sent before a load succeeded, so a failed load can never
 * overwrite the stored layout with the default one.
 */

export type NavLayoutOp = (layout: NavLayout) => NavLayout

export interface NavLayoutSnapshot {
    layout: NavLayout | null
    revision: number
}

export class NavLayoutConflict extends Error {
    constructor(readonly server: NavLayoutSnapshot) {
        super('Sidebar changed elsewhere')
    }
}

export interface NavLayoutTransport {
    load: () => Promise<NavLayoutSnapshot>
    /** Rejects with NavLayoutConflict when `revision` is no longer the stored one */
    save: (layout: NavLayout, revision: number) => Promise<NavLayoutSnapshot>
    reset: () => Promise<NavLayoutSnapshot>
}

export interface NavLayoutSyncState extends NavLayoutSnapshot {
    loaded: boolean
}

export interface NavLayoutSyncOptions {
    transport: NavLayoutTransport
    /** The layout shown while nothing is stored */
    fallback: () => NavLayout
    onChange: (state: NavLayoutSyncState) => void
    /** Called once per run of failures, not on every retry */
    onError: (error: unknown, action: 'save' | 'reset') => void
    onSaved?: (revision: number) => void
    delayMs?: number
    maxBackoffMs?: number
}

const MAX_CONFLICT_RETRIES = 5

export class NavLayoutSync {
    private confirmed: NavLayoutSnapshot | null
    private local: NavLayout | null = null
    private ops: NavLayoutOp[] = []
    private inFlight: Promise<void> | null = null
    private inFlightOps = 0
    private loading: Promise<boolean> | null = null
    private saveTimer: ReturnType<typeof setTimeout> | undefined
    private loadTimer: ReturnType<typeof setTimeout> | undefined
    private failures = 0
    private loadFailures = 0
    private conflicts = 0
    private disposed = false
    private readonly delayMs: number
    private readonly maxBackoffMs: number

    constructor(private readonly options: NavLayoutSyncOptions, initial: NavLayoutSnapshot | null = null) {
        this.confirmed = initial
        this.delayMs = options.delayMs ?? 600
        this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    }

    /** What the player sees; null means the default layout */
    get layout(): NavLayout | null {
        return this.ops.length ? this.local : this.confirmed?.layout ?? null
    }

    get loaded(): boolean {
        return this.confirmed !== null
    }

    get revision(): number {
        return this.confirmed?.revision ?? 0
    }

    /** Edits not yet confirmed by the server, including one being sent */
    get pending(): boolean {
        return this.ops.length > 0
    }

    private visible(): NavLayout {
        return this.layout ?? this.options.fallback()
    }

    private replay(base: NavLayout | null): NavLayout {
        return this.ops.reduce((layout, op) => op(layout), base ?? this.options.fallback())
    }

    private emit() {
        if (this.disposed) return
        this.options.onChange({ layout: this.layout, revision: this.revision, loaded: this.loaded })
    }

    private backoff(failures: number) {
        return Math.min(1000 * 2 ** (failures - 1), this.maxBackoffMs)
    }

    private schedule(ms: number) {
        clearTimeout(this.saveTimer)
        if (this.disposed) return
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined
            void this.flush()
        }, ms)
    }

    /** Applies an edit at once and saves it shortly after. False when it changed nothing. */
    apply(op: NavLayoutOp): boolean {
        if (this.disposed) return false
        const base = this.visible()
        const next = op(base)
        if (next === base) return false
        this.ops.push(op)
        this.local = next
        this.emit()
        this.schedule(this.delayMs)
        return true
    }

    /** Takes the server's layout as the new base, keeping unconfirmed edits on top */
    private adopt(snapshot: NavLayoutSnapshot) {
        this.confirmed = snapshot
        if (this.ops.length) this.local = this.replay(snapshot.layout)
        this.emit()
    }

    /** Loads the stored layout. Retries with backoff until it succeeds. */
    load(): Promise<boolean> {
        if (this.loading) return this.loading
        clearTimeout(this.loadTimer)
        this.loading = (async () => {
            try {
                const snapshot = await this.options.transport.load()
                if (this.disposed) return false
                this.loadFailures = 0
                this.adopt(snapshot)
                return true
            } catch {
                if (this.disposed) return false
                this.loadFailures++
                this.loadTimer = setTimeout(() => void this.load(), this.backoff(this.loadFailures))
                return false
            } finally {
                this.loading = null
            }
        })()
        return this.loading
    }

    /** Picks up changes made elsewhere, unless local edits are still on their way */
    async refresh(): Promise<void> {
        if (this.disposed || this.ops.length || this.inFlight) return
        await this.load()
    }

    /** Sends unconfirmed edits now. Resolves once this round is done. */
    async flush(): Promise<void> {
        clearTimeout(this.saveTimer)
        this.saveTimer = undefined
        if (this.disposed || !this.ops.length) return
        if (this.inFlight) {
            await this.inFlight
            return this.flush()
        }
        if (!this.confirmed && !(await this.load())) {
            // The load retries itself; try saving again once it might have landed
            this.failures++
            this.schedule(this.backoff(this.failures))
            return
        }
        if (this.inFlight) return this.flush()
        if (!this.ops.length) return

        const count = this.ops.length
        const layout = this.local ?? this.replay(this.confirmed!.layout)
        const base = this.confirmed!.revision
        this.inFlightOps = count
        this.inFlight = (async () => {
            try {
                const saved = await this.options.transport.save(layout, base)
                if (this.disposed) return
                this.failures = 0
                this.conflicts = 0
                this.ops = this.ops.slice(count)
                this.confirmed = saved
                if (this.ops.length) this.local = this.replay(saved.layout)
                this.emit()
                this.options.onSaved?.(saved.revision)
            } catch (error) {
                if (this.disposed) return
                if (error instanceof NavLayoutConflict) {
                    this.adopt(error.server)
                    // Rebase and retry at once, unless the server keeps disagreeing
                    if (++this.conflicts <= MAX_CONFLICT_RETRIES) return
                }
                this.failures++
                if (this.failures === 1) this.options.onError(error, 'save')
            } finally {
                this.inFlight = null
                this.inFlightOps = 0
            }
        })()
        await this.inFlight
        if (this.ops.length && !this.saveTimer) {
            this.schedule(this.failures ? this.backoff(this.failures) : this.conflicts ? 0 : this.delayMs)
        }
    }

    /**
     * The page is going away (or to the background): send everything now.
     * Requests are sent with keepalive, so they outlive the page. When a save
     * is already on its way, newer edits go out on the assumption it lands.
     */
    flushNow() {
        if (this.disposed || !this.ops.length || !this.confirmed) return
        if (!this.inFlight) {
            void this.flush()
            return
        }
        if (this.ops.length > this.inFlightOps && this.local) {
            this.options.transport.save(this.local, this.confirmed.revision + 1).catch(() => {})
        }
    }

    /** Drops every edit and goes back to the default layout */
    async reset(): Promise<void> {
        if (this.disposed) return
        clearTimeout(this.saveTimer)
        this.saveTimer = undefined
        this.ops = []
        this.local = null
        await this.inFlight?.catch(() => {})
        if (this.confirmed) this.confirmed = { layout: null, revision: this.confirmed.revision }
        this.emit()
        try {
            const snapshot = await this.options.transport.reset()
            if (this.disposed) return
            this.adopt(snapshot)
        } catch (error) {
            if (this.disposed) return
            this.options.onError(error, 'reset')
            await this.load()
        }
    }

    /** Stops all work, e.g. when the player signs out or switches account */
    dispose() {
        this.disposed = true
        clearTimeout(this.saveTimer)
        clearTimeout(this.loadTimer)
        this.ops = []
        this.local = null
    }
}
