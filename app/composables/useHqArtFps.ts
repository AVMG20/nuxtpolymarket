import { ANIM_FPS, setAnimFps } from '~/utils/hero-quest-art/anim'
import { resetArt } from '~/utils/hero-quest-art/catalog'

/** The rates the art gallery can resample every animation at, to compare against the default 30. */
export const HQ_ART_FPS_OPTIONS: readonly number[] = [10, 15, 20, 30, 60]

/**
 * The art gallery's animation rate, shared by the live stage and the thumbnails. Setting it
 * resamples every animation and rebuilds the assets, so both show the new rate. Dev only.
 */
export function useHqArtFps() {
    const state = useState<number>('hq-art-fps', () => ANIM_FPS)
    // after a hot reload the module is back at its default while the state kept the choice
    if (import.meta.client && state.value !== ANIM_FPS) { setAnimFps(state.value); resetArt() }
    return computed({
        get: () => state.value,
        set: (fps: number) => {
            if (fps === state.value) return
            setAnimFps(fps)
            resetArt()
            state.value = fps
        }
    })
}
