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
