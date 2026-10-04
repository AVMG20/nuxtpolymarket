# Loadouts

Status: **Locked** — decisions confirmed, ready to reference for implementation planning. Resolves idea backlog item 4.

## Structure recap

- A Loadout is a full, named snapshot of everything currently swappable: fielded Party + Formation, equipped Skills, equipped Artifacts, and equipped Gear. Applying a saved Loadout sets **all** of these as the new live state in one action.
- Starts at **2** saved Loadout slots, expandable up to **10** — priced in **Gems**, not Void Shards, since Loadout slots add zero power on their own (pure convenience).
- Each of the **5** raids (Guild/Forge/Training Grounds/Dig-site/**Trait**) can have one saved Loadout assigned as its "preferred" loadout, auto-applied on a fresh engage — auto-reverting to whatever was live before, once the player leaves that raid.
- Saving/applying a Loadout is free and unlimited outside combat, same convention as every other equip-swap mechanic in this project.

---

## 1. What a Loadout Captures

**Locked: everything**, per your call. A single saved Loadout is a complete snapshot of:

| Component | Source |
|---|---|
| Fielded Party (which Champions, 2–5 per current unlocked slots) | `champions-guild-gacha.md` §1 |
| Formation (front/back row per fielded unit) | `classes-and-combat.md` §6, `champions-guild-gacha.md` §8 |
| Equipped Skills (2–5 per current unlocked slots) | `skills-gacha.md` §5–6 |
| Equipped Artifacts (2–5 per current unlocked slots) | `artifacts-dig-site-gacha.md` §7 |
| Equipped Gear (all 6 slots — Weapon/Boots/Gauntlets/Charm/Armor/Helmet) | `gear-equipment.md` §3 |

**Not captured: Hero class/specialization.** Correctly excluded — the Hero's node in the 16-node tree can only change at prestige (`classes-and-combat.md` §5), so it's not a mid-run "loadout" choice the way everything else above is.

**Applying a saved Loadout overwrites all five components at once** — the entire point is bundling what would otherwise be 4–5 separate manual swaps into a single action.

**Never goes stale.** Nothing in this project is ever un-owned or un-unlocked once acquired (no selling mechanic exists anywhere), and slot counts only ever grow via prestige-shop purchases, never shrink. So a saved Loadout — even one saved long ago under fewer unlocked slots — always stays fully valid; applying it just fills however many slots it references, leaving any newly-unlocked extra slots empty until the player re-saves or manually fills them.

---

## 2. Save & Apply

- **Save:** captures the player's current full live state (Section 1) into a chosen slot, overwriting whatever was there.
- **Apply:** sets a chosen slot's saved state as the new live state, all five components at once.
- **Free and unlimited outside combat** — same convention already locked for Skills (§5), Artifacts (§7), and Gear (§3).
- **Player-named**, with a sensible default (e.g. "Loadout 1") — renaming any time, at no cost.

---

## 3. Slot Progression — 2→10, Priced in Gems

**Locked: starts at 2, caps at 10 — 8 purchase levels**, per your call. Unlike every other slot progression in this project (Champion/Skill/Artifact/Gear all gate real party power), Loadout slots add zero combat strength on their own — a player with 2 slots can manually re-equip everything a 10-slot player can, just with more taps each time. That's why this is the first slot track priced in **Gems** rather than Void Shards.

```
cost(level) = BASE_COST_GEMS × 2^(level-1)     // level = 1..8, i.e. 2→3 through 9→10
```

Reuses the "doubling cost per level" shape already established for short prestige-shop tracks (`idle-mechanics.md` §4's Offline Efficiency line, and the Champion/Skill/Artifact/Gear 3-level slot tracks) — extended here to 8 levels instead of 3–5, since 8 sits much closer to that "short track" bucket than to Offline Cap's 32-level "long track" shape.

**Worth flagging explicitly:** this is the first time that formula shape has been stretched past 5 levels, and the first time it's paired with Gems rather than Void Shards. *(Updated: Gems now have several other locked sinks — Battle Speed, Trait save slots (`traits.md` §6), and Arena refreshes/extra attempts (`arena.md` §2–3) — so this curve can finally be checked against a real Gem income-vs-drain picture, which it couldn't when first written.)* A doubling curve across 8 levels tops out at 128× the base cost — plausibly fine for a pure-convenience track meant to be a genuine long-term goal, but it's a real balance unknown rather than a checked-safe number, and worth the balance script's specific attention since it's breaking new ground on both axes (level count and currency) at once.

**No schema change needed for the slot-count mechanism itself** — this reuses the existing generic `hqShopUpgrades (userId, upgradeId, level)` table (`tech-architecture.md` §3) exactly like every other short track; `upgradeId = 'loadoutSlots'` slots straight in.

---

## 4. Per-Raid Auto-Apply

**Locked (revised — 5 raids, not 4): every raid can have one saved Loadout assigned as its preferred loadout** — a pointer to a slot, not separate storage. Assigning/reassigning a raid's preferred loadout is free and unlimited, same as everything else here.

**The Arena gets the same (decided 2026-10-04, `build-log.md` #1).** One preferred Loadout for attacking in the Arena, on the same terms: applied before an attack's fight resolves when one is assigned, reverted on leaving the Arena, and nothing happens when none is. It is unrelated to the Arena's `defenseLoadout` (`arena.md` §1), which stays its own stored snapshot.

**Where it is set (decided 2026-10-04): on the screen it applies to.** Each raid's entry screen carries a picker for that raid's preferred Loadout, and the Arena screen one for attacking — chosen while looking at the fight it is for. The Loadouts scene does not assign; at most it marks which raids and the Arena point at a slot, so a player sees that before Save overwrites it.

**Trait Raid is included** (`raid-system.md` §1 locks 5 raids; this doc originally predated Trait Raid and said 4). It's a real fight and benefits from a dedicated loadout exactly like the others — but it's the one raid where a Key is spent **unconditionally on entry** rather than on a win (`raid-system.md` §3), so the ordering below matters more there than anywhere else:

> **The loadout swap always completes before the Key is debited and before `fight.ts` runs.** A player never spends a Trait Key on a fight that ran with the wrong loadout because the auto-apply hadn't landed yet. For the four win-gated raids this ordering is invisible (a loss costs nothing either way); for Trait Raid it's the difference between a wasted Key and a fair attempt.

**On a fresh raid engage** (not quick-clear — see below):

1. The player's current live state is snapshotted — held only for the duration of the raid session, not written into a saved Loadout slot itself.
2. If that raid has a preferred Loadout assigned, it's applied as the new live state before the fight resolves.
3. The fight runs. The player can retry as many times as they want within this raid session — retries are free per `raid-system.md` §3's win-gated attempts — without re-triggering the swap or the eventual revert.
4. **On leaving the raid** (navigating away, not on every individual attempt), **the live state auto-reverts to the pre-raid snapshot from step 1**, per your call.

**If no preferred Loadout is assigned for that raid, none of this triggers** — the raid is simply fought with whatever's currently live, exactly as if this system didn't exist.

**Quick-clear is excluded from this flow entirely.** Since quick-clear (`raid-system.md` §4) doesn't run a fight — it's a pure reward-grant against an already-cleared level — there's no reason to touch the live loadout for it at all. No snapshot, no apply, no revert.

---

## 5. Cross-Doc Note — Gems' First Concrete Sink

`economy-and-currencies.md` §4 originally listed Gems' sinks as "not yet defined." **Loadout slot expansion was the first of those to actually get designed** — a direct instance of "convenience features," symmetric with Holiday Events becoming Gems' first concrete *source* earlier this session. Applied directly to `economy-and-currencies.md` §4 in this session (see delivered file).

---

## Cross-Doc Edits

**Applied in this session:**
- `economy-and-currencies.md` §4 — Gems' sink list updated to reference this doc as the first concrete example (see delivered file).

**All applied** — `hqLoadouts`, the 5-entry raid-preference map, the revert-snapshot field, and the three routes are now in `tech-architecture.md` §3/§5:

| Doc | Section | Edit needed |
|---|---|---|
| `tech-architecture.md` | §3 | New `hqLoadouts` table: `(userId, slotIndex, name, partyChampionIds, formation, equippedSkillIds, equippedArtifactIds, equippedGear)` — same shape as `hqState`'s existing Loadout column group, just per-slot instead of singular. Plus a small addition to `hqState`: a **5-entry** raid-preference map (`raidId → loadoutSlotIndex`, one per raid including `trait`) and a transient pre-raid-snapshot field for the auto-revert (Section 4) — doesn't need its own table, just enough state to restore the live loadout on raid exit. |
| `tech-architecture.md` | §5 | New API routes: `loadout/save.post.ts`, `loadout/apply.post.ts`, `loadout/set-raid-preference.post.ts`, mirroring the claim-then-reward / lock-then-read patterns already established for every other mutation. |

---

## Implementation Note

Locked: a Loadout is a full snapshot of Party + Formation + equipped Skills + Artifacts + Gear, applied/saved as one unit, free and unlimited outside combat, never goes stale. Starts at 2 slots, caps at 10 (8 purchase levels), priced in Gems rather than Void Shards since it's pure convenience — reusing the existing doubling-cost short-track formula shape, extended past its previous 5-level precedent, flagged as a genuine balance unknown when first written; Gems now have four locked sinks, so it's finally checkable. Each of the **5** raids — including Trait Raid — can have one preferred Loadout assigned, auto-applied on a fresh engage (never quick-clear) and auto-reverted to the pre-raid state on leaving, with retries within a session not re-triggering either step. For Trait Raid specifically, the swap is guaranteed to complete before its unconditional Key debit. The slot-count mechanism itself needs no new schema (reuses `hqShopUpgrades`); the presets table, raid-preference pointers, and revert-snapshot state are now all in `tech-architecture.md` §3.
