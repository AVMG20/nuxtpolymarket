import {defu} from 'defu'
import {createAuthClient} from 'better-auth/client'
import type {RouteLocationRaw} from 'vue-router'
import {inferAdditionalFields} from "better-auth/client/plugins";
import type {auth} from "#server/utils/auth";

interface RuntimeAuthConfig {
  redirectUserTo: RouteLocationRaw | string
  redirectGuestTo: RouteLocationRaw | string
}

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders() : undefined

  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers,
    },
    plugins: [inferAdditionalFields<typeof auth>()]
  });

  type User = typeof client.$Infer.Session.user
  type Session = typeof client.$Infer.Session.session

  const options = defu(useRuntimeConfig().public.auth as Partial<RuntimeAuthConfig>, {
    redirectUserTo: '/',
    redirectGuestTo: '/',
  })

  const session = useState<Session | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)

  const fetchSession = async () => {
    if (sessionFetching.value) {
      console.log('already fetching session')
      return
    }
    sessionFetching.value = true
    const {data} = await client.getSession({
      fetchOptions: {
        headers,
      },
    })
    session.value = data?.session || null
    user.value = data?.user || null
    sessionFetching.value = false
    return data
  }

  if (import.meta.client) {
    client.$store.listen('$sessionSignal', async (signal) => {
      if (!signal) return
      await fetchSession()
    })
  }

  const setBalance = async (balance: number | string) => {
    if (user.value) {
      user.value.balance = balance.toString()
    }
  }

  return {
    session,
    user,
    setBalance,
    balanceNum: computed(() => parseFloat(user.value?.balance ?? '0')),
    loggedIn: computed(() => !!session.value),
    signIn: client.signIn,
    signUp: client.signUp,
    async signOut({redirectTo}: { redirectTo?: RouteLocationRaw } = {}) {
      const res = await client.signOut()
      session.value = null
      user.value = null
      if (redirectTo) {
        await navigateTo(redirectTo)
      }
      return res
    },
    options,
    fetchSession,
    client,
  }
}
