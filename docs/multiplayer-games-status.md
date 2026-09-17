# Where the table-game build stands

All four table games are built, merged and green. Nothing is pushed; `main` is untouched.

## The integration branch

`feature/live-table-games` holds all four games merged together, off the foundation. It is what
to review, build and eventually open a PR from.

    typecheck   clean
    test        807 passing, 53 files
    build       clean

| Branch | Worktree | Port |
|---|---|---|
| `feature/live-table-games` | `nuxtpolymarket` (main checkout) | — |
| `feature/live-table-foundation` | — | — |
| `feature/live-roulette` | `../pnx-roulette` | 3201 |
| `feature/live-baccarat` | `../pnx-baccarat` | 3202 |
| `feature/live-three-card-poker` | `../pnx-three-card-poker` | 3203 |
| `feature/live-casino-holdem` | `../pnx-casino-holdem` | 3204 |

The per-game branches are kept as the record of each game's history. Ongoing work should happen on
the integration branch now that they are merged — the same fix applied twice on two game branches
will conflict on the way back in.

Merging surfaced one defect no individual worktree could see: roulette and three card poker still
overrode `voteStart`/`onVoteStart` synchronously against a base class that had since become async,
so a start vote could publish its snapshot before the transition it triggered. Each worktree
typechecked fine because each carried its own older copy of `server/utils/live-table/table.ts`.
That copy is only shared by merging, which is the argument for working on the integration branch.

## The shared control band

The stage coordinate space is **1720x1200**. It grew from 1600x1120 to make room for the bet bar
between the felt and the rack. Height alone could not pay for it: the wrapper is width-driven off a
height budget, so a taller coordinate space at a fixed viewport height renders everything
*smaller*. Width had to grow with it to hold the aspect roughly constant — which also delivered the
"make the table slightly wider" the review asked for, since the page had ~100px of unused width
beside the stage.

Migration rule, for anything still on the old space: **felt y coordinates are unchanged**; x scales
about the new centre, `x_new = round(860 + (x_old - 800) * 1.0773)`.

Landmarks: seats (222,546) (541,604) (860,630) (1179,604) (1498,546), bet bar y=968, rack
(410,1052,900,116), panels (40,1052) and (1330,1052), shoe (1431,140), discard (289,140).

Every table lays the area under the felt out identically — bet bar centred above the chip rack, the
seat's own totals left of them, seat/watching/hints/leave right:

- `LiveTableBetBar` — REPEAT / ½ / 2× / UNDO / CLEAR. Halve and double act on the current bet, or
  on last round's when nothing is staked yet; side bets scale with the main bet. Enforced
  server-side through the escrow path, never `credit`/`debit`.
- `LiveTableCorner` — top-left panel for paytables and roadmaps. Dimmed to 55%, collapsed by
  default, `z-index: 6`, `max-width: 460px` so a growing road cannot run across the felt.
- `LiveTablePaytable` — label / worked card example / odds, red suits in red. Games pass odds read
  from their own rules module, so a printed payout cannot drift from what the server pays.
- `.lb-tile` promoted out of `LiveBlackjackGame`'s scoped block, sized in stage pixels, with
  `cursor: pointer`. Bet-bar buttons are pinned to 48px because the ½ and 2× glyphs are set larger
  than the word buttons and rendered taller.
- Chips are `--lt-chip-size: 96px`, `--lt-chip-size-spot: 84px`, `--lt-chip-size-side: 64px`.
- `.lt-stage-wrap` is width-driven off the height budget. Fixing the height and letting
  `fit-content` find the width let the two disagree on a narrow column: the height held while the
  width, and the scale derived from it, shrank, leaving dead space under a table that never grew
  into its own box.

## No table limits

Betting games carry **no maximum**. `config.maxBet` still exists because the shared `LtConfig` and
the wire type require it, but it is `Number.MAX_SAFE_INTEGER` and no game reads it back. The
player's balance is the only ceiling, enforced where it already was.

A **floor** remains, at or near the smallest chip — roulette 25, baccarat 5, three card poker and
hold'em 1. That is not a limit anyone can bump into; it is what stops a zero, negative, fractional,
`NaN` or `Infinity` stake reaching escrow and corrupting a balance. Do not remove it without
replacing it with an equivalent guard.

Three card poker's old maximum was the worst of the four: it was the value of the *largest single
chip*, so a seat could not bet more than one chip's worth.

## Bugs these rounds found

- **`CH_AA_TABLE` was missing its "Two pair" row** while `aaPayMultiplier` paid two pair at 7:1 —
  hold'em's AA bonus was paying a hand the printed paytable never listed. Surfaced only because
  `LiveTablePaytable` takes its odds from the rules module instead of hardcoded display values.
- **Roulette's `repeat` applied partially.** If the balance ran out partway through re-staking a
  slip, the earlier legs stayed staked. Now rolls back every leg on failure, with a test.
- **Chip stacks painted over their own labels.** Each chip layer carries a positive `z-index` from
  `art.ts`, and with no intervening stacking context those resolved against `.lt-stage`, so any
  chip past the first painted above later DOM siblings — which is what hid hold'em's total-bet
  pill. Fixed with `isolation: isolate` on the stack, not a z-index bump.
- **`.lt-felt-inner` swallowed every click** (earlier round, still worth remembering). An empty
  `z-index: 1` layer inside a transformed ancestor painted above every control on the felt.

## Known gaps

None of these block review; all were reported rather than found later.

- Hold'em: a rare ~10px overlap between the phase pill and the centre seat's hole cards, only when
  seat 3 is occupied. Pre-existing; the pill and the cards were both moved for other reasons and
  they pull on the same tight vertical budget.
- Hold'em's ½ button was never clicked in a live browser — same code path as 2×, unit-tested.
- No table has been reviewed at a full five seats, or at a viewport other than ~1920 wide.
- Card deal/discard animations land on the right coordinates at each phase boundary but were never
  captured mid-motion.
- Roulette's layout was re-derived within the new felt rather than transformed coordinate by
  coordinate — its component computes geometry parametrically.

## Environment notes that cost time

- **Websockets do not upgrade under `bun run dev`.** The upgrade hangs with no error. Test against
  `bun run build` then `PORT=32NN BETTER_AUTH_URL=http://localhost:32NN bun .output/server/index.mjs`.
  Each built process holds its own in-memory table, so separate ports are separate rooms.
- **A server backgrounded with `&`, `nohup` or `setsid` gets reaped between tool calls.**
- **Never `pkill -f ".output/server/index.mjs"`** — it kills every worktree's server at once.
- Seat only 2 bots at a 5-seat table during review, or there is nowhere obvious to sit.

## Unresolved, needs a human decision

`server/utils/live-blackjack/table.ts` carried an unclaimed edit replacing the insufficient-funds
message with `"You think you can gamble without money? Loser. Go get some cash from the bank."` It
sat uncommitted through several rounds, then got swept into a merge commit by an `add -A` while
resolving conflicts. It has been reverted on the integration branch — that text ships to real
players otherwise, and nobody has claimed it. If it was intentional it is a one-line change to put
back, deliberately this time.

`scripts/blackjack-card-counter.js` — a browser-console card counter for the blackjack table — was
untracked in the main checkout at the start of this session and is now gone from disk. It was never
committed to any branch, so it is not recoverable from git. Cause unknown; it was not deliberately
deleted. If it mattered it will need writing again.
