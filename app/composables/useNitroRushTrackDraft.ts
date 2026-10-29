import type { Ref } from 'vue'
import { compileCustomTrack, loopGap, MAX_NAME_LENGTH, MAX_SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'

const MAX_UNDO = 100

/**
 * The course open in the track builder: its sections, the cursor new ones go
 * in after, and undo. Every edit replaces the draft, so the walk and the
 * compile below rerun once per change.
 */
export function useNitroRushTrackDraft(initial: Ref<CustomTrack>) {
    const draft = ref<CustomTrack>(initial.value)
    /** The section new ones go in after; -1 puts them first. */
    const cursor = ref(initial.value.sections.length - 1)
    const history: { track: CustomTrack, cursor: number }[] = []
    const canUndo = ref(false)

    watch(initial, (t) => {
        draft.value = t
        cursor.value = t.sections.length - 1
        history.length = 0
        canUndo.value = false
    })

    const walk = computed(() => walkCustomTrack(draft.value))
    const compiled = computed(() => compileCustomTrack(draft.value))
    const gap = computed(() => draft.value.closed ? loopGap(walk.value) : null)
    const full = computed(() => draft.value.sections.length >= MAX_SECTIONS)
    /** Metres of road laid so far. */
    const length = computed(() => {
        const pts = walk.value.pts
        let m = 0
        for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
        return m
    })

    function edit(next: Partial<CustomTrack>, nextCursor = cursor.value) {
        history.push({ track: draft.value, cursor: cursor.value })
        if (history.length > MAX_UNDO) history.shift()
        canUndo.value = true
        draft.value = { ...draft.value, ...next }
        cursor.value = Math.min(nextCursor, draft.value.sections.length - 1)
    }

    function insert(id: SectionId) {
        if (full.value) return
        const sections = [...draft.value.sections]
        sections.splice(cursor.value + 1, 0, id)
        edit({ sections }, cursor.value + 1)
    }

    function removeAt(i: number) {
        if (i < 0 || i >= draft.value.sections.length) return
        edit({ sections: draft.value.sections.filter((_, k) => k !== i) }, i - 1)
    }

    /** Swaps a section with its neighbour, `by` -1 (earlier) or 1 (later). */
    function move(i: number, by: -1 | 1) {
        const j = i + by
        const sections = [...draft.value.sections]
        if (j < 0 || j >= sections.length) return
        ;[sections[i], sections[j]] = [sections[j]!, sections[i]!]
        edit({ sections }, j)
    }

    function setClosed(closed: boolean) {
        if (closed !== draft.value.closed) edit({ closed })
    }

    function setName(name: string) {
        draft.value = { ...draft.value, name: name.slice(0, MAX_NAME_LENGTH) }
    }

    function select(i: number) {
        cursor.value = Math.max(-1, Math.min(i, draft.value.sections.length - 1))
    }

    function undo() {
        const prev = history.pop()
        if (!prev) return
        draft.value = prev.track
        cursor.value = prev.cursor
        canUndo.value = history.length > 0
    }

    return { draft, cursor, walk, compiled, gap, full, length, canUndo, insert, removeAt, move, setClosed, setName, select, undo }
}
