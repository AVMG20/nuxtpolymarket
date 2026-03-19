import { createAuthClient } from 'better-auth/vue'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { auth } from '#server/utils/auth'

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()]
})
