/** Marks a scroll container with `is-scrolling` while it scrolls and for
 *  `idleMs` after, so an overlay scrollbar can fade in and out (main.css). */
export function useScrollActivity(target: Ref<HTMLElement | null | undefined>, idleMs = 1000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let el: HTMLElement | null = null

  function onScroll() {
    if (!el) return
    el.classList.add('is-scrolling')
    clearTimeout(timer)
    timer = setTimeout(() => el?.classList.remove('is-scrolling'), idleMs)
  }

  function detach() {
    clearTimeout(timer)
    el?.removeEventListener('scroll', onScroll)
    el?.classList.remove('is-scrolling')
    el = null
  }

  watch(target, (next) => {
    detach()
    if (!next) return
    el = next
    el.addEventListener('scroll', onScroll, { passive: true })
  }, { immediate: true, flush: 'post' })

  onBeforeUnmount(detach)
}
