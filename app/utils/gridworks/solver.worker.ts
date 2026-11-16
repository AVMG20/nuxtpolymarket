// Runs the flow solver off the main thread so placing never hitches a frame.
import { solve, type SolveFlags } from '#shared/utils/gridworks/flow'
import type { Entity } from '#shared/utils/gridworks/layout'
import { oreMap } from '#shared/utils/gridworks/world'

export interface SolveRequest { id: number, seed: number, entities: Entity[], flags: SolveFlags }

self.onmessage = (ev: MessageEvent<SolveRequest>) => {
    const { id, seed, entities, flags } = ev.data
    const port = self as unknown as Worker
    try {
        const sol = solve(entities, oreMap(seed), flags)
        port.postMessage({ id, sol }, [sol.flow.buffer, sol.carry.buffer, sol.busy.buffer, sol.mix.buffer])
    } catch (e) {
        // Answer anyway, or the page waits on this request forever.
        port.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
    }
}
