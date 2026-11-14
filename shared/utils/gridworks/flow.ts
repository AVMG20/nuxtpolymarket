// Gridworks: the steady-state flow solver. It runs the layout as a small fluid
// simulation (items as fractional amounts, half-second virtual ticks) until the
// rates settle, then reports what reaches storage and the labs per second. The
// economy only ever uses those rates multiplied by elapsed time, so nothing has
// to keep running while a player is away.
import { AMP_BONUS, BELT_MK, BUILDINGS, ITEM_IDS, MACHINE_MK, RECIPES, LAB_RATE, type ItemId, type Stock } from './defs'
import { buildGraph, key3, recipeOf, type Entity, type Graph } from './layout'
import { oreAt, type OreMap } from './world'

const NI = ITEM_IDS.length
const IDX = Object.fromEntries(ITEM_IDS.map((id, i) => [id, i])) as Record<ItemId, number>
const DT = 0.5
const WINDOW = 120
const MIN_WINDOWS = 3
const MAX_TICKS = 4800
const LOGISTICS_RATE = 8

export interface SolveFlags {
    /** Items storage no longer takes (full). */
    blocked: readonly ItemId[]
    /** Items the labs take (the active research still needs them). */
    labWants: readonly ItemId[]
}

export interface Solution {
    /** Items per second into storage and into labs. */
    store: Stock
    lab: Stock
    /** Items per second through each entity, and the item it carries most. */
    flow: Float32Array
    carry: Int8Array
    /** 0..1 how busy each machine or source is. */
    busy: Float32Array
    /** Per-entity, per-item inflow rates (entity × item), for belt visuals. */
    mix: Float32Array
    ticks: number
}

const enum T { Belt, Logi, Source, Machine, Storage, Lab, None }

interface Node {
    t: T
    role: string
    /** Items this node can ever hold (indices). */
    items: number[]
    cap: number
    rate: number
    speed: number
    /** Machines. */
    recipe?: { out: number, outQty: number, time: number, need: [number, number][] }
    /** Sources. */
    ore: number
    filter: number
}

function amplifiers(entities: readonly Entity[], graph: Graph): Float32Array {
    const bonus = new Float32Array(entities.length)
    entities.forEach((e) => {
        if (e.k !== 'amplifier') return
        const touched = new Set<number>()
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const j = graph.occ.get(key3(e.x + dx, e.y + dy, 0))
            if (j !== undefined) touched.add(j)
        }
        for (const j of touched) {
            const role = BUILDINGS[entities[j]!.k].role
            if (role === 'machine' || role === 'source') bonus[j]! += AMP_BONUS
        }
    })
    return bonus
}

function nodesOf(entities: readonly Entity[], graph: Graph, ore: OreMap): Node[] {
    const amp = amplifiers(entities, graph)
    return entities.map((e, i) => {
        const def = BUILDINGS[e.k]
        const mk = Math.max(1, e.mk ?? 1)
        const node: Node = { t: T.None, role: def.role, items: [], cap: 0, rate: 0, speed: 1, ore: -1, filter: e.filter ? IDX[e.filter] : -1 }
        switch (def.role) {
            case 'belt': {
                node.t = T.Belt
                node.rate = BELT_MK[Math.min(mk, BELT_MK.length) - 1]!.rate
                node.cap = Math.max(2, node.rate * DT * 2)
                break
            }
            case 'ramp': case 'merger': case 'splitter': case 'smart': case 'overflow':
                node.t = T.Logi
                node.rate = LOGISTICS_RATE
                node.cap = LOGISTICS_RATE * DT * 2
                break
            case 'source': {
                node.t = T.Source
                const o = oreAt(ore, e.x, e.y)
                node.ore = o && def.ore?.includes(o) ? IDX[o] : -1
                node.speed = (MACHINE_MK[mk - 1] ?? 1) * (1 + amp[i]!)
                node.rate = (def.rate ?? 0) * node.speed
                node.cap = 2
                break
            }
            case 'machine': {
                node.t = T.Machine
                const rec = RECIPES[recipeOf(e) ?? '']
                if (rec) {
                    node.recipe = {
                        out: IDX[rec.out],
                        outQty: rec.outQty,
                        time: rec.time,
                        need: (Object.entries(rec.inputs) as [ItemId, number][]).map(([k, v]) => [IDX[k], v])
                    }
                    node.cap = rec.outQty * 3
                }
                node.speed = (MACHINE_MK[mk - 1] ?? 1) * (1 + amp[i]!)
                break
            }
            case 'sink':
                node.t = e.k === 'lab' ? T.Lab : T.Storage
                break
        }
        return node
    })
}

/** Which items can reach each node, so the tick loop only touches those. */
function propagate(nodes: Node[], graph: Graph) {
    const sets = nodes.map(() => new Set<number>())
    const queue: number[] = []
    nodes.forEach((n, i) => {
        if (n.t === T.Source && n.ore >= 0) { sets[i]!.add(n.ore); queue.push(i) }
        if (n.t === T.Machine && n.recipe) { sets[i]!.add(n.recipe.out); queue.push(i) }
    })
    while (queue.length) {
        const i = queue.pop()!
        const n = nodes[i]!
        graph.out[i]!.forEach((link, pi) => {
            if (!link) return
            const tn = nodes[link.to]!
            if (tn.t === T.Machine || tn.t === T.Storage || tn.t === T.Lab || tn.t === T.Source) {
                // Machines keep their inputs apart from their output buffer.
                return
            }
            const set = sets[link.to]!
            let grew = false
            for (const it of sets[i]!) {
                if (n.role === 'smart' && n.filter >= 0) {
                    if (pi === 0 && it === n.filter) continue
                    if (pi === 1 && it !== n.filter) continue
                }
                if (!set.has(it)) { set.add(it); grew = true }
            }
            if (grew) queue.push(link.to)
        })
    }
    nodes.forEach((n, i) => { n.items = [...sets[i]!] })
}

export function solve(entities: readonly Entity[], ore: OreMap, flags: SolveFlags): Solution {
    const graph = buildGraph(entities)
    const nodes = nodesOf(entities, graph, ore)
    propagate(nodes, graph)
    const n = nodes.length
    const buf = new Float64Array(n * NI)
    const inb = new Float64Array(n * NI)
    const total = new Float64Array(n)
    const blocked = new Uint8Array(NI)
    for (const id of flags.blocked) blocked[IDX[id]] = 1
    const wants = new Uint8Array(NI)
    for (const id of flags.labWants) wants[IDX[id]] = 1

    // Measurement accumulators for the current window.
    const store = new Float64Array(NI)
    const lab = new Float64Array(NI)
    const mix = new Float64Array(n * NI)
    const crafted = new Float64Array(n)
    let prevStore: Float64Array | null = null
    let prevLab: Float64Array | null = null

    // Per-tick scratch.
    const room = new Float64Array(n)
    const offers: { from: number, to: number, amt: Float64Array, sum: number }[] = []
    const incoming: number[][] = nodes.map(() => [])

    const accepts = (to: number, it: number): boolean => {
        const tn = nodes[to]!
        switch (tn.t) {
            case T.Belt: case T.Logi: return true
            case T.Machine: return !!tn.recipe?.need.some(([k]) => k === it)
            case T.Storage: return !blocked[it]
            case T.Lab: return !!wants[it]
            default: return false
        }
    }
    const machineRoom = (j: number, it: number): number => {
        const need = nodes[j]!.recipe?.need.find(([k]) => k === it)
        return need ? Math.max(0, need[1] * 3 - inb[j * NI + it]!) : 0
    }
    const labCount = nodes.filter(nd => nd.t === T.Lab).length

    let ticks = 0
    let windowTicks = 0
    let windows = 0
    let result: Solution | null = null
    while (ticks < MAX_TICKS) {
        ticks++
        windowTicks++

        // 1. Produce and craft.
        for (let i = 0; i < n; i++) {
            const nd = nodes[i]!
            if (nd.t === T.Source && nd.ore >= 0) {
                const add = Math.min(nd.rate * DT, nd.cap - total[i]!)
                if (add > 0) { buf[i * NI + nd.ore]! += add; total[i]! += add; crafted[i]! += add }
            } else if (nd.t === T.Machine && nd.recipe) {
                const r = nd.recipe
                let c = nd.speed * DT / r.time
                for (const [k, q] of r.need) c = Math.min(c, inb[i * NI + k]! / q)
                c = Math.min(c, (nd.cap - total[i]!) / r.outQty)
                if (c > 1e-12) {
                    for (const [k, q] of r.need) inb[i * NI + k]! -= c * q
                    buf[i * NI + r.out]! += c * r.outQty
                    total[i]! += c * r.outQty
                    crafted[i]! += c
                }
            }
        }

        // 2. Room each receiver has this tick (start-of-tick view).
        for (let j = 0; j < n; j++) {
            const nd = nodes[j]!
            if (nd.t === T.Belt || nd.t === T.Logi) room[j] = Math.max(0, Math.min(nd.rate * DT, nd.cap - total[j]!))
            else if (nd.t === T.Lab) room[j] = LAB_RATE * DT
            else if (nd.t === T.Storage) room[j] = 1e9
            else if (nd.t === T.Machine) {
                let s = 0
                for (const [k] of nd.recipe?.need ?? []) s += machineRoom(j, k)
                room[j] = s
            } else room[j] = 0
            incoming[j]!.length = 0
        }

        // 3. Offers.
        offers.length = 0
        for (let i = 0; i < n; i++) {
            const nd = nodes[i]!
            if (total[i]! <= 1e-9) continue
            const links = graph.out[i]!
            if (!links.some(Boolean)) continue
            const send = nd.t === T.Belt || nd.t === T.Logi ? Math.min(total[i]!, nd.rate * DT) : total[i]!
            const scale = send / total[i]!
            const items = nd.items
            const offer = (port: number, share: number, only?: (it: number) => boolean) => {
                const link = links[port]
                if (!link || share <= 0) return
                const amt = new Float64Array(NI)
                let sum = 0
                for (const it of items) {
                    const have = buf[i * NI + it]!
                    if (have <= 0 || (only && !only(it)) || !accepts(link.to, it)) continue
                    const a = have * scale * share
                    amt[it] = a
                    sum += a
                }
                if (sum > 1e-12) {
                    offers.push({ from: i, to: link.to, amt, sum })
                    incoming[link.to]!.push(offers.length - 1)
                }
            }
            if (nd.role === 'splitter') {
                // Water-fill the send across the outputs that have room.
                const outs = [0, 1, 2].filter(p => links[p])
                const shares = waterFill(outs.map(p => room[links[p]!.to]!), send)
                outs.forEach((p, k) => offer(p, send > 0 ? shares[k]! / send : 0))
            } else if (nd.role === 'smart') {
                const f = nd.filter
                offer(0, 1, it => it !== f)
                offer(1, 1, it => it === f)
            } else if (nd.role === 'overflow') {
                const front = links[0] ? Math.min(send, room[links[0].to]!) : 0
                offer(0, send > 0 ? front / send : 0)
                offer(1, send > 0 ? (send - front) / send : 0)
            } else {
                offer(0, 1)
            }
        }

        // 4. Accept and move.
        for (let j = 0; j < n; j++) {
            const list = incoming[j]!
            if (!list.length) continue
            const nd = nodes[j]!
            if (nd.t === T.Machine) {
                for (const [k] of nd.recipe?.need ?? []) {
                    const want = list.map(o => offers[o]!.amt[k]!)
                    const got = waterFill(want, machineRoom(j, k))
                    list.forEach((o, x) => {
                        const g = got[x]!
                        if (g <= 0) return
                        const of = offers[o]!
                        buf[of.from * NI + k]! -= g
                        total[of.from]! -= g
                        inb[j * NI + k]! += g
                        mix[j * NI + k]! += g
                    })
                }
                continue
            }
            const got = waterFill(list.map(o => offers[o]!.sum), room[j]!)
            list.forEach((o, x) => {
                const of = offers[o]!
                const frac = Math.min(1, got[x]! / of.sum)
                if (frac <= 0) return
                for (let it = 0; it < NI; it++) {
                    const a = of.amt[it]! * frac
                    if (a <= 0) continue
                    buf[of.from * NI + it]! -= a
                    total[of.from]! -= a
                    mix[j * NI + it]! += a
                    if (nd.t === T.Storage) store[it]! += a
                    else if (nd.t === T.Lab) lab[it]! += a
                    else { buf[j * NI + it]! += a; total[j]! += a }
                }
            })
        }

        // 5. Window bookkeeping: stop once two windows agree.
        if (windowTicks < WINDOW) continue
        windows++
        const secs = windowTicks * DT
        const curStore = store.map(v => v / secs)
        const curLab = lab.map(v => v / secs)
        const stable = !!prevStore && !!prevLab && close(prevStore, curStore) && close(prevLab, curLab)
        if ((stable && windows >= MIN_WINDOWS) || ticks + WINDOW > MAX_TICKS) {
            result = finish(curStore, curLab, mix, crafted, nodes, secs, labCount, ticks)
            break
        }
        prevStore = curStore
        prevLab = curLab
        store.fill(0); lab.fill(0); mix.fill(0); crafted.fill(0)
        windowTicks = 0
    }
    return result ?? finish(new Float64Array(NI), new Float64Array(NI), mix, crafted, nodes, 1, labCount, ticks)
}

function close(a: Float64Array, b: Float64Array): boolean {
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i]! - b[i]!)
        if (d > 0.002 + 0.01 * Math.max(a[i]!, b[i]!)) return false
    }
    return true
}

function finish(store: Float64Array, lab: Float64Array, mix: Float64Array, crafted: Float64Array, nodes: Node[], secs: number, _labs: number, ticks: number): Solution {
    const toStock = (arr: Float64Array): Stock => {
        const s: Stock = {}
        arr.forEach((v, i) => { if (v > 1e-4) s[ITEM_IDS[i]!] = round(v) })
        return s
    }
    const n = nodes.length
    const flow = new Float32Array(n)
    const carry = new Int8Array(n).fill(-1)
    const busy = new Float32Array(n)
    const mixRate = new Float32Array(n * NI)
    for (let j = 0; j < n; j++) {
        let best = 0
        for (let it = 0; it < NI; it++) {
            const v = mix[j * NI + it]! / secs
            mixRate[j * NI + it] = v
            flow[j]! += v
            if (v > best) { best = v; carry[j] = it }
        }
        const nd = nodes[j]!
        if (nd.t === T.Machine && nd.recipe) busy[j] = Math.min(1, crafted[j]! / secs / (nd.speed / nd.recipe.time))
        else if (nd.t === T.Source && nd.rate > 0) busy[j] = Math.min(1, crafted[j]! / secs / nd.rate)
        if (nd.t === T.Source || nd.t === T.Machine) {
            // Sources and machines show what they put out.
            const out = nd.t === T.Source ? nd.ore : nd.recipe!.out
            if (out >= 0) carry[j] = out
        }
    }
    return { store: toStock(store), lab: toStock(lab), flow, carry, busy, mix: mixRate, ticks }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4

/** Splits `budget` across demands so nobody gets more than they asked and the rest share evenly. */
export function waterFill(want: readonly number[], budget: number): number[] {
    const got = want.map(() => 0)
    let left = budget
    let open = want.map((_, i) => i).filter(i => want[i]! > 0)
    while (open.length && left > 1e-12) {
        const each = left / open.length
        const next: number[] = []
        for (const i of open) {
            const give = Math.min(each, want[i]! - got[i]!)
            got[i]! += give
            left -= give
            if (want[i]! - got[i]! > 1e-12) next.push(i)
        }
        if (next.length === open.length) break
        open = next
    }
    return got
}
