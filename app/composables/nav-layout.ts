import { applyNavLayout, navLayoutOf, type NavLayout } from '#shared/utils/nav-layout'

const SAVE_DELAY_MS = 500

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** The sidebar's arrangement, loaded once per request and saved to the
 *  account on every reorder or fold. */
export function useNavLayout() {
  const { user } = useAuth()
  const layout = useState<NavLayout | null>('nav-layout', () => null)
  const loaded = useState('nav-layout:loaded', () => false)
  const editing = useState('nav-layout:editing', () => false)
  const toast = useToast()

  async function load() {
    if (loaded.value || !user.value) return
    try {
      const data = await apiFetch<{ layout: NavLayout | null }>('/api/user/nav-layout')
      layout.value = data.layout
    } catch {
      // The default order is a fine fallback
    }
    loaded.value = true
  }

  const sections = computed(() => {
    const visible = NAV_CATALOG.filter(section => !section.adminOnly || user.value?.isPokemonAdmin)
    return applyNavLayout(visible, layout.value)
  })

  const collapsed = computed(() => new Set(layout.value?.collapsed ?? []))

  function persist() {
    if (!user.value || !layout.value) return
    clearTimeout(saveTimer)
    const snapshot = layout.value
    saveTimer = setTimeout(async () => {
      try {
        await apiFetch('/api/user/nav-layout', { method: 'PUT', body: { layout: snapshot } })
      } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not save your sidebar'), color: 'error' })
      }
    }, SAVE_DELAY_MS)
  }

  function commit(next: NavSection[], folded: string[] = [...collapsed.value]) {
    layout.value = navLayoutOf(next, folded)
    persist()
  }

  function toggleSection(id: string) {
    const folded = new Set(collapsed.value)
    if (folded.has(id)) folded.delete(id)
    else folded.add(id)
    commit(sections.value, [...folded])
  }

  async function reset() {
    clearTimeout(saveTimer)
    layout.value = null
    if (!user.value) return
    try {
      await apiFetch('/api/user/nav-layout', { method: 'DELETE' })
    } catch (e) {
      toast.add({ title: apiErrorMessage(e, 'Could not reset your sidebar'), color: 'error' })
    }
  }

  return { sections, collapsed, editing, load, commit, toggleSection, reset }
}
