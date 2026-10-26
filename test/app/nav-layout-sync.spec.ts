import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavLayoutConflict, NavLayoutSync, type NavLayoutSnapshot, type NavLayoutTransport } from '../../app/utils/nav-layout-sync'
import { moveNavEntry, removeNavLink, type NavLayout } from '#shared/utils/nav-layout'

const base: NavLayout = { version: 2, root: ['/a', '/b'], folders: {}, platformCollapsed: false }

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function setup(initial: NavLayoutSnapshot | null = { layout: base, revision: 1 }) {
    const saves: { layout: NavLayout, revision: number }[] = []
    const transport: NavLayoutTransport = {
        load: vi.fn(async () => ({ layout: base, revision: 1 })),
        save: vi.fn(async (layout: NavLayout, revision: number) => {
            saves.push({ layout, revision })
            return { layout, revision: revision + 1 }
        }),
        reset: vi.fn(async () => ({ layout: null, revision: 9 }))
    }
    const onError = vi.fn()
    const onSaved = vi.fn()
    const states: unknown[] = []
    const sync = new NavLayoutSync({
        transport,
        fallback: () => ({ version: 2, root: ['/default'], folders: {}, platformCollapsed: false }),
        onChange: state => states.push(state),
        onError,
        onSaved,
        delayMs: 100
    }, initial)
    return { sync, transport, saves, onError, onSaved, states }
}

const drop = (to: string) => (layout: NavLayout) => removeNavLink(layout, to)
const put = (to: string, index: number) => (layout: NavLayout) => moveNavEntry(layout, to, 'root', index)

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('nav layout sync', () => {
    it('shows an edit at once and debounces rapid edits into one save', async () => {
        const { sync, saves } = setup()
        sync.apply(drop('/a'))
        expect(sync.layout?.root).toEqual(['/b'])
        sync.apply(put('/c', 0))
        await vi.advanceTimersByTimeAsync(100)
        expect(saves).toEqual([{ layout: { ...base, root: ['/c', '/b'] }, revision: 1 }])
        expect(sync.pending).toBe(false)
        expect(sync.revision).toBe(2)
    })

    it('ignores edits that change nothing', () => {
        const { sync } = setup()
        expect(sync.apply(layout => layout)).toBe(false)
        expect(sync.pending).toBe(false)
    })

    it('keeps edits made during a save and sends them after it', async () => {
        const { sync, transport, saves } = setup()
        const first = deferred<NavLayoutSnapshot>()
        vi.mocked(transport.save).mockImplementationOnce(async (layout, revision) => {
            saves.push({ layout, revision })
            return first.promise
        })
        sync.apply(drop('/a'))
        await vi.advanceTimersByTimeAsync(100)
        sync.apply(drop('/b'))
        await vi.advanceTimersByTimeAsync(100)
        expect(saves).toHaveLength(1)
        first.resolve({ layout: { ...base, root: ['/b'] }, revision: 2 })
        await vi.advanceTimersByTimeAsync(100)
        expect(saves[1]).toEqual({ layout: { ...base, root: [] }, revision: 2 })
        expect(sync.pending).toBe(false)
    })

    it('reports a failed save once, keeps the edit and retries with backoff', async () => {
        const { sync, transport, onError } = setup()
        vi.mocked(transport.save).mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'))
        sync.apply(drop('/a'))
        await vi.advanceTimersByTimeAsync(100)
        expect(onError).toHaveBeenCalledTimes(1)
        expect(sync.layout?.root).toEqual(['/b'])
        await vi.advanceTimersByTimeAsync(1000)
        expect(transport.save).toHaveBeenCalledTimes(2)
        expect(onError).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(2000)
        expect(transport.save).toHaveBeenCalledTimes(3)
        expect(sync.pending).toBe(false)
    })

    it('rebases unconfirmed edits on a conflict', async () => {
        const { sync, transport, saves } = setup()
        const server: NavLayout = { ...base, root: ['/x', '/a', '/b'] }
        vi.mocked(transport.save).mockRejectedValueOnce(new NavLayoutConflict({ layout: server, revision: 5 }))
        sync.apply(drop('/a'))
        await vi.advanceTimersByTimeAsync(100)
        expect(sync.layout?.root).toEqual(['/x', '/b'])
        await vi.advanceTimersByTimeAsync(1)
        expect(saves.at(-1)).toEqual({ layout: { ...base, root: ['/x', '/b'] }, revision: 5 })
        expect(sync.revision).toBe(6)
    })

    it('never saves before a load succeeded, then replays edits on the stored layout', async () => {
        const { sync, transport, saves } = setup(null)
        vi.mocked(transport.load).mockRejectedValueOnce(new Error('down'))
        sync.apply(drop('/default'))
        expect(sync.layout?.root).toEqual([])
        await vi.advanceTimersByTimeAsync(100)
        expect(saves).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(2000)
        expect(sync.loaded).toBe(true)
        await vi.advanceTimersByTimeAsync(2000)
        expect(saves).toEqual([{ layout: base, revision: 1 }])
    })

    it('flushes immediately on demand and speculatively while a save is in flight', async () => {
        const { sync, transport, saves } = setup()
        const first = deferred<NavLayoutSnapshot>()
        vi.mocked(transport.save).mockImplementationOnce(async (layout, revision) => {
            saves.push({ layout, revision })
            return first.promise
        })
        sync.apply(drop('/a'))
        sync.flushNow()
        await vi.advanceTimersByTimeAsync(0)
        expect(saves).toHaveLength(1)
        sync.apply(drop('/b'))
        sync.flushNow()
        expect(saves[1]).toEqual({ layout: { ...base, root: [] }, revision: 2 })
    })

    it('refreshes only when nothing is pending', async () => {
        const { sync, transport } = setup()
        sync.apply(drop('/a'))
        await sync.refresh()
        expect(transport.load).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(100)
        await sync.refresh()
        expect(transport.load).toHaveBeenCalledTimes(1)
    })

    it('reset drops pending edits and adopts the server state', async () => {
        const { sync, saves } = setup()
        sync.apply(drop('/a'))
        await sync.reset()
        await vi.advanceTimersByTimeAsync(1000)
        expect(saves).toHaveLength(0)
        expect(sync.layout).toBeNull()
        expect(sync.revision).toBe(9)
    })

    it('does nothing after dispose', async () => {
        const { sync, saves } = setup()
        sync.apply(drop('/a'))
        sync.dispose()
        await vi.advanceTimersByTimeAsync(1000)
        expect(saves).toHaveLength(0)
        expect(sync.apply(drop('/b'))).toBe(false)
    })
})
