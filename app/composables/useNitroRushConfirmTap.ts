import { onScopeDispose, ref } from 'vue'

/** How long a button waits for its second tap. */
const CONFIRM_MS = 3000

/** A two-tap confirm for steps that can't be taken back: the first tap arms a key, a second in time confirms it. */
export function useNitroRushConfirmTap() {
    const armed = ref<string | null>(null)
    let timer: ReturnType<typeof setTimeout> | undefined

    function disarm() {
        clearTimeout(timer)
        armed.value = null
    }

    /** True on the second tap of `key`; a tap on another key starts over. */
    function tap(key: string) {
        const confirmed = armed.value === key
        disarm()
        if (confirmed) return true
        armed.value = key
        timer = setTimeout(disarm, CONFIRM_MS)
        return false
    }

    onScopeDispose(disarm)

    return { armed, tap, disarm }
}
