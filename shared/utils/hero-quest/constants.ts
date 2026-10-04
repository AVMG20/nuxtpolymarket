/**
 * Hero Quest tuning registry — every named constant in the game.
 *
 * Nothing numeric lives at a call site. A magic number in `combat.ts` is a bug even when the
 * value is correct; this file is what makes the sim and playtest tuning a one-file edit.
 *
 * Constants stay plain `number` even where the value they feed becomes Decimal — the explosion
 * lives in the exponent, not the base. Promotion to Decimal happens in `settle.ts` / `combat.ts`.
 *
 * ── UNTUNED ╧ ──────────────────────────────────────────────────────────────────────────
 * A locked formula shape with a placeholder value. Every calculation runs, but the value is a
 * guess and must not be treated as decided. `rg '╧' shared/utils/hero-quest/constants.ts`
 * lists the complete fill-in set.
 *
 * ── TUNED ✓ ────────────────────────────────────────────────────────────────────────────
 * Derived from measurement and confirmed in playtest. Moving one is a design decision: its
 * comment says what it trades against and what it is coupled to. Re-measure before and after
 * with `bun run sim:hero-quest --report=campaign` (`--sweep=NAME=a,b,c` to compare values).
 *
 * A **derived** constant carries no marker; it inherits the status of its inputs and is never
 * set directly.
 */

import type { HqStatKey, StatTier } from './types'

// ── Run structure ──────────────────────────────────  core-progression-and-prestige.md §2

export const WORLD_COUNT = 10
export const STAGES_PER_WORLD = 10

/** Kills to clear a wave stage. Flat by design — difficulty comes from stats, not counts. */
export const BASE_KILL_COUNT = 30

/**
 * Seconds a party that wiped on a wave stage spends recovering, with nothing landing and nothing
 * earned, before its next attempt (`settle.walkWall`).
 *
 * The death penalty. Without it a wipe cost nothing: the attempt restarted at once and income ran
 * on unbroken. It bites only while the party is walled, and the shorter the attempts, the harder,
 * so a wall far beyond the party's power earns far less than one it nearly clears. A decision
 * (2026-10-03), not a measurement.
 */
export const WIPE_RECOVERY_SECONDS = 5

/** Flat timer on both Stage 5 and Stage 10 fights. */
export const BOSS_TIMER_SECONDS = 30

export const BOSS_STAGE = 5
export const SUPER_BOSS_STAGE = 10
export const ELITE_STAGE_MIN = 6
export const ELITE_STAGE_MAX = 9

// ── Enemy packs ────────────────────────────────────  classes-and-combat.md §7, §6
//
// How many enemies stand in one encounter. No design doc owns this number; packs exist so AoE,
// chain and threat abilities have something to act on.
//
// `BASE_KILL_COUNT` still counts **individual enemies**, not encounters: a wave stage is 30
// bodies arriving in bursts of N. That keeps `goldPerKill`, `xpPerKill`, `MIN_SECONDS_PER_KILL`
// and the persisted `hq_state.kill_count` in their original units.
//
// Pack HP and party DPS both scale by N against a homogeneous pack, so `secondsPerKill` is
// unchanged at any size. Packs move difficulty **entirely onto survivability**.

/**
 * Six divides `BASE_KILL_COUNT` exactly, so a wave or elite stage is 5 packs. Keep any retune a
 * divisor of 30 or the last pack of a stage is a ragged remainder.
 */
export const WAVE_PACK_SIZE = 6
export const ELITE_PACK_SIZE = 6

/**
 * Minions standing with a boss or super boss; the encounter holds `BOSS_MINION_COUNT + 1` bodies.
 *
 * Smaller than a wave pack: the escort splits the party's attention and gives AoE something to
 * answer. `BOSS_TIMER_SECONDS` covers the **whole encounter**, so every minion is time taken off
 * the boss.
 */
export const BOSS_MINION_COUNT = 2

/**
 * Fraction of a pack still swinging, averaged over one stage attempt.
 *
 * Under focus fire live attackers walk N → N-1 → … → 1, a mean of `(N+1)/2`, which `0.5`
 * reproduces. `1.0` is the conservative endpoint. At N = 1 any value yields exactly one stream.
 */
export const PACK_LIVE_STREAM_FRACTION = 0.5 // TUNED ✓

// ── Enemy curve ────────────────────────────────────  core-progression-and-prestige.md §1
//
//     n = prestige × 100 + (world-1) × 10 + (stage-1)
//     enemyMultiplier = ENEMY_STEP_BASE^n
//
// One index, one base, one smooth ramp with no seam at a world or prestige boundary. Every
// progression curve (enemy stats, XP, Gold) rides the same index, which is what makes their
// relative growth a single comparable exponent.
//
// ⚠ There is no prestige difficulty reset: index 99 → 100 is one ordinary step. To put a dip
// back, set PRESTIGE_INDEX_STEPS = 0 and ENEMY_PRESTIGE_STEP_MULT to the per-prestige factor.

/** Index steps a prestige is worth. Deriving it from the run length keeps the ramp seamless. */
export const PRESTIGE_INDEX_STEPS = WORLD_COUNT * STAGES_PER_WORLD

/**
 * How much harder each stage is than the one before it — 1.08 is +8% per stage. Tune the step;
 * read the per-loop total off `ENEMY_CURVE_T`.
 *
 * The party pools its PWR (`partyMitigation`), so N units are worth a constant `ln(N)/ln(b)`
 * stages at every depth — +14.3 for a party of 3 at 1.08, +23.3 for a full party of 6. A steeper
 * base shrinks both: **steepening to force the gacha earlier also shrinks what the gacha is
 * worth when it arrives.**
 */
export const ENEMY_STEP_BASE = 1.08 // TUNED ✓

/** Enemy multiplier across one full 100-stage loop — what one prestige costs. Derived. */
export const ENEMY_CURVE_T = Math.pow(ENEMY_STEP_BASE, PRESTIGE_INDEX_STEPS)

/** Extra multiplier per prestige on top of the ramp. 1 is the continuous curve; see above. */
export const ENEMY_PRESTIGE_STEP_MULT = 1

/**
 * The World 1 Stage 1 enemy, before the ramp touches it.
 *
 * `BASE_ENEMY_HP` is **how long a fight is**, at every depth, because `ENEMY_HP_STEP_EXPONENT`
 * covers the party's DPS growth. It is sized for a one-week first prestige.
 * ⚠ **Bounded above by `BOSS_TIMER_SECONDS`, which is fixed.** A gate is 3 bodies inside 30s, so
 * `secondsPerKill` at a gate cannot exceed 10s; raise HP much further and the early gates stop
 * being passable at any level a fresh account can reach. Raising this means raising the timer.
 *
 * `BASE_ENEMY_DEF` is a pace dial only. It divides into time-to-kill and washes out after a level
 * or two of stat growth, so do not reach for it expecting depth.
 *
 * `BASE_ENEMY_PWR` sets **how dangerous the whole game is**, not just the opening: PWR, DEF and
 * VIT pace the enemy curve exactly (`ENEMY_PACE_RATIO`), so `enemyPwr / heroDef` is fixed for the
 * life of a run and the level-1 answer is every depth's answer.
 * ⚠ **It is only meaningful as a product with `K`.** Mitigation is `DEF / (PWR × K)`, so scaling
 * PWR down and `K` up by the same factor leaves every mitigation fraction unchanged and scales
 * only the size of the hit. At 1.75 / 16 the Beginner turns aside 36% of a trash hit and a Tank
 * reaches immunity at DEF 28. Going much lower puts every unit on the `MIN_DAMAGE` floor at
 * World 1 — a Tank archetype's level-1 hit (0.75) already floors there.
 *
 * Current shape: a solo level-1 Beginner clears World 1 Stages 1–4 and stops at the Stage 5
 * boss timer, and every blocker in the first prestige for a party of 3 is a boss timer.
 */
export const BASE_ENEMY_HP = 60 // TUNED ✓
export const BASE_ENEMY_PWR = 1.75 // TUNED ✓
export const BASE_ENEMY_DEF = 2 // TUNED ✓
export const ELITE_STAT_MULT = 1.2 // TUNED ✓

/**
 * Boss and super-boss HP, both relative to that stage's *trash-mob* HP so the two stay directly
 * comparable.
 *
 * A gate against the fixed `BOSS_TIMER_SECONDS` is a pure DPS check, and party DPS is exactly
 * what Champions add — making the gate the wall turns "this got slow" into "this needs a party".
 *
 * `BOSS_HP_MULT` sets the **first wall of a fresh account**: a solo Beginner must fail the World 1
 * Stage 5 timer on arrival by a clear margin (a gate decided by 2 seconds of a seeded fight is a
 * coin flip in `fight.ts`), while a starting party passes it on sight.
 *
 * `SUPER_BOSS_HP_MULT` is deliberately the heavier of the two and, with `XP_PACE_SLACK`, sets the
 * length of the first prestige.
 */
export const BOSS_HP_MULT = 7 // TUNED ✓
export const SUPER_BOSS_HP_MULT = 9 // TUNED ✓

export const BOSS_ATK_MULT = 1.2 // TUNED ✓
export const SUPER_BOSS_ATK_MULT = 1.5 // TUNED ✓

// ── Combat ─────────────────────────────────────────  classes-and-combat.md §7

/**
 * Mitigation ratio threshold: once a defender's DEF reaches `K` times the attacker's PWR,
 * mitigation is 100% — and damage floors at `MIN_DAMAGE`, not at 0.
 *
 * **`K` sets how wide the band between "immune" and "dead" is**, measured in hero levels. Damage
 * taken is `PWR − DEF/K`; too small a `K` makes that band so narrow that a few stages of grinding
 * take a party from dying to untouchable. The band is sized so grinding at a wall is a smooth ramp.
 *
 * ⚠ **Only meaningful as a product with `BASE_ENEMY_PWR`** — see there. Move the two together.
 *
 * It is close to a defence-only dial despite being shared: offence pools the party's PWR before
 * dividing (`partyMitigation`), which puts offensive mitigation near 0 at every depth.
 */
export const K = 16 // TUNED ✓

/**
 * The damage floor. **A hit never deals less than this, however far DEF outruns PWR.**
 *
 * Without it the clamp bottoms out at exactly 0, which makes every wall a *hard* wall: no partial
 * progress, and no way to tell a 1%-short wall from a 90%-short one. A floor of 1 changes the kind
 * of wall without moving it — against 10^40 HP, 1 per hit is not a route through. It is
 * symmetric, so no party is ever perfectly immortal either.
 *
 * Applied in `rawHitDamage`, and mirrored in `partyDps` and `fight.rollDamage` where the pooled
 * path computes damage directly. With `ENEMY_PACE_RATIO` at 1.0 it is the reading on the far side
 * of a wall, not during normal play.
 */
export const MIN_DAMAGE = 1 // TUNED ✓

/** Cap on total EVA, leaving headroom for EVA sources added after Traits. */
export const MAX_EVASION = 0.60

// ── Status effects ─────────────────────────────────  classes-and-combat.md §7 (new)
//
// No design doc defines a status system, but both ability rosters assume one — stacking DoTs,
// refreshed debuffs, shields, cleanses, debuff immunity. These are the rules that assumption
// needs, decided here rather than transcribed.

/**
 * Ceiling on stacks of one effect on one unit.
 *
 * Reapplication refreshes duration *and* adds a stack, so without a cap a maintained DoT grows
 * without bound — and Frostbind's "at max stacks, fully disables" needs a max to point at. Stat
 * buffs and debuffs only stack when their spec sets `stacks` (see `status.applyStatus`).
 */
export const STATUS_MAX_STACKS = 5 // TUNED ✓

/**
 * The period a DoT's or HoT's magnitude is stated per — paid pro rata as time advances.
 *
 * Deliberately **not** `FIGHT_TICK_SECONDS`: denominating per combat tick would tie every DoT's
 * strength to the sim's resolution. A fixed unit keeps "damage per second" a property of the
 * effect rather than of the simulator.
 */
export const STATUS_TICK_SECONDS = 1 // TUNED ✓

/**
 * Threat weight of a unit with no aggro identity — the baseline every multiplier is against.
 *
 * Threat re-weights *within* the row the enemy is already allowed to hit; it never overrides
 * front-row-first eligibility (`champions-guild-gacha.md` §8.4 — a back-lined Tank's taunt stays
 * inert while the front row stands).
 */
export const BASE_THREAT = 1

/**
 * What a Tank archetype and the Warrior class path multiply their threat by. Neither doc assigns
 * a number; any value above 1 puts a Tank in front of its own row-mates.
 */
export const TANK_THREAT_MULTIPLIER = 3 // UNTUNED ╧

/** What an active taunt multiplies threat by, on top of whatever the unit already carries. */
export const TAUNT_THREAT_MULTIPLIER = 10 // UNTUNED ╧

/**
 * Crit chance per point of LCK. A Marksman opens at LCK 12 → 12%, a Warrior at LCK 3.75 → 3.8%,
 * and those are the numbers they keep: LCK is off the level curve (`STAT_SCALES_WITH_LEVEL`), so
 * only the collection passive and equipment lines move them.
 */
export const CRIT_CHANCE_PER_POINT = 0.01 // TUNED ✓

/**
 * Crit damage per point of IMP: IMP 10 → ×1.2.
 *
 * IMP rides the level curve, so this per-point rate on an exponentially growing stat is the only
 * thing bounding how fast the crit multiplier runs away. The *shape* — linear and unbounded in
 * IMP — is load-bearing; see `STAT_SCALES_WITH_LEVEL`.
 */
export const CRIT_DAMAGE_PER_POINT = 0.02 // TUNED ✓

/**
 * LCK past 100% crit chance converts to crit damage at this rate. Must sit well below
 * `CRIT_DAMAGE_PER_POINT` — overflow is a "nothing wasted" valve, not a rival to IMP.
 *
 * Rarely reached: with LCK off the level curve only a deliberately built crit Hero passes 100%.
 * Cut `LCK_BASE_SCALE` much further and it stops firing at all.
 */
export const OVERFLOW_CONVERSION_RATE = 0.01 // UNTUNED ╧

/**
 * HP = BASE_HP + VIT × HP_PER_VIT
 *
 * `BASE_HP` is the flat, level-1 half of the pool. It is kept small on purpose — 60% of a
 * level-1 pool, about half by level 20 — so VIT carries survivability almost from the start
 * instead of a flat constant carrying it for twenty levels and making VIT decorative.
 *
 * A lethal opening is survivable by design: `settle.killsBeforeWipe` banks every kill landed
 * before the party drops and restarts the *same* stage, so a wipe costs no ground and the Hero
 * levels out of it. It does cost time: `WIPE_RECOVERY_SECONDS` with nothing landing, per wipe.
 *
 * If the opening proves too punishing, raise `HP_PER_VIT`, not this. That keeps VIT carrying the
 * pool, but it lifts survivability at *every* depth, so `BASE_ENEMY_PWR` has to rise with it to
 * hold the steady-state ratio.
 */
export const BASE_HP = 150 // TUNED ✓

/**
 * The levelled-party survivability dial.
 *
 * HP is **one pool across a whole stage attempt** (`settle.killsBeforeWipe`), so a wave stage
 * asks the party to survive thirty enemies back to back, not one.
 *
 * Because VIT paces the enemy exactly (`ENEMY_PACE_RATIO`), this sets the party's survival margin
 * at every depth at once rather than moving a wall, and walls are boss timers that no amount of
 * HP answers. The campaign barely moves across a wide range of values. What it mostly sets is the
 * **opening**, and 10 keeps `BASE_HP` a minority of the level-1 pool.
 *
 * ⚠ **Coupled to fight length, not depth.** A longer stage attempt costs proportionally more HP;
 * if `BASE_ENEMY_HP` moves, re-derive survival (this, or `BASE_ENEMY_PWR` / `K`) alongside it.
 */
export const HP_PER_VIT = 10 // TUNED ✓

// ── Attack rate ────────────────────────────────────  basic attacks only

/**
 * Every unit — Hero, Champion, enemy, boss — attacks once per this many seconds at SPD 0.
 *
 * ⚠ **This lever moves both sides of the fight.** Enemies resolve at SPD 0, so their rate is
 * `1 / BASE_ATTACK_INTERVAL_SECONDS` exactly. It shortens fights rather than tilting them.
 * `SKILL_BASE_COOLDOWN_SECONDS` must move by the same factor — see there.
 */
export const BASE_ATTACK_INTERVAL_SECONDS = 2.4 // TUNED ✓

/**
 * Hard ceiling of **5 attacks per second**, however high SPD climbs.
 *
 * Moves with `SPD_ATTACK_RATE_PER_POINT`: a faster per-point rate without a higher ceiling just
 * makes every build reach the same wall sooner.
 */
export const MIN_ATTACK_INTERVAL_SECONDS = 1 / 5 // TUNED ✓

/**
 * Reaches the 5/sec ceiling at SPD 550.
 *
 * **Deliberately low.** SPD should have to be invested in to approach the cap. Opening speed comes
 * from `BASE_ATTACK_INTERVAL_SECONDS`, the flat term, rather than from this scaling one.
 */
export const SPD_ATTACK_RATE_PER_POINT = 0.02 // TUNED ✓

// ── Skill cooldowns ────────────────────────────────  classes-and-combat.md §3

/**
 * Floor on a SPD-shortened skill cooldown, the cooldown-side twin of
 * `MIN_ATTACK_INTERVAL_SECONDS`.
 *
 * ⚠ `classes-and-combat.md` §3 gives SPD only one job, reducing *cooldown duration*, but
 * `attackIntervalFor` also shortens the autoattack interval off the same stat and every campaign
 * number depends on it. Both ride the identical `1 / (1 + SPD × SPD_ATTACK_RATE_PER_POINT)`
 * curve: one stat, one shape, two consumers. §3 should be amended to say so.
 *
 * **The two consumers read different SPD.** Attack rate reads the full block, level curve
 * included; cooldowns read `cooldownSpd`, which leaves the level curve out. On the curve every
 * class hit this floor by level ~200, so skills fired back to back for the rest of the run.
 * Cadence is what SPD lines, the Control collection passive and Haste buy instead.
 */
export const MIN_COOLDOWN_SECONDS = 0.5 // TUNED ✓

/**
 * The cooldown and damage multiplier at the bottom rank of the ladder (Common, Beginner); every
 * other ability sits `SKILL_COOLDOWN_RANK_STEP` per rank above it rather than on 60 invented
 * per-ability pairs.
 *
 * ⚠ **Moves with `BASE_ATTACK_INTERVAL_SECONDS`, by the same factor.** Shortening only the
 * autoattack interval would quietly tilt the game from kits toward basic attacks, and widen the
 * idle projection's over-promise band as fights shorten against a fixed cooldown. That invariant
 * matters more than either value.
 */
export const SKILL_BASE_COOLDOWN_SECONDS = 6.4 // TUNED ✓
export const SKILL_BASE_ABILITY_MULTIPLIER = 2 // TUNED ✓

/**
 * How much longer each rank makes a cooldown: rarity for Skills and Champion abilities, tree
 * depth for class skills. Rank 0 (Common, Beginner) keeps the base above, so a Mythic waits
 * step⁵ and a master class skill step³.
 *
 * A better ability fires less often and hits proportionally harder (`effects.onCooldownRank`),
 * so damage per second holds and the difference is felt as a bigger, rarer hit. ⚠ That holds
 * on average only: the first cast waits out a full cooldown, so inside `BOSS_TIMER_SECONDS` a
 * long cooldown loses its tail.
 */
export const SKILL_COOLDOWN_RANK_STEP = 1.2 // UNTUNED ╧

// ── Ability effect magnitudes ──────────────────────  classes-and-combat.md §7, §3
//
// Every ability in both rosters is described in prose with no numbers — "a short duration", "a
// portion", "small". These are the shapes that prose implies, as one named set so the balance
// pass is a single edit here.
//
// The relative *ordering* is the design content: wide AoE pays for its reach, a pierce beats a
// basic attack by a little, and single-target burst beats both.
//
// ⚠ **Untuned while the progression is tuned, deliberately.** The campaign walk measures a
// Beginner (whose kit is one self-buff) plus un-invested stand-in Champions, so it barely
// touches these numbers. Settling them needs a different measurement: seeded `fight.ts` fights
// across the class roster at a fixed depth, comparing damage per cooldown-second between kits.
// The idle projection only agrees with fights within ±30%/+70% (`projection.spec.ts`), so it
// cannot resolve finer differences either.

/** Wide AoE trades magnitude for reach — it is hitting up to six bodies. */
export const SKILL_AOE_MULTIPLIER = 1.0 // UNTUNED ╧

/** A pierce hits two, so it sits between an autoattack and a full-power single hit. */
export const SKILL_PIERCE_MULTIPLIER = 1.3 // UNTUNED ╧

/** A line hit reaches up to three — between a pierce and a full-board storm. */
export const SKILL_LINE_MULTIPLIER = 1.2 // UNTUNED ╧

/** How long an ability-applied buff, debuff or control lasts. */
export const SKILL_STATUS_DURATION_SECONDS = 6 // UNTUNED ╧

/** Hard control is short by design — it denies actions outright rather than slowing them. */
export const SKILL_CONTROL_DURATION_SECONDS = 2 // UNTUNED ╧

/** Fractional shift a one-stat buff or debuff applies, per stack. */
export const SKILL_BUFF_FRACTION = 0.25 // UNTUNED ╧
export const SKILL_DEBUFF_FRACTION = 0.20 // UNTUNED ╧

/** Healing and shielding as a multiple of the caster's PWR (`champions-guild-gacha.md` §2). */
export const SKILL_HEAL_MULTIPLIER = 1.5 // UNTUNED ╧
export const SKILL_SHIELD_MULTIPLIER = 2.0 // UNTUNED ╧

/** Damage-over-time per tick, as a multiple of PWR. Lower than a hit; it lands repeatedly. */
export const SKILL_DOT_MULTIPLIER = 0.4 // UNTUNED ╧
export const SKILL_HOT_MULTIPLIER = 0.4 // UNTUNED ╧

/**
 * Haste doubles SPD — the one ability magnitude a doc actually states (`classes-and-combat.md`
 * §3). Expressed as the fraction added, so +1.0 is a doubling. Specified, not guessed, hence no
 * marker; the duration is not specified.
 */
export const HASTE_SPD_BONUS = 1.0

/** Enrage's trade: PWR up, and more incoming damage taken, as `classes-and-combat.md` §2 has it. */
export const ENRAGE_PWR_BONUS = 0.6 // UNTUNED ╧
export const ENRAGE_DEF_PENALTY = 0.4 // UNTUNED ╧

/** Kill Shot always crits, and crits for this multiple of the normal crit. */
export const KILL_SHOT_CRIT_MULTIPLIER = 2 // UNTUNED ╧

/** How much an execute-style ability gains against a target at 0% HP. */
export const EXECUTE_BONUS = 1.5 // UNTUNED ╧

/** Reflected and redirected fractions, per stack. */
export const SKILL_REFLECT_FRACTION = 0.25 // UNTUNED ╧
export const SKILL_REDIRECT_FRACTION = 0.4 // UNTUNED ╧

/** How many separate rolls Focused Barrage splits its damage into — "more crit rolls per cast". */
export const FOCUSED_BARRAGE_HITS = 4 // UNTUNED ╧

/** Fraction of max HP a revived ally comes back on — Second Wind's "partial HP". */
export const REVIVE_HP_FRACTION = 0.3 // UNTUNED ╧

/**
 * Frostbind: "stacking slow; at max stacks, fully disables (freezes) the target".
 *
 * Two independent dials: `STACKS_PER_CAST` is how fast the slow builds, `FREEZE_STACKS` how deep
 * it must get before the freeze lands. Time-to-freeze can be retuned from either end, or the
 * freeze pushed out of reach by setting the threshold above `STATUS_MAX_STACKS`.
 */
export const FROSTBIND_STACKS_PER_CAST = 1 // UNTUNED ╧
export const FROSTBIND_FREEZE_STACKS = 3 // UNTUNED ╧

/**
 * The most of an incoming wave that party healing may cancel in the **idle projection**.
 *
 * Not a combat rule — `fight.ts` resolves heals for real. Without it the averaged rate model
 * lets a party with one Support drive incoming damage to zero and become immortal, undoing
 * `MIN_DAMAGE` in the one place no fight would ever contradict it.
 */
export const MAX_SUSTAIN_MITIGATION = 0.9 // TUNED ✓

/**
 * Tick granularity of the seeded boss simulation (`fight.ts`).
 *
 * Bounds the work at `BOSS_TIMER_SECONDS / FIGHT_TICK_SECONDS` iterations regardless of party
 * strength or depth. Finer ticks resolve cooldowns more exactly at the cost of a longer replay
 * log for the client to animate.
 */
export const FIGHT_TICK_SECONDS = 0.1 // TUNED ✓

// ── Hero stats ─────────────────────────────────────  classes-and-combat.md §2

/**
 * The class spread table is qualitative — `high`, `mid`, `low`. These are the numbers those
 * words map to, and the single highest-leverage entry in this file.
 */
export const STAT_TIER_VALUES: Record<StatTier, number> = { // TUNED ✓
    low: 5,
    mid: 10,
    mid_high: 13,
    high: 16
}

/** §2's delta table gives directions and qualifiers ("modest", "extreme"), not magnitudes. */
export const DELTA_MODEST = 2 // TUNED ✓
export const DELTA_NORMAL = 4 // TUNED ✓
export const DELTA_EXTREME = 8 // TUNED ✓

/**
 * What every class's and archetype's **accumulated** LCK base is multiplied by.
 *
 * Applied after the tier value and the class path's deltas, so it lowers starting crit chance
 * without disturbing the relative spread.
 *
 * With LCK off the level curve this is the only dial on base crit chance, and it trades directly
 * against `CRIT_CHANCE_PER_POINT` — halving either halves crit chance for every class at every
 * level.
 *
 * ⚠ At 0.75 the 100% cap is reachable only deliberately, by stacking collection passives and
 * crit lines such as Precision Edge — "crit is a build, not a birthright". Cut much further and
 * the cap and `OVERFLOW_CONVERSION_RATE` become unreachable dead code.
 */
export const LCK_BASE_SCALE = 0.75 // TUNED ✓

/** Floor for any derived stat. Sorcerer lands here on VIT/DEF, which is the design intent. */
export const MIN_STAT_VALUE = 1

/**
 * statAtLevel(base, level) = (base + FLAT × (level-1)) × GROWTH^(level-1)
 *
 * Additive term, on top of the geometric one. **0 by design**: under compounding growth an
 * additive term is a pure early-game distortion (+1 on a base of 10 is +10% per level against a
 * curve moving +8% per stage), and pure geometric growth is what makes the pacing math below hold
 * at every level rather than only asymptotically.
 */
export const STAT_PER_LEVEL_FLAT = 0 // TUNED ✓

/**
 * How many factors of the stat curve one point of DPS carries.
 *
 * Damage is `PWR × critMultiplier × attacksPerSecond × strikes`, and two of those ride the stat
 * block — PWR directly, `critMultiplier` through IMP — so DPS grows as the stat curve *squared*.
 *
 * 2 is the asymptotic value, once attack rate has hit its ceiling. Below that SPD scales too, so
 * the true exponent is nearer 3 and early levels are worth somewhat more than this says. That gap
 * is a real wrinkle a single constant cannot express.
 */
export const DPS_STAT_EXPONENT = 2

/**
 * **How much of one stage's difficulty one level of DPS buys**, against the enemy curve itself
 * and divided by `DPS_STAT_EXPONENT` because damage compounds the stat curve twice:
 *
 *     1.0   DPS tracks the enemy exactly — one level per stage, forever
 *     0.5   a level buys half a stage                                        ← here
 *
 * On its own this does not decide pace: `XP_STEP_EXPONENT` hands back as extra XP whatever ground
 * a level fails to buy, so pace is set by `XP_PACE_SLACK` and gating by `FIGHT_LENGTH_DRIFT`. What
 * this sets is the unit in which those are expressed — the stats-per-level growth rate
 * (`STAT_PER_LEVEL_GROWTH`) and `LEVELS_PER_STAGE`.
 */
export const STAT_PACE_RATIO = 0.5 // TUNED ✓

/** Derived, never set directly — move `STAT_PACE_RATIO`. */
export const STAT_PER_LEVEL_GROWTH = Math.pow(ENEMY_STEP_BASE, STAT_PACE_RATIO / DPS_STAT_EXPONENT)

/**
 * Which stats the hero-level curve is allowed to touch.
 *
 * **LCK is excluded.** Crit chance is `LCK × CRIT_CHANCE_PER_POINT` clamped to 100%, so LCK on a
 * geometric curve makes the cap a question of *when*, not *whether* — every class would cross it
 * inside the first prestige. Frozen at base, crit chance is something the collection passive,
 * Gear, Skills and Artifacts have to buy, which is what their LCK lines are for.
 *
 * **IMP stays on the curve on purpose.** `critMultiplier = 1 + IMP × CRIT_DAMAGE_PER_POINT` is
 * unbounded and linear in IMP, and that is what makes `DPS_STAT_EXPONENT` 2 rather than 1. Taking
 * IMP off too would halve the exponent and force the stat growth curves to be re-derived.
 */
export const STAT_SCALES_WITH_LEVEL: Readonly<Record<HqStatKey, boolean>> = {
    pwr: true,
    spd: true,
    lck: false,
    imp: true,
    vit: true,
    def: true
}

/**
 * Which stats ride the **enemy-paced** curve (`STAT_PER_LEVEL_GROWTH_PACED`) rather than
 * `STAT_PER_LEVEL_GROWTH`.
 *
 * The rule is **whether the stat is read against an enemy stat of its own kind**, because those
 * are the pairs a clamp can close on:
 *
 *     hero PWR      vs enemy DEF     `mitigation` — clamps at DEF ≥ PWR × K
 *     hero DEF      vs enemy PWR     the same clamp, from the other side
 *     hero VIT      vs enemy PWR     the pool that survives what mitigation lets through
 *
 * A matched stat growing even slightly slower than its opposite does not "fall behind and catch
 * up": the ratio drifts one way forever, the clamp closes, and damage collapses to `MIN_DAMAGE`.
 * SPD and IMP have no opposing enemy stat, so a shortfall there is an honest "grind or pull"
 * rather than a cliff.
 *
 * ⚠ With `XP_PACE_SLACK` at 1.0 the two curves are numerically identical, so this split is
 * currently inert. It starts to matter the moment `XP_PACE_SLACK` moves off 1.0 — keep it.
 */
export const STAT_PACES_ENEMY_CURVE: Readonly<Record<HqStatKey, boolean>> = { // TUNED ✓
    pwr: true,
    spd: false,
    lck: false,
    imp: false,
    vit: true,
    def: true
}

/**
 * What one point of a Champion's `(star × 10 + level)` scalar is worth as a stat multiplier.
 * The scalar runs 1 → 60, so at 0.05 an unstarred pull is ×1.0 and a maxed one ×3.95, on top of
 * the rarity multiplier. `champions-guild-gacha.md` §2 never states this conversion.
 *
 * ⚠ **No measurement exercises it.** The campaign walk and every party fixture field Champions at
 * `investment: 1`, the identity end — so every quoted party number is the value of *slots*, never
 * of investment. It is the widest unmeasured lever left in combat.
 */
export const CHAMPION_INVESTMENT_PER_POINT = 0.05 // UNTUNED ╧

// ── XP ─────────────────────────────────────────────

/**
 * XP per kill at World 1 Stage 1.
 *
 * ⚠ **Moves as a pair with `XP_TO_LEVEL_BASE`.** Level pace is set by the *ratio* of XP earned to
 * XP required, so scaling both by the same factor is a pure change of units. Moving this alone
 * shifts the level trajectory by `ln(factor) / ln(XP_TO_LEVEL_GROWTH)` levels at every stage and
 * re-paces the whole campaign.
 */
export const XP_BASE_PER_KILL = 1 // TUNED ✓

/**
 * xpToNextLevel(level) = XP_TO_LEVEL_BASE × XP_TO_LEVEL_GROWTH^(level-1)
 *
 * Moves as a pair with `XP_BASE_PER_KILL` — see there. Declared ahead of the XP-income constants
 * because `XP_STEP_EXPONENT` is derived from `XP_TO_LEVEL_GROWTH`.
 */
export const XP_TO_LEVEL_BASE = 10 // TUNED ✓

/**
 * **The dial for "XP numbers are too big", and very nearly only that.**
 *
 * Fighting time and end level are invariant under this constant — an identity, not a coincidence:
 * `XP_STEP_BASE === XP_TO_LEVEL_GROWTH ^ LEVELS_PER_STAGE`, so income and cost scale by the same
 * factor at every depth. What remains is a second-order effect on *grinding*: clearing a Δ-level
 * deficit at a blocker costs `growth^Δ`, so a shallower curve makes catching up cheaper.
 *
 * The magnitude comes from compounding across the `LEVELS_PER_STAGE` levels each stage hands out.
 * At 1.05 a level-300 Hero needs ~22M XP for its next level and the first prestige ends around
 * 2.8e11, inside `formatHq`'s named-suffix ladder. Steeper values push that into scientific
 * notation within a few prestiges.
 */
export const XP_TO_LEVEL_GROWTH = 1.05 // TUNED ✓

/**
 * **The grind dial: how much of the week is idle waiting in front of a gate.**
 *
 * XP income rides the enemy index at `XP_STEP_EXPONENT`. Holding wall-clock time per stage
 * constant needs `ln(XP_TO_LEVEL_GROWTH) / ln(STAT_PER_LEVEL_GROWTH)`, and this scales that
 * break-even. It sets exactly three things (values at 1.0):
 *
 *     LEVELS_PER_STAGE            = slack × DPS_STAT_EXPONENT / STAT_PACE_RATIO   → 4.0
 *     coverage of SPD and IMP     = slack                                         → 1.0
 *     DPS_COVERAGE_PER_STAGE      = ENEMY_PACE_RATIO + slack                      → 2.0
 *
 * Fighting time is invariant under it: `ENEMY_HP_STEP_EXPONENT` is set against
 * `DPS_COVERAGE_PER_STAGE`, which contains this constant, so party DPS and enemy HP move
 * together. Only grind time changes — lower is shorter. With `SUPER_BOSS_HP_MULT` it sets the
 * first prestige for a party of 3 at about a week.
 *
 * 1.0 is a value, not a boundary: it makes SPD and IMP track the enemy curve one-for-one, which
 * is not `STAT_PACE_RATIO` 1.0's "no gating" — gating is `FIGHT_LENGTH_DRIFT`'s.
 */
export const XP_PACE_SLACK = 1.0 // TUNED ✓

/** Derived. Move `XP_PACE_SLACK`, or the two curves it is measured against. */
export const XP_STEP_EXPONENT =
    XP_PACE_SLACK * Math.log(XP_TO_LEVEL_GROWTH) / Math.log(STAT_PER_LEVEL_GROWTH)

/** Per-step XP base. Derived from the exponent above. */
export const XP_STEP_BASE = Math.pow(ENEMY_STEP_BASE, XP_STEP_EXPONENT)

// ── Defensive pacing ───────────────────────────────  the constant-pressure curve
//
// Declared after the XP block because it is derived from it: how fast a matched stat must grow
// *per level* depends on how many levels a stage hands out.

/**
 * Hero levels earned per stage of enemy curve, in steady state. **Derived, and exact.**
 *
 *     income per stage  ∝ XP_STEP_BASE^n          (kills per stage is constant)
 *     cost of level L   ∝ XP_TO_LEVEL_GROWTH^L
 *
 * Levels advance at a constant rate when `L × ln(XP_TO_LEVEL_GROWTH) = n × ln(XP_STEP_BASE)`;
 * substituting `XP_STEP_EXPONENT` and `STAT_PER_LEVEL_GROWTH` collapses every log and leaves the
 * ratio below.
 *
 * Corollary: a stat on `STAT_PER_LEVEL_GROWTH` covers `XP_PACE_SLACK` of a stage's enemy growth
 * per stage — which is why the matched stats need their own curve whenever slack is below 1.0.
 */
export const LEVELS_PER_STAGE = XP_PACE_SLACK * DPS_STAT_EXPONENT / STAT_PACE_RATIO

/**
 * **How much of one stage's enemy growth a stage's worth of levels buys the matched stats** —
 * PWR, DEF and VIT (`STAT_PACES_ENEMY_CURVE`). At 1.0 they track the enemy exactly, so
 * `enemyPwr / heroDef` and `heroPwr / enemyDef` are fixed for the life of a run: mitigation is
 * fixed at both ends, and so is the fraction of the party's pool a stage attempt costs.
 *
 * Anything less is not a difficulty dial. `mitigation` is a hard clamp, so a drifting pair stays
 * identical for a hundred stages and then collapses to `MIN_DAMAGE` — on the defensive side the
 * party is untouchable and then unsurvivable, on the offensive side damage dealt falls off a
 * cliff at a late prestige.
 *
 * ⚠ **This removes the clamp as a source of walls, at both ends.** Gating lives in
 * `FIGHT_LENGTH_DRIFT` instead. A ratio that clamps makes a cliff; one that never clamps makes a
 * slope, and walls belong on the slope.
 */
export const ENEMY_PACE_RATIO = 1.0 // TUNED ✓

/** Derived, never set directly — move `ENEMY_PACE_RATIO`. */
export const STAT_PER_LEVEL_GROWTH_PACED =
    Math.pow(ENEMY_STEP_BASE, ENEMY_PACE_RATIO / LEVELS_PER_STAGE)

/**
 * **How fast the party's DPS grows**, in stages of enemy curve per stage advanced. Derived; the
 * number enemy HP has to be set against.
 *
 * `DPS = PWR × critMultiplier × attacksPerSecond × strikes`, and two of those ride the level curve:
 * PWR on the paced curve (`ENEMY_PACE_RATIO`) and `critMultiplier` through IMP (`XP_PACE_SLACK`).
 * SPD rides it too, but the attack-rate cap drops it out asymptotically.
 *
 * If enemy HP grew at only 1.0 like the rest of the enemy block, the party would outrun it every
 * stage and every wave stage would pin to `MIN_SECONDS_PER_KILL`.
 */
export const DPS_COVERAGE_PER_STAGE = ENEMY_PACE_RATIO + XP_PACE_SLACK

/**
 * **How much faster enemy HP grows than the party's DPS, per stage.** Decides how long fights
 * are, whether they stay that long, and where the run walls.
 *
 *     0     every fight takes the same number of seconds at every depth; purely time-gated
 *     0.35  each stage's fight is 1.08^0.35 ≈ +2.7% longer than the one before   ← here
 *
 * A slope, not a cliff: seconds-per-kill climbs gently, so a stage is always beatable given
 * enough levels. The walls land on **boss timers**, the one place the drift is read as pass/fail
 * against the fixed `BOSS_TIMER_SECONDS`.
 *
 * ⚠ **Past ~0.35 the run gets *shorter*, not longer.** The last gate of a loop has to make up
 * `drift × 100` stages of curve, and beyond this the level that needs is more than farming can
 * deliver, so the walk stops a world or two before the end instead of finishing.
 *
 * ⚠ **Read it against `DPS_COVERAGE_PER_STAGE`, not against 1.0.** It is the only enemy stat with
 * its own exponent because HP is matched against a *product* of two stats, while PWR and DEF pace
 * the hero one-for-one.
 */
export const FIGHT_LENGTH_DRIFT = 0.35 // TUNED ✓

/** The exponent enemy HP rides on the shared curve index. Derived — move `FIGHT_LENGTH_DRIFT`. */
export const ENEMY_HP_STEP_EXPONENT = DPS_COVERAGE_PER_STAGE + FIGHT_LENGTH_DRIFT

// ── Gold ───────────────────────────────────────────  gold-economy.md §3–4

/**
 * Calibrated against the platform's idle economies, not picked: at the tenure ceiling's day-0
 * rung a fresh account earns ~3.5k Gold/hour, in line with Colony and Xeno on their own first
 * day (`scripts/lib/economy-stages.ts`).
 */
export const BASE_GOLD = 0.4

/**
 * Gold's progression curve, on the same continuous index the enemy rides:
 *
 *     GOLD_STEP_BASE^n,  n = prestige × 100 + (world-1) × 10 + (stage-1)
 *
 * One base over one index has no seam at a world or prestige boundary, so looping back to
 * World 1 never cuts Gold per kill.
 *
 * It needs no cap of its own: `goldPerKill` takes the `min` of this and the tenure ceiling, so
 * the ceiling bounds Gold at every position. It is the only Gold progression dial.
 *
 * 1.017 is the shallowest base at which the weakest roster the campaign sim walks never leaves
 * the platform's 0.4–2.5x cross-game band (`scripts/economy-compare.ts`), while still spending
 * a real share of its time below the ceiling — so falling behind on power still costs Gold.
 * Steeper pins every roster to the ceiling and progress stops paying; shallower drops a stalled
 * account to a tenth of platform income.
 *
 * ⚠ **That rationale did not survive measurement** (`open-items.md` #23, 2026-09-16, re-derivable
 * with `bun run sim:hero-quest --report=gold --party=3`). The campaign walk spends **100%** of its
 * first prestige loop progression-bound, never ceiling-bound, at **0.07% of platform income** —
 * nowhere near the 0.4–2.5x band. Nor does raising this fix it: swept on the walk it saturates at
 * 1.07 (1.09 and 1.15 return the identical total), because `BASE_GOLD × GOLD_TENURE_CEILING` caps
 * income at ~2.6% of platform at the walk's real kill rate. The value is left alone pending the
 * #23.3 decision, which is about the ceiling's derivation rather than about this dial.
 */
export const GOLD_STEP_BASE = 1.017

// ── The tenure ceiling ─────────────────────────────  gold-economy.md §3, §9

/**
 * A speed limit on Gold: the largest `goldPerKill` factor an account of a given age may use.
 * `goldPerKill` takes `min(progression, ceiling)`, so this never *grants* income — it only refuses
 * to pay out progress the calendar has not caught up with.
 *
 * **Why wall-clock account age.** Prestige count tracks accumulated power, not elapsed time — a
 * strong roster covers in hours what a weak one takes weeks to — so no prestige-indexed table can
 * hit a calendar anchor. Account age is the one measure that cannot be front-loaded, farmed, or
 * lost. The alternatives fail:
 *
 * - **Progression** is circular — the ceiling exists *because* progression is front-loaded.
 * - **Time since the run began** resets every prestige, punishing the loop the game is built on.
 * - **Settled playtime** is capped by `offlineCapHours`, so a once-a-day player banks 8 of every
 *   24 hours forever — an engagement tax on an idle game that rewards leaving the tab open.
 *
 * Because it is a `min`, a dormant account is not a hole: six months of age buys a high ceiling,
 * but a Stage 1 hero's progression factor is still 1. Waiting cannot skip the game.
 */
/**
 * The kill rate `GOLD_TENURE_CEILING` is generated against — **the rate the game actually runs
 * at**, not the rate it is capped at.
 *
 * The table converts a platform Gold/hour figure into a per-kill value, so it needs a kill rate to
 * divide by. It used `MIN_SECONDS_PER_KILL` (7,200/hr), which is the *throughput floor* — the
 * fastest a kill may ever resolve — and treating a floor as the typical case made the ceiling
 * 11.7× too low: an account pinned to it earned a twelfth of platform income forever
 * (`open-items.md` #23, measured 2026-09-16).
 *
 * **Measured on the campaign walk**, `bun run sim:hero-quest --report=gold`: 523 kills/hour solo,
 * 617 for a party of three, 620 for a party of six. That it barely moves across party sizes is the
 * pacing model working — `ENEMY_PACE_RATIO` and `FIGHT_LENGTH_DRIFT` hold fight length roughly
 * constant, so a bigger party kills faster *and* walks deeper, and the rate converges. 600 is a
 * round number inside that band; the spread is wider than the last digit, so precision here would
 * be false.
 *
 * ⚠ **What this trades away.** `MIN_SECONDS_PER_KILL` was in the derivation because a bounded
 * per-kill value times an unbounded kill rate is unbounded income. Calibrating to the typical rate
 * means anything that lifts the real rate above 600/hr earns proportionally more than platform.
 * The floor still bounds the worst case at `3600 / MIN_SECONDS_PER_KILL ÷ this` = **12×**, so the
 * old calibration did not vanish — it stopped describing normal play and became the bound on the
 * extreme. **Battle Speed (Phase 4, unbuilt) is the live risk**: it multiplies kill rate directly,
 * and its multiplier lands straight on Gold income against the platform.
 *
 * Coupled to `GOLD_TENURE_CEILING`, which must be regenerated whenever this moves
 * (`bun run balance:compare --emit-hq-ceiling`), and to nothing else — combat never reads it.
 */
export const GOLD_REFERENCE_KILLS_PER_HOUR = 600 // TUNED ✓

export const GOLD_TENURE_DAYS: readonly number[] = [
    0, 0.14, 0.25, 0.5, 1.03, 1.23, 3, 3.93, 5.84, 11.62, 15.84, 34.35, 41.97, 81.91, 145.09, 229.47
]

/**
 * The ceiling at each rung of `GOLD_TENURE_DAYS`, geometrically interpolated between them.
 *
 * Derived, not chosen: each entry is the geometric mean of Colony and Xeno income (uninvested and
 * invested, both games) at that day, divided by `BASE_GOLD × GOLD_REFERENCE_KILLS_PER_HOUR`.
 * **Emit it, do not hand-edit it:** `bun run balance:compare --emit-hq-ceiling` prints the table.
 * Regenerate whenever those economies, `BASE_GOLD` or the reference kill rate move.
 *
 * The rung days sit on **every Colony habitat and Xeno tier boundary**, where the platform curve
 * bends. Evenly spaced rungs sagged up to 22% below the curve; landing on the bends holds it to 1.5%.
 */
export const GOLD_TENURE_CEILING: readonly number[] = [
    17.24, 37.18, 46.43, 74.17, 200.2, 262.8, 1082, 1887, 3360, 8624, 13320, 38680, 53350, 130400, 206300, 342200
]

/**
 * How far under the platform curve the ceiling actually sits.
 *
 * The table above *is* the platform curve, and parity is the wrong target: an invested roster
 * spends most of its time with the ceiling binding rather than progression, so the ceiling is
 * effectively what the economy pays. A game idling at exactly the platform rate most of its
 * lifetime would be the platform's best idle game.
 *
 * Its own dial so the table stays literally "what Colony and Xeno pay", checkable against
 * `scripts/lib/economy-stages.ts`, with the discount visible as one number.
 */
export const GOLD_PLATFORM_DISCOUNT = 0.85

/**
 * Per-day growth past the last rung. +20%/year, so a decade lifts the ceiling ~5.5x.
 *
 * At a ten-year horizon the worst-case collect (max Gold stack, max Battle Speed, a full 72-hour
 * offline window) still clears `numeric(19,4)` by three orders of magnitude, which is what
 * `gold-economy.md` §9.4 asks the specs to assert.
 */
export const GOLD_TENURE_CRAWL = 1.0005

/**
 * The horizon the Gold/hour bound is stated at. The crawl never goes flat, so "the maximum Gold
 * per hour" is only meaningful with a date attached; ten years is the one the specs use.
 */
export const GOLD_BOUND_HORIZON_DAYS = 3650

/**
 * Throughput floor. Bounds the *rate* half of Gold/hour — a bounded per-kill value times an
 * unbounded kill rate is still unbounded income. Also caps how fast the battle animation cycles. Live and offline use the identical function so the two always agree.
 */
export const MIN_SECONDS_PER_KILL = 0.5 // TUNED ✓

// ── Offline ────────────────────────────────────────  idle-mechanics.md §4

/** offlineCapHours(level) = 8 + 2 × level, level 0..32 → 72 hours at the top. Locked. */
export const OFFLINE_CAP_BASE_HOURS = 8
export const OFFLINE_CAP_HOURS_PER_LEVEL = 2
export const MAX_OFFLINE_CAP_LEVEL = 32
export const OFFLINE_CAP_MAX_HOURS = 72

/** 50 → 60 → 70 → 80 → 90 → 100% over 5 shop levels. Locked. */
export const BASE_OFFLINE_EFFICIENCY = 0.50
export const OFFLINE_EFFICIENCY_PER_LEVEL = 0.10
export const MAX_OFFLINE_EFFICIENCY = 1.0
export const MAX_OFFLINE_EFFICIENCY_LEVEL = 5

// ── Battle Speed ───────────────────────────────────  idle-mechanics.md §3

/**
 * The speed tiers a block can be bought at. Gem-only, no free tier. 10x was cut on 2026-10-04: at
 * 10x the largest offline collect cleared the balance column by under two orders of magnitude.
 */
export const BATTLE_SPEED_TIERS = [2, 3, 5] as const
/** The block lengths, in minutes. Locked. */
export const BATTLE_SPEED_DURATIONS_MINUTES = [30, 60, 120, 240] as const
/** The fastest tier, which is what bounds Gold per hour against the balance column. */
export const MAX_BATTLE_SPEED = Math.max(...BATTLE_SPEED_TIERS)
/**
 * price(2x, 30 min). The speed axis is proportional to it: `ANCHOR × speed / 2`. Raised from the
 * doc's 50 to its old 10x price on 2026-10-04, so the cheapest block is the old dearest.
 */
export const BATTLE_SPEED_ANCHOR_GEMS = 250
/** Each duration step doubles the time at 5% off the naive double. Locked. */
export const BATTLE_SPEED_DURATION_STEP = 1.9
/** Prices are rounded to this many Gems, once, at the end of the unrounded chain. Locked. */
export const BATTLE_SPEED_PRICE_ROUNDING = 5

/** Short prestige-shop tracks double per level; the 32-level cap track uses a gentler base. */
export const OFFLINE_EFFICIENCY_BASE_COST = 50 // UNTUNED ╧
export const OFFLINE_EFFICIENCY_COST_GROWTH = 2
export const OFFLINE_CAP_BASE_COST = 25 // UNTUNED ╧
export const OFFLINE_CAP_COST_GROWTH = 1.72

// ── Presence ───────────────────────────────────────  tech-architecture.md §4b

/**
 * How often the open client re-reads state. Lazy settle erases the app-open/app-closed
 * distinction that offline efficiency and the offline cap depend on; a steady refresh restores
 * it by *demonstrating* presence through the request pattern rather than letting the client
 * assert it.
 */
export const HQ_REFRESH_INTERVAL_MS = 60_000 // UNTUNED ╧

/**
 * Gap at or below which a settle window counts as **online** — full rate, no cap, no efficiency
 * tax. Anything longer is an offline chunk.
 *
 * A few times the refresh interval, so a closed app looks identical to a dead network — the
 * correct failure direction (degrades to offline rules, never inflates).
 */
export const ONLINE_THRESHOLD_MS = HQ_REFRESH_INTERVAL_MS * 3 // UNTUNED ╧

/**
 * Gap after which the player's session has ended: Hero Quest opens on its splash and waits for
 * Start. Presentation only, it gates no reward: a gap is settled offline the moment it passes
 * `ONLINE_THRESHOLD_MS`, whether anyone presses Start or not. Longer than that threshold on
 * purpose, so a short break drops straight back into the fight. Locked at an hour (the user's
 * call, 2026-10-02): a decision, not a placeholder awaiting play data.
 */
export const HQ_SESSION_TIMEOUT_MS = 60 * 60_000

// ── Automatic boss engagement ──────────────────────  tech-architecture.md §4b
//
// A boss fires on its own while `document.visibilityState` reads `visible` — the same presence the
// refresh interval demonstrates. A backgrounded or closed tab never engages one, so "bosses
// require the player to be present" holds.

/**
 * Kills of margin the client waits for before firing an automatic engage.
 *
 * **Not cosmetic, and not a debounce.** The client projects kills fractionally so a bar moves
 * smoothly; `settle()` floors its budget into whole kills. The client therefore crosses a stage
 * boundary up to one kill early, and an engage sent in that window is rejected by
 * `boss/engage.post.ts`. Waiting a full kill guarantees the server's count has crossed too.
 */
export const AUTO_ENGAGE_GRACE_KILLS = 1

/**
 * Floor and ceiling on the resulting wait, in seconds. The floor covers request latency where a
 * kill takes almost no time; the ceiling stops a deep stage's long `secondsPerKill` making the
 * gate feel broken, and is safe because a rejected engage is retried rather than surfaced.
 */
export const AUTO_ENGAGE_MIN_DELAY_SECONDS = 1
export const AUTO_ENGAGE_MAX_DELAY_SECONDS = 10

/**
 * How long after a rejected automatic engage to try again. A rejection means the client ran ahead
 * of the server, so it is swallowed and retried rather than toasted — see `useHqAutoBoss`.
 */
export const AUTO_ENGAGE_RETRY_SECONDS = 3

/**
 * How long an automatically-engaged replay holds on its outcome before closing itself. A
 * *manually* engaged fight never auto-closes — the player dismisses it themselves.
 */
export const AUTO_ENGAGE_REPLAY_HOLD_SECONDS = 2.5

// ── Gacha ──────────────────────────────────────────  gacha-shared-system.md §2–6
//
// Shared by all four gachas — Champions, Gear, Skills and Artifacts use every constant below
// unchanged, which is the point of the single `hqCollection` table.

/**
 * Pulls needed to advance a gacha from level L to L+1, indexed by L (1-based; index 0 unused).
 *
 * **Doc-specified table, not a live formula.** `gacha-shared-system.md` §2 rounds
 * `roundDown(10 × 2.6^(L-1) × 1.5)` "to a clean denomination" and locks the rounded values, so
 * they are transcribed; the raw formula does not reproduce them.
 *
 * Cumulative to max a single gacha at level 10: 50,240 pulls.
 */
export const PULLS_TO_LEVEL_UP: readonly number[] = [
    0, 10, 30, 100, 200, 600, 1_700, 4_600, 12_000, 31_000
]

export const MAX_GACHA_LEVEL = 10

/**
 * Drop rates by gacha level, `[common, uncommon, rare, epic, legendary, mythic]`.
 *
 * Index 0 is unused so the level indexes directly. Every row must sum to exactly 100% —
 * enforced in `test/hero-quest/content.spec.ts`, not asserted at boot.
 */
export const DROP_RATE_TABLE: readonly (readonly number[])[] = [
    [],
    [100.0, 0, 0, 0, 0, 0],
    [75.0, 25.0, 0, 0, 0, 0],
    [47.0, 43.0, 10.0, 0, 0, 0],
    [19.0, 56.0, 23.0, 2.0, 0, 0],
    [18.8, 32.0, 37.0, 12.0, 0.2, 0],
    [19.0, 22.0, 24.0, 34.0, 0.8, 0.2],
    [10.0, 10.0, 14.0, 60.0, 5.2, 0.8],
    [10.0, 10.0, 12.1, 54.5, 12.0, 1.4],
    [10.0, 10.0, 10.0, 49.0, 18.8, 2.2],
    [10.0, 10.0, 10.0, 42.0, 25.0, 3.0]
]

/**
 * Flat power multiplier per rarity, in ladder order (Common → Mythic).
 *
 * Doc-specified (`champions-guild-gacha.md` §2) and reused verbatim by Gear and Artifacts.
 * `gacha.ts` keys it onto the rarity ladder; nothing indexes this array directly.
 *
 * ⚠ Every adjacent ratio must stay under `RARITY_ADJACENT_RATIO_CEILING`.
 */
export const RARITY_STAT_MULTIPLIERS: readonly number[] = [1.0, 1.15, 1.35, 1.6, 2.0, 2.5]

/**
 * The ceiling Gear's Rarity Progression Guarantee imposes on adjacent rarity multipliers
 * (`gear-equipment.md` §2).
 *
 * Both promises the doc makes — a scalar-50 current-tier piece beats a scalar-1 next-tier one, and
 * a maxed scalar-60 piece beats a scalar-10 next-tier one — reduce to this constraint, the second
 * being the binding one. Whoever retunes `RARITY_STAT_MULTIPLIERS` has to respect it or silently
 * break the promise that investment is never wasted.
 */
export const RARITY_ADJACENT_RATIO_CEILING = 6

/**
 * Rarity epithets, in ladder order (`champions-guild-gacha.md` §5).
 *
 * The middle word of every Champion's display name, and the entire naming scheme for Gear
 * (`<Epithet> <Slot>`).
 */
export const RARITY_EPITHETS: readonly string[] = [
    'Novice', 'Adept', 'Veteran', 'Vanguard', 'Exalted', 'Ascendant'
]

/** 1 Seal per pull; a 10-pull is 9 Seals but still counts as 10 toward gacha leveling. */
export const SINGLE_PULL_COST = 1
export const TEN_PULL_SIZE = 10
export const TEN_PULL_COST = 9

/**
 * dupesToLevelUp(star, level) = round(min((star × 10 + level) × DUPE_LEVEL_FACTOR, DUPE_LEVEL_CAP))
 *
 * `1.618` is the golden ratio, per the doc. The cap binds fast — everything from 1★ Lv3 onward
 * is a flat 20 — which keeps a full 0★→5★ Lv10 max at 1,066 dupes.
 */
export const DUPE_LEVEL_FACTOR = 1.618
export const DUPE_LEVEL_CAP = 20

/** Items start at 0★, 10 levels per star, 5★ Lv10 is maxed. */
export const MAX_STAR = 5
export const LEVELS_PER_STAR = 10

/**
 * Essence gained per post-max duplicate, and the Essence price of crafting, by rarity index.
 *
 * Both ladders are ×5 per tier, and a rarity's craft cost is exactly 5× its own dupe value — so
 * 15,625 Common duplicates buy one hand-crafted Mythic.
 */
export const ESSENCE_VALUE_PER_RARITY: readonly number[] = [1, 5, 25, 125, 625, 3_125]
export const CRAFT_COST_PER_RARITY: readonly number[] = [5, 25, 125, 625, 3_125, 15_625]

/**
 * Champion party slots, bought with Void Shards in the prestige shop
 * (`champions-guild-gacha.md` §1). Starts at 2, caps at 5, so 3 levels to buy.
 */
export const BASE_CHAMPION_SLOTS = 2
export const MAX_CHAMPION_SLOTS = 5
export const CHAMPION_SLOT_BASE_COST = 400 // UNTUNED ╧
export const CHAMPION_SLOT_COST_GROWTH = 3 // UNTUNED ╧

/** The flat 3-front / 3-back grid (`classes-and-combat.md` §6). Capacities, not quotas. */
export const FORMATION_ROW_CAPACITY = 3

/**
 * The §7 passive collection bonus, per point of a copy's `(star × 10 + level)` scalar.
 *
 * Multiplicative on the Hero's own stat, and paid by **every owned Champion whether or not it is
 * fielded** — pulling broadly and levelling everything has value independent of which 2–5 you
 * field.
 *
 * `champions-guild-gacha.md` §7 fixes the shape (which archetype buffs which Hero stat) but no
 * magnitude. At 0.002 one maxed Champion (scalar 60) is +12% to its archetype's stats, and the
 * 48-Champion roster fully maxed (12 per archetype) is +144% on each of the six.
 */
export const CHAMPION_PASSIVE_PER_POINT = 0.002 // UNTUNED ╧

/**
 * Free 10-pulls, per gacha, per day — **the only free pulls in the game** (revised 2026-09-16).
 *
 * The time-gated Seal drip that used to sit here is **gone**: a batch of every Seal type every 24
 * hours, banking up to a week, paid whether or not the player ever opened the gacha. It made Seals
 * something a clock handed out rather than something earned or bought, and it stacked with this
 * entitlement so the free allowance arrived through two unrelated mechanisms. Free Seals now come
 * only from progression milestones (below); everything else is bought with Gold, which is what
 * makes the Seal ladder a real choice.
 *
 * A **true entitlement, not Seals**: it must be spent as a 10-pull and cannot be banked or split
 * into singles, because the point is the 10-pull *moment* rather than the pull count.
 *
 * The cooldown gates the gap between claims, so an active player collects all of them inside half
 * an hour and an idle one still finds them waiting. A re-engagement hook on a game whose premise
 * is not having to re-engage — worth watching in play.
 *
 * A gacha gets 30 free pulls per day and no free Seals, ×4 systems. **30 a day is the intended
 * hard ceiling** for a player who never buys Seals — accepted 2026-09-16, not a consequence to
 * repair.
 *
 * **Both are TUNED, and they are a pair.** Their product is the daily free allowance — 30 pulls
 * per gacha — and the cooldown alone decides how long a session has to run to collect it (3 claims
 * 10 minutes apart is ~20 minutes, so one sitting takes the lot; at the old 30 it was an hour and
 * most of it went unclaimed). Raising the count without dropping the cooldown makes the tail of
 * the allowance unreachable in a single session; dropping the cooldown without raising the count
 * just hands the same 2 pulls over faster. Set by decision on the session-1 playtest, not measured
 * on the campaign sim — the sim walks combat and does not model pull cadence, so `sim:hero-quest`
 * has nothing to say about either. Coupled downward to the Seal ladder (`SEAL_LADDER_BASE_GOLD`):
 * free pulls are now the only free supply, so moving them moves how soon Gold-bought Seals matter.
 */
export const FREE_PULLS_PER_DAY = 3 // TUNED ✓
export const FREE_PULL_COOLDOWN_MINUTES = 10 // TUNED ✓

/**
 * Milestone Seal grants (`economy-and-currencies.md` §5, source 1).
 *
 * Tied to core-progression milestones rather than any gacha's own progress, so a milestone grants
 * **all four Seal types at once**. The doc defers the list and sizes and gives only a shape —
 * "small batches per World clear, larger batches per Prestige completion" — which is all these are.
 */
export const SEAL_GRANT_PER_BOSS = 1 // UNTUNED ╧
export const SEAL_GRANT_PER_WORLD_CLEAR = 3 // UNTUNED ╧
export const SEAL_GRANT_PER_PRESTIGE = 10 // UNTUNED ╧

// ── Gear / The Forge ───────────────────────────────  gear-equipment.md §1–3

/**
 * Per-slot magnitude of an **equipped** piece, per point of the `(star × 10 + level)` scalar:
 *
 *     equippedBonus(slot, rarity, star, level)
 *         = SLOT_BASE_BONUS[slot] × RARITY_STAT_MULTIPLIER[rarity] × (star × 10 + level)
 *
 * Six independent dials (`gear-equipment.md` §2): the six stats plug into different downstream
 * formulas with no shared natural scale. Expressed as a **fraction of the stat**; at 0.01 a maxed
 * Mythic piece (60 × ×2.5) is +150% and a fresh Common +1%.
 *
 * Identical for now because no doc ranks the stats against each other; differentiating them is a
 * one-line edit here.
 */
export const SLOT_BASE_BONUS: Readonly<Record<string, number>> = { // UNTUNED ╧
    weapon: 0.01,
    boots: 0.01,
    gauntlets: 0.01,
    charm: 0.01,
    armor: 0.01,
    helmet: 0.01
}

/**
 * What **every owned** piece contributes, equipped or not, per point of the same scalar
 * (`gear-equipment.md` §3):
 *
 *     passiveBonus = GEAR_PASSIVE_COEFFICIENT × RARITY_STAT_MULTIPLIER[rarity] × (star×10+level)
 *
 * Mirrors the Champion collection passive. An order of magnitude under `SLOT_BASE_BONUS`, or
 * manual equip would stop mattering.
 */
export const GEAR_PASSIVE_COEFFICIENT = 0.001 // UNTUNED ╧

// ── Skills / Training Grounds ──────────────────────  skills-gacha.md §3–6

/** Hero-only Skill slots, bought with Void Shards. 2 → 5, mirroring Champion slots (§6). */
export const BASE_SKILL_SLOTS = 2
export const MAX_SKILL_SLOTS = 5
export const SKILL_SLOT_BASE_COST = 400 // UNTUNED ╧
export const SKILL_SLOT_COST_GROWTH = 3 // UNTUNED ╧

/**
 * Magnitude of a Skill passive's stat line, by rarity.
 *
 * `skills-gacha.md` §4 authors all 36 in prose — "small" through "large" — with no numbers. The
 * relative ordering is the design content, so retune the set rather than individual entries.
 */
export const SKILL_PASSIVE_MAGNITUDE: readonly number[] = [ // UNTUNED ╧
    0.05, 0.08, 0.12, 0.16, 0.22, 0.30
]

/**
 * Economy lines are held to this fraction of a stat line's magnitude — `gold-economy.md` §5's
 * "keep Gold-granting bonuses small" given a number. Gold survives every prestige and compounds
 * forever, where a stat bonus is re-earned each run. §5's target is a maximal dedicated stack
 * around ×3 (×5 worst case); this keeps the Skills half inside it.
 */
export const SKILL_ECONOMY_COEFFICIENT = 0.4 // UNTUNED ╧

/**
 * What one point of a Skill copy's `(star × 10 + level)` scalar adds to its **effect potency**.
 *
 *     potency(star, level) = 1 + (star × 10 + level − 1) × SKILL_POTENCY_PER_POINT
 *
 * `skills-gacha.md` never says Skills read the scalar; this closes that gap on the terms Gear,
 * Artifacts and the Champion passive already use.
 *
 * **Identity at minimum**, like `championInvestmentMultiplier` and unlike the proportional
 * `artifactLineMagnitude`: Skills are authored as complete qualitative bands, so a proportional
 * curve would make a fresh Mythic 1/60th of its described strength. At 0.02 a maxed copy is ×2.18.
 * Separate from `CHAMPION_INVESTMENT_PER_POINT` because a Skill already carries a rarity band while
 * a Champion's scalar is its only growth axis.
 *
 * Magnitudes only — damage multipliers, heals, shields, status strengths, bursts. **Not**
 * durations, cooldowns, hit counts or stack thresholds: see `scaleEffect`.
 */
export const SKILL_POTENCY_PER_POINT = 0.02 // UNTUNED ╧

/**
 * What **every owned** Passive Skill contributes, equipped or not (additive since 2026-10-04), as a
 * fraction of what the same copy gives equipped — the Skills half of the collection passive Gear and Champions already have.
 *
 * Decided 2026-09-15, not transcribed: `skills-gacha.md` granted unequipped Skills nothing. 0.1
 * mirrors Gear's equipped-to-passive ratio (`GEAR_PASSIVE_COEFFICIENT / SLOT_BASE_BONUS`), so
 * owning is worth something and equipping well is worth ten times more.
 *
 * **Hero only, and combat-stat lines only** (`COLLECTION_PASSIVE_KINDS`) — economy and cooldown
 * lines stay equipped-only, or a wide collection would stack Gold% and cooldown reduction from
 * slots nobody chose. Active Skills carry no stat lines, so an unequipped Active adds nothing.
 */
export const SKILL_COLLECTION_PASSIVE_FRACTION = 0.1 // UNTUNED ╧

/**
 * Gold burst size, in **minutes of current income**, by rarity.
 *
 * `gold-economy.md` §6 requires flat-Gold effects to be a duration of income rather than a fixed
 * amount, which keeps Coin Toss correctly sized at any prestige with no retuning. The doc's
 * "Coin Toss ≈ 0.5–2 minutes' worth" anchors the bottom of this ladder.
 */
export const GOLD_BURST_MINUTES: readonly number[] = [ // UNTUNED ╧
    0.5, 1, 2, 3, 5, 8
]

/**
 * Cooldown of the pure-economy Actives — Coin Toss and Prospector's Instinct.
 *
 * **Its own constant, not `SKILL_BASE_COOLDOWN_SECONDS`.** A burst in minutes of income is only
 * meaningful against a cadence: at the shared 6.4s base, Coin Toss's 0.5 minutes would be ~+470%
 * Gold income continuously, far past §5's ×3 stack target. These deal no damage, so a long
 * cadence is the price of trading combat for economy.
 *
 * A decision, not a transcription — no doc assigns skill cooldowns.
 */
export const GOLD_BURST_COOLDOWN_SECONDS = 120 // UNTUNED ╧

/**
 * How much shorter a "chance to refund / reset / re-trigger" Active's cooldown is rendered as.
 *
 * Executioner's Edge, Ragnarok Strike and Fortune's Gambit carry such a clause, and there is no
 * on-kill trigger or cooldown-mutation channel to express it. All three become a permanently
 * shorter cooldown, which is what the clauses buy on average.
 */
export const SKILL_COOLDOWN_REFUND_FRACTION = 0.25 // UNTUNED ╧

/**
 * The Gambler's Strike family's bounded wealth factor (`skills-gacha.md` §4¹,
 * `gold-economy.md` §8).
 *
 *     damage = PWR × abilityMultiplier × wealthFactor(bankedGold / goldPerHour)
 *
 * Clamped at both ends so the modulation can neither trivialise combat nor decay to irrelevance.
 * §4¹ suggests ×0.5–×2.0 and calls it "not locked". `WEALTH_NEUTRAL_HOURS` is where the factor
 * passes through exactly 1.0.
 */
export const WEALTH_FACTOR_MIN = 0.5 // UNTUNED ╧
export const WEALTH_FACTOR_MAX = 2.0 // UNTUNED ╧
export const WEALTH_NEUTRAL_HOURS = 4 // UNTUNED ╧

// ── Artifacts / Dig-site ───────────────────────────  artifacts-dig-site-gacha.md §3, §7

/** Party-wide Artifact slots, Void Shards, 2 → 5 over 3 levels (§7). Same shape as the others. */
export const BASE_ARTIFACT_SLOTS = 2
export const MAX_ARTIFACT_SLOTS = 5
export const ARTIFACT_SLOT_BASE_COST = 400 // UNTUNED ╧
export const ARTIFACT_SLOT_COST_GROWTH = 3 // UNTUNED ╧

/**
 * Magnitude of one Artifact effect line, per point of the `(star × 10 + level)` scalar (§6).
 *
 * **Proportional** to the scalar, as §6 states — unlike Skills, which are identity-at-minimum
 * (`SKILL_POTENCY_PER_POINT`). Rarity multiplies on top, so a maxed Mythic line is
 * 60 × ×2.5 × 0.004 = +60%.
 */
export const ARTIFACT_EFFECT_PER_POINT = 0.004 // UNTUNED ╧

/**
 * The same "keep Gold small" throttle as Skills', applied to Artifact economy lines. Separate
 * because the two systems have different slot counts and stacking rules (§4 allows five Offense
 * Artifacts at once), so they contribute differently to §5's ×3 stack target.
 */
export const ARTIFACT_ECONOMY_COEFFICIENT = 0.3 // UNTUNED ╧

/**
 * What **every owned** Artifact contributes, equipped or not (additive since 2026-10-04), as a
 * fraction of its equipped line magnitude — the Artifact twin of `SKILL_COLLECTION_PASSIVE_FRACTION`, and decided on the same
 * terms: 0.1 mirrors Gear, combat-stat lines only.
 *
 * **Hero only, unlike an equipped Artifact.** Equipped Artifacts are party-wide by identity
 * (§1); a benched one joins the Champion and Gear passives, which reach only the Hero. A
 * party-wide collection passive would multiply a wide collection by party size.
 */
export const ARTIFACT_COLLECTION_PASSIVE_FRACTION = 0.1 // UNTUNED ╧

// ── Loadouts ───────────────────────────────────────  loadouts.md §3

/**
 * Saved Loadout slots. Starts at 2, caps at 6 — **4 purchase levels, priced in Gems**. `loadouts.md`
 * §3 says 10; cut to 6 on 2026-10-04 (the user's call, `open-items.md` #40).
 *
 *     cost(level) = LOADOUT_SLOT_BASE_COST_GEMS × 2^(level-1)
 *
 * The only slot track not priced in Void Shards: every other slot track gates party power, while a
 * Loadout slot only saves taps. Pure convenience, so it takes the convenience currency.
 *
 * ⚠ The doc flags the doubling's first pairing with Gems as an unknown; at 4 levels the top step is
 * 8× the base. Worth the balance script's specific attention.
 */
export const BASE_LOADOUT_SLOTS = 2
export const MAX_LOADOUT_SLOTS = 6
export const LOADOUT_SLOT_BASE_COST_GEMS = 250 // UNTUNED ╧
export const LOADOUT_SLOT_COST_GROWTH = 2

// ── Prestige shop stat tracks ──────────────────────  open-items.md #41

/**
 * Four uncapped prestige-shop tracks, one each for PWR, DEF, IMP and VIT: a Void Shard sink for
 * after (or before) the capped tracks are done. Every level adds the same flat share to that stat
 * for the whole fielded party, summed with equipped Artifacts' party-wide lines; the price climbs
 * geometrically, so the sink never closes and each level is worth what the last one was.
 *
 *     cost(level) = PRESTIGE_STAT_BASE_COST × PRESTIGE_STAT_COST_GROWTH^(level-1)
 *
 * SPD and LCK are left out on purpose: attack speed floors at `MIN_ATTACK_INTERVAL_SECONDS` and
 * crit chance clamps at 1, so an uncapped track on either would run into its ceiling and stop.
 *
 * ⚠ Nothing in the campaign sim buys these, so the tuned pacing does not account for them yet.
 */
export const PRESTIGE_STAT_PER_LEVEL = 0.01 // UNTUNED ╧
export const PRESTIGE_STAT_BASE_COST = 100 // UNTUNED ╧
export const PRESTIGE_STAT_COST_GROWTH = 1.15 // UNTUNED ╧

/** Bounds the persisted name so a save cannot write an unbounded string into jsonb. */
export const LOADOUT_NAME_MAX_LENGTH = 32

/**
 * The daily escalating Gold ladder for extra Seals (`gold-economy.md` §7). Per-gacha independent
 * counter, one shared reset date.
 *
 *     price(n) = SEAL_LADDER_BASE_GOLD × SEAL_LADDER_GROWTH[system]^n
 *
 * where `n` is how many of *that* gacha's Seals were already bought with Gold today.
 *
 * 1.2 for all four, set by feel on 2026-10-04: a day's first 10-pull is ~21M, the fifth ~14.7B, so
 * Gold buys a few 10-pulls a day rather than completing a roster. The old near-flat rates (1.0007,
 * 1.0011) made Gold the main route to completion and had stopped meaning anything once platform
 * Gold income moved; income itself is still to be rebalanced (`open-items.md` #23).
 */
export const SEAL_LADDER_BASE_GOLD = 1_000_000
export const SEAL_LADDER_GROWTH: Readonly<Record<string, number>> = {
    gear: 1.2,
    champion: 1.2,
    skill: 1.2,
    artifact: 1.2
}

// ── Global Power Number ────────────────────────────  global-power-number.md §2

/**
 * How much DEF multiplies effective HP in the Global Power Number:
 *
 *     memberEHP = maxHp × (1 + DEF / EHP_DEF_CONSTANT) / (1 − EVA)
 *
 * **Not combat's `K`.** Mitigation is relative to an attacker's PWR and means nothing without one;
 * GPN needs an absolute "how much punishment can this party take", so DEF converts straight into
 * an EHP multiplier. At 10 a level-1 Hero's DEF doubles its EHP. DEF rides the level curve like HP
 * does, so EHP grows as the stat curve squared — the same order as DPS, which keeps the geometric
 * mean from leaning on either side.
 */
export const EHP_DEF_CONSTANT = 10 // UNTUNED ╧

/**
 * The flat multiplier on the Global Power Number's display value:
 *
 *     GPN = √(partyEffectiveDPS × partyEffectiveEHP) × GPN_DISPLAY_SCALE
 *
 * **Presentation only.** The root keeps GPN the same order of magnitude as either input rather
 * than their product, so it still reads as a stat rather than as a balance; the scale then lifts
 * it clear of the stats it is made of, so nobody mistakes it for one. Both are monotonic, so
 * neither changes which party ranks above which — only how big the number reads. At 10 a fresh
 * level-1 Hero opens just under 1,000 and crosses it in the first few levels, which is the
 * intended feel: a number that is already big and visibly climbs.
 *
 * Arena matchmaking bands are taken on this value, so a percentage band means the same thing
 * before and after the scale — a flat factor cancels in a ratio.
 */
export const GPN_DISPLAY_SCALE = 10 // UNTUNED ╧

// ── Prestige currency ──────────────────────────────  economy-and-currencies.md §3

/**
 * voidShardsEarned(prestigeCompleted) = VOID_SHARD_BASE × VOID_SHARD_GROWTH^prestigeCompleted
 *
 * Paid only on a full World 10 / Stage 10 clear — no partial credit. Both values are the doc's
 * "starting point", not a decision. `VOID_SHARD_GROWTH` only has to outpace shop costs, not the
 * power curve, so it stays well below `ENEMY_CURVE_T`.
 *
 * Decimal, not integer — `2^prestige` overflows a 64-bit bigint around prestige 56, which an
 * infinite-prestige game reaches.
 */
export const VOID_SHARD_BASE = 100 // UNTUNED ╧
export const VOID_SHARD_GROWTH = 2 // UNTUNED ╧
