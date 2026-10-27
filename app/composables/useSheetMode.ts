// Spreadsheet mode (/sheet) disguises Polynux as a Google Sheet. The boss key
// flips between it and wherever the player was.

/** Matched by physical key, so it also works where ` is a dead key (US-International) */
export function isSheetModeKey(e: KeyboardEvent): boolean {
  if (e.code !== 'Backquote' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
  const target = e.target as HTMLElement | null
  return !(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
}

export function useSheetMode() {
  const returnTo = useState('sheet-return', () => '/')
  const route = useRoute()

  function enter() {
    if (route.path === '/sheet') return
    returnTo.value = route.fullPath
    return navigateTo('/sheet')
  }

  function exit() {
    return navigateTo(returnTo.value === '/sheet' ? '/' : returnTo.value)
  }

  return { enter, exit }
}
