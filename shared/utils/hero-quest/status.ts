/**
 * Status effects: the shared engine every ability plugs into.
 *
 * Both ability rosters describe effects that presume a status system — Rising Flame's
 * "re-application stacks", Frostbind's "at max stacks, fully disables", Purify's "removes all
 * debuffs and grants brief debuff immunity", Unraveling Curse's "extends the remaining
 * duration of all debuffs currently active on its target". That last one is decisive: it can
 * only be written against a **queryable, mutable, per-unit registry** of live effects. No
 * design doc defines one, so the data model and every interaction rule below is a decision
 * made here rather than transcribed.
 *
 * Every function here degrades to a no-op on an empty status list, so a unit with no statuses
 * behaves exactly as the bare stat block says.
 *
 * ## Where it lives
 *
 * `UnitStats` is built once by `stats.ts` and never mutated — that immutability is what makes
 * the stat pipeline a single pass. Statuses are therefore a **separate mutable layer** that
 * sits alongside a unit rather than inside it, and effective values are resolved by combining
 * the two at the point of use.
 *
 * Pure, like the rest of `shared/`: no DB, no clock, no randomness. Durations advance because
 * a caller hands in an elapsed time.
 */

import {
    STATUS_MAX_STACKS,
    STATUS_TICK_SECONDS
} from './constants'
import { D, ONE, ZERO, decMax } from './numbers'
import type { Decimal, DecimalSource } from './numbers'
import type { HqStatKey } from './types'

/**
 * Every effect shape the two ability rosters actually describe.
 *
 * Kept as one flat union rather than a class hierarchy because the resolution code wants to
 * ask "what is the total of X across this unit's statuses", not "what kind of object is this".
 */
export type StatusKind =
    /** Periodic damage. `magnitude` is damage per tick, per stack. */
    | 'dot'
    /** Periodic healing. `magnitude` is healing per tick, per stack. */
    | 'hot'
    /** An absorb pool consumed before HP. `magnitude` is the remaining pool. */
    | 'shield'
    /** Multiplicative stat increase. `magnitude` is the fraction added per stack. */
    | 'buff'
    /** Multiplicative stat decrease. `magnitude` is the fraction removed per stack. */
    | 'debuff'
    /** Pulls enemy attacks onto the bearer while it lasts. */
    | 'taunt'
    /** Abilities cannot fire. Autoattacks are unaffected. */
    | 'silence'
    /** Nothing fires and no autoattack lands. */
    | 'stun'
    /** Returns `magnitude` of incoming damage to the attacker, as a fraction per stack. */
    | 'reflect'
    /** Takes `magnitude` of damage aimed at a protected ally, as a fraction per stack. */
    | 'redirect'
    /** Blocks new debuffs from landing at all. */
    | 'immunity'

/** Kinds a cleanse removes and immunity blocks. Buffs and shields are never "debuffs". */
const HOSTILE_KINDS: readonly StatusKind[] = ['dot', 'debuff', 'silence', 'stun']

export function isHostile(kind: StatusKind): boolean {
    return HOSTILE_KINDS.includes(kind)
}

export interface StatusInstance {
    /**
     * Identity for stacking. Two applications with the same `id` are the *same* effect being
     * refreshed; different ids coexist. Ability authors pass their ability id, so a Champion
     * reapplying its own burn stacks while a different burn runs alongside it.
     */
    id: string
    kind: StatusKind
    /** Which stat a `buff` / `debuff` moves. Meaningless — and ignored — for other kinds. */
    stat?: HqStatKey
    /** Sim-seconds left. */
    remaining: number
    stacks: number
    /**
     * Per-stack magnitude. Units depend on `kind`: damage for `dot`, healing for `hot`, an
     * absorb pool for `shield`, a fraction for `buff` / `debuff` / `reflect` / `redirect`, and
     * unused for the pure control kinds.
     */
    magnitude: Decimal
}

export interface StatusApplication {
    id: string
    kind: StatusKind
    stat?: HqStatKey
    duration: number
    magnitude?: DecimalSource
    /**
     * Stacks this application adds. Omitted means 1 — and, for a `buff` / `debuff`, also means
     * *do not stack on reapply*. Set it explicitly to make a stat effect build (Frostbind).
     */
    stacks?: number
}

/** Kinds that multiply a stat. They refresh in place unless an application opts into stacking. */
const STAT_KINDS: readonly StatusKind[] = ['buff', 'debuff']

function stacksOnReapply(incoming: StatusApplication): boolean {
    return incoming.stacks !== undefined || !STAT_KINDS.includes(incoming.kind)
}

/**
 * Apply an effect to a status list, mutating it in place.
 *
 * ## The stacking rule
 *
 * Reapplying the same `id` **refreshes the duration and adds a stack**, capped at
 * `STATUS_MAX_STACKS`. Both halves are needed by the rosters: "re-application stacks" (Rising
 * Flame) demands the stack, and a stacking effect whose duration never refreshed would expire
 * mid-build no matter how hard it was maintained.
 *
 * **Stat buffs and debuffs are the exception: they refresh without stacking** unless the
 * application sets `stacks` explicitly. A buff whose duration outlasts its own cooldown is
 * otherwise recast while still up, so "doubles SPD" (Haste) would compound to ×6 and a flat
 * −20% debuff would climb to −100%. The effects that are *meant* to build — Frostbind's slow,
 * Iron Skin — say so with `stacks`.
 *
 * Refresh is to the **longer** of the two durations, never blindly to the new one — otherwise
 * a short cheap application would cut a long expensive one short, which makes a strong effect
 * strictly worse in the presence of a weak one.
 *
 * Returns `false` when immunity blocked the application, so a caller can log the deflection
 * rather than silently dropping it.
 */
export function applyStatus(list: StatusInstance[], incoming: StatusApplication): boolean {
    if (isHostile(incoming.kind) && hasStatus(list, 'immunity')) return false

    const added = Math.max(1, Math.floor(incoming.stacks ?? 1))
    const existing = list.find(status => status.id === incoming.id)

    if (existing) {
        existing.remaining = Math.max(existing.remaining, incoming.duration)
        if (stacksOnReapply(incoming)) {
            existing.stacks = Math.min(STATUS_MAX_STACKS, existing.stacks + added)
        }
        // A shield is a pool, so a refresh tops it up rather than replacing the per-stack
        // magnitude — the only kind where `magnitude` accumulates instead of describing a rate.
        if (incoming.kind === 'shield') {
            existing.magnitude = existing.magnitude.add(D(incoming.magnitude ?? 0))
        } else if (incoming.magnitude !== undefined) {
            existing.magnitude = D(incoming.magnitude)
        }
        return true
    }

    list.push({
        id: incoming.id,
        kind: incoming.kind,
        ...(incoming.stat === undefined ? {} : { stat: incoming.stat }),
        remaining: Math.max(0, incoming.duration),
        stacks: Math.min(STATUS_MAX_STACKS, added),
        magnitude: D(incoming.magnitude ?? 0)
    })
    return true
}

export function hasStatus(list: readonly StatusInstance[], kind: StatusKind): boolean {
    return list.some(status => status.kind === kind && status.remaining > 0)
}

/** Total stacks of one kind, across every instance carrying it. */
export function stackCount(list: readonly StatusInstance[], kind: StatusKind): number {
    return list.reduce((total, status) => status.kind === kind ? total + status.stacks : total, 0)
}

export interface StatusTick {
    /** Damage owed to the bearer this tick, from every `dot`. */
    damage: Decimal
    /** Healing owed to the bearer this tick, from every `hot`. */
    healing: Decimal
    /** Instances that ran out during this advance, for the replay log. */
    expired: StatusInstance[]
}

/**
 * Advance every status by `seconds`, collecting periodic damage and healing.
 *
 * ## The cadence rule
 *
 * DoT and HoT are denominated per `STATUS_TICK_SECONDS` rather than per combat tick, so their
 * strength does not depend on `FIGHT_TICK_SECONDS` (see `STATUS_TICK_SECONDS`).
 *
 * Paid pro rata — `seconds / STATUS_TICK_SECONDS` ticks' worth per advance — so an effect that
 * expires between grid points still pays out the fraction it earned.
 */
export function tickStatuses(list: StatusInstance[], seconds: number): StatusTick {
    let damage = ZERO
    let healing = ZERO
    const expired: StatusInstance[] = []
    const elapsed = Math.max(0, seconds)

    for (const status of list) {
        const active = Math.min(elapsed, status.remaining)
        if (active > 0 && (status.kind === 'dot' || status.kind === 'hot')) {
            const ticks = active / STATUS_TICK_SECONDS
            const amount = status.magnitude.mul(status.stacks).mul(ticks)
            if (status.kind === 'dot') damage = damage.add(amount)
            else healing = healing.add(amount)
        }
        status.remaining -= elapsed
        if (status.remaining <= 0) expired.push(status)
    }

    if (expired.length > 0) {
        for (let index = list.length - 1; index >= 0; index--) {
            if (list[index]!.remaining <= 0) list.splice(index, 1)
        }
    }

    return { damage, healing, expired }
}

/**
 * The multiplier a stat carries from every buff and debuff on it.
 *
 * ## The resolution-order rule
 *
 * Modifiers are **multiplicative and combined as a product**, which makes the result
 * order-independent — there is no "buffs before debuffs" question to answer, because
 * multiplication does not care. That is deliberate: any additive scheme needs a stated order
 * and a floor rule to stop a stack of debuffs driving a stat negative, and both would be
 * arbitrary. The product is floored at zero for the same reason a single debuff is clamped:
 * a stat may reach nothing, never less.
 */
export function statMultiplier(list: readonly StatusInstance[], stat: HqStatKey): Decimal {
    return list.reduce((total, status) => {
        if (status.stat !== stat || status.remaining <= 0) return total
        const shift = status.magnitude.mul(status.stacks)
        if (status.kind === 'buff') return total.mul(ONE.add(shift))
        if (status.kind === 'debuff') return total.mul(decMax(ZERO, ONE.sub(shift)))
        return total
    }, ONE)
}

/** Fraction of incoming damage returned to the attacker, summed and capped at 100%. */
export function reflectFraction(list: readonly StatusInstance[]): Decimal {
    const total = list.reduce(
        (sum, status) => status.kind === 'reflect' && status.remaining > 0
            ? sum.add(status.magnitude.mul(status.stacks))
            : sum,
        ZERO
    )
    return total.gt(ONE) ? ONE : total
}

export interface AbsorbResult {
    /** What still reaches HP after the shields took their share. */
    throughput: Decimal
    /** How much the shields actually ate. */
    absorbed: Decimal
    /** Shield instances emptied by this hit. */
    broken: StatusInstance[]
}

/**
 * Run a hit through the bearer's shields, mutating their pools.
 *
 * ## The shield-vs-mitigation rule
 *
 * Shields absorb **after** mitigation, never before. A shield therefore buys a predictable
 * amount of *post-mitigation* damage — its value does not silently swing with the defender's
 * DEF or the attacker's PWR, which is what would happen if it were applied to the raw hit.
 * It also keeps the `MIN_DAMAGE` floor meaningful: the floor is a property of the mitigation
 * formula, and a shield sitting in front of it would let a fully-shielded unit take literally
 * nothing, quietly reintroducing the immortality that floor exists to prevent.
 *
 * Shields are consumed oldest-first so a topped-up pool does not strand the original.
 */
export function absorbDamage(list: StatusInstance[], damage: DecimalSource): AbsorbResult {
    let remaining = decMax(ZERO, D(damage))
    let absorbed = ZERO
    const broken: StatusInstance[] = []

    for (const status of list) {
        if (status.kind !== 'shield' || status.remaining <= 0 || remaining.lte(0)) continue
        const eaten = status.magnitude.gt(remaining) ? remaining : status.magnitude
        status.magnitude = status.magnitude.sub(eaten)
        absorbed = absorbed.add(eaten)
        remaining = remaining.sub(eaten)
        if (status.magnitude.lte(0)) {
            status.remaining = 0
            broken.push(status)
        }
    }

    if (broken.length > 0) {
        for (let index = list.length - 1; index >= 0; index--) {
            if (list[index]!.kind === 'shield' && list[index]!.remaining <= 0) list.splice(index, 1)
        }
    }

    return { throughput: remaining, absorbed, broken }
}

/**
 * Strip statuses, returning what was removed — the mechanism behind Purify and every cleanse.
 *
 * Defaults to removing exactly the hostile kinds, so a cleanse can never strip the party's own
 * buffs or eat a shield it was meant to protect.
 */
export function cleanse(
    list: StatusInstance[],
    predicate: (status: StatusInstance) => boolean = status => isHostile(status.kind)
): StatusInstance[] {
    const removed = list.filter(predicate)
    for (let index = list.length - 1; index >= 0; index--) {
        if (predicate(list[index]!)) list.splice(index, 1)
    }
    return removed
}

/**
 * Extend every hostile status by `seconds` — Unraveling Curse, expressed directly.
 *
 * The reason the registry has to be queryable rather than a bag of opaque modifiers.
 */
export function extendHostile(list: StatusInstance[], seconds: number): number {
    let extended = 0
    for (const status of list) {
        if (!isHostile(status.kind) || status.remaining <= 0) continue
        status.remaining += Math.max(0, seconds)
        extended++
    }
    return extended
}

/** Can this unit fire abilities? Silence and stun both stop it; only stun stops autoattacks. */
export function canCastAbilities(list: readonly StatusInstance[]): boolean {
    return !hasStatus(list, 'silence') && !hasStatus(list, 'stun')
}

export function canAutoattack(list: readonly StatusInstance[]): boolean {
    return !hasStatus(list, 'stun')
}
