/** Shared, SSR-safe opt-in. Keep this independent of the user's color palette. */
export function useSoftStudio() {
  const preference = useCookie('theme-soft-studio', {
    default: () => false,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/'
  })
  const enabled = useState('theme-soft-studio', () => preference.value === true)

  watch(enabled, (value) => {
    preference.value = value
  }, { flush: 'sync' })

  return enabled
}
