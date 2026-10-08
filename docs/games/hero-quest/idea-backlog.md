# Idea Backlog — Inclusion Checklist

This is the running idea list from the "Project ideas memory list" conversation, reconstructed here with a checkbox per item. Check an item once you've decided it should move from backlog into a real design doc — unchecked items stay parked exactly as-is.

**Note:** several of these (Global Power Number, Raid System, Passive Skill Tree, Loadouts, Arena) are already referenced as "on the horizon" work in other locked docs (e.g. `tech-architecture.md` §8 defines Global Power Number's computation point, `tech-architecture.md` §4c/4d anticipate Raid and Arena resolution). Checking those here is really about greenlighting the *dedicated* design pass, not introducing them from scratch.

---

- [x] **1. Global Power Number** — ✅ Implemented, see `global-power-number.md` (Locked)
  A single aggregate score that increases with any strength gain — Hero leveling, gacha pulls/upgrades, new Champions added. Purely a flex/vanity stat for now (may gain mechanical purposes later, e.g. matchmaking or difficulty gating). Counts owned Champions even when benched, since they contribute passive stat bonuses regardless of active-party status.

- [x] **2. Raid System** — ✅ Implemented, see `raid-system.md` (Locked)
  Multiple distinct hard bosses, each with a unique mechanic forcing party/setup adjustments. Rewards include gacha pull tokens (other currencies possibly later). Each raid has its own level track — clearing a level unlocks a harder next level with better rewards — with ~~free level selection (not forced linear)~~ **superseded: `raid-system.md` §2 locked a binary farm-or-progress model instead** (best-cleared level, or exactly one higher; older levels aren't individually reachable). Difficulty scaling is fully separate from the main enemy-curve/prestige formula. Attempts: 3/day default (account-wide), banking up to a week's worth at the player's current rate; a prestige-shop upgrade raises both the daily rate and the bank cap together. Quick-clear: once a level's been beaten, instantly claim its rewards without replaying.

- [ ] **3. Passive Skill Tree**
  A tree of purely passive upgrades — flat stat boosts, improved Hero class-path skill effectiveness, increased Gold/XP gain from idle battle. Starts with a generic damage-upgrade root node, splitting into at least 3 paths (one per Hero class path: Warrior/Mage/Archer). Each node has up to 5 levels (effect and cost both scale per level). Purchased with a currency earned from a new, dedicated raid. Hero-only tree, but can include side nodes that upgrade specific Champions/gacha items — never ownership-locked, never allowed to gate a path.
  **Snag resolved:** `raid-system.md` §1 now confirms raids don't have to be gacha-paired — a standalone raid with its own dedicated currency is a valid instance of the raid structure, so this item's "currency earned from a new dedicated raid" premise is structurally sound. **Confirmed as its own separate raid**, not shared with item 8 (Traits).

- [x] **4. Loadouts** — ✅ Implemented, see `loadouts.md` (Locked)
  Save a full party setup as a named loadout and quickly switch between saved ones. Players can set a preferred loadout per raid, auto-applied on entry. **Scope expanded during design to cover everything swappable** (Party + Formation + Skills + Artifacts + Gear, not just party/formation) since those systems didn't exist yet when this item was first drafted. Starts at **2** loadout slots (revised from the original "5"), purchasable up to 10 — priced in **Gems** rather than Void Shards, since loadout slots add no combat power.

- [x] **5. The Arena (PvP)** — ✅ Implemented, see `arena.md` (Locked)
  Players attack with their current live party (optionally pre-swapped via the Loadout system) against other players' asynchronously-resolved, always-AI-controlled `defenseLoadout`. **Snag resolved:** the GPN divergence flagged during GPN's own design is closed by a new Defense GPN, computed off `defenseLoadout` specifically for matchmaking, rather than reusing the attacker's live GPN. **Scope expanded during design** well beyond the original one-line pitch: a refreshable 3-candidate opponent list with a guaranteed-win Training Dummy fallback when the matchmaking pool runs dry, non-banking daily attempts (5 free, purchasable extra on a doubling ladder), asymmetric Elo rating (separate attacker/defender K-factors), a new attacker-only Medals currency spent in a dedicated cross-currency Arena Shop, 2-week seasons with rank-based rewards, a battle log, and its own Rating-based leaderboard separate from the GPN/progression leaderboard.

- [x] **6. Holiday Events** — ✅ Gift-mechanic phase implemented, see `holiday-events.md` (Locked). Gameplay-event content explicitly **not** designed — deferred per your own call mid-session.
  Starts simple: one-off gifts to the player on holidays (e.g. a login bonus/currency drop tied to a date). Leaves room for actual gameplay events (limited-time content) later — that later phase remains fully open, was deliberately not started.

- [x] **7. Gear/Equipment (4th Gacha)** — ✅ Implemented, see `gear-equipment.md` (Locked)
  The 4th gacha for Hero gear — **now the 1st gacha overall** (revised from the original "2nd" note below). One gear piece boosts one stat, one slot per Hero stat — Weapon (PWR), Boots (SPD), Charm (LCK), Gauntlets (IMP), Armor (VIT), Helmet (DEF) — 6 equip slots total, manually equipped with an upgrade indicator. *(The original note had STR/DEX/INT sharing the Weapon slot; those three were later merged into PWR, so Weapon is simply the PWR slot now.)* Owning pieces (not just equipping them) grants a small collection-bonus to stats, same pattern as the Champions passive.

- [x] **8. Traits** — ✅ Implemented, see `traits.md` (Locked)
  A 5th slot-based system, separate from the 4 gachas: **5 trait slots**, each independently rollable for a stat boost (values + rarity tiers TBD — pool incoming next message) drawn from a pool. Rolling costs a currency earned from a new, dedicated raid (not yet named/designed). Individual slots can be **locked** before rerolling, so a locked slot's current boost survives while the rest reroll. Alongside a stat boost + rarity, each roll also lands on **1 of 5 trait Sets**; stacking more Traits of the same Set unlocks additional set bonuses (Set list also incoming next message).
  **Explicitly separate from Loadouts** (`loadouts.md` §1) — Traits get their own dedicated save-slot system, not folded into the existing Party/Formation/Skills/Artifacts/Gear snapshot. Starts at **1** trait save slot, expandable via **Gems** up to **4**. Unlike Loadout save/apply, which is free and unlimited (`loadouts.md` §2), storing or loading a Trait save slot **costs the Trait currency itself** — the explicit intent being to let players freely reroll toward a better combination without losing a locked-in good one, at a real cost to actually bank/restore it.
  **Snag resolved:** `raid-system.md` §1 now confirms raids don't have to be gacha-paired, so this item's "new raid" premise is structurally sound — same resolution as item 3's identical ask. **Confirmed as its own separate raid**, not shared with item 3 (Passive Skill Tree).
  **Stat-boost pool and Set list received** — see dedicated design session (this item now in active design, not just backlog).
  **Awaiting next message:** the stat-boost pool (values + rarity tiers) and the 5 trait Sets + their stacking bonuses.

- [x] **9. Alternative enemy-scaling formula (smoother stage curve)** — **done**
  The sketch here squashed prestige/world/stage into one position term, which was the right instinct. Shipped as `enemyMultiplier = b^n` with `n = prestige × 100 + (world-1) × 10 + (stage-1)` — an index, not a product, so the zero-at-World-1 edge case this entry worried about never arises (`n = 0` gives a multiplier of exactly 1). See `core-progression-and-prestige.md` §1 and `open-items.md` #10.

- [ ] **10. Tutorials with a guide character** — *added 2026-10-06*
  A guide character who walks the player through the game. Different parts of the game unlock at set checkpoints, and when one unlocks the guide explains how it works. **Two separate trackers on the same checkpoints:** one for which features are unlocked, one for which tutorials have been seen. Resetting the tutorials does not lock any feature again, and skipping them does not unlock any feature early; features unlock only by reaching their checkpoint.
  *Related:* Settings already has "show tutorials" (stored, nothing reads it yet) and "reset tutorials" (shown as `SOON` until there are tutorial flags to clear), `build-log.md` #44. Nothing is gated by checkpoint today, so feature unlocking is new ground too.

- [ ] **11. Milestones** — *added 2026-10-06*
  Rewards for feats in the game, for example: reaching a new world, prestiging, clearing a raid level that is a multiple of 5, and unlocking X of a collection (per collection).
  *Related:* free Seals are already said to come "only from milestones and (later) raid clears" (`open-items.md` precedence table, #29), so this is the milestones that line expects. Rewards would need guarding like every other value grant: claim-then-reward, never read-then-write.

- [ ] **12. 30-day login calendar** — *added 2026-10-06*
  A fixed 30-day calendar of rewards, the same every cycle. **It runs on real days, not days logged in:** a cycle starts over every 30 calendar days, and a missed day cannot be claimed on a later day in the usual way, so a player who misses days can't reach the last rewards. **Three make-up claims per cycle** let the player claim a missed day late.
  *Related:* Holiday gifts (`holiday-events.md`, item 6) are the other date-driven grant. Like them it is lazy, with no cron, worked out on visit (`tech-architecture.md` §4a), and the days are UTC days, like the rest of the game's clock.

---

## Notes
- This doc is a running list only — items move to the relevant locked doc once fully designed and confirmed.
- Checking a box here just marks it ready to design; the actual mechanics still get worked out in their own dedicated conversation/doc, same as every other system in this project.
