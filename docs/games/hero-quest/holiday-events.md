# Holiday Events

Status: **Locked** — decisions confirmed for the "simple gift" phase, idea backlog item 6. Gameplay-event content (limited-time modes/mechanics) is explicitly **deferred, not designed here** — matches the backlog's own "starts simple, leaves room for later" framing, and your call to stop this doc's scope at the gift mechanic.

## Structure recap

- Real-world calendar holidays trigger a claimable gift, once per holiday per year.
- The gift is a **mixed bundle** (Gold, Gems, optionally themed Seals) that varies per holiday — content-authored per holiday, not computed from one shared formula.
- **Claim-then-reward**, the same server-authoritative pattern already used for every other currency mutation in this project.
- Out of scope here: actual gameplay events (limited-time modes/content). This doc only locks the gift mechanic.

---

## 1. Holiday Calendar — First-Pass Roster, Expandable

| Holiday | Date (UTC) | Notes |
|---|---|---|
| New Year's Day | Jan 1 | Fixed date |
| Lunar New Year | Varies — needs a lookup table | Shifts year to year on the Gregorian calendar |
| Halloween | Oct 31 | Fixed date |
| Christmas / Winter Holiday | Dec 25 | Fixed date |

Starting with the most broadly-recognized, commercially-safe set for a global free-to-play audience — same "first pass, not final" spirit as every other content roster in this project (Champion names, Artifact effects, etc.). Adding more holidays later (Easter, a regional holiday, the game's own launch-anniversary) is a config-table addition, not a system redesign — extensibility was a design goal from the start.

**Lunar New Year needs its own lookup table**, not a fixed `MM-DD` — flagging this now since it's a different implementation shape from the other three, not because it's excluded from the launch set.

---

## 2. Claim Window & Timing

- **Resolved in UTC**, not the player's local timezone — avoids timezone-based double-claim exploits or disputes about "which day it is" for a given player, consistent with this project's server-authoritative principle (`tech-architecture.md` structure recap).
- **Claim window: the holiday date plus a few following days** (e.g. a 3-day window), not a single exact-day requirement — matches the forgiving spirit already used for the daily Seal grant's bankable cap (`economy-and-currencies.md` §5), so missing the exact date doesn't simply forfeit the gift.
- **No retroactive catch-up.** A player who starts playing after a holiday's window has closed doesn't receive it later, same as missing the window while already playing. Once per year, not banked indefinitely.
- **Claim-then-reward**, mirroring the existing `seals/claim-daily.post.ts` pattern (`tech-architecture.md` §5) — an explicit claim action, not a silent auto-grant, so the client always has a clear "gift waiting" state to surface.

---

## 3. Gift Bundle — Structure, Not a Fixed Formula

**Locked: mixed bundle, varies per holiday**, per your call — no single formula computes every holiday's gift. Each holiday's exact bundle is content-authored, same deferral pattern already used for the Champion/Skill/Artifact rosters (structure locked now, specific values are an authoring/tuning pass).

Eligible components, per holiday:

| Component | Shape | Notes |
|---|---|---|
| Gold | `HOLIDAY_GOLD_MINUTES(holidayId)` minutes of current income | Same duration-of-income denomination as every other Gold burst in this project (`gold-economy.md` §6) — stays correctly sized at any point on the curve, no per-holiday retuning ever needed |
| Gems | Flat amount, `HOLIDAY_GEM_AMOUNT(holidayId)` | The first concrete instance of `economy-and-currencies.md` §4's "achievements and events" Gem source — flat rather than curve-denominated, since Gems have no growth curve to track against (a deliberately slow, flat trickle by design) |
| Seals (any/all of the 4 raid-tied types) | Flat amount, `HOLIDAY_SEAL_AMOUNT(holidayId, sealType)` | Optional per holiday — a themed nice-to-have, not guaranteed on every holiday |

**Not every holiday needs every component.** A bigger holiday (Christmas) can carry a richer bundle than a smaller one (Halloween) — that variance is exactly what "a mix, varies per holiday" means in practice. Exact per-holiday contents are left to your authoring pass, same as every other content roster in this project.

---

## 4. Cross-Doc Edit Applied

**Applied in this session:** `economy-and-currencies.md` §4 — added a one-line pointer from the Gems "achievements and events" source to this doc as its first concrete example (see delivered file).

---

## As built (2026-10-09, `build-log.md` #49)

What the build had to settle that this doc leaves open, none of it a rule change:

- **The window is three UTC days, the holiday counted** (`HOLIDAY_CLAIM_WINDOW_DAYS`, `UNTUNED ╧`): §2's "e.g." taken as the whole window.
- **A gift belongs to the year its holiday fell in**, the claim's key with the holiday's ID, so a window running past New Year's Eve claims the earlier year's gift.
- **Lunar New Year's table** (`LUNAR_NEW_YEAR_DATES`) runs 2024 to 2050, each the date in China taken as that UTC day.
- **The claim is modelled on the login calendar** (`build-log.md` #47): §2's `seals/claim-daily.post.ts` was retired by `open-items.md` #29.
- **The gift is claimed in the Calendar scene**, the "gift waiting" state §2 asks for: its title row shows the open gift's button, or which comes next.

---

## Implementation Note

Locked: the holiday-gift mechanic only. A first-pass 4-holiday real-world calendar (Jan 1 fixed, Lunar New Year via lookup table, Oct 31 fixed, Dec 25 fixed), UTC-resolved 3-day claim windows with no retroactive catch-up, claim-then-reward delivery mirroring the existing daily-Seal-claim pattern, and a per-holiday-authored mixed bundle (Gold via duration-of-income, flat Gems, optional flat Seals) rather than one shared formula. Gameplay events (limited-time modes/content) are explicitly out of scope here, per your steer — a future design pass of its own, not a natural extension of this one.

**One open item worth a sanity check before implementation, not a design gap in this doc:** since Gold and Gems are shared balances across every game on the polynux platform, it's worth confirming whether the platform already has its own cross-game holiday-event precedent this should align with, rather than assuming this game's calendar/claim mechanic is being built in isolation.
