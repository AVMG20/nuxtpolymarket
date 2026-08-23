import {
    BASE_REFINERY_LINES,
    MAX_TIER,
    RECIPES,
    RESEARCH,
    RESOURCES,
    salePrice,
    nodeCost
} from './config'
import { roomAt } from './assignment'
import { planLoadout } from './loadout'
import { bonusesFor, researchAvailable } from './progression'
import { partyPower } from './sim'
import { hasResources, tierProgress } from './state'
import { isReachable } from './world'
import type { CaravanState, World } from './types'

/**
 * What to do next.
 *
 * An idle game with a map, a refinery, a research board, a market and a workshop
 * gives a returning player five screens and no indication of which one is worth
 * opening. This reads the save and answers that question directly, in priority
 * order: things that are actively costing you throughput first, then things that
 * would raise it, then the long-term goals.
 */

export type ObjectiveKind =
    | 'starving' | 'idle-workers' | 'lines-idle' | 'research-idle' | 'refit'
    | 'sell' | 'claim' | 'advance' | 'recruit' | 'camp' | 'widen'

export interface Objective {
    kind: ObjectiveKind
    /** Higher sorts first. Anything above 100 is actively losing you production. */
    weight: number
    title: string
    detail: string
    icon: string
    to: string
    /** Set when the objective points at a specific node on the map. */
    nodeId?: number
}

export function objectives(state: CaravanState, world: World, balance: number): Objective[] {
    const out: Objective[] = []
    const bonuses = bonusesFor(state)

    // --- things that are costing you right now -----------------------------

    const starving = state.workers.filter(w => w.activity.type === 'starving').length
    if (starving) {
        out.push({
            kind: 'starving',
            weight: 200,
            title: `${starving} ${starving === 1 ? 'worker is' : 'workers are'} out of rations`,
            detail: 'They will not move again until the larder has provisions in it.',
            icon: 'i-lucide-drumstick',
            to: '/caravan/refinery'
        })
    }

    const idle = state.workers.filter(w => w.assignment === null).length
    if (idle) {
        out.push({
            kind: 'idle-workers',
            weight: 150,
            title: `${idle} ${idle === 1 ? 'worker is' : 'workers are'} standing around`,
            detail: 'Nobody works a seam until you post them to one. Open a node and assign them.',
            icon: 'i-lucide-user-minus',
            to: '/caravan'
        })
    }

    const lines = BASE_REFINERY_LINES + bonuses.refineryLines
    const queued = state.refineJobs?.length ?? 0
    if (queued < lines) {
        const affordable = RECIPES.filter(r => r.tier <= state.tier && hasResources(state, r.inputs))
        if (affordable.length) {
            out.push({
                kind: 'lines-idle',
                weight: 120,
                title: `${lines - queued} refinery ${lines - queued === 1 ? 'line is' : 'lines are'} idle`,
                detail: 'Refined goods sell for their full value and pay for everything else.',
                icon: 'i-lucide-flame',
                to: '/caravan/refinery'
            })
        }
    }

    if (!state.researchJob) {
        const ready = RESEARCH.filter(def =>
            researchAvailable(state, def.id).ok
            && balance >= def.coins
            && hasResources(state, def.resources))
        if (ready.length) {
            out.push({
                kind: 'research-idle',
                weight: 110,
                title: 'The laboratory is idle',
                detail: `${ready.length} ${ready.length === 1 ? 'project is' : 'projects are'} affordable right now.`,
                icon: 'i-lucide-flask-conical',
                to: '/caravan/research'
            })
        }
    }

    // --- things that would raise throughput --------------------------------

    const refits = planLoadout(state).length
    if (refits > 0 && state.items.length > 0) {
        out.push({
            kind: 'refit',
            weight: 90,
            title: `${refits} gear ${refits === 1 ? 'slot' : 'slots'} could be improved`,
            detail: 'One click hands the best of every slot to your highest level workers.',
            icon: 'i-lucide-shield-check',
            to: '/caravan/workers'
        })
    }

    // --- money and expansion ------------------------------------------------

    const rawValue = Object.entries(state.resources)
        .filter(([id]) => RESOURCES[id]?.kind === 'raw')
        .reduce((sum, [id, amount]) => sum + amount * salePrice(id), 0)
    const cost = nodeCost(Math.max(0, state.ownedNodes.length - 1))

    if (rawValue > cost * 0.5) {
        out.push({
            kind: 'sell',
            weight: 80,
            title: `${Math.round(rawValue).toLocaleString()} in unsold goods`,
            detail: 'Coins only come from the market. Nothing in the storehouse is earning.',
            icon: 'i-lucide-coins',
            to: '/caravan/market'
        })
    }

    if (balance >= cost) {
        const owned = new Set([...state.ownedNodes, ...state.clearedCamps])
        const target = world.nodes.find(node =>
            node.kind !== 'camp'
            && !owned.has(node.id)
            && node.tier <= state.tier
            && isReachable(world, node.id, owned))
        if (target) {
            out.push({
                kind: 'claim',
                weight: 70,
                title: `Claim ${target.name}`,
                detail: `${Math.round(cost).toLocaleString()} coins. More seams means more workers earning at once.`,
                icon: 'i-lucide-flag',
                to: '/caravan',
                nodeId: target.id
            })
        }
    }

    if (state.workers.length < bonuses.maxWorkers) {
        out.push({
            kind: 'recruit',
            weight: 65,
            title: `${bonuses.maxWorkers - state.workers.length} worker ${bonuses.maxWorkers - state.workers.length === 1 ? 'slot is' : 'slots are'} empty`,
            detail: 'The market posts a new slate of recruits every twelve hours.',
            icon: 'i-lucide-users-round',
            to: '/caravan/market'
        })
    }

    // --- camps you could actually take -------------------------------------

    const freeWorkers = state.workers.filter(w => w.activity.type !== 'assault').map(w => w.id)
    if (freeWorkers.length) {
        const power = partyPower(state, freeWorkers)
        const owned = new Set([...state.ownedNodes, ...state.clearedCamps])
        const camp = world.nodes.find(node =>
            node.kind === 'camp'
            && !state.clearedCamps.includes(node.id)
            && node.tier <= state.tier
            && (node.power ?? Infinity) < power * 0.85
            && world.edges.some(e =>
                (e.a === node.id && owned.has(e.b)) || (e.b === node.id && owned.has(e.a))))
        if (camp) {
            out.push({
                kind: 'camp',
                weight: 60,
                title: `${camp.name} can be taken`,
                detail: 'Your workers outmatch it. Clearing it opens the road past it.',
                icon: 'i-lucide-swords',
                to: '/caravan',
                nodeId: camp.id
            })
        }
    }

    // --- the long game ------------------------------------------------------

    const progress = tierProgress(state)
    if (progress && progress.resourcesMet && progress.nodesMet && balance >= progress.requirement.coins) {
        out.push({
            kind: 'advance',
            weight: 190,
            title: `Advance to ${progress.nextTier?.name}`,
            detail: 'Opens the next ring of the map, its recipes, and the research behind it.',
            icon: 'i-lucide-chevrons-up',
            to: '/caravan/research'
        })
    } else if (progress && state.tier < MAX_TIER) {
        const missing: string[] = []
        if (!progress.nodesMet) missing.push(`${progress.requirement.nodes - progress.nodesOwned} more nodes`)
        if (!progress.resourcesMet) {
            const short = progress.resources.find(r => r.have < r.need)
            if (short) missing.push(`${Math.ceil(short.need - short.have).toLocaleString()} ${RESOURCES[short.id]?.name}`)
        }
        if (balance < progress.requirement.coins) {
            missing.push(`${Math.ceil(progress.requirement.coins - balance).toLocaleString()} coins`)
        }
        if (missing.length) {
            out.push({
                kind: 'advance',
                weight: 20,
                title: `Toward ${progress.nextTier?.name}`,
                detail: `Still need ${missing.join(', ')}.`,
                icon: 'i-lucide-flag-triangle-right',
                to: '/caravan/research'
            })
        }
    }

    // Seams that are full while somebody has nowhere to go. Widening one is the
    // way to make room without claiming another node.
    const crowded = state.ownedNodes.filter(id => roomAt(state, id, bonuses) === 0
        && world.nodes[id]?.kind === 'resource')
    if (idle && crowded.length) {
        const node = world.nodes[crowded[0]!]
        if (node) {
            out.push({
                kind: 'widen',
                weight: 100,
                title: `${node.name} is full`,
                detail: 'Widening a seam lets you post more workers to it at once.',
                icon: 'i-lucide-move-horizontal',
                to: '/caravan',
                nodeId: node.id
            })
        }
    }

    return out.sort((a, b) => b.weight - a.weight)
}

/** The single most useful thing to do, or null when nothing needs attention. */
export function topObjective(state: CaravanState, world: World, balance: number): Objective | null {
    return objectives(state, world, balance)[0] ?? null
}
