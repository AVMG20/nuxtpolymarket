# Building a game on the LiveTable foundation

Everything a multiplayer table needs that is not its own rules already exists. A game supplies
rules; the foundation supplies seats, phases, money, chat, sockets and the table surface.

## Server

Subclass `LiveTable<TSeat, TShared, TAction>` from `#server/utils/live-table/table`.

- `TSeat` — per-player game data (their bets, their hand)
- `TShared` — the game-wide half of the snapshot (the board, the dealer, the wheel result)
- `TAction` — the game's own client messages

```ts
class RouletteTable extends LiveTable<SeatState, SharedState, RouletteAction> {
    protected readonly config: LtConfig = {
        game: 'roulette',            // also the transaction category — one analytics row per game
        seats: 0,                    // 0 for a seatless game
        minBet: 25,
        maxBet: 1_000_000,
        disconnectGrace: 60_000,     // holds a place while money is staked
        disconnectGraceIdle: 15_000
    }

    protected createSeatState() { return { bets: {} } }
    protected gameState() { return { lastNumbers: this.history } }
    protected onAction(userId, action) { /* validate, apply */ }
    protected onPhaseEnd(phase) { /* advance the round */ }
    protected onTableActive() { this.advance('betting', 20_000) }
}

export const rouletteTable = new RouletteTable()
```

### What you get

| Member | Use |
|---|---|
| `run(fn)` | Serializes a mutation. Sockets and timers already go through it. |
| `advance(phase, ms)` | Set a phase and schedule `onPhaseEnd` for when it expires. |
| `setPhase` / `schedule` | The pieces, when `advance` is too blunt. |
| `stake(player, amount, kind)` | Debit + rake + escrow row, one transaction. |
| `settle(payouts)` | Credit, close escrow, update streaks and the scoreboard. |
| `refund(userId, ids)` / `abortRound()` | Hand stakes back. |
| `playerOf` / `requirePlayer` / `seated` / `everyone` | Player registry. |
| `join(userId, name, emblem)` | Register a player with no seat, for seatless games. |
| `fail('message')` | Reject the action; the client shows the message verbatim. |
| `bus.broadcast(...)` | Push a one-shot event. |
| `round4(n)` | Round money to the numeric(19,4) column. |

### Rules you do not get to break

- **Never call `credit` or `debit`.** Stake and settle only. That is the entire reason payouts are
  safe under concurrency, and it is enforced by review, not by the compiler.
- **Never use `Math.random()`.** Outcomes roll through `#shared/utils/random`.
- A stale timer must never act. `advance`/`schedule` already guard on the phase token — do not
  hand-roll a `setTimeout` that mutates the table.
- `settle()` is idempotent: it pays only if it wins the escrow claim. Do not add a second payout
  path around it.

### The socket route

Three lines, in `server/api/<game>/ws.ts`:

```ts
import { defineTableSocket } from '#server/utils/live-table/socket'
import { rouletteTable } from '#server/utils/live-table/roulette'

export default defineTableSocket(rouletteTable)
```

`sit`, `leave` and `chat` are handled for you. Everything else arrives at `onAction`.

## Client

```ts
const table = useLiveTable<SeatState, SharedState, RouletteAction>('roulette')
// table.state, .mySeat, .youId, .balance, .feed, .chat, .connected, .skew
// table.sit(n), .leave(), .chatSend(text), .act(action)
```

`skew` is the server clock minus the local clock — subtract it before counting down to
`phaseEndsAt`, or clients with a wrong clock show the wrong timer.

### The table surface

```vue
<LiveTableStage>
  <div class="lt-hand" style="left:800px;top:196px" v-html="cardFace('A', 'spades')" />
  <div class="lt-spot" style="left:800px;top:736px" />
</LiveTableStage>
```

**The stage is a real 1600×1120 coordinate space.** Position everything in those coordinates; the
stage scales itself to fit. This is the same space `scene.ts` uses, so a layout transfers between
this and the Pixi blackjack table without being re-derived.

Reference coordinates: seats `(208,546) (504,604) (800,630) (1096,604) (1392,546)`, bet spot at
seat `+106`, hand at `−100`, nameplate at `+226`, dealer `(800,196)`, chip rack `y=1048`.

Art comes from `~/utils/live-table/art` — `cardFace(rank, suit)`, `cardBack()`, `chip(value)`,
`chipStack(amount, { size })`, `chipsFor(amount)`. **Never hand-draw a card or a chip**; these are
geometry-exact ports of the Pixi table's own art.

Furniture classes, all in `app/assets/css/live-table.css`: `lt-felt`, `lt-arc`, `lt-spot`
(`.lit` `.you`), `lt-plate` (`.you`), `lt-badge` (`.win` `.lose` `.push` `.gold`), `lt-hand`
(`.tight`), `lt-rack`, `lt-phase`, `lt-rules`, `lt-strip`, `lt-overlay` (`.amber`), `lt-streak`,
`lt-stack`, `lt-mono`. Chip size is `--lt-chip-size` (72px rack) and `--lt-chip-size-spot` (56px).

Rail panels: `<LiveTableChat>`, `<LiveTableFeed>`, `<LiveTableScoreboard>`.

## Testing

Websockets do not upgrade under `bun run dev` here. Test against a production build:

```bash
bun run build
PORT=32NN BETTER_AUTH_URL=http://localhost:32NN bun .output/server/index.mjs
bun scripts/table-bots.ts --game=<slug> --port=32NN --bots=4
```

Each built process holds its own in-memory table, so separate ports are separate rooms.

Register a bot strategy for your game in `scripts/table-bots.ts` via `registerStrategy`.
