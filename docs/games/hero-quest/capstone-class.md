# The Ascendant — the capstone class

**Status: design complete 2026-10-09.** Decided, built and its art approved and locked the same
day; #43 is closed (record in `build-log.md` #43). This doc is the record of the decision: what was
chosen, what was weighed, and why.

## What it is

The 17th class, at the end of the masters' row and joined to all six: a class for having mastered
every other one. Its tier is `capstone`, its ID `class_ascendant`.

- **Kit: Polymath plus an ultimate.** It picks **any 4** of the 16 class skills, across paths
  (Threatening Roar + Kill Shot + Meteor Shower is a kit no master can field), each on its own
  class's rung of the cooldown ladder. On top, its own skill, **Convergence**, fires **every master's
  skill at once**, each at its own hit, all on one cooldown `CONVERGENCE_COOLDOWN_FACTOR` (2) times a
  master's (`content/classes.ts`: `kitFor`, `CONVERGENCE`).
- **Stats: the best of the six masters in each stat**, deltas included: Sorcerer's and Berserker's
  PWR, Marksman's SPD, Beast Master's LCK, Paladin's VIT and DEF. Written as the best master's tier
  plus a delta, so the stat pipeline and the stat breakdown read it like any other class.
  One strike per attack, `lowest_hp_pct` targeting, back row by default: best-of-each was chosen for
  the stats, and strikes are kit, not a stat.
- **Unlock: a prestige completed as each of the six masters.** Not reached; prestiged *with*. The
  prestige records the class the run was cleared as (`hq_state.prestiged_class_ids`). Reaching all
  six masters means every other node has been reached too.
- **Token: it costs one**, like any class not reached before. The token is a flag, so a player
  holds at most one, but the unlock guarantees it: the unlock lands on a prestige, which always
  grants one, and with every other node reached there is nothing else to spend it on. From any
  class once unlocked; switching back later is free.
- **The picks are a Loadout component**, the sixth, and can be changed any time for free (the
  Classes scene: pressing the Ascendant while it is the current class opens its kit). A preset saved
  without picks leaves the live ones alone when applied. They are kept across prestige and switches.
- **Name:** Ascendant.

## Why these, of what was weighed

The starting idea was "it has every Hero ability". Taken literally (all 16 skills auto-firing) it
breaks power, pacing and the stage: four times a master's ability count, a kit that needs its own
measurements, and cinematics nearly all the time. Four directions kept the fantasy:

1. **Paragon**: all 16 skills, one cast slot cycling through them.
2. **Polymath**: pick any 4 across paths. **Chosen.**
3. **A signature ultimate** firing every master's skill at once. **Chosen, with 2.**
4. **Growth through mastery**: stats or ultimate growing per class mastered. Not taken.

**Convergence's cooldown.** It was first set at 6× a master's, so the volley paid one master
skill's damage per second. That came to ~55 s, longer than a 30 s boss fight, where a first cast
waits a whole cooldown, so it would never have fired where the player watches. Of starting it ready
at the fight's first tick, a shorter cooldown, or charging it from casts, the user chose the
**shorter cooldown**: at 2 it lands at ~15.6 s with the Ascendant's own SPD, once per boss fight.

## The art

Round 20, approved and locked (`art-style.md`): the rookie in white-and-gold plate over a violet
robe, a gold circlet and halo, a crystal-topped gold staff, hovering, with six motes circling him in
the masters' skill colours. His medallion carries a stud in each. Convergence's cinematic gathers the
six over him, fuses them into a white-gold sun and brings it down as six beams, one on every enemy.

## Left after the design

Neither is a design question:

- **Power** is tuning: best-of-each stats, four free picks and a volley worth three master skills a
  second together likely out-class every master, which the Polymath direction was chosen to avoid.
  Measure it on the campaign sim before moving `CONVERGENCE_COOLDOWN_FACTOR` (the standing-tuning
  table in `open-items.md`).
- **The game playing Convergence as one cinematic** is `open-items.md` #49.
