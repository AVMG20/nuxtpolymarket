import { ITEM_IDS, RESEARCH_BY_ID, type ItemId, type Stock } from '#shared/utils/gridworks/defs'
import { applyOp, flagsOf, storageCap, type GridState, type Op, type OpError, type SettleEvent } from '#shared/utils/gridworks/game'
import { solve, type Solution, type SolveFlags } from '#shared/utils/gridworks/flow'
import type { Entity } from '#shared/utils/gridworks/layout'
import { oreMap } from '#shared/utils/gridworks/world'
import type { WorldPlot } from '~/utils/gridworks/engine'

interface StateResponse { state: GridState, userId: string, now: number }
interface OpsResponse { state: GridState, errors: (OpError | null)[], events: SettleEvent[], now: number }

const FLUSH_MS = 90
const MAX_BATCH = 400
/** Browsers refuse keepalive requests whose bodies add up to more than 64 KB. */
const KEEPALIVE_BYTES = 60_000

interface SolveJob { id: number, key: string, seed: number, entities: Entity[], flags: SolveFlags }

/**
 * Gridworks client state. The server owns the plot; this keeps a prediction on
 * top of it (server state + ops not yet confirmed) so every action shows up at
 * once, batches the ops to the server, and extrapolates the stock between
 * responses from the solver's rates.
 */
export function useGridworks() {
    const toast = useToast()
    const me = ref('')
    const loading = ref(true)
    const view = shallowRef<GridState | null>(null)
    const sol = shallowRef<Solution | null>(null)
    const stock = ref<Stock>({})
    const progress = ref<Stock>({})
    const cap = ref(0)
    const world = shallowRef<WorldPlot[]>([])
    const lastResearch = ref<{ id: string, at: number } | null>(null)

    let server: GridState | null = null
    let offset = 0
    const pending: Op[] = []
    let inflight = 0
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    /** Bumped whenever a POST answers; a GET that started before it is stale. */
    let postSeq = 0
    let solEntities: Entity[] = []
    /** Key of the last solve asked for, and of the one `sol` holds. */
    let solKey = ''
    let solvedKey = ''
    let solveId = 0
    let running: SolveJob | null = null
    let queued: SolveJob | null = null
    let worker: Worker | null = null
    let ws: WebSocket | null = null
    let wsRetry = 0
    let wsTimer: ReturnType<typeof setTimeout> | null = null
    let wsOpened = false
    let disposed = false
    const timers: ReturnType<typeof setInterval>[] = []
    let refreshQueued = false

    const listeners = {
        view: [] as ((v: GridState, animate: boolean) => void)[],
        sol: [] as ((s: Solution, entities: Entity[]) => void)[],
        world: [] as ((plots: WorldPlot[]) => void)[],
        research: [] as ((id: string) => void)[]
    }

    const now = () => Date.now() + offset

    function clone(s: GridState): GridState {
        return {
            ...s,
            entities: s.entities.map(e => ({ ...e })),
            chunks: [...s.chunks],
            stock: { ...s.stock },
            done: [...s.done],
            queue: [...s.queue],
            progress: Object.fromEntries(Object.entries(s.progress).map(([k, v]) => [k, { ...v }])),
            mine: { ...s.mine }
        }
    }

    /** Moves a state's stock and research forward to `t` at the current rates. */
    function extrapolate(s: GridState, t: number) {
        const rates = sol.value
        const dt = Math.max(0, (t - s.settledAt) / 1000)
        s.settledAt = t
        if (!rates || !dt) return
        const c = storageCap(s)
        for (const [k, r] of Object.entries(rates.store) as [ItemId, number][]) {
            const cur = s.stock[k] ?? 0
            if (cur < c) s.stock[k] = Math.min(c, cur + r * dt)
        }
        const active = s.queue[0]
        if (active) {
            const node = RESEARCH_BY_ID[active]
            const prog = s.progress[active] ??= {}
            let complete = !!node
            for (const [k, total] of Object.entries(node?.cost ?? {}) as [ItemId, number][]) {
                prog[k] = Math.min(total, (prog[k] ?? 0) + (rates.lab[k] ?? 0) * dt)
                if (prog[k]! < total - 1e-6) complete = false
            }
            // The server finishes research during its settle; ask for it.
            if (complete) queueRefresh(400)
        }
    }

    function publish(v: GridState, animate = true) {
        view.value = v
        stock.value = { ...v.stock }
        progress.value = v.queue[0] ? { ...(v.progress[v.queue[0]] ?? {}) } : {}
        cap.value = storageCap(v)
        for (const fn of listeners.view) fn(v, animate)
        requestSolve(v)
    }

    /**
     * The solution a goal claim is judged on. The worker's answer may still be
     * for the layout before the last change, which the server would not agree
     * with, so a stale one is replaced by a solve on the spot.
     */
    function goalSol(v: GridState): Solution {
        const flags = flagsOf(v)
        if (sol.value && solvedKey === solveKey(v, flags)) return sol.value
        return solve(v.entities, oreMap(v.seed), flags)
    }

    function predict(v: GridState, op: Op): OpError | null {
        return applyOp(v, op, now(), op.op === 'goal' ? goalSol(v) : sol.value)
    }

    function rebuild(animate = true) {
        if (!server) return
        const v = clone(server)
        extrapolate(v, now())
        for (const op of pending) predict(v, op)
        publish(v, animate)
    }

    /** Predict ops locally; good ones queue for the server. Returns each op's error. */
    function commit(ops: Op[]): (OpError | null)[] {
        const cur = view.value
        if (!cur) return ops.map(() => 'invalid' as const)
        const trial = clone(cur)
        extrapolate(trial, now())
        const errs = ops.map(op => predict(trial, op))
        const ok = ops.filter((_, i) => !errs[i])
        if (ok.length) {
            pending.push(...ok)
            publish(trial)
            scheduleFlush()
        }
        return errs
    }

    function scheduleFlush() {
        if (flushTimer) return
        flushTimer = setTimeout(() => {
            flushTimer = null
            void flush()
        }, FLUSH_MS)
    }

    /** Folds runs of hand-mining clicks on one tile into one op. */
    function compact(ops: Op[]): Op[] {
        const out: Op[] = []
        for (const op of ops) {
            const last = out[out.length - 1]
            if (op.op === 'mine' && last?.op === 'mine' && last.x === op.x && last.y === op.y && last.n + op.n <= 100) {
                out[out.length - 1] = { ...last, n: last.n + op.n }
            } else out.push(op)
        }
        return out
    }

    /** The request for a batch. Small ones are sent keepalive so they outlive the page. */
    function opsRequest(batch: Op[]) {
        const body = { ops: compact(batch) }
        return { method: 'POST' as const, body, keepalive: JSON.stringify(body).length < KEEPALIVE_BYTES }
    }

    async function flush() {
        if (inflight || !pending.length || disposed) return
        const batch = pending.slice(0, MAX_BATCH)
        inflight = batch.length
        try {
            const res = await apiFetch<OpsResponse>('/api/gridworks/ops', opsRequest(batch))
            postSeq++
            pending.splice(0, batch.length)
            if (disposed) return
            offset = res.now - Date.now()
            server = res.state
            // Hand mining that hit the bucket or a full storage isn't worth a warning.
            const rejected = res.errors.filter(e => e && e !== 'busy' && e !== 'full').length
            if (rejected) toast.add({ title: 'Some changes didn\'t go through', description: 'The factory was out of sync and has been reloaded.', color: 'warning' })
            handleEvents(res.events)
            rebuild(false)
        } catch (e) {
            postSeq++
            pending.splice(0, batch.length)
            if (disposed) return
            toast.add({ title: 'Couldn\'t save', description: apiErrorMessage(e, 'Your last changes were undone.'), color: 'error' })
            await refresh()
        } finally {
            inflight = 0
            if (pending.length && !disposed) scheduleFlush()
        }
    }

    /**
     * Sends everything not yet on its way in requests that outlive the page.
     * The batch in flight stays where it is: it reaches the plot lock first.
     */
    function drain() {
        const rest = pending.splice(inflight)
        for (let i = 0; i < rest.length; i += MAX_BATCH) {
            void $fetch('/api/gridworks/ops', opsRequest(rest.slice(i, i + MAX_BATCH))).catch(() => {})
        }
        return rest.length
    }

    function onPageHide() {
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        // If the page comes back (bfcache), pick up what the server made of it.
        if (drain() && !disposed) queueRefresh(0)
    }

    function onVisibility() {
        if (document.visibilityState !== 'hidden' || !pending.length) return
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        void flush()
    }

    function handleEvents(events: SettleEvent[]) {
        for (const ev of events) {
            if (ev.kind === 'research') {
                lastResearch.value = { id: ev.id, at: Date.now() }
                for (const fn of listeners.research) fn(ev.id)
            }
        }
    }

    function queueRefresh(ms: number) {
        if (refreshQueued) return
        refreshQueued = true
        setTimeout(() => {
            refreshQueued = false
            void refresh()
        }, ms)
    }

    async function refresh() {
        if (disposed) return
        if (inflight || pending.length) return queueRefresh(500)
        const seq = postSeq
        try {
            const res = await apiFetch<StateResponse>('/api/gridworks/state')
            if (disposed) return
            me.value = res.userId
            // A save answered (or is on its way) since this was asked: its state is newer.
            if (seq !== postSeq || inflight) return queueRefresh(300)
            offset = res.now - Date.now()
            const before = server
            server = res.state
            // Research that finished while we watched.
            if (before) {
                for (const id of res.state.done) if (!before.done.includes(id)) handleEvents([{ t: res.now, kind: 'research', id }])
            }
            rebuild(!!before)
        } catch (e) {
            toast.add({ title: 'Couldn\'t load your factory', description: apiErrorMessage(e, 'Try again in a moment.'), color: 'error' })
        } finally {
            loading.value = false
        }
    }

    async function loadWorld() {
        try {
            const res = await apiFetch<{ plots: WorldPlot[] }>('/api/gridworks/world')
            world.value = res.plots
            for (const fn of listeners.world) fn(res.plots)
        } catch { /* the neighbours can wait for the next update */ }
    }

    // ---- solver worker ----------------------------------------------------------

    const jsonCache = new WeakMap<Entity[], string>()

    function solveKey(v: GridState, flags: SolveFlags): string {
        let json = jsonCache.get(v.entities)
        if (json === undefined) {
            json = JSON.stringify(v.entities)
            jsonCache.set(v.entities, json)
        }
        return `${v.seed}|${json}|${flags.blocked.join(',')}|${flags.labWants.join(',')}`
    }

    /** One solve runs at a time; while it does, only the newest request waits. */
    function requestSolve(v: GridState) {
        if (disposed) return
        const flags = flagsOf(v)
        const key = solveKey(v, flags)
        if (key === solKey) return
        solKey = key
        const job: SolveJob = { id: ++solveId, key, seed: v.seed, entities: v.entities.map(e => ({ ...e })), flags }
        if (running) queued = job
        else postSolve(job)
    }

    function postSolve(job: SolveJob) {
        running = job
        try {
            if (!worker) {
                worker = new Worker(new URL('../utils/gridworks/solver.worker.ts', import.meta.url), { type: 'module' })
                worker.onmessage = (ev: MessageEvent<{ id: number, sol?: Solution, error?: string }>) => solved(ev.data)
                worker.onerror = (ev) => {
                    ev.preventDefault()
                    // The worker itself broke: start a new one for the next request.
                    worker?.terminate()
                    worker = null
                    if (running) solved({ id: running.id, error: ev.message || 'solver crashed' })
                }
            }
            worker.postMessage({ id: job.id, seed: job.seed, entities: job.entities, flags: job.flags })
        } catch (e) {
            solved({ id: job.id, error: String(e) })
        }
    }

    function solved(data: { id: number, sol?: Solution, error?: string }) {
        const job = running
        if (!job || data.id !== job.id) return
        running = null
        if (data.sol) {
            solEntities = job.entities
            solvedKey = job.key
            sol.value = data.sol
            for (const fn of listeners.sol) fn(data.sol, solEntities)
        } else {
            // Keep the rates on screen; the next layout change asks again.
            console.error('[gridworks] solve failed:', data.error)
        }
        const next = queued
        queued = null
        if (next && !disposed) postSolve(next)
    }

    // ---- live channel -----------------------------------------------------------

    function connect() {
        if (disposed) return
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        ws = new WebSocket(`${proto}://${location.host}/api/gridworks/ws`)
        ws.onopen = () => {
            wsRetry = 0
            // Whatever changed while the channel was down went unheard.
            if (wsOpened) {
                void loadWorld()
                queueRefresh(0)
            }
            wsOpened = true
        }
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(String(ev.data)) as { type: string, userId: string, layout: number }
                if (msg.type !== 'plot') return
                if (msg.userId === me.value) {
                    // Another tab of ours changed the plot.
                    if (!inflight && !pending.length && server && msg.layout !== server.layout) queueRefresh(300)
                    return
                }
                worldDebounced()
            } catch { /* not ours */ }
        }
        ws.onclose = (ev) => {
            ws = null
            if (disposed || ev.code === 4401 || ev.code === 4429) return
            wsRetry = Math.min(wsRetry + 1, 6)
            wsTimer = setTimeout(connect, 1000 * 2 ** wsRetry)
        }
    }
    let worldTimer: ReturnType<typeof setTimeout> | null = null
    function worldDebounced() {
        if (worldTimer) return
        worldTimer = setTimeout(() => {
            worldTimer = null
            void loadWorld()
        }, 1200)
    }

    // ---- HUD tick ---------------------------------------------------------------

    function tick() {
        const v = view.value
        if (!v) return
        extrapolate(v, now())
        const shown: Stock = {}
        for (const id of ITEM_IDS) if (v.stock[id]) shown[id] = v.stock[id]
        stock.value = shown
        progress.value = v.queue[0] ? { ...(v.progress[v.queue[0]] ?? {}) } : {}
        // Storage filling up changes the flow; re-solve when it does.
        requestSolve(v)
    }

    async function start() {
        await refresh()
        if (disposed) return
        window.addEventListener('pagehide', onPageHide)
        document.addEventListener('visibilitychange', onVisibility)
        void loadWorld()
        connect()
        timers.push(setInterval(tick, 200))
        timers.push(setInterval(() => queueRefresh(0), 60_000))
    }

    function stop() {
        disposed = true
        for (const t of timers) clearInterval(t)
        if (flushTimer) clearTimeout(flushTimer)
        if (worldTimer) clearTimeout(worldTimer)
        if (wsTimer) clearTimeout(wsTimer)
        window.removeEventListener('pagehide', onPageHide)
        document.removeEventListener('visibilitychange', onVisibility)
        worker?.terminate()
        worker = null
        running = queued = null
        ws?.close()
        // Last ops still go out, also behind a batch that is in flight.
        drain()
    }

    return {
        me, loading, view, sol, stock, progress, cap, world, lastResearch,
        commit, refresh, start, stop,
        currentStock: () => {
            const v = view.value
            if (!v) return {}
            extrapolate(v, now())
            return v.stock
        },
        onView: (fn: (v: GridState, animate: boolean) => void) => listeners.view.push(fn),
        onSolution: (fn: (s: Solution, entities: Entity[]) => void) => listeners.sol.push(fn),
        onWorld: (fn: (plots: WorldPlot[]) => void) => listeners.world.push(fn),
        onResearch: (fn: (id: string) => void) => listeners.research.push(fn),
        solEntities: () => solEntities
    }
}
