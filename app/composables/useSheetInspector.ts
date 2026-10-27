// Read-only game tabs for spreadsheet mode: each one loads a game's state
// endpoint when opened and lays it out with jsonToCells.

export interface SheetSource<T = unknown> {
  data: Ref<T | null>
  error: Ref<string>
  loading: Ref<boolean>
  loadedAt: Ref<Date | null>
  load: (force?: boolean) => Promise<void>
}

const STALE_MS = 30_000

/** A lazily fetched GET endpoint, refetched when the tab is reopened after a while */
export function useSheetSource<T = unknown>(url: string): SheetSource<T> {
  const data = ref(null) as Ref<T | null>
  const error = ref('')
  const loading = ref(false)
  const loadedAt = ref<Date | null>(null)

  async function load(force = false) {
    if (loading.value) return
    if (!force && loadedAt.value && Date.now() - loadedAt.value.getTime() < STALE_MS) return
    loading.value = true
    try {
      data.value = await apiFetch<T>(url)
      error.value = ''
      loadedAt.value = new Date()
    } catch (e) {
      error.value = apiErrorMessage(e, 'Could not load data')
    } finally {
      loading.value = false
    }
  }

  return { data, error, loading, loadedAt, load }
}

/** Title, last-updated time and a Refresh checkbox in A1:B3 */
export function sourceHeader(title: string, source: SheetSource): SheetCells {
  return {
    A1: { v: title, bold: true, size: 15 },
    A2: { v: 'Last updated' },
    B2: source.error.value
      ? { error: source.error.value }
      : source.loadedAt.value ? { v: formatTimestamp(source.loadedAt.value), color: '#5f6368' } : { loading: true },
    A3: { v: 'Refresh' },
    B3: { type: 'checkbox', v: source.loading.value, toggle: () => source.load(true) }
  }
}

export interface InspectorDef { id: string, name: string, url: string }

export function useSheetInspector(def: InspectorDef) {
  const source = useSheetSource(def.url)
  return computed<SheetTab>(() => {
    const { cells } = source.data.value === null ? { cells: {} } : jsonToCells(source.data.value, 4)
    return {
      id: def.id,
      name: def.name,
      widths: { 0: 220, 1: 140 },
      cells: { ...cells, ...sourceHeader(def.name, source) },
      activate: () => source.load()
    }
  })
}
