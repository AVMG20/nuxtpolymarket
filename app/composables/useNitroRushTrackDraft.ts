import { computed, ref, watch, type Ref } from 'vue'
import { finishJoin, finishLoop } from '#shared/utils/nitro-rush/finish-loop'
import { compileCustomTrack, forkShape, lineSections, loopGap, MAX_BRANCHES, MAX_NAME_LENGTH, MAX_SECTIONS, sectionCount, type CustomTrack, type SectionId, type SectionSpot } from '#shared/utils/nitro-rush/custom'
import { branchEnding, canJoin, insertSection, joinCandidates, moveSection, removeBranch, removeSection, setJoin, walkForks, withLineSections } from '#shared/utils/nitro-rush/custom-forks'

const MAX_UNDO = 100

/**
 * The course open in the track builder: its lines, the line being built on, the cursor and undo.
 * Every edit replaces the draft, so the walks and the compile below rerun once per change.
 */
export function useNitroRushTrackDraft(initial: Ref<CustomTrack>) {
    const draft = ref<CustomTrack>(initial.value)
    /** The line being built on: 0 is the main road. */
    const line = ref(0)
    /** The section on that line new ones go in after; -1 puts them first. */
    const cursor = ref(initial.value.sections.length - 1)
    const history: { track: CustomTrack, line: number, cursor: number }[] = []
    const canUndo = ref(false)
    /** Why the last try at finishing the loop or a branch came to nothing; it stands until the road changes. */
    const finishError = ref<string | null>(null)

    watch(initial, (t) => {
        draft.value = t
        line.value = 0
        cursor.value = t.sections.length - 1
        history.length = 0
        canUndo.value = false
        finishError.value = null
    })

    // Read through these, a rename leaves the walks, and the map and preview drawn from them, alone.
    const sections = computed(() => draft.value.sections)
    const branches = computed(() => draft.value.branches)
    const closed = computed(() => draft.value.closed)
    const road = computed(() => ({ ...initial.value, sections: sections.value, branches: branches.value, closed: closed.value }))
    const forks = computed(() => walkForks(road.value))
    const lines = computed(() => forks.value.walks)
    const walk = computed(() => lines.value[line.value]!)
    /** The line being built on closes on itself: only a loop's main road does. */
    const lineClosed = computed(() => closed.value && line.value === 0)
    const lineSectionIds = computed(() => lineSections(draft.value, line.value))
    const compiled = computed(() => compileCustomTrack(draft.value))
    const gap = computed(() => closed.value ? loopGap(lines.value[0]!) : null)
    const endings = computed(() => (branches.value ?? []).map((_, i) => branchEnding(road.value, forks.value, i + 1)))
    const full = computed(() => sectionCount(draft.value) >= MAX_SECTIONS)
    const canFork = computed(() => (branches.value?.length ?? 0) < MAX_BRANCHES)
    /** Per join, whether the branch being built on may head into it. */
    const joinable = computed(() => forks.value.joins.map(j => line.value > 0 && canJoin(road.value, line.value, j.spot)))
    /** Metres of road laid so far, over every line. */
    const length = computed(() => lines.value.reduce((m, w) => {
        for (let i = 1; i < w.pts.length; i++) m += Math.hypot(w.pts[i]![0] - w.pts[i - 1]![0], w.pts[i]![1] - w.pts[i - 1]![1])
        return m
    }, 0))

    /** The line's walk up to the cursor with `id` laid on the end, as if it went in there. */
    function walkUpTo(id: SectionId) {
        const cut = [...lineSectionIds.value.slice(0, cursor.value + 1), id]
        return walkForks(withLineSections(road.value, line.value, cut)).walks[line.value]!
    }

    function edit(next: CustomTrack, nextLine = line.value, nextCursor = cursor.value) {
        history.push({ track: draft.value, line: line.value, cursor: cursor.value })
        if (history.length > MAX_UNDO) history.shift()
        canUndo.value = true
        finishError.value = null
        draft.value = next
        line.value = nextLine
        cursor.value = Math.min(nextCursor, lineSections(next, nextLine).length - 1)
    }

    /** Lays `id` after the cursor; a new join takes the open branch whose end is nearest its inlet. */
    function insert(id: SectionId) {
        if (full.value || (forkShape(id, 'split') && !canFork.value)) return
        const at = { branch: line.value, at: cursor.value + 1 }
        let next = insertSection(draft.value, line.value, at.at, id)
        if (forkShape(id, 'join')) {
            const { walks, joins } = walkForks(next)
            const inlet = joins.find(j => j.spot.branch === at.branch && j.spot.at === at.at)
            const gap = (l: number) => inlet ? Math.hypot(walks[l]!.end.x - inlet.x, walks[l]!.end.z - inlet.z) : 0
            const nearest = joinCandidates(next, at).sort((a, b) => gap(a) - gap(b))[0]
            if (nearest) next = setJoin(next, nearest, at)
        }
        edit(next, line.value, cursor.value + 1)
    }

    function removeAt(i: number) {
        if (i < 0 || i >= lineSectionIds.value.length) return
        edit(removeSection(draft.value, line.value, i), line.value, i - 1)
    }

    /** Takes the section at `from` out and puts it back in at `to`, counted after it's out; it stays selected. */
    function moveTo(from: number, to: number) {
        const n = lineSectionIds.value.length
        if (from === to || from < 0 || from >= n || to < 0 || to >= n) return
        edit(moveSection(draft.value, line.value, from, to), line.value, to)
    }

    /** Lays the main road back to the start line, or the branch onto the road it joins, as one edit so one undo takes it all back. */
    function finishLine() {
        const l = line.value
        const { sections: more, error } = l ? finishJoin(draft.value, l) : finishLoop(draft.value)
        if (!more) {
            finishError.value = error
            return
        }
        const all = [...lineSectionIds.value, ...more]
        edit(withLineSections(draft.value, l, all), l, all.length - 1)
    }

    /** Sends the branch being built on into the join at `to`, taking it off any branch that came in there; null leaves it open. */
    function joinAt(to: SectionSpot | null) {
        if (!line.value || (to && !canJoin(draft.value, line.value, to))) return
        const taken = to ? draft.value.branches?.findIndex(b => b.to?.branch === to.branch && b.to.at === to.at) ?? -1 : -1
        const freed = taken >= 0 && taken + 1 !== line.value ? setJoin(draft.value, taken + 1, null) : draft.value
        edit(setJoin(freed, line.value, to))
    }

    /** Takes a branch away with its split and every branch off it, and goes back to the road it left. */
    function removeLine(l: number) {
        const from = draft.value.branches?.[l - 1]?.from
        if (!from) return
        // Only an earlier line can be the one it left, so its number stands.
        edit(removeBranch(draft.value, l), from.branch, from.at - 1)
    }

    function setClosed(closed: boolean) {
        if (closed !== draft.value.closed) edit({ ...draft.value, closed })
    }

    function setName(name: string) {
        draft.value = { ...draft.value, name: name.slice(0, MAX_NAME_LENGTH) }
    }

    /** Highlights section `i` on line `l`, the line being built on unless said. */
    function select(i: number, l = line.value) {
        if (l < 0 || l > (draft.value.branches?.length ?? 0)) return
        line.value = l
        cursor.value = Math.max(-1, Math.min(i, lineSections(draft.value, l).length - 1))
    }

    /** Builds on line `l` from its end. */
    function selectLine(l: number) {
        select(lineSections(draft.value, l).length - 1, l)
    }

    function undo() {
        const prev = history.pop()
        if (!prev) return
        draft.value = prev.track
        line.value = prev.line
        cursor.value = prev.cursor
        finishError.value = null
        canUndo.value = history.length > 0
    }

    return {
        draft, closed, line, cursor, forks, lines, walk, lineClosed, lineSections: lineSectionIds, compiled, gap, endings, full, canFork, joinable, length, canUndo, finishError,
        walkUpTo, insert, removeAt, moveTo, finishLine, joinAt, removeLine, setClosed, setName, select, selectLine, undo
    }
}
