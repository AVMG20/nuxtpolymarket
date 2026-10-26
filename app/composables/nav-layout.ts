import { NAV_CATALOG, type NavLink, type NavSection } from '#shared/utils/nav-catalog'
import {
  NAV_LAYOUT_MAX_FOLDERS,
  NAV_ROOT,
  createNavFolder,
  defaultNavLayout,
  deleteNavFolder,
  isNavFolderId,
  locateNavEntry,
  moveNavEntry,
  navFolder,
  newNavFolderId,
  removeNavLink,
  renameNavFolder,
  sectionFolderId,
  setNavFolderCollapsed,
  type NavLayout,
  type NavListId
} from '#shared/utils/nav-layout'
import { NavLayoutConflict, NavLayoutSync, type NavLayoutOp, type NavLayoutSnapshot } from '~/utils/nav-layout-sync'

const ENDPOINT = '/api/user/nav-layout'
const CHANNEL = 'polynux:nav-layout'

export interface NavCatalogLink extends NavLink {
  section: NavSection
}

export type NavTreeNode =
  | { kind: 'link', key: string, link: NavCatalogLink }
  | { kind: 'folder', key: string, id: string, name: string, collapsed: boolean, links: NavCatalogLink[] }

/** The sections of games the player picks from */
export const NAV_GAME_SECTIONS = NAV_CATALOG.filter(section => !section.fixed)

/** Every link the player can place, by route */
export const NAV_LINKS = new Map<string, NavCatalogLink>(
  NAV_GAME_SECTIONS.flatMap(section => section.items.map(item => [item.to, { ...item, section }] as const))
)

interface NavLayoutState extends NavLayoutSnapshot {
  /** The account this layout belongs to */
  userId: string | null
  loaded: boolean
}

// One sync per signed-in account, client only (module state on the server
// would be shared between requests)
let sync: NavLayoutSync | null = null
let syncUserId: string | null = null
let channel: BroadcastChannel | null = null
let hooked = false

const transport = {
  load: () => $fetch<NavLayoutSnapshot>(ENDPOINT),
  async save(layout: NavLayout, revision: number) {
    try {
      // keepalive lets a save started as the page closes still land
      return await $fetch<NavLayoutSnapshot>(ENDPOINT, { method: 'PUT', body: { layout, revision }, keepalive: true })
    } catch (e) {
      const err = e as { statusCode?: number, data?: { data?: NavLayoutSnapshot } }
      if (err.statusCode === 409 && err.data?.data) throw new NavLayoutConflict(err.data.data)
      throw e
    }
  },
  reset: () => $fetch<NavLayoutSnapshot>(ENDPOINT, { method: 'DELETE' })
}

function hookPage() {
  if (hooked) return
  hooked = true
  // Send pending edits when the page hides or closes; mobile browsers often skip pagehide
  window.addEventListener('pagehide', () => sync?.flushNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sync?.flushNow()
    else void sync?.refresh()
  })
  window.addEventListener('focus', () => void sync?.refresh())
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<{ userId?: string, revision?: number }>) => {
      if (event.data?.userId === syncUserId && (event.data.revision ?? 0) > (sync?.revision ?? 0)) void sync?.refresh()
    }
  }
}

/** The player's sidebar: fixed platform links plus the games and folders
 *  they chose. Every edit shows at once and saves to the account shortly after. */
export function useNavLayout() {
  const { user } = useAuth()
  // layout null = the default layout, which follows the catalog
  const state = useState<NavLayoutState>('nav-layout', () => ({ userId: null, layout: null, revision: 0, loaded: false }))
  const toast = useToast()

  const userId = computed(() => user.value?.id ?? null)
  const layout = computed<NavLayout>(() =>
    (state.value.userId === userId.value ? state.value.layout : null) ?? defaultNavLayout(NAV_CATALOG)
  )

  const fixedSections = computed(() =>
    NAV_CATALOG.filter(section => section.fixed && (!section.adminOnly || user.value?.isPokemonAdmin))
  )

  const tree = computed<NavTreeNode[]>(() => {
    const nodes: NavTreeNode[] = []
    for (const key of layout.value.root) {
      const folder = navFolder(layout.value, key)
      if (folder) {
        nodes.push({
          kind: 'folder',
          key,
          id: key,
          name: folder.name,
          collapsed: folder.collapsed,
          links: folder.items.map(to => NAV_LINKS.get(to)).filter(link => !!link)
        })
        continue
      }
      const link = NAV_LINKS.get(key)
      if (link) nodes.push({ kind: 'link', key, link })
    }
    return nodes
  })

  const folders = computed(() => tree.value.flatMap(node => node.kind === 'folder' ? [{ id: node.id, name: node.name }] : []))
  const canAddFolder = computed(() => folders.value.length < NAV_LAYOUT_MAX_FOLDERS)

  /** The sync for the signed-in account; a new account gets a fresh one */
  function current(): NavLayoutSync | null {
    if (import.meta.server) return null
    const id = userId.value
    if (sync && syncUserId === id) return sync
    sync?.dispose()
    sync = null
    syncUserId = id
    if (!id) return null
    if (state.value.userId !== id) state.value = { userId: id, layout: null, revision: 0, loaded: false }
    const seed = state.value.loaded ? { layout: state.value.layout, revision: state.value.revision } : null
    sync = new NavLayoutSync({
      transport,
      fallback: () => defaultNavLayout(NAV_CATALOG),
      onChange: (next) => {
        state.value = { userId: id, ...next }
      },
      onError: (e, action) => {
        toast.add({
          title: apiErrorMessage(e, action === 'save' ? 'Could not save your sidebar, retrying' : 'Could not reset your sidebar'),
          color: 'error'
        })
      },
      onSaved: revision => channel?.postMessage({ userId: id, revision })
    }, seed)
    hookPage()
    return sync
  }

  /** Server render: fetch the stored layout. A failure leaves it unloaded for the client to retry. */
  async function load() {
    const id = userId.value
    if (!id) return
    if (import.meta.client) {
      const s = current()
      if (s && !s.loaded) void s.load()
      return
    }
    if (state.value.loaded && state.value.userId === id) return
    try {
      const data = await apiFetch<NavLayoutSnapshot>(ENDPOINT)
      state.value = { userId: id, layout: data.layout, revision: data.revision, loaded: true }
    } catch {
      state.value = { userId: id, layout: null, revision: 0, loaded: false }
    }
  }

  /** Client start: picks up the server-rendered layout, or loads it */
  function init() {
    const s = current()
    if (s && !s.loaded) void s.load()
  }

  /** Sends pending edits now, e.g. before signing out */
  async function flush() {
    await sync?.flush()
  }

  function update(op: NavLayoutOp) {
    current()?.apply(op)
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  function locate(key: string) {
    return locateNavEntry(layout.value, key)
  }

  function isPinned(to: string) {
    return locate(to) !== null
  }

  function folderName(id: NavListId) {
    return id === NAV_ROOT ? 'Top level' : navFolder(layout.value, id)?.name ?? ''
  }

  // ── Edits ─────────────────────────────────────────────────────────────────
  // Each edit is absolute ("put X here", "fold Y"), so replaying it on a
  // newer server layout after a conflict can't flip it back.

  /** Adds a game: to its category's folder when the player still has it, else the top level */
  function pin(to: string, list?: NavListId, index?: number) {
    if (!NAV_LINKS.has(to)) return
    if (!list) {
      const section = NAV_LINKS.get(to)?.section
      const home = section ? sectionFolderId(section.id) : ''
      list = navFolder(layout.value, home) ? home : NAV_ROOT
    }
    const target = list
    update(l => moveNavEntry(l, to, target, index))
  }

  function unpin(to: string) {
    update(l => removeNavLink(l, to))
  }

  function togglePin(to: string) {
    if (isPinned(to)) unpin(to)
    else pin(to)
  }

  function move(key: string, list: NavListId, index?: number) {
    if (!isNavFolderId(key) && !NAV_LINKS.has(key)) return
    update(l => moveNavEntry(l, key, list, index))
  }

  function shift(key: string, delta: -1 | 1) {
    const at = locate(key)
    if (!at) return
    const size = at.list === NAV_ROOT ? layout.value.root.length : navFolder(layout.value, at.list)?.items.length ?? 0
    const index = at.index + delta
    if (index < 0 || index >= size) return
    update(l => moveNavEntry(l, key, at.list, index))
  }

  /** Creates a folder holding `items`, next to where the first of them sits. Returns its id. */
  function createFolder(name: string, items: string[] = []) {
    if (!canAddFolder.value) {
      toast.add({ title: `You can have up to ${NAV_LAYOUT_MAX_FOLDERS} folders`, color: 'warning' })
      return null
    }
    const at = items[0] ? locate(items[0]) : null
    let index: number | undefined
    if (at?.list === NAV_ROOT) index = at.index
    else if (at) index = layout.value.root.indexOf(at.list) + 1
    const id = newNavFolderId(layout.value)
    update(l => createNavFolder(l, id, name, items, index))
    return id
  }

  /** Adds a catalog section as a folder of all its games, or brings them all back into it */
  function pinSection(section: NavSection) {
    const id = sectionFolderId(section.id)
    const items = section.items.map(item => item.to)
    if (!navFolder(layout.value, id) && !canAddFolder.value) {
      toast.add({ title: `You can have up to ${NAV_LAYOUT_MAX_FOLDERS} folders`, color: 'warning' })
      return
    }
    update((l) => {
      if (!navFolder(l, id)) return createNavFolder(l, id, section.label, items)
      return items.reduce((next, to) => moveNavEntry(next, to, id), l)
    })
  }

  /** Takes a section's games out of its folder; the folder goes too once empty.
   *  Games from other sections the player filed there stay. */
  function unpinSection(section: NavSection) {
    const id = sectionFolderId(section.id)
    update((l) => {
      const folder = navFolder(l, id)
      if (!folder) return l
      const next = section.items.reduce((acc, item) => folder.items.includes(item.to) ? removeNavLink(acc, item.to) : acc, l)
      return navFolder(next, id)?.items.length ? next : deleteNavFolder(next, id, false)
    })
  }

  function renameFolder(id: string, name: string) {
    update(l => renameNavFolder(l, id, name))
  }

  function setFolderCollapsed(id: string, collapsed: boolean) {
    update(l => setNavFolderCollapsed(l, id, collapsed))
  }

  function toggleFolder(id: string) {
    const folder = navFolder(layout.value, id)
    if (folder) setFolderCollapsed(id, !folder.collapsed)
  }

  function deleteFolder(id: string, keepItems: boolean) {
    update(l => deleteNavFolder(l, id, keepItems))
  }

  function togglePlatform() {
    const collapsed = !layout.value.platformCollapsed
    update(l => l.platformCollapsed === collapsed ? l : { ...l, platformCollapsed: collapsed })
  }

  async function reset() {
    await current()?.reset()
  }

  return {
    layout,
    tree,
    folders,
    fixedSections,
    canAddFolder,
    load,
    init,
    flush,
    locate,
    isPinned,
    folderName,
    pin,
    unpin,
    togglePin,
    move,
    shift,
    createFolder,
    pinSection,
    unpinSection,
    renameFolder,
    setFolderCollapsed,
    toggleFolder,
    deleteFolder,
    togglePlatform,
    reset
  }
}
