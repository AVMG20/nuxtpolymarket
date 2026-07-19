import { AI_TOOL_CATALOG_BY_NAME } from './ai-tools'
import type { AiToolCall } from './ai'

/** Cookie holding the per-player AI guard. Read server-side, written by the AI page. */
export const AI_GUARD_COOKIE = 'ai_guard'

/**
 * Capability groups the guard can gate. A group toggled on runs its tools without
 * asking; toggled off, the AI must still ask before every action in that group.
 * Read-only lookups (catalogue capability null) are never gated.
 */
export const AI_CAPABILITIES = [
    { key: 'casino', label: 'Casino & blackjack', description: 'Wagering coins on games and blackjack', icon: 'i-lucide-dices' },
    { key: 'bank', label: 'Bank', description: 'Deposits, withdrawals, and debt repayment', icon: 'i-lucide-landmark' },
    { key: 'gems', label: 'Gem market', description: 'Buying and selling gems', icon: 'i-lucide-gem' },
    { key: 'miner', label: 'Miner', description: 'Collecting rewards and buying upgrades', icon: 'i-lucide-pickaxe' },
    { key: 'colony', label: 'Colony', description: 'Collecting, feeding, selling, and upgrades', icon: 'i-lucide-bug' },
    { key: 'xeno', label: 'Xeno garden', description: 'Planting, harvesting, and selling plants', icon: 'i-lucide-sprout' },
    { key: 'hack', label: 'Hack Ops', description: 'Dispatching and collecting operations', icon: 'i-lucide-terminal' },
    { key: 'api', label: 'Other game actions', description: 'Any other allowed game API call', icon: 'i-lucide-code' }
] as const

export type AiCapabilityKey = typeof AI_CAPABILITIES[number]['key']

const CAPABILITY_KEYS = new Set<string>(AI_CAPABILITIES.map(capability => capability.key))

export interface AiGuardSettings {
    /** Per-capability auto-run. When false, tools in that group require confirmation. */
    autoRun: Record<AiCapabilityKey, boolean>
    /** Coins above which a single wager needs manual approval. null = no auto-run threshold. */
    maxBet: number | null
}

export function defaultAiGuard(): AiGuardSettings {
    return {
        autoRun: Object.fromEntries(AI_CAPABILITIES.map(capability => [capability.key, false])) as Record<AiCapabilityKey, boolean>,
        maxBet: null
    }
}

/** Parse the raw cookie value into normalized settings, falling back to safe defaults. */
export function parseAiGuard(raw: unknown): AiGuardSettings {
    const guard = defaultAiGuard()
    let parsed: unknown = raw
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw)
        } catch {
            return guard
        }
    }
    if (!parsed || typeof parsed !== 'object') return guard

    const source = parsed as { autoRun?: unknown, maxBet?: unknown }
    if (source.autoRun && typeof source.autoRun === 'object') {
        const autoRun = source.autoRun as Record<string, unknown>
        for (const key of CAPABILITY_KEYS) {
            if (autoRun[key] === true) guard.autoRun[key as AiCapabilityKey] = true
        }
    }
    const maxBet = Number(source.maxBet)
    if (Number.isFinite(maxBet) && maxBet > 0) guard.maxBet = maxBet
    return guard
}

export function capabilityForTool(name: string): AiCapabilityKey | null {
    const capability = AI_TOOL_CATALOG_BY_NAME[name]?.capability
    return capability && CAPABILITY_KEYS.has(capability) ? capability as AiCapabilityKey : null
}

/** The coins a wagering tool call stakes per round, or null for non-wagering tools. */
export function toolBetAmount(toolCall: AiToolCall): number | null {
    if (capabilityForTool(toolCall.function.name) !== 'casino') return null
    try {
        const args = JSON.parse(toolCall.function.arguments) as { bet?: unknown }
        const bet = Number(args.bet)
        return Number.isFinite(bet) ? bet : null
    } catch {
        return null
    }
}

/**
 * Whether a tool call may run without asking the player. Read-only lookups always
 * run; mutating tools need their capability toggled on, and a wager above the
 * guard's max-bet still falls back to manual approval.
 */
export function shouldToolAutoRun(toolCall: AiToolCall, guard: AiGuardSettings): boolean {
    const tool = AI_TOOL_CATALOG_BY_NAME[toolCall.function.name]
    if (!tool) return false
    if (!tool.requiresConfirmation) return true

    const capability = capabilityForTool(toolCall.function.name)
    if (!capability || !guard.autoRun[capability]) return false

    if (capability === 'casino' && guard.maxBet != null) {
        const bet = toolBetAmount(toolCall)
        if (bet != null && bet > guard.maxBet) return false
    }
    return true
}
