# Multiplayer table games — design and build plan

Companion to `docs/multiplayer-games.md`, which is the brief. This document is the contract the
build agents work from. Phase 1 is Roulette, Casino Hold'em, Three Card Poker and Baccarat.
Phase 2 (Crash, Plinko, Mines, Money Wheel) is scoped here for context only and is not built yet.

## What already exists

`LiveBlackjackTable` (`server/utils/live-blackjack/table.ts`, 1113 lines) is the only multiplayer
table in the app. Roughly 40% of it is blackjack — the shoe, the hand rules, the turn engine, the
dealer. The other 60% is table plumbing that every game in this suite needs:

- a serialized `run()` chain, so no two mutations interleave across an `await` on a balance write
- a phase machine with a monotonic `phaseToken`, so a stale timer cannot fire into a new round
- seat lifecycle: sit, leave, leave-while-live, disconnect, watcher counting
- per-table chat, feed events, and a scoreboard with alumni retention
- wager escrow (`live_blackjack_wagers`) plus a boot-time recovery sweep that refunds anything a
  crashed process left unsettled
- a full-snapshot broadcast model with a server clock stamp so clients can correct for drift

That 60% is what Phase 0 extracts. It touches exactly one database table, which is why four games
can be built concurrently without fighting over the schema.

## Phase 0 — shared foundation (orchestrator, on `main`, before any agent starts)

### Server

`server/utils/live-table/` — a `LiveTable` base class carrying the run chain, phase machine, seat
lifecycle, chat, scoreboard, escrow and publish loop. Games subclass it and supply:

| Hook | Responsibility |
|---|---|
| `config` | seat count, timers, min/max bet, escrow table, transaction category |
| `buildGameState()` | the game-specific half of the snapshot |
| `onPhaseEnd(phase)` | what happens when a phase timer expires |
| `handleAction(userId, action)` | validate and apply one player action |
| `resolveRound()` | decide outcomes and return payouts for the base to settle |

The base owns every balance write. Games return payout intents; they never call `credit`/`debit`
themselves. That keeps the concurrency rules in one reviewed place instead of four.

**Live blackjack is not migrated onto this base.** It works, it is shipped, and rewriting it to
prove out a new abstraction is how you break it. The cost is one duplicated copy of the plumbing,
which is worth paying. Revisit once four games have exercised the base.

### Client

- `app/utils/live-table/art.ts` — DOM/SVG card and chip renderer, geometry-ported from
  `app/utils/live-blackjack/art.ts` so cards and chips are identical to the existing table.
- `app/components/live-table/` — the shared shell: felt frame, bet spot, nameplate, chip rack,
  phase pill, result badge, table feed, and the scrolling chat panel.
- `app/composables/live-table.ts` — generic socket client: connect, reconnect, snapshot apply,
  clock-skew correction, feed buffer.

### Sizing (the global UI fixes from the brief)

Set once, centrally, as tokens — not re-derived per game.

- **Stage** is 16:10, capped at `min(780px, 100vh - 300px)` tall. That is a 1080p viewport minus
  browser chrome, the app top bar, the title bar and page padding, with the right sidebar in
  place. No vertical scrolling to see the whole table.
- **Chips** render at 72px in the rack and 56px on a bet spot, up from blackjack's effective ~46px.
  One variable, `--lt-chip-size`.
- **Card games seat five**, matching blackjack.

### Also in Phase 0

- One migration adding all four escrow tables at once.
- Four registry entries in `app/pages/index.vue`.
- The bot harness (below).
- The analytics category rollup (below).

Agents never touch `server/database/schema.ts`, `drizzle/`, or the registry. That removes the
entire class of merge conflict up front.

## Analytics — profit and loss per game, not per bet type

The analytics page groups on the raw `transactions.category` string, so today one game spreads
across several rows: `live-blackjack`, `live-blackjack:double`, `live-blackjack:split`,
`live-blackjack:insurance`, `live-blackjack:side:perfectPairs`, `live-blackjack:side:twentyOnePlusThree`,
`live-blackjack:refund`, `live-blackjack:recovery`, plus a historical plain `blackjack` from an
implementation that no longer exists. That is nine rows for one game.

Fixed by normalising at read time in `server/api/analytics/transactions.get.ts` rather than at write
time, so historical rows collapse too and no data migration is needed:

- take the segment before the first `:`, then map it through an alias table to a display name
- `blackjack`, `live-blackjack`, `live-blackjack:*` → **Blackjack**
- `shapezz`, `shapezz:*` → **Shapezz**; `gems`, `gem market`, `gem exchange` → **Gems**
- category filtering matches on the same normalised value, so clicking a game selects all its rows

The four new games write a plain category with no suffix — `roulette`, `casino-holdem`,
`three-card-poker`, `baccarat` — so they are correct by construction. Side bets, ante/play legs and
refunds all bill to the game's own category.

`getDailyNet` already matches on a category prefix and is unaffected.

## Phase 1 — the four games

Each agent works in its own git worktree branched from an up-to-date `main`, on its own port, and
writes only: a rules module in `shared/`, a table subclass in `server/`, a page and component in
`app/`, and tests. Everything shared comes from Phase 0.

| Game | Branch | Port | Shape |
|---|---|---|---|
| Roulette | `feature/live-roulette` | 3201 | No seats, no turns. One shared layout, one spin. |
| Baccarat | `feature/live-baccarat` | 3202 | Five seats. Fixed drawing rules, zero decisions. |
| Three Card Poker | `feature/live-three-card-poker` | 3203 | Five seats. One play-or-fold per hand. |
| Casino Hold'em | `feature/live-casino-holdem` | 3204 | Five seats. One call-or-fold after the flop. |

### Roulette

Single-zero European wheel. Full betting layout: straight, split, street, corner, line, column,
dozen, red/black, odd/even, high/low. Payouts are a lookup table keyed by bet type.

Brief-specific requirements:
- `x2`/`x3` multiplier markers render **above** chips in stacking order.
- **No player names on the felt.** Bets and the players who placed them appear in the right-hand
  sidebar feed as they are placed.
- Betting is open to everyone watching — there is no seat to take and no turn to wait for.

### Baccarat

Punto banco off a shared six-deck shoe. Player, Banker, Tie, plus Player Pair and Banker Pair.
The third-card rule is a fixed table for both sides, so there is no turn engine at all — the
cheapest of the four to build. Banker wins pay 0.95:1.

### Three Card Poker

Each seat plays three cards against the dealer. Ante, then one binary decision — play (matching
the ante) or fold. Dealer qualifies on queen high. Pair Plus is an independent side bet resolved
off the player's own three cards regardless of the dealer.

### Casino Hold'em

Two hole cards per seat, five shared board cards, against the dealer only — never against other
players. Ante, then one call-or-fold after the flop, call being 2× the ante. Dealer qualifies on a
pair of fours or better. Ante pays on a scale from straight upward.

## Testing and QA

Each agent is responsible for its own QA before asking for a human check.

**Websockets do not work under `bun run dev` in this environment.** Every `defineWebSocketHandler`
route hangs the upgrade — no 101, no error, the client sits in CONNECTING forever. All multiplayer
testing runs against a production build:

```bash
bun run build
PORT=32NN BETTER_AUTH_URL=http://localhost:32NN bun .output/server/index.mjs
```

Each built process holds its own in-memory table, so four agents on four ports get four genuinely
isolated rooms and cannot collide.

Required before requesting review:

1. **Unit tests** for the rules module — hand evaluation, payout tables, drawing rules. Pure
   functions, no database, no table state. These are the tests that catch a wrong payout.
2. **Smoke test** that boots the table, seats bots, plays a round to settlement, and asserts the
   balances moved by the right amounts.
3. **Bot clients** driving the real socket against the built server: sit, bet, act, chat, leave
   mid-round, disconnect mid-round. This is what catches phase-machine and escrow bugs.
4. `bun run typecheck` and `bun run test` green. Not negotiable — `main` is shared and a type
   error there fails CI for every other open branch.

Agents may parse rendered HTML to check layout properties, but that is not visual sign-off.

### The bot harness

A script the orchestrator ships in Phase 0 and the user can run during review to fill seats:

```bash
bun scripts/table-bots.ts --game=baccarat --port=3202 --bots=4
```

Bots are QA and review tooling only. Nothing bot-related ships to production.

## Human validation

An agent that passes its own QA **stops** and requests a visual check. It does not merge, does not
push, and does not start anything else. The user reviews one game at a time, plays a few hands, and
confirms scaling, chip size and layout. Nothing merges to `main` without that confirmation.

## Non-negotiables

The brief says complex RTP math is not required, and that is accepted — payout tables are picked
for feel, not tuned to a target. These are separate and still apply:

- Outcomes roll through `shared/utils/random.ts`. Never `Math.random()` — it is xorshift128+ with
  state shared across every request the process serves.
- Every payout is a claim-then-reward conditional `UPDATE ... RETURNING`, never read-then-write.
  Ten concurrent rakeback claims once paid out ten times in this codebase.
- Never compare-and-swap on a `timestamp` column: Postgres stores microseconds, JS `Date` holds
  milliseconds, so the guard matches zero rows and fails closed forever.
- Any write inside a transaction holding a row lock passes that `tx` through, or it deadlocks
  against its own lock on a second pool connection.

## Phase 2 — scoped, not built

- **Crash, Plinko, Mines are not table games.** No felt, no chips, no seats. Bespoke standalone
  layouts with exact dollar-amount input fields, and cash-out sliders for Crash and Plinko. They
  reuse the socket layer and the phase machine, nothing visual.
- **Money Wheel is recoloured.** The current mockup is shades of brown and reads as colourblind.
  Vibrant, distinct per-segment colours. Remove the on-wheel player display; players appear in the
  feed and chat instead.
- Plinko's drawn multiplier table returns 99%, not 98% — centre bin `0.3x → 0.25x` corrects it
  without touching any other bin.
- Money Wheel's classic Big Six payouts carry an 11–24% house edge depending on segment, several
  times anything else in the app. Retune before it ships.

## Acceptance criteria (all four games)

1. Whole table visible on a 1080p screen with the sidebar shown, no vertical scrolling.
2. Chips legible at a glance — 72px in the rack, 56px on a spot.
3. Two or more clients see the same round resolve identically, with no desync across a reconnect.
4. A player who disconnects mid-round has their stake settled or refunded, never pocketed.
5. Analytics shows one row per game, correctly signed.
6. Card games have a working per-table chat with a scrollbar and capped scrollback.
7. Roulette shows no names on the felt; bets appear in the sidebar feed.
8. `typecheck` and `test` green.
