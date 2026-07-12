// Persisted "skip the reveal animation" toggle (PLAN.md §6.5) — separate keys
// for crates vs. recruits since a player might want the vetting cinematic but
// not the scan, or vice versa. Same SSR-safe useState + onNuxtReady hydration
// pattern as useAudio's persistedRef, but that helper is closed over a
// namespace and isn't exported standalone.
export function useHackQuickOpen(kind: 'crate' | 'recruit') {
  const key = `hack-quick-open-${kind}`
  const quickOpen = useState<boolean>(key, () => false)
  if (import.meta.client) {
    onNuxtReady(() => {
      const saved = localStorage.getItem(key)
      if (saved !== null) quickOpen.value = saved === 'true'
    })
    watch(quickOpen, v => localStorage.setItem(key, String(v)))
  }
  return quickOpen
}
