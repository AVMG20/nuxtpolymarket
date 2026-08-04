# Where the table-game build stands

Resume point after the session limit was hit mid-round-three. Nothing is pushed; `main` is
untouched. Every branch below is local.

## Branches

| Branch | Worktree | Port |
|---|---|---|
| `feature/live-table-foundation` | `nuxtpolymarket` (main checkout) | — |
| `feature/live-roulette` | `../pnx-roulette` | 3201 |
| `feature/live-baccarat` | `../pnx-baccarat` | 3202 |
| `feature/live-three-card-poker` | `../pnx-three-card-poker` | 3203 |
| `feature/live-casino-holdem` | `../pnx-casino-holdem` | 3204 |

The foundation branch is the parent of all four. Merge it into a game branch to pick up shared
fixes; the only file that ever conflicts is `app/assets/css/live-table.css`, and the foundation
copy is the one to keep.

## Done and committed

**Foundation** — `LiveTable` base (run chain, phase/token machine, seats, chat, scoreboard,
escrow, snapshot), per-room socket bus, `defineTableSocket`, configurable shoe, one `table_wagers`
escrow table with a `game` column, boot-time recovery sweep, DOM card/chip art ported from
`art.ts`, the table shell components, `useLiveTable`, and the bot harness.

Shared fixes that came out of review, all committed on the foundation:

- Stage sizing — `min(900px, calc(100vh - 110px))`. The original subtracted browser-toolbar height
  that `100vh` already excludes, so the table rendered ~160px short on a real screen.
- `.lt-felt-inner` given `pointer-events: none`. It is an empty `z-index: 1` layer, and because
  `.lt-stage` has a transform it painted above every control and swallowed **every click on the
  felt** — seats could not be taken, bets could not be placed. This is why sitting appeared broken
  while the same action over the socket worked.
- Vote-to-start in the base: `voteStart`, `everyoneVoted`, `clearVotes`, overridable `onVoteStart`,
  wired through the socket and `useLiveTable`, with `votedStart` on the seat.
- `LiveTableFeed` auto-scrolls (only when already at the bottom) and colours each name via
  `nameColor()`.
- `.lt-sit` promoted to shared furniture so the three games stop reinventing the sit prompt.
- Contract test isolated per run — four worktrees share one Postgres and a fixed seed id collided.

**Analytics** — profit and loss is one row per game. All nine `blackjack`/`live-blackjack:*`
variants collapse to `Blackjack`, `shapezz:*` to Shapezz, the three gem categories to Gems.
Normalised at read time, so history collapses too and no data migration was needed.

**Games** — all four are built, playable and green: roulette 603 tests, baccarat 618, three card
poker 614, casino hold'em 630. Each has its rules module in `shared/`, a `LiveTable` subclass, a
three-line socket route, a page and component, a registry entry and a bot strategy.

Roulette also has its round-three layout rebuild committed (`feat(roulette): rebuild the felt to
the classic wheel-beside-table layout`).

## In progress, uncommitted in the worktrees

Round-three review feedback. Each worktree holds a partial edit that was mid-verification when the
limit hit. **The work is on disk and is not lost, but none of it has been screenshot-verified.**

- **roulette** — `RouletteGame.client.vue`, `server/utils/live-table/roulette.ts`,
  `shared/utils/roulette/types.ts`, new `app/utils/roulette/`, new `test/roulette/wheel-spin.spec.ts`
- **baccarat** — `BaccaratGame.client.vue`, `pages/games/baccarat.vue`,
  `server/utils/live-table/baccarat.ts`, `app/assets/css/live-table.css`
- **three-card-poker** — `ThreeCardPokerGame.client.vue`,
  `server/utils/live-table/three-card-poker.ts`, `test/three-card-poker/table.spec.ts`
- **casino-holdem** — `CasinoHoldemGame.client.vue`, `pages/games/casino-holdem.vue`,
  `app/utils/live-table/art.ts`, `shared/utils/casino-holdem/rules.ts`,
  `app/assets/css/live-table.css`

Verify each with `bun run typecheck` and `bun run test` before trusting it.

## Outstanding review feedback

**Roulette**
- **The ball lands exactly between two pockets every round** — a systematic half-pocket offset. It
  reads as landing on the boundary of, say, 23 and 10 while the result says 10. Highest priority;
  derive the angle from pocket ordering and arc width rather than a fudge constant, and check
  across several consecutive spins.
- Wheel and betting area do not both fit — shrink the wheel.
- Wheel number text too small.
- Remove the street/corner/line boundary markers (the dense dot strip). Splits themselves are
  already gone; these are what the user is reading as splits.
- Vote to start early after placing or repeating bets.
- Move "NO MORE BETS" directly above the betting area or the chip legend.
- Move the recent-results strip to the top centre.

**Three Card Poker** — the user called this one good; the rest are refinements.
- Wider table.
- Vote to start / skip.
- Bigger text on the Ante Bonus and Pair Plus paytables, and on the bottom-right seat panel
  (Hints / Leave / Ante / Pair+ / Seat N).
- Decision window 20–25s, up from 15.

**Baccarat**
- Table art and the sit prompts must stay visible in every phase, not just betting.
- Wider table.
- Vote to start / skip.
- Pair side-bet chips are far too small to read — rework the cluster rather than nudging the radius.
- A popup after a round naming what the local player won.

**Casino Hold'em**
- Bigger table.
- Hide the side-bet paytables by default.
- Controls (Leave, Hints, call/fold) restyled to the shared `.lb-tile` family so every table's
  control strip reads the same.
- Decision window 20–25s.

**All three card games** — card dealing animations plus a discard pile. Cards should animate out
of the shoe and into position, and away to a discard pile at the end of a round. Use the real
blackjack coordinates so the suite agrees: shoe `(1330, 140)`, discard `(270, 140)` in the
1600×1120 stage space. Presentation only — it must never gate settlement.

## Environment notes that cost time

- **Websockets do not upgrade under `bun run dev`.** The upgrade hangs with no error. Test against
  `bun run build` then `PORT=32NN BETTER_AUTH_URL=http://localhost:32NN bun .output/server/index.mjs`.
  Each built process holds its own in-memory table, so separate ports are separate rooms.
- **A server backgrounded with `&`, `nohup` or `setsid` gets reaped between tool calls.** Use the
  Bash tool's `run_in_background` parameter.
- **Never `pkill -f ".output/server/index.mjs"`** — it kills every agent's server. Kill by PID or
  scope the pattern to the worktree path.
- Seat only 2 bots at a 5-seat table during review, or there is nowhere obvious to sit.

## Unresolved, needs a human decision

`server/utils/live-blackjack/table.ts` has an uncommitted edit that nobody has claimed. It
replaces the insufficient-funds message with `"You think you can gamble without money? Loser. Go
get some cash from the bank."` It was deliberately left uncommitted rather than reverted, in case
it is intentional — but it ships to real players if it lands.
