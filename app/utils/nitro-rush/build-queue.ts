export interface BuildJob {
    /** Urgent jobs (a card on screen) jump the queue. */
    urgent(): boolean
    run(): unknown
}

/** Calls back once the browser has a moment, returning a cancel. */
export type Defer = (cb: () => void) => () => void

/** Safari has no requestIdleCallback, and the timeout keeps a busy race behind the menu from starving the queue. */
export const deferIdle: Defer = (cb) => {
    if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(cb, { timeout: 120 })
        return () => cancelIdleCallback(id)
    }
    const id = setTimeout(cb, 16)
    return () => clearTimeout(id)
}

/** Runs one job per idle moment, waiting for each to settle, so a list of heavy builds never holds the main thread in one go. */
export class BuildQueue {
    private readonly pending: BuildJob[] = []
    private cancel: (() => void) | null = null
    private busy = false
    private stopped = false

    /** While `paused` holds (a lost GL context), jobs wait instead of running. */
    constructor(private readonly paused: () => boolean = () => false, private readonly defer: Defer = deferIdle) {}

    get size() {
        return this.pending.length
    }

    add(job: BuildJob) {
        if (this.stopped) return
        this.pending.push(job)
        this.pump()
    }

    /** Drops every job still waiting; one already running finishes, so it must check for itself whether it is still wanted. */
    stop() {
        this.stopped = true
        this.pending.length = 0
        this.cancel?.()
        this.cancel = null
    }

    private pump() {
        if (this.stopped || this.busy || this.cancel || !this.pending.length) return
        this.cancel = this.defer(() => {
            this.cancel = null
            if (this.stopped) return
            if (this.paused()) return this.pump()
            void this.runNext()
        })
    }

    private async runNext() {
        const i = Math.max(0, this.pending.findIndex(j => j.urgent()))
        const [job] = this.pending.splice(i, 1)
        if (!job) return
        this.busy = true
        try {
            await job.run()
        } catch (e) {
            console.error(e)
        }
        this.busy = false
        this.pump()
    }
}
