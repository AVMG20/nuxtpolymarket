export interface NavFolderDialogOptions {
  title: string
  name?: string
  confirmLabel?: string
}

let resolver: ((name: string | null) => void) | null = null

function afterFrames() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

// A menu that closes while the dialog opens can leave its modal lock behind
function releaseStuckLock() {
  setTimeout(() => {
    if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return
    if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = ''
  }, 300)
}

/** Asks the player for a folder name. Resolves null when they cancel. */
export function useNavFolderDialog() {
  const state = useState<(NavFolderDialogOptions & { open: boolean })>('nav-folder-dialog', () => ({ open: false, title: '' }))

  async function ask(options: NavFolderDialogOptions): Promise<string | null> {
    resolver?.(null)
    resolver = null
    // Opened from a context or dropdown menu: let it close and hand focus back first
    await afterFrames()
    state.value = { ...options, open: true }
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function settle(name: string | null) {
    state.value = { ...state.value, open: false }
    const done = resolver
    resolver = null
    done?.(name)
    releaseStuckLock()
  }

  return { state, ask, settle }
}
