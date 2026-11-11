/** A plain A*, knowing nothing of roads: the cheapest run of labelled steps from one state to another. */

export interface PathStep<S, L> {
    to: S
    cost: number
    label: L
}

export interface PathSearch<S, L> {
    key: (s: S) => string | number
    steps: (s: S) => PathStep<S, L>[]
    done: (s: S) => boolean
    estimate: (s: S) => number
    /** How many states to open before giving up. */
    limit: number
    /** States left to open over several searches; each one opened here comes off it. */
    budget?: { left: number }
}

interface PathNode<S, L> {
    state: S
    cost: number
    score: number
    from: PathNode<S, L> | null
    label: L | null
}

function push<S, L>(heap: PathNode<S, L>[], node: PathNode<S, L>) {
    let i = heap.push(node) - 1
    while (i > 0) {
        const up = (i - 1) >> 1
        if (heap[up]!.score <= node.score) break
        heap[i] = heap[up]!
        i = up
    }
    heap[i] = node
}

function pop<S, L>(heap: PathNode<S, L>[]) {
    const top = heap[0]!
    const last = heap.pop()!
    if (!heap.length) return top
    let i = 0
    for (;;) {
        let child = 2 * i + 1
        if (child >= heap.length) break
        if (child + 1 < heap.length && heap[child + 1]!.score < heap[child]!.score) child++
        if (heap[child]!.score >= last.score) break
        heap[i] = heap[child]!
        i = child
    }
    heap[i] = last
    return top
}

/** The steps and what they cost, or null if none get there within the search's limit. */
export function cheapestPath<S, L>(start: S, { key, steps, done, estimate, limit, budget }: PathSearch<S, L>): { labels: L[], cost: number } | null {
    const best = new Map<string | number, number>([[key(start), 0]])
    const heap: PathNode<S, L>[] = [{ state: start, cost: 0, score: estimate(start), from: null, label: null }]
    let opened = 0
    while (heap.length) {
        const node = pop(heap)
        if (node.cost > best.get(key(node.state))!) continue
        if (done(node.state)) {
            const labels: L[] = []
            for (let n: PathNode<S, L> | null = node; n?.from; n = n.from) labels.push(n.label!)
            return { labels: labels.reverse(), cost: node.cost }
        }
        if (++opened > limit || (budget && --budget.left < 0)) return null
        for (const { to, cost, label } of steps(node.state)) {
            const total = node.cost + cost
            const k = key(to)
            if (total >= (best.get(k) ?? Infinity)) continue
            best.set(k, total)
            push(heap, { state: to, cost: total, score: total + estimate(to), from: node, label })
        }
    }
    return null
}
