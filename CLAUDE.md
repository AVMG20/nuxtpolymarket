# Polynux

A play-money gaming site. Players earn and spend **coins** (`user.balance`) and **gems** (`user.gems`) across casino games (slots, dice, roulette, live tables), idle and strategy games (Xeno, Hack Ops, Colony, Polytown, Pathwarden, …), a TCG, a bank, a gem exchange and an AI assistant. Every feature touches the economy, so treat value-changing code with care.

## Stack

- Nuxt 4 + Vue 3, **Nuxt UI v4** (use its components and semantic tokens)
- Drizzle ORM + PostgreSQL (`server/database/schema.ts`)
- better-auth
- **bun only**. Never `npm`, `pnpm` or `yarn`. `bun.lock` is the only lockfile.

## Layout

- `app/`: pages, components, composables and utils (all auto-imported)
- `server/api/`: Nitro file routes (`*.get.ts`, `*.post.ts`); shared logic lives in `server/utils/`
- `shared/`: code used by both client and server (game rules, payouts, random)
- `content/changelog/`: the player-facing changelog
- `scripts/`: economy balance simulations (`bun run balance:*`)

## Client

- `useAuth()` gives `{ user, balanceNum, setBalance, fetchSession, signOut }`. `user.value.balance` is a numeric string, so use `parseFloat` (or `balanceNum`) for comparisons.
- **When the response carries the new balance, use `setBalance(data.balance)`, not `fetchSession()`.** `/api/games/play-game` always returns it, so slots and casino games never refetch the session per round: a get-session call on every spin (autoplay, turbo) floods better-auth and logs the player out. Apply it only once the round's animations and win reveal are done (the same point a refetch used to run), or the balance spoils the win. `useSlotGame` settles the pending balance itself if the game unmounts mid-spin. Reserve `fetchSession()` for actions whose response doesn't include the balance or gems.
- `formatNumber(value, compact = true)` for every coin and gem amount shown.
- Coin and gem inputs accept `10k`/`2.5m` shorthand: bind `useAmountInput(ref)` to the input and show `amountPreview(text)` as a trailing hint.
- `apiFetch` for typed API calls; `apiErrorMessage(e, fallback)` for error text.
- Colors: semantic tokens (`text-primary`, `text-muted`, `bg-elevated`, `border-default`), not raw hex or Tailwind palette colors.
- **Toasts are for errors and failures only** (`'error'` / `'warning'`). Never add success or confirmation toasts; the UI updating is the feedback.

## Server

Protected endpoints start with:
```ts
const session = await auth.api.getSession({ headers: event.headers })
if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
```

Import with `#server/…` and `#shared/…` aliases.

**Balance**: `server/utils/balance.ts` has `credit`, `debit`, `creditGems`, `debitGems`, `getBalance` and `getHistory`. Amounts are numeric strings (`'25.50'`), with an optional category (`'game:dice'`). `debit`/`debitGems` throw 400 when the user can't afford it, so don't pre-check. Each write logs a `transactions` row. **Inside a `db.transaction()` that holds a lock, pass `tx` as the last argument**, otherwise the write uses a second connection and deadlocks.

### Concurrency: never read-then-write value

Assume every endpoint that grants or spends value gets hit by a burst of parallel requests (10 parallel rakeback claims once paid out 10x). A `SELECT` check followed by an `UPDATE` is always a bug. The mutation must be the guard:

- **Claim-then-reward**: flip a flag with a conditional update and only pay if a row came back.
  ```ts
  const [claimed] = await tx.update(hackOps).set({ collected: true })
      .where(and(eq(hackOps.id, opId), eq(hackOps.userId, userId), eq(hackOps.collected, false)))
      .returning()
  if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already collected' })
  ```
  Sells work the same way: `DELETE … RETURNING`, then credit.
- **Lock-then-read**: `SELECT … FOR UPDATE` inside a transaction (see `getLockedBankState` in `server/utils/bank.ts`), read inside the lock, and pass `tx` to every write.

**Never compare-and-swap on a timestamp column.** Postgres stores microseconds but JS `Date` holds milliseconds, so the `WHERE` matches zero rows. Use lock-then-read instead. Integer and boolean CAS is fine.

Self-check: if the same request runs twice at once, the second one must throw.

### Randomness

Never use `Math.random()` for outcomes, payouts, drops or rolls. Use `#shared/utils/random` instead: `randomFloat()` [0,1), `randomInt(min, max)` inclusive, `randomPick(arr)`, `randomChance(p)`. `Math.random()` is only acceptable for cosmetic effects. Don't roll your own from `crypto.getRandomValues`.

## three.js games

Test on a standard-density monitor (Windows or Linux, dpr 1) as well as a Mac. A game that looks right on Retina can break on a 1440p screen:

- **Clamp shader inputs before `pow`, `log` or `sqrt`.** With MSAA the GPU can shade a thin quad at a pixel centre outside the triangle, which pushes varyings like UVs out of range. `pow(negative, y)` is undefined: Metal returns NaN and drops the pixel, but D3D (Windows) uses the absolute value, so the pixel blows up to white and bloom smears it (Void Runner's white lasers and beacon rings, 2026-09-21). Write `x * x`, not `pow(x, 2.0)`.
- **Never render below native resolution on dpr 1.** A pixel budget that is fine at dpr 2 (Retina hides the upscale) is visibly blurry at 1:1. Floor the pixel ratio at `min(devicePixelRatio, 1)`, and supersample standard screens (~1.5x) when the scene has thin glows. Let an adaptive scale back off when frames run long, and derive sizes from the renderer's pixel ratio, not `window.devicePixelRatio`.
- **Give thin lines and point sprites a minimum on-screen size** (about 1.5 to 2 px), and dim them by the area they gained. Sub-pixel geometry otherwise flickers into dots.

## Schema changes

Edit `schema.ts`, then run `bun run db:generate` (commit the generated `drizzle/NNNN_*.sql`) and `bun run db:migrate`. Deploys run `drizzle-kit migrate`. **Never put `db:push` in the deploy path**: it prompts on destructive diffs, a container can't answer, and it exits 0 having applied nothing (production outage, 2026-08-04). `push` is fine for throwaway local work.

## Code style

- `server/` and `shared/`: 4-space indent. Elsewhere, match the file.
- No semicolons, single quotes, no trailing commas, 1tbs braces.

## Workflow

- **Changelog**: every day of work gets a short, player-facing entry in `content/changelog/<YYYY-MM-DD>.md` for today's date (create or extend it).
  - Players skim, so keep it tiny: **one line per change**, no sub-sections for one or two changes, no tuning numbers or explanations.
  - Bad (three long lines for one change):
    ```md
    - **Portals carry into the free spins**: portals that open on the spin that triggers the free spins (including a bought feature) no longer close. They stay open for the whole feature and keep growing.
    - **Portals top out at ×256**, down from ×2,500. The top tier is now a white Celestial portal that lights up at ×256.
    - The free spins buy now costs 103× bet and free spins trigger slightly less often, which keeps the RTP where it was.
    ```
  - Good: `- **Ember Portals**: portals from the triggering spin stay open for the free spins, and portals max out at a white ×256.`
  - You may rewrite the whole day's file at any time to make it shorter: merge, trim or drop entries when it grows long.
- **Before any commit**: `bun run typecheck` and `bun run test` must both pass. `nuxt build` does not typecheck. A red `main` blocks every branch and deploy, so fix failures and call out any that are genuinely pre-existing. DB tests need the compose Postgres running.
- **Commits**: only when asked. Short imperative subject, no body or footer, no `Co-Authored-By`. Split commits by concern.
- **Branches**: `feature/…` or `bugfix/…` in kebab-case, from an up-to-date `main`.
- **PRs**: title is the branch name, empty body, base `main`.
- **Rebases**: you may `git fetch` and start a `git rebase`, then stop. Don't resolve conflicts, continue or push.
