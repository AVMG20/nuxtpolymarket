const STORAGE_KEY = 'polynux:recent-games'
const MAX_RECENT = 8

/** Games this browser opened lately, newest first. A per-device convenience
 *  for the home page, so it lives in localStorage and may come back empty. */
export function useRecentGames() {
  const recent = useState<string[]>('recent-games', () => [])
  const ready = useState('recent-games:ready', () => false)

  function read() {
    if (import.meta.server || ready.value) return
    ready.value = true
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      if (Array.isArray(raw)) recent.value = raw.filter((to): to is string => typeof to === 'string' && NAV_LINKS.has(to)).slice(0, MAX_RECENT)
    } catch {
      // Storage blocked or garbled: start fresh
    }
  }

  /** Records a visit when the path belongs to a game */
  function track(path: string) {
    read()
    const to = [...NAV_LINKS.keys()].find(route => path === route || path.startsWith(`${route}/`))
    if (!to) return
    recent.value = [to, ...recent.value.filter(r => r !== to)].slice(0, MAX_RECENT)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.value))
    } catch {
      // Not worth bothering the player about
    }
  }

  return { recent, read, track }
}
