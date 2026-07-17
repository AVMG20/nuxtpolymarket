# Polynux — Claude context

## Stack

- **Framework**: Nuxt 4 with Vue 3
- **UI**: Nuxt UI (v3) — use its components and design tokens wherever possible
- **ORM**: Drizzle ORM with PostgreSQL
- **Auth**: better-auth — session is retrieved server-side via `auth.api.getSession({ headers: event.headers })`
- **Package manager**: bun; always use `bun` for adding and removing packages and executing scripts. try not to use `pnpm`

## Colors

Always use Nuxt UI semantic color tokens instead of arbitrary hex or raw Tailwind palette values when possible. Prefer:
- `text-primary`, `bg-primary`, `border-primary`, etc. for the theme accent
- `text-muted`, `bg-elevated`, `bg-background`, `border-default` for surfaces and subtle text

## Client-side auth — `app/composables/auth.ts`

Auto-imported composable. Provides session state and auth actions.

```ts
const { user, fetchSession, signOut } = useAuth()

// user is a reactive ref — access fields directly:
user.value?.name
user.value?.email
user.value?.balance  // numeric string, e.g. "1234.5000"
user.value?.gems     // integer

// Parse balance for comparisons/display:
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

// Refresh session after server-side changes (e.g. after a purchase):
await fetchSession()
```

Always call `fetchSession()` after any action that mutates the user's balance or gems so the UI stays in sync.

To disable a purchase button when the user can't afford it:
```vue
:disabled="balance < cost"
```

## Utilities

### `formatNumber` — `app/utils/format-number.ts`

Auto-imported Nuxt utility. Formats a number for display.

```ts
formatNumber(value: number | bigint, compact?: boolean): string
// compact defaults to true  →  1 234 567  →  "1,2M"
// compact = false           →  full number with up to 2 decimal places
```

Always use this when displaying balance or gem amounts in the UI.

## Server-side balance — `server/utils/balance.ts`

All functions run inside a Drizzle transaction and record a corresponding row in the `transactions` table. `debit` throws a `400` if the user has insufficient balance — no need to check manually.

```ts
import { credit, debit, getBalance, getHistory } from '#server/utils/balance'

// Add money to a user
await credit(userId, '100.00', 'category?')   // amount is a numeric string

// Remove money from a user (throws 400 if insufficient)
await debit(userId, '25.50', 'category?')

// Read current balance (returns numeric string)
const balance = await getBalance(userId)

// Read transaction history (returns up to `limit` rows, default 50)
const history = await getHistory(userId, 50)
```

`amount` is always a string representing a decimal number (matches the `numeric(19,4)` DB column). Pass the optional `category` to tag the transaction (e.g. `'game:cyber'`, `'deposit'`).

`credit`, `debit`, `creditGems`, `debitGems` and `accumulateRake` all take an optional final `tx` argument. **If you are inside a `db.transaction()` that holds a row lock, you must pass `tx`** — otherwise the write goes out on a second pool connection and deadlocks against the lock your own transaction is holding.

## Concurrency — never read-then-write value

Any endpoint that grants or spends value (coins, gems, items, collectables) is a target for a burst of concurrent requests. A `SELECT` to check, followed by an `UPDATE` to apply, is **always a bug**: under Postgres' default READ COMMITTED, N concurrent requests all read the same pre-state, all pass the check, and all apply. This has been exploited in this codebase before — 10 parallel rakeback claims paid out 10x.

**The mutation itself must be the guard.** Two acceptable patterns:

**A — claim-then-reward.** Preferred when a flag or row marks the reward as consumed. Flip it with a conditional `UPDATE`, and only pay out if you won the claim:
```ts
const [claimed] = await tx.update(hackOps)
  .set({ collected: true })
  .where(and(eq(hackOps.id, opId), eq(hackOps.userId, userId), eq(hackOps.collected, false)))
  .returning()
if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already collected' })
// only now roll rewards and credit
```
The same shape covers spends (`debitGems` guards `gems >= cost` in the WHERE) and sells (conditional `DELETE ... RETURNING`, credit only if a row came back).

**B — lock-then-read.** When there's no flag to flip and you need the old value, take `SELECT ... FOR UPDATE` inside a transaction (see `getLockedBankState` in `server/utils/bank.ts`), and pass that `tx` to every write. Read the row *inside* the lock — a value read before it is already stale.

**Never compare-and-swap on a `timestamp` column.** Postgres stores microseconds (`09:11:43.761343`) but drizzle hands back a JS `Date`, which only holds milliseconds (`09:11:43.761`). A `where(eq(table.someTimestamp, valueYouRead))` guard therefore matches **zero rows** for any row written by `defaultNow()`, silently failing closed forever. Use pattern B for timestamps. Integer and boolean columns are safe to CAS.

Reviewing your own diff: if a handler reads a value, and later writes a value derived from it, ask what happens when the same request runs twice at once. If the answer isn't "the second one throws", it's not finished.

## Randomness — `shared/utils/random.ts`

**Never use `Math.random()` for anything that decides an outcome, payout, drop, or roll.** It is xorshift128+ in V8 — not a CSPRNG, and its state is shared across every request the process serves. Use the helpers instead:

```ts
import { randomFloat, randomInt, randomPick, randomChance } from '#shared/utils/random'

randomFloat()            // [0, 1) — drop-in for Math.random()
randomInt(1, 6)          // inclusive both ends
randomPick(items)        // uniform element
randomChance(0.25)       // true 25% of the time
```

`Math.random()` is acceptable only for cosmetics with no bearing on state — animation jitter, decorative sprite placement.

Do not roll your own from `crypto.getRandomValues`. Note `x / 0xFFFFFFFF` is a subtly wrong idiom (it can return exactly `1.0`, so `Math.floor(r * len)` can index off the end of an array) — `randomFloat()` is correctly `[0, 1)`.

## Database schema highlights — `server/database/schema.ts`

- `user` — `id`, `name`, `email`, `balance` (numeric string), `gems` (integer)
- `transactions` — `id`, `userId`, `amount`, `type` (`'credit'` | `'debit'`), `category`, `createdAt`
- `session`, `account`, `verification` — managed by better-auth, don't touch directly

## API conventions

- Files live in `server/api/` and use Nitro's file-based routing (`*.get.ts`, `*.post.ts`, …)
- Always validate the session at the top of protected endpoints:
  ```ts
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  ```
- Use `#server/` path aliases for all server-side imports:
  ```ts
  import { db } from '#server/database'
  import { user, minerState } from '#server/database/schema'
  import { auth } from '#server/utils/auth'
  import { credit, debit } from '#server/utils/balance'
  ```

## Code style

- 4-space indentation in `server/` and `shared/` TypeScript files
- No semicolons, single quotes, no trailing commas (`commaDangle: 'never'` in ESLint config)
- `braceStyle: '1tbs'` — opening brace on the same line as the control statement

## Branches

Format: `type/short-description-kebab-case`  
Types: `bugfix/`, `feature/`  
Always branch from an up-to-date `main`.

## Commits

- Short, imperative subject line describing the actual change
- Multiple commits when changes span different concerns
- No `Co-Authored-By` lines, no footers, no summaries after the subject
- **Do not commit or push unless explicitly asked to do so.**

## Pull requests

- Title: the branch name verbatim (e.g. `bugfix/gem-slippage-race-condition`)
- Body: empty
- Base branch: always `main`

## Rebases

- Claude may run `git fetch` and `git rebase` to start a rebase, but stops there — do not resolve conflicts, continue, or push. Hand off to the user after initiating.
