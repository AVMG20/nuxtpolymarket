import { NAV_FOLDER_NAME_MAX, NAV_ROOT, type NavListId } from '#shared/utils/nav-layout'

/** The shape both UContextMenu and UDropdownMenu accept */
export interface NavMenuItem {
  label?: string
  icon?: string
  color?: 'error'
  type?: 'separator' | 'label'
  disabled?: boolean
  to?: string
  kbds?: string[]
  children?: NavMenuItem[] | NavMenuItem[][]
  onSelect?: (e: Event) => void
}

/** Right-click and "…" menus for sidebar links, folders and home page cards. */
export function useNavMenus() {
  const nav = useNavLayout()
  const dialog = useNavFolderDialog()

  async function newFolder(items: string[] = []) {
    const name = await dialog.ask({ title: 'New folder', confirmLabel: 'Create' })
    if (name !== null) nav.createFolder(name, items)
  }

  async function renameFolder(id: string, current: string) {
    const name = await dialog.ask({ title: 'Rename folder', name: current, confirmLabel: 'Rename' })
    if (name !== null) nav.renameFolder(id, name)
  }

  /** "Top level", every folder and "New folder…" as move targets for a link */
  function destinations(to: string): NavMenuItem[][] {
    const here = nav.locate(to)?.list
    const targets: NavMenuItem[] = [
      { label: 'Top level', icon: 'i-lucide-list', disabled: here === NAV_ROOT, onSelect: () => nav.move(to, NAV_ROOT) },
      ...nav.folders.value.map(folder => ({
        label: folder.name,
        icon: 'i-lucide-folder',
        disabled: here === folder.id,
        onSelect: () => nav.move(to, folder.id)
      }))
    ]
    return [targets, [{ label: 'New folder…', icon: 'i-lucide-folder-plus', disabled: !nav.canAddFolder.value, onSelect: () => newFolder([to]) }]]
  }

  function positionItems(key: string): NavMenuItem[] {
    const at = nav.locate(key)
    const size = at ? (at.list === NAV_ROOT ? nav.layout.value.root.length : nav.layout.value.folders[at.list]?.items.length ?? 0) : 0
    return [
      { label: 'Move up', icon: 'i-lucide-arrow-up', kbds: ['alt', 'arrowup'], disabled: !at || at.index === 0, onSelect: () => nav.shift(key, -1) },
      { label: 'Move down', icon: 'i-lucide-arrow-down', kbds: ['alt', 'arrowdown'], disabled: !at || at.index >= size - 1, onSelect: () => nav.shift(key, 1) }
    ]
  }

  /** A game in the sidebar */
  function linkMenu(to: string): NavMenuItem[][] {
    return [
      positionItems(to),
      [{ label: 'Move to', icon: 'i-lucide-folder-input', children: destinations(to) }],
      [{ label: 'Remove from sidebar', icon: 'i-lucide-star-off', color: 'error', onSelect: () => nav.unpin(to) }]
    ]
  }

  /** A folder header in the sidebar */
  function folderMenu(id: string): NavMenuItem[][] {
    const folder = nav.layout.value.folders[id]
    if (!folder) return []
    return [
      [
        { label: 'Rename…', icon: 'i-lucide-pencil', onSelect: () => renameFolder(id, folder.name) },
        {
          label: folder.collapsed ? 'Expand' : 'Collapse',
          icon: folder.collapsed ? 'i-lucide-chevrons-up-down' : 'i-lucide-chevrons-down-up',
          onSelect: () => nav.toggleFolder(id)
        }
      ],
      positionItems(id),
      [{ label: 'New folder…', icon: 'i-lucide-folder-plus', disabled: !nav.canAddFolder.value, onSelect: () => newFolder() }],
      [
        { label: 'Ungroup', icon: 'i-lucide-folder-open', disabled: !folder.items.length, onSelect: () => nav.deleteFolder(id, true) },
        { label: 'Delete folder and its games', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => nav.deleteFolder(id, false) }
      ]
    ]
  }

  /** A game card on the home page */
  function cardMenu(to: string): NavMenuItem[][] {
    const open: NavMenuItem[] = [{ label: 'Play', icon: 'i-lucide-play', to }]
    if (nav.isPinned(to)) {
      const where = nav.locate(to)!
      return [
        open,
        [{ label: `In ${nav.folderName(where.list as NavListId) || 'sidebar'}`, type: 'label' }],
        [{ label: 'Move to', icon: 'i-lucide-folder-input', children: destinations(to) }],
        [{ label: 'Remove from sidebar', icon: 'i-lucide-star-off', color: 'error', onSelect: () => nav.unpin(to) }]
      ]
    }
    return [
      open,
      [
        { label: 'Add to sidebar', icon: 'i-lucide-star', onSelect: () => nav.pin(to) },
        {
          label: 'Add to folder',
          icon: 'i-lucide-folder-input',
          children: [
            [
              { label: 'Top level', icon: 'i-lucide-list', onSelect: () => nav.pin(to, NAV_ROOT) },
              ...nav.folders.value.map(folder => ({ label: folder.name, icon: 'i-lucide-folder', onSelect: () => nav.pin(to, folder.id) }))
            ],
            [{ label: 'New folder…', icon: 'i-lucide-folder-plus', disabled: !nav.canAddFolder.value, onSelect: () => newFolder([to]) }]
          ]
        }
      ]
    ]
  }

  return { linkMenu, folderMenu, cardMenu, newFolder, renameFolder, maxNameLength: NAV_FOLDER_NAME_MAX }
}
