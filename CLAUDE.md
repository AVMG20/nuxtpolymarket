# Polynux — Claude context

## Stack

- **Framework**: Nuxt 4 with Vue 3
- **UI**: Nuxt UI (v3) — use its components and design tokens wherever possible
- **ORM**: Drizzle ORM with PostgreSQL
- **Auth**: better-auth — session is retrieved server-side via `auth.api.getSession({ headers: event.headers })`
- **Package manager**: pnpm

## Colors

Always use Nuxt UI semantic color tokens instead of arbitrary hex or raw Tailwind palette values when possible. Prefer:
- `text-primary`, `bg-primary`, `border-primary`, etc. for the theme accent
- `text-muted`, `bg-elevated`, `bg-background`, `border-default` for surfaces and subtle text
- Named palette colors (`text-yellow-400`, `text-cyan-400`, …) only when the color has a fixed semantic meaning (e.g. coins = yellow, gems = cyan) and a dynamic theme token doesn't make sense

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

Import from `~/server/utils/balance`. All functions run inside a Drizzle transaction and record a corresponding row in the `transactions` table.

```ts
import { credit, debit, getBalance, getHistory } from '~/server/utils/balance'

// Add money to a user
await credit(userId, '100.00', 'category?')   // amount is a numeric string

// Remove money from a user
await debit(userId, '25.50', 'category?')     // amount is a numeric string

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
- Import `db` from `~/server/database` and schema tables from `~/server/database/schema`
