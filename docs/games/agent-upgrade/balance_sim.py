#!/usr/bin/env python3
"""
HackOps Artifact balance simulator.

Question: starting from an agent rolled at rock-bottom on every trait, how many
real DAYS does it take to max that agent if you farm a given op tier every day?

Design goals being tested (both must hold):
  1. Farming HIGHER / LONGER ops reaches a maxed agent FASTER than spamming short
     low-tier ops — even though you can run many more short ops per day.
  2. Hitting the user's headline target: ~1 week to max one agent at endgame,
     ~6 weeks for a full team of 6.

Key modelling choice that makes goal (1) fall out naturally:
  Artifact drops scale with OP DURATION, not a flat per-op chance. A long op is a
  bigger prize than a short one — a ~30h endgame op yields a whole *cache* of
  artifacts, a ~3h beginner op yields a trickle. Concretely:
        expected artifacts per op = DROP_PER_HOUR * base_hours
  Because long endgame ops also run overnight (banking time you're not awake to
  spend on short ops), endgame nets MORE artifacts/day AND at better rarity, so
  short-op spam can never out-farm it. There is no way to "cheese" max agents on
  1h ops.

Rarity is magnitude ONLY: a phantom artifact adds ~10x what a ghost one does.
Rarity is never in an artifact's name ("Power Artifact", not "Phantom Artifact").

Everything tunable is in CONFIG. Edit, re-run, read the report. `AUTOSOLVE`
back-solves DROP_PER_HOUR to hit the endgame target for you.
"""

import random

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

# Real trait ranges (shared/utils/hack-config.ts AGENT_TRAIT_RANGES). (min, max).
TRAITS = {
    "power_flat":    (10, 60),
    "power_percent": (5, 30),
    "xp_boost":      (5, 50),
    "speed_percent": (3, 10),
    "gem_chance":    (0.5, 5),
    "gem_bonus":     (1, 3),
    "loot_percent":  (3, 6),
}
GAP = {t: hi - lo for t, (lo, hi) in TRAITS.items()}

# How much of a trait's GAP one artifact fills, by rarity. Anchored on the user's
# call: phantom Power = +10 on a 50 gap = 20% of gap; ghost Power = +1 = 2% → 10x
# ghost→phantom. Middle rarities are geometric steps between 2% and 20%.
#   ghost 2.0% · operative 3.6% · specialist 6.3% · elite 11.2% · phantom 20.0%
GAP_FRACTION = {
    "ghost":      0.020,
    "operative":  0.036,
    "specialist": 0.063,
    "elite":      0.112,
    "phantom":    0.200,
}

def artifact_value(trait, rarity):
    return GAP[trait] * GAP_FRACTION[rarity]

# Expected artifacts a 1-HOUR-BASE op yields. Drops scale with an op's BASE
# duration (its inherent value), NOT the sped-up time — so speed builds farm more
# ops/day but never more artifacts *per op*. AUTOSOLVE overwrites this.
# 0.25 is the tuned value: expected artifacts per op = 0.25 * op_base_hours
# (a 30h Ghost Protocol → ~7.4, a 2h port scan → ~0.5). Hits ~1 week/agent at T5.
DROP_PER_HOUR = 0.25

# Op tiers. base_hours = the op's listed duration (drives drop size — bigger op,
# bigger cache); ops_per_day = realistic completed ops/day WITH speed agents (long
# ops also bank overnight); rarity = the tier's magnitude-weight table (user's
# sliding 60/30/10 window). base_hours are the midpoints of each tier's real
# OP_TEMPLATES durations. The T5 farm target is Ghost Protocol (30h) — Project
# Zero (56h) intentionally drops nothing (reaching it means you're already done).
TIERS = {
    "T1_beginner":  dict(base_hours=2.75, ops_per_day=9,
                         rarity={"ghost": 60, "operative": 30, "specialist": 10}),
    "T2_early_mid": dict(base_hours=6.0,  ops_per_day=5,
                         rarity={"ghost": 60, "operative": 30, "specialist": 10}),
    "T3_mid":       dict(base_hours=10.5, ops_per_day=3,
                         rarity={"operative": 60, "specialist": 30, "elite": 10}),
    "T4_late_mid":  dict(base_hours=15.7, ops_per_day=2,
                         rarity={"specialist": 60, "elite": 30, "phantom": 10}),
    "T5_endgame":   dict(base_hours=30.0, ops_per_day=1.5,
                         rarity={"elite": 60, "phantom": 40}),
}

AGENT_TRAIT_COUNT = 5          # a Phantom — the aspirational max agent
TRIALS = 4000

# Auto-balance: back-solve DROP_PER_HOUR so endgame (T5) hits this many days to
# reach TARGET_GOAL for one agent. Set AUTOSOLVE=False to use DROP_PER_HOUR as-is.
AUTOSOLVE = True
TARGET_DAYS = 7.0
TARGET_GOAL = "full"          # 'power' | 'core' | 'full'

random.seed(1234)


# ─────────────────────────────────────────────────────────────────────────────
# SIM
# ─────────────────────────────────────────────────────────────────────────────

def roll_rarity(weights):
    total = sum(weights.values())
    r = random.random() * total
    acc = 0.0
    for rarity, w in weights.items():
        acc += w
        if r <= acc:
            return rarity
    return list(weights)[-1]


def artifacts_this_op(base_hours):
    """Expected DROP_PER_HOUR*hours artifacts, realised as int (floor + prob remainder)."""
    mean = DROP_PER_HOUR * base_hours
    n = int(mean)
    if random.random() < (mean - n):
        n += 1
    return n


def goal_traits(types, goal):
    if goal == "power":
        return [t for t in ("power_flat",) if t in types]
    if goal == "core":
        return [t for t in ("power_flat", "power_percent") if t in types]
    return list(types)


def sim_days(tier_cfg, goal):
    types = random.sample(list(TRAITS), AGENT_TRAIT_COUNT)
    needed = goal_traits(types, goal)
    if not needed:
        return None
    cur = {t: TRAITS[t][0] for t in types}
    cap = {t: TRAITS[t][1] for t in types}
    ops = 0
    while any(cur[t] < cap[t] for t in needed):
        ops += 1
        for _ in range(artifacts_this_op(tier_cfg["base_hours"])):
            dtype = random.choice(list(TRAITS))            # type: uniform random
            rarity = roll_rarity(tier_cfg["rarity"])
            if dtype in types and cur[dtype] < cap[dtype]:
                cur[dtype] = min(cap[dtype], cur[dtype] + artifact_value(dtype, rarity))
        if ops > 5_000_000:
            return None
    return ops / tier_cfg["ops_per_day"]


def median_days(tier_cfg, goal, trials=TRIALS):
    vals = sorted(v for v in (sim_days(tier_cfg, goal) for _ in range(trials)) if v is not None)
    if not vals:
        return None
    n = len(vals)
    return vals[n // 2], vals[n // 4], vals[3 * n // 4]


def autosolve():
    """Binary-search DROP_PER_HOUR so T5 median days-to-TARGET_GOAL == TARGET_DAYS."""
    global DROP_PER_HOUR
    lo, hi = 0.01, 5.0
    t5 = TIERS["T5_endgame"]
    for _ in range(26):
        DROP_PER_HOUR = (lo + hi) / 2
        med = median_days(t5, TARGET_GOAL, trials=2500)[0]
        if med > TARGET_DAYS:      # too slow → need more drops
            lo = DROP_PER_HOUR
        else:
            hi = DROP_PER_HOUR
    DROP_PER_HOUR = (lo + hi) / 2


def fmt(d):
    if d is None:
        return "     n/a"
    return f"{d/7:6.1f}wk" if d >= 14 else f"{d:6.1f}d "


def main():
    if AUTOSOLVE:
        autosolve()
        print(f"[autosolve] DROP_PER_HOUR = {DROP_PER_HOUR:.3f}  "
              f"(→ a 3h beginner op yields ~{DROP_PER_HOUR*3:.1f} artifacts, a 30h Ghost Protocol ~{DROP_PER_HOUR*30:.1f})")
        print(f"[autosolve] tuned so T5 endgame maxes '{TARGET_GOAL}' in ~{TARGET_DAYS:.0f} days\n")

    print("=" * 80)
    print("Days to max a rock-bottom Phantom agent (5 traits), farming each tier daily")
    print(f"phantom=20% of gap · 10x ghost→phantom · drops scale with op hours · {TRIALS} trials")
    print("=" * 80)
    print(f"{'farming tier':13s} {'ops/dy':>6} {'hrs':>4} {'~arts/op':>8} "
          f"| {'POWER':>9} {'CORE':>9} {'FULL':>9}")
    print("-" * 80)

    rows = []
    for name, cfg in TIERS.items():
        cells = {g: median_days(cfg, g) for g in ("power", "core", "full")}
        rows.append((name, cfg, cells))
        arts = DROP_PER_HOUR * cfg["base_hours"]
        print(f"{name:13s} {cfg['ops_per_day']:>6} {cfg['base_hours']:>4.0f} {arts:>8.1f} "
              f"| {fmt(cells['power'][0] if cells['power'] else None):>9}"
              f" {fmt(cells['core'][0] if cells['core'] else None):>9}"
              f" {fmt(cells['full'][0] if cells['full'] else None):>9}")

    print("-" * 80)
    print("\nDesign-goal check — is each HIGHER tier FASTER to fully max? (want yes)")
    prev, ok = None, True
    for name, cfg, cells in rows:
        d = cells["full"][0] if cells["full"] else None
        flag = ""
        if prev is not None and d is not None and d > prev + 1e-9:
            flag = "  <-- SLOWER than tier below (spam would win) !!"
            ok = False
        print(f"  {name:13s} {fmt(d)}{flag}")
        prev = d
    print(f"\n  higher-tier-is-faster holds: {ok}")

    end = rows[-1][2]
    print("\nEndgame (T5) vs user targets (~1wk/agent, ~6wk/team-of-6):")
    for goal, label in (("power", "max power"), ("core", "max power+power%"), ("full", "max all 5")):
        g = end[goal]
        if g:
            print(f"  {label:18s}: {fmt(g[0])} /agent  (range {fmt(g[1])}–{fmt(g[2])})"
                  f"  ·  ~{g[0]/7*6:.0f}wk /team")


if __name__ == "__main__":
    main()
