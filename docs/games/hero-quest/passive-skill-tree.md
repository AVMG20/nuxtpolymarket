# Passive Skill Tree

Status: **Locked and built 2026-10-11** (`build-log.md` #63). Designed in one session with the user; `idea-backlog.md` item 3 was the brief.

## Structure recap
- A Hero-only tree of passive upgrades: a generic damage root splitting into three paths, one per base class line (Warrior / Mage / Archer).
- Bought with **tree points earned on level-up**, not with a raid currency. This replaces the backlog's "dedicated raid" (the user's call).
- Every regular node takes up to 5 levels; each path ends in one **endless** node with no cap.
- Champion side nodes hang off the paths, never gate one, and are never ownership-locked.
- Respec: free once per prestige, otherwise Gems.

---

## 1. Why level-up points, not a raid

The backlog's premise was a dedicated raid paying a tree currency. **Swapped for a currency gained on level-up** (the user's call, 2026-10-11). Hero level is uncapped and survives prestige and class switches (`classes-and-combat.md` §4), so points never stop coming and are never lost. The tree rewards the Hero's whole history rather than a daily raid habit.

No raid was built for it, and `raid-system.md` is unchanged.

## 2. Points

```
pointsEarned = (heroLevel - 1) × PASSIVE_POINTS_PER_LEVEL
pointsLeft   = pointsEarned - Σ cost of every level the tree holds
```

**Derived, never stored** (the user's call). Nothing has to credit a level-up; an account that levelled before the tree existed has its points already; a dev-tool level change moves them with it; and a respec is clearing the map. The only save is `hq_state.passive_tree`, node id → levels.

At about four levels a stage, a first prestige is worth roughly 400 points.

## 3. Shape

```
Awakening (root, PWR)
├─ Fundamentals (basic attack damage), Fortitude (max HP), Precision (crit chance): the root's own ring,
│  each opening the first node of the paths either side
├─ Warrior: Iron Skin (DEF)
│  ├─ Thick Blood (VIT) ─ Unbroken (damage taken) ─ Weapon Mastery◆ ─ Battle Trance◆ ─ Colossus∞
│  │   └─ Shieldbearers■ (Tank Champions: DEF, VIT)
│  └─ Plunder (Gold) ─ Spiked Mail (reflect) ─ Sunder (enemy DEF ignored)
│      └─ Vanguard■ (Damage Champions: PWR)
├─ Mage: Focus (SPD)
│  ├─ Arcane Well (PWR) ─ Quickening (cooldowns) ─ Spell Mastery◆ ─ Overchannel◆ ─ Archmage∞
│  │   └─ Mesmerists■ (Control Champions: SPD)
│  └─ Insight (XP) ─ Ward (control resist) ─ Mana Shield (max HP)
│      └─ Chorus■ (Support Champions: IMP, LCK)
└─ Archer: Keen Eye (LCK)
   ├─ Steady Hand (IMP) ─ Vital Spot (crit chance) ─ Marksmanship◆ ─ Rapid Fire◆ ─ Deadeye∞
   │   └─ Pack Tactics■ (every Champion: IMP)
   └─ Forager (offline efficiency) ─ Light Feet (evasion) ─ Hunter's Mark (crit damage)
       └─ Volley Drill■ (every Champion: SPD)
```

◆ class-path node · ■ Champion side node · ∞ endless node

37 nodes: the root, its three ring nodes, and 11 per path. The ring nodes sit between the paths in the root's gold, work for every class and gate nothing (the user's call, 2026-10-11). They are **the way into the paths**: each path's first node is linked to the ring nodes either side of it and opens from either of them, **not from the root** (no line joins them to it). So the route is root, a ring node, then a path, and the links close the inner ring into a hexagon (`PassiveNode.links`, `parentJoined`). The roster is `content/passive-tree.ts`; IDs are stable and are what the save stores.

- **A node opens once its parent, or a node it links, holds a level.** No requirement to max it.
- **Tiers** are rings out from the root, 1–5. A regular node's level `L` costs `PASSIVE_TIER_COST[tier] × L`, so a whole node is 15× its tier's base. The finite tree is 1,500 points; one path's finite nodes are 480.
- **Endless nodes** cost `PASSIVE_ENDLESS_BASE_COST + (L - 1) × PASSIVE_ENDLESS_COST_STEP`. Linear, so the levels a budget buys grow as its square root. They give points a use forever without outrunning the enemy curve.
- **Magnitudes** come from a band per line (`PASSIVE_BAND_MAGNITUDE`): stat, skill, utility, crit damage, economy, endless. A node's lines share one band.

## 4. Who a node reaches

| Kind | Reaches |
|---|---|
| Regular and endless nodes | The Hero only |
| Class-path nodes (◆) | The Hero, **only while the Hero's class is on that path** |
| Side nodes (■) | Fielded Champions of the archetype named, or every fielded Champion |

**Paths are open to every class** (the user's call). Any node can be bought; only the class-path nodes switch off away from their path, and they come back when the Hero does. The Beginner is on no path. **The Ascendant is on all three**, since it fires every master's skill (my call, flagged for review).

The class-path nodes are the backlog's "improved Hero class-path skill effectiveness": Skill damage on the tier-4 node and shorter cooldowns on the tier-5 one.

Side nodes go through `championModifierTotals(hero, archetype)`, so a Champion receives the party-wide lines plus its archetype's side nodes. The Hero never receives them.

## 5. Respec

- **Free once per prestige.** A prestige sets `hq_state.passive_respec_free`, held until used. Like the class token, one held already stays one.
- **Otherwise `PASSIVE_RESPEC_GEMS`.**
- It refunds every point. An empty tree is refused rather than charged.
- The tree is **not** reset by a prestige; the free respec is an option, not a wipe (the user's "free at prestige and any time at a Gem cost").

## 6. Opening

Opens at **3 Worlds cleared** (`FEATURE_UNLOCKS`), between Loadouts at 2 and the raids at 4, so the first visit has a World's levels to spend. My call, not the user's.

---

## As built — 2026-10-11

- **Shared:** `content/passive-tree.ts` (the roster), `passive-tree.ts` (points, prices, the buy gate, path membership, the modifier lines). Hero lines join `heroModifierTotals`; side-node lines join `championModifierTotals`, now archetype-aware. `explain.ts` itemises a "Passive tree" source on every stat breakdown.
- **Schema:** `hq_state.passive_tree` (jsonb) and `hq_state.passive_respec_free` (boolean), migration 0067. `heroSnapshotOf` reads the tree; Arena bots carry none.
- **Routes:** `tree/buy.post.ts` and `tree/respec.post.ts`, both behind the `tree` feature and a settle. Lock-then-read on the `hq_state` row; the paid respec takes Gems in the same transaction.
- **Scene:** `tree-scene.ts`, the eleventh menu button. A radial layout on a starfield, with drag to pan, the wheel or a pinch to zoom, and +/−/centre buttons. Node shapes: circle (Hero), diamond (class path), square (Champions), double ring (endless). The respec asks for a second press unless the Settings toggle "Tree respec" (`confirmTreeRespec`, on by default) is off.
- **Specs:** `test/hero-quest/passive-tree.spec.ts`. Roster shape, prices, the buy gate, path membership, Champion scoping through `partyUnitStats`, and bursts on buy and both respecs.

**Not measured.** None of the tree's power is in the campaign walk, which models no tree. A full Warrior spine adds +15% to DEF, VIT and PWR, and the endless nodes keep adding. Re-measure before tuning (`open-items.md` "Standing numeric tuning").
