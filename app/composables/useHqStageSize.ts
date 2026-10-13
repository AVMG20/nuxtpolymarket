import { HQ_STAGE_SIZE_DEFAULT, isHqStageSize, type HqStageSize } from '~/utils/hero-quest-art/stage-size'

const STORAGE_KEY = 'hq-stage-size'

// module-level, not `useState`: a server-rendered default would ride the payload over the stored choice
const size = ref<HqStageSize>(HQ_STAGE_SIZE_DEFAULT)
let loaded = false

/**
 * The stage size the player picked in Settings, shared by every stage canvas. Kept in this
 * browser rather than with the other settings, since the right size is the screen's, not the account's.
 */
export function useHqStageSize() {
    if (import.meta.client && !loaded) {
        loaded = true
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (isHqStageSize(stored)) size.value = stored
        } catch {
            // storage blocked: the default holds
        }
    }

    function setSize(next: HqStageSize) {
        size.value = next
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            // storage blocked: the choice holds for this visit
        }
    }

    return { size: readonly(size), setSize }
}
