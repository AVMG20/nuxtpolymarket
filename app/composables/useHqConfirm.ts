/**
 * A press that has to be made twice: the first arms it, a second on the same thing within
 * `windowMs` confirms. For spending a currency that is hard to earn back (Gold on Seals, Void
 * Shards), where a stray press should cost nothing. Pressing something else, or waiting it out,
 * disarms.
 */
export function useHqConfirm(windowMs = 3000) {
    const armed = ref<string | null>(null)
    let timer: ReturnType<typeof setTimeout> | null = null

    function set(key: string | null) {
        if (timer) clearTimeout(timer)
        timer = key ? setTimeout(() => { armed.value = null }, windowMs) : null
        armed.value = key
    }

    /** Whether this press goes through: true on the confirming press, false on the arming one. */
    function press(key: string): boolean {
        if (armed.value === key) {
            set(null)
            return true
        }
        set(key)
        return false
    }

    onUnmounted(() => { if (timer) clearTimeout(timer) })

    return { armed: readonly(armed), press, clear: () => set(null) }
}
