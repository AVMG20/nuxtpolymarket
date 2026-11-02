import { PAINT_BUDGET_MS, PAINT_REST_MS, SectionThumbPainter } from '~/utils/nitro-rush/section-thumbs'
import { SECTIONS, type SectionId } from '#shared/utils/nitro-rush/custom'

const IDS = Object.keys(SECTIONS) as SectionId[]
/** Kept for the session: sections never change, so opening the builder again repaints nothing. */
const thumbs = shallowReactive<Partial<Record<SectionId, string>>>({})

/** Each section's picture as it comes in, those on show first; a card keeps its icon until then, or if painting fails. */
export function useNitroRushSectionThumbs(onShow: () => readonly SectionId[]) {
    let painter: SectionThumbPainter | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    function stop() {
        clearTimeout(timer)
        painter?.dispose()
        painter = null
    }

    const missing = (id: SectionId) => !thumbs[id]

    function paintSome() {
        try {
            const until = performance.now() + PAINT_BUDGET_MS
            while (performance.now() < until) {
                const id = onShow().find(missing) ?? IDS.find(missing)
                if (!id) return stop()
                painter ??= new SectionThumbPainter()
                const url = painter.paint(id)
                if (!url) return stop()
                thumbs[id] = url
            }
        } catch (e) {
            console.error(e)
            return stop()
        }
        timer = setTimeout(paintSome, PAINT_REST_MS)
    }

    onMounted(() => {
        timer = setTimeout(paintSome)
    })
    onBeforeUnmount(stop)

    return thumbs
}
