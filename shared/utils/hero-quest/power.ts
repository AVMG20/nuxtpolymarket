/**
 * The Global Power Number — `global-power-number.md`.
 *
 *     partyEffectiveDPS = Σ member DPS                      (autoattacks + ability kit, crit-averaged)
 *     memberEHP         = maxHp × (1 + DEF / EHP_DEF_CONSTANT) / (1 − EVA)
 *     partyEffectiveEHP = Σ memberEHP
 *     GPN               = √(partyEffectiveDPS × partyEffectiveEHP) × GPN_DISPLAY_SCALE
 *
 * **A pure function of the fielded party's real stats, and nothing else.** There is no collection
 * term and no progress term: everything that makes the party stronger — levels, class, the
 * Champion, Gear, Skill and Artifact collection passives, equipped Skills and Artifacts, a fielded
 * Champion — already lives in the stats `partyUnitStats` returns, so it reaches GPN with no special
 * case. That is the whole design (§1): a separate weighted formula would drift from what the party
 * can actually do.
 *
 * **The geometric mean, lifted by a flat scale** (the root was dropped 2026-09-15 and restored
 * 2026-09-16). The bare product blows the display far past either stat it is made of, which reads
 * as a balance rather than as a power rating; the root holds it to the same order of magnitude as
 * DPS and EHP, and `GPN_DISPLAY_SCALE` then puts daylight between it and them so it is not
 * mistaken for one. Both steps are monotonic, so neither changes which party ranks above which —
 * only how big the number reads. The mean still rewards balance: for a fixed budget it peaks when
 * neither side is neglected.
 *
 * **It can go down** (§3). Benching a Champion or unequipping an Artifact drops it, which is what
 * lets Arena matchmaking compare it with a defender's Defense GPN.
 *
 * ## Against nothing
 *
 * The idle rate measures DPS against a stage's enemy. GPN has no enemy, so it is taken against
 * **zero DEF and a single target**: no mitigation, and an AoE ability counted for the one body it
 * is guaranteed to hit. Ability self-buffs projected from uptime (Haste) are left out for the same
 * reason — they belong to a fight, and GPN is a snapshot of the stat block, not of a fight.
 *
 * Pure, like everything in `shared/`, so the server serializes it and any client or script can
 * recompute it from the same snapshot.
 */

import { EHP_DEF_CONSTANT, GPN_DISPLAY_SCALE, MAX_EVASION } from './constants'
import { partyDps } from './combat'
import { partyAbilityDpsByUnit } from './projection'
import { partyUnitStats } from './stats'
import { ONE, ZERO } from './numbers'
import type { Decimal } from './numbers'
import type { HeroSnapshot, UnitStats } from './types'

export interface GlobalPower {
    /** `√(dps × ehp) × GPN_DISPLAY_SCALE`. */
    gpn: Decimal
    /** The whole fielded party's effective DPS, against zero DEF. */
    dps: Decimal
    /** The whole fielded party's effective HP. */
    ehp: Decimal
    /** Per unit, Hero first, in `partyUnitStats` order — what each body adds to the two sums. */
    units: { dps: Decimal; ehp: Decimal }[]
}

/** One unit's effective HP: its pool, stretched by DEF and by the share of attacks that miss. */
export function memberEhp(unit: UnitStats): Decimal {
    const evasion = Math.min(MAX_EVASION, Math.max(0, unit.eva))
    return unit.maxHp
        .mul(ONE.add(unit.def.div(EHP_DEF_CONSTANT)))
        .div(1 - evasion)
}

export function globalPower(hero: HeroSnapshot): GlobalPower {
    const units = partyUnitStats(hero)
    if (units.length === 0) return { gpn: ZERO, dps: ZERO, ehp: ZERO, units: [] }

    // Per unit, through the same functions the idle rate uses. Against zero DEF the party's pooled
    // mitigation is 0, so evaluating one unit's autoattacks on its own loses nothing.
    const abilityDps = partyAbilityDpsByUnit(hero, units, 0, 1)
    const unitRows = units.map((unit, index) => ({
        dps: partyDps([unit], 0).add(abilityDps[index] ?? ZERO),
        ehp: memberEhp(unit)
    }))

    const dps = unitRows.reduce((total, row) => total.add(row.dps), ZERO)
    const ehp = unitRows.reduce((total, row) => total.add(row.ehp), ZERO)
    return { gpn: dps.mul(ehp).sqrt().mul(GPN_DISPLAY_SCALE), dps, ehp, units: unitRows }
}
