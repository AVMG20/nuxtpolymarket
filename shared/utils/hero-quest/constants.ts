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

import type { HqStatKey, StatTier, TraitGrade, TraitSetId, TraitStatId } from './types'
import type { HolidayId } from './content/holidays'

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
 * (2026-10-03), not a measurement: 5 s then, 3 s since 2026-10-11 (the user's call).
 */
export const WIPE_RECOVERY_SECONDS = 3

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
 * None (the user's call, 2026-10-09; it was 2): a boss fight is the boss alone, plus whatever adds
 * its own fight spawns. The pack code still takes any count, so an escort is one number away.
 */
export const BOSS_MINION_COUNT = 0

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
 * covers the party's DPS growth. 60 → 50 on 2026-10-12 with `XP_TO_LEVEL_BASE` (`open-items.md` #36): a
 * new party clears World 1 in about 20 minutes and the baseline first prestige takes about 4 days
 * (halved since by `XP_BASE_PER_KILL`).
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
export const BASE_ENEMY_HP = 50 // TUNED ✓
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

// ── Boss specials ──────────────────────────────────  open-items.md #45
//
// Every boss and super boss swings its special in place of a basic attack: on its first swing,
// then on the first swing after each cooldown. The shapes are `content/boss-specials.ts`; these
// are their magnitudes, one set for all twenty so the balance pass is one edit. A swing's worth
// takes a share of the target's max HP, past its DEF (2026-10-11, the user's call: as swings of PWR
// against DEF they landed ~1 damage at a gate's level, since the gates are DPS walls).

/** Seconds between specials. A gate fight is 30 s at one swing per 2.4 s, so about four land. */
export const BOSS_SPECIAL_COOLDOWN_SECONDS = 8 // locked 2026-10-11, the user's call
/** A spread special, per target, as a share of its max HP: it hits the whole party, so each share is light. */
export const BOSS_SPECIAL_SPREAD_HP_SHARE = 0.15 // locked 2026-10-11, the user's call
/** A heavy special, per target, as a share of its max HP: the later worlds' and super bosses' whole-party hits. */
export const BOSS_SPECIAL_HEAVY_HP_SHARE = 0.25 // locked 2026-10-11, the user's call
/** A focused special, per target, as a share of its max HP: it reaches one or two bodies, so it hits hard. */
export const BOSS_SPECIAL_FOCUS_HP_SHARE = 0.45 // locked 2026-10-11, the user's call
/** A burn's damage per status tick, as a share of what the special's hit landed. */
export const BOSS_SPECIAL_BURN_FRACTION = 0.15 // locked 2026-10-11, the user's call
export const BOSS_SPECIAL_BURN_SECONDS = 4 // locked 2026-10-11, the user's call
export const BOSS_SPECIAL_STUN_SECONDS = 1 // locked 2026-10-11, the user's call
export const BOSS_SPECIAL_SILENCE_SECONDS = 3 // locked 2026-10-11, the user's call
/** A slow, weaken or sunder: the share of SPD, PWR or DEF it takes off each target. */
export const BOSS_SPECIAL_DEBUFF_MAGNITUDE = 0.2 // locked 2026-10-11, the user's call
export const BOSS_SPECIAL_DEBUFF_SECONDS = 6 // locked 2026-10-11, the user's call
/** A draining special heals the boss this share of the damage it landed. */
export const BOSS_SPECIAL_DRAIN_FRACTION = 0.5 // locked 2026-10-11, the user's call

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

/**
 * Cap on total EVA (`classes-and-combat.md` §7), leaving headroom for EVA sources added after
 * Traits: a 5-piece Vital Reflex board reaches 0.50, ten points under it.
 */
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
 * Crit damage per point of IMP: IMP 10 → ×1.05.
 *
 * IMP rides the level curve, so this per-point rate on an exponentially growing stat is the only
 * thing bounding how fast the crit multiplier runs away. The *shape* — linear and unbounded in
 * IMP — is load-bearing; see `STAT_SCALES_WITH_LEVEL`.
 *
 * 0.02 → 0.005 on 2026-10-12, with `XP_TO_LEVEL_BASE` 10 → 46, balancing the first run around the
 * baseline Trait board (the user's call: Traits and the tree are required, so the pace assumes
 * them). That board, ATK and IMP at D with two pieces of Deep Impact, multiplies IMP about ×4, and
 * linear crit damage turned that into a lead that grew with level; at 0.02 it prestiged in 8 hours.
 * Measured with `--traits=atk:D:deep_impact,imp:D:deep_impact,champion_atk:D:aggression,
 * atk:D:aggression,imp:D:aggression --tree=cheapest`.
 */
export const CRIT_DAMAGE_PER_POINT = 0.005 // TUNED ✓

/**
 * LCK past 100% crit chance converts to crit damage at this rate. Must sit well below
 * `CRIT_DAMAGE_PER_POINT` — overflow is a "nothing wasted" valve, not a rival to IMP. Kept at half
 * of it when that dropped to a quarter (2026-10-12).
 *
 * Rarely reached: with LCK off the level curve only a deliberately built crit Hero passes 100%.
 * Cut `LCK_BASE_SCALE` much further and it stops firing at all.
 */
export const OVERFLOW_CONVERSION_RATE = 0.0025 // UNTUNED ╧

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
export const SKILL_COOLDOWN_RANK_STEP = 1.2 // locked 2026-10-11, the user's call

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

/**
 * The Ascendant's picked class skills (`capstone-class.md`): a master's kit size, so a master
 * reaches the same count down its one path that the Ascendant picks across all of them.
 */
export const ASCENDANT_KIT_SIZE = 4

/**
 * How much longer Convergence's cooldown is than a master skill's. Convergence fires all six
 * master skills at once, each at its own hit, so the volley pays `6 / factor` master skills'
 * damage per second.
 *
 * Bounded by `BOSS_TIMER_SECONDS`: a first cast waits a whole cooldown, and a boss fight is where
 * the player watches, so it has to land inside one. At 2 a master's 13.3 s becomes 26.5 s, and the
 * Ascendant's own SPD (21) brings it to ~15.6 s: once, mid-fight (the user's call over starting it
 * ready, 2026-10-09). At 6 it was ~55 s and never fired in a boss fight at all. ⚠ At 2 the volley
 * is three master skills' worth on top of the four picks, before any measurement.
 */
export const CONVERGENCE_COOLDOWN_FACTOR = 2 // locked 2026-10-11, the user's call

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
 *
 * 1 → 2 on 2026-10-13 (the user's call: progression felt too slow): every grind halves and the level
 * each World is cleared at doesn't move. With the earlier unlocks, measured **1.76 days** to the first
 * prestige on the baseline (`--unlocks`, was 4.03) and **10 minutes** for a new party's World 1 (was 20).
 */
export const XP_BASE_PER_KILL = 2 // TUNED ✓

/**
 * xpToNextLevel(level) = XP_TO_LEVEL_BASE × XP_TO_LEVEL_GROWTH^(level-1)
 *
 * Moves as a pair with `XP_BASE_PER_KILL` — see there. Declared ahead of the XP-income constants
 * because `XP_STEP_EXPONENT` is derived from `XP_TO_LEVEL_GROWTH`.
 *
 * 10 → 46 on 2026-10-12, with `CRIT_DAMAGE_PER_POINT`: moved here rather than on `XP_BASE_PER_KILL`
 * so XP stays in whole numbers. Set to a **5.5-day first prestige** (the user's call: players will
 * likely field better loadouts than the walk's, so the playtest says where it really lands) for a
 * party of three on the baseline (`open-items.md` #36): the Trait board, the tree, a Rare 0★ Lv2
 * kit and boss gates fought as live fights. Measured 5.46 days with
 * `--traits=… --tree=cheapest --kit=rare:0:2 --boss-fights=8`; 42 measured 4.98.
 *
 * 46 → 38 the same day, with `BASE_ENEMY_HP` 60 → 50 (the user's calls): **a 4-day first prestige**
 * on that baseline with Traits and the tree opening on their schedule (`--unlocks`), measured 4.04
 * days, and **World 1 in about 20 minutes** for a new party of three on Common 0★ Lv1 kit, measured
 * 20 min. The old pair measured 6.4 days and 45 minutes on the same walks.
 */
export const XP_TO_LEVEL_BASE = 38 // TUNED ✓

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
 * Gold per kill at the very first stage, before the progression factor. **The level of the
 * progression-bound regime and nothing else**: `GOLD_TENURE_CEILING` is generated by dividing by
 * it, so `BASE_GOLD × ceiling` — what a ceiling-bound account earns — does not move with it.
 * Regenerate the ceiling whenever it moves (`bun run balance:compare --emit-hq-ceiling`).
 *
 * Set with `GOLD_STEP_BASE` as a pair, 2026-10-12 (the user's call via issue #10, `open-items.md`
 * #23.3): **a first-week account earns about a quarter of what the platform's idle games pay at
 * the same age.** Measured on the campaign walk's party of three (`bun run sim:hero-quest
 * --report=gold --party=3`): ~24% of platform income across the first week, ~20% at day 3, ~22%
 * at day 7, peaking near 70% around hour 12 while the platform's own day-one income is still tiny.
 * It was 0.4, which left the walk at 0.07% of platform.
 *
 * Trades against Gold's place on the platform: Hero Quest Gold is the shared coin, so a first
 * week near platform rates would make a new Hero Quest account the platform's best new-account
 * Gold farm, while far below it Gold reads as no income at all and buys nothing in week one.
 * Coupled to run pacing — re-measure when the first prestige moves (`open-items.md` #36).
 */
export const BASE_GOLD = 1 // TUNED ✓

/**
 * Gold's progression curve, on the same continuous index the enemy rides:
 *
 *     GOLD_STEP_BASE^n,  n = prestige × 100 + (world-1) × 10 + (stage-1)
 *
 * One base over one index has no seam at a world or prestige boundary, so looping back to
 * World 1 never cuts Gold per kill.
 *
 * It needs no cap of its own: `goldPerKill` takes the `min` of this and the tenure ceiling, so
 * the ceiling bounds Gold at every position. It sets **how fast progress earns its way up to the
 * ceiling**, and so how much falling behind on power costs.
 *
 * 1.075, set with `BASE_GOLD` on 2026-10-12 (issue #10, `open-items.md` #23.3). The platform's
 * income climbs ~21× from day 1 to day 7 while the walk's party of three moves from World 6 to
 * World 9, so a shallow base falls off the platform within days: at 1.017 the walk went from 14%
 * of platform in its first hour to 0.05% by day 9, progression-bound throughout. 1.075 is the
 * slope that holds the walk at roughly a fifth to a quarter of platform across days 3–7 without
 * passing the ceiling in its first day; steeper lifts days 7–30 toward the ceiling, shallower
 * needs a larger `BASE_GOLD` and front-loads the first day.
 *
 * 1.075 → 1.065 the same day, re-measured on the new pace (`open-items.md` #36: the baseline Trait
 * board, tree and Rare 0★ Lv2 kit, first prestige 5.46 days). The faster run reached deeper stages
 * sooner, so 1.075 paid 38–53% of platform across days 3–7 and hit the ceiling at hour 9. 1.065 puts
 * days 3.8–5.5 at about 25% and day 7.8 at 36%, never ceiling-bound in week one, and ceiling-bound
 * from about day 60, so the month-3 and month-6 anchors hold.
 *
 * 1.065 → 1.0575 the same day, re-measured on the 4-day pace (`open-items.md` #36, with Traits and
 * the tree on their unlock schedule): 1.065 paid ~41% of platform at days 3–4 and 53–60% at days
 * 5–8. 1.0575 puts days 3–8 at 21–26%, and the ceiling binds by day 90, so the anchors hold.
 *
 * 1.0575 → 1.05 on 2026-10-13 (the user's call), on the 1.8-day pace (`XP_BASE_PER_KILL` 2): 1.0575
 * hit the ceiling from hour 7 and paid 45–99% of platform for a month. 1.05 is never ceiling-bound
 * before day 90 and earns the walk's month what the 4-day pace did (1.29B against 1.38B): 50–77% of
 * platform on day one, 25–33% from day 3. Swept: 1.045 → 13–20% from day 3, 1.04 → 6–11%.
 *
 * **Kept under `ENEMY_STEP_BASE` (1.08)**, so Gold still grows more slowly than the enemy it is
 * earned from (`settle.spec.ts`). A Beginner party of three never reaches the ceiling in its
 * first month; a party of six does by about day 12. Coupled to run pacing like `BASE_GOLD`.
 */
export const GOLD_STEP_BASE = 1.05 // TUNED ✓

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
 * **Measured on the campaign walk**, `bun run sim:hero-quest --report=gold --grind-hours=200`:
 * **405 kills/hour solo, 430 for a party of three, 423 for a party of six** (re-measured
 * 2026-10-12, issue #10; 25–31-day walks, 12½ for the party of six). It was 523 / 617 / 620 on
 * 2026-09-16 and 600 here; the cooldown ladder (#36), wipe recovery (#37) and boss specials (#45)
 * lengthened the grind since, and at 600 a ceiling-bound account earned 0.71× the ceiling's
 * stated rate, so "0.85× platform" was really 0.60×. That it barely moves across party sizes is
 * the pacing model working — `ENEMY_PACE_RATIO` and `FIGHT_LENGTH_DRIFT` hold fight length
 * roughly constant, so a bigger party kills faster *and* walks deeper, and the rate converges.
 * 420 is a round number inside that band; the spread is wider than the last digit, so precision
 * here would be false.
 *
 * ⚠ **What this trades away.** `MIN_SECONDS_PER_KILL` was in the derivation because a bounded
 * per-kill value times an unbounded kill rate is unbounded income. Calibrating to the typical rate
 * means anything that lifts the real rate above 420/hr earns proportionally more than platform.
 * The floor still bounds the worst case at `3600 / MIN_SECONDS_PER_KILL ÷ this` = **~17×** (12×
 * at 600), so the old calibration did not vanish — it stopped describing normal play and became
 * the bound on the extreme. Battle Speed does not reach past it: a boosted window's Gold is held
 * to `maxGoldPerHour` over its real time (`settle`, 2026-10-11).
 *
 * Coupled to `GOLD_TENURE_CEILING`, which must be regenerated whenever this moves
 * (`bun run balance:compare --emit-hq-ceiling`), and to nothing else — combat never reads it.
 * Re-measure it whenever run pacing moves (`open-items.md` #36).
 */
export const GOLD_REFERENCE_KILLS_PER_HOUR = 420 // TUNED ✓

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
    9.854, 21.25, 26.53, 42.38, 114.4, 150.1, 618.5, 1078, 1920, 4928, 7614, 22100, 30490, 74530, 117900, 195500
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
 * At a ten-year horizon the worst-case collect (×4 Gold stack, the throughput floor, a full
 * 72-hour offline window; Battle Speed is held under the bound) is ~1.9e12, clearing
 * `numeric(19,4)` by ~2.7 orders of magnitude. `gold-economy.md` §9.4 asks for three; the spec
 * asserts two and says why (`open-items.md` #23).
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

// ── Raids ──────────────────────────────────────────  raid-system.md

/** Keys granted per raid per day, banking up to `RAID_KEY_BANK_DAYS` of them (21). Locked, §3. */
export const RAID_KEYS_PER_DAY = 3
export const RAID_KEY_BANK_DAYS = 7

/**
 * What a raid clear pays (§6), in the raid's own currency: `BASE × GROWTH^(level − 1)`, each raid
 * on its own growth.
 *
 * Set by the user on 2026-10-04: 3 Seals at level 1 for the four Seal raids (three clears a day is
 * about one 10-pull), 10 Trait Gems for the Trait Raid (two cheap rolls; 100 since 2026-10-10), all +3%
 * a level. Kept gentle because the ladder is slow to climb: a raid level costs a world of account
 * growth, so level 100 takes the power of about ten prestiges (`build-log.md`).
 *
 * The Trait Raid climbs +8% a level since 2026-10-15 (issue #34): at +3% its base of 100 went
 * 100 → 123 from level 1 to 8, under five extra Rolls for seven levels. At +8% a level is +8 Gems
 * (more than a Roll a clear) at level 1, and a prestige's ten levels about double a clear:
 *
 *     level        1    5    8   10   20   30     50       100
 *     Gems/clear 100  136  171  200  432  932  4,343   203,682
 *
 * Against the Roll (5 Trait Gems, +5 a lock), simulated with a lock on every hit (2026-10-15): five
 * A-or-better of any stat take ~7k Gems, five A-or-better ATK ~65k and five SS-or-better ATK ~450k.
 * On three clears a day that is three weeks to the first at level 1, ~110 days to the second at
 * level 10 and ~23 at level 30, and at level 50 the third in ~35 days. Trait Gems have no other
 * sink, so the deep ladder ending the chase is the trade for an early ladder that shows. The
 * calendar's Trait Gem days are sized off the level-1 reward (`calendarIncomePerDay`), which stays
 * 100, so they stay 106–261 Gems: a third to most of a day of level-1 clears, a bonus beside a
 * climbed ladder rather than a rival to it.
 */
export const RAID_REWARD_BASE: Readonly<Record<string, number>> = {
    raid_guild: 3,
    raid_training_grounds: 3,
    raid_dig_site: 3,
    raid_forge: 3,
    // 10x on 2026-10-10 (the user's call), so the calendar's Trait Gem days, sized off it, are 10x too
    raid_trait: 100
}
export const RAID_REWARD_GROWTH: Readonly<Record<string, number>> = {
    raid_guild: 1.03,
    raid_training_grounds: 1.03,
    raid_dig_site: 1.03,
    raid_forge: 1.03,
    // its own since 2026-10-15 (#34): +3% read flat on a 100-Gem base, see above
    raid_trait: 1.08
}
/**
 * The ladder's shape. `exponential` is the formula above; `stepped` pays `BASE` plus one more every
 * `RAID_REWARD_STEP_LEVELS` levels, the user's fallback should the deep levels prove too easy to reach.
 */
export const RAID_REWARD_SHAPE: 'exponential' | 'stepped' = 'exponential'
export const RAID_REWARD_STEP_LEVELS = 5

/** The Training Grounds round: how long the party has to hit the dummy. */
export const RAID_DUMMY_SECONDS = 30 // UNTUNED ╧
/**
 * Stages of account growth one dummy level asks for: a world each (the user's call, 2026-10-04),
 * so the dummy's level reads as how far the account has come, like the other raids' ladders.
 */
export const RAID_DUMMY_STAGES_PER_LEVEL = STAGES_PER_WORLD
/**
 * The damage a level takes, in wave packs of the stage that level stands for: level L needs this
 * many packs' HP of the stage at curve index `(L − 1) × RAID_DUMMY_STAGES_PER_LEVEL`.
 *
 * Measured on the campaign walk (party of three, 2026-10-04): at the level the walk clears each
 * world, a round deals 0.7–0.9 of a pack of the next world's first stage, all the way to prestige 1.
 * At 0.7 a fresh account stands at level 1 and an account that has cleared world w at about w + 1.
 * Coupled to `RAID_DUMMY_SECONDS`: a longer round deals more and wants this raised to match.
 */
export const RAID_DUMMY_PACKS = 0.7 // TUNED ✓

/** A raid boss's clock (§7 *Session Timer*): the fight is lost if the boss still stands when it runs out. */
export const RAID_ENRAGE_SECONDS = 30 // UNTUNED ╧
/*
 * The raid multipliers below were tuned before the raid bosses had specials. Re-measured with them
 * in (`RAID_BOSS_SPECIALS`, 2026-10-15, issue #36: the lowest level a party of three, or a Warrior
 * party of five, clears raid levels 1–10 at, 6 of 8 seeds): the Knight needs 1–2% more levels from
 * level 3 on (4–6% at level 2), the Forge 0–3% more, the Dig Site none, and the Beast reaches the
 * same level within a quarter. No party wiped to a special. Within the margin of a level, so the
 * multipliers stay as tuned.
 */
/**
 * The Gilded Knight: level L is the super boss of world L, alone (no escort), its HP and PWR
 * scaled by these, so the Knight's ladder climbs a world of account growth a level, as the
 * Training Grounds' does. Fixed by level, never by the account: the static difficulty of §2.
 */
export const RAID_KNIGHT_STAGES_PER_LEVEL = STAGES_PER_WORLD
/**
 * Measured on the campaign walk (party of three, eight seeds, 2026-10-05): at the level the walk
 * clears world w, the party beats Knight w 6–8 times in 8 in eight worlds of ten (world 3's clear is
 * itself borderline, 1 in 8), and one world earlier it never does, leaving 76–85% of his HP. At 1.0
 * it timed out at the clear level with ~24% left. Coupled to `RAID_ENRAGE_SECONDS`.
 */
export const RAID_KNIGHT_HP_MULT = 0.55 // TUNED ✓
export const RAID_KNIGHT_PWR_MULT = 1 // UNTUNED ╧

/**
 * The Dig Site (`reinforced_boss`): level L is the Deepcoil, world L's super boss scaled like the
 * Knight, with adds crawling up out of `RAID_DIG_BURROWS` burrows every `RAID_DIG_ADD_SECONDS`.
 * An add is an ordinary mob of the Deepcoil's depth times `RAID_DIG_ADD_HP_MULT`. The burrow count
 * is the stage's: it has three add bodies.
 */
export const RAID_DIG_STAGES_PER_LEVEL = STAGES_PER_WORLD
/**
 * Measured with the adds below on the campaign walk (party of three, eight seeds, 2026-10-05): at
 * the level the walk clears world w the party beats Deepcoil w 5–8 times in 8 (world 3's clear is
 * borderline, 1 in 8), and never one world earlier. The third wave at 24 s is the cliff a run
 * either beats or times out on, so the multiplier moves the win rate slowly; 0.42 was 3–6 in 8.
 */
export const RAID_DIG_HP_MULT = 0.32 // TUNED ✓
export const RAID_DIG_PWR_MULT = 1 // UNTUNED ╧
export const RAID_DIG_BURROWS = 3
export const RAID_DIG_ADD_SECONDS = 8 // UNTUNED ╧
/** At 1 a wave held the party ~15 s of the 30 and no level was winnable; at 0.25 one costs it ~3 s. */
export const RAID_DIG_ADD_HP_MULT = 0.25 // TUNED ✓

/**
 * God's Forge (`boss_gauntlet`, `raid-system.md` *Boss Gauntlet*): level L's three bosses are world
 * L's super boss scaled by `RAID_FORGE_HP_MULT` / `RAID_FORGE_PWR_MULT` and then by each one's step,
 * the Apprentice below 1, the Journeyman about 1, the Forgemaster above. The run's clock is
 * `RAID_ENRAGE_SECONDS`, with `RAID_FORGE_KILL_SECONDS` added back per boss killed (doc-specified).
 */
export const RAID_FORGE_STAGES_PER_LEVEL = STAGES_PER_WORLD
/**
 * Measured with the steps below on the campaign walk (party of three, eight seeds, 2026-10-05): at
 * the level the walk clears world w the party beats the Forge 6–8 times in 8 from world 4 on (world
 * 2 2 in 8, world 3 0 in 8, where the walk's own clear is borderline), and never one world earlier.
 */
export const RAID_FORGE_HP_MULT = 0.3 // TUNED ✓
export const RAID_FORGE_PWR_MULT = 1 // UNTUNED ╧
export const RAID_FORGE_BOSS_STEPS = [0.8, 1, 1.25] as const // UNTUNED ╧
export const RAID_FORGE_KILL_SECONDS = 10
/** How long after a Forge boss falls the next walks out: its death and the next's entry, on the stage. */
export const RAID_FORGE_HANDOFF_SECONDS = 2.5 // UNTUNED ╧

/**
 * Shardcaller Beast (`rampaging_boss`, `raid-system.md` *Rampaging Boss*). The doc's two curves,
 * `raidRampageDamageToLevel` and `raidRampageBossPower`, are exponential in the level; here both
 * ride the enemy curve, a level being a world as for every raid, so they track progression rather
 * than four free constants: level L's gauge is world L's super boss HP × `RAID_RAMPAGE_DMG_MULT`,
 * its PWR and DEF world L's super boss's, PWR × `RAID_RAMPAGE_POWER_MULT`.
 */
export const RAID_RAMPAGE_STAGES_PER_LEVEL = STAGES_PER_WORLD
/**
 * Measured as a set with the hidden clock on the campaign walk (party of three, 2026-10-05): a party
 * that has cleared world w reaches level w+1 in every world, its run over in 24–31 s. Scaling the
 * clock's bonus by the level (the user's call) is what holds it at w+1; flat, it crept to w+2 from
 * world 5 and runs took 34–53 s. Without the clock the power had to be ×20, or a party stalled a level or two up, neither
 * filling the gauge nor falling; the clock is what ends a stalled run now, so the power can sit at ×3.
 */
export const RAID_RAMPAGE_DMG_MULT = 0.15 // TUNED ✓
export const RAID_RAMPAGE_POWER_MULT = 3 // TUNED ✓
/** The Beast's hidden clock: its PWR gains (this^seconds − 1) × its level, on top of its level's. Never shown. */
export const RAID_RAMPAGE_CLOCK_GROWTH = 1.06 // TUNED ✓
/** The guard rail on a run (§7: no player-facing timer): a party that never falls stops here. */
export const RAID_RAMPAGE_CAP_SECONDS = 300

// ── Arena ──────────────────────────────────────────  arena.md
//
// Asynchronous PvP: the attacker's live party against another player's stored `defenseLoadout`,
// resolved by the shared duel sim (`duel.ts`). Everything here is applied by the server under the
// `hq_state` row locks (`server/utils/hero-quest-arena.ts`); `arena.ts` holds the pure rules.

/** Opponents on the list at once (§2). */
export const ARENA_CANDIDATE_COUNT = 3
/**
 * How close a defender's Rating must be to the attacker's to be drawn as a real candidate (§2,
 * `open-items.md` #2): within ±this many points, this season's Rating, a row not yet in it counting
 * as `ARENA_RATING_START` (the user's call, 2026-10-10: Rating, not GPN, so a loadout swap can't move
 * a player's band; early in a season strong and weak players meet, and a few matches part them). A
 * slot the band can't fill gets a Training Dummy (§2a) rather than a wider band. Checked only when
 * the list is drawn. ±200 until 2026-10-11, when the user narrowed it to ±100.
 */
export const ARENA_MATCH_BAND_RATING = 100 // locked 2026-10-11, the user's call
/**
 * Arena bots (`content/arena-bots.ts`): never above this Rating, so a player only climbs past them
 * (the user's call, 2026-10-11). They fill the list after real players and before Training Dummies.
 */
export const ARENA_BOT_RATING_MAX = 1000
/**
 * How a bot's loadout scales from the roster's lowest Rating (`low`) to `ARENA_BOT_RATING_MAX`
 * (`high`). The top bot stands where the Arena opens: World 6 on the campaign walk, a party of
 * three at about level 258. Beneath that it is a guess, as there is no player data yet.
 */
export const ARENA_BOT_LOADOUT = {
    heroLevel: { low: 200, high: 258 },
    champions: { low: 1, high: 2 },
    uncommonChance: { low: 0.1, high: 0.5 },
    rareChance: { low: 0, high: 0.15 },
    starChance: { low: 0, high: 0.2 },
    maxLevel: { low: 3, high: 10 }
} as const // locked 2026-10-11, the user's call
/**
 * Redrawing the opponent list (§2; the user's call, 2026-10-10): free this many times a UTC day, then
 * Gems, 5 and doubling: 5, 10, 20, … The ladder starts over each day. A list is also redrawn free after
 * every attack, so the same three can't be farmed.
 */
export const ARENA_FREE_REFRESHES_PER_DAY = 2
export const ARENA_REFRESH_BASE_GEMS = 5
export const ARENA_REFRESH_GROWTH = 2

/** Free attacks a day, reset at UTC midnight and never banked (§3). Doc-specified. */
export const ARENA_FREE_ATTEMPTS_PER_DAY = 5
/** An extra attack's price, doubling with each bought the same day: 10, 20, 40, … (§3). Doc-specified. */
export const ARENA_EXTRA_ATTEMPT_BASE_GEMS = 10
export const ARENA_EXTRA_ATTEMPT_GROWTH = 2

/** Every player's Rating at the start of each season, and its floor (§4). Doc-specified. */
export const ARENA_RATING_START = 1000
export const ARENA_RATING_FLOOR = 0
/** The Elo curve's spread: a 400-point gap makes the favourite ten times as likely (§4's formula). */
export const ARENA_ELO_SCALE = 400
/**
 * Asymmetric Elo (§4): how far a match moves the attacker's Rating and the defender's. Separate on
 * purpose: the attacker chose the fight, the defender was resolved by the AI while away, so the
 * defender's Rating moves less for the same result. Deltas are rounded to whole points.
 */
export const K_ATTACK = 32 // locked 2026-10-11, the user's call
export const K_DEFEND = 16 // locked 2026-10-11, the user's call

/**
 * Arena Medals, the attacker's only reward (§5):
 *
 *     medalsOnWin  = round(MEDAL_BASE_WIN × (1 + MEDAL_UPSET_BONUS × (1 − expectedAttacker)))
 *     medalsOnLoss = MEDAL_BASE_LOSS
 *
 * A Training Dummy win pays `MEDAL_BASE_WIN` flat (§2a). At these values a day's five attacks pay
 * about 120–200 Medals, which is what the shop's prices below are read against.
 */
export const MEDAL_BASE_WIN = 30 // locked 2026-10-11, the user's call
export const MEDAL_BASE_LOSS = 10 // locked 2026-10-11, the user's call
export const MEDAL_UPSET_BONUS = 1 // locked 2026-10-11, the user's call

/**
 * An Arena fight's clock, in sim-seconds. The attacker has to bring the whole defending party down
 * before it runs out; a defence that holds to the end wins (`build-log.md` #52). Battle Speed never
 * touches it (§1).
 */
export const ARENA_FIGHT_SECONDS = 30 // locked 2026-10-11, the user's call

/**
 * An Arena hit's crit multiplier is capped at this (the user's call, 2026-10-10). Deep in the curve
 * IMP drives it past ×17, and every fight ended on the first crit, inside a tenth of a second.
 */
export const ARENA_CRIT_MULTIPLIER_CAP = 2

/**
 * Every Arena fight is paced so two evenly matched parties would take this long to finish each other
 * (the user's call, 2026-10-10: an even fight should run to the clock). Longer than
 * `ARENA_FIGHT_SECONDS`, so an even fight times out and the HP shares decide it; a stronger party
 * still finishes a weaker one early, in proportion to the gap. The pace only ever slows a fight.
 */
export const ARENA_EVEN_FIGHT_SECONDS = 45 // locked 2026-10-11, the user's call
/**
 * The Training Dummy's HP, in seconds of the attacker's own autoattack DPS against no DEF: a short
 * show before the guaranteed win (§2a), well inside `ARENA_FIGHT_SECONDS` at any depth.
 */
export const ARENA_DUMMY_SECONDS = 4 // locked 2026-10-11, the user's call

/** A season's length (§7). Doc-specified. */
export const ARENA_SEASON_DAYS = 14
/**
 * When season 1 began: a Monday, 00:00 UTC. Seasons run back to back from here, so every player's
 * Rating rolls over on the same instant, settled lazily by the first read after it (no cron). An
 * anchor, not a tuning value.
 */
export const ARENA_SEASON_EPOCH_MS = Date.UTC(2026, 9, 5)
/**
 * What a season pays by final rank, in Medals (§7: rank-only, no tiers). The first row whose
 * `maxRank` the rank is within pays; every ranked player gets at least the last row. A ranked
 * player is one who fought, or was fought, that season.
 */
export const ARENA_SEASON_REWARDS: readonly { maxRank: number, medals: number }[] = [ // locked 2026-10-11, the user's call
    { maxRank: 1, medals: 2000 },
    { maxRank: 2, medals: 1500 },
    { maxRank: 3, medals: 1200 },
    { maxRank: 10, medals: 800 },
    { maxRank: 50, medals: 400 },
    { maxRank: Number.POSITIVE_INFINITY, medals: 100 }
]

/** The battle log keeps this many entries per player (§8). Doc-specified. */
export const ARENA_LOG_SIZE = 20
/** The Rating leaderboard's top list (§9). Doc-specified. */
export const ARENA_LEADERBOARD_TOP = 50
/** Players shown either side of the viewer's own rank (§9's "nearby neighbors"). */
export const ARENA_LEADERBOARD_NEIGHBORS = 2 // locked 2026-10-11, the user's call

/**
 * The Arena Shop (§6): static prices, no ladder, no cap, and no Gold (the user's call, 2026-10-10). A
 * Seal is about a fifth of a day's Medals. A Seal raid's Key is priced at the Seals a clear of that
 * raid pays at `ARENA_SHOP_KEY_LEVEL`, at the Seal's own price (the user's call, 2026-10-10: a level-5
 * clear pays 3, so 90 Medals), so a Key is never a cheaper way to Seals than the Seals themselves.
 * The Trait raid pays Trait Gems, not Seals, and keeps its own price.
 */
export const ARENA_SHOP_SEAL_PRICE = 30 // locked 2026-10-11, the user's call
export const ARENA_SHOP_KEY_LEVEL = 5
export const ARENA_SHOP_TRAIT_KEY_PRICE = 60 // locked 2026-10-11, the user's call
/**
 * Medals per Gem: a deliberately bad rate (§6). The calibration target is that a whole day's Medals
 * convert to meaningfully less than one Battle Speed block (`BATTLE_SPEED_ANCHOR_GEMS`, 250): at 5
 * a day's ~120–200 Medals buy 24–40 Gems, a tenth to a sixth of a block.
 */
export const ARENA_SHOP_GEM_PRICE = 5 // locked 2026-10-11, the user's call
/** The most of one item a single purchase takes, so a request cannot name an unbounded quantity. */
export const ARENA_SHOP_MAX_QUANTITY = 100

// ── Login calendar ─────────────────────────────────  idea-backlog.md item 12
//
// A fixed 30-day calendar, the same every cycle, run on real UTC days rather than days logged in.
// Each account's cycle starts on the day of its first claim and starts over every 30 days.

export const CALENDAR_DAYS = 30
/** Missed days a cycle lets the player claim late, always the oldest missed one first. */
export const CALENDAR_MAKEUPS_PER_CYCLE = 3

/**
 * What a calendar day pays. `amount` is minutes of current income for Gold (`gold-economy.md` §6:
 * every flat-Gold grant is a duration of income) and a plain count for everything else, Void Shards
 * included. Seals and Keys name the gacha or raid they are for.
 */
export type CalendarReward =
    | { kind: 'gold', amount: number }
    | { kind: 'gems', amount: number }
    | { kind: 'trait_gems', amount: number }
    | { kind: 'void_shards', amount: number }
    | { kind: 'seals', system: 'gear' | 'champion' | 'skill' | 'artifact', amount: number }
    | { kind: 'keys', raid: 'raid_guild' | 'raid_training_grounds' | 'raid_dig_site' | 'raid_forge' | 'raid_trait', amount: number }

/**
 * A day of the schedule. Gold, Gems and Void Shards carry their amount; a Seal, Key or Trait Gem
 * day carries none, since it is sized from that currency's income (`calendar.ts`).
 */
export type CalendarDay =
    | Extract<CalendarReward, { kind: 'gold' | 'gems' | 'void_shards' }>
    | { kind: 'trait_gems' }
    | Omit<Extract<CalendarReward, { kind: 'seals' }>, 'amount'>
    | Omit<Extract<CalendarReward, { kind: 'keys' }>, 'amount'>

/**
 * A Seal, Key or Trait Gem day pays days of that currency's regular income (the user's call,
 * 2026-10-09): this many on day 1, climbing evenly to `CALENDAR_INCOME_DAYS_LAST` on the last day,
 * so each currency pays more every time it comes round. The income is a day of raid clears at
 * raid level 1, free pulls not counted (`calendarIncomePerDay`), so the table stays the same
 * every cycle.
 */
export const CALENDAR_INCOME_DAYS_FIRST = 0.25 // locked 2026-10-11, the user's call
export const CALENDAR_INCOME_DAYS_LAST = 1 // locked 2026-10-11, the user's call

/**
 * Day 1 first. Small early days, and each currency pays more every time it comes round, so the
 * cycle climbs steadily to its end (the user's calls, 2026-10-08: no milestone days, an even 200
 * Void Shards on day 30; no Battle Speed days, 2026-10-09). The Gold minutes and Gem counts are
 * placeholders, rebalanced after the Gold decision (`open-items.md` #47).
 */
export const CALENDAR_SCHEDULE: readonly CalendarDay[] = [ // locked 2026-10-11, the user's call
    { kind: 'gold', amount: 10 },
    { kind: 'seals', system: 'champion' },
    { kind: 'keys', raid: 'raid_guild' },
    { kind: 'gold', amount: 15 },
    { kind: 'trait_gems' },
    { kind: 'seals', system: 'gear' },
    { kind: 'gems', amount: 25 },
    { kind: 'gold', amount: 20 },
    { kind: 'keys', raid: 'raid_training_grounds' },
    { kind: 'seals', system: 'skill' },
    { kind: 'trait_gems' },
    { kind: 'gold', amount: 30 },
    { kind: 'seals', system: 'artifact' },
    { kind: 'seals', system: 'champion' },
    { kind: 'gold', amount: 45 },
    { kind: 'keys', raid: 'raid_dig_site' },
    { kind: 'seals', system: 'gear' },
    { kind: 'trait_gems' },
    { kind: 'gold', amount: 60 },
    { kind: 'keys', raid: 'raid_forge' },
    { kind: 'gems', amount: 50 },
    { kind: 'gold', amount: 90 },
    { kind: 'seals', system: 'skill' },
    { kind: 'keys', raid: 'raid_trait' },
    { kind: 'trait_gems' },
    { kind: 'gold', amount: 120 },
    { kind: 'seals', system: 'artifact' },
    { kind: 'keys', raid: 'raid_guild' },
    { kind: 'gems', amount: 75 },
    { kind: 'void_shards', amount: 200 }
]

// ── Feature unlocks ────────────────────────────────  idea-backlog.md item 10, open-items #50
//
// Every menu scene but Settings opens at a checkpoint of lifetime progress, and the guide announces
// it there (`tutorials.ts`). The schedule is the user's (2026-10-09, moved earlier 2026-10-13 because
// progression felt too slow): the Shop, Battle Speed and the Calendar from the start, Classes at the
// first prestige. Battle Speed is a tab in the Shop, and the Milestones one in the Calendar. The Gacha
// and Collections open on the party's first fall (2026-10-12): waves can wall a run before the World 1
// boss, and the Gacha is the answer.

/** A scene that opens at a checkpoint. Battle and Settings are open from the start. */
export type HqFeature = 'gacha' | 'collections' | 'milestones' | 'calendar' | 'loadouts' | 'speed' | 'tree' | 'raids' | 'traits' | 'arena' | 'shop' | 'classes'

/** A point of lifetime progress: a new run, the party's first fall, a World's mid-boss fought (beaten, or lost to) or beaten, Worlds cleared, the run cleared, prestiges made. */
export type FeatureCheckpoint =
    | { kind: 'start' }
    | { kind: 'fallen' }
    | { kind: 'boss', world: number }
    | { kind: 'boss_beaten', world: number }
    | { kind: 'worlds', count: number }
    | { kind: 'run_cleared' }
    | { kind: 'prestiges', count: number }

/** In the order they open, which is the order the guide announces them. */
export const FEATURE_UNLOCKS: readonly { feature: HqFeature, at: FeatureCheckpoint }[] = [
    // the Calendar first, so day one's gift is the first thing the guide shows
    { feature: 'calendar', at: { kind: 'start' } },
    // the Shop ahead of Battle Speed: it is the main page of the button the two share
    { feature: 'shop', at: { kind: 'start' } },
    { feature: 'speed', at: { kind: 'start' } },
    { feature: 'gacha', at: { kind: 'fallen' } },
    { feature: 'collections', at: { kind: 'fallen' } },
    { feature: 'milestones', at: { kind: 'worlds', count: 1 } },
    { feature: 'loadouts', at: { kind: 'worlds', count: 1 } },
    // a World of levels banked by then, so the first visit has points to spend
    { feature: 'tree', at: { kind: 'worlds', count: 2 } },
    { feature: 'raids', at: { kind: 'worlds', count: 3 } },
    // never ahead of the raids: the Trait raid is where Trait Gems come from
    { feature: 'traits', at: { kind: 'worlds', count: 3 } },
    // a World after the raids, so its tutorial doesn't land on top of theirs
    { feature: 'arena', at: { kind: 'worlds', count: 4 } },
    { feature: 'classes', at: { kind: 'prestiges', count: 1 } }
]

// ── Holiday gifts ──────────────────────────────────  holiday-events.md §2–§3

/**
 * UTC days a holiday's gift stays claimable, the holiday itself counted (§2: "the holiday date
 * plus a few following days (e.g. a 3-day window)"). §2's example, not a decision.
 */
export const HOLIDAY_CLAIM_WINDOW_DAYS = 3 // locked 2026-10-11, the user's call

/**
 * One holiday's gift (§3): Gold as minutes of current income (`gold-economy.md` §6), a flat
 * count of Gems, and optionally some of any gacha's Seals.
 */
export interface HolidayGift {
    goldMinutes: number
    gems: number
    seals: Readonly<Partial<Record<'gear' | 'champion' | 'skill' | 'artifact', number>>>
}

/**
 * Each holiday's gift, authored per holiday rather than computed (§3): Christmas richest, Halloween
 * and Valentine's Day the smallest, and each one's Seals themed. Every amount is a placeholder. Gems are the
 * platform-wide currency, so these reach past Hero Quest; size them with the calendar's Gem days
 * and the milestones' (`open-items.md` #47, #48).
 */
export const HOLIDAY_GIFTS: Readonly<Record<HolidayId, HolidayGift>> = { // locked 2026-10-11, the user's call
    holiday_new_year: { goldMinutes: 60, gems: 50, seals: { champion: 3, gear: 3, skill: 3, artifact: 3 } },
    holiday_lunar_new_year: { goldMinutes: 60, gems: 50, seals: { champion: 5 } },
    holiday_valentines: { goldMinutes: 30, gems: 25, seals: { champion: 3 } },
    holiday_easter: { goldMinutes: 45, gems: 40, seals: { skill: 5 } },
    holiday_halloween: { goldMinutes: 30, gems: 25, seals: { artifact: 5 } },
    holiday_christmas: { goldMinutes: 120, gems: 100, seals: { champion: 5, gear: 5, skill: 5, artifact: 5 } }
}

// ── Milestones ─────────────────────────────────────  idea-backlog.md item 11
//
// Not a list: each kind of feat is a track with a formula for its k-th step's target and reward
// (`milestones.ts`), so a track runs as far as the feat does. Every reward grows linearly by step,
// `BASE + STEP × (k − 1)`; the World track's grows by run instead, so every World of a run pays
// alike. Each track pays its own currency (the user's call, 2026-10-09).

/** Every World cleared, across every run, is a step. All four Seal types, the old World-clear batch. */
export const MILESTONE_WORLD_SEALS_BASE = 3 // locked 2026-10-11, the user's call
/** What each World pays more for every full run before it. */
export const MILESTONE_WORLD_SEALS_PER_RUN = 1 // locked 2026-10-11, the user's call

/** Every prestige is a step. All four Seal types, the old prestige batch, and Gems. */
export const MILESTONE_PRESTIGE_SEALS_BASE = 10 // locked 2026-10-11, the user's call
export const MILESTONE_PRESTIGE_SEALS_STEP = 2 // locked 2026-10-11, the user's call
export const MILESTONE_PRESTIGE_GEMS_BASE = 50 // locked 2026-10-11, the user's call
export const MILESTONE_PRESTIGE_GEMS_STEP = 25 // locked 2026-10-11, the user's call

/** A raid's levels at every multiple of this are its steps (`idea-backlog.md` item 11). */
export const MILESTONE_RAID_LEVEL_EVERY = 5
/** That raid's Keys. */
export const MILESTONE_RAID_KEYS_BASE = 2 // locked 2026-10-11, the user's call
export const MILESTONE_RAID_KEYS_STEP = 1 // locked 2026-10-11, the user's call

/**
 * The Arena's track (the user's call, 2026-10-10): every this many Arena wins, lifetime, Training
 * Dummy wins included, pays Arena Medals, more each step.
 */
export const MILESTONE_ARENA_WINS_EVERY = 10 // locked 2026-10-11, the user's call
export const MILESTONE_ARENA_MEDALS_BASE = 50 // locked 2026-10-11, the user's call
export const MILESTONE_ARENA_MEDALS_STEP = 25 // locked 2026-10-11, the user's call

/** A collection's steps: every this many owned, and the full roster as the last. */
export const MILESTONE_COLLECTION_EVERY = 6 // locked 2026-10-11, the user's call
/** That gacha's Seals. */
export const MILESTONE_COLLECTION_SEALS_BASE = 2 // locked 2026-10-11, the user's call
export const MILESTONE_COLLECTION_SEALS_STEP = 2 // locked 2026-10-11, the user's call

/**
 * The two offline tracks are bought with Gold (the user's call, 2026-10-10), so they can be had from
 * the World 1 boss on: Offline Efficiency 1M ×10 a level, 10B for the fifth; Offline Cap 100K ×1.5 a
 * level, 28,762,658,885 for the 32nd. Set by the user, so no marker.
 */
export const OFFLINE_EFFICIENCY_BASE_COST = 1_000_000
export const OFFLINE_EFFICIENCY_COST_GROWTH = 10
export const OFFLINE_CAP_BASE_COST = 100_000
export const OFFLINE_CAP_COST_GROWTH = 1.5

// ── Presence ───────────────────────────────────────  tech-architecture.md §4b

/**
 * How often the open client re-reads state. Lazy settle erases the app-open/app-closed
 * distinction that offline efficiency and the offline cap depend on; a steady refresh restores
 * it by *demonstrating* presence through the request pattern rather than letting the client
 * assert it.
 */
export const HQ_REFRESH_INTERVAL_MS = 60_000 // locked 2026-10-11, the user's call

/**
 * Gap at or below which a settle window counts as **online** — full rate, no cap, no efficiency
 * tax. Anything longer is an offline chunk.
 *
 * A few times the refresh interval, so a closed app looks identical to a dead network — the
 * correct failure direction (degrades to offline rules, never inflates).
 */
export const ONLINE_THRESHOLD_MS = HQ_REFRESH_INTERVAL_MS * 3 // locked 2026-10-11, the user's call

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
 * How long a boss replay holds on its outcome before closing itself and the run moving on. Every
 * fight closes so, a challenged one too: its Continue button sat under the stage, out of sight, and
 * the run waited behind a VICTORY banner until it was found (2026-10-10).
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
export const CHAMPION_SLOT_BASE_COST = 400 // locked 2026-10-11, the user's call
export const CHAMPION_SLOT_COST_GROWTH = 3 // locked 2026-10-11, the user's call

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
export const CHAMPION_PASSIVE_PER_POINT = 0.002 // locked 2026-10-11, the user's call

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
 * The Seals a boss win pays (`economy-and-currencies.md` §5, source 1), all four types at once,
 * since a boss is no gacha's own progress. Paid on the win itself.
 *
 * The World-clear and Prestige batches that used to sit beside it are now milestones, claimed in
 * the Milestones scene (`MILESTONE_WORLD_SEALS_BASE`, `MILESTONE_PRESTIGE_SEALS_BASE`; the user's
 * call, 2026-10-09).
 */
export const SEAL_GRANT_PER_BOSS = 1 // locked 2026-10-11, the user's call

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
export const LOADOUT_SLOT_BASE_COST_GEMS = 250 // locked 2026-10-11, the user's call
export const LOADOUT_SLOT_COST_GROWTH = 2

// ── Traits ─────────────────────────────────────────  traits.md
//
// Every number here is transcribed from `traits.md`, which locks them all; none is a guess, so none
// carries a marker. The names and IDs they key are `content/traits.ts`'s, the rules `traits.ts`'s.

/** Five party-wide slots, all open from account start: no unlock track (§1). */
export const TRAIT_SLOT_COUNT = 5

/**
 * A Roll rerolls every unlocked slot at once, priced by how many are **locked** (§2):
 *
 *     rollCost(locked) = TRAIT_ROLL_BASE_COST + locked × TRAIT_ROLL_COST_PER_LOCK
 *
 * 5 Trait Gems with nothing locked, up to 30 with all five — though five locked is a no-op the
 * server refuses rather than charges for.
 */
export const TRAIT_ROLL_BASE_COST = 5
export const TRAIT_ROLL_COST_PER_LOCK = 5

/** Grade odds, in percent, F → SSS (§2, the Acquisition table). Sums to exactly 100. */
export const TRAIT_GRADE_RATES: Readonly<Record<TraitGrade, number>> = {
    F: 19,
    E: 37.7,
    D: 28.3,
    C: 9.5,
    B: 4.7,
    A: 0.5,
    S: 0.2,
    SS: 0.07,
    SSS: 0.03
}

/**
 * What each stat gives at each grade, as a fraction (§4): ATK SSS is +600%, so 6. Summed with
 * every other source of the same line, as Artifacts and the prestige shop are (`modifiers.ts`).
 */
export const TRAIT_STAT_VALUES: Readonly<Record<TraitStatId, Readonly<Record<TraitGrade, number>>>> = {
    trait_atk: { F: 0.10, E: 0.25, D: 0.35, C: 0.50, B: 0.70, A: 1.00, S: 1.50, SS: 3.00, SSS: 6.00 },
    trait_spd: { F: 0.01, E: 0.02, D: 0.03, C: 0.04, B: 0.06, A: 0.08, S: 0.10, SS: 0.15, SSS: 0.20 },
    trait_hp: { F: 0.03, E: 0.05, D: 0.08, C: 0.12, B: 0.17, A: 0.23, S: 0.30, SS: 0.50, SSS: 1.00 },
    trait_champion_atk: { F: 0.10, E: 0.25, D: 0.35, C: 0.50, B: 0.70, A: 1.00, S: 1.50, SS: 3.00, SSS: 5.00 },
    trait_hero_skill_dmg: { F: 0.10, E: 0.25, D: 0.35, C: 0.50, B: 0.70, A: 1.00, S: 1.50, SS: 3.00, SSS: 6.00 },
    trait_lck: { F: 0.02, E: 0.03, D: 0.04, C: 0.05, B: 0.06, A: 0.07, S: 0.08, SS: 0.09, SSS: 0.10 },
    trait_imp: { F: 0.30, E: 0.36, D: 0.45, C: 0.75, B: 0.90, A: 1.20, S: 1.80, SS: 3.00, SSS: 7.50 },
    trait_exp_gain: { F: 0.04, E: 0.07, D: 0.11, C: 0.16, B: 0.22, A: 0.30, S: 0.40, SS: 0.50, SSS: 1.00 }
}

/**
 * Each Set's tiers (§5): at `pieces` equipped slots of the Set, its bonus is `magnitude`. A tier is
 * the **total** at that count, replacing the one below rather than adding to it, and the top tier
 * holds past its count. Back to Basics is 3/4/5, the doc's corrected reading of 3/5/5.
 *
 * Magnitudes are fractions, except Divine Blessing's, which is the share of max HP recovered every
 * second. Vital Reflex's lands twice, as VIT and as Evasion Rate (EVA is a rate, so +0.10 is ten
 * points of it, under `MAX_EVASION`).
 *
 * Deep Impact was cut to a quarter (+400/800/1200% → +100/200/300%) on 2026-10-11, the user's call:
 * one piece out-valued an SS IMP roll and cut the first run's Worlds 5–10 from ~9 days to under 2.
 */
export const TRAIT_SET_TIERS: Readonly<Record<TraitSetId, readonly { pieces: number, magnitude: number }[]>> = {
    set_vital_reflex: [{ pieces: 1, magnitude: 0.10 }, { pieces: 3, magnitude: 0.25 }, { pieces: 5, magnitude: 0.50 }],
    set_divine_blessing: [{ pieces: 1, magnitude: 0.05 }],
    set_aggression: [{ pieces: 2, magnitude: 0.10 }, { pieces: 3, magnitude: 0.20 }, { pieces: 4, magnitude: 0.30 }],
    set_deep_impact: [{ pieces: 1, magnitude: 1 }, { pieces: 2, magnitude: 2 }, { pieces: 3, magnitude: 3 }],
    set_back_to_basics: [{ pieces: 3, magnitude: 0.50 }, { pieces: 4, magnitude: 1.00 }, { pieces: 5, magnitude: 2.00 }]
}

/**
 * Trait save slots (§6): 1 to start, 4 at most, bought with Gems on a **linear** step rather than
 * the doubling the other short Gem tracks use — 250, 750, 1250:
 *
 *     cost(level) = TRAIT_SAVE_SLOT_BASE_COST_GEMS + (level − 1) × TRAIT_SAVE_SLOT_COST_STEP_GEMS
 */
export const BASE_TRAIT_SAVE_SLOTS = 1
export const MAX_TRAIT_SAVE_SLOTS = 4
export const TRAIT_SAVE_SLOT_BASE_COST_GEMS = 250
export const TRAIT_SAVE_SLOT_COST_STEP_GEMS = 500

/** Storing the live board in a save slot, or loading one, costs this many Trait Gems a press (§6). */
export const TRAIT_SAVE_LOAD_COST = 100

/**
 * Auto Roll (the user's call, 2026-10-10; not in `traits.md`): Rolls back to back until a slot lands
 * at a chosen grade or better or the Trait Gems run short, this many to a request. The client asks
 * again until one of those stops it or the player does, so this sets how finely STOP can cut in and
 * how many requests a long run makes. Not a price: every Roll still costs what a Roll costs.
 */
export const TRAIT_AUTO_ROLL_BATCH = 10 // locked 2026-10-11, the user's call

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
export const PRESTIGE_STAT_PER_LEVEL = 0.01 // locked 2026-10-11, the user's call
export const PRESTIGE_STAT_BASE_COST = 100 // locked 2026-10-11, the user's call
export const PRESTIGE_STAT_COST_GROWTH = 1.15 // locked 2026-10-11, the user's call

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
 * 1.2 for all four, set by feel on 2026-10-04 (the user's call): a day's first 10-pull is ~21M,
 * the second ~107M, the third ~554M, the fifth ~14.7B, so Gold buys a few 10-pulls a day rather
 * than completing a roster. The old near-flat rates (1.0007, 1.0011) made Gold the main route to
 * completion.
 *
 * **Re-derived against the settled income, 2026-10-12** (the user's call via issue #10,
 * `open-items.md` #23.2), and both hold:
 *
 * - **The base sets week one.** 1,000,000 puts a party of three's first Gold Seal at **day 2** of
 *   continuous play (solo: day 3), and a day's income at day 7 buys 3 Seals of one gacha. Lower
 *   and Gold Seals are an hour-one purchase that dilutes the 30 free pulls; higher and the first
 *   one slips past week one. It is also the doc-locked floor (`gacha-shared-system.md` §4).
 * - **The growth sets the depth later.** Target: at the ceiling's income (an account keeping
 *   pace), Gold-bought Seals reach a gacha's free allowance — 30 pulls a day, the three free
 *   10-pulls (`FREE_PULLS_PER_DAY`, #29) — around month 3 and then climb only ~4 Seals per doubling
 *   of income, so Gold at most doubles a gacha's daily pulls and never becomes the route to a
 *   roster. At 1.2 a day's keeping-pace income buys **8 Seals at day 7, 18 at day 30, 26 at day 90
 *   (three Gold 10-pulls from day ~91), 30 at day 180 and 32 at a year**, per gacha. 1.17 runs to
 *   36 at a year, past the free allowance; 1.25 stays under it (25 at day 180).
 *
 * Milestone Seals (#48) and boss Seals sit beside this (~60 per type over a first prestige) and
 * never advance a counter. Trades against the free pulls: lower either and Gold Seals matter
 * more. Coupled to `BASE_GOLD` / `GOLD_STEP_BASE` and the ceiling — re-derive if income moves.
 */
export const SEAL_LADDER_BASE_GOLD = 1_000_000 // TUNED ✓
export const SEAL_LADDER_GROWTH: Readonly<Record<string, number>> = { // TUNED ✓
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
export const EHP_DEF_CONSTANT = 10 // locked 2026-10-11, the user's call

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
export const GPN_DISPLAY_SCALE = 10 // locked 2026-10-11, the user's call

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
export const VOID_SHARD_BASE = 100 // locked 2026-10-11, the user's call
export const VOID_SHARD_GROWTH = 2 // locked 2026-10-11, the user's call

// ── Passive Skill Tree ─────────────────────────────  passive-skill-tree.md

/**
 * Tree points every Hero level past the first is worth. Points are derived, never stored:
 * `(heroLevel - 1) × PASSIVE_POINTS_PER_LEVEL`, less what the tree holds (§2). At about four
 * levels a stage, a first prestige is worth roughly 400.
 */
export const PASSIVE_POINTS_PER_LEVEL = 1 // locked 2026-10-11, the user's call

/** Levels a regular node takes (`idea-backlog.md` item 3: "up to 5 levels"). The endless nodes have none. */
export const PASSIVE_NODE_MAX_LEVEL = 5

/**
 * A regular node's level `L` costs `PASSIVE_TIER_COST[tier - 1] × L` points, so a whole node is
 * 15× its tier's base. With the roster as authored the finite tree is 1,500 points: one path's
 * finite nodes are 480, about a first prestige's worth.
 */
export const PASSIVE_TIER_COST: readonly number[] = [1, 2, 3, 4, 6] // locked 2026-10-11, the user's call

/**
 * An endless node's level `L` costs `BASE + (L - 1) × STEP`. Linear, so the levels a fixed budget
 * buys grow as its square root: the tail never outruns the enemy curve, it only gives points a use.
 */
export const PASSIVE_ENDLESS_BASE_COST = 10 // locked 2026-10-11, the user's call
export const PASSIVE_ENDLESS_COST_STEP = 5 // locked 2026-10-11, the user's call

/**
 * What one level of a node adds, by the band its line is authored in (`content/passive-tree.ts`).
 * Fractions, additive like every other modifier line. A maxed `stat` node is +15%, a maxed
 * `economy` one +10% (kept small: Gold and XP are paced, `gold-economy.md` §5).
 */
export const PASSIVE_BAND_MAGNITUDE = { // locked 2026-10-11, the user's call
    stat: 0.03,
    skill: 0.05,
    utility: 0.01,
    critDamage: 0.05,
    economy: 0.02,
    endless: 0.01
} as const

/** Gems a respec costs when no free one is held. A prestige grants one free respec, kept until used. */
export const PASSIVE_RESPEC_GEMS = 100 // locked 2026-10-11, the user's call
