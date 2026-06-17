export function useTooltipCursor() {
  const x = ref(0)
  const y = ref(0)

  const virtualEl = computed(() => ({
    getBoundingClientRect: () => ({
      x: x.value, y: y.value,
      width: 0, height: 0,
      top: y.value, left: x.value,
      right: x.value, bottom: y.value,
    })
  }))

  function track(e: MouseEvent) {
    x.value = e.clientX
    y.value = e.clientY
  }

  return { virtualEl, track }
}
